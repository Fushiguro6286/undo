# Design prompt for Undo

Paste everything below the line into a design tool (Claude, v0, Figma AI, Lovable…). It is self-contained.

---

You are a senior product designer. Design the full web UI for **Undo**, a hackathon product that will be judged on design, technical implementation, impact, innovation and presentation, mostly through a 3-minute demo video. The design must look intentional and memorable, not like a generic AI template.

## The product

Undo decides who is at fault when an AI shopping agent's purchase goes wrong, and settles it through PayPal in minutes, before it becomes a formal dispute.

It compares three records:
1. **What the person approved** (the "intent record", hashed into the PayPal order).
2. **What PayPal says was bought** (the PayPal order).
3. **What actually arrived** (a photo the buyer takes with a one-time code like `UNDO-7F3A` visible; an AI vision model reads it).

A deterministic fault engine then rules: **merchant**, **carrier**, **agent**, **buyer** (claim denied) or **unclear** (sent to a person). The store's own policy generates the allowed remedies (keep-it partial refund, exchange, refund on return, replacement, agent-platform payout, escalate to PayPal). Money moves only through PayPal (sandbox).

Pitch line: *"Agents are buying from your store. When one goes wrong, who's at fault?"*

Two consent modes, shown everywhere a purchase appears:
- **CONFIRMED**: the person approves the exact cart on PayPal.
- **DELEGATED**: the person approves a spending limit with rules (item, size, color, max price, deadline); the agent picks later. If the agent breaks the rules, the agent is at fault.

Users: PayPal merchants (console), shoppers who delegate to agents (store + claim pages), agent platforms (pay when their agent breaks the limits). The demo store is fictional: **Fernleaf Goods**.

## Creative direction

The core idea is a **ruling**: evidence goes in, a verdict comes out. Lean into that, for example a case file, evidence board, court stamp, receipts and tickets. Calm, confident, editorial. It should feel trustworthy (money moves) but have one bold signature moment.

Current direction you may refine or replace with something stronger:
- Newsprint paper (`#efe9dc`) and ink (`#16140f`); dark mode is warm ink (`#12110e`) with paper text (`#f1ebdd`).
- One vermilion (`#e1401b` / dark `#ff6a40`) reserved **only for verdicts**; a cobalt accent (`#1f3bd6`) for links; green only for "confirmed by PayPal".
- Type: a display serif for headlines and rulings (Instrument Serif), a grotesk for UI (Schibsted Grotesk), a typewriter mono for evidence: hashes, order ids, codes (IBM Plex Mono).
- Signature: a rubber-stamp verdict that lands after the evidence ("Merchant at fault", "Claim denied", "Agent at fault", "Sent to a person").
- Hard offset shadows, 1.5px ink borders, torn receipt edges, subtle paper grain.

**Avoid (these read as AI-made):** purple/blue gradients, glassmorphism, glowing orbs, emoji as icons, a hero followed by three identical icon cards, stock 3D illustrations, robot mascots, "revolutionize/seamless/unlock" copy, rounded-everything SaaS look, fake dashboards with invented numbers.

## Pages to design (desktop 1440 and phone 390 for each)

1. **Home / store** (`/`)
   - Hero that explains the three-record comparison in one glance, ending in a verdict.
   - "Try it" box: a text field pre-filled with `A sky-blue tee, size M, under $35, within a week` and an **Ask agent** button.
   - After asking: the extracted limits as plain words ("a sky-blue tee, size M, up to $35.00, delivered by Thu, Nov 12"), the matching items to pick from, a choice between CONFIRMED and DELEGATED, then PayPal's own checkout button. Button text: **Approve this exact cart** (CONFIRMED) / the spending-limit equivalent (DELEGATED).
   - Empty state when nothing matches, with the reason (e.g. "Delivery takes 2 days, so nothing can arrive by Fri, Nov 6. Ask for a later date.").
   - A 3-step "how it works" strip and the store grid: 7 products (Classic Tee $29, Trail Hoodie $54, Field Jacket $120, Linen Shirt $46, Running Socks 3-Pack $14, Wool Beanie $18, Canvas Tote $22), each with colors and sizes. Product art is flat silhouettes.
2. **Approved on PayPal** (`/orders/approved`): success state with the PayPal order id, item, amount, mode, and the 64-character **intent hash** (it must be legible and zoomable for the video).
3. **Cancelled** (`/orders/cancelled`): calm "nothing was bought" state.
4. **Claim page** (`/claims/:id`), the most important buyer screen. States:
   - *Waiting for photo:* "Show us what arrived", the challenge code shown like a ticket, the upload control, sample photos to try.
   - *Analyzing:* honest progress (the AI reads the photo; can take 5–30 s).
   - *Decision:* a heading plus the verdict stamp. Headings used: **"The store is at fault"**, **"This order matches what was approved"** (denial; must cite the PayPal order and intent hash), agent-at-fault and sent-to-a-person variants.
   - What the AI saw in the photo (code found, size tag, color, item type, damage, confidence) next to what was ordered; listing photo vs delivered photo.
   - *Offers:* cards for each rule-made remedy with amount, e.g. "Keep the item and get 30% back · $8.70", "Exchange it for the item you ordered", "Send it back for a full refund · $29.00", "Take it to PayPal's Resolution Center".
   - *Outcome:* "Refund $8.70 · PayPal refund …" then **"confirmed by PayPal"**; payout variant "Paid by your agent's platform: $29.00 … confirmed by PayPal".
   - Denial always shows **"take it to PayPal's Resolution Center"** and a "Download an evidence pack" link.
   - Error state: "We couldn't open this claim".
5. **Judge page** (`/judge`): banner page for hackathon judges. Three cards, **1 · Merchant at fault**, **2 · Denied**, **3 · Agent at fault**, each with a one-line story, the expected result, a **Run live** button, a live step log as the run progresses (terminal-like list), then the verdict stamp, **Open the claim page** and **Run again**. Below: links to measured results and "Try it by hand".
6. **Evals** (`/evals`): measured results for 13 scenarios. Stat tiles (correct fault 13/13, correct remedy 13/13, policy violations 0, blocked actions 9, prompt injection ignored, median seconds to a confirmed refund), a results table per scenario, and an **"Escalated case (recorded)"** timeline of a real PayPal dispute. Only real numbers; label anything not measured as "Not measured".
7. **Merchant console** (`/merchant`): password gate, then a full-width console built on **AG Studio** (an embeddable React grid/dashboard; you style it through theme tokens: fonts, colors, borders, radius, not by redrawing it). Modes: **Work** and **Assistant**, plus **Edit layout** and **Refresh**. Panels: **Approval queue** (main panel: claim, fault, proposed remedy, amount, one-tap **Approve** / edit), **Evidence** viewer (listing photo vs delivered photo, AI findings, fault reasons, an "Audit chain verified · N events" badge), **Claim timeline** (every step with time). The Assistant is a chat side panel.
8. **Plain grid console** (`/merchant/grid`): same three panels using a plain data grid (fallback).
9. **Return policy** (`/merchant/policy`): merchant writes a policy in plain English, the AI compiles it into rules (window days, auto-approve limit, keep-item %, etc.), the merchant reviews a diff and approves. Versioned.
10. **404** page.

Global: a site header (wordmark "Undo" + nav Store, Judge, Evals, Merchant) and a **judge-mode banner** on every page stating "Fernleaf Goods is a fictional store · PayPal sandbox only · No real money moves" with a "Try the live scenarios →" link.

## Fixed text (do not rename; the demo video script depends on it)

Approve this exact cart · Ask agent · Run live · Run again · Open the claim page · The store is at fault · This order matches what was approved · confirmed by PayPal · take it to PayPal's Resolution Center · Escalated case (recorded) · Approval queue · Evidence · Approve · Work · Assistant · Edit layout · Refresh · Pay (PayPal's page).

## Constraints

- Built in **Next.js (App Router) + plain CSS with custom-property tokens** (no Tailwind). Give me tokens for color, type scale, spacing, radius, shadow and motion, for light and dark.
- PayPal's checkout button and PayPal's approval page are PayPal's own UI; leave room for them, don't restyle them.
- Works at 390 px with no horizontal scroll (the console may scroll inside its own box).
- WCAG AA contrast in both themes; visible focus states; respects `prefers-reduced-motion` (verdict stamps simply appear).
- Honesty: never invent metrics, logos, testimonials or partner brands. Use the sample data above.
- Monospace for every id, hash, code and amount in records.
- Motion is purposeful: records slide in, the thread connects them, the stamp lands. No ambient animation that distracts in a screen recording.

## Deliverables

1. The design concept in 3–4 sentences and why it fits a fault-and-settlement product.
2. Design tokens (CSS custom properties) for light and dark.
3. Each page at desktop and phone width, including the empty, loading, error and success states listed above.
4. Component specs: verdict stamp, evidence record card, receipt/fact list, challenge-code ticket, offer card, step log, stat tile, approval-queue row, audit badge, buttons, inputs, banner.
5. Motion specs (durations, easing, order) for the hero and the verdict moment.
