# Photos & video → 3D: reconstruction options for bikes

> "We can have the best 3D experience, but if it doesn't come from a collection of photos and
> videos of a bike, it's not useful." (owner)

Goal: **any photo set or video of a bike (any camera) → a `bike-capture/1` bundle the viewer
opens**: a model (GLB preferred), `poses.json`, `images/` and `manifest.json`. Today the only
producer is the iOS Object Capture app.

**Status of the facts below (2026-10-27).** This first pass comes from the author's own knowledge
of these tools. It was **not** re-checked against vendor pages in this session because the budget
was cut short. Prices, limits and terms of cloud services change often: check each `verify:` item
before anyone commits money or customer photos. What was checked in the sandbox: Ubuntu 24.04
ships `colmap 3.9.1` in `universe` (`apt-get install colmap` works, CPU build without CUDA). There
is no Docker daemon and no GPU here, so OpenMVS and dense reconstruction were not run.

## Why bikes are hard

| Property | Effect on photogrammetry | Mitigation |
| --- | --- | --- |
| Thin parts (spokes ~2 mm, cables, chain) | Few pixels wide, so few features. Dense MVS fills them in or drops them. Meshes come out with webbed wheels or no spokes. | Close passes at the wheels; accept "disc" wheels or model spokes procedurally later; splats handle them better than meshes. |
| Glossy / metallic paint, chrome | Highlights move with the viewpoint, which breaks feature matching and creates holes and bumps. | Diffuse, overcast-like light (softboxes, cloudy day, shade); polarizer; dulling / 3D-scanning spray (AESUB Blue vanishes in about 4 h) on matte-safe parts only, never without the shop's OK. |
| Black tyres, black carbon | Low texture, so few features. | More light; textured backdrop and floor so the camera poses still solve. |
| Size ~1.7 × 1 m, open structure | Background visible through the frame; masking matters. | Plain backdrop or a turntable; object masking (Object Capture does it, COLMAP does not). |
| Symmetric sides | Matching can confuse the left and right sides. | Overlapping rings, top-down ring, markers/props on the floor. |

## Options

| Option | Input | Runs on | Thin parts | Gloss | Output | Cost | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Apple Object Capture** (`PhotogrammetrySession`, RealityKit) | Any folder of JPEG/HEIC/PNG (not only iPhone photos); depth and gravity help if present | macOS 12+ (detail levels `.reduced` … `.raw`; Apple silicon or a Mac with a capable GPU), iOS 17+ on device | Fair; better with close passes | Fair | USDZ (textured), poses via `.poses` request (macOS 14 / iOS 17+), automatic object masking | Free with a Mac | **Default** |
| **COLMAP** (SfM + MVS) + **OpenMVS** (densify, mesh, refine, texture) | Any images; video via frames | Linux/macOS/Windows; Docker; SfM fine on CPU; COLMAP dense *needs* CUDA, OpenMVS dense runs on CPU (slow: tens of minutes to hours for 150 × 12 MP) | Poor to fair | Poor | PLY/OBJ + texture; camera poses (`cameras/images/points3D`) | Free (BSD / AGPL for OpenMVS) | **Fallback** (Linux, server, no Mac) |
| **Meshroom / AliceVision** | Images | Linux/Windows, CUDA needed for depth maps | Poor to fair | Poor | OBJ + texture | Free (MPL2) | Worse than COLMAP + OpenMVS for automation; skip |
| **Gaussian splatting** (nerfstudio `splatfacto`, gsplat, Postshot; apps: Polycam, Luma, Scaniverse, KIRI Engine) | Video or images, plus SfM poses (COLMAP) | NVIDIA GPU for training (minutes); phone apps do it in the cloud or on device (Scaniverse) | **Good** (looks right, not a clean mesh) | **Good** (view-dependent color) | `.ply` / `.spz` splats; no clean mesh | Free (open source) / app plans | **Photoreal option**: needs splat viewer support (ROADMAP M6) |
| **Cloud photogrammetry APIs**: KIRI Engine API (photo scan + 3DGS), Luma API, Polycam, RealityCapture / RealityScan (Epic) | Upload photos/video | Vendor cloud / Windows desktop | Varies | Varies | GLB/OBJ/USDZ/PLY | Per-scan credits or seat plans. verify: current price per model, upload limits (images, video length, resolution), commercial-use and data-retention terms, whether customer photos may train their models | Good for "no Mac, no GPU"; needs account + budget + terms review |
| **AI image-to-3D**: TRELLIS (Microsoft, MIT), Hunyuan3D 2.x (Tencent), Tripo, Meshy | 1–4 photos | GPU (open models) or SaaS | **Invents** geometry | Invents | GLB | Free / SaaS credits | Not for a sales model of *this* bike. OK for placeholders, catalog thumbnails or "illustrative" models clearly labeled as such |

Notes:

- Object Capture is the only option with **automatic object masking** built in, which matters for
  the "background-free" goal. With COLMAP the bundle needs masking (rembg / U²-Net on the
  photos before MVS, or cropping the mesh to the dominant cluster after).
- `PhotogrammetrySession` takes a folder URL of images from any camera. EXIF focal length helps.
  Depth and gravity metadata (iPhone LiDAR HEIC) improve scale and orientation. Without them the
  scale is arbitrary and the model may come out tilted, so auto-orient (ROADMAP M2) becomes required.
- COLMAP poses are world→camera with OpenCV axes (+X right, +Y down, +Z forward). The viewer
  wants camera→model with camera looking down -Z, +Y up. So:
  `T_c2w = inverse([R|t]) = [Rᵀ | -Rᵀt]`, then flip the camera's Y and Z axes:
  `pose = T_c2w · diag(1, -1, -1, 1)`. COLMAP quaternions are `QW QX QY QZ` (Hamilton,
  world→camera).
- Splats need a viewer path (Spark / `@sparkjsdev/spark`) and a crop box; pins and areas still work
  because they only need a surface to raycast against (a proxy mesh or splat-depth picking).

## Recommendation

1. **Default: Object Capture on a Mac** (`tools/reconstruct/macos/` Swift CLI over an image folder,
   then package to `bike-capture/1` with `poses.json` from the `.poses` request). It is free, gives the
   best masked, textured mesh for this object class, and works with photos from any camera and
   with frames pulled from a video. Detail `.full` for the web (then GLB + decimate), `.raw` only for archiving.
2. **Fallback: COLMAP + OpenMVS in Docker** (Linux / CI / a rented GPU box) for when no Mac is
   available: same `ingest` → `reconstruct` → `package` flow, plus mesh cropping to the bike.
   Expect worse wheels and paint.
3. **Photoreal later: Gaussian splats** from the same video (COLMAP poses + gsplat/nerfstudio, or
   Polycam/Luma/Scaniverse export) once the viewer loads `.spz`/`.ply` splats.
4. **Cloud API** only after the owner picks a vendor, a budget and accepts its data terms.
5. **AI image-to-3D**: never as "the bike". Only for placeholders, clearly labeled.

## Capture protocol (photos)

- **Setup**: bike on a stand or a turntable, wheels off the ground or the kickstand hidden; plain
  matte backdrop that differs from the paint; textured floor or newspaper so the poses solve;
  soft, even light (two softboxes at 45°, or overcast outdoors), no direct sun, no flash.
- **Camera**: any camera ≥ 12 MP; fixed zoom (no zooming between shots); f/8–f/11 for depth of
  field; ISO as low as possible; shutter ≥ 1/125 s handheld (tripod: anything); lock focus and
  exposure per ring; RAW+JPEG or high-quality JPEG; no portrait mode or beauty filters.
- **Shots: 120–200** total, 70–80 % overlap between neighbors:
  - Ring 1, hub height (~0.35 m), distance ~1.5–2 m: 36–48 shots (every 7.5–10°).
  - Ring 2, saddle height (~0.9 m), looking slightly down: 36–48 shots.
  - Ring 3, high (~1.6 m), looking down at 45°: 24–36 shots.
  - Close-ups (0.4–0.6 m), 4–6 shots each, overlapping each other: drivetrain (both sides of the
    rear derailleur, chainring), fork crown and dropouts, cockpit (bar, stem, shifters), saddle and
    seat clamp, each wheel hub and a sector of spokes from both sides.
- **Turntable vs walk-around**: turntable with a fixed camera is fastest and steadiest, but the
  background must stay out of frame or be masked (static background + rotating bike confuses SfM).
  Walk-around works anywhere and is better for the floor features. Object Capture handles both.
- **Reflective paint**: polarizer on the lens (and ideally on the lights), more diffuse light, or a
  removable dulling spray if the shop agrees. Record which one you used in the manifest notes.

## Capture protocol (video)

- **4K (3840×2160) at 30 fps**, or 60 fps if the light allows a fast shutter; HEVC or H.264,
  **not** HDR / Dolby Vision (tone mapping varies between decoders); lock exposure and focus;
  stabilization on; no zooming.
- **Shutter speed ≥ 1/250 s** (set it in a pro camera app such as Blackmagic Camera; the stock iOS app
  picks it automatically), otherwise motion blur kills features on spokes and cables.
- **Slow orbit**: about 60–90 s per ring (≈ 4–6°/s), three rings as above, then slow passes over
  the close-up areas. 3–5 minutes of footage in total.
- The `ingest` step extracts frames, keeps the sharpest frame per short time window (variance of the
  Laplacian) and only adds a frame when the view has changed enough, aiming for 80–200 frames.

## Pipeline (planned shape: `tools/reconstruct/`)

```
ingest      photos/ and/or videos → frames/ (sharp, deduplicated, EXIF-upright JPEG ≤ 3000 px) + coverage report
reconstruct --backend object-capture|colmap   frames/ → model + camera poses
package     → bike-capture/1 zip: model.glb (or .usdz), poses.json (viewer convention), images/*.jpg, manifest.json
            (source: "photos"|"video", backend), optional mesh crop to the dominant object
```

Status and the next steps are in [ROADMAP.md](../ROADMAP.md) (Milestone 1.5). For the commands to try
COLMAP on Linux today (a CPU-only sparse model, enough to check the poses):

```sh
sudo apt-get install colmap ffmpeg            # Ubuntu 24.04: colmap 3.9.1
ffmpeg -i bike.mp4 -vf "fps=2,scale=1920:-2" frames/%05d.jpg
colmap automatic_reconstructor --workspace_path work --image_path frames --dense 0 --use_gpu 0
colmap model_converter --input_path work/sparse/0 --output_path work/sparse_txt --output_type TXT
```

For a dense textured mesh use OpenMVS (`InterfaceCOLMAP` → `DensifyPointCloud` → `ReconstructMesh`
→ `RefineMesh` → `TextureMesh`) from its Docker image, or COLMAP's dense steps on a CUDA machine.

## Owner decisions

See [MANUAL-STEPS.md](MANUAL-STEPS.md#photos--video--3d). In short: a Mac (Apple silicon) for the default path;
whether to pay for a cloud API (which vendor, monthly budget, OK with its data terms for
customer bikes); a GPU box (rented or owned) for COLMAP dense / splats; whether dulling spray is
acceptable on customer bikes.
