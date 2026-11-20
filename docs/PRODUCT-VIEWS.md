# Product views: bike-3d-brew for bike shops

Planning document for the commercial product: who uses it, which screens it has, how they connect, what we
deliberately do not build, and in what order. Nothing here is built unless marked **exists**. Owner decisions
are collected in [section 9](#9-owner-decisions).

> **Owner decisions, 12 Nov 2026 (these override anything below that disagrees).**
>
> - **New bikes only.** No used or consignment bikes, so there are no condition notes, grades or defect lists.
> - **A showroom, not a sales page.** The customer page informs buyers: see the bike in 3D, explore its
>   components, and check the upgrades the shop offers. It has no checkout, hold, reservation or "buy" flow. Its
>   one action is **Talk to a salesperson**.
> - **US market first.** English, USD (`$4,299`), and contact by email or SMS (a text message), plus a call
>   button. No WhatsApp.
> - **Bun 1.4.4** as the package manager, with Node 22 as the runtime, an empty trusted-scripts list, and
>   GitHub Actions on version tags (see [BUN-MIGRATION.md](BUN-MIGRATION.md)).

How it was written: Claude and Codex each drafted a proposal independently from the same inputs. The drafts
were merged and the disagreements settled ([section 10](#10-where-the-two-drafts-disagreed)). A Codex red-team
then attacked the merged plan as a shop owner, a customer on a cheap Android and the phase 1 engineer, and its
twelve findings are applied here.

## 1. The bet

A shop does not buy "3D". It buys **customers who arrive already understanding the bike**: which groupset,
which wheels, what the upgrade path costs, and why this model and not the one below it. That makes floor time
shorter and the conversation better. Every view is judged by one question: does it help a customer understand
a specific bike, or help a salesperson explain it?

What follows from that:

- **New bikes, explained part by part.** A 2026 road bike has forty brand photos, but no page lets a customer
  look at *this shop's build* up close, tap the rear derailleur and read what it is, or see that the wheels can be
  upgraded for $600. The 3D model with **component pins** and **upgrade pins** is the advantage. Because a model is
  sold many times, one capture serves every unit of that model, and later every dealer if a brand supplies it.
- **Inform, then hand over to a person.** The page sells nothing by itself. Its one action, **Talk to a
  salesperson**, sends a short message by email or SMS with the bike and the parts the customer asked about.
- **The customer never "uses an app".** They tap a link (the shop's site, Instagram, a QR on the floor bike's
  tag, a text from staff). Specs and the contact button never wait for the model to load.
- **Staff have one hand and 30 seconds.** Floor tools are big buttons, no setup, task words ("Show customer",
  "Preview"), never "Edit mode" or "Present mode".
- **3D is the differentiator, not a gate.** A model can be listed with photos and specs first and get its 3D
  capture later.

## 2. Challenging the three-screen brief

The brief asked for an admin screen, a shop screen and a client screen. Each name hides two different things:

| Brief | Problem | Plan |
|---|---|---|
| Admin | Mixes the **shop owner** (bikes, staff, branding, messages) with **us**, the platform (tenants, storage, billing, support). | **Studio** for the shop. A thin **Platform console** for us, not before about ten active shops; until then, audited database operations and scripts. |
| Shop | The back office and the shop floor are different jobs on different devices. | Back office lives in **Studio**. The floor gets **Show customer**: the bike page in an assisted, big-button variant on a shared tablet, and **Window mode** for a dedicated shop-window screen. These are modes of the bike page, not a separate app. |
| Client | A viewer is not what a buyer needs. | A **Bike page** (one bike: decide and act) and a **Storefront** (the shop's catalog). Both public, no customer login. The **Embed** on the shop's own site is the main way customers reach it. |

Plus two screens the brief did not name, which a shop will ask for in week one:

- **Messages** (in Studio): "Talk to a salesperson" messages from bike pages (sizing, upgrades, test rides). Without
  them the customer page has no purpose.
- **Captures** (in Studio): uploads from the iPhone app, and later photo/video reconstruction jobs, waiting to
  become bikes. This replaces today's "AirDrop a zip to a laptop and drop it on the viewer".

The resulting screens:

- **Studio**: Library, Bike workspace, Messages, Captures, Settings.
- **Bike page**, with the Show customer and Window modes.
- **Storefront** and **Embed**.
- **Talk to a salesperson** (contact sheet).
- **Platform console**, later.
- **iPhone app**, which exists and gains "Upload".

## 3. People and their jobs

| Person | Device | Jobs |
|---|---|---|
| **Owner / manager** | laptop, iPad | list bikes, set prices, choose what is public, brand the pages, see which bikes and links bring requests, invite staff, pay us |
| **Staff who capture** (mechanic, salesperson) | iPhone, shared iPad | list a bike between repair jobs: photos and specs first, a 3D capture when there is time, then areas, component and upgrade pins and reused snippets; save a draft. Mechanics know the components; salespeople own the customer wording. How long each step really takes is measured with the pilot shop before any target is promised |
| **Salesperson on the floor** | shared iPad, shop TV | show a bike, or two side by side, at the area the customer asks about; hand off a link; reset for the next customer |
| **Customer at home** | phone, often over 4G | understand the bike before visiting: components, upgrade options, sizes, close-ups; message a salesperson |
| **Customer in store** | their own phone, via QR | look again later, send it to a partner, come back |
| **Brand rep** | any | look at a dealer's demo bike. The public bike page covers this; no rep portal until a brand pays for it |
| **Us (platform)** | laptop | onboard shops, fix failed uploads, watch storage and limits, suspend abuse; never browse shop data by default |

## 4. The screens

### 4.1 Studio: Library

- **Who**: owner and staff.
- **Entry**: `/studio`, the default after sign-in.
- **Devices**: laptop and iPad landscape; usable on a phone.
- **Exists**: no. Today there is one scene at a time in browser storage.

```
┌ Brew Cycles ▾ ─────────────────────────────────────────────────── [＋ Add bike] (DM) ┐
│ Bikes   Messages ③   Captures ①   Storefront ↗   Settings                             │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ [Search…]   State: All ▾  Type ▾  Brand ▾  Size ▾                       ▦ grid ☰ list │
│ Needs attention: 2 drafts missing close-ups · 1 message unanswered for 24 h           │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                                  │
│ │ ⟳ 3D     │ │ ⟳ 3D     │ │ ⟳ 3D     │ │ ▒ photos │                                  │
│ │ Aero R1  │ │ Endurace │ │ Brompton │ │ Gravel X │                                  │
│ │ $4,299   │ │ $1,850   │ │ $1,200   │ │ $2,100   │                                  │
│ │ ● Live   │ │ ● Live   │ │ ◐ Unavail│ │ ○ Draft  │                                  │
│ │ 312 views│ │ 2 msgs   │ │ no stock │ │ 4/6 ready│                                  │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘                                  │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- **States**: Draft → Live → Archived, plus **Unavailable** (no Reserved or Sold: the page lists a *model*
  the shop carries, not one physical unit).
  - **Unavailable**: the model is out of stock or discontinued. The page stays up and says "Ask us about
    availability", so old links still inform.
  - Archived models leave the public site.
- Each card shows the one number that matters in its state: views or messages when live, readiness when draft.
- **Add bike** starts a bike from a capture in the inbox, a `.bikecapture.zip`, a GLB, or just photos and specs.

### 4.2 Studio: Bike workspace

- **Who**: staff and owner.
- **Entry**: `/studio/bikes/:id`.
- **Exists, partly**: today's Edit mode, with areas, comments, spec sheet, model panel, crop and undo, becomes
  the tool area of this page. Missing today: shop identity, cloud save, stock fields, publish state and the
  readiness check.

```
┌ ← Bikes   Endurace CF 7 · 2026               Draft · Saved   [Preview as customer] [Publish] ┐
├────────────────────────────────────────────┬────────────────────────────────────────────────┤
│                                            │ Ready to publish  4/6                          │
│            3D stage                        │  ✓ Price, sizes, specs                         │
│         ● ● ●  pins     areas ▸            │  ✓ 5 areas                                     │
│                                            │  ✓ Poster image                                │
│                                            │  ✗ Upgrades: none added yet                    │
│                                            │  ✗ Close-ups missing: rear derailleur, cockpit │
│ Next tap adds:                             │────────────────────────────────────────────────│
│ [Component ●] [Upgrade ●]                  │ Details | Areas | Comments | Specs | Photos    │
│                                            │ Snippet: "Shimano 105 Di2" → insert (6 bikes)  │
└────────────────────────────────────────────┴────────────────────────────────────────────────┘
```

- **Upgrades are structured**: each Upgrade pin names the stock part, the upgrade part, its price difference
  ("+$600") and an optional note ("ask about fitting time"). Upgrade prices show as add-ons to the model price,
  never as a configurator total.
- **Pin kinds**:
  - **Component**: what a part is and why it matters ("Shimano 105 Di2: wireless electronic shifting").
  - **Upgrade**: what the shop can swap or add, with the price difference.

  Customers can filter by kind on the bike page.
- **Snippets**: a shop-wide library of reusable comments, keyed by component ("Shimano 105 Di2", "tubeless ready").
  Writing copy is the real cost of each listing, and snippets cut it to minutes.
- **Readiness check**:
  - Encodes what a good listing needs.
  - Uses the capture checklist the iPhone app already saves, so it can say "no derailleur close-up".
  - Warns, but never blocks: a single-person shop can always publish.
- **Publishing is versioned**:
  - Publish creates a public snapshot.
  - Later edits stay in the draft until the shop publishes again, so customers never see half-finished work.
  - Shops can roll back to the previous version.
- **Photos only on a phone**: on a phone this page shows the checklist and status. 3D editing waits for a
  bigger screen.

### 4.3 Bike page (the customer view)

- **Who**: customers at home and in store.
- **Entry**: `/s/:shop/:bike`. QR codes, social links and embeds all lead here, and today's `?scene=` links
  keep working.
- **Device**: a phone, over 4G.
- **Exists, partly**: the share link opens a read-only Present mode, with area deep links, the spec sheet,
  close-up photos and kiosk mode. This is the most important screen.

```
┌──────────────────────────────┐   phone, 390 px
│ BREW CYCLES              ⇪   │
│┌────────────────────────────┐│
││ poster image (instant)     ││ ← still image first, 3D streams in behind it
││ → live 3D when ready  ⟳    ││
││ Fork · Drivetrain · Cockpit││ ← area chips (guided tour)
│└────────────────────────────┘│
│ Aero R1 · 2026               │
│ from $4,299 · sizes 49–61    │
│ ── Components ───────────── │
│ ● Drivetrain  Shimano 105 Di2│ ← tap: the 3D view flies to the part
│ ● Wheels      Aero 45 carbon │
│ ● Brakes      Hydraulic disc │
│ ── Upgrades ─────────────── │
│ ▲ Wheels → DT Swiss  +$600   │ ← tap: flies to the part, shows the note
│ ▲ Saddle → Fizik     +$120   │
│ ── Key specs ────────────── │
│ (below the fold: photos)     │
│┌────────────────────────────┐│
││ [Talk to a salesperson]    ││ ← sticky, the page's one action
│└────────────────────────────┘│
└──────────────────────────────┘
```

- **The still image comes first**, within a byte budget:
  - The page with its facts and poster stays under about 300 KB, with the poster image under about 150 KB.
  - Model bytes load only when the visitor taps "View in 3D" when the phone signals Save-Data, a slow connection
    or low memory; otherwise they load once the page is idle.
  - The 3D view shows download progress, a timeout with **Retry**, and a plain failure message that leaves the
    rest of the page working.
  - Pages are generated as static HTML with Open Graph tags, so link previews in texts and social apps look right.
- **Components and upgrades are the content**: two lists that mirror the pins. Tapping a row flies the 3D view
  to that part and opens its card. The guided tour (today's Present mode) walks the areas in order.
- **Price is optional**: the shop chooses whether to show "from $4,299" and upgrade price differences. It is
  information, not a cart: there is no total, no checkout and no hold.
- **One action: Talk to a salesperson.** It opens the contact sheet (4.7). On phones it is sticky at the bottom.
- **Fit line**: "Sizes 49–61; ask us to find yours" from the model's size table, never a guarantee.

### 4.4 Show customer and Window mode (the shop floor)

- **Who**: a salesperson with a customer, and the shop-window screen.
- **Entry**:
  - Studio → **Show customer**;
  - `/s/:shop/:bike?mode=store` on the shared iPad;
  - `/s/:shop/window` on a dedicated screen.
- **Exists, partly**: Present mode, area stepping and kiosk auto-advance.

```
┌ Brew Cycles · Showing ───────────────────────────────── [Compare ⇆] [QR ▣] [Done ↺] ┐
├──────────────────────────────────────────┬──────────────────────────────────────────┤
│           Aero R1   $4,299               │          Endurace CF 7   $1,850          │
│                                          │                                          │
│            3D (camera synced             │            3D (same view                 │
│             with the right)              │             as the left)                 │
│                                          │                                          │
│  ◀  Drivetrain: Shimano 105 Di2  ▶       │  ◀  Drivetrain: Shimano 105, mech.  ▶    │
├──────────────────────────────────────────┴──────────────────────────────────────────┤
│   Overview    Fork    Drivetrain    Cockpit    Wheels    Saddle     (64 px targets)  │
│                       [Request a test ride]    [Ask]                                │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

- **Compare**:
  - Shows two bikes with a synced camera and the same area on both, matched by area name.
  - This is the conversation salespeople have all day: "why is this one $2,400 more?"
  - It is phase 2, and we confirm with the pilot shop that they actually use it before polishing it.
- **QR hand-off**: the customer scans the code and gets the bike page on their phone. The shop's numbers show
  "taken home from the floor".
- **Done ↺**: resets the shared iPad for the next customer and clears anything they typed.
- **Window mode**: a locked kiosk loop across every live bike, for a dedicated display only. Exiting needs a
  PIN. On the shared iPad, Show customer is not a kiosk.
  - It refreshes the bike list every few minutes and drops any bike that is no longer Live, so the window never
    shows a sold or held bike as available.
  - If the network or a model fails, it falls back to that bike's poster with its price, then to a shop slide
    (logo, hours, "Ask inside"). It recovers on its own when the network returns.
  - It keeps the screen awake through the Wake Lock API, and the setup guide covers the display's own sleep settings.

### 4.5 Storefront

- **Who**: customers.
- **Entry**: `/s/:shop`.
- **Exists**: no. This is the roadmap's "Catalog page".

It shows:
- a grid of live bikes with turntable thumbnails;
- filters for type, brand, size and price;
- a "Recently sold" row.

It is deliberately thin. Most shops already have a website, so the **Embed is the main way customers arrive**,
and the storefront serves shops without a site and Instagram bio links.

### 4.6 Embed

- **Exists**: the `embed.html` iframe and `<bike-viewer>`.
- **What it needs for commercial use**:
  - "Copy embed" for each bike in Studio;
  - a whole-catalog embed (the storefront grid in an iframe);
  - copy-paste guides for Shopify, WooCommerce and Squarespace.
- The embed is for discovering and looking at bikes. Its actions open the bike page or Talk to a salesperson, so
  every lead ends up in one inbox.

### 4.7 Talk to a salesperson

- **Who**: customers.
- **Exists**: no.
- **Opens as**: a sheet over the bike page, with the bike filled in.

```
┌ Talk to Brew Cycles about the Aero R1 ─────────────┐
│ What would you like to know?                       │
│ [☐ Sizing] [☐ Upgrades] [☐ Test ride] [☐ Other]    │
│ Name             [______________________]          │
│ Email or mobile  [______________________]          │
│ Reply by         (•) Email  ( ) Text message       │
│ Message          [______________________]          │
│ Brew Cycles replies within one business day.       │
│ Privacy: used only to answer you; deleted after    │
│ 12 months. More ›                                  │
│   [ Send ]        or call (512) 555-0142           │
└────────────────────────────────────────────────────┘
```

- **Short form**: a name and one contact method, and how the customer wants the reply (email or text).
  Topic chips are optional. If the customer tapped an upgrade before opening the sheet, it is named in the message.
- **SMS consent**: choosing "Text message" shows one line of consent copy and "Reply STOP to opt out" (TCPA and
  carrier rules). Email needs no extra consent.
- **After sending**: a confirmation with what happens next and the shop's phone number. A double tap or a resend
  within a few minutes does not create a second message.
- **Abuse and delivery**: a honeypot field, per-IP and per-bike rate limits, retried notifications, and a red
  "undelivered" alert in Studio if a message cannot be delivered.
- **No browsing history on messages.** A message holds only what the customer typed and the bike.

### 4.8 Studio: Messages

- **Who**: owner and salespeople.
- **What it shows**: requests per bike, with type, contact, source (Instagram, QR, embed, direct), time and status.
  - Statuses: New, Contacted, Test ride booked, Won, Lost.
  - Notifications by email, and SMS for the shop if it wants, for each new message.
- **Scope**: assign a lead to someone and export CSV. This is not a CRM.
- **Privacy tools**: delete a lead, export one person's data, and delete messages automatically after the shop's
  retention period (12 months by default).

### 4.9 Studio: Captures

Incoming uploads from the iPhone app (roadmap: Upload to viewer), and later photo/video reconstruction jobs
(Milestone 1.5).

- **Statuses**: uploading, processing, ready, and failed with what to do next.
- **Create bike**: opens the workspace with auto-orient and crop already applied, and the checklist carried over.

### 4.10 Studio: Settings

- **Shop**: profile (name, address, hours, phone, SMS number) and branding (logo and accent color first; fonts later).
- **Domains**: a subdomain or path now, custom domains later.
- **Staff and roles**:
  - **Owner**: everything, including billing.
  - **Editor**: publish and answer messages.
  - **Contributor**: capture and save drafts only.

  One person can belong to several shops.
- **Content**: request actions, snippets and size tables.
- **Billing**: plan and payment.

### 4.11 Platform console (us, later)

- **Shows**: shops, plan, live bikes, storage, upload failures, last activity and suspension.
- **Support access**: per shop, time-limited and logged. It never shows bike content in the overview.
- **When**: not before about ten active shops. Until then, the database dashboard and scripts are the console.

### 4.12 iPhone app

- **Exists**: capture, checklist and bundle export.
- **Commercial changes**:
  - sign in with the shop account;
  - **Upload** to Captures instead of AirDrop;
  - a "my drafts" list.
- The in-app 3D viewer (roadmap M4) is worth less than Show customer on an iPad; it moves down.

## 5. How people move between screens

```
     Instagram · texts · Google · QR on the tag · shop website (Embed)
                                  │
       Storefront ─────────────►  Bike page ──► Guided tour (areas, components, upgrades)
            ▲                      │    ├─────► Talk to a salesperson ──► Messages (Studio) ──► email / SMS reply
            │                      │    └─────► Sold → similar bikes
  Show customer / Window ── QR ────┘
            ▲
  Studio: Captures ──► Bike workspace ──► Preview as customer ──► Publish ──► Library
            ▲
  iPhone app (Upload)
```

Every link carries its source (QR, Instagram, embed), so Messages and the Library know which channel works.

## 6. What we will not build, and why

- **Checkout, carts or deposits in phases 1–2.** They touch payment, tax, stock races and each shop's own policy,
  and bikes over $1k sell in person after a test ride. Requests plus a human reply come first. Deposits only come
  once a shop asks and picks a system of record.
- **Customer accounts.** No login to look at, share or ask about a bike.
- **POS or inventory sync in phases 1–2.** We only own the listing state and keep an optional external ID. The page
  never claims live availability we do not sync.
- **Real-time collaborative editing** (the roadmap's "Collaborative comments"). One to three people edit per shop,
  so last-write-wins, undo history and "edited by" are enough.
- **A separate tablet app.** Show customer is a web mode that can be installed as a PWA.
- **AR "bike in your room", AI-written descriptions, rep portals, session replay.** They are demos, extra
  maintenance or privacy cost, and none of them answer what the bike is made of or how it fits.
- **A bespoke platform admin as an early milestone.**

## 7. Data and backend

- **Every row has a shop**: tenant key `shopId` on everything. Access is never granted by an unguessable URL alone.
- **Tables**:
  - `Shop`: slug, profile, branding, request actions, plan.
  - `Member`: user, shop, role.
  - `Bike`: shop, slug, state, price (optional), currency, sizes, type, brand, model year, external ID, published version, draft version.
  - `BikeVersion`: a frozen `bike-scene/1` scene, poster, model and photo object IDs, published by, published at.
  - `Capture`: shop, bundle object, status, error.
  - `Lead`: shop, bike, type, contact, time window, status, assignee, source, consent notice version, delete-after date.
  - `Snippet`: shop, component key, markdown.
  - `Event`: shop, bike, kind, source, day-scoped session hash.
- **Stock stays out of the scene**: price and availability change often, so they live in `Bike`.
  `bike-scene/1` grows only by optional, presentation-only fields:
  - pin `kind` (component, upgrade), and for upgrades the part names and price difference;
  - a `poster`;
  - a branding reference.

  Following AGENTS.md, that contract change ships first and alone. `bike-share/1` stays a portable package; it is
  not a permission model.
- **Files**:
  - Models and photos are 5–30 MB objects with stable IDs, uploaded through signed URLs.
  - Drafts are private. Published versions are public and cacheable.
- **Analytics**:
  - Events: page view, model ready or failed, area opened, component or upgrade opened, contact button tapped, message
    sent, QR or campaign source.
  - Only aggregate counters per bike, per day and per source. Phase 1 has no session hash and no device storage.
    IP addresses are not stored with events, and server logs are kept for 30 days for operations only.
  - Without identifiers or device storage, no consent banner is expected. Before launch, check that against the
    ePrivacy rules of the pilot market, and add a hash only if the aggregate counts prove insufficient. A hash
    would count as pseudonymous personal data.
- **Privacy roles (US first; GDPR-ready)**: the US launch needs a privacy notice at collection (CCPA/CPRA style),
  TCPA consent for texts, and deletion on request. The roles below also make an EU launch possible later:
  - The **shop is the controller** of its messages, and **we are the processor**, under a data processing agreement
    in the terms of service.
  - The lawful basis for a request is steps taken at the customer's request before a contract (Art. 6(1)(b)).
  - The form shows a collection notice (Art. 13): who, why, how long, and how to delete. The shop configures it;
    we provide the default.
  - Retention defaults to 12 months. Messages can be deleted or exported, staff only see their own shop's messages, and
    a breach procedure is documented before the first real lead.
- **Consumer claims**: component names and upgrade prices are the shop's own statements; the page dates them
  ("specs checked <date>") and says upgrade prices are confirmed in store.

## 8. Phases

**Phase 0: clickable prototype (no backend).**
- A `/app/proto/` page on the PR preview with tabs: Studio · Bike workspace · Bike page · Show customer · Storefront ·
  Talk to a salesperson.
- It uses the demo bike and made-up data, so the owner can try each screen on a laptop, an iPad and a phone.
- It also runs the hosting cost spike.

*Done when*: the owner has clicked through every screen and settled the decisions in section 9.

**Phase 1a: the pilot slice (one shop, operated by us).**
- One shop's hosted listings. There is no signup; we create the shop and its staff logins.
- Private drafts and published snapshots.
- Today's editor, saving to the hosted draft instead of browser storage, with photos-only listings allowed.
- The bike page within its byte budget, with component and upgrade lists and Talk to a salesperson → email or SMS.
- Each bike page is generated as static HTML when it is published, with Open Graph tags, so texts and
  Instagram previews work without a page server.
- The privacy notice, retention and deletion from section 7.
- Measure how long listing one bike takes, step by step, with the shop's staff.

*Done when*: the pilot shop lists bikes it chose (photos first, 3D where it helps), shares them, and a customer
request reaches the shop and gets answered. The listing-time target is set from what was measured.

**Phase 1b: what 1a proved is needed.**
- The Library with states, logo and accent color, pin kinds, QR codes, and the embed pointed
  at the new URLs.
- Shop accounts and roles, the step that turns this into a product for more than one shop.

Phase 1b only starts once a real request has come in through phase 1a.

**Phase 2: the shop floor and the shop's own site.**
- Show customer (Done ↺, QR hand-off), Compare (once the pilot confirms they use it) and Window mode.
- The Storefront, per-bike and catalog embeds, and snippets.
- iPhone Upload → Captures, the readiness check fed by the capture checklist.
- Roles, lead assignment and source reports.

*Done when*: a three-person shop keeps dozens of listings current, splits capturing from selling, and knows which
links bring requests.

**Phase 3: many shops, and the systems they already use.**
- Self-serve signup, billing, the Platform console and custom domains.
- Calendar-backed test rides, and optional deposits where a shop asks for them.
- Inventory or POS import where demand is proven.
- Brand scans of new-bike models shared across their dealers.

*Done when*: a shop we have never met signs itself up and publishes a bike.

## 9. Owner decisions

Decided on 12 Nov 2026:

| Question | Decision |
|---|---|
| Which shops and bikes first? | **New bikes only**: shops showing their current-season models. No used bikes, so no condition notes. |
| What is the customer page for? | **Informing, not selling**: 3D, components, upgrades. Its one action is **Talk to a salesperson**. No hold, reservation or checkout. |
| Launch market | **US**: English, USD, email or SMS replies, plus a call button. Privacy section adapted: CCPA/CPRA-style notice, and TCPA consent for texts. |
| Bun | 1.4.4 pinned, empty trusted-scripts list, GitHub Actions on version tags. |

Still open; none of these block the prototype:

1. **Hosting**: decided by the phase 0 cost spike (Cloudflare R2/Workers/D1 vs Supabase).
2. **Product name and domain.**
3. **Pilot shop**: one US shop with a few current-season models.
4. **Pricing**: per shop per month with a cap on live models (recommended) vs per model.
5. **Who captures**: shop staff by default, or brands supply one scan per model for every dealer. New bikes make
   brand scans more valuable than before.

## 10. Where the two drafts disagreed

| Topic | Claude draft | Codex draft | Settled |
|---|---|---|---|
| Is 3D required to list? | yes, 3D is the hero | no, photos and specs are enough to publish | Listing with photos is allowed and comes first in the pilot; 3D stays the differentiator, and its real cost in staff time is measured |
| Compare on the floor | phase 2, the floor's main feature | phase 3, unproven | Phase 2, polished only after the pilot shop confirms they use it |
| Publishing | edits go live | versioned snapshots, drafts invisible | Versioned (Codex) |
| Stock fields | in `Bike`, with pin kinds in the scene | outside the scene | Stock in `Bike`; the scene only gains presentation fields |
| Messages show viewed areas | yes | avoid person-level tracking | No (reversed after the red-team: a checkbox does not make it safe or clear). Per-bike aggregate counts only |
| Hosting | Cloudflare, for egress | decide after a prototype | Phase 0 cost spike decides |
| Shared iPad vs kiosk | one Floor mode | kiosk only on dedicated displays | Show customer (shared, resettable) and Window mode (locked) |
| Roles | Owner, Staff | Owner, Editor, Viewer | Owner, Editor, Contributor (capturers save drafts) |
