# Performance

Targets (from [GOALS.md](GOALS.md)): first model visible in **< 3 s** on iPhone Safari over 4G for a
20 MB model, **60 fps** orbiting with **50 pins**, and **low battery use when idle**.

## What the viewer does

| Area | What | Where |
| --- | --- | --- |
| Render on demand | The animation loop runs only while something changes (controls input and damping, a fly-to, a model / background / pin / size change). An idle stage draws **0 frames**; a hidden tab stops the loop. | `viewer/renderScheduler.ts`, `Viewer.requestRender()` |
| Cached shadows | The sun and the model stand still while the camera orbits, so the shadow map is redrawn only when the scene changes, not for camera frames (that pass re-draws every triangle of the model). | `Viewer` (`shadowMap.autoUpdate = false`) |
| No preserved drawing buffer | The canvas keeps its last frame while idle anyway; `screenshot()` renders right before reading. Saves a full-screen copy per frame on tile-based phone GPUs. | `Viewer` |
| Device-aware quality | Pixel ratio ≤ 2 (phones show no gain at 3×, which shades 2.25× the pixels), 1.5 on phones for captures over 400k triangles; MSAA only at 1× (2× already supersamples); 1024² hard shadows on phones, 2048² soft on desktop. `?quality=low` (1×, 512² shadows) and `?quality=high` (up to 3×, MSAA) override. | `viewer/quality.ts` |
| Welded USDZ meshes | three expands face-varying primvars to three vertices per triangle; identical corners are merged back into an indexed mesh (O(n) open-addressing hash over typed arrays, bit-exact). | `viewer/weld.ts`, `usd/usdz.ts` |
| BVH raycasts | After the first frame of a model, meshes over 5k triangles get a [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) hierarchy, built in a worker for big meshes (copies, never transfers, so the geometry stays usable; indirect, so the GPU index buffer is untouched). Picking and pin occlusion use it. | `viewer/bvh.ts`, `bvhImpl.ts`, `bvh.worker.ts` |
| Pins | Projection into a scratch object against a cached viewport size (no layout reads), transform-only writes for pins that moved, an `offscreen` class for pins behind the camera or off the stage, occlusion raycasts under a 3 ms per-frame budget that continue on idle animation frames (without re-rendering) until every visible pin is current. Skipped until the BVH exists for big models. | `viewer/pins.ts` |
| Lazy, self-hosted decoders | A GLB's `extensionsUsed` decides which decoder is imported: Meshopt (~26 KB JS with inline WASM), Draco (glTF build, ~190 KB WASM, workers), KTX2/Basis (~530 KB WASM, workers). three's loaders resolve the files with `new URL(…, import.meta.url)`, so Vite ships them in `dist/assets/`; nothing comes from a CDN. Plain GLBs fetch none. | `viewer/loaders.ts`, `viewer/gltfInfo.ts` |

Rule for new code: anything that changes what the canvas shows outside the `Viewer` methods
(a new scene object, a material tweak, clipping planes) must call `viewer.requestRender()`, or the
change appears only on the next camera move.

## Optimizing a capture

`tools/optimize-glb.mjs` turns a GLB (for a USDZ capture, first `tools/usdz-to-glb.py`) into a
phone-friendly one with [glTF Transform](https://gltf-transform.dev/):

```sh
node tools/optimize-glb.mjs model.glb model-phone.glb                    # dedup + weld + Meshopt
node tools/optimize-glb.mjs model.glb model-phone.glb --simplify 0.5     # also halve the triangles
node tools/optimize-glb.mjs model.glb model-phone.glb --compress draco   # Draco instead of Meshopt
node tools/optimize-glb.mjs model.glb model-phone.glb --textures webp --max-texture 2048
node tools/optimize-glb.mjs model.glb model-phone.glb --textures ktx2    # needs KTX-Software's toktx
```

- **Meshopt** (default) decodes fastest and has the smallest decoder; **Draco** compresses geometry
  harder but costs a ~190 KB WASM download and slower decoding.
- `--simplify <ratio>` (meshoptimizer's simplifier, `--error` as a fraction of the mesh radius,
  default 0.001) is the decimation step for phones: Object Capture's `.full` detail is far more than a
  6" screen shows.
- `--textures webp|--max-texture` use sharp (installed with glTF Transform). `ktx2` (ETC1S) keeps
  textures compressed in GPU memory (a 4096² texture: 64 MB as RGBA8, 8–16 MB transcoded to ETC2, ASTC or BC7), the
  biggest memory win on phones, and needs `toktx` on PATH.

## Measuring

```sh
npm run build
node tools/bench/bench.mjs --skip-build [--model big.usdz] [--pins 50] [--viewport 390x844] [--out result.json]
# big.usdz: tools/fixtures/make-usdc.py object-capture big.usdz --detail 90 --tex 2048 (needs usd-core)
```

The script serves `dist/` with `vite preview`, drives Chromium on SwiftShader (like the E2E suite)
through the `?e2e` test hook and prints JSON: boot time, a synchronous **frame cost** (render + a
1-pixel readback that waits for the GPU), renders while idle and while orbiting with the mouse
(with and without 50 pins), pin-update time per frame, and for `--model`: time until the first frame
with the model, geometry size, JS heap, frame cost and the cost of one `pick()` / `isOccluded()`.

SwiftShader renders on the CPU, so absolute numbers are far from a phone GPU and swing with machine
load: compare runs made back to back on the same machine, and read render counts and per-operation
costs rather than fps.

## Results

Chromium + SwiftShader, 1280×800 at 1×, on a shared 4-core container under heavy load (other jobs
running): treat absolute times as noisy, compare before/after. `tools/bench/bench.mjs --model big.usdz`
(synthetic 23 MB USDZ, 972k triangles, 2048² textures), base branch vs. this change:

| Metric | Before | After |
| --- | --- | --- |
| Demo, idle stage: renders in 3 s | 8 (every frame) | **0** |
| Demo with 50 pins, idle: renders in 3 s | 5 | **0** |
| Big capture: vertices / geometry memory | 2,916,000 / 89 MB | **490,148 / 26 MB** |
| Big capture: JS heap after load | 271 MB | **104–123 MB** |
| Big capture: one `pick()` | 179 ms | **0.07 ms** |
| Big capture: one `isOccluded()` | 221 ms | **0.02 ms** |
| Big capture: pin update per frame (50 pins) | 873 ms | **2 ms** |
| Big capture: full frame cost (render + GPU sync) | 3776 ms | 2978–3038 ms (no shadow pass on camera frames) |
| Big capture: first frame with the model | 3357 ms | 2466–4113 ms (noise; adds weld, BVH moved after first frame) |

Weld cost: ~0.2 s for 3M vertices in Node on an idle core (unrolled position/normal/uv path), BVH
build ~1 s, now in a worker. Real-device numbers are still to be taken (see Known gaps).

## Known gaps

- Not yet measured on a real iPhone (ROADMAP: "Measure on a real iPhone").
- Parsing and welding a big USDZ still run on the main thread (~1 s together for 1M triangles on a
  desktop CPU, more on a phone); ROADMAP "Progressive capture loading".
- No runtime decimation: phones get the full capture unless it went through `optimize-glb --simplify`.
- The Basis transcoder path is not exercised in CI (the KTX2 fixture is uncompressed RGBA8, since Node
  has no Basis encoder); its files are built and served like Draco's.
