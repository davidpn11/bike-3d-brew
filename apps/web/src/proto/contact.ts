import '../styles.css';
import './contact.css';
import { h } from '../ui/dom';
import { BIKES, SHOP, bikeById, formatUsd, type ProtoBike, type Upgrade } from './data';
import type { Cleanup, ScreenContext } from './main';

export interface ContactOpts { bike: ProtoBike; upgrade?: Upgrade }

const TOPICS = ['Sizing', 'Upgrades', 'Test ride', 'Other'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isPhone = (v: string) => v.replace(/\D/g, '').length >= 10;
const telHref = (p: string) => `tel:+1${p.replace(/\D/g, '')}`;

function sheetForm(opts: ContactOpts): HTMLElement {
  const { bike, upgrade } = opts;
  const topics = new Set<string>(upgrade ? ['Upgrades'] : []);
  let replyBy: 'email' | 'sms' = 'email';
  let sent = false;
  const name = h('input', { type: 'text', id: 'pc-name', autocomplete: 'name' });
  const contact = h('input', { type: 'email', id: 'pc-contact', autocomplete: 'email', inputMode: 'email', placeholder: 'you@example.com' });
  const message = h('textarea', { id: 'pc-msg', rows: 3 });
  if (upgrade) message.value = `I'm interested in the upgrade: ${upgrade.from} → ${upgrade.to} (+${formatUsd(upgrade.priceUsd)}).`;
  const consent = h('p', { class: 'fine consent', hidden: true }, `By choosing text, you agree to get a text reply from ${SHOP.name} at this number. Message and data rates may apply. Reply STOP to opt out.`);
  const error = h('p', { class: 'err', role: 'alert', hidden: true });
  const root = h('div', {});

  const contactLabel = h('label', { for: 'pc-contact' }, 'Email', contact);
  const chips = TOPICS.map((t) =>
    h('button', { type: 'button', class: 'chip', 'aria-pressed': String(topics.has(t)), onclick: (e: Event) => {
      if (topics.has(t)) topics.delete(t); else topics.add(t);
      (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(topics.has(t)));
    } }, t),
  );
  const radio = (v: 'email' | 'sms', label: string) =>
    h('label', {}, h('input', { type: 'radio', name: 'pc-reply', value: v, checked: v === replyBy, onchange: () => {
      replyBy = v;
      consent.hidden = v !== 'sms';
      // Phone keyboard and autofill for texts, email ones otherwise.
      const sms = v === 'sms';
      contact.inputMode = sms ? 'tel' : 'email';
      contact.autocomplete = sms ? 'tel' : 'email';
      contact.placeholder = sms ? '(512) 555-0100' : 'you@example.com';
      contact.setAttribute('type', sms ? 'tel' : 'email');
      contactLabel.firstChild!.textContent = sms ? 'Mobile number' : 'Email';
    } }), label);

  const fail = (m: string) => { error.textContent = m; error.hidden = false; };
  const send = (e: Event) => {
    e.preventDefault();
    if (sent) return; // double submit within the same open does nothing
    const c = contact.value.trim();
    if (!name.value.trim()) return fail('Please add your name.');
    if (!EMAIL.test(c) && !isPhone(c)) return fail('Enter a valid email or a 10-digit mobile number.');
    if (replyBy === 'sms' && EMAIL.test(c)) return fail('To get a text, enter your mobile number.');
    if (replyBy === 'email' && !EMAIL.test(c)) return fail('To get an email, enter your email address.');
    sent = true;
    root.replaceChildren(
      h('div', { class: 'done', role: 'status', dataset: { state: 'sent' } },
        h('h2', {}, `Thanks, ${name.value.trim()}.`),
        h('p', {}, `${SHOP.name} will reply by ${replyBy === 'sms' ? 'text message' : 'email'} within ${SHOP.replyPromise}.`),
        h('p', { class: 'fine' }, `Prototype only: nothing was sent. Prefer to talk now? Call ${SHOP.phone}.`),
        h('a', { href: telHref(SHOP.phone) }, `Call ${SHOP.phone}`)),
    );
  };

  root.append(
    h('h2', { id: 'pc-title' }, `Talk to ${SHOP.name} about the ${bike.name}`),
    h('form', { noValidate: true, onsubmit: send },
      h('fieldset', {}, h('legend', {}, 'What would you like to know?'), ...chips),
      h('label', { for: 'pc-name' }, 'Name', name),
      contactLabel,
      h('fieldset', { class: 'reply' }, h('legend', {}, 'Reply by'), radio('email', 'Email'), radio('sms', 'Text message')),
      consent,
      h('label', { for: 'pc-msg' }, 'Message', message),
      error,
      h('p', { class: 'fine' }, `${SHOP.name} replies within ${SHOP.replyPromise}.`),
      h('p', { class: 'fine' }, 'Privacy: used only to answer you; deleted after 12 months.'),
      h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'primary' }, 'Send'), h('span', {}, 'or call ', h('a', { href: telHref(SHOP.phone) }, SHOP.phone))),
    ),
  );
  return root;
}

/** Modal sheet over the current page (native <dialog>: focus trap and Escape come with it). Returns a close function. */
export function openContactSheet(opts: ContactOpts): () => void {
  const dialog = h('dialog', { class: 'p-contact', 'aria-labelledby': 'pc-title' });
  const opener = document.activeElement as HTMLElement | null;
  const close = () => dialog.close();
  dialog.append(h('button', { type: 'button', class: 'close', 'aria-label': 'Close', onclick: close }, '✕'), sheetForm(opts));
  dialog.addEventListener('close', () => { dialog.remove(); opener?.focus?.(); });
  document.body.append(dialog);
  dialog.showModal();
  return close;
}

/** The tab: the sheet inline, for the Aero R1. */
export function render(host: HTMLElement, ctx: ScreenContext): Cleanup {
  const bike = bikeById(ctx.params.get('bike') ?? '') ?? BIKES[0];
  host.append(h('div', { class: 'p-contact inline' }, sheetForm({ bike })));
}
