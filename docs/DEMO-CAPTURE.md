# Demo: capture a real bike and view it in 3D

From the iPhone app to the web viewer, step by step. It takes about an hour the first time: 30 minutes of setup,
15 minutes of capture, a few minutes for the phone to build the model, then the viewer.

**How capture works.** The app does not record a video. Apple's Object Capture takes photos **automatically**
while you walk slowly around the bike, and the phone builds the 3D model itself. Nothing is processed on a
server. Turning an ordinary video from any phone into 3D is not built yet; see
[the last section](#if-you-only-have-a-video).

**First time on a real device.** The app has only been compiled by CI so far. If a step fails, copy the exact
error into Claude Code or Codex in this repo ("the iOS app fails with: …") and the `ios-engineer` fixes it.

## What you need

- **An iPhone Pro with LiDAR** (12 Pro or any later Pro / Pro Max) on **iOS 18 or newer**. Object Capture
  needs LiDAR, so a non-Pro iPhone will not work.
- **A Mac with Xcode 16 or newer.** Xcode is free on the Mac App Store. It is about 10 GB, so start the download
  first.
- A **USB-C cable** for the first install, and your **Apple ID**. A free account works; a paid developer account
  is not needed.
- **A bike** on a kickstand or work stand, a plain matte floor, and soft, even light. An overcast day outdoors
  is ideal.

## 1. Install the app on your iPhone

1. **Install Xcode** from the Mac App Store and open it once. Accept the license, and install the **iOS** platform
   when it asks.
2. **Point the command-line tools at Xcode:**
   ```sh
   sudo xcode-select -s /Applications/Xcode.app
   ```
3. **Add your Apple ID** in Xcode → Settings → **Apple Accounts** (Xcode 27; "Accounts" in older versions) → **Sign In…**. If you cannot find it, the target's Signing & Capabilities → Team → **Add an Account…** does the same.
4. **Generate the project.** `xcodegen` is already installed on this Mac: `brew install xcodegen` otherwise.
   ```sh
   cd apps/ios
   xcodegen generate
   open BikeCapture.xcodeproj
   ```
5. **Signing:**
   - Click the **BikeCapture** target → **Signing & Capabilities**.
   - Tick **Automatically manage signing** and pick your **Personal Team** under Team.
   - If Xcode says the bundle identifier is taken, change `com.bike3dbrew.capture` to something unique, for
     example `com.<yourname>.bikecapture`.
6. **Prepare the iPhone:**
   1. Connect it by cable, unlock it and tap **Trust**.
   2. Turn on Settings → Privacy & Security → **Developer Mode**. The phone restarts; confirm when it is back.
7. **Run:** pick your iPhone in Xcode's device menu at the top, then press **⌘R**.
8. **First launch:** iOS blocks apps from a free account until you trust it, in Settings → General →
   **VPN & Device Management** → your Apple ID → **Trust**. Then open **Bike Capture** and allow camera access.

With a free Apple ID the app stops opening after **7 days**. Plug the phone in and press ⌘R again to renew it.

## 2. Capture the bike

**Before you start:**
- Put the bike on its kickstand or a work stand, in the middle of a space you can walk all the way around.
- Use a matte floor, with no mirrors or glass behind the bike.
- Use soft, even light: overcast outdoors, or a bright room with no hard shadows.
- Shiny paint and chrome come out poorly. A polarizing filter and diffuse light help; use a dulling spray only
  if the bike's owner agrees.
- **The bike must not move.** Object Capture tracks the phone against the room, so a turntable does not work.

**In the app:**
1. Tap **+** and give the bike a name.
2. Choose **Object mode**, which removes the background automatically. Use **Area mode** only if the app
   cannot find the bike; you then crop it later in the viewer.
3. Fit the box around the whole bike, including the wheels and the bars, then tap **Start capture**.
4. Walk **slowly** all the way around, holding the phone steady. Tap **Checklist** to see the plan:
   - **Three orbits**: one at hub height, one at saddle height, one from above. Each ticks itself when the pass
     completes and shows its shot count.
   - **Close-ups**: fork crown, dropouts, rear derailleur and cockpit. Tick these yourself.
5. Follow the on-screen hints ("move slower", "move closer"). A good capture has about **100–200 shots** in
   **10–15 minutes**.
6. Tap **Finish**, then **Build 3D model**. Keep the app open and in the foreground; it takes a few minutes.
7. Check the result with **View in 3D / AR**.

## 3. Get the capture onto your Mac

1. In the app, open the bike → **Export capture bundle**.
2. **AirDrop** it to your Mac. It lands in Downloads as `<name>.bikecapture.zip`. The zip holds `model.usdz`,
   `poses.json`, the photos and a manifest.

**Never commit the capture to this repo**, not even your own bike (AGENTS.md: generated fixtures only). Keep
it in Downloads or another folder outside the repo.

## 4. Let Claude or Codex check it (optional)

The model is already built on the phone, so there is nothing to process. An agent can sanity-check the bundle
and open it for you. In Claude Code (or Codex) in this repo, say:

> Check `~/Downloads/<name>.bikecapture.zip`: list its contents and manifest, start the viewer locally, open the
> bundle and tell me if anything looks wrong (orientation, size, missing textures, close-up photos). Do not copy
> the capture into the repo.

That covers the manual-step checks in [MANUAL-STEPS.md](MANUAL-STEPS.md): USDZ loads, upright, size in
meters, textures. Report anything odd and the agent turns it into a fix with a synthetic test fixture, never
with your capture.

## 5. Open it in the web viewer

1. Open the viewer at <https://davidpn11.github.io/bike-3d-brew/app/>, or locally with `bun run dev` →
   <http://localhost:5190>.
2. **Drag the `.bikecapture.zip` onto the page**, or use **Open…**. On the iPhone, open the viewer in Safari →
   **Open…** → Files → the zip.

   The capture stays in **your browser only** (it is cached, so a reload reopens it). Nothing is uploaded.
3. **Check the basics:** the bike stands upright, front to the right. If not, fix it in **Edit → Model**
   (Flip / Turn 180°). For an Area-mode capture, use **Edit → Model → Crop → Fit to bike**.
4. **Make it a demo:**
   1. In **Edit**, double-click a part to orbit around it, zoom toward the pointer, then **+ Save current view as
      area** (or **Set view** on an existing area).
   2. Tap the bike to pin comments.
   3. Fill in the **Spec sheet**.
5. Switch to **Present** and step through the areas. Open an area to see its close-up photos from the capture.

**Sharing a link** with someone else needs the scene published on a host. `node tools/publish-scene.mjs <zip>
--out <folder>` makes a folder you can upload. Ask before putting a real bike on the public GitHub Pages site.

## 6. Record the demo

- **The capture, on the iPhone:** Control Center → **Screen Recording**. Record steps 2.3–2.7: the box, the
  orbits, the checklist and the 3D preview.
- **The viewer, on the Mac:** press **⌘⇧5** → Record Selected Portion around the browser window.
- **A 2-minute script:**
  1. The capture: a 20-second time-lapse of walking around the bike.
  2. Drop the zip on the viewer: the bike appears without a background.
  3. Orbit, then double-click the rear derailleur.
  4. Present mode through 3–4 areas, with their comments and close-up photos.
  5. The customer view on a phone.
- A **turntable video** of the bike comes straight from the viewer: **Snapshot → 360° video**.

## If you only have a video

Turning an ordinary video (any phone, no LiDAR) into a model is planned but **not built yet**
([ROADMAP](../ROADMAP.md), Milestone 1.5: `ingest` and `reconstruct --backend object-capture`). On an Apple
silicon Mac like this one, the shortest path is:

1. Extract sharp frames with `ffmpeg`.
2. Run Apple's `PhotogrammetrySession` on the Mac.
3. Package the result with `tools/reconstruct/cli.mjs package` into the same `.bikecapture.zip`.

Ask the architect to build it ("build the video → 3D path on the Mac"). Until then, the iPhone app is the way to
get a real bike into the viewer.
