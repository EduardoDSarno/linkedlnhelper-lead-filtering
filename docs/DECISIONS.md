# Decisions and Context

_Written 2026-09-27 from the research and discussion that led to the next
version of this project. `VISION.md` holds the goals. The implementation plan
is still to be worked out._

Numbers come from vendor docs and pricing pages checked in September 2026
unless marked otherwise. Figures marked **(estimate)** are industry estimates
or our own calculations. Treat them as starting points to replace with real
data.

---

## 1. Starting point

### Ascendia's current process

- Clients: Prudential franchisees in Brazil. Ascendia is paid per meeting
  booked.
- 27 client LinkedIn accounts.
- Per account per week: LinkedHelper runs a LinkedIn search with filters
  (location, area of work, higher education, …) and collects every result page
  (~700 profiles per campaign) → manual screening → 150–200 qualified → more
  campaigns until 200 → up to 200 connection requests a week → up to 3
  messages plus replies → goal: a phone number → spreadsheet update → an
  Ascendia employee (or the client) calls → meeting.
- Volume: **~1,000 profiles per account per week → ~27,000/week, ~117,000/month.**
- Labor in Brazil costs about **$300/month** per person.

### This repo, v1.0.0-mvp (in use)

LinkedHelper CSV → Apify profile collection (Bebity primary, Harvest fallback)
→ rule-based filter → LLM evaluation (OpenRouter) → review UI → approved CSV
back to LinkedHelper. Measured: **$0.99 per 1,000 profiles** for evaluation;
a 740-profile collection cycle cost about $50 ($29 Bebity flat, $15.70
Harvest, $3.31 proxy, $1.88 compute). See `docs/SNAPSHOT.md`.

What we found in its data:

- **LinkedHelper exports have career columns** (`organization_1..10`,
  `education_1..3`, `skills`, `summary`), but they were **0% filled** in every
  export we checked. Only headline, location, photo, and mutual-connection
  count were present, because the campaigns only collect search results.
- **A Bright Data test returned 210 of 217 profiles, but 0 with work
  experience.** Education, about, and current company came through. LinkedIn
  hides experience on the logged-out public page for these profiles. (The raw
  output was deleted with the v1 working files; this result is the record.)

### What forced a change

Bebity's new pricing, starting **2026-09-29**, per 1,000 events:

| Item | Free | Starter/Scale | Business |
|---|---|---|---|
| Profile: identity & current position | $3.00 | $2.80 | $2.80 |
| Experience & education | $2.00 | $1.80 | $1.60 |
| Single profile section | $1.00 | $0.90 | $0.90 |
| Company page | $3.00 | $2.50 | $2.50 |

A full profile is about **$4.40–5.00 per 1,000 → ~$515–585/month** at our
volume, for data alone.

---

## 2. Decision: build our own system, and keep LinkedIn automation out of it

We want our own product, not a layer on top of LinkedHelper, and we don't want
to run LinkedIn automation ourselves either.

### What we explored and rejected

- **Our own Playwright bot on the client's browser session.** Playwright's
  bundled Chromium plus its automation flags triggered Google's "This browser
  or app may not be secure" error. Real Chrome (`channel="chrome"`) with a
  persistent profile fixed login, but this means rebuilding what LinkedHelper
  does, with all the ban and maintenance risk.
- **Attaching to the user's own Chrome over CDP.** Works for one person, not
  as a product: terminal flags, copied profiles, single machine, must stay
  awake.
- **Local agent + cloud control plane.** Solves distribution, but still
  depends on the machine being on, adds code-signing and support overhead,
  and doesn't scale easily.
- **Cloud browsers (Browserbase).** Persistent contexts, live view, CDP URL
  for Playwright, $0.12/browser-hour. Its terms don't explicitly ban
  third-party ToS violations, but we must indemnify them and they can
  "terminate or suspend your access … for any or no reason." Building and
  running browser infrastructure is a lot of work for one customer.
- **One server per location or group of accounts.** Per-account residential
  proxies already do the isolation that matters to LinkedIn (IP and
  fingerprint), so separate servers aren't worth it yet.
- **An AI agent driving the browser to page through search results.** Paging
  is a fixed, repeatable task: a script does it for free, an agent pays tokens
  per page and sometimes goes wrong. The AI belongs in the decisions (search
  planning, evaluation, messages, replies), not the clicking.

### How the established tools work

- **LinkedHelper:** desktop app with its own browser, simulates clicks, no
  LinkedIn API. The machine must stay on.
- **Extension tools (Dux-Soup):** highest detection risk, since extensions are
  fingerprintable.
- **Cloud tools (Expandi, HeyReach):** virtual browsers with dedicated IPs.
  Lowest detection risk per vendor claims.

---

## 3. Decision: Unipile as the LinkedIn layer

Unipile is an unofficial API that operates a real LinkedIn account from its
servers. We call a REST API; it handles the session, proxies, and LinkedIn's
internals. Everything below is from Unipile's docs and pricing page.

### Pricing

| Linked accounts | EUR | USD |
|---|---|---|
| Up to 10 | €49/month | $55/month |
| 11–50 | €5/account/month | $5.50 |
| 51–200 | €4 | $5.00 |
| 201–1,000 | €4 | $4.50 |
| 1,001–5,000 | €3.50 | $4.00 |
| 5,001+ | €3 | $3.50 |

- Billed per connected account, whatever the channel. LinkedIn Classic, Sales
  Navigator, and Recruiter cost the same. **LinkedIn-only is fine.**
- "Unlimited usage. Only provider limits apply." Webhooks, hosted login, and
  built-in proxies are included.
- Post-paid on the peak number of connected accounts in the period. 7-day free
  trial, no card.
- **27 accounts ≈ €135/month (~$150).** The page doesn't say whether that's
  €49 + 17×€5 or 27×€5; both are about €135.

### Connecting accounts

- **Hosted login page:** we request a link. The client logs in on Unipile's
  page, and our `notify_url` receives the account id plus our own `name` value.
  Links expire, so generate one per attempt.
- Also possible: connecting by credentials or by cookie (`li_at` plus the
  browser's user agent, which they recommend to avoid disconnections).
- **Security checks** during login: `2FA`, `OTP`, `IN_APP_VALIDATION`,
  `CAPTCHA`, `PHONE_REGISTER`, to be solved within **5 minutes**.
  `TRY_ANOTHER_WAY` switches in-app approval to a code.
- **Proxy per account:** our own proxy, or Unipile's with `country` (e.g.
  `"BR"`) or `ip` (to match the client's location). It can be changed later
  on an existing account.

### LinkedIn features we need

| Need | Endpoint | Notes |
|---|---|---|
| Search | `POST /linkedin/search` | **Paste a LinkedIn or Sales Nav search URL**, or build filters. Sales Nav filters include tenure/years of experience and seniority. `GET /linkedin/search/parameters` turns text into LinkedIn ids (e.g. locations). |
| Full profile | `GET /users/{id}` | `linkedin_sections` picks sections. `*` fetches everything but LinkedIn may throttle it at volume, so request only experience and education. **`notify` defaults to false: the person isn't told we viewed them.** |
| Connection request | `POST /users/invite` | Optional note. List and cancel pending requests. |
| Detect acceptance | `new_relation` webhook | **Up to 8 hours delay.** Unipile checks at random intervals to avoid looking automated. A reply to the note arrives instantly as a message. |
| Start conversation | `POST /chats` | **Only with 1st-degree connections**, unless InMail (Premium) with `linkedin[inmail]=true`. |
| Reply in conversation | `POST /chats/{id}/messages` | A sent message can be deleted within 60 minutes. |
| Receive messages | `message_received` webhook | Real time. Also `message_read`, `message_delivered`, `message_reaction`, `message_edited`, `message_deleted`. Our own sent messages also arrive; compare sender with the account's user id. |
| Account health | `account_status` webhook | `OK`, `CREDENTIALS`, `ERROR`, `STOPPED`, `CONNECTING`, `RECONNECTED`, `CREATION_SUCCESS`, … **When not `OK`, message webhooks stop.** |
| History | list chats and messages, sync a full conversation | For the board and the caller handoff. |

Other things available: WhatsApp, email, calendars, posts and comments,
company profiles, Sales Nav lead saving, InMail balance, and a raw-data route
for LinkedIn features Unipile doesn't wrap yet.

**Webhook rules:** answer `200` within 30 seconds or Unipile retries 5 times.
A secret header can authenticate calls from Unipile.

### LinkedIn limits per account (Unipile's recommendations)

| Action | Paid LinkedIn account | Free LinkedIn account |
|---|---|---|
| Connection requests | 80–100/day, ~200/week, note up to 300 chars | **~5/month with a note** (200 chars), 150/week without |
| Profile retrievals | ~100/day (not enforced by Unipile) | same |
| Search results | 1,000/day (classic), 2,500 (Sales Nav/Recruiter) | 1,000 |
| Other actions (messages, …) | ~100/day each | same |
| InMail | depends on plan, up to 800 free/month | none |

Their guidance: spread actions randomly over working hours, never at fixed
intervals. Start new or inactive accounts low and ramp up. Accounts with under
~150 connections may have delivery problems. Brand-new accounts can't send
connection requests properly, so don't test with a fresh account.

**Free vs. paid means the client's LinkedIn subscription, not Unipile.** A
free LinkedIn account can attach a note to only ~5 connection requests a
month.

### Does our weekly volume fit, per account?

| Need | Limit |
|---|---|
| ~700–1,000 search results/week | 1,000/day ✅ |
| ~700 profiles/week | ~100/day ✅, at the ceiling. Start at 50–60/day. |
| ~200 connection requests/week | ~200/week ✅, at the ceiling |
| ~20–40 messages/day | ~100/day ✅ |

### Risks we accept

- Actions still come from the client's account, so this still breaks
  LinkedIn's rules (§8.2), same as LinkedHelper today.
- **Vendor dependency:** Unipile can cut us off, and LinkedIn can go after
  vendors. In March 2026 it removed HeyReach's company page and banned its
  founder's profile. All Unipile calls go behind one interface so we can swap
  vendors.

---

## 4. Decision: where profile data comes from

**Unipile first, Harvest to fill gaps.**

- Fetch full profiles through Unipile at **~50–60/day per account at first**,
  raising toward 100/day while the account stays clean. It's free under the
  flat fee.
- If the week won't reach ~200 qualified, top up with **Harvest's profile
  scraper: $4.00/1,000**, full experience with dates and education, no
  cookies, so it doesn't touch client accounts. Or just stop for the week.
- Harvest profile search is also available: $0.10 per page of ~25 results,
  plus $0.004/profile in full mode (≈ $8/1,000 total). Useful if we ever need
  search without a client account.
- If an account shows warnings or verification requests, pause Unipile
  fetching for it and let Harvest cover.

### Rejected

- **Bebity:** most expensive after 2026-09-29.
- **Cheap "public page" scrapers** ($1–2/1,000, e.g. apivault): they read the
  logged-out page, which gave 0% experience in our Bright Data test. Not
  tested ourselves yet; costs cents to check.
- **Our own scraper:** logged out, it lacks experience. Through client
  accounts, it risks them. With our own pool of accounts, that's what LinkedIn
  sued Proxycurl over (created accounts, settled mid-2025, service shut down).
- **Filtering on headline/location before fetching:** a headline isn't enough
  to judge these candidates, and location is already filtered in the search.

### Ways to lower cost without that

- **Better search filters** (years of experience, past titles, seniority) to
  raise the share that qualifies. Today ~20% pass (1,000 → 200); at 40% we'd
  need half the profiles.
- **Never fetch the same profile twice:** store profiles and reuse them for
  ~90 days. 27 clients searching overlapping Brazilian cities will repeat
  people.
- **Prompt caching** on evaluation: the fixed prompt is 20% of input tokens
  (`docs/SNAPSHOT.md`).

---

## 5. Cost estimate, 27 accounts, ~1,000 profiles/week each

| Item | ~Monthly |
|---|---|
| Unipile (27 accounts) | ~$150 |
| Profile data: Unipile free up to ~700/week/account, Harvest for the rest | $0–140 |
| AI evaluation (~117k × $0.99/1k) | ~$100–120 |
| AI connection notes and follow-ups (~40–45k short messages) **(estimate)** | ~$20–50 |
| AI reply conversations, better model **(estimate)** | ~$30–100 |
| Hosting: server + database, always on for webhooks | ~$20–50 |
| Calendar: Cal.com link or Unipile calendar accounts | $0–20 |
| **Total** | **~$350–550 (≈ $13–20 per account)** |

Compare: Bebity alone after 2026-09-29 ≈ $585/month. Each extra account costs
~$15/month.

Options we priced:

| Setup | ~Monthly |
|---|---|
| All profile data from Harvest (search + full, $8/1k), no client-account data use | ~$936 + Unipile |
| Unipile search + Harvest profiles for everyone | ~$620 |
| Unipile search + ~50/day Unipile profiles + Harvest rest | ~$455 |
| Everything through Unipile at 100/day | ~$150, no safety margin |

---

## 6. Decision: architecture principles

- **The account is the unit.** Each client LinkedIn account has its own
  criteria, pitch and tone, budgets, conversations, and health status.
- **Event-driven, not a free-running agent per account.** A scheduler in plain
  code decides volume and timing. The AI is called per event, with that
  account's context:
  - profile arrived → evaluate
  - qualified → write note
  - accepted → start sequence
  - reply → classify, get the phone number, draft an answer

  One conversation thread per lead. This keeps cost per lead flat and makes
  limits impossible for the AI to break.
- **Account health drives limits.** Track account age, acceptance rate,
  pending invites, and warnings.
- **Multiple accounts per customer from day one:** `organization_id` on every
  table. Ascendia is the only organization for now. No signup or billing yet.
- **Postgres, not SQLite.** Webhooks, scheduler, and UI all write at the same
  time. `docs/SNAPSHOT.md` already lists SQLite concurrency as a limit.
- **A login on the app is required.** It will be on the internet, receiving
  webhooks and holding phone numbers. v1 has no authentication.
- **Human approval before anything is sent** in the MVP. Autonomous replies
  come later, starting with simple cases.
- **Build in this repo, directly on `main`.** v1 leaves production on
  2026-09-29, so there is no bridge: the pilot's timeline matters. v1 is
  preserved without deleting anything: `handoff-local-app` holds every v1
  commit plus the Windows package, and tags mark v1's final state and the
  Windows build. `main` keeps only what the funnel reuses (evaluation core,
  OpenRouter client, Harvest collector, profile model) and adds the Unipile
  client, webhooks, scheduler, and lead pipeline.
- **Start small:** one thin working path end to end, then widen. No polish
  before it works.

The earlier Python `LinkedLead` repo (Playwright login) was deleted; it's
obsolete under this approach.

---

## 7. LinkedIn facts that shape the design

- **Connection requests:** baseline ~100/week; up to ~200 for older, trusted
  accounts (SSI > 65, acceptance > 40%, 6+ months); **under 30% acceptance
  gets throttled below 100.** Vendor-sourced **(estimate)**. It matches a
  LinkedHelper user doing ~200/week. Sales Navigator does **not** raise it.
- **Acceptance rate is the lever:** better targeting and messages raise the
  allowed volume.
- **Search cap:** 1,000 results per search (classic), 2,500 (Sales Nav),
  confirmed by LinkedIn Help. Broad targets need several narrow searches.
- **Free accounts** hit a monthly "commercial use limit" on searches. Sales
  Nav removes it.
- **Connection lists** are only visible for 1st-degree connections. Walking a
  lead's network only works after they accept, and pulls in the most
  third-party data (privacy exposure).
- **Enforcement:** User Agreement §8.2 bans bots and add-ons that automate
  messaging and connecting. LinkedIn moved from warnings to suspensions on
  first offenses in 2025–26. Detection combines behavior, session
  fingerprint, and identical message text sent to many people.
- **hiQ v. LinkedIn:** the "public scraping is legal" ruling covered
  logged-out data only. In Dec 2022 hiQ accepted a **$500,000 judgment**,
  liability for breach of contract and CFAA (including access to
  password-protected pages via accounts), and an injunction. It was already
  defunct.

---

## 8. Compliance and ethics

- **LGPD (Brazil):** we store profiles, conversations, and phone numbers for
  27 clients' prospects. Plan retention and deletion from the start. Keep
  only what we use.
- **Photo-based "apparent age":** v1's image analysis estimates age from
  faces. Screening people that way is a legal and reputational risk. If
  criteria need age, derive it from career dates.
- **Account owners must know** their LinkedIn account is being automated.
- **If expanding abroad:** US TCPA applies to calling captured numbers (manual
  calls to a number the person gave are fine; autodialing and texting need
  care). Canada's CASL covers commercial electronic messages. Sales blogs say
  LinkedIn messages fall outside it, but that's unverified, so get a legal
  read.

---

## 9. Market notes (for the US/Canada vision)

- In-house SDR ~$4–6k/month; offshore assistant ~$500–1,000/month
  **(estimate)**.
- Insurance and advisor recruiting demand: 75% of insurance leaders cite
  talent shortages; US labor statistics project ~31,200 new financial advisor
  jobs through 2034.
- Competition in AI lead scoring: **Clay** (since March 2026: Launch
  $185/month, Growth $495/month), Bitscale, Apollo (~$49/seat). Generic
  qualification is a commodity. The full funnel to the meeting is not.
- US agencies more often use cloud senders (HeyReach, Expandi), another
  reason to keep the LinkedIn vendor behind an interface.

---

## 10. Answered (2026-09-27)

- **Accounts:** all Premium, on the cheapest paid plan, paid for by the
  clients. **Not Sales Navigator**, so no years-of-experience or seniority
  search filters: the AI evaluation carries all of the qualification. Notes on
  connection requests are available.
- **Their current invite cadence:** ~200 per week, sent as two rounds of
  ~100 (LinkedHelper defaults to 50 per round; they raise it). Never 200 at
  once. Our scheduler should count a rolling 7-day window per account and
  spread sends across working hours, which is smoother than two bursts.
- **Funnel, per account per week:** ~200 connection requests → ~20 phone
  numbers (10%) → ~8 meetings (4%) → ~4 continue in the process. Acceptance
  rate is still unknown. Across 27 accounts that is ~935 meetings a month, so
  the §5 estimate works out to roughly **$0.40–0.90 per meeting**; the
  quantity to optimize is requests → phone numbers, not cost per profile.
- **Profile data economics:** filtering alone is not worth it on paid profile
  data. Harvest for every profile (~$470/month at this volume) is why v1
  stops being used on 2026-09-29. The plan only works if Unipile profile
  fetches carry most of the volume, so the first thing to prove is that one
  account sustains ~100 fetches/day plus invites and messages without
  warnings.
- **Unipile proxies:** each LinkedIn account gets a fixed IP automatically;
  country (50+) or an IP to match can be chosen, or our own proxy supplied,
  and changed later. Our server's location does not matter to LinkedIn. Pass
  `country: "BR"` explicitly when connecting: a third-party source says the
  default proxy sits near whoever opens the login link, which would be the
  wrong country. The docs do not state that every action (not only login)
  uses the proxy; verify in the trial. Unipile's per-account rate limits are
  "Coming Soon", so limits stay in our code.
- **Unipile trial:** assumed to include all features. Build the thin path
  before starting the 7-day clock, and test on an account with Premium,
  >150 connections, and some history.
- **Ascendia Co-Pilot:** a website; ignore.
- **Exact Unipile bill:** €134 or €135 either way; not worth resolving.
- **Autonomy:** the goal is the AI sending everything on its own. Human
  approval exists for the testing phase only, so build it as a switch per
  account and per message type, and record approved / edited / rejected: that
  record is the evidence for when to turn it off.
- **Scope:** one account for the MVP, built so it scales to many without
  rework. Solo, personal project.
- **Criteria are the customer's, not ours.** The customer describes who
  qualifies and it passes through to the model; the instruction layer stays
  generic. Age is an Ascendia criterion in their prompt. (v1 does encode it:
  a structured `age` field, an "age is a primary cut" rule, `estimatedAge`
  output, photos in the request. None of that carries over.) Whether photos
  are sent at all remains our decision.
- **Model quality is the hardest part.** Approach it by measurement, not
  fine-tuning: a fixed set of profiles with human verdicts, re-scored on every
  prompt change. v1 already holds 1,208 human decisions (416 approved, 792
  rejected) locally, and the friend's Windows install holds about two weeks
  more of real reviewer decisions; collect that database before it is
  deleted, with Ascendia's agreement, under LGPD.

## 11. Still open

1. Acceptance rate per account (requests → accepted).
2. Trial checks: does a pasted search URL return the same people
   LinkedHelper found; are webhooks reliable over several days; does every
   action go through the account's proxy.
3. Which replies the AI may send on its own first.

---

## Sources

- Unipile: [pricing](https://www.unipile.com/pricing-api/),
  [provider limits](https://developer.unipile.com/docs/provider-limits-and-restrictions),
  [LinkedIn connection](https://developer.unipile.com/docs/linkedin),
  [hosted auth](https://developer.unipile.com/docs/hosted-auth),
  [search](https://developer.unipile.com/docs/linkedin-search),
  [retrieve profile](https://developer.unipile.com/reference/userscontroller_getprofilebyidentifier),
  [invite](https://developer.unipile.com/docs/invite-users),
  [accepted invitations](https://developer.unipile.com/docs/detecting-accepted-invitations),
  [send messages](https://developer.unipile.com/docs/send-messages),
  [new messages webhook](https://developer.unipile.com/docs/new-messages-webhook),
  [account status](https://developer.unipile.com/docs/account-lifecycle),
  [webhooks](https://developer.unipile.com/docs/webhooks-2),
  [update proxy](https://developer.unipile.com/reference/accountscontroller_patchaccount),
  [docs index](https://developer.unipile.com/llms.txt)
- Harvest: [profile scraper](https://apify.com/harvestapi/linkedin-profile-scraper),
  [profile search](https://apify.com/harvestapi/linkedin-profile-search)
- Other scrapers: [apivault](https://apify.com/apivault_labs/linkedin-profile-scraper-no-cookies),
  [Bright Data pricing](https://apiserpent.com/blog/brightdata-linkedin-pricing-explained),
  [Proxycurl shutdown](https://linkedapi.io/guides/proxycurl-alternatives)
- Browserbase: [contexts](https://docs.browserbase.com/platform/browser/core-features/contexts),
  [pricing](https://www.browserbase.com/pricing),
  [terms](https://www.browserbase.com/terms-of-service)
- LinkedIn limits: [Sales Navigator search limit (LinkedIn Help)](https://www.linkedin.com/help/sales-navigator/answer/a106030),
  [connection limits (Taplio)](https://taplio.com/blog/linkedin-connection-request-limit),
  [limits (Linked API)](https://linkedapi.io/guides/linkedin-connection-limit-2026)
- Enforcement and legal: [2026 crackdown](https://www.anybiz.io/blogs/linkedin-automation-what-actually-changed/),
  [ToS & scraping](https://connectsafely.ai/articles/is-linkedin-automation-safe-tos-scraping-guide-2026),
  [hiQ v. LinkedIn wrap-up](https://www.zwillgen.com/alternative-data/hiq-v-linkedin-wrapped-up-web-scraping-lessons-learned/),
  [hiQ settlement](https://www.privacyworld.blog/2022/12/linkedins-data-scraping-battle-with-hiq-labs-ends-with-proposed-judgment/)
- Tools: [Linked Helper review](https://www.salesrobot.co/blogs/linked-helper-2-review),
  [cloud vs extension](https://prospectingmanual.com/linkedin-automation/cloud-vs-extension-which-is-safer/)
- Market: [insurance hiring](https://agents.quotewizard.com/resources/guide-to-hiring-insurance-agents/),
  [advisor outlook](https://smartasset.com/advisor-resources/financial-advisor-job-outlook),
  [Clay pricing](https://www.warmly.ai/p/blog/clay-pricing),
  [CASL implied consent (CRTC)](https://crtc.gc.ca/eng/com500/guide.htm)
