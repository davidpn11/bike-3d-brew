import Foundation
import UIKit

/// Packs a bike folder into `<name>.bikecapture.zip` (contract `bike-capture/1`) for AirDrop
/// or Files. The web viewer and tools/ scripts read this layout:
///
///     manifest.json   { schema, name, createdAt, device, mode, model, poses, images }
///     model.usdz
///     poses.json
///     images/*.HEIC
enum BundleExporter {
    struct Manifest: Codable {
        var schema = "bike-capture/1"
        var name: String
        var createdAt: Date
        var device: String
        var systemVersion: String
        var mode: BikeRecord.CaptureMode
        var model: String?
        var poses: String?
        var images = "images/"
        var imageCount: Int
    }

    @MainActor
    static func export(_ record: BikeRecord, library: BikeLibrary) throws -> URL {
        let folder = library.folder(for: record.id)
        let fm = FileManager.default
        let manifest = Manifest(
            name: record.name,
            createdAt: record.createdAt,
            device: UIDevice.current.model,
            systemVersion: UIDevice.current.systemVersion,
            mode: record.mode,
            model: fm.fileExists(atPath: library.modelURL(for: record.id).path) ? "model.usdz" : nil,
            poses: fm.fileExists(atPath: library.posesURL(for: record.id).path) ? "poses.json" : nil,
            imageCount: library.imageCount(for: record.id)
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        try encoder.encode(manifest).write(to: folder.appending(path: "manifest.json"), options: .atomic)

        // Stage everything except the (large, device-specific) checkpoint.
        let staging = fm.temporaryDirectory.appending(path: "export-\(record.id.uuidString)", directoryHint: .isDirectory)
        try? fm.removeItem(at: staging)
        try fm.createDirectory(at: staging, withIntermediateDirectories: true)
        for item in try fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil) where item.lastPathComponent != "checkpoint" {
            try fm.copyItem(at: item, to: staging.appending(path: item.lastPathComponent))
        }

        // NSFileCoordinator's .forUploading option zips a directory for us.
        var zipURL: URL?
        var coordinationError: NSError?
        var copyError: Error?
        let destination = fm.temporaryDirectory.appending(path: "\(safeName(record.name)).bikecapture.zip")
        NSFileCoordinator().coordinate(readingItemAt: staging, options: .forUploading, error: &coordinationError) { tempZip in
            do {
                try? fm.removeItem(at: destination)
                try fm.copyItem(at: tempZip, to: destination)
                zipURL = destination
            } catch {
                copyError = error
            }
        }
        try? fm.removeItem(at: staging)
        if let coordinationError { throw coordinationError }
        if let copyError { throw copyError }
        guard let zipURL else { throw CocoaError(.fileWriteUnknown) }
        return zipURL
    }

    private static func safeName(_ name: String) -> String {
        let cleaned = name.components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }.joined(separator: "-")
        return cleaned.isEmpty ? "bike" : cleaned.lowercased()
    }
}
