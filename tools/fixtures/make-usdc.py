"""Generate synthetic, Object-Capture-like USDZ files for tests and benchmarks.

Apple Object Capture writes a USDZ whose root layer is binary USDC (crate), with one baked,
triangulated mesh, indexed face-varying UVs and normals, a UsdPreviewSurface material fed by
UsdUVTexture images (diffuse, normal, ambient occlusion) stored next to the layer in a `0/`
folder, metersPerUnit = 1 and upAxis = Y. This script builds the same structure around a
procedural "bike" (two wheels + frame tubes), so nothing here comes from a real capture.

Needs Pixar USD (`pip install usd-core pillow numpy`). Usage:

    python tools/fixtures/make-usdc.py object-capture apps/web/test/fixtures/object-capture-like.usdz
    python tools/fixtures/make-usdc.py zup-subsets  apps/web/test/fixtures/zup-cm-subsets.usdz
    python tools/fixtures/make-usdc.py object-capture big.usdz --detail 90 --tex 2048   # ~23 MB benchmark

Output is deterministic for given arguments.
"""

from __future__ import annotations

import argparse
import io
import os
import shutil
import sys
import tempfile

import numpy as np
from PIL import Image
from pxr import Gf, Sdf, Usd, UsdGeom, UsdShade, UsdUtils, Vt


# --- geometry ---------------------------------------------------------------------------------
# Each part is a parametric surface (u, v) ∈ [0,1]² → xyz, tessellated to triangles. Parts get
# their own UV island in a 2×2 atlas, like a baked photogrammetry texture.


def torus(center, major, minor, nu, nv):
    def f(u, v):
        a, b = u * 2 * np.pi, v * 2 * np.pi
        r = major + minor * np.cos(b)
        # Wheel plane is XY (bike faces +X, stands on y = 0).
        return np.stack([center[0] + r * np.cos(a), center[1] + r * np.sin(a), center[2] + minor * np.sin(b)], -1)

    return f, nu, nv


def tube(p0, p1, radius, nu, nv):
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    axis = p1 - p0
    axis_n = axis / np.linalg.norm(axis)
    ref = np.array([0.0, 0.0, 1.0]) if abs(axis_n[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    e1 = np.cross(axis_n, ref)
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(axis_n, e1)

    def f(u, v):
        a = v[..., None] * 2 * np.pi
        return p0 + u[..., None] * axis + radius * (np.cos(a) * e1 + np.sin(a) * e2)

    return f, nu, nv


def bike_parts(detail: int):
    wheel_r, tire = 0.34, 0.018
    rear, front = (-0.5, wheel_r + tire, 0.0), (0.52, wheel_r + tire, 0.0)
    bb, seat, head_top, head_bot = (-0.02, 0.33, 0), (-0.15, 0.85, 0), (0.42, 0.82, 0), (0.45, 0.7, 0)
    n = detail
    return [
        torus(rear, wheel_r, tire, 12 * n, 2 * n),
        torus(front, wheel_r, tire, 12 * n, 2 * n),
        tube(bb, seat, 0.017, 2 * n, n),  # seat tube
        tube(seat, head_top, 0.015, 2 * n, n),  # top tube
        tube(bb, head_bot, 0.02, 2 * n, n),  # down tube
        tube(head_bot, front, 0.012, 2 * n, n),  # fork
        tube(bb, rear, 0.011, 2 * n, n),  # chain stay
        tube(seat, rear, 0.010, 2 * n, n),  # seat stay
    ]


def tessellate(parts):
    """Welded points + per-corner (face-varying) indexed UVs and normals, all triangles."""
    points, normals, uvs, faces, uv_faces = [], [], [], [], []
    p_off = uv_off = 0
    for i, (f, nu, nv) in enumerate(parts):
        island = np.array([(i % 4) * 0.25, (i // 4) * 0.5])  # 4×2 atlas
        u, v = np.meshgrid(np.linspace(0, 1, nu + 1), np.linspace(0, 1, nv + 1), indexing="ij")
        xyz = f(u, v)
        # Normals by central differences on the closed (u, v) grid.
        du = np.roll(xyz, -1, 0) - np.roll(xyz, 1, 0)
        dv = np.roll(xyz, -1, 1) - np.roll(xyz, 1, 1)
        nrm = np.cross(du, dv)
        nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True) + 1e-12
        # Weld the seam (last row/col duplicates the first) for points, keep it for UVs: this is
        # exactly why scans need face-varying UVs.
        pts = xyz[:nu, :nv].reshape(-1, 3)
        nrm = nrm[:nu, :nv].reshape(-1, 3)
        st = np.stack([island[0] + 0.02 + u * 0.21, island[1] + 0.02 + v * 0.46], -1).reshape(-1, 2)
        pid = lambda a, b: p_off + (a % nu) * nv + (b % nv)  # noqa: E731
        tid = lambda a, b: uv_off + a * (nv + 1) + b  # noqa: E731
        for a in range(nu):
            for b in range(nv):
                q = [(a, b), (a + 1, b), (a + 1, b + 1), (a, b + 1)]
                for tri in ((0, 1, 2), (0, 2, 3)):
                    faces.append([pid(*q[k]) for k in tri])
                    uv_faces.append([tid(*q[k]) for k in tri])
        points.append(pts)
        normals.append(nrm)
        uvs.append(st)
        p_off += len(pts)
        uv_off += len(st)
    return np.concatenate(points), np.concatenate(normals), np.concatenate(uvs), np.array(faces), np.array(uv_faces)


# --- textures ---------------------------------------------------------------------------------


def diffuse_png(size: int) -> bytes:
    y, x = np.mgrid[0:size, 0:size] / size
    palette = np.array([[40, 40, 44], [40, 40, 44], [200, 40, 40], [200, 40, 40], [210, 60, 50], [180, 180, 190], [90, 90, 96], [90, 90, 96]], np.uint8)
    col = np.minimum((x * 4).astype(int), 3) + 4 * np.minimum(((1 - y) * 2).astype(int), 1)
    img = palette[col].astype(float)
    checker = ((x * 32).astype(int) + (y * 32).astype(int)) % 2
    img *= (0.8 + 0.2 * checker)[..., None]
    # Photo-like grain, so PNG sizes (and decode cost) resemble a baked capture texture.
    img += np.random.default_rng(0).normal(0, 6, img.shape)
    return png(np.clip(img, 0, 255).astype(np.uint8), "RGB")


def normal_png(size: int) -> bytes:
    y, x = np.mgrid[0:size, 0:size] / size
    nx, ny = 0.15 * np.sin(x * 40), 0.15 * np.cos(y * 40)
    nz = np.sqrt(1 - nx**2 - ny**2)
    return png((np.stack([nx, ny, nz], -1) * 127.5 + 127.5).astype(np.uint8), "RGB")


def ao_png(size: int) -> bytes:
    y, x = np.mgrid[0:size, 0:size] / size
    return png((200 + 55 * np.sin(x * 9) * np.sin(y * 9)).astype(np.uint8), "L")


def png(arr, mode) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr, mode).save(buf, "PNG", optimize=True)
    return buf.getvalue()


def jpg(data: bytes, quality=85) -> bytes:
    buf = io.BytesIO()
    Image.open(io.BytesIO(data)).convert("RGB").save(buf, "JPEG", quality=quality)
    return buf.getvalue()


# --- USD --------------------------------------------------------------------------------------


def texture_shader(material, name, file, st_reader, color_space, output):
    tex = UsdShade.Shader.Define(material.GetPrim().GetStage(), material.GetPath().AppendChild(name))
    tex.CreateIdAttr("UsdUVTexture")
    tex.CreateInput("file", Sdf.ValueTypeNames.Asset).Set(file)
    tex.CreateInput("st", Sdf.ValueTypeNames.Float2).ConnectToSource(st_reader.ConnectableAPI(), "result")
    tex.CreateInput("wrapS", Sdf.ValueTypeNames.Token).Set("repeat")
    tex.CreateInput("wrapT", Sdf.ValueTypeNames.Token).Set("repeat")
    tex.CreateInput("sourceColorSpace", Sdf.ValueTypeNames.Token).Set(color_space)
    if name == "normal":
        # Object Capture stores tangent-space normals as 0..1; scale/bias remaps to -1..1.
        tex.CreateInput("scale", Sdf.ValueTypeNames.Float4).Set(Gf.Vec4f(2, 2, 2, 1))
        tex.CreateInput("bias", Sdf.ValueTypeNames.Float4).Set(Gf.Vec4f(-1, -1, -1, 0))
    tex.CreateOutput(output, Sdf.ValueTypeNames.Float3 if output == "rgb" else Sdf.ValueTypeNames.Float)
    return tex


def make_material(stage, path, tex_dir, textures):
    mat = UsdShade.Material.Define(stage, path)
    surf = UsdShade.Shader.Define(stage, path.AppendChild("surfaceShader"))
    surf.CreateIdAttr("UsdPreviewSurface")
    surf.CreateInput("metallic", Sdf.ValueTypeNames.Float).Set(0.0)
    surf.CreateInput("roughness", Sdf.ValueTypeNames.Float).Set(0.75)
    mat.CreateSurfaceOutput().ConnectToSource(surf.ConnectableAPI(), "surface")
    reader = UsdShade.Shader.Define(stage, path.AppendChild("uvReader"))
    reader.CreateIdAttr("UsdPrimvarReader_float2")
    varname = reader.CreateInput("varname", Sdf.ValueTypeNames.Token)
    varname.Set("st")
    reader.CreateOutput("result", Sdf.ValueTypeNames.Float2)
    if "diffuse" in textures:
        t = texture_shader(mat, "diffuseColor", f"{tex_dir}/{textures['diffuse']}", reader, "sRGB", "rgb")
        surf.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).ConnectToSource(t.ConnectableAPI(), "rgb")
    if "normal" in textures:
        t = texture_shader(mat, "normal", f"{tex_dir}/{textures['normal']}", reader, "raw", "rgb")
        surf.CreateInput("normal", Sdf.ValueTypeNames.Normal3f).ConnectToSource(t.ConnectableAPI(), "rgb")
    if "ao" in textures:
        t = texture_shader(mat, "occlusion", f"{tex_dir}/{textures['ao']}", reader, "raw", "r")
        surf.CreateInput("occlusion", Sdf.ValueTypeNames.Float).ConnectToSource(t.ConnectableAPI(), "r")
    if "color" in textures:
        surf.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*textures["color"]))
    return mat


def build(variant: str, detail: int, tex: int, work: str) -> str:
    pts, nrm, st, faces, uv_faces = tessellate(bike_parts(detail))
    z_up = variant == "zup-subsets"
    scale = 100.0 if z_up else 1.0  # centimeters in the Z-up variant
    if z_up:
        # Rotate +Y up → +Z up so the loader must undo it.
        pts = np.stack([pts[:, 0], -pts[:, 2], pts[:, 1]], -1)
        nrm = np.stack([nrm[:, 0], -nrm[:, 2], nrm[:, 1]], -1)
    pts = pts * scale

    os.makedirs(os.path.join(work, "0"), exist_ok=True)
    layer = os.path.join(work, "baked_mesh.usdc")
    stage = Usd.Stage.CreateNew(layer)
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z if z_up else UsdGeom.Tokens.y)
    UsdGeom.SetStageMetersPerUnit(stage, 0.01 if z_up else 1.0)
    stage.SetMetadata("customLayerData", {"creator": "bike-3d-brew tools/fixtures/make-usdc.py (synthetic)"})

    root = UsdGeom.Xform.Define(stage, "/baked_mesh")
    stage.SetDefaultPrim(root.GetPrim())
    Usd.ModelAPI(root.GetPrim()).SetKind("component")
    # Object Capture leaves a transform on the root; keep a small one so xforms are exercised.
    root.AddTranslateOp().Set(Gf.Vec3d(0, 0.05 * scale if not z_up else 0, 0.05 * scale if z_up else 0))
    if z_up:
        # Values the crate format stores inline (small integral vectors as int8, halves, negative
        # ints). The composer ignores these custom attributes; tests read them back.
        prim = root.GetPrim()
        prim.CreateAttribute("test:int", Sdf.ValueTypeNames.Int).Set(-3)
        prim.CreateAttribute("test:half", Sdf.ValueTypeNames.Half).Set(0.5)
        prim.CreateAttribute("test:double3", Sdf.ValueTypeNames.Double3).Set(Gf.Vec3d(1, -2, 3))
        prim.CreateAttribute("test:half3", Sdf.ValueTypeNames.Half3).Set(Gf.Vec3h(1.5, -2, 0.25))
        prim.CreateAttribute("test:double4", Sdf.ValueTypeNames.Double4).Set(Gf.Vec4d(-1, 0, 1, 2))

    mesh = UsdGeom.Mesh.Define(stage, "/baked_mesh/baked_mesh")
    mesh.CreateSubdivisionSchemeAttr("none")
    mesh.CreatePointsAttr(Vt.Vec3fArray.FromNumpy(pts.astype(np.float32)))
    mesh.CreateFaceVertexCountsAttr(Vt.IntArray.FromNumpy(np.full(len(faces), 3, np.int32)))
    mesh.CreateFaceVertexIndicesAttr(Vt.IntArray.FromNumpy(faces.reshape(-1).astype(np.int32)))
    mesh.CreateExtentAttr([Gf.Vec3f(*pts.min(0)), Gf.Vec3f(*pts.max(0))])
    pv = UsdGeom.PrimvarsAPI(mesh)
    if z_up:
        # Variant: un-indexed face-varying UVs and per-vertex normals.
        mesh.CreateNormalsAttr(Vt.Vec3fArray.FromNumpy(nrm.astype(np.float32)))
        mesh.SetNormalsInterpolation(UsdGeom.Tokens.vertex)
        flat = st[uv_faces.reshape(-1)]
        pv.CreatePrimvar("st", Sdf.ValueTypeNames.TexCoord2fArray, UsdGeom.Tokens.faceVarying).Set(Vt.Vec2fArray.FromNumpy(flat.astype(np.float32)))
    else:
        # Object Capture: indexed face-varying normals and UVs.
        n = pv.CreatePrimvar("normals", Sdf.ValueTypeNames.Normal3fArray, UsdGeom.Tokens.faceVarying)
        n.Set(Vt.Vec3fArray.FromNumpy(nrm.astype(np.float32)))
        n.SetIndices(Vt.IntArray.FromNumpy(faces.reshape(-1).astype(np.int32)))
        s = pv.CreatePrimvar("st", Sdf.ValueTypeNames.TexCoord2fArray, UsdGeom.Tokens.faceVarying)
        s.Set(Vt.Vec2fArray.FromNumpy(st.astype(np.float32)))
        s.SetIndices(Vt.IntArray.FromNumpy(uv_faces.reshape(-1).astype(np.int32)))

    files = []
    if z_up:
        # Two materials on GeomSubsets: wheels (first two parts) textured with a JPEG, frame flat red.
        wheel_tris = 2 * (12 * detail) * (2 * detail) * 2
        with open(os.path.join(work, "0", "wheels.jpg"), "wb") as fh:
            fh.write(jpg(diffuse_png(tex)))
        files.append("0/wheels.jpg")
        wheels = make_material(stage, Sdf.Path("/baked_mesh/Materials/wheels"), "0", {"diffuse": "wheels.jpg"})
        frame = make_material(stage, Sdf.Path("/baked_mesh/Materials/frame"), "0", {"color": (0.8, 0.1, 0.1)})
        bind = UsdShade.MaterialBindingAPI.Apply(mesh.GetPrim())
        bind.CreateMaterialBindSubset("wheels", Vt.IntArray(list(range(wheel_tris))), UsdGeom.Tokens.face)
        bind.CreateMaterialBindSubset("frame", Vt.IntArray(list(range(wheel_tris, len(faces)))), UsdGeom.Tokens.face)
        for name, mat in (("wheels", wheels), ("frame", frame)):
            UsdShade.MaterialBindingAPI.Apply(stage.GetPrimAtPath(f"/baked_mesh/baked_mesh/{name}")).Bind(mat)
    else:
        names = {"diffuse": "baked_mesh_tex0.png", "normal": "baked_mesh_norm0.png", "ao": "baked_mesh_ao0.png"}
        small = max(16, tex // 4)
        for key, data in (("diffuse", diffuse_png(tex)), ("normal", normal_png(small)), ("ao", ao_png(small))):
            with open(os.path.join(work, "0", names[key]), "wb") as fh:
                fh.write(data)
            files.append(f"0/{names[key]}")
        mat = make_material(stage, Sdf.Path("/baked_mesh/Materials/material_0"), "0", names)
        UsdShade.MaterialBindingAPI.Apply(mesh.GetPrim()).Bind(mat)

    stage.GetRootLayer().Save()
    return layer


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("variant", choices=["object-capture", "zup-subsets"])
    ap.add_argument("out")
    ap.add_argument("--detail", type=int, default=3, help="tessellation multiplier (90 with --tex 2048 ≈ 23 MB)")
    ap.add_argument("--tex", type=int, default=128, help="diffuse texture size in pixels")
    args = ap.parse_args()

    work = tempfile.mkdtemp(prefix="make-usdc-")
    try:
        layer = build(args.variant, args.detail, args.tex, work)
        with open(layer, "rb") as fh:
            assert fh.read(8) == b"PXR-USDC", "expected a binary crate layer"
        out = os.path.abspath(args.out)
        cwd = os.getcwd()
        os.chdir(work)  # package with layer-relative asset paths
        try:
            ok = UsdUtils.CreateNewUsdzPackage(Sdf.AssetPath("baked_mesh.usdc"), out)
        finally:
            os.chdir(cwd)
        if not ok:
            sys.exit("CreateNewUsdzPackage failed")
        print(f"wrote {args.out} ({os.path.getsize(out) / 1024:.1f} KB)")
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
