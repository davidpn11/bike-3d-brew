import { type ShareOption, type SharePackageInput, buildSharePackage } from '../scene/share';
import { download, h } from './dom';

export interface ShareContext {
  option: ShareOption;
  sceneName: string;
  /** Collects the model and photos for a share package (may fetch). */
  packageInput: () => Promise<SharePackageInput>;
  toast: (message: string, tone?: 'info' | 'error', ms?: number) => void;
}

/** Customer link or share package, depending on where the scene lives. */
export class ShareDialog {
  readonly el: HTMLDivElement;
  private returnFocus: HTMLElement | null = null;

  constructor(parent: HTMLElement = document.body) {
    this.el = h('div', { class: 'share-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'share-title', hidden: true });
    this.el.addEventListener('pointerdown', (e) => e.target === this.el && this.close());
    this.el.addEventListener('keydown', (e) => e.key === 'Escape' && (e.stopPropagation(), this.close()));
    parent.append(this.el);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  close(): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    this.el.replaceChildren();
    this.returnFocus?.focus();
  }

  /**
   * The Share button: on a phone with a published link, the system share sheet; otherwise this
   * dialog, which copies the link right away (with the link visible in case copying is blocked)
   * or explains how to publish the scene.
   */
  async share(ctx: ShareContext): Promise<void> {
    const { option } = ctx;
    if (option.kind === 'link' && !option.stale && typeof navigator.share === 'function' && matchMedia('(pointer: coarse)').matches) {
      try {
        await navigator.share({ title: ctx.sceneName, url: option.url });
        return;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        // Not allowed here (e.g. desktop policy): fall back to the dialog.
      }
    }
    this.open(ctx);
  }

  open(ctx: ShareContext): void {
    this.returnFocus = document.activeElement as HTMLElement | null;
    const { option } = ctx;
    const body: HTMLElement[] = [];
    if (option.kind === 'link') {
      const field = h('input', { class: 'share-url', readonly: true, value: option.url, 'aria-label': 'Customer link', onfocus: (e: Event) => (e.target as HTMLInputElement).select() });
      const status = h('p', { class: 'share-status', role: 'status' });
      const copy = async () => {
        try {
          await navigator.clipboard.writeText(option.url);
          status.textContent = 'Link copied. Paste it into a message to your customer.';
          status.dataset.tone = 'ok';
        } catch {
          status.textContent = 'Copy the link above (copying is blocked in this browser).';
          status.dataset.tone = 'warn';
          field.focus();
          field.select();
        }
      };
      body.push(
        h('p', {}, 'Anyone with this link sees the bike in Present mode, read-only, with your comments.'),
        field,
        h(
          'div',
          { class: 'row share-actions' },
          h('button', { type: 'button', class: 'primary', onclick: () => void copy() }, 'Copy link'),
          typeof navigator.share === 'function' ? h('button', { type: 'button', onclick: () => void navigator.share({ title: ctx.sceneName, url: option.url }).catch(() => {}) }, 'Share…') : null,
          h('a', { class: 'button', href: option.url, target: '_blank', rel: 'noopener' }, 'Open'),
        ),
        status,
      );
      if (option.stale) body.push(h('p', { class: 'share-warn' }, 'This browser has edits that are not in the published copy yet. Export a share package and publish it again to include them.'));
      queueMicrotask(() => void copy());
    } else {
      body.push(
        h(
          'p',
          {},
          option.reason === 'local-model'
            ? 'This bike’s 3D model only exists in this browser, so there is no link to send yet. Publish it first:'
            : 'This scene is not published yet. Publish it first:',
        ),
        h(
          'ol',
          { class: 'share-steps' },
          h('li', {}, 'Export a share package (the scene, the model and the best close-up photos).'),
          h('li', {}, 'Publish it: ', h('code', {}, 'node tools/publish-scene.mjs <file>.bikeshare.zip'), ', or unzip it into a folder on any static host.'),
          h('li', {}, 'Send the link: ', h('code', {}, '…/app/?scene=scenes/<id>/scene.bike.json&view=present')),
        ),
      );
    }
    const exportBtn = h('button', { type: 'button', class: option.kind === 'link' ? '' : 'primary', onclick: () => void this.exportPackage(ctx, exportBtn) }, 'Export share package');
    this.el.replaceChildren(
      h(
        'div',
        { class: 'share-box' },
        h('header', {}, h('h2', { id: 'share-title' }, option.kind === 'link' ? 'Share with a customer' : 'Publish to share'), h('button', { type: 'button', class: 'close', 'aria-label': 'Close', onclick: () => this.close() }, '×')),
        ...body,
        h('div', { class: 'share-package' }, exportBtn, h('small', {}, 'A .bikeshare.zip you can publish with tools/publish-scene.mjs or unzip on any static host.')),
      ),
    );
    this.el.hidden = false;
    (this.el.querySelector<HTMLElement>('.share-url, .primary') ?? exportBtn).focus();
  }

  private async exportPackage(ctx: ShareContext, btn: HTMLButtonElement): Promise<void> {
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'Preparing…';
    try {
      const pkg = buildSharePackage(await ctx.packageInput());
      download(pkg.filename, new Blob([pkg.bytes as BlobPart], { type: 'application/zip' }));
      const photos = pkg.manifest.photos.length ? ` with ${pkg.manifest.photos.length} photos` : '';
      ctx.toast(`Saved ${pkg.filename}${photos}. Publish it with tools/publish-scene.mjs, then share ?scene=scenes/${pkg.id}/scene.bike.json&view=present.`, 'info', 9000);
    } catch (err) {
      ctx.toast(`Could not export the share package: ${err instanceof Error ? err.message : String(err)}`, 'error', 0);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }
}
