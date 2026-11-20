import { EMBED_PROTOCOL, type EmbedEventName, embedOrigin, parseEmbedCommand } from '../scene/embed';
import { presenter } from './customer';

// embed.html: the customer view for an <iframe> on a shop's page, plus the `bike-embed/1`
// postMessage bridge (docs/ARCHITECTURE.md). Only the framing page is listened to, and only from
// `?origin=` when it is set; commands go through parseEmbedCommand, never anything else.

const origin = embedOrigin(new URLSearchParams(location.search).get('origin'));
const post = (event: EmbedEventName, detail: unknown) => {
  if (window.parent !== window) window.parent.postMessage({ type: EMBED_PROTOCOL, event, detail }, origin.target);
};
const state = () => ({ index: presenter.areaIndex, areas: presenter.areas, playing: presenter.playing, id: presenter.scene?.id ?? null, name: presenter.scene?.name ?? null });

presenter.on('ready', () => post('ready', state()));
presenter.on('error', (d) => post('error', d));
presenter.on('areachange', (d) => post('areachange', d));
presenter.on('commentopen', (d) => post('commentopen', d));

addEventListener('message', (e: MessageEvent) => {
  if (e.source !== window.parent || !origin.accepts(e.origin)) return;
  const c = parseEmbedCommand(e.data);
  if (!c) return;
  if (c.cmd === 'goToArea') presenter.goToArea(c.area ?? 0);
  else if (c.cmd === 'setBackground') presenter.setBackground(c.background);
  else if (c.cmd === 'openComment') presenter.openComment(c.id);
  else if (c.cmd === 'getState') post('state', state());
  else presenter[c.cmd]();
});
