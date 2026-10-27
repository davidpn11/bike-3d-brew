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

### USDZ loading (`apps/web/src/viewer/usd/`)

Object Capture writes a USDZ whose root layer is **binary USDC (crate)**: one baked triangle
mesh, indexed face-varying `primvars:st` and normals, a `UsdPreviewSurface` fed by
`UsdUVTexture` PNGs in `0/` (diffuse, normal with scale 2 / bias -1, occlusion),
`metersPerUnit = 1`, `upAxis = "Y"`.

three.js r186 can read this: `USDLoader` (the old `USDZLoader` is a deprecated alias) has a crate
parser with LZ4 + integer decoding (`usd/USDCParser.js`) and a composer that handles xforms,
GeomSubsets, indexed/face-varying primvars, UsdPreviewSurface textures, `metersPerUnit` and Z-up.
We reuse those parsers and patch what fails on real-world files:

- `crate.ts` (`CrateParser`): values the crate stores **inline** that r186 misreads: small integral
  `double2/3/4` and `half3/4` (packed int8, e.g. `xformOp:translate = (0, 0, 5)` became a number and
  crashed the transform), negative `int`, `half`; plus scalar `half3/4`, `quath`, `int4`, `matrix2d/3d`.
- `composer.ts` (`FastUSDComposer`): typed-array fast path for all-triangle meshes. Stock three took
  ~1.4–2.2 s to build a 1M-triangle mesh (JS arrays per index); this takes ~0.2 s, same output.
- `usdz.ts` (`loadUsd`): unzips only USD layers and images, takes the first layer as root (falls back
  to the first USD layer anywhere), composes, waits for textures (blob URLs created and revoked by
  three per image), halves three's normal-map strength for the standard scale 2 / bias -1 decode,
  and reports undecodable textures as warnings instead of failing.

Measured on a synthetic 23 MB USDZ (972k triangles, 2048² texture; `tools/fixtures/make-usdc.py
--detail 90 --tex 2048`), Chromium: unzip 16 ms, parse 183 ms, build 206 ms, textures 24 ms. Parsing
stays on the main thread: a worker would save the ~0.2 s parse but pay ~0.07 s structured-clone of
the spec table back, and the build step needs three.js objects on the main thread anyway. The USD
code (~70 KB min) is a lazy chunk loaded on the first USDZ. Anything that still fails shows an error
pointing to `tools/usdz-to-glb.py`. Fixtures are synthetic (`apps/web/test/fixtures/README.md`).

### `bike-scene/1` (viewer JSON, `*.bike.json`)

See `apps/web/src/scene/schema.ts`. A scene references its model by URL (relative to the
scene file), lists **hotspots** (named camera views: the zoomable areas) and **annotations**
(surface point + normal, title, body, kind `feature|spec|upgrade|note`, optional price and area).
All coordinates are in model-root space.

## Open questions (verify on device)

- Does `PhotogrammetrySession.Poses` return camera→model transforms in the same frame as the
  USDZ? (Assumed; validate by projecting a pin into the matching photo.)
- ~~Does three.js read Object Capture USDZ (binary USDC)?~~ Yes, with the fixes above, verified on
  synthetic Object-Capture-like files. Still to confirm on a real capture (docs/MANUAL-STEPS.md).
- Bike size vs. Object Capture's bounding box limits: area mode is the fallback.
