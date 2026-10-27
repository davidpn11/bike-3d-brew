import SwiftUI

struct LibraryView: View {
    @Environment(BikeLibrary.self) private var library
    @State private var capturing: BikeRecord?
    @State private var showingNew = false
    @State private var newName = ""
    @State private var newMode: BikeRecord.CaptureMode = .object
    @State private var path: [UUID] = []
    @State private var error: String?

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if !CaptureModel.isSupported {
                    Section {
                        Label("This device can't capture 3D models. Object Capture needs an iPhone or iPad with LiDAR. You can still review and share existing bikes.", systemImage: "exclamationmark.triangle")
                            .font(.callout)
                    }
                }
                Section {
                    ForEach(library.bikes) { bike in
                        NavigationLink(value: bike.id) { BikeRow(bike: bike) }
                    }
                    .onDelete { offsets in
                        for index in offsets { library.delete(library.bikes[index].id) }
                    }
                } footer: {
                    if library.bikes.isEmpty {
                        Text("Tap + to capture your first bike. Put it on a kickstand or stand on a plain floor, with soft even light.")
                    }
                }
            }
            .navigationTitle("Bikes")
            .navigationDestination(for: UUID.self) { id in BikeDetailView(bikeID: id) }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { showingNew = true } label: { Image(systemName: "plus") }
                        .disabled(!CaptureModel.isSupported)
                        .accessibilityLabel("Capture a new bike")
                }
            }
            .alert("New bike", isPresented: $showingNew) {
                TextField("Name (e.g. Canyon Aeroad CF SLX)", text: $newName)
                Button("Object mode") { startCapture(mode: .object) }
                Button("Area mode") { startCapture(mode: .area) }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Object mode removes the background automatically. Use area mode if the bike won't fit in the detection box.")
            }
            .alert("Error", isPresented: .constant(error != nil), presenting: error) { _ in
                Button("OK") { error = nil }
            } message: { Text($0) }
            .fullScreenCover(item: $capturing) { record in
                CaptureScreen(record: record) { captured in path = [captured.id] }
            }
        }
    }

    private func startCapture(mode: BikeRecord.CaptureMode) {
        let name = newName.trimmingCharacters(in: .whitespaces)
        do {
            capturing = try library.create(name: name.isEmpty ? "Bike \(library.bikes.count + 1)" : name, mode: mode)
            newName = ""
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct BikeRow: View {
    let bike: BikeRecord

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(bike.name).font(.headline)
            HStack(spacing: 6) {
                Text(bike.createdAt, style: .date)
                Text("·")
                Text(statusText)
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }

    private var statusText: String {
        switch bike.status {
        case .capturing: "Capture interrupted"
        case .captured: "\(bike.imageCount) photos · not built yet"
        case .reconstructing: "Building model…"
        case .ready: "3D model ready"
        case .failed: bike.lastError ?? "Failed"
        }
    }
}
