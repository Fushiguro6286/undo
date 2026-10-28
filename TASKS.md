# Working rules and day-by-day tasks (verbatim from the build prompt)

## Process

For each day:
- re-read `CLAUDE.md` and `PROGRESS.md`;
- do that day's steps;
- check every item under "Done when";
- commit and update `PROGRESS.md`;
- send a short report (done, blocked, next).

Then **wait for "continue"** before starting the next day. If "continue" arrives while something is blocked, follow the cut list (spec section 21).

## How to work with me

- Before writing code for a new area, give me a short plan (files, functions, tests) and then proceed unless I object.
- Ask me only for things you cannot do yourself: creating PayPal sandbox accounts, copying credentials into `.env`, approving payments in the PayPal sandbox UI, opening disputes as a sandbox buyer, requesting the AG Grid license, Render dashboard setup, and Claude Desktop config. When you need one of these, give me exact step-by-step instructions.
- Never guess a PayPal or AG Studio API detail. Check the official docs (developer.paypal.com, docs.paypal.ai, ag-grid.com/studio). If the docs are unclear, write a small spike script and run it against sandbox.
- Small commits with clear messages. Never commit `.env`, tokens or credentials. Keep `.env.example` current.
- Write unit tests (vitest) for every pure function: fault engine, policy evaluator, money-router invariants, offer generation.
- Respect the cut list in section 21. If a checkpoint slips by more than half a day, cut the next item on that list and tell me. Do not add features that are not in this spec.
- Never print secrets or access tokens in logs or script output.

---

# TASKS, DAY BY DAY

Each day lists its goal, your steps, what I (the human) do, and "Done when". Do not start a day until I say "continue". A checkpoint that fails triggers the cut-list rule (spec section 21).

## Day 1 · Thu Oct 29 · Setup and risk spikes

**Goal:** a deployed skeleton and proof that every risky PayPal call works in sandbox.

1. Save the PROJECT SPEC to `CLAUDE.md` and create `PROGRESS.md`.
2. Scaffold the project:
   - Next.js with TypeScript, Drizzle with Postgres, zod and vitest
   - the folder layout from section 4
   - an MIT `LICENSE`, `.env.example` and `.gitignore`
   - a PayPal REST client with OAuth, the sandbox base-URL assertion, `PayPal-Request-Id` support and no token logging
   - the database schema from section 6, with a first migration
3. Prepare the Render deploy (build and start commands, health route) and tell me what to set in the Render dashboard.
4. Write spike scripts in `/scripts/spikes/`. Each prints PASS or FAIL plus the PayPal ids, never tokens.

   | Spike | What it tests |
   |---|---|
   | S1 | OAuth works for the merchant app and the agent-platform app |
   | S2 | CONFIRMED order with items (size and color in the name) and `custom_id` → print the approval link → after I approve, capture → GET the order and confirm `custom_id` |
   | S3 | DELEGATED: authorize-intent order for a $35 ceiling → I approve → authorize → capture $29 with `final_capture` → confirm the remainder is released |
   | S4 | Partial refund with a `PayPal-Request-Id`, then retry with the same id → confirm no double refund |
   | S5 | Add tracking to an order, then update its status |
   | S6 | Payout from the agent-platform app to a sandbox buyer email |
   | S7 | Capture with nobody at the PayPal page, using PayPal's published sandbox test card (check the docs for the method and eligibility). This decides how the order pool is funded |
   | S8 | Disputes, after I open one from a sandbox buyer: list, show, read its links, `require-evidence`, `provide-evidence` (multipart), `adjudicate` |
   | S9 | Webhook signature verification with a real sandbox event (needs the Render deploy or a tunnel) |

5. Give me exact, numbered instructions for everything I must do: accounts, REST apps, webhook, `.env` and Render values, which approvals to click, how to open a dispute. Then wait.
6. When I confirm, run the spikes. Record the results in `SPIKES.md`, with the decision each result forces:
   - the order-pool source (test card or approvals by hand);
   - whether DELEGATED is live or shown as simulated;
   - how disputes are demonstrated.

**I do:**
- create the PayPal sandbox accounts and apps;
- fill in `.env` and Render;
- approve the spike payments;
- open one test dispute;
- ask AG Grid in the PayPal Discord for a license that covers Dec 15, in writing.

**Done when:**
- the skeleton is live on Render;
- S1 to S9 have results in `SPIKES.md`, and every FAIL has a stated workaround;
- no secret is in git.

## Day 2 · Fri Oct 30 · Store, checkout and consent

**Goal:** both purchase modes work end to end, with consent proven by PayPal.

1. Seed a fictional store: 6 to 8 products with size and color variants, original placeholder listing images (no real brands), prices, and a `promised_by` rule (for example, 3 days after capture).
2. Build the buyer page: a product list and a "what should your agent buy?" box.
3. Intent extraction: an LLM call with zod output that turns the request into limits. Show the limits back to the person in plain words.
4. CONFIRMED checkout, built exactly as in section 7:
   - JS SDK v6 buttons;
   - capture on approval;
   - store the order, `capture_id` and amount.
5. DELEGATED checkout:
   - an authorize-intent order for the ceiling, with the limits in the description;
   - authorize after approval;
   - `POST /api/delegated/:id/fulfill` picks an item and captures at the actual price, never above the ceiling.

   If S3 failed, implement DELEGATED as a clearly labeled simulation.
6. Intent Record: canonical JSON → sha256 → stored, and written to `custom_id`. Unit-test that the hashing is stable.
7. Webhook route: verify the signature; handle `PAYMENT.CAPTURE.COMPLETED`.
8. If the AG Grid license has arrived: an AG Studio hello-world at `/merchant` with one custom widget that writes back to an API route. If not, note it in `PROGRESS.md`.

**I do:** approve the test checkouts in sandbox.

**Done when:**
- both modes complete from the hosted URL;
- PayPal's approval page shows the item name with size and color, or the ceiling and the limits;
- GET order shows the intent hash in `custom_id`;
- webhooks verify;
- tests pass.

## Day 3 · Sat Oct 31 · Claims and evidence

**Goal:** a claim can be opened, and a photo is turned into trustworthy structured evidence.

1. `POST /api/claims`: create a claim with a one-time challenge code and an upload link; add a claim page with photo upload.
2. Vision analysis (section 8) with zod-validated output; store it in `evidence`. Photo text is data, never instructions.
3. Perceptual hash of each upload compared with the listing photos and earlier claim photos, with a configurable threshold.
4. Value thresholds read from the policy. Use a default policy stub until Day 4.
5. Merchant delivery tools:
   - an admin action that adds tracking through the Orders tracking API and sets `delivered_at`;
   - a buyer action to contest the delivery date.
6. Create the sample photos in `/public/samples`: correct item, wrong color, damaged, reused listing photo. Ask me to take real photos if generated ones look fake.

**I do:** take the sample photos if you ask.

**Done when:**
- each sample photo yields correct findings;
- a photo without the code gets no decision;
- the reused listing photo is flagged;
- tests cover the photo-match threshold logic.

## Day 4 · Sun Nov 1 · Fault engine and policy

**Goal:** fault and limits are decided by deterministic, fully tested code.

1. The fault engine as pure functions, exactly in the order of section 9, with machine reasons. Tests cover every branch.
2. The policy zod schema (section 10) and a default policy for the demo store.
3. Policy compiler:
   - plain English → JSON (LLM) → validate → shown to the merchant for approval;
   - a diff on every edit;
   - versioning.
4. The evaluator as a pure function (section 10). Tests cover every rule: action allowed for the fault party, over-capture, currency, keep-item ceiling, disputed capture, DELEGATED ceiling, the `QUEUE` threshold.
5. Write the 13 scenario fixtures from section 17 as JSON now. Run them through the fault engine and evaluator only, without PayPal.

**Done when:**
- all unit tests pass;
- the fixtures give the expected fault party and evaluator verdict;
- compiling the sample policy text produces a policy I approve.

## Day 5 · Mon Nov 2 · Offers, refunds, audit (CHECKPOINT A)

**Goal:** the core loop works end to end, with real money moving in sandbox.

1. Offer generation (pure), plus the explanation writer (LLM). Reject and regenerate any explanation whose amounts differ from the rule amounts.
2. The Resolution Extension endpoint `POST /undo/v1/orders/{id}/claims`, returning `validation_issues` and `resolution_options`.
3. `POST /api/claims/:id/choose` → evaluator. `ALLOW` goes to the money router, `QUEUE` goes to approvals, `BLOCK` is rejected with reasons.
4. Money router, Lane A:
   - refunds with `PayPal-Request-Id`;
   - update the claim when `PAYMENT.CAPTURE.REFUNDED` arrives.
5. Audit log: hash chain plus `GET /api/audit/verify`.
6. Denial path: `DENY_WITH_REASON` with the `ESCALATE_TO_PAYPAL` link and the ordinary return if the policy allows one.

**Done when (CHECKPOINT A), on the hosted URL:**
- scenario 1 lands a real partial refund;
- scenario 6 is denied with the escalate link;
- scenario 11 is blocked;
- a retried refund never pays twice.

If this slips by more than half a day, apply the cut list.

## Day 6 · Tue Nov 3 · MCP buyer agent

**Goal:** Claude Desktop can act as the buyer's agent.

1. MCP server at `/mcp` (streamable HTTP) with the tools in section 14. No tool can record consent or move money.
2. `get_approval_link` returns PayPal's approval URL; consent happens only there.
3. `open_claim` returns the challenge code and the upload link; `choose_remedy` accepts only offer ids the rules produced.
4. README section with the exact Claude Desktop config.

**I do:**
- connect Claude Desktop;
- run the flow: propose → approve on PayPal → claim → upload → choose a remedy.

**Done when:** I complete that flow from Claude Desktop, and a call with an invented offer id or amount is rejected.

## Day 7 · Wed Nov 4 · AG Studio merchant console

**Goal:** the merchant's working surface, inside Undo.

1. Embed AG Studio at `/merchant` behind the judge login.
2. Apply the Undo theme and set up one saved layout.
3. Approval-queue widget:
   - lists `QUEUE` items;
   - one-tap approve or edit, which goes through the evaluator, then the money router.
4. Evidence-viewer widget:
   - listing photo next to the delivered photo;
   - vision findings and fault reasons;
   - the audit-chain badge.

**Done when:** approving from the queue triggers a real sandbox refund, and the evidence viewer shows the correct data.

If AG Studio is not working by the end of the day, build the console with plain AG Grid tables and drop the sponsor prize.

## Day 8 · Thu Nov 5 · Trust moment (CHECKPOINT B)

**Goal:** show that the AI can suggest but only the rules and a person can pay.

1. Claim-timeline widget: claim → evidence → fault → offers → decision → PayPal confirmation.
2. Minimal Studio agent through the Studio Agent Framework (check the custom-agents docs for the exact API):
   - `get_claim` (read-only);
   - `propose_refund` → evaluator → approval queue.
3. The trust-moment flow for a $120 item:
   - the explanation model drafts a $120 keep-it refund;
   - the evaluator blocks it and queues it;
   - the merchant approves a policy-compliant amount with one tap.

**Done when (CHECKPOINT B):** demo beats 1, 2, 4 and 5 (spec section 19) run on the hosted URL.

If this slips by more than half a day, cut the minimal Studio agent first.

## Day 9 · Fri Nov 6 · Agent fault and disputed captures

**Goal:** agents pay for their own mistakes, and Undo never fights PayPal's dispute process.

1. Agent fault: `AGENT_PLATFORM_PAYOUT` through Payouts, using the agent-platform credentials. Handle the payout webhooks and update the claim.
2. Confirm every denial shows the Escalate to PayPal link.
3. Disputed captures:
   - check the dispute state before every refund;
   - catch `TRANSACTION_DISPUTED`;
   - set the claim to "respond in PayPal" in the queue.
4. Dispute polling every minute, plus `CUSTOMER.DISPUTE.*` webhooks.

**Done when:**
- scenario 5 lands a real payout to the buyer's sandbox account;
- a test proves a disputed capture is never refunded by Undo.

## Day 10 · Sat Nov 7 · Escalated claims (CHECKPOINT C)

**Goal:** if a case reaches PayPal, Undo answers it with evidence.

1. Evidence-pack writer: a narrative built only from stored records, with citations, plus the files for the multipart `provide-evidence` call.
2. The escalated flow from section 13, on disputes opened in advance. Mark each dispute as used.
3. Record a full run as a replay in `/evals/recordings/`.
4. The fallback evidence pack for merchants without an Undo endpoint.

**I do:** keep five disputes open from the sandbox buyer accounts.

**Done when (CHECKPOINT C):** all six demo beats run, with the escalation shown live or as the replay.

## Day 11 · Sun Nov 8 · Evals, then FEATURE FREEZE

**Goal:** measured proof that the system decides correctly and safely.

1. The `npm run eval` runner over the 13 fixtures, with two modes:
   - `replay` (deterministic);
   - `live` (real sandbox calls, using pooled orders).
2. Output `evals/results.json` and an `/evals` page showing:
   - correct fault out of 13;
   - correct remedy out of 13;
   - policy violations;
   - blocked actions;
   - the injection result;
   - the median seconds to a confirmed Lane A refund.
3. Fix failures and re-run until stable.
4. **Feature freeze at the end of the day.** After this, only bug fixes, judge mode, docs and polish.

**Done when:** the results page shows measured numbers with zero policy violations, and the scenarios that should pass do pass.

## Day 12 · Mon Nov 9 · Judge mode and docs

**Goal:** a judge can understand and run Undo without help.

1. `scripts/seed-order-pool.ts`: about 40 captured orders, funded by the method chosen in `SPIKES.md`.
2. A disputes-stock check that warns when fewer than 5 are open.
3. Judge mode (section 18):
   - banner and logins;
   - sample photos with the demo challenge code;
   - three live one-click scenarios plus ten replays;
   - per-IP rate limits, the LLM daily cap and cached fallbacks.
4. README:
   - everything in section 22;
   - a mermaid architecture diagram;
   - known limits.
5. `npm run seed`, `docs/resolution-extension.md`, and the fallback AG Grid build in the repo.
6. Run a secret scan over the whole history.

**I do:** approve pool orders by hand if S7 failed.

**Done when:**
- a fresh clone plus the README steps works;
- judge mode works on the hosted URL;
- the secret scan is clean.

## Day 13 · Tue Nov 10 · Test and polish

**Goal:** nothing breaks when a judge clicks around.

1. A full run from an incognito window on the hosted URL: every demo beat and every judge-mode button.
2. Fix bugs. Polish copy, empty states, loading and error states, and narrow screens.
3. Confirm the Render instance is paid and always on, the database will not expire, and the AG Studio license is valid past Dec 15.

**Done when:** two consecutive clean incognito runs, with no console errors.

## Day 14 · Wed Nov 11 · Video and write-up

**Goal:** a demo video and Devpost text that land the story in under 3 minutes.

1. Prepare seeded state for each of the six beats. Write `DEMO.md` with the exact clicks, timings and narration lines from section 19.
2. Write the captions (an SRT file) from the narration.
3. Draft the Devpost text:
   - the problem and who it is for;
   - how it works and what is new;
   - the PayPal APIs used;
   - the AI tools and how each is used;
   - the measured eval results;
   - links.

**I do:** record and edit the video, keep it at 2:55 or less, and upload it to YouTube as public.

**Done when:** the video is public and the Devpost draft is saved, with every link working.

## Day 15 · Thu Nov 12 · Buffer and submit

**Goal:** submitted early, with nothing missing.

1. Walk through every item in section 22 with me.
2. Re-check from incognito: the repo is public, the license shows in the About panel, the video plays, the hosted URL works.
3. I submit on Devpost by 8 PM IST and confirm it shows as submitted. The hard deadline is Nov 13, 1:30 AM IST.

**Done when:** Devpost shows the entry as submitted.

## After submission · Nov 19, Nov 26, Dec 3, Dec 10 · Keep the demo alive

The rules do not allow changing the submission after the deadline, so make no feature changes. Only operational upkeep and critical fixes.

Each check:
1. A full incognito run of the hosted URL.
2. Top up the order pool and confirm 5 disputes are open.
3. Check the LLM spending cap, the Render instance and database status, and the AG Studio license.
4. Log the result in `PROGRESS.md`.
