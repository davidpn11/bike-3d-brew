import Foundation
import Observation

/// One captured bike. Stored as `record.json` in its folder:
///
///     Documents/Bikes/<uuid>/
///       record.json        this struct
///       images/            Object Capture HEICs (with depth + gravity), input to reconstruction
///       checkpoint/        Object Capture / Photogrammetry checkpoint (speeds up re-runs)
///       model.usdz         on-device reconstruction (background removed by object masking)
///       poses.json         per-image camera poses from PhotogrammetrySession (.poses request)
struct BikeRecord: Codable, Identifiable, Hashable, Sendable {
    enum Status: String, Codable, Sendable {
        case capturing, captured, reconstructing, ready, failed
    }

    enum CaptureMode: String, Codable, Sendable {
        /// Bounding box around the bike; background is masked out automatically.
        case object
        /// No bounding box (iOS 18+): for setups where object detection struggles; needs cropping later.
        case area
    }

    var id: UUID
    var name: String
    var createdAt: Date
    var status: Status
    var mode: CaptureMode
    var imageCount: Int = 0
    var lastError: String?
}

@Observable
@MainActor
final class BikeLibrary {
    private(set) var bikes: [BikeRecord] = []
    let root: URL

    init(root: URL = URL.documentsDirectory.appending(path: "Bikes", directoryHint: .isDirectory)) {
        self.root = root
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        reload()
    }

    func folder(for id: UUID) -> URL { root.appending(path: id.uuidString, directoryHint: .isDirectory) }
    func imagesFolder(for id: UUID) -> URL { folder(for: id).appending(path: "images", directoryHint: .isDirectory) }
    func checkpointFolder(for id: UUID) -> URL { folder(for: id).appending(path: "checkpoint", directoryHint: .isDirectory) }
    func modelURL(for id: UUID) -> URL { folder(for: id).appending(path: "model.usdz") }
    func posesURL(for id: UUID) -> URL { folder(for: id).appending(path: "poses.json") }

    func hasModel(_ id: UUID) -> Bool { FileManager.default.fileExists(atPath: modelURL(for: id).path) }

    func create(name: String, mode: BikeRecord.CaptureMode) throws -> BikeRecord {
        let record = BikeRecord(id: UUID(), name: name, createdAt: .now, status: .capturing, mode: mode)
        let fm = FileManager.default
        try fm.createDirectory(at: imagesFolder(for: record.id), withIntermediateDirectories: true)
        try fm.createDirectory(at: checkpointFolder(for: record.id), withIntermediateDirectories: true)
        try save(record)
        return record
    }

    func save(_ record: BikeRecord) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        try encoder.encode(record).write(to: folder(for: record.id).appending(path: "record.json"), options: .atomic)
        reload()
    }

    func update(_ id: UUID, _ change: (inout BikeRecord) -> Void) {
        guard var record = bikes.first(where: { $0.id == id }) else { return }
        change(&record)
        try? save(record)
    }

    func delete(_ id: UUID) {
        try? FileManager.default.removeItem(at: folder(for: id))
        reload()
    }

    func reload() {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let folders = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? []
        bikes = folders
            .compactMap { try? Data(contentsOf: $0.appending(path: "record.json")) }
            .compactMap { try? decoder.decode(BikeRecord.self, from: $0) }
            .sorted { $0.createdAt > $1.createdAt }
    }

    func imageCount(for id: UUID) -> Int {
        let files = (try? FileManager.default.contentsOfDirectory(atPath: imagesFolder(for: id).path)) ?? []
        return files.filter { $0.lowercased().hasSuffix(".heic") }.count
    }
}
