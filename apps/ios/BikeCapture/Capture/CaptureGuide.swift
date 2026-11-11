import Foundation

/// The bike capture checklist: three orbits (ticked as Object Capture completes each pass)
/// and close-ups of the parts sales comments usually point at (ticked by hand), plus the
/// shot count of every pass.
struct CaptureGuide {
    struct Item: Identifiable, Hashable {
        let id: String
        let title: String
        let detail: String
    }

    static let orbits = [
        Item(id: "orbit-hub", title: "Orbit 1 · hub height", detail: "Crouch so the camera is level with the axles."),
        Item(id: "orbit-saddle", title: "Orbit 2 · saddle height", detail: "Stand, camera at saddle height, tilted slightly down."),
        Item(id: "orbit-top", title: "Orbit 3 · top-down", detail: "Arms up, look down at the cockpit and top tube."),
    ]

    static let closeUps = [
        Item(id: "fork-crown", title: "Fork crown", detail: "Head tube, crown and brake from both sides."),
        Item(id: "dropouts", title: "Dropouts", detail: "Front and rear axles, thru-axle levers."),
        Item(id: "derailleur", title: "Rear derailleur", detail: "Cassette, mech and chain line from the drive side."),
        Item(id: "cockpit", title: "Cockpit", detail: "Bars, stem, levers and computer mount from above."),
    ]

    static let reflectiveTips = [
        "Shiny paint or chrome: a light dulling or scanning spray (if the owner allows it) gives reconstruction texture to lock on to.",
        "A polarizing filter clipped over the lens cuts reflections; keep it at the same angle for the whole capture.",
        "Avoid direct sun and spotlights: overcast daylight or a softbox reflects the least.",
    ]

    /// Object Capture tracks the camera against the room (ARKit), so the bike must not move:
    /// a turntable spinning it would look like a moving scene and break tracking.
    static let turntableNote = "No turntable: the bike must stay still while you walk around it. Do not flip it between passes."

    /// Shots of the passes before the current one.
    private(set) var finishedPassShots: [Int] = []
    private(set) var completedPasses = 0
    private(set) var ticked: Set<String> = []
    private var passStart = 0

    var pass: Int { finishedPassShots.count + 1 }
    var orbitsDone: Int { min(Self.orbits.count, completedPasses) }
    var done: Int { orbitsDone + Self.closeUps.filter { ticked.contains($0.id) }.count }
    var total: Int { Self.orbits.count + Self.closeUps.count }

    /// The orbit to do next, or nil once all three are done (close-ups may remain).
    var nextOrbit: Item? { orbitsDone < Self.orbits.count ? Self.orbits[orbitsDone] : nil }

    func isDone(_ item: Item) -> Bool {
        if let i = Self.orbits.firstIndex(of: item) { return i < orbitsDone }
        return ticked.contains(item.id)
    }

    /// Close-ups only: orbits are ticked by Object Capture's own pass detection.
    mutating func toggle(_ item: Item) {
        guard !Self.orbits.contains(item) else { return }
        if ticked.remove(item.id) == nil { ticked.insert(item.id) }
    }

    /// Shots per pass, the last one being the pass in progress (from the session's live total).
    func shotsPerPass(totalShots: Int) -> [Int] { finishedPassShots + [max(0, totalShots - passStart)] }

    mutating func passCompleted() {
        completedPasses = max(completedPasses, pass)
    }

    mutating func beginPass(totalShots: Int) {
        finishedPassShots.append(max(0, totalShots - passStart))
        passStart = totalShots
    }
}
