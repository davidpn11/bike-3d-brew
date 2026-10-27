import QuickLook
import SwiftUI

struct BikeDetailView: View {
    @Environment(BikeLibrary.self) private var library
    let bikeID: UUID
    @State private var reconstructor = Reconstructor()
    @State private var previewURL: URL?
    @State private var exportURL: URL?
    @State private var error: String?

    private var bike: BikeRecord? { library.bikes.first { $0.id == bikeID } }

    var body: some View {
        if let bike {
            List {
                Section("Model") {
                    if library.hasModel(bike.id) {
                        Button { previewURL = library.modelURL(for: bike.id) } label: {
                            Label("View in 3D / AR", systemImage: "cube.transparent")
                        }
                        ShareLink(item: library.modelURL(for: bike.id)) {
                            Label("Share model (.usdz)", systemImage: "square.and.arrow.up")
                        }
                    }
                    buildRow(bike)
                }
                Section {
                    Button { export(bike) } label: { Label("Export capture bundle (.zip)", systemImage: "archivebox") }
                    if let exportURL {
                        ShareLink(item: exportURL) { Label("Share \(exportURL.lastPathComponent)", systemImage: "airplayaudio") }
                    }
                } header: {
                    Text("Bundle")
                } footer: {
                    Text("Contains the model, camera poses and \(library.imageCount(for: bike.id)) photos. Drop it into the web viewer to add areas and sales comments.")
                }
            }
            .navigationTitle(bike.name)
            .quickLookPreview($previewURL)
            .alert("Error", isPresented: .constant(error != nil), presenting: error) { _ in
                Button("OK") { error = nil }
            } message: { Text($0) }
        } else {
            ContentUnavailableView("Bike not found", systemImage: "bicycle")
        }
    }

    @ViewBuilder
    private func buildRow(_ bike: BikeRecord) -> some View {
        switch reconstructor.state {
        case .running(let fraction):
            VStack(alignment: .leading) {
                ProgressView(value: fraction) { Text("Building 3D model… keep the app open") }
                Button("Cancel", role: .cancel) { reconstructor.cancel() }
            }
        default:
            Button {
                Task { await build(bike) }
            } label: {
                Label(library.hasModel(bike.id) ? "Rebuild model" : "Build 3D model", systemImage: "hammer")
            }
            .disabled(!Reconstructor.isSupported || library.imageCount(for: bike.id) < 10)
        }
    }

    private func build(_ bike: BikeRecord) async {
        library.update(bike.id) { $0.status = .reconstructing }
        await reconstructor.run(
            images: library.imagesFolder(for: bike.id),
            checkpoint: library.checkpointFolder(for: bike.id),
            model: library.modelURL(for: bike.id),
            poses: library.posesURL(for: bike.id),
            maskBackground: bike.mode == .object
        )
        switch reconstructor.state {
        case .done:
            library.update(bike.id) { $0.status = .ready; $0.lastError = nil }
        case .failed(let message):
            library.update(bike.id) { $0.status = .failed; $0.lastError = message }
            error = message
        default:
            break
        }
    }

    private func export(_ bike: BikeRecord) {
        do {
            exportURL = try BundleExporter.export(bike, library: library)
        } catch {
            self.error = error.localizedDescription
        }
    }
}
