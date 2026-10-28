# Progress

Full daily steps and working rules: `TASKS.md`. Spec: `CLAUDE.md`. Human setup steps: `docs/SETUP.md`.

## Checklist (spec section 20)

- [ ] **Day 1, Oct 29:** scaffold and deploy; spike scripts; sandbox accounts (human); AG Grid license request (human)
- [ ] **Day 2, Oct 30:** store and buyer page; CONFIRMED and DELEGATED checkout (JS SDK v6); Intent Record and `custom_id` hash; webhook verification; AG Studio hello-world (once license arrives)
- [ ] **Day 3, Oct 31:** claim intake, challenge code, vision, photo match, value thresholds
- [ ] **Day 4, Nov 1:** fault engine; policy compiler and evaluator
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
