# Bike Capture (iOS)

SwiftUI app that captures a bike with Apple Object Capture and reconstructs it on device.

Requirements: iPhone/iPad **with LiDAR** (Pro models), iOS 18+, and the newest Xcode (16 is the floor; new iPhones need the current release). Command-line setup is [below](#command-line-setup).

```sh
brew install xcodegen
cd apps/ios
xcodegen generate
open BikeCapture.xcodeproj   # pick your team under Signing & Capabilities, run on the phone
```

## Command-line setup

**Tools.** The project has no CocoaPods or Swift packages; everything comes from Apple's SDK.

| Tool | Why | Install |
|---|---|---|
| **Xcode** (newest release) | SDK, signing, `xcodebuild`, `devicectl`, Simulator. The newest iPhones need the newest Xcode: README's "16+" is the floor, not enough for an iPhone 18 Pro | `xcodes` below, or the Mac App Store |
| `xcodes` + `aria2` | install and switch Xcode versions from the terminal (aria2 makes the download much faster) | `brew install xcodes aria2` |
| `xcodegen` | generates `BikeCapture.xcodeproj` from `project.yml` (the project file is not committed) | `brew install xcodegen` |
| `xcbeautify` | readable `xcodebuild` output | `brew install xcbeautify` |

**One-time setup:**

```sh
brew install xcodes aria2 xcodegen xcbeautify
xcodes install --latest                  # asks for your Apple ID; installs to /Applications/Xcode-<version>.app
sudo xcode-select -s "$(ls -d /Applications/Xcode*.app | sort -V | tail -1)"
xcodebuild -runFirstLaunch
xcodebuild -downloadPlatform iOS         # device support + the iOS Simulator runtime
```

Then open Xcode once, add your Apple ID (Settings → **Apple Accounts** in Xcode 27, or Signing & Capabilities → Team → **Add an Account…**), and copy your **Team ID** from there. Free
"Personal Team" accounts work. Put it in your shell profile, so command-line builds sign without touching
`project.yml`:

```sh
# ~/.zshrc
export BIKE_TEAM_ID=XXXXXXXXXX                    # Xcode → Settings → Apple Accounts → your team
export BIKE_BUNDLE_ID=com.<yourname>.bikecapture  # must be unique to your team
export BIKE_DEVICE="<your iPhone's name>"         # as shown by `xcrun devicectl list devices`
```

**Phone, once:** connect it by cable, tap **Trust**, and turn on Settings → Privacy & Security → **Developer
Mode**. After that first pairing, `devicectl` also works over Wi-Fi when the phone and the Mac are on the
same network.

**Build, install and launch from the terminal:**

```sh
cd apps/ios && xcodegen generate
xcrun devicectl list devices                       # the phone should show as available (paired)
xcodebuild -project BikeCapture.xcodeproj -scheme BikeCapture -configuration Debug \
  -destination "platform=iOS,name=$BIKE_DEVICE" -derivedDataPath build -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$BIKE_TEAM_ID" PRODUCT_BUNDLE_IDENTIFIER="$BIKE_BUNDLE_ID" build | xcbeautify
xcrun devicectl device install app --device "$BIKE_DEVICE" build/Build/Products/Debug-iphoneos/BikeCapture.app
xcrun devicectl device process launch --device "$BIKE_DEVICE" "$BIKE_BUNDLE_ID"
```

The first install from a free account still needs Settings → General → VPN & Device Management → **Trust**
on the phone. Free-account apps stop opening after 7 days; run the three commands again to renew.

**Copy captures off the phone without AirDrop.** Bikes live in the app's `Documents/Bikes/<id>/`:

```sh
xcrun devicectl device info files --device "$BIKE_DEVICE" --domain-type appDataContainer \
  --domain-identifier "$BIKE_BUNDLE_ID" --subdirectory Documents/Bikes
xcrun devicectl device copy from --device "$BIKE_DEVICE" --domain-type appDataContainer \
  --domain-identifier "$BIKE_BUNDLE_ID" --source Documents/Bikes/<id> --destination ~/Downloads/<name>
```

That folder holds `model.usdz`, `poses.json` and the HEIC `images/`. You can drop `model.usdz` straight onto the
viewer. For close-up photos, use the app's **Export capture bundle**: it adds the manifest and JPEG `photos/`.
Keep captures outside the repo.

## Testing

- **The Simulator cannot capture.** Object Capture needs the camera and LiDAR, which the iOS Simulator does not
  have (`ObjectCaptureSession.isSupported` is false there). The capture → build-model path can only be tested on
  a real Pro iPhone.
- **What the Simulator can test** is everything around capture: the library, the bike detail screen, record
  migration, the checklist state and **Export capture bundle**. The plan for that (roadmap: *iOS UI tests on the
  Simulator*):
  - add an XCUITest target in `project.yml`;
  - a `-UITestFixture` launch argument seeds `Documents/Bikes/` with a synthetic bike (a generated
    `model.usdz` + `poses.json` + a few images, from `tools/fixtures`);
  - tests drive library → detail → export and check the zip's manifest.

  It runs with:
  ```sh
  xcrun simctl list devices available          # pick an installed iPhone simulator
  xcodebuild test -project BikeCapture.xcodeproj -scheme BikeCapture \
    -destination "platform=iOS Simulator,name=<simulator name>" | xcbeautify
  ```
  It would also run in CI on `macos-15`, next to the existing build check.
- **On your iPhone**, the same XCUITests run with `-destination "platform=iOS,name=$BIKE_DEVICE"`, and they can
  reach the capture screen. Walking around a bike stays a manual test, documented in
  [docs/DEMO-CAPTURE.md](../../docs/DEMO-CAPTURE.md).

## Capturing a bike

1. Bike on a kickstand or work stand, plain matte floor, soft even light (overcast outdoors is ideal).
2. **+** → name it → **Object mode** (background removed automatically) or **Area mode** (no detection box; crop later in the viewer).
3. Fit the box to the bike, **Start capture**, walk slowly around it. Tap **Checklist** for the plan:
   three orbits (hub height, saddle height, top-down; each ticks itself when Object Capture
   completes a pass, or tap **Mark orbit done** if it does not) and close-ups of the fork crown,
   dropouts, rear derailleur and cockpit (tick them yourself). **Finish** stays available during
   capture; under 20 shots, the app asks you to confirm because reconstruction may fail.
4. **Build 3D model** (keep the app in the foreground; a few minutes).
5. **View in 3D / AR**, or **Export capture bundle** → AirDrop to your computer → drop the
   zip / `model.usdz` onto the web viewer to add areas and sales comments.

Shiny paint and chrome reconstruct poorly; a light dulling/scanning spray helps if allowed, as
does a polarizing filter and diffuse light. No turntable: on-device Object Capture tracks the
camera against the room, so the bike must stay still (a turntable set needs the Mac pipeline).

The exported zip also holds `photos/*.jpg`, 2048 px upright JPEG copies of the HEICs, so the web
viewer shows close-ups without decoding HEIC.

Status: written in a Linux cloud session and compiled in CI (`.github/workflows/ios.yml`);
not yet run on a device. See `docs/ARCHITECTURE.md` → Open questions.

For capture diagnostics, tap the shot counter to show the phase, total shots, Object Capture and
manual pass counts, and camera tracking state. On a connected device, stream the capture logs with:

```sh
log stream --predicate 'subsystem == "com.bike3dbrew.capture"'
```

If a capture fails or is cancelled after photos were taken, it remains in the library as a failed
record; **Build 3D model** can still reconstruct from its saved images.
