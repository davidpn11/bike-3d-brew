import Foundation
import Observation
import RealityKit
import simd

/// Runs PhotogrammetrySession on device: a USDZ model (object masking removes the
/// background) plus the camera pose of every image, which the web viewer uses to show
/// real close-up photos for each area of the bike.
@Observable
@MainActor
final class Reconstructor {
    enum State: Equatable {
        case idle, running(Double), done, failed(String)
    }

    private(set) var state: State = .idle
    private var session: PhotogrammetrySession?

    static var isSupported: Bool { PhotogrammetrySession.isSupported }

    func run(images: URL, checkpoint: URL, model: URL, poses: URL, maskBackground: Bool) async {
        state = .running(0)
        var configuration = PhotogrammetrySession.Configuration()
        configuration.checkpointDirectory = checkpoint
        configuration.isObjectMaskingEnabled = maskBackground
        // Bikes have fine detail (spokes, cables): favour detail over speed.
        configuration.featureSensitivity = .high
        configuration.sampleOrdering = .sequential

        do {
            let session = try PhotogrammetrySession(input: images, configuration: configuration)
            self.session = session
            // iOS reconstructs on device at the reduced detail level only.
            try session.process(requests: [.modelFile(url: model, detail: .reduced), .poses])
            for try await output in session.outputs {
                switch output {
                case .requestProgress(_, let fraction):
                    state = .running(fraction)
                case .requestComplete(_, let result):
                    if case .poses(let result) = result {
                        try PosesFile(result).write(to: poses)
                    }
                case .requestError(let request, let error):
                    if case .modelFile = request { state = .failed(error.localizedDescription) }
                case .processingComplete:
                    if case .running = state { state = .done }
                case .processingCancelled:
                    state = .failed("Cancelled")
                default:
                    break
                }
            }
        } catch {
            state = .failed(error.localizedDescription)
        }
        session = nil
    }

    func cancel() {
        session?.cancel()
    }
}

/// `poses.json`, contract `bike-poses/1`. Transforms are 4×4 column-major, mapping camera
/// space to model space (meters, +Y up), matching three.js `Matrix4.fromArray`.
struct PosesFile: Codable {
    struct Sample: Codable {
        var sample: Int
        var file: String?
        var transform: [Float]
    }

    var schema = "bike-poses/1"
    var samples: [Sample]

    init(_ poses: PhotogrammetrySession.Poses) {
        samples = poses.posesBySample.keys.sorted().compactMap { id in
            guard let pose = poses.posesBySample[id] else { return nil }
            var m = simd_float4x4(pose.rotation)
            m.columns.3 = SIMD4(pose.translation, 1)
            let flat = [m.columns.0, m.columns.1, m.columns.2, m.columns.3].flatMap { [$0.x, $0.y, $0.z, $0.w] }
            return Sample(sample: id, file: poses.urlsBySample[id]?.lastPathComponent, transform: flat)
        }
    }

    func write(to url: URL) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(self).write(to: url, options: .atomic)
    }
}
