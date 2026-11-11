import { type Inline, parseMarkdownLite } from '../scene/markdown';

// Builds DOM nodes from the markdown-lite tree. User text only ever reaches the page through
// text nodes, never innerHTML, so "<img onerror=…>" in a comment shows up as those characters.

function inlines(nodes: Inline[], parent: Node): void {
  for (const n of nodes) {
    if (n.t === 'text') parent.appendChild(document.createTextNode(n.v));
    else if (n.t === 'br') parent.appendChild(document.createElement('br'));
    else {
      const el = document.createElement(n.t);
      inlines(n.c, el);
      parent.appendChild(el);
    }
  }
}

/** A `div.md` holding the rendered body (paragraphs and bullet lists). */
export function markdownBlock(src: string): HTMLDivElement {
  const root = document.createElement('div');
  root.className = 'md';
  for (const block of parseMarkdownLite(src)) {
    if (block.t === 'p') {
      const p = document.createElement('p');
      inlines(block.c, p);
      root.appendChild(p);
    } else {
      const ul = document.createElement('ul');
      for (const item of block.items) {
        const li = document.createElement('li');
        inlines(item, li);
        ul.appendChild(li);
      }
      root.appendChild(ul);
    }
  }
  return root;
}
