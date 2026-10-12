# MVP plan (branch `main-full`)

Goal: log in to a web app, set up a campaign with LinkedIn-style search
fields plus a "who I'm looking for" prompt, confirm it, and let it run:
search → profiles → evaluation in batches → manual review → approved queue →
outreach. One agent per LinkedIn account drives it through MCP tools, and
learns from review outcomes over time.

## Decisions (2026-10-11)

- **Agent decides, code enforces.** The agent chooses what to do through MCP
  tools; every tool checks the account caps and refuses when there is no
  room. Keeps `DECISIONS.md` §6's promise that the AI cannot break limits.
- **Hard caps in code** at Unipile's published maximums; `.env` can only
  lower them.
- **React + Vite** web app in `web/`; Fastify stays the API and serves it.
- **Users table, email + password** login with sessions.
- **Campaign search is a form** with LinkedIn's Premium people-search fields;
  ids for locations, industries, companies and schools are looked up through
  Unipile (sample lists in fake mode).
- **`LINKEDIN_MODE=fake`** by default, so everything runs without Unipile.
- Branch rule: one local commit per step, squashed before any push or merge.

## Steps

| # | Step | Status |
|---|---|---|
| 0 | Foundation: `npm run db:migrate`, fake/real LinkedIn client, caps in `.env` with hard limits | done |
| 1 | Web app + login: users, sessions, app shell, connect a LinkedIn account | done |
| 2 | Campaign builder: search fields + prompt → review page → start; stops at a target of approved leads | done |
| 3 | Collection pipeline (`npm run worker`): search and profile fetch within limits and working hours; every batch of profiles → real-model evaluation → approved / manual review / rejected; completes at the target | done |
| 4 | CRM views: leads list with filters, lead page with AI verdict and profile, manual review queue, campaign funnel; every decision saved next to the AI verdict | done |
| 5 | Invites: per-campaign approval switch, Invites page to queue approved leads, worker sends one at a time within weekly cap, daily share and randomized gaps; acceptance via Unipile new_relation webhook (simulated in fake mode) | done |
| 6 | Agent per account (OpenRouter, GLM 5.3 Flash): MCP server whose tools wrap the pipeline with limits enforced inside; worker wakes it on a schedule; Agent chat page to ask and change campaigns; every message and tool call saved; per-account lock | done |
| 7 | Learning: campaign insights (agreement with you, too loose / too strict, approval and acceptance rates) on the campaign page and as an agent tool; `test_prompt_change` re-scores your reviewed leads to measure a draft before the agent suggests it | done |

Out of scope for the MVP: messages and replies after acceptance, connection
notes, organizations, billing, the account-status webhook.

## Running it

```
docker compose up -d                       # Postgres
npm install
npm run db:migrate                         # creates or updates every table
npm run user:create -- you@email.com "Ascendia"
npm run serve                              # API (PORT in .env)
npm run dev:web                            # web app in development (Vite prints its address)
npm run worker                             # wakes each account's agent on a schedule
```

`LINKEDIN_MODE` is `fake` by default: sample people, nothing reaches LinkedIn,
but evaluation and the agent use the real model through OpenRouter. For
production, `npm run build:web` and the API serves the built app itself.

With real Unipile accounts: set `LINKEDIN_MODE=unipile`, `PUBLIC_URL`,
`UNIPILE_WEBHOOK_SECRET`, then run `npm run unipile:webhooks` once so
accepted invites are reported back.

## Known limits and next steps

- A prompt test scores the same decisions the draft was written from, so its
  agreement is optimistic; hold some decisions back once there are enough.
- The evaluation's built-in instructions still carry v1's age reasoning, which
  `DECISIONS.md` says should not carry over.
- A campaign overshoots its approved target by up to one evaluation batch.
- Untested against real Unipile (trial ended): search paging, the profile
  date format, and invite error types follow the docs only.
- Out of scope: messages after acceptance, connection notes, the
  account-status webhook, billing.
