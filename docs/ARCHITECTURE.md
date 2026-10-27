# Architecture

```
 iPhone (LiDAR, iOS 18+)                         Browser (desktop / iPad / iPhone)
 ┌──────────────────────────────┐                ┌────────────────────────────────────────┐
 │ BikeCapture app              │  .bikecapture  │ Viewer / editor (three.js)             │
 │  ObjectCaptureSession        │  .zip, .usdz   │  load model (GLB / USDZ / PLY / demo)  │
 │   └ images/*.HEIC (+depth)   │ ─────────────▶ │  background: clear · green · studio    │
 │  PhotogrammetrySession       │   AirDrop /    │  areas = saved camera views            │
 │   └ model.usdz (masked)      │   Files        │  comments = pins on the surface        │
 │   └ poses.json               │                │  present mode · export bike.json       │
 └──────────────────────────────┘                └────────────────────────────────────────┘
```

## Why Object Capture instead of Wes Bos' room pipeline

`wesbos/3d-model-anything` records RoomPlan + LiDAR mesh + posed photos, then an AI agent
rebuilds the room in three.js. A bike is one object with thin tubes, spokes and cables, so we
use Apple's Object Capture: guided orbits, **automatic object masking** (the background is
removed during reconstruction; no green screen needed) and a textured USDZ. We keep Wes's
key idea of **posed photos**: `poses.json` tells us where each photo was taken, so the viewer
can show real close-up photos for an area (e.g. the fork crown) next to the 3D view.

Fallbacks when Object Capture struggles with a bike (thin spokes are the classic failure):
area mode + a crop box, or a gaussian splat (Scaniverse/Polycam/Luma) for photoreal paint.
The green background mode exists for compositing snapshots/videos in other tools.

## Contracts

### `bike-capture/1` (iOS export zip)

| Path            | Content |
| --------------- | ------- |
| `manifest.json` | `{ schema, name, createdAt, device, systemVersion, mode: "object"\|"area", model, poses, images, imageCount }` |
| `model.usdz`    | reconstruction, meters, +Y up |
| `poses.json`    | `{ schema: "bike-poses/1", samples: [{ sample, file, transform[16] }] }` (column-major camera→model) |
| `images/`       | Object Capture HEIC photos |
| `record.json`   | app-internal record |

Importing in the browser (`apps/web/src/scene/capture.ts`): dropping a `*.bikecapture.zip`
unzips it in memory with fflate; nothing is uploaded. The iOS exporter zips its staging folder
(`NSFileCoordinator .forUploading`), so files usually sit under one top-level directory: the
shallowest `manifest.json` defines the bundle root and `__MACOSX/` / `._*` entries are ignored.
Only `manifest.json`, the model and `poses.json` are decompressed (size-capped); images are just
listed. If `manifest.model` is missing, a `glb`/`gltf`/`usdz`/`ply` next to the manifest is used
(GLB first, e.g. after `tools/usdz-to-glb.py`). A broken `poses.json` is a warning, not an error.

The resulting scene gets a stable id (`capture-<name>-<createdAt digits>`) so dropping the same
bundle again restores its saved areas and comments, and a model URL `bundle:<zip name>/<path>`,
which is never fetched: it is resolved from memory or from the capture cache below, and only
when neither has it does the viewer ask for that zip to be dropped again.

### Capture cache (browser storage)

So a capture scene survives a reload, every successfully opened bundle is kept in the browser
(`apps/web/src/scene/captureCache.ts`, pure logic; `apps/web/src/storage/backends.ts`, storage):

- **What**: the model bytes, `manifest.json`, `poses.json` and the image list. Lazily extracted
  files (photos, thumbnails) can be added to an entry later (`putFile`) and are evicted with it.
  The zip itself is not kept (HEIC photos make it hundreds of MB).
- **Where**: OPFS (`navigator.storage.getDirectory()`, folder `bike-captures/`, flat
  percent-encoded file names), falling back to IndexedDB (`bike-3d-brew` / `files`) when OPFS is
  missing, has no `createWritable()` (older Safari) or refuses a probe write. Neither → no cache,
  the old "drop the zip again" behavior. `navigator.storage.persist()` is requested once per page
  load, on the first store.
- **Keys**: one entry per `bundle:` model URL; files live under `cap-<slug>-<fnv1a(url)>/…` and an
  `index.json` lists entries (validated on read). An entry remembers the scene id it was opened
  as, so a different bike exported with the same zip filename never loads the wrong model.
- **Budget**: LRU by last use, `min(500 MB, 50% of the quota − other usage)` from
  `navigator.storage.estimate()`. A bundle larger than the whole budget is simply not cached.
- **Failure**: every call is best effort. Any storage error leaves the app as if the cache did
  not exist; entries whose files vanished (browser eviction) are dropped from the index.
- **UI**: "Open…" becomes a small menu once something is stored: "Choose a file…" plus the stored
  captures (name, size, × to forget).

### `bike-scene/1` (viewer JSON, `*.bike.json`)

See `apps/web/src/scene/schema.ts`. A scene references its model by URL (relative to the
scene file), lists **hotspots** (named camera views: the zoomable areas) and **annotations**
(surface point + normal, title, body, kind `feature|spec|upgrade|note`, optional price and area).
All coordinates are in model-root space.

### Photo close-ups

For the active area (its view target, preferring cameras on the side its saved view looks from),
the active comment (its pin, preferring cameras in front of its surface normal) and each Present
step, the viewer shows a filmstrip of the capture photos that best show that point; tapping one
opens a full-screen viewer (arrows / swipe, pinch / wheel / double-tap zoom, Esc).

- **Spaces.** A pose is a column-major camera→reconstruction matrix, camera looking down -Z,
  +Y up. Scene positions are in model-root space. `Viewer.setModel` adds `centerOnGround(object)`
  to the model root, so `modelRoot ⟵ reconstruction` is the loaded object's local matrix (the
  centering shift plus any root transform the loader applied) times the identity wrapper:
  `src/viewer/captureSpace.ts`. The scene's `model.rotation/scale/offset` sit on the model root
  itself and never enter the mapping. A unit test runs the fixture USDZ through three's
  `USDLoader` + `centerOnGround` and checks the expected close-ups win.
- **Ranking** (`src/scene/photos.ts`, pure): keep photos whose frustum contains the target
  (assumed iPhone wide camera, 65° × 51°, landscape sensor; poses carry no intrinsics), drop
  cameras behind the surface (`side` hint), score `0.45·centered + 0.35·closeness + 0.2·facing`
  (closeness relative to the nearest usable photo, so units do not matter), and skip near-duplicate
  viewpoints. Occlusion is not tested.
- **Photos** (`src/ui/photoLibrary.ts`): extracted one at a time from the dropped zip via its
  central directory (`src/scene/zipIndex.ts`: the `File` stays on disk, nothing else is inflated),
  decoded natively (`createImageBitmap`, then `<img>`; Safari reads HEIC), else HEIC goes to a
  module worker that lazily loads libheif (`libheif-js`, WASM, ~2 MB, LGPL-3.0, only fetched when a
  HEIC photo is shown). Results are downscaled to JPEG (360 px thumbnails, 2048 px full) and added
  to the capture cache entry, so after a reload the photos already seen still show without the zip.

## Open questions (verify on device)

- Does `PhotogrammetrySession.Poses` return camera→model transforms in the same frame as the
  USDZ? (Assumed, and the photo close-ups depend on it; validate by checking that an area's top
  close-up really shows that area on a real capture.)
- Does three.js `USDZLoader` read Object Capture USDZ (binary USDC)? Otherwise convert to GLB.
- Bike size vs. Object Capture's bounding box limits: area mode is the fallback.
