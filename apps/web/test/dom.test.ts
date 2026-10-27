// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { download, h } from '../src/ui/dom';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('h()', () => {
  it('sets classes, data, attributes, properties, listeners and children', () => {
    const onclick = vi.fn();
    const el = h('button', { class: 'a b', dataset: { id: 'x' }, type: 'button', 'aria-label': 'Go', disabled: true, hidden: false, title: undefined, onclick }, 'Go ', h('small', {}, '3'), null, false);
    expect(el.className).toBe('a b');
    expect(el.dataset.id).toBe('x');
    expect(el.getAttribute('aria-label')).toBe('Go');
    expect(el.disabled).toBe(true);
    expect(el.hidden).toBe(false);
    expect(el.hasAttribute('title')).toBe(false);
    expect(el.textContent).toBe('Go 3');
    el.click(); // disabled: no click
    el.disabled = false;
    el.click();
    expect(onclick).toHaveBeenCalledTimes(1);
  });

  it('sets non-string values as properties (e.g. selected options)', () => {
    const select = h('select', {}, h('option', { value: 'a' }, 'A'), h('option', { value: 'b', selected: true }, 'B'));
    expect(select.value).toBe('b');
  });
});

describe('download()', () => {
  it('clicks a temporary link to the blob and revokes it later', () => {
    vi.useFakeTimers();
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });
    download('bike.json', '{"a":1}');
    expect(create.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect((create.mock.calls[0][0] as Blob).type).toBe('application/json');
    expect(clicked[0].download).toBe('bike.json');
    expect(clicked[0].href).toBe('blob:test');
    expect(document.querySelector('a')).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledWith('blob:test');
    vi.useRealTimers();
  });

  it('passes Blobs through untouched', () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:png');
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const png = new Blob([new Uint8Array([1])], { type: 'image/png' });
    download('bike.png', png);
    expect(create).toHaveBeenCalledWith(png);
  });
});
