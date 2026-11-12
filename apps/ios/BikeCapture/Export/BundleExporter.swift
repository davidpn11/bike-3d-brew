import Foundation
import ImageIO
import UIKit
import UniformTypeIdentifiers

/// Packs a bike folder into `<name>.bikecapture.zip` (contract `bike-capture/1`) for AirDrop
/// or Files. The web viewer and tools/ scripts read this layout:
///
///     manifest.json   { schema, name, createdAt, device, mode, model, poses, images, checklist? }
///     model.usdz
///     poses.json
///     images/*.HEIC
///     photos/*.jpg    2048 px copies of images/ (same stems), upright, for browsers
enum BundleExporter {
    struct ChecklistItem: Codable {
        var id: String
        var label: String
        var done: Bool
    }

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
        var photos: String? = "photos/"
        var imageCount: Int
        var checklist: [ChecklistItem]?
    }

    /// Long edge of the browser copies: plenty for a full-screen close-up, ~0.5 MB each.
    static let photoMaxPixels = 2048

    @MainActor
    static func export(_ record: BikeRecord, library: BikeLibrary) async throws -> URL {
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
            imageCount: library.imageCount(for: record.id),
            checklist: record.checklist.isEmpty ? nil : record.checklist.map { ChecklistItem(id: $0.id, label: $0.label, done: $0.done) }
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        try encoder.encode(manifest).write(to: folder.appending(path: "manifest.json"), options: .atomic)

        let name = safeName(record.name), id = record.id
        // Image conversion takes seconds for hundreds of photos: keep it off the main thread.
        return try await Task.detached(priority: .userInitiated) {
            try pack(folder: folder, id: id, name: name)
        }.value
    }

    private static func pack(folder: URL, id: UUID, name: String) throws -> URL {
        let fm = FileManager.default
        // Stage everything except the (large, device-specific) checkpoint.
        let staging = fm.temporaryDirectory.appending(path: "export-\(id.uuidString)", directoryHint: .isDirectory)
        try? fm.removeItem(at: staging)
        try fm.createDirectory(at: staging, withIntermediateDirectories: true)
        for item in try fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil) where item.lastPathComponent != "checkpoint" {
            try fm.copyItem(at: item, to: staging.appending(path: item.lastPathComponent))
        }
        try writePhotos(from: folder.appending(path: "images", directoryHint: .isDirectory), to: staging.appending(path: "photos", directoryHint: .isDirectory))

        // NSFileCoordinator's .forUploading option zips a directory for us.
        var zipURL: URL?
        var coordinationError: NSError?
        var copyError: Error?
        let destination = fm.temporaryDirectory.appending(path: "\(name).bikecapture.zip")
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

    /// JPEG copies of the HEICs, so browsers without HEIC support skip the WASM decoder. The
    /// thumbnail call applies the EXIF orientation to the pixels and no metadata is copied, so
    /// the JPEGs are upright with orientation 1 (no double rotation in browsers).
    static func writePhotos(from images: URL, to photos: URL) throws {
        let fm = FileManager.default
        try fm.createDirectory(at: photos, withIntermediateDirectories: true)
        let heics = (try? fm.contentsOfDirectory(at: images, includingPropertiesForKeys: nil))?.filter { ["heic", "heif"].contains($0.pathExtension.lowercased()) } ?? []
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: photoMaxPixels,
        ]
        for heic in heics {
            autoreleasepool { writeJPEG(heic, into: photos, options: options) }
        }
    }

    private static func writeJPEG(_ heic: URL, into photos: URL, options: [CFString: Any]) {
        // A photo that fails to convert is skipped: the web side falls back to its HEIC.
        guard let source = CGImageSourceCreateWithURL(heic as CFURL, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return }
        let out = photos.appending(path: heic.deletingPathExtension().lastPathComponent + ".jpg")
        guard let dest = CGImageDestinationCreateWithURL(out as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { return }
        CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
        if !CGImageDestinationFinalize(dest) { try? FileManager.default.removeItem(at: out) }
    }

    private static func safeName(_ name: String) -> String {
        let cleaned = name.components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }.joined(separator: "-")
        return cleaned.isEmpty ? "bike" : cleaned.lowercased()
    }
}
