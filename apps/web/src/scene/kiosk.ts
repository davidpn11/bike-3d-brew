// Auto-advance for Present mode ("kiosk"): step to the next area every `interval` ms; any user
// interaction holds it, and it resumes by itself after `idle` ms without input. Timers are
// injectable so the schedule is unit-tested with fake timers.

export type KioskState = 'off' | 'playing' | 'held';

export interface KioskOptions {
  interval: number;
  idle: number;
  onAdvance: () => void;
  onChange?: (state: KioskState) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export const KIOSK_DEFAULTS = { interval: 8000, idle: 20000 };

export class Kiosk {
  private _state: KioskState = 'off';
  private timer: unknown = null;
  private readonly set: (fn: () => void, ms: number) => unknown;
  private readonly clear: (id: unknown) => void;

  constructor(private opts: KioskOptions) {
    this.set = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clear = opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  }

  get state(): KioskState {
    return this._state;
  }

  get interval(): number {
    return this.opts.interval;
  }

  /** New timing (e.g. from URL parameters); takes effect from the next scheduled step. */
  configure(t: { interval: number; idle: number }): void {
    this.opts.interval = t.interval;
    this.opts.idle = t.idle;
  }

  play(): void {
    this.go('playing', this.opts.interval, () => this.advance());
  }

  stop(): void {
    this.go('off');
  }

  toggle(): void {
    if (this._state === 'off') this.play();
    else this.stop();
  }

  /** The user touched something: hold auto-advance until they have been idle for a while. */
  interact(): void {
    if (this._state === 'off') return;
    this.go('held', this.opts.idle, () => this.play());
  }

  /** A manual step while playing: give the new area a full interval. */
  restart(): void {
    if (this._state === 'playing') this.play();
  }

  private advance(): void {
    this.opts.onAdvance();
    if (this._state === 'playing') this.play();
  }

  private go(state: KioskState, ms?: number, fn?: () => void): void {
    if (this.timer !== null) this.clear(this.timer);
    this.timer = fn && ms !== undefined ? this.set(fn, ms) : null;
    const changed = state !== this._state;
    this._state = state;
    if (changed) this.opts.onChange?.(state);
  }
}
