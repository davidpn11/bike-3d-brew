# Bike Capture (iOS)

SwiftUI app that captures a bike with Apple Object Capture and reconstructs it on device.

Requirements: iPhone/iPad **with LiDAR** (Pro models), iOS 18+, Xcode 16+.

```sh
brew install xcodegen
cd apps/ios
xcodegen generate
open BikeCapture.xcodeproj   # pick your team under Signing & Capabilities, run on the phone
```

## Capturing a bike

1. Bike on a kickstand or work stand, plain matte floor, soft even light (overcast outdoors is ideal).
2. **+** → name it → **Object mode** (background removed automatically) or **Area mode** (no detection box; crop later in the viewer).
3. Fit the box to the bike, **Start capture**, walk slowly around it. After each orbit add a pass:
   hub height, saddle height, then a high pass looking down. Get close to the fork, drivetrain and cockpit.
4. **Finish** → **Build 3D model** (keep the app in the foreground; a few minutes).
5. **View in 3D / AR**, or **Export capture bundle** → AirDrop to your computer → drop the
   zip / `model.usdz` onto the web viewer to add areas and sales comments.

Shiny paint and chrome reconstruct poorly; a light dulling/scanning spray helps if allowed.

Status: written in a Linux cloud session and compiled in CI (`.github/workflows/ios.yml`);
not yet run on a device. See `docs/ARCHITECTURE.md` → Open questions.
