"""Convert a USDZ (e.g. Object Capture output) to GLB with Blender, for the web viewer.

Usage:
    blender --background --python tools/usdz-to-glb.py -- model.usdz model.glb

Blender 3.x+ imports USD (including .usdz) natively. Textures are embedded in the GLB.
"""

import sys

import bpy  # type: ignore[import-not-found]


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(argv) != 2:
        sys.exit("usage: blender --background --python tools/usdz-to-glb.py -- in.usdz out.glb")
    src, dst = argv
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.usd_import(filepath=src)
    bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_yup=True, export_apply=True)
    print(f"wrote {dst}")


if __name__ == "__main__":
    main()
