// Made-up data for the phase 0 prototype (docs/PRODUCT-VIEWS.md). No backend: every screen reads this.
// shortcut: static fixtures, replaced by the hosted Studio API in phase 1a.

export interface Component { area: string; part: string; note: string }
export interface Upgrade { area: string; from: string; to: string; priceUsd: number; note?: string }
export type BikeState = 'draft' | 'live' | 'unavailable' | 'archived';
export interface ProtoBike {
  id: string;
  name: string;
  brand: string;
  year: number;
  type: 'Road' | 'Gravel' | 'City' | 'E-bike';
  priceUsd: number | null; // null: the shop hides the price
  sizes: string;
  state: BikeState;
  has3d: boolean;
  views: number;
  /** Published scene shown in 3D; only the demo bike has one. */
  scene?: string;
  components: Component[];
  upgrades: Upgrade[];
  readiness: { label: string; done: boolean }[];
}
export interface Message {
  id: string;
  bikeId: string;
  name: string;
  contact: string;
  replyBy: 'email' | 'sms';
  topics: string[];
  text: string;
  source: 'QR' | 'Instagram' | 'Embed' | 'Direct';
  receivedAt: string; // ISO
  status: 'new' | 'replied' | 'test ride booked' | 'closed';
}

export const SHOP = { name: 'Brew Cycles', city: 'Austin, TX', phone: '(512) 555-0142', sms: '(512) 555-0142', replyPromise: 'one business day' };

/** Areas match the demo scene's hotspot ids (public/scenes/demo/scene.bike.json), so a row can fly the 3D view there. */
export const BIKES: ProtoBike[] = [
  {
    id: 'aero-r1',
    name: 'Aero R1',
    brand: 'Brew',
    year: 2026,
    type: 'Road',
    priceUsd: 4299,
    sizes: '49–61',
    state: 'live',
    has3d: true,
    views: 312,
    scene: 'scenes/demo/scene.bike.json',
    components: [
      { area: 'hs-frame', part: 'Carbon aero frame', note: 'Truncated tube shapes, internal routing, 32 mm tyre clearance.' },
      { area: 'hs-fork', part: 'Full-carbon tapered fork', note: '12 mm thru-axle, flat-mount disc.' },
      { area: 'hs-drivetrain', part: 'Shimano 105 Di2, 2×12', note: 'Wireless electronic shifting; charges by USB-C.' },
      { area: 'hs-cockpit', part: 'Integrated carbon cockpit', note: 'One-piece bar and stem, hidden cables.' },
      { area: 'hs-saddle', part: 'Fizik Argo saddle', note: 'Short nose with a pressure-relief channel.' },
      { area: 'hs-front-wheel', part: 'Carbon 45 mm wheelset', note: 'Tubeless-ready, 21 mm internal width.' },
    ],
    upgrades: [
      { area: 'hs-drivetrain', from: 'Shimano 105 Di2', to: 'Shimano Ultegra Di2', priceUsd: 900, note: 'About 250 g lighter; same shifting feel.' },
      { area: 'hs-front-wheel', from: 'Carbon 45 mm wheelset', to: 'DT Swiss ARC 1400 50 mm', priceUsd: 600, note: 'Ask about fitting time.' },
      { area: 'hs-saddle', from: 'Fizik Argo', to: 'Specialized Power Pro (saddle fit)', priceUsd: 120 },
    ],
    readiness: [
      { label: 'Price, sizes, specs', done: true },
      { label: '6 areas', done: true },
      { label: 'Poster image', done: true },
      { label: 'Components described', done: true },
      { label: 'Upgrades added', done: true },
    ],
  },
  {
    id: 'endurance-cf7',
    name: 'Endurance CF 7',
    brand: 'Brew',
    year: 2026,
    type: 'Road',
    priceUsd: 2850,
    sizes: '51–60',
    state: 'live',
    has3d: true,
    views: 141,
    components: [{ area: 'hs-drivetrain', part: 'Shimano 105, 2×12 mechanical', note: 'Cable shifting, wide 11–34 cassette.' }],
    upgrades: [{ area: 'hs-drivetrain', from: 'Shimano 105', to: 'Shimano 105 Di2', priceUsd: 700 }],
    readiness: [
      { label: 'Price, sizes, specs', done: true },
      { label: '5 areas', done: true },
      { label: 'Poster image', done: true },
      { label: 'Components described', done: true },
      { label: 'Upgrades added', done: true },
    ],
  },
  {
    id: 'trail-gx',
    name: 'Trail GX',
    brand: 'Ridgeline',
    year: 2026,
    type: 'Gravel',
    priceUsd: 2100,
    sizes: 'S–XL',
    state: 'draft',
    has3d: false,
    views: 0,
    components: [],
    upgrades: [],
    readiness: [
      { label: 'Price, sizes, specs', done: true },
      { label: 'Areas', done: false },
      { label: 'Poster image', done: true },
      { label: 'Components described', done: false },
      { label: 'Upgrades added', done: false },
    ],
  },
  {
    id: 'metro-e',
    name: 'Metro E',
    brand: 'Ridgeline',
    year: 2026,
    type: 'E-bike',
    priceUsd: null,
    sizes: 'M, L',
    state: 'unavailable',
    has3d: true,
    views: 58,
    components: [{ area: 'hs-frame', part: 'Aluminium frame, integrated 500 Wh battery', note: 'Removable with a key.' }],
    upgrades: [],
    readiness: [{ label: 'Price, sizes, specs', done: true }],
  },
];

export const MESSAGES: Message[] = [
  { id: 'm1', bikeId: 'aero-r1', name: 'Jordan P.', contact: 'jordan@example.com', replyBy: 'email', topics: ['Sizing', 'Upgrades'], text: "I'm 5'11\" — 54 or 56? And how long does the Ultegra swap take?", source: 'Instagram', receivedAt: '2026-11-12T15:20:00Z', status: 'new' },
  { id: 'm2', bikeId: 'aero-r1', name: 'Sam R.', contact: '(512) 555-0199', replyBy: 'sms', topics: ['Test ride'], text: 'Can I test ride Saturday morning?', source: 'QR', receivedAt: '2026-11-12T13:05:00Z', status: 'new' },
  { id: 'm3', bikeId: 'endurance-cf7', name: 'Alex K.', contact: 'alex@example.com', replyBy: 'email', topics: ['Other'], text: 'Does it fit 35 mm tyres?', source: 'Embed', receivedAt: '2026-11-11T19:40:00Z', status: 'replied' },
];

export const formatUsd = (n: number): string => `$${n.toLocaleString('en-US')}`;
export const bikeById = (id: string): ProtoBike | undefined => BIKES.find((b) => b.id === id);
