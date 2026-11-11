import { dropIndex } from '../scene/reorder';

/**
 * Drag-to-reorder for a list, by a handle, with pointer events so it works with a mouse and on
 * touch screens alike (HTML5 drag and drop does not on iPhone). The dragged item follows the
 * pointer, the others make room; `onDrop(id, index)` gets the new index among the items.
 */
export function dragReorder(list: HTMLElement, handleSelector: string, onDrop: (id: string, index: number) => void): void {
  list.addEventListener('pointerdown', (e) => {
    const handle = (e.target as HTMLElement).closest(handleSelector);
    if (!handle || e.button !== 0) return;
    const item = handle.closest<HTMLElement>('[data-id]');
    if (!item || item.parentElement !== list) return;
    e.preventDefault();
    e.stopPropagation();
    const items = [...list.children] as HTMLElement[];
    const from = items.indexOf(item);
    const rects = items.map((el) => el.getBoundingClientRect());
    const mids = rects.map((r) => r.top + r.height / 2);
    const gap = rects.length > 1 ? rects[1].top - rects[0].bottom : 0;
    const shift = rects[from].height + gap;
    const startY = e.clientY;
    let to = from;
    item.classList.add('dragging');
    list.classList.add('reordering');
    handle.setPointerCapture?.(e.pointerId);

    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      item.style.transform = `translateY(${dy}px)`;
      to = dropIndex(mids, from, mids[from] + dy);
      items.forEach((el, i) => {
        if (i === from) return;
        const offset = from < to && i > from && i <= to ? -shift : from > to && i >= to && i < from ? shift : 0;
        el.style.transform = offset ? `translateY(${offset}px)` : '';
      });
    };
    const done = (ev: PointerEvent) => {
      handle.removeEventListener('pointermove', move as EventListener);
      handle.removeEventListener('pointerup', done as EventListener);
      handle.removeEventListener('pointercancel', done as EventListener);
      for (const el of items) el.style.transform = '';
      item.classList.remove('dragging');
      list.classList.remove('reordering');
      // Swallow the click that follows the drag so it does not also select the comment.
      const swallow = (c: Event) => c.stopPropagation();
      item.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => item.removeEventListener('click', swallow, { capture: true }), 0);
      if (ev.type === 'pointerup' && to !== from) onDrop(item.dataset.id!, to);
    };
    handle.addEventListener('pointermove', move as EventListener);
    handle.addEventListener('pointerup', done as EventListener);
    handle.addEventListener('pointercancel', done as EventListener);
  });
}
