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
3. Fit the box to the bike, **Start capture**, walk slowly around it. Tap **Checklist** for the plan:
   three orbits (hub height, saddle height, top-down; each ticks itself when Object Capture
   completes the pass, with its shot count) and close-ups of the fork crown, dropouts, rear
   derailleur and cockpit (tick them yourself).
4. **Finish** → **Build 3D model** (keep the app in the foreground; a few minutes).
5. **View in 3D / AR**, or **Export capture bundle** → AirDrop to your computer → drop the
   zip / `model.usdz` onto the web viewer to add areas and sales comments.

Shiny paint and chrome reconstruct poorly; a light dulling/scanning spray helps if allowed, as
does a polarizing filter and diffuse light. No turntable: on-device Object Capture tracks the
camera against the room, so the bike must stay still (a turntable set needs the Mac pipeline).

The exported zip also holds `photos/*.jpg`, 2048 px upright JPEG copies of the HEICs, so the web
viewer shows close-ups without decoding HEIC.

Status: written in a Linux cloud session and compiled in CI (`.github/workflows/ios.yml`);
not yet run on a device. See `docs/ARCHITECTURE.md` → Open questions.
