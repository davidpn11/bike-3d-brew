import RealityKit
import SwiftUI

struct CaptureScreen: View {
    @Environment(BikeLibrary.self) private var library
    @Environment(\.dismiss) private var dismiss
    @State private var model: CaptureModel
    @State private var showChecklist = false
    @State private var confirmFewShots = false
    @State private var stallTick = Date.now
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
                if showChecklist { checklist }
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
            if case .failed(let message) = phase { preserveCapture(error: message) }
        }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                stallTick = .now
            }
        }
        .alert("Very few shots", isPresented: $confirmFewShots) {
            Button("Keep capturing", role: .cancel) { }
            Button("Finish anyway", role: .destructive) { model.finish() }
        } message: {
            Text("The model may fail with fewer than 20 photos. Finish and keep these images anyway?")
        }
        .statusBarHidden()
    }

    private var topBar: some View {
        HStack {
            Button("Cancel", role: .cancel) {
                model.cancel()
                preserveCapture(error: "Capture cancelled")
                dismiss()
            }
            .buttonStyle(.bordered)
            Spacer()
            if model.phase == .capturing || model.phase == .passComplete {
                VStack(alignment: .trailing, spacing: 3) {
                    Button { model.toggleDiagnostics() } label: {
                        Text("Pass \(model.guide.pass) · \(model.shotCount) shots")
                            .font(.footnote.monospacedDigit())
                    }
                    .buttonStyle(.plain)
                    if model.diagnosticsVisible {
                        Text(model.diagnosticLine)
                            .font(.caption2.monospaced())
                            .multilineTextAlignment(.trailing)
                    }
                }
                    .font(.footnote.monospacedDigit())
                    .padding(8)
                    .background(.ultraThinMaterial, in: Capsule())
            }
            Button { showChecklist.toggle() } label: {
                Label("Checklist \(model.guide.done)/\(model.guide.total)", systemImage: showChecklist ? "checklist.checked" : "checklist")
                    .font(.footnote.monospacedDigit())
            }
            .buttonStyle(.bordered)
            .accessibilityHint(showChecklist ? "Hides the capture checklist" : "Shows the capture checklist")
        }
    }

    private var checklist: some View {
        let shots = model.guide.shotsPerPass(totalShots: model.shotCount)
        return ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text("Orbits").font(.headline)
                ForEach(Array(CaptureGuide.orbits.enumerated()), id: \.element.id) { index, item in
                    row(item, trailing: index < shots.count ? "\(shots[index]) shots" : nil)
                }
                Text("Close-ups (tap when done)").font(.headline).padding(.top, 4)
                ForEach(CaptureGuide.closeUps) { item in
                    Button { model.guide.toggle(item) } label: { row(item, trailing: nil) }
                        .buttonStyle(.plain)
                }
                Text("Reflective paint").font(.headline).padding(.top, 4)
                ForEach(CaptureGuide.reflectiveTips + [CaptureGuide.turntableNote], id: \.self) { tip in
                    Label(tip, systemImage: "lightbulb").font(.caption)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
        }
        .frame(maxHeight: 420)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))
    }

    private func row(_ item: CaptureGuide.Item, trailing: String?) -> some View {
        let done = model.guide.isDone(item)
        return HStack(alignment: .firstTextBaseline) {
            Image(systemName: done ? "checkmark.circle.fill" : "circle").foregroundStyle(done ? Color.green : Color.secondary)
            VStack(alignment: .leading) {
                Text(item.title).font(.subheadline.weight(.semibold))
                Text(item.detail).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if let trailing { Text(trailing).font(.caption.monospacedDigit()) }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(done ? .isSelected : [])
    }

    @ViewBuilder
    private var controls: some View {
        let _ = stallTick
        switch model.phase {
        case .starting, .finishing:
            ProgressView().controlSize(.large)
        case .ready:
            if model.record.mode == .object {
                hint(model.stallHint ?? "Stand back so the whole bike is in frame, on a plain floor with even light. Shiny paint? See the checklist tips.")
                bigButton("Detect bike") { model.startDetecting() }
            } else {
                hint(model.stallHint ?? "Area mode: walk slowly around the bike, keeping it centered.")
                bigButton("Start capture") { model.startCapturing() }
            }
        case .detecting:
            hint(model.stallHint ?? "Drag the box edges so it fits the bike from tyre to bar tape.")
            HStack {
                Button("Reset box") { model.resetDetection() }.buttonStyle(.bordered)
                bigButton("Start capture") { model.startCapturing() }
            }
        case .capturing:
            VStack(spacing: 10) {
                hint(model.stallHint ?? "\(model.guide.nextOrbit?.detail ?? "Extra pass: get close to the fork crown, dropouts, rear derailleur and cockpit.") Walk all the way around.")
                HStack {
                    Button("Mark orbit done") { model.markOrbitDone() }.buttonStyle(.bordered)
                    bigButton("Finish") { requestFinish() }
                }
            }
        case .passComplete:
            VStack(spacing: 10) {
                hint(model.guide.nextOrbit.map { "Orbit done. Next: \($0.title.lowercased()). \($0.detail)" } ?? "All three orbits done. Add a close-up pass for the parts still open in the checklist, or finish.")
                HStack {
                    Button("Another pass") { model.newPass() }.buttonStyle(.bordered)
                    bigButton("Finish") { requestFinish() }
                }
            }
        case .completed:
            EmptyView()
        case .failed(let message):
            VStack {
                hint(message)
                bigButton("Close") {
                    preserveCapture(error: message)
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
            $0.checklist = model.guide.checklist
        }
        if let record = library.bikes.first(where: { $0.id == id }) { onCaptured(record) }
        dismiss()
    }

    private func requestFinish() {
        if model.shotCount < 20 {
            confirmFewShots = true
        } else {
            model.finish()
        }
    }

    private func preserveCapture(error: String) {
        let id = model.record.id
        let count = library.imageCount(for: id)
        library.update(id) {
            $0.status = .failed
            $0.imageCount = count
            $0.lastError = error
            $0.checklist = model.guide.checklist
        }
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
