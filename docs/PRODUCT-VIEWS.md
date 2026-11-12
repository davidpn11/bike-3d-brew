# Product views: bike-3d-brew for bike shops

Planning document for the commercial product: who uses it, which screens it has, how they connect, what we
deliberately do not build, and in what order. Nothing here is built unless marked **exists**. Owner decisions
are collected in [section 9](#9-owner-decisions).

How it was written: Claude and Codex each drafted a proposal independently from the same inputs. The drafts
were merged and the disagreements settled ([section 10](#10-where-the-two-drafts-disagreed)). A Codex red-team
then attacked the merged plan as a shop owner, a customer on a cheap Android and the phase 1 engineer, and its
twelve findings are applied here.

## 1. The bet

A shop does not buy "3D". It buys **fewer wasted visits and test rides, faster sales of used and custom bikes,
and listings that look better than everyone else's** on WhatsApp, Instagram and its own site. Every view is
judged by one question: does it help a shop sell a specific bike sooner, or help a customer decide sooner?

What follows from that:

- **The wedge is used, consignment and custom bikes.** A stock 2026 road bike already has forty brand photos.
  A used bike with a scratched top tube and upgraded wheels has none: it is unique, its condition matters, and
  trust is what blocks the sale. A 3D model with pinned condition notes is a real advantage there. New-bike
  stock comes later, when a brand supplies one scan that every dealer reuses.
- **The customer never "uses an app".** They tap a link (WhatsApp, Instagram, a QR on the tag, the shop's
  site). The customer view is a fast product page with 3D as the hero, not a 3D viewer with a price on it.
  Price, size, condition and a way to act never wait for the model to load.
- **Staff have one hand and 30 seconds.** Floor tools are big buttons, no setup, task words ("Show customer",
  "Preview"), never "Edit mode" or "Present mode".
- **3D is the differentiator, not a gate.** A bike can be listed with photos and specs first and get its 3D
  capture later, so the shop's catalog is complete from day one and our capture app never blocks a listing.

## 2. Challenging the three-screen brief

The brief asked for an admin screen, a shop screen and a client screen. Each name hides two different things:

| Brief | Problem | Plan |
|---|---|---|
| Admin | Mixes the **shop owner** (bikes, staff, branding, leads) with **us**, the platform (tenants, storage, billing, support). | **Studio** for the shop. A thin **Platform console** for us, not before about ten active shops; until then, audited database operations and scripts. |
| Shop | The back office and the shop floor are different jobs on different devices. | Back office lives in **Studio**. The floor gets **Show customer**: the bike page in an assisted, big-button variant on a shared tablet, and **Window mode** for a dedicated shop-window screen. These are modes of the bike page, not a separate app. |
| Client | A viewer is not what a buyer needs. | A **Bike page** (one bike: decide and act) and a **Storefront** (the shop's catalog). Both public, no customer login. The **Embed** on the shop's own site is the main way customers reach it. |

Plus two screens the brief did not name, which a shop will ask for in week one:

- **Leads** (in Studio): questions, test-ride requests and reservation requests from bike pages. Without
  them the customer page has no purpose.
- **Captures** (in Studio): uploads from the iPhone app, and later photo/video reconstruction jobs, waiting to
  become bikes. This replaces today's "AirDrop a zip to a laptop and drop it on the viewer".

The resulting screens:

- **Studio**: Library, Bike workspace, Leads, Captures, Settings.
- **Bike page**, with the Show customer and Window modes.
- **Storefront** and **Embed**.
- **Request form**.
- **Platform console**, later.
- **iPhone app**, which exists and gains "Upload".

## 3. People and their jobs

| Person | Device | Jobs |
|---|---|---|
| **Owner / manager** | laptop, iPad | list bikes, set prices, choose what is public, brand the pages, see which bikes and links bring requests, invite staff, pay us |
| **Staff who capture** (mechanic, salesperson) | iPhone, shared iPad | list a bike between repair jobs: photos and specs first, a 3D capture when there is time, then areas, condition notes and reused snippets; save a draft. Mechanics know the components; salespeople own the customer wording. How long each step really takes is measured with the pilot shop before any target is promised |
| **Salesperson on the floor** | shared iPad, shop TV | show a bike, or two side by side, at the area the customer asks about; hand off a link; reset for the next customer |
| **Customer at home** | phone, often over 4G | decide whether the bike is worth a trip: price, size and fit, condition, close-ups; ask or request a test ride |
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
│ Bikes   Leads ③   Captures ①   Storefront ↗   Settings                               │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ [Search…]   State: All ▾  Type ▾  New/Used/Consignment ▾  Size ▾        ▦ grid ☰ list │
│ Needs attention: 2 drafts missing close-ups · 1 lead unanswered for 24 h              │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                                  │
│ │ ⟳ 3D     │ │ ⟳ 3D     │ │ ⟳ 3D     │ │ ▒ photos │                                  │
│ │ Aero R1  │ │ Endurace │ │ Brompton │ │ Gravel X │                                  │
│ │ $4,299   │ │ $1,850 U │ │ $1,200 C │ │ $2,100 U │                                  │
│ │ ● Live   │ │ ● Live   │ │ ◐ Reserv.│ │ ○ Draft  │                                  │
│ │ 312 views│ │ 2 leads  │ │ held→Fri │ │ 4/6 ready│                                  │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘                                  │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- **States**: Draft → Live → Reserved → Sold → Archived, plus **Unavailable**.
  - **Reserved** always has an expiry date ("held until Fri"). At expiry the bike goes back to Live and the person
    who set the hold is notified. The public page says "On hold until Friday", never "Sold".
  - **Unavailable** is a temporary pull: out for a test ride, in the workshop, or the price is being reviewed.
    The page stays up and says "Not available right now".
  - Sold bikes keep their page, which says "Sold" and offers similar bikes, because old Instagram posts keep
    sending traffic.
  - Archived bikes leave the public site.
  - Every live page shows "Availability checked on <date>". Library flags bikes not checked for 14 days, so a
    stale "In store" never lingers.
- Each card shows the one number that matters in its state: views or leads when live, readiness when draft.
- **Add bike** starts a bike from a capture in the inbox, a `.bikecapture.zip`, a GLB, or just photos and specs.

### 4.2 Studio: Bike workspace

- **Who**: staff and owner.
- **Entry**: `/studio/bikes/:id`.
- **Exists, partly**: today's Edit mode, with areas, comments, spec sheet, model panel, crop and undo, becomes
  the tool area of this page. Missing today: shop identity, cloud save, stock fields, publish state and the
  readiness check.

```
┌ ← Bikes   Endurace CF 7 · Used               Draft · Saved   [Preview as customer] [Publish] ┐
├────────────────────────────────────────────┬────────────────────────────────────────────────┤
│                                            │ Ready to publish  4/6                          │
│            3D stage                        │  ✓ Price, size, condition                      │
│         ● ● ●  pins     areas ▸            │  ✓ 5 areas                                     │
│                                            │  ✓ Poster image                                │
│                                            │  ✗ Condition notes (used bike)                 │
│                                            │  ✗ Close-ups missing: rear derailleur, cockpit │
│ Next tap adds:                             │────────────────────────────────────────────────│
│ [Feature ●] [Condition ●] [Upgrade ●]      │ Details | Areas | Comments | Specs | Photos    │
│                                            │ Snippet: "Shimano 105 Di2" → insert (6 bikes)  │
└────────────────────────────────────────────┴────────────────────────────────────────────────┘
```

- **Condition is structured, not free text**: for used and consignment bikes the shop fills in
  - a grade from a fixed scale (Like new, Very good, Good, Fair) with a one-line definition of each;
  - "Inspected on <date> by <name>";
  - a known-defects checklist (frame damage, crash history, wear on chain, cassette, brake pads and tyres,
    service due), each item either "none found" or linked to a Condition pin.

  The public page labels all of this "Brew Cycles' assessment" and shows known defects as prominently as the
  grade. The workshop can correct it, and corrections are dated.
- **Pin kinds**:
  - **Feature**: what sells the bike.
  - **Condition**: scratches and wear, stated honestly; this builds trust on used bikes.
  - **Upgrade**: what the shop can add, such as wheels or a fit.

  Customers can filter by kind, and Show customer hides Condition pins by default.
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

- **Who**: customers at home and in store, brand reps.
- **Entry**: `/s/:shop/:bike`. QR codes, social links and embeds all lead here, and today's `?scene=` links
  keep working.
- **Device**: a phone, over 4G.
- **Exists, partly**: the share link opens a read-only Present mode, with area deep links, the spec sheet,
  close-up photos and kiosk mode. This is the most important screen.

```
┌──────────────────────────────┐   phone, 390 px
│ BREW CYCLES           ♡  ⇪   │
│┌────────────────────────────┐│
││ poster image (instant)     ││ ← still image first, 3D streams in behind it
││ → live 3D when ready  ⟳    ││
││ Fork · Drivetrain · Cockpit││ ← area chips (guided tour)
│└────────────────────────────┘│
│ Endurace CF 7                │
│ $1,850 · Used, Very good ⓘ   │ ← the shop's assessment, inspected 3 Jun
│ Size 56 · guide 175–183 cm   │
│ ✓ In store, Lisbon           │
│ ── What we noticed ───────── │
│ ● 2 condition notes  →       │ ← opens the 3D view at those pins
│ ── Key specs ─────────────── │
│ Frame   Carbon               │
│ Group   Shimano 105 Di2      │
│ (below the fold: photos,     │
│  more from Brew Cycles, ph 2)│
│┌────────────────────────────┐│
││ [Request a test ride]      ││ ← sticky; only the actions this shop answers
│└────────────────────────────┘│
└──────────────────────────────┘
```

- **The still image comes first**, within a byte budget:
  - The page with its facts and poster stays under about 300 KB, with the poster image itself under about
    150 KB, so it is readable within seconds on a slow 4G phone.
  - A snapshot (Snapshot export exists) paints at once. Model bytes load only when the visitor taps "View in 3D"
    when the phone signals Save-Data, a slow connection (`navigator.connection`) or low memory; otherwise they
    load once the page is idle.
  - The 3D view shows download progress, a timeout with **Retry**, and a plain failure message that leaves
    the rest of the page working.
  - Pages are server-rendered HTML with Open Graph image, title and price, so WhatsApp and Instagram previews
    look right and search engines index each bike.
  - When WebGL fails, or the visitor prefers reduced motion, the page shows photos and still works.
- **The page works before the 3D does**: price, availability, condition, fit and the contact action are above
  the fold. The 3D view never blocks them.
- **Actions are set per shop, and per bike**: request a test ride, ask a question, WhatsApp or call. The page
  only shows actions this shop has said it answers, with one primary. The default (WhatsApp-first or
  email-first) is chosen with the pilot shop for its market. A "Hold it for me" button is a request until the
  shop confirms it, and the page says so. Nothing on the page implies a booking is confirmed.
- **Guided tour**: today's Present mode, with areas, comment cards and leader lines.
- **Fit line**: from a size table for each model, labelled as a guide ("usually fits 175–183 cm; come in for
  a fit"). After price, it is the most common question. It is never a guarantee.
- **Used bikes**: condition and known defects show openly. The page never implies a sold bike is available.
- **No customer accounts**: "♡" is stored on the device, and sharing is the link.

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
- filters for type, size, price and new/used/consignment;
- a "Recently sold" row.

It is deliberately thin. Most shops already have a website, so the **Embed is the main way customers arrive**,
and the storefront serves shops without a site and Instagram bio links.

### 4.6 Embed

- **Exists**: the `embed.html` iframe and `<bike-viewer>`.
- **What it needs for commercial use**:
  - "Copy embed" for each bike in Studio;
  - a whole-catalog embed (the storefront grid in an iframe);
  - copy-paste guides for Shopify, WooCommerce and Squarespace.
- The embed is for discovering and looking at bikes. Its actions open the bike page or the request form, so
  every lead ends up in one inbox.

### 4.7 Request form

- **Who**: customers.
- **Exists**: no.
- **Opens as**: a sheet over the bike page, with the bike and the request type already filled in.

```
┌ Ask Brew Cycles about Endurace CF 7 ───────────────┐
│ ( ) Question  (•) Test ride  ( ) Hold it for me     │
│ Name            [______________________]           │
│ Email or phone  [______________________]           │
│ When suits you  [Sat morning__________] (optional) │
│ Message         [______________________]           │
│ Brew Cycles replies within one working day.        │
│ Privacy: Brew Cycles uses this to answer you and   │
│ deletes it after 12 months. More ›                 │
│                               [ Send request ]      │
└────────────────────────────────────────────────────┘
```

- **Short form**: a name and one contact method. A test ride asks for a time window and is not a confirmed
  booking. "Hold it for me" is a request, not a guarantee.
- **After sending**, the customer sees a confirmation with what happens next and the shop's phone number as a
  fallback. A double tap or a resend within a few minutes does not create a second lead.
- **Abuse**: a honeypot field and per-IP and per-bike rate limits, with no CAPTCHA unless spam shows up.
- **Delivery**: notification emails are retried. If a lead still cannot be delivered, Studio shows a red
  "undelivered" alert, so the core promise never fails silently.
- **No browsing history on leads.** A lead holds only what the customer typed. Which areas get attention is
  shown per bike, in aggregate (see section 7).

### 4.8 Studio: Leads

- **Who**: owner and salespeople.
- **What it shows**: requests per bike, with type, contact, source (Instagram, QR, embed, direct), time and status.
  - Statuses: New, Contacted, Test ride booked, Won, Lost.
  - Notifications by email, and WhatsApp later, for each new lead.
- **Scope**: assign a lead to someone and export CSV. This is not a CRM.
- **Privacy tools**: delete a lead, export one person's data, and delete leads automatically after the shop's
  retention period (12 months by default).

### 4.9 Studio: Captures

Incoming uploads from the iPhone app (roadmap: Upload to viewer), and later photo/video reconstruction jobs
(Milestone 1.5).

- **Statuses**: uploading, processing, ready, and failed with what to do next.
- **Create bike**: opens the workspace with auto-orient and crop already applied, and the checklist carried over.

### 4.10 Studio: Settings

- **Shop**: profile (name, address, hours, WhatsApp) and branding (logo and accent color first; fonts later).
- **Domains**: a subdomain or path now, custom domains later.
- **Staff and roles**:
  - **Owner**: everything, including billing.
  - **Editor**: publish and answer leads.
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
     Instagram · WhatsApp · Google · QR on the tag · shop website (Embed)
                                  │
       Storefront ─────────────►  Bike page ──► Guided tour (areas, condition notes)
            ▲                      │    ├─────► Request form ──► Leads (Studio) ──► email / WhatsApp reply
            │                      │    └─────► Sold → similar bikes
  Show customer / Window ── QR ────┘
            ▲
  Studio: Captures ──► Bike workspace ──► Preview as customer ──► Publish ──► Library
            ▲
  iPhone app (Upload)
```

Every link carries its source (QR, Instagram, embed), so Leads and the Library know which channel works.

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
  maintenance or privacy cost, and none of them answer price, size or condition.
- **A bespoke platform admin as an early milestone.**

## 7. Data and backend

- **Every row has a shop**: tenant key `shopId` on everything. Access is never granted by an unguessable URL alone.
- **Tables**:
  - `Shop`: slug, profile, branding, request actions, plan.
  - `Member`: user, shop, role.
  - `Bike`: shop, slug, state, price, currency, condition, size, type, external ID, published version, draft version.
  - `BikeVersion`: a frozen `bike-scene/1` scene, poster, model and photo object IDs, published by, published at.
  - `Capture`: shop, bundle object, status, error.
  - `Lead`: shop, bike, type, contact, time window, status, assignee, source, consent notice version, delete-after date.
  - `Snippet`: shop, component key, markdown.
  - `Event`: shop, bike, kind, source, day-scoped session hash.
- **Stock stays out of the scene**: price, availability and condition change often, so they live in `Bike`.
  `bike-scene/1` grows only by optional, presentation-only fields:
  - pin `kind` (feature, condition, upgrade);
  - a `poster`;
  - a branding reference.

  Following AGENTS.md, that contract change ships first and alone. `bike-share/1` stays a portable package; it is
  not a permission model.
- **Files**:
  - Models and photos are 5–30 MB objects with stable IDs, uploaded through signed URLs.
  - Drafts are private. Published versions are public and cacheable.
- **Analytics**:
  - Events: page view, model ready or failed, area opened, condition notes opened, request button tapped, request
    sent, QR or campaign source.
  - Only aggregate counters per bike, per day and per source. Phase 1 has no session hash and no device storage.
    IP addresses are not stored with events, and server logs are kept for 30 days for operations only.
  - Without identifiers or device storage, no consent banner is expected. Before launch, check that against the
    ePrivacy rules of the pilot market, and add a hash only if the aggregate counts prove insufficient. A hash
    would count as pseudonymous personal data.
- **Privacy roles (GDPR)**:
  - The **shop is the controller** of its leads, and **we are the processor**, under a data processing agreement
    in the terms of service.
  - The lawful basis for a request is steps taken at the customer's request before a contract (Art. 6(1)(b)).
  - The form shows a collection notice (Art. 13): who, why, how long, and how to delete. The shop configures it;
    we provide the default.
  - Retention defaults to 12 months. Leads can be deleted or exported, staff only see their own shop's leads, and
    a breach procedure is documented before the first real lead.
- **Consumer law**: condition and fit are the shop's own statements. They are structured, dated and attributed,
  and known defects are as visible as the grade (section 4.2). This keeps listings away from misleading
  omissions.
- **Hosting**: most traffic is phones downloading 20 MB models, so egress cost matters. Decide after a thin spike:
  tenant auth, a signed upload, public reads, and the cost of 1,000 views of a 20 MB model on Cloudflare
  (R2, Workers, D1) and on Supabase.

## 8. Phases

**Phase 0: clickable prototype (no backend).**
- A `/app/proto/` page on the PR preview with tabs: Studio · Bike workspace · Bike page · Show customer · Storefront ·
  Request form.
- It uses the demo bike and made-up data, so the owner can try each screen on a laptop, an iPad and a phone.
- It also runs the hosting cost spike.

*Done when*: the owner has clicked through every screen and settled the decisions in section 9.

**Phase 1a: the pilot slice (one shop, operated by us).**
- One shop's hosted listings. There is no signup; we create the shop and its staff logins.
- Private drafts and published snapshots.
- Today's editor, saving to the hosted draft instead of browser storage, with photos-only listings allowed.
- The bike page within its byte budget, with structured condition and the request form → email.
- Each bike page is generated as static HTML when it is published, with Open Graph tags, so WhatsApp and
  Instagram previews work without a page server.
- The privacy notice, retention and deletion from section 7.
- Measure how long listing one bike takes, step by step, with the shop's staff.

*Done when*: the pilot shop lists bikes it chose (photos first, 3D where it helps), shares them, and a customer
request reaches the shop and gets answered. The listing-time target is set from what was measured.

**Phase 1b: what 1a proved is needed.**
- The Library with states and Reserved expiry, logo and accent color, pin kinds, QR codes, and the embed pointed
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

1. **Which shops first?** Recommendation: independent shops strong in used and consignment bikes. Validate with 3–5
   shops before supporting new-bike catalogs.
2. **Hosting**: decide after the phase 0 cost spike (Cloudflare R2/Workers/D1 vs Supabase), on egress cost per model
   view, access control, signed uploads and operating burden.
3. **Product name and domain**: paths on our domain (`/s/:shop/:bike`) at first, subdomains or custom domains later.
4. **Pilot shop**: one real shop for phase 1, ideally one that sells many used bikes.
5. **Pricing**: recommendation is per shop per month, with a cap on live bikes (for example 30), rather than per listing.
6. **Condition notes public by default?** Recommendation: yes on the bike page, because they build trust; hidden by
   default in Show customer.
7. **What does "Hold it for me" mean?** Recommendation: a request with no guaranteed hold until the shop confirms.
   Deposits come in phase 3 at the earliest.
8. **Who captures?** The shop's staff by default; a paid capture service for busy shops is a later option.
9. **Launch market**: languages, currency and the WhatsApp-first vs email-first default.

## 10. Where the two drafts disagreed

| Topic | Claude draft | Codex draft | Settled |
|---|---|---|---|
| Is 3D required to list? | yes, 3D is the hero | no, photos and specs are enough to publish | Listing with photos is allowed and comes first in the pilot; 3D stays the differentiator, and its real cost in staff time is measured |
| Compare on the floor | phase 2, the floor's main feature | phase 3, unproven | Phase 2, polished only after the pilot shop confirms they use it |
| Publishing | edits go live | versioned snapshots, drafts invisible | Versioned (Codex) |
| Stock fields | in `Bike`, with pin kinds in the scene | outside the scene | Stock in `Bike`; the scene only gains presentation fields |
| Leads show viewed areas | yes | avoid person-level tracking | No (reversed after the red-team: a checkbox does not make it safe or clear). Per-bike aggregate counts only |
| Hosting | Cloudflare, for egress | decide after a prototype | Phase 0 cost spike decides |
| Shared iPad vs kiosk | one Floor mode | kiosk only on dedicated displays | Show customer (shared, resettable) and Window mode (locked) |
| Roles | Owner, Staff | Owner, Editor, Viewer | Owner, Editor, Contributor (capturers save drafts) |
