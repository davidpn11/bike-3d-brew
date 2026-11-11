import RealityKit
import SwiftUI

struct CaptureScreen: View {
    @Environment(BikeLibrary.self) private var library
    @Environment(\.dismiss) private var dismiss
    @State private var model: CaptureModel
    @State private var showChecklist = false
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
                Text("Pass \(model.guide.pass) · \(model.guide.shotsPerPass(totalShots: model.shotCount).last ?? 0) shots")
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
        switch model.phase {
        case .starting, .finishing:
            ProgressView().controlSize(.large)
        case .ready:
            if model.record.mode == .object {
                hint("Stand back so the whole bike is in frame, on a plain floor with even light. Shiny paint? See the checklist tips.")
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
            hint("\(model.guide.nextOrbit?.detail ?? "Extra pass: get close to the fork crown, dropouts, rear derailleur and cockpit.") Walk all the way around.")
        case .passComplete:
            VStack(spacing: 10) {
                hint(model.guide.nextOrbit.map { "Orbit done. Next: \($0.title.lowercased()). \($0.detail)" } ?? "All three orbits done. Add a close-up pass for the parts still open in the checklist, or finish.")
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
