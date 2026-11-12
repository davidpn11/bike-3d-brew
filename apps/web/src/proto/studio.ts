import { h } from '../ui/dom';
import type { Cleanup, ScreenContext } from './main';

// Placeholder: replaced by the screen's owner (see the prototype brief).
export function render(host: HTMLElement, _ctx: ScreenContext): Cleanup {
  host.append(h('p', { style: 'padding:24px' }, 'studio: coming soon'));
}
