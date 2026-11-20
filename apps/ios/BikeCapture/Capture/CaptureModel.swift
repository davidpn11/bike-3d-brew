import Foundation
import Observation
import os
import RealityKit
import SwiftUI // ObjectCaptureSession lives in the RealityKit + SwiftUI overlay

/// Drives one guided Object Capture session around a bike.
///
/// Flow: ready → (object mode) detecting: user fits the box to the bike → capturing: walk
/// around; after each completed orbit the user can add a pass (low, mid, high) → finish.
/// Bikes are thin and reflective, so three passes plus close-ups of the fork, drivetrain
/// and cockpit give reconstruction the best chance.
@Observable
@MainActor
final class CaptureModel {
    enum Phase: Equatable {
        case starting, ready, detecting, capturing, passComplete, finishing, completed, failed(String)
    }

    let record: BikeRecord
    let session = ObjectCaptureSession()
    private(set) var phase: Phase = .starting
    private(set) var feedback: [String] = []
    private(set) var trackingStatus = "Unavailable"
    private(set) var diagnosticsVisible = false
    var guide = CaptureGuide()

    private var tasks: [Task<Void, Never>] = []
    private var lastShotCount = 0
    private var lastShotIncrease = Date.now
    private var phaseStarted = Date.now
    private var pendingManualPassUpdate = false
    private let logger = Logger(subsystem: "com.bike3dbrew.capture", category: "capture")

    init(record: BikeRecord) {
        self.record = record
    }

    static var isSupported: Bool { ObjectCaptureSession.isSupported }

    func start(images: URL, checkpoint: URL) {
        var configuration = ObjectCaptureSession.Configuration()
        configuration.checkpointDirectory = checkpoint
        // Keep extra shots beyond the guided ones: useful for close-ups of components.
        configuration.isOverCaptureEnabled = true
        session.start(imagesDirectory: images, configuration: configuration)
        logger.info("Capture started mode=\(self.record.mode.rawValue, privacy: .public) maxImages=\(self.session.maximumNumberOfInputImages)")
        observe()
    }

    /// Object mode: show the bounding box so the user can fit it to the bike.
    func startDetecting() {
        if !session.startDetecting() { setPhase(.failed("Could not start object detection. Try area mode.")) }
    }

    func startCapturing() {
        lastShotIncrease = .now
        session.startCapturing()
    }

    func resetDetection() {
        _ = session.resetDetection()
    }

    func newPass() {
        guard session.userCompletedScanPass else { return }
        guide.beginPass(totalShots: shotCount)
        if record.mode == .object {
            session.beginNewScanPass()
        }
        logger.info("Started Object Capture pass \(self.guide.pass)")
    }

    func markOrbitDone() {
        if session.userCompletedScanPass {
            guard guide.passCompleted(totalShots: shotCount, manual: false) else { return }
            setPhase(.passComplete)
            return
        }
        guard guide.passCompleted(totalShots: shotCount, manual: true) else { return }
        pendingManualPassUpdate = true
        guide.beginPass(totalShots: shotCount)
        logger.info("Manually marked orbit done; shots=\(self.shotCount), manualPasses=\(self.guide.manuallyCompletedPasses)")
    }

    func toggleDiagnostics() {
        diagnosticsVisible.toggle()
    }

    var diagnosticLine: String {
        "\(phaseName) · \(shotCount) shots · OC \(guide.automaticallyCompletedPasses) / manual \(guide.manuallyCompletedPasses) · tracking \(trackingStatus)"
    }

    var stallHint: String? {
        switch phase {
        case .ready where Date.now.timeIntervalSince(phaseStarted) > 20,
             .detecting where Date.now.timeIntervalSince(phaseStarted) > 20:
            "Having trouble starting? Try Area mode, add more light, or step back."
        case .capturing where Date.now.timeIntervalSince(lastShotIncrease) > 15:
            "Move slowly around the bike; shots are not being taken."
        default:
            nil
        }
    }

    func finish() {
        logger.info("Finish requested shots=\(self.shotCount)")
        session.finish()
    }

    func cancel() {
        logger.info("Capture cancelled shots=\(self.shotCount)")
        session.cancel()
        tasks.forEach { $0.cancel() }
    }

    var shotCount: Int { session.numberOfShotsTaken }

    private var phaseName: String {
        switch phase {
        case .starting: "starting"
        case .ready: "ready"
        case .detecting: "detecting"
        case .capturing: "capturing"
        case .passComplete: "pass complete"
        case .finishing: "finishing"
        case .completed: "completed"
        case .failed: "failed"
        }
    }

    private func setPhase(_ newPhase: Phase) {
        guard phase != newPhase else { return }
        logger.info("State \(self.phaseName, privacy: .public) -> \(Self.name(newPhase), privacy: .public)")
        phase = newPhase
        phaseStarted = .now
        if newPhase == .capturing { lastShotIncrease = .now }
    }

    private static func name(_ phase: Phase) -> String {
        switch phase {
        case .starting: "starting"
        case .ready: "ready"
        case .detecting: "detecting"
        case .capturing: "capturing"
        case .passComplete: "passComplete"
        case .finishing: "finishing"
        case .completed: "completed"
        case .failed(let message): "failed: \(message)"
        }
    }

    private func observe() {
        tasks.append(Task { [weak self] in
            guard let updates = self?.session.stateUpdates else { return }
            for await state in updates {
                guard let self else { return }
                switch state {
                case .initializing: setPhase(.starting)
                case .ready: setPhase(.ready)
                case .detecting: setPhase(.detecting)
                case .capturing: setPhase(.capturing)
                case .finishing: setPhase(.finishing)
                case .completed: setPhase(.completed)
                case .failed(let error):
                    logger.error("Capture error: \(error.localizedDescription, privacy: .public); shots=\(self.shotCount)")
                    setPhase(.failed(error.localizedDescription))
                @unknown default: break
                }
            }
        })
        tasks.append(Task { [weak self] in
            guard let updates = self?.session.userCompletedScanPassUpdates else { return }
            for await completed in updates where completed {
                guard let self else { return }
                logger.info("Object Capture reported a completed scan pass; shots=\(self.shotCount)")
                if pendingManualPassUpdate {
                    pendingManualPassUpdate = false
                    if record.mode == .object, case .capturing = session.state {
                        session.beginNewScanPass()
                    }
                    continue
                }
                guard guide.passCompleted(totalShots: shotCount, manual: false) else { continue }
                setPhase(.passComplete)
            }
        })
        tasks.append(Task { [weak self] in
            guard let updates = self?.session.feedbackUpdates else { return }
            for await feedback in updates {
                guard let self else { return }
                self.feedback = feedback.compactMap(Self.describe).sorted()
                logger.info("Feedback set: \(self.feedback.joined(separator: ", "), privacy: .public)")
            }
        })
        tasks.append(Task { [weak self] in
            guard let updates = self?.session.cameraTrackingUpdates else { return }
            for await tracking in updates {
                guard let self else { return }
                switch tracking {
                case .notAvailable: trackingStatus = "unavailable"
                case .normal: trackingStatus = "normal"
                case .limited(let reason): trackingStatus = "limited (\(String(describing: reason)))"
                @unknown default: trackingStatus = "unknown"
                }
                logger.info("Camera tracking: \(self.trackingStatus, privacy: .public)")
            }
        })
        tasks.append(Task { [weak self] in
            guard let updates = self?.session.numberOfShotsTakenUpdates else { return }
            for await shots in updates {
                guard let self else { return }
                if shots > lastShotCount { lastShotIncrease = .now }
                lastShotCount = shots
            }
        })
    }

    private static func describe(_ feedback: ObjectCaptureSession.Feedback) -> String? {
        switch feedback {
        case .objectTooClose: "Move back from the bike"
        case .objectTooFar: "Move closer to the bike"
        case .movingTooFast: "Slow down"
        case .environmentLowLight: "More light needed"
        case .environmentTooDark: "Too dark to capture"
        case .outOfFieldOfView: "Point the camera at the bike"
        case .objectNotFlippable: nil
        case .overCapturing: "Plenty of shots here: keep moving"
        case .objectNotDetected: "Bike not detected"
        @unknown default: nil
        }
    }
}
