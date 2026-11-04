# Progress

Full daily steps and working rules: `TASKS.md`. Spec: `CLAUDE.md`. Human setup steps: `docs/SETUP.md`.

## Checklist (spec section 20)

- [ ] **Day 1, Oct 29:** scaffold and deploy; spike scripts; sandbox accounts (human); AG Grid license request (human)
- [ ] **Day 2, Oct 30:** store and buyer page; CONFIRMED and DELEGATED checkout (JS SDK v6); Intent Record and `custom_id` hash; webhook verification; AG Studio hello-world (once license arrives)
- [x] **Day 3, Oct 31:** (done Nov 4; hosted check waits on Render) claim intake, challenge code, vision, photo match, value thresholds
- [ ] **Day 4, Nov 1:** (code done Nov 4; waits on your policy approval) fault engine; policy compiler and evaluator
- [ ] **Day 5, Nov 2:** offers, Lane A refunds with request ids, audit log
  - [ ] **CHECKPOINT A:** scenarios 1, 6 and 11 pass end to end
- [ ] **Day 6, Nov 3:** MCP server; Claude Desktop end to end
- [ ] **Day 7, Nov 4:** AG Studio console, theme, approval queue, evidence viewer with the audit badge
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
