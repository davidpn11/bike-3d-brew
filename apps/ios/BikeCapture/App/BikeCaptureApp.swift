import SwiftUI

@main
struct BikeCaptureApp: App {
    @State private var library = BikeLibrary()

    var body: some Scene {
        WindowGroup {
            LibraryView()
                .environment(library)
                .tint(.orange)
        }
    }
}
