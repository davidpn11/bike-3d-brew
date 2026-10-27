/**
 * Decides when the viewer draws. The stage only renders when something changed (camera input,
 * damping, a fly-to, a model/background/pin change, a resize), and the animation loop itself is
 * stopped while nothing does: an idle viewer costs 0 frames, which saves phone battery and keeps
 * a CPU-rendered (SwiftShader) E2E run from re-drawing a still picture all day.
 *
 * Pure state: the Viewer passes a callback that starts/stops `renderer.setAnimationLoop`.
 */
export class RenderScheduler {
  /** Frames still owed to `request()` calls. */
  private pending = 0;
  /** Something animated in the last frame, so the next frame must run to see whether it still does. */
  private animating = false;
  private running = false;
  private hidden = false;
  /** Frames drawn since creation (benchmarks and tests read it). */
  renders = 0;

  constructor(private setLooping: (on: boolean) => void) {}

  /** Something changed: draw at least the next `frames` frames. */
  request(frames = 1): void {
    this.pending = Math.max(this.pending, frames);
    this.sync();
  }

  /**
   * One animation-frame tick. `animating` is true when the camera moved in this frame (controls
   * damping, a flight). Returns whether to draw it.
   */
  frame(animating: boolean): boolean {
    const draw = animating || this.pending > 0;
    if (this.pending > 0) this.pending--;
    this.animating = animating;
    if (draw) this.renders++;
    this.sync();
    return draw;
  }

  /** Pauses the loop while the page is hidden; becoming visible redraws once. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (!hidden) this.pending = Math.max(this.pending, 1);
    this.sync();
  }

  /** True while the animation loop runs (something is moving or a frame is owed). */
  get active(): boolean {
    return this.running;
  }

  private sync(): void {
    const want = !this.hidden && (this.pending > 0 || this.animating);
    if (want === this.running) return;
    this.running = want;
    this.setLooping(want);
  }
}
