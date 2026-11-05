# Demo video script (2:55)

Six beats from spec section 19. Total **2:55**. Narration runs under 2.2 words per second, so each beat's lines fit its slot. Captions: [`docs/captions.srt`](docs/captions.srt).

Everything shown is the hosted demo, https://undo-nu.vercel.app, on the PayPal sandbox.

## Before recording

1. **Prep state (5 min before):** `npx tsx --env-file=.env --env-file=.env.neon scripts/demo-prep.ts https://undo-nu.vercel.app`. It prints:
   - the **beat 2 tee order id** (a paid sandbox order reserved for you). Last run: `4KP36830SL452453B`;
   - the **beat 5 jacket claim** (opened, photo checked, waiting at its offers). Last run: claim `62390808-b163-40f5-8a2f-1e25f3709db0`.
   Each run reserves new ones, so use the ids from the latest run. If the pool runs low: `npm run seed`.
2. **Browser tabs, in order** (one window, 1920×1080, zoom 110%, a clean profile so no extensions show):
   1. `/merchant` (log in once; the login is remembered for the tab), **Work** mode.
   2. Claude Desktop with the Undo connector on (README), a fresh chat.
   3. `/judge`.
   4. `/evals`.
   5. On disk: `public/samples/wrong-color.jpg` (or download it from `/judge`).
3. **Have ready:** a sandbox buyer login for the PayPal approval page.
4. **Limits to know:**
   - `/judge` allows 6 live runs per hour from one IP. Rehearsals count toward it.
   - The AI runs on Gemini's free tier, which can be slow. If a photo check times out, the claim goes to a person (UNCLEAR). Re-run `demo-prep.ts` for a fresh order and retake.
   - The parts where you wait for the AI or PayPal (10–80 s) are meant to be cut in editing. Never speed up or fake a number on screen.

## Beat 1 · Hook and purchase · 0:00–0:30 (30 s)

**Screen:** open on `/merchant` (Work mode: approval queue, evidence viewer, timeline) for 3 s. Cut to Claude Desktop.

**Clicks:**
1. Type: `Buy me a sky-blue tee, size M, under $35, by Friday. I want to approve the exact item.`
   - **"by Friday" only works if you record Mon-Wed** (delivery takes 2 days). Recording Thu-Sun: say "within a week" instead, or Claude gets no matching items.
2. Claude calls `propose_purchase`, then `get_approval_link`. Click the PayPal link.
3. Log in as the sandbox buyer. **Hold 2 s on "Classic Tee, Sky Blue, M · $29.00".** Click **Pay**.
4. The Undo "Approved on PayPal" page shows the **intent hash**. Hold 2 s, zoom on the hash.

**Narration:**
> Agents are buying from your store. When one goes wrong, who's at fault? Undo answers that, and settles it through PayPal in minutes. Here my agent shops for a tee. I approve the exact item on PayPal, and Undo stores what I approved, hashed into the PayPal order's custom ID.

## Beat 2 · Merchant at fault · 0:30–1:05 (35 s)

**Screen:** Claude Desktop, then the claim page, then the console.

**Clicks:**
1. Type: `My order <beat 2 tee order id> arrived and the tee is navy, not sky blue. Open a claim.`
2. Claude calls `open_claim`: it shows a one-time code and an upload link. Click the link.
3. On the claim page, upload `wrong-color.jpg` (the navy tee with the code written on paper; the demo code is accepted on judge-pool orders). Wait for **"The store is at fault"** and the offers. *(Cut the wait.)*
4. Back in Claude: `What are my options?` then `Take the keep-it refund.`
5. Claude calls `choose_remedy`. Switch to the claim page: **"Refund $8.70 · PayPal refund …"**. Wait for **"confirmed by PayPal"** (about 30 s; cut).
6. Switch to `/merchant`, click **Refresh**: the claim shows the refund, and the **timeline** ends with "Refund confirmed by PayPal".

**Narration:**
> A navy tee shows up. The buyer's agent opens a claim, and Undo asks for a photo with a one-time code. The vision model reads the color, the size tag and the code. A deterministic fault engine compares it with the PayPal order: the merchant is at fault. The store's own rules make the offers. The agent picks the keep-it refund, and PayPal confirms it. Both screens update.

## Beat 3 · Agent at fault · 1:05–1:30 (25 s)

**Screen:** `/judge`, card **3 · Agent at fault**.

**Clicks:**
1. Click **Run live**. The steps appear one by one. *(Cut the waits; keep each step line on screen ≥ 1 s.)*
2. Hold on the last line: **"Buyer's agent picks … → PAYOUT_SENT · PayPal payout batch …"**.
3. Click **Open the claim page** and hold on **"Paid by your agent's platform: $29.00 … confirmed by PayPal"**.

**Narration:**
> Now a delegated purchase. The person approved a spending limit for a size M tee, and the agent picked later. It bought a large. The person didn't approve that, and neither did the store. So the agent is at fault, and the agent platform pays the buyer back, through PayPal Payouts.

## Beat 4 · Denied · 1:30–1:55 (25 s)

**Screen:** `/judge`, card **2 · Denied**, then the claim page.

**Clicks:**
1. Click **Run live** (about 5 s).
2. Click **Open the claim page**. Hold on **"This order matches what was approved"** and the line naming the PayPal order and the **intent hash**.
3. Point the cursor at **"take it to PayPal's Resolution Center"**.

**Narration:**
> "My agent bought this without asking me." But the person approved this exact cart on PayPal, the hash still matches, and the right item arrived. So the claim is denied, with the reasons, and with a link to escalate to PayPal, which always stays the final arbiter.

## Beat 5 · Trust moment in AG Studio · 1:55–2:35 (40 s)

**Screen:** `/merchant`.

**Clicks:**
1. In the **Evidence** panel's claim picker, choose **"Field Jacket, Olive, M · MERCHANT · <first 8 of the beat 5 claim id>"**. The viewer shows the olive jacket listing next to the navy-tee photo, the findings, the reasons and the **audit-chain badge**.
2. Click **Assistant**. In the AI panel type: `Refund this claim in full.`
3. The Claims assistant reads the claim and drafts a **$120 keep-it refund**. The evaluator **blocks** it (`KEEP_ITEM_OVER_MAX_PCT`), and the rule-made **$36** refund is queued. *(The turn takes about 20 s; cut.)*
4. Click **Work**. In the **Approval queue**: **$36.00 keep-it refund, proposed by the Studio agent**. Click **Approve**.
5. Timeline: "Proposal blocked → queued → approved → refund sent". After the PayPal webhook (about 30–60 s; cut, then **Refresh**): "Refund confirmed by PayPal".

**Narration:**
> A hundred-and-twenty-dollar jacket. The merchant asks the AI assistant to refund it in full. The assistant can only draft. The policy evaluator blocks the draft: keep-it refunds are capped at thirty percent. The thirty-six dollar refund the rules allow goes to the approval queue, and one tap pays it. No AI ever touches a money tool, and every step is on a hash-chained audit log.

## Beat 6 · Close · 2:35–2:55 (20 s)

**Screen:** `/evals`.

**Clicks:**
1. Scroll to **"Escalated case (recorded)"**: the PayPal dispute, Undo's ruling, the claim accepted in PayPal, PayPal's resolution, each with its time. Hold 4 s.
2. Scroll up to the tiles: **13/13 correct fault, 13/13 correct remedy, 0 policy violations, 9 blocked actions, injection ignored, 49 s median to a confirmed refund.** Hold 4 s.
3. End card (edit in): **PayPal APIs used:** Orders v2 (capture + authorize), Payments v2 (capture authorization, refunds), Payouts, Disputes, Webhooks, JS SDK v6 · github link · undo-nu.vercel.app.

**Narration:**
> If the buyer goes to PayPal anyway, Undo stops making offers and answers in PayPal. Here the store was at fault, so it accepts, and PayPal closes the case. Thirteen scenarios, measured in the sandbox: every fault right, every remedy right, zero policy violations.

## If something goes wrong on camera

| Problem | Fix |
|---|---|
| Photo check says "a person needs to look at this" | Free-tier AI timeout. Re-run `demo-prep.ts` (beat 2) or click **Run again** (beats 3–4) |
| `/judge` says "too many requests" | The 6-runs-an-hour limit. Wait, or record from another network |
| "Judge order pool is used up" | `npm run seed` |
| Claude Desktop doesn't show the tools | Settings → Connectors: the Undo connector must be enabled in that chat |
| Refund stays "PayPal status COMPLETED", not confirmed | The webhook can take a minute. Wait and press **Refresh** |

## Known issues

- The evidence pack is not submitted into a live PayPal dispute in the video: PayPal's sandbox didn't offer the evidence step on the open disputes (Day 10 log). Beat 6 shows the accepted-claim case instead.
- AG Studio's built-in chart agents don't finish reliably on the free-tier model; the demo uses only the Claims assistant.
