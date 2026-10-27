import * as THREE from 'three';

/**
 * Matrix from the loaded file's own space (where Object Capture's poses live) into model-root
 * space (where hotspots and comments live), column-major.
 *
 * Viewer.setModel puts `centerOnGround(object)` in the model root: a 'centered' wrapper group
 * holding the loaded object, whose position was shifted so the bounds sit centered on y = 0.
 * Points in the file map through the object's local matrix (centering shift plus any root
 * transform the loader applied), then the wrapper's (identity). The model root's own transform
 * (scene `model.rotation/scale/offset`) is deliberately excluded: model-root space is before it.
 */
export function sourceToModelRoot(modelRoot: THREE.Object3D): number[] | null {
  const wrapper = modelRoot.children[0];
  const object = wrapper?.children[0];
  if (!object) return null;
  wrapper.updateMatrix();
  object.updateMatrix();
  return new THREE.Matrix4().multiplyMatrices(wrapper.matrix, object.matrix).toArray();
}
