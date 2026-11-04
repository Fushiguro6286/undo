# Human setup steps (Day 1)

Do these in order. Each step says exactly what to copy where. Never paste secrets into chat; put them only in `.env` (local) and the Render dashboard.

## A. PayPal sandbox accounts (developer.paypal.com)

1. Log in at https://developer.paypal.com/dashboard/ (create a developer account if needed).
2. Go to **Testing Tools → Sandbox Accounts → Create account**. Create:
   - **Business**, country **United States**: the merchant ("Fernleaf Goods"). Note its email.
   - **Business**, country **United States**: the agent platform. Note its email.
   - **Personal**, country **United States**, three times: buyer 1, buyer 2, buyer 3. For each, open **⋯ → View/Edit account** and note the email and the system-generated password (or set your own).
3. For each personal account, check it has a PayPal balance or a card on file (the default sandbox accounts do). The approval page needs one.

## B. Two REST apps

1. Go to **Apps & Credentials**. Make sure the toggle at the top says **Sandbox**.
2. **Create App** → name `undo-merchant`, type **Merchant**, sandbox account = the merchant business account. Open it and copy:
   - Client ID → `PAYPAL_CLIENT_ID` and also `NEXT_PUBLIC_PAYPAL_CLIENT_ID`
   - Secret → `PAYPAL_CLIENT_SECRET`
   - In the app's feature list, make sure **Disputes** (and Payouts, if listed) are enabled, then **Save**.
3. **Create App** → name `undo-agent-platform`, type **Merchant**, sandbox account = the agent-platform business account. Copy:
   - Client ID → `AGENT_PLATFORM_CLIENT_ID`
   - Secret → `AGENT_PLATFORM_CLIENT_SECRET`
   - Make sure **Payouts** is enabled in its feature list, then **Save**.

## C. Local `.env`

`.env` already exists in the project folder (copied from `.env.example`, gitignored). Fill in:

```
PAYPAL_CLIENT_ID=...            # undo-merchant
PAYPAL_CLIENT_SECRET=...
NEXT_PUBLIC_PAYPAL_CLIENT_ID=... # same as PAYPAL_CLIENT_ID
AGENT_PLATFORM_CLIENT_ID=...    # undo-agent-platform
AGENT_PLATFORM_CLIENT_SECRET=...
SPIKE_BUYER_EMAIL=...           # buyer 1's sandbox email (S6 payout target)
```

Leave `PAYPAL_WEBHOOK_ID` and `APP_BASE_URL` empty until step E.

## D. GitHub + Render deploy

1. GitHub repo: tell me "create the repo" and I'll run `gh repo create undo --private --source . --push` from your logged-in `gh` (account `Fushiguro6286`). It stays private until submission week; or create it yourself and push.
2. Render (https://dashboard.render.com), **New → Blueprint** → connect the `undo` repo → Render reads `render.yaml` and proposes:
   - web service `undo` (plan `0.5c-512mb`, paid, always on)
   - Postgres `undo-db` (plan `0.1c-256mb`, paid)
3. Render asks for every `sync: false` variable. Fill in the PayPal values from step C. Set `LLM_MODEL` to `gemini-3.5-flash-lite` and `GOOGLE_GENERATIVE_AI_API_KEY` to your Gemini key. Leave `JUDGE_LOGIN_PASSWORD` and `AG_STUDIO_LICENSE_KEY` empty for now. Set `APP_BASE_URL` once you know the URL (next step).
4. **Apply**. When the first deploy finishes, copy the service URL (for example `https://undo-xxxx.onrender.com`).
5. In the `undo` service → **Environment**: set `APP_BASE_URL` to that URL (no trailing slash). Also put it in local `.env`.
6. Open `<URL>/api/health`. Expected: `{"ok":true,"paypalEnv":"sandbox","database":"ok"}`.

## E. Webhook (needs the Render URL)

1. Developer dashboard → **Apps & Credentials** → `undo-merchant` → **Sandbox Webhooks → Add Webhook**.
2. URL: `<Render URL>/api/webhooks/paypal`
3. Events: **Payment capture completed**, **Payment capture refunded**, **Customer dispute created**, **Customer dispute updated**, **Customer dispute resolved** (or tick **All events**).
4. Save, copy the **Webhook ID** → `PAYPAL_WEBHOOK_ID` in local `.env` **and** in Render's Environment (Render redeploys).

## F. Run the spikes (tell me when A–E are done; I run them, you click approvals)

| Order | What happens | What you do |
|---|---|---|
| S1 | OAuth for both apps | nothing |
| S7 | Test-card order captured with no buyer | nothing |
| S2 | Prints a PayPal link | open it, log in as **buyer 1**, check the item reads "Classic Tee, Sky Blue, M", click **Pay**/**Complete** |
| S3 | Prints a PayPal link | log in as **buyer 1**, check it reads "Agent purchase up to $35: blue tee, size M, by Fri", approve |
| S4 | Refunds $1 twice with the same request id | nothing |
| S5 | Adds and updates tracking on the S2 order | nothing |
| S6 | $2 payout from the agent platform to buyer 1 | nothing (optionally log in as buyer 1 and see it) |
| S9 | Checks the webhook, then S2/S7 events should show `verified=true` in Render **Logs** | open Render → `undo` → **Logs**, search `[webhook]`, tell me what you see |
| S8 | Disputes | see G |

## G. Open one test dispute (for S8)

1. Go to https://www.sandbox.paypal.com and log in as **buyer 1**.
2. Open **Activity**, find the $29.00 "Fernleaf Goods" payment from S3 (the $29 DELEGATED capture), open it, click **Report a problem**. If that's missing, go to https://www.sandbox.paypal.com/resolutioncenter.
3. Choose **Item not received** (or "not as described"), fill the form and submit.
4. If the site offers **Escalate to a claim**, don't escalate yet. Tell me the dispute is open; S8 reports its state, and I'll say whether to escalate.
5. Sandbox disputes can take several minutes to appear in the API.

## H. AG Grid license (sponsor Discord)

Post in the PayPal hackathon Discord's AG Grid channel (in writing):

> Hi! I'm building "Undo" for the PayPal AI Hackathon with AG Studio as the merchant console. Could I get an AG Studio / AG Grid Enterprise license key for the hackathon? The rules require the hosted demo to stay up for judges until Dec 15, 2026, so I'd need the key to stay valid through at least Dec 15, 2026. Could you confirm that in writing? Thanks!

When you have the key, put it in `.env` and Render as `AG_STUDIO_LICENSE_KEY`.
