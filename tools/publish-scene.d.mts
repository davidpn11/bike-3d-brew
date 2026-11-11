// Types for publish-scene.mjs so TypeScript tests can import it.
import type { BikeScene } from '../apps/web/src/scene/schema';

export interface PublishOptions {
  file: string;
  /** Folder name under `out` (default: the package's own id). */
  id?: string;
  /** Where scenes live (default: apps/web/public/scenes). */
  out: string;
  force?: boolean;
}

export interface PublishResult {
  id: string;
  dir: string;
  scene: BikeScene;
  files: string[];
  warnings: string[];
  /** `scenes/<id>/scene.bike.json`: the `?scene=` value. */
  sceneParam: string;
}

export function publishScene(opts: PublishOptions): Promise<PublishResult>;
