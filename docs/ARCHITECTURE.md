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

### `bike-scene/1` (viewer JSON, `*.bike.json`)

See `apps/web/src/scene/schema.ts`. A scene references its model by URL (relative to the
scene file), lists **hotspots** (named camera views: the zoomable areas) and **annotations**
(surface point + normal, title, body, kind `feature|spec|upgrade|note`, optional price and area).
All coordinates are in model-root space.

## Open questions (verify on device)

- Does `PhotogrammetrySession.Poses` return camera→model transforms in the same frame as the
  USDZ? (Assumed; validate by projecting a pin into the matching photo.)
- Does three.js `USDZLoader` read Object Capture USDZ (binary USDC)? Otherwise convert to GLB.
- Bike size vs. Object Capture's bounding box limits: area mode is the fallback.
