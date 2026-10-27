import RealityKit
import SwiftUI

struct CaptureScreen: View {
    @Environment(BikeLibrary.self) private var library
    @Environment(\.dismiss) private var dismiss
    @State private var model: CaptureModel
    let onCaptured: (BikeRecord) -> Void

    init(record: BikeRecord, onCaptured: @escaping (BikeRecord) -> Void) {
        _model = State(initialValue: CaptureModel(record: record))
        self.onCaptured = onCaptured
    }

    var body: some View {
        ZStack {
            ObjectCaptureView(session: model.session)
                .ignoresSafeArea()
            VStack {
                topBar
                Spacer()
                if !model.feedback.isEmpty {
                    Text(model.feedback.joined(separator: " · "))
                        .font(.callout.weight(.semibold))
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .background(.ultraThinMaterial, in: Capsule())
                }
                controls.padding(.bottom, 24)
            }
            .padding()
        }
        .task {
            model.start(images: library.imagesFolder(for: model.record.id), checkpoint: library.checkpointFolder(for: model.record.id))
        }
        .onChange(of: model.phase) { _, phase in
            if phase == .completed { complete() }
        }
        .statusBarHidden()
    }

    private var topBar: some View {
        HStack {
            Button("Cancel", role: .cancel) {
                model.cancel()
                library.update(model.record.id) { $0.status = .failed; $0.lastError = "Capture cancelled" }
                dismiss()
            }
            .buttonStyle(.bordered)
            Spacer()
            if model.phase == .capturing || model.phase == .passComplete {
                Text("Pass \(model.passes) · \(model.shotCount) shots")
                    .font(.footnote.monospacedDigit())
                    .padding(8)
                    .background(.ultraThinMaterial, in: Capsule())
            }
        }
    }

    @ViewBuilder
    private var controls: some View {
        switch model.phase {
        case .starting, .finishing:
            ProgressView().controlSize(.large)
        case .ready:
            if model.record.mode == .object {
                hint("Stand back so the whole bike is in frame, on a plain floor with even light.")
                bigButton("Detect bike") { model.startDetecting() }
            } else {
                hint("Area mode: walk slowly around the bike, keeping it centered.")
                bigButton("Start capture") { model.startCapturing() }
            }
        case .detecting:
            hint("Drag the box edges so it fits the bike from tyre to bar tape.")
            HStack {
                Button("Reset box") { model.resetDetection() }.buttonStyle(.bordered)
                bigButton("Start capture") { model.startCapturing() }
            }
        case .capturing:
            hint("Walk all the way around. Get close to the fork, drivetrain and cockpit too.")
        case .passComplete:
            VStack(spacing: 10) {
                hint(model.passes == 1 ? "Great! Now another orbit from lower down (crouch to hub height)." : "Add a high pass looking down at the cockpit, or finish.")
                HStack {
                    Button("Another pass") { model.newPass() }.buttonStyle(.bordered)
                    bigButton("Finish") { model.finish() }
                }
            }
        case .completed:
            EmptyView()
        case .failed(let message):
            VStack {
                hint(message)
                bigButton("Close") {
                    library.update(model.record.id) { $0.status = .failed; $0.lastError = message }
                    dismiss()
                }
            }
        }
    }

    private func complete() {
        let id = model.record.id
        let count = library.imageCount(for: id)
        library.update(id) {
            $0.status = .captured
            $0.imageCount = count
        }
        if let record = library.bikes.first(where: { $0.id == id }) { onCaptured(record) }
        dismiss()
    }

    private func hint(_ text: String) -> some View {
        Text(text)
            .font(.callout)
            .multilineTextAlignment(.center)
            .padding(12)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }

    private func bigButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
    }
}
