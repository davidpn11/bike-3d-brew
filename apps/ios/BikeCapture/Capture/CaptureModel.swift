import Foundation
import Observation
import RealityKit

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
    private(set) var passes = 1

    private var tasks: [Task<Void, Never>] = []

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
        observe()
    }

    /// Object mode: show the bounding box so the user can fit it to the bike.
    func startDetecting() {
        if !session.startDetecting() { phase = .failed("Could not start object detection. Try area mode.") }
    }

    func startCapturing() {
        session.startCapturing()
    }

    func resetDetection() {
        _ = session.resetDetection()
    }

    func newPass() {
        passes += 1
        session.beginNewScanPass()
    }

    func finish() {
        session.finish()
    }

    func cancel() {
        session.cancel()
        tasks.forEach { $0.cancel() }
    }

    var shotCount: Int { session.numberOfShotsTaken }

    private func observe() {
        tasks.append(Task { [weak self] in
            guard let updates = self?.session.stateUpdates else { return }
            for await state in updates {
                guard let self else { return }
                switch state {
                case .initializing: phase = .starting
                case .ready: phase = .ready
                case .detecting: phase = .detecting
                case .capturing: phase = .capturing
                case .finishing: phase = .finishing
                case .completed: phase = .completed
                case .failed(let error): phase = .failed(error.localizedDescription)
                @unknown default: break
                }
            }
        })
        tasks.append(Task { [weak self] in
            guard let updates = self?.session.userCompletedScanPassUpdates else { return }
            for await completed in updates where completed {
                self?.phase = .passComplete
            }
        })
        tasks.append(Task { [weak self] in
            guard let updates = self?.session.feedbackUpdates else { return }
            for await feedback in updates {
                self?.feedback = feedback.compactMap(Self.describe).sorted()
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
