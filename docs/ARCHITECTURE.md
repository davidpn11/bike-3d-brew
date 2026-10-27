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
which is never fetched: after a reload the viewer asks for that zip to be dropped again.

### `bike-scene/1` (viewer JSON, `*.bike.json`)

See `apps/web/src/scene/schema.ts`. A scene references its model by URL (relative to the
scene file), lists **hotspots** (named camera views: the zoomable areas) and **annotations**
(surface point + normal, title, body, kind `feature|spec|upgrade|note`, optional price and area).
All coordinates are in model-root space.

**Model transform.** The loader wraps the model so its native bounding box is centered on X/Z
and rests on y = 0 (`centerOnGround`, deterministic per file); that frame is *model-root space*.
`model.scale`, `model.rotation` (Euler XYZ, three.js convention) and `model.offset` are then
applied to the root as `world = offset + R · (scale · p)`. Annotations and hotspot views stay in
model-root space, so re-orienting a capture never detaches a comment. The overview camera is
framed in world space (camera up is world +Y) and converted back.

**Crop box** (`crop?: { min, max, enabled }`, model-root space, optional and lenient: a
malformed crop is dropped, swapped corners are reordered). The viewer turns it into six world
clipping planes on the model's own materials (local clipping, shadows clipped too), recomputed only
when the model transform or the box changes. Raycasts skip hits outside the box (no comments on
cropped-away parts, no occlusion by them), pins outside it are hidden, and exact bounds (framing,
on-ground, auto-orient samples) only count kept vertices. Edit mode shows the box with one handle
per face (`viewer/cropBox.ts`): pointer events in the capture phase, so mouse and touch drags never
orbit the camera; the face moves along its axis to the point nearest the pointer ray, clipping
live, and the store is updated once on release. "Fit to bike" (`scene/crop.ts`, pure) samples
points along triangle edges, cuts above the floor slab (a dense, wide band in the lower third of
the up axis) and keeps the largest 26-connected voxel cluster with a 2% margin. Area-mode captures
get that box pre-computed but disabled, a hint in the toast, and auto-orient waits until the crop
is on. Turning the crop on/off or fitting it re-grounds the visible part.

**Auto-orient** (`apps/web/src/scene/orient.ts`, pure, unit-tested). Target frame: +X front,
+Y up, +Z drive side, tyres on y = 0. Up to 50k strided vertices (≈3 ms for 1M vertices):

1. PCA: smallest-variance axis = the bike's width, middle axis = candidate up.
2. Up sign by votes: the centroid sits below mid-height (wheels), and the top band (handlebar) is
   wider across than the bottom band (two tyre contact patches).
3. Ground line: the longest downward-facing edge of the side-view convex hull (tangent across
   both tyres) fixes the 5–15° tilt PCA leaves.
4. Object Capture output is gravity-aligned, so if that up is within 6° of ±Y, Y is kept exactly
   and only yaw changes (horizontal PCA).
5. Front sign: the wide handlebar sits ahead of centre (plus a small vote for the drivetrain mass
   behind it). Drive side follows from the right-handed frame.

It runs once when a scene is opened with a non-demo model, no comments and no `model.rotation`
(`shouldAutoOrient`); the offset is then recomputed from exact bounds so the bike stands on the
ground. Edit → Model exposes the result plus manual rotate/flip/scale/nudge, each one store
update with a small undo stack. Generate tilted test bundles with
`node tools/fixtures/make-bike-capture.mjs --rotate 70,25,-40` (ASCII USD mesh in `model.usdz`).

## Open questions (verify on device)

- Does `PhotogrammetrySession.Poses` return camera→model transforms in the same frame as the
  USDZ? (Assumed; validate by projecting a pin into the matching photo.)
- Does three.js `USDZLoader` read Object Capture USDZ (binary USDC)? Otherwise convert to GLB.
- Bike size vs. Object Capture's bounding box limits: area mode is the fallback.
