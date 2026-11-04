# Progress

Full daily steps and working rules: `TASKS.md`. Spec: `CLAUDE.md`. Human setup steps: `docs/SETUP.md`.

## Checklist (spec section 20)

- [ ] **Day 1, Oct 29:** scaffold and deploy; spike scripts; sandbox accounts (human); AG Grid license request (human)
- [ ] **Day 2, Oct 30:** store and buyer page; CONFIRMED and DELEGATED checkout (JS SDK v6); Intent Record and `custom_id` hash; webhook verification; AG Studio hello-world (once license arrives)
- [x] **Day 3, Oct 31:** (done Nov 4; hosted check waits on Render) claim intake, challenge code, vision, photo match, value thresholds
- [ ] **Day 4, Nov 1:** (code done Nov 4; waits on your policy approval) fault engine; policy compiler and evaluator
- [x] **Day 5, Nov 2:** (done Nov 4) offers, Lane A refunds with request ids, audit log
  - [x] **CHECKPOINT A:** scenarios 1, 6 and 11 pass end to end (hosted, Nov 4)
- [ ] **Day 6, Nov 3:** (code done + hosted check Nov 4; waits on the Claude Desktop run) MCP server; Claude Desktop end to end
- [x] **Day 7, Nov 4:** (done locally; hosted check pending) AG Studio console, theme, approval queue, evidence viewer with the audit badge
- [ ] **Day 8, Nov 5:** claim timeline widget, minimal Studio agent, blocked proposal → queue → one-tap approval
  - [ ] **CHECKPOINT B:** demo beats 1, 2, 4 and 5 run on the hosted URL
- [ ] **Day 9, Nov 6:** agent-fault payout, Escalate to PayPal link, `TRANSACTION_DISPUTED` guard, "respond in PayPal" queue state
- [ ] **Day 10, Nov 7:** escalated claims on disputes opened in advance; record the replay
  - [ ] **CHECKPOINT C:** all 6 demo beats run
- [ ] **Day 11, Nov 8:** 13 eval scenarios and results page. **FEATURE FREEZE** at end of day
- [ ] **Day 12, Nov 9:** judge mode, README, `npm run seed`, Resolution Extension doc, fallback AG Grid build
- [ ] **Day 13, Nov 10:** full incognito test on the hosted URL; fix and polish
- [ ] **Day 14, Nov 11:** video (human); Devpost text and README polish
- [ ] **Day 15, Nov 12:** buffer; submit by 8 PM IST

## Session log

### Oct 28 (Day 1 started early)
- **Done:** spec in `CLAUDE.md`; `TASKS.md`; Next.js 16 + TypeScript scaffold (App Router), Drizzle schema for all 12 tables + first migration (`drizzle/0000_init.sql`), zod, vitest; MIT `LICENSE`, `.env.example`, `.gitignore`; PayPal REST client (OAuth cache, sandbox assertion at build/start and per client, `PayPal-Request-Id`, token-free errors) with 7 unit tests; `/api/health`; `/api/webhooks/paypal` (verify + log); `render.yaml`; spikes S1–S9; PayPal doc findings in `SPIKES.md`.
- **Blocked on human:** sandbox accounts + REST apps, `.env`, Render deploy, webhook, spike approvals, one test dispute, AG Grid license request (steps in `docs/SETUP.md`).
- **Next:** run S1–S9 once credentials are in `.env`, record results and decisions in `SPIKES.md`, confirm the Render deploy.

### Oct 28–29 (spikes)
- **Done:** private repo `Fushiguro6286/undo`. S1, S2, S3, S4, S5, S6, S7 **PASS**. S8 **partial** (evidence accepted at inquiry and claim stage; `adjudicate` never offered). Client fix: JSON Content-Type on body-less POSTs (PayPal 415). Decisions: order pool funded by test card; DELEGATED is live; disputes shown live up to evidence + replay.
- **Blocked on human:** Render deploy + webhook ID (S9), AG Grid license request.
- **Next:** S9 after Render is up; then Day 1 "done when" check and wait for "continue".

### Oct 31 (Day 2 code)
- **Done:** fictional store (7 products, size/color variants, generated SVG art); Intent Record with canonical-JSON sha256 hash → `custom_id`; CONFIRMED (CAPTURE) and DELEGATED (AUTHORIZE → capture actual price with `final_capture`, ceiling-checked in the money router) checkout; LLM limit extraction (AI SDK 7, `generateText` + `Output.object`); buyer page with JS SDK v6 `<paypal-button>` (clientId auth, `presentationMode: "auto"`); `POST /api/orders/:id/approve` (captures CONFIRMED, authorizes DELEGATED) instead of `/capture`; webhook handles `PAYMENT.CAPTURE.COMPLETED`. 20 unit tests pass, build passes.
- **Decision:** order creation and captures use the proven REST client, not `@paypal/agent-toolkit` (its order tools don't cover custom_id/AUTHORIZE as used here). Revisit before submission.
- **Not tested end to end yet:** needs `DATABASE_URL`, `ANTHROPIC_API_KEY` (+ `LLM_MODEL`), and the Render deploy for webhooks (S9).
- **LLM:** switched to free Google Gemini (`LLM_PROVIDER=google`, `gemini-3.8-flash`, key `GOOGLE_GENERATIVE_AI_API_KEY`); Anthropic still selectable. Free-tier prompts may be used by Google, fine since all demo data is fictional.
- **Local DB:** Postgres 18 database `undo` created and migrated; both checkouts create real sandbox orders with the hash in `custom_id` (verified, and the hash recomputes from the DB row).
- **Blocked on human:** Gemini key, Render deploy + webhook ID, AG Grid license status.

### Nov 4 (Day 3: claims and evidence)
- **LLM fix:** `gemini-3.8-flash` hangs and 3.7/3.5-flash return 503 "high demand" on the free tier; switched to **`gemini-3.5-flash-lite`** (2–8 s, correct output). Every LLM call now has a 30 s timeout. `scripts/spikes/llm-check.ts` is the smoke test. Risk: free-tier capacity can fail during judging; a paid key (Gemini or Anthropic) fixes it.
- **Done:** `POST /api/claims` (one-time code `UNDO-XXXX`, upload link); `/claims/[id]` page (code, photo upload, findings, "That date is wrong"); `POST /api/claims/:id/evidence` (sharp normalize → perceptual hash → vision → fraud checks); `GET /api/claims/:id`; `POST /api/claims/:id/contest-delivery`; `GET /api/evidence/:id/photo`; merchant `POST /api/merchant/orders/:id/delivery` (real Orders tracking call + `delivered_at`; needs `x-merchant-key` = `JUDGE_LOGIN_PASSWORD` in production). "Something wrong with this order?" form on the buyer page. Photos live in Postgres (`evidence.photo` bytea); migration `0001_claims_evidence`.
- **Photo match:** DCT pHash failed on the flat, symmetric listing art (16–24 bits drift on a recompress), so it is a 16×16 difference hash: edited listing copies 3–6 of 256 bits, a new photo of the same item ~180, threshold 16 (`PHASH_MATCH_THRESHOLD`). Judge-mode pool claims skip other pool claims' photos (every judge uploads the same samples); real claims compare against all.
- **Policy:** zod schema from section 10 + `DEFAULT_POLICY` (auto-approve up to $25, keep-it 30%, return required above $150) so the value threshold reads from policy; Day 4 adds the compiler.
- **Order pool:** `scripts/seed-order-pool.ts [count] [sku]` creates real captured CONFIRMED orders with the sandbox test card (S7). Two seeded locally (tee 7EY59956UE7068512, jacket 08403344P5254183F).
- **Samples:** `scripts/make-samples.ts` → `public/samples/` correct-item, wrong-color, wrong-size, damaged, no-code, reused-listing (generated illustrations showing `UNDO-DEMO`). `scripts/check-samples.ts` runs them through the real pipeline: **6/6 PASS, twice**.
- **Tests:** 33 pass (code, photo-match threshold, fraud checks, policy). Build passes.
- **Schedule:** the calendar is at Day 7. Checkpoint A (Nov 2) slipped more than half a day, so per section 21 **cut #1: the minimal Studio agent**.
- **Blocked on human:** Render deploy + webhook ID (S9, all hosted checks), AG Grid license (Day 7 fallback rule), optional real sample photos.
- **Next:** Day 4: fault engine, policy compiler + evaluator, 13 scenario fixtures.

### Nov 4 (Vercel, AG Studio license)
- **Vercel:** a build with no env vars failed in `next.config.ts` (sandbox assertion on an unset `PAYPAL_BASE_URL`). Unset now defaults to the sandbox host; live, empty and look-alike hosts are still refused. A clean-clone build with no `.env` passes. Hosting: Vercel + Neon replaces Render (spec still says Render).
- **AG Studio license:** 45-day AG Studio Pro **trial** key, expires 19 Dec 2026, in local `.env` as `AG_STUDIO_LICENSE_KEY` (must also go into Vercel). The key text says "evaluation only, production not permitted": the human confirms with AG Grid that a hackathon demo through Dec 15 is allowed.

### Nov 4 (Day 4: fault engine and policy)
- **Done:** `src/fault/engine.ts` `decideFault` (section 9 order; machine reasons with evidence refs; missing code = no decision; claim text is never an input). `src/policy/evaluator.ts` `evaluate` → ALLOW/QUEUE/BLOCK (action allowed for party, over-capture incl. earlier refunds, currency, keep-it ceiling, return required, disputed capture, DELEGATED ceiling, payout ≤ compensation, QUEUE above `autoApproveLimit`), plus `allowedActions` and `agentCompensation` for Day 5 offers. `src/policy/compiler.ts` (LLM → zod policy, `diffPolicy`, `SAMPLE_POLICY_TEXT`), `src/policy/store.ts` (versioned drafts, approve, active policy). `/merchant/policy` page + `GET/POST /api/merchant/policy`, `POST /api/merchant/policy/:id/approve`. Claims now use the active policy and store `fault_party` + `reasons` after each photo (status `DECIDED`).
- **Fixtures:** 13 scenarios in `evals/scenarios/*.json`, run by `evals/scenarios.test.ts` through fraud checks → fault engine → evaluator (no PayPal, no LLM). All give the expected fault and verdicts.
- **Decision:** `autoApproveLimit` queues refunds only (the merchant's money). Agent payouts come from the agent platform's account and are capped by the policy's compensation, so scenario 5 auto-approves. Scenario 12 is blocked here by the keep-it ceiling; Day 5 also rejects any amount that is not a rule-made offer.
- **Measured:** sample policy text compiles to exactly `DEFAULT_POLICY` 3/3 (1.4–6.4 s, gemini-3.5-flash-lite); edited text gives exactly the 5 expected rule changes. `scripts/check-samples.ts` now checks the fault ruling too: **6/6 PASS** (BUYER, MERCHANT ×2, CARRIER, no decision, UNCLEAR). 74 tests pass, build passes.
- **Waiting on human:** approve draft v2 at `/merchant/policy` (done-when check).
- **Next:** Day 5: offers + explanations, Resolution Extension endpoint, choose → evaluator → money router, Lane A refunds, audit log (Checkpoint A).

### Nov 4 (Day 5: offers, refunds, audit, Checkpoint A)
- **Done:** `src/offers/generate.ts` (pure: fault + policy -> every allowed remedy with amounts, each through the evaluator; BLOCK never offered). `src/offers/explain.ts` (one LLM call, no tools, no claim text; any stated amount must equal the rule amount or it regenerates, 3 tries, then template text). `src/money/router.ts` `refundCapture` (`PayPal-Request-Id = claimId:action:version`, recorded in `money_actions`). `src/claims/resolve.ts`: offers after every ruling; `chooseOffer` (amount never offered -> rejected; evaluator ALLOW -> refund now, QUEUE / refund-on-return / human review -> approval queue; one choice per claim even under races); `proposeRemedy` (BLOCK with reasons, else queued for a person; reviewer may set the party on UNCLEAR claims); `decideApproval` (re-evaluates, then pays; other pending items superseded); `confirmRefund` from `PAYMENT.CAPTURE.REFUNDED`. Exchange/replacement adds a PayPal tracker, no money. Denials return the Resolution Center link. `src/audit/log.ts`: hash chain (advisory lock so it never forks), `verifyChain`, `GET /api/audit/verify`; events for claim opened, evidence, fault, offers, choice, approvals, refunds, policy approval. Migration `0002_audit_payload` adds `audit_events.payload` (spec deviation: needed to re-check payload hashes and for the claim timeline). Resolution Extension `POST /undo/v1/orders/{id}/claims` (JSON opens the claim, multipart adds the photo; `validation_issues`, `resolution_options`, `intent_hash_verified` re-checked against PayPal's `custom_id`). Claim page shows the decision, offers, choice and outcome. Evidence and delivery disputes lock once a remedy is chosen.
- **Checkpoint A (local, real sandbox):** `scripts/checkpoint-a.ts` ALL PASS: #1 MERCHANT, $8.70 keep-it refund 7JV09736F2786864E COMPLETED 19.0 s from claim; second choice refused; money-router retry returned the same refund; PayPal order shows exactly one refund. #6 BUYER, denied with escalate link. #11 $40 on $29 BLOCK `OVER_CAPTURE`. Audit chain verifies. Also smoke-tested: extension endpoint (hash verified true), wrong amount rejected, refund-on-return -> queue -> merchant approve -> $29.00 refund 8VM29554HJ315931M, second approve refused.
- **Not verified yet:** `PAYMENT.CAPTURE.REFUNDED` webhook (needs the hosted URL + `PAYPAL_WEBHOOK_ID`); claims stay `REFUND_SENT` until it arrives. PayPal's Cart API docs pages moved (404), so the extension's issue fields follow the spec + search summaries; recheck on Day 12.
- **Waiting on human:** run the Neon migration (`0002`), deploy to Vercel with env vars, set the webhook to `{url}/api/webhooks/paypal`, then run `scripts/checkpoint-a.ts {url}` against hosted. Policy v2 still unapproved.
- **Next:** Day 6: MCP server; Claude Desktop end to end.

### Nov 4 (hosting on Vercel + Neon; Checkpoint A hosted)
- **Setup:** Neon CLI 8.18.0 signed in, Neon plugin installed for Claude Code. Vercel CLI 65.11.0 linked to project `undo` (https://undo-nu.vercel.app); GitHub repo already connected, so every push to `main` deploys to production. 17 env vars in Vercel Production (secrets stored as Secret type; `DATABASE_URL` = Neon pooled URL; generated `JUDGE_LOGIN_PASSWORD`, also in local `.env`; `PAYPAL_WEBHOOK_ID` 96D92963V43714717). Preview environment has no env vars yet. Neon migrated through `0002` (by the human). `.vercelignore` added after a CLI deploy uploaded local `.env` files into that deployment's (owner-only) source; production now serves a Git deploy.
- **Env loading:** sourcing `.env` in bash fails (a value isn't shell-safe); scripts against Neon use `npx tsx --env-file=.env --env-file=.env.neon <script>` (later file wins).
- **Neon pool:** 6 Sky Blue M tees + 2 Olive M jackets seeded by test card.
- **Checkpoint A, hosted:** ALL PASS: #1 refund 2E429117X0390942B COMPLETED 27.2 s from claim, `PAYMENT.CAPTURE.REFUNDED` webhook verified and confirmed it at **56.7 s from claim**; retry returned the same refund; PayPal shows one refund. #6 denied with escalate link. #11 BLOCK `OVER_CAPTURE`. Audit chain verifies (18 events). This also completes spike S9 (webhook signature verification with a real sandbox event).

### Nov 4 (Day 6: MCP buyer agent)
- **Done:** `src/mcp/server.ts` + `app/mcp/route.ts`: MCP over streamable HTTP, stateless (fresh server + `WebStandardStreamableHTTPServerTransport` per request, JSON responses) with exactly the five spec tools; none confirms consent or moves money. `get_approval_link` creates the order with `return_url`/`cancel_url` and returns PayPal's `payer-action` URL (spike **S10 PASS**); `/orders/approved` completes the approval (capture or authorize) and `/orders/cancelled` says nothing was bought. DELEGATED via MCP takes an optional `agent_pick_sku`, stored server-side in `orders.agent_pick_sku` (migration `0003`, run on Neon) and captured at its real price right after approval (spec gap: section 14 has no tool for the agent's later pick). `choose_remedy` rejects unknown/made-up option ids and any amount that differs from the offer. README with the Claude Desktop setup (custom connector or `mcp-remote` config).
- **Fixes found on hosted:** colors with hyphens ("sky-blue") now match; vision retries once and a failed vision step now goes to a person (VISION_FAILED -> UNCLEAR) instead of asking the buyer for a new photo; `PROMISE_DAYS` 3 -> 2 so the demo ask "by Friday" matches from midweek.
- **Hosted check:** `scripts/mcp-check.ts https://undo-nu.vercel.app` **ALL PASS** (13 checks, real refund 0WA432674L402874W $8.70). 93 tests pass.
- **Risk:** Gemini free tier timed out once on hosted vision (30 s). Retry added; a paid key removes the risk.
- **Neon pool:** about 1 unused $29 tee left + 2 jackets; top up before the next hosted run.
- **Waiting on human:** connect Claude Desktop (README) and run propose -> approve on PayPal -> claim -> upload -> choose.
- **Next:** Day 7: AG Studio console (license is a trial; confirm terms with AG Grid).

### Nov 4 (Day 6 check + Day 7: AG Studio console)
- **Claude Desktop:** the hosted logs show Anthropic's connector (`Claude-User`) initializing and listing the tools at 14:55 UTC; no tool calls yet, so the Day 6 end-to-end run from Claude Desktop is still to do. Fix: `GET /mcp` now returns 405 (allowed by the MCP spec for a server with no SSE stream) instead of an SSE stream that hung until the 120 s timeout.
- **Done:** `/merchant` = AG Studio 3.1.0 (`ag-studio`, `ag-studio-react`, pinned) behind the merchant password, loaded client-only. Undo theme (`studioTheme.withParams` on the app's CSS tokens, so light/dark follow the app); one saved layout (default in code, "Save layout" keeps the merchant's own in this browser, "Reset layout"); a claims data source shown in a built-in grid (newest first); two custom widgets: **approval queue** (approve, edit amount, reject; HUMAN_REVIEW items get a propose form that runs the evaluator) and **evidence viewer** (listing art next to the buyer's photo, vision findings, fraud signals, fault reasons, audit-chain badge). One read: `GET /api/merchant/console`. Edit = `approveEdited`: a new proposal checked by the evaluator, then the old item is rejected and the new one approved (which re-checks and pays).
- **Done-when (local, real sandbox):** $120 jacket claim -> keep-it $36 queued; edit to $100 blocked in the console (`KEEP_ITEM_OVER_MAX_PCT`, original stays queued); edit to $30 -> refund 0S526827R2628481F sent, confirmed by the PAYMENT.CAPTURE.REFUNDED webhook -> claim RESOLVED; evidence viewer showed the right photos and reasons; audit chain verified (45 events).
- **Not done:** no AG Studio AI or Studio agent (Day 8, first on the cut list). The license is a 45-day trial (expires Dec 19); terms for the demo still to be confirmed with AG Grid.
- **Neon pool:** 1 unused $120 jacket left; top up before Day 8's trust-moment run.
