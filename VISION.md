# Goals and Vision

_Written 2026-09-27. Companion to `DECISIONS.md`, which holds the research and
reasoning behind everything here. The implementation plan is still to be
worked out._

## The problem we solve

Lead-generation agencies on LinkedIn do a lot of repetitive manual work between
"run a search" and "call a qualified person": screening hundreds of profiles by
hand, writing messages, watching inboxes, pulling phone numbers out of
conversations, and keeping spreadsheets up to date for every client.

## First customer: Ascendia

Ascendia (ascendiaassessoria.com) does commercial structuring for **Prudential
franchisees in Brazil**. It finds candidates for a high-ticket purchase, a
Prudential franchise, so screening has to be strict. It is **paid per meeting
booked**.

- 27 client LinkedIn accounts, about **1,000 profiles per account per week**
  (~117k per month in total).
- Today: LinkedHelper search campaign (~700 profiles) → manual screening →
  150–200 qualified → up to 200 connection requests a week → 3-message sequence
  and replies → get a phone number → spreadsheet → someone calls → meeting.
- This repo (v1.0.0-mvp) already removes the manual screening step and is in
  use.

Ascendia is the **test case and design partner**, not the final market. In
Brazil a person doing this work costs about $300/month, so a tool there has to
be very cheap.

## Short-term goal (MVP)

Automate Ascendia's work **from the LinkedIn search up to the phone number**,
per client account, with a person still making the call.

- Replace LinkedHelper, the Bebity profile scraping, and the 27 spreadsheets.
- Keep every client account safe: nothing that risks getting it restricted.
- Run for roughly **$350–550/month for all 27 accounts** (see `DECISIONS.md`).
- Keep a human approving messages until the AI is trusted.

### How we'll know it works

- **Meetings booked per account** (what Ascendia gets paid for).
- **Cost per meeting.**
- **Hours of manual work removed.**
- No client account restricted.

## Long-term vision

Start with **US and Canadian multi-account agencies and recruiting teams** that
repeatedly source insurance agents or financial advisors on LinkedIn and are
measured on qualified conversations or booked meetings. Let each client define
who qualifies in plain language, then manage the work from search through
screening, outreach, replies, caller handoff, and meeting outcome tracking.

- **First buyer:** a team managing sourcing for multiple client accounts, with
  recurring candidate volume and a clear cost per booked meeting.
- **Later markets:** franchise development firms and pay-per-appointment
  agencies with the same high-value, candidate-style sourcing workflow.
- **What we must prove:** more qualified meetings, lower cost per meeting, or
  fewer manual hours than the buyer's current tools and process. Campaigns and
  shared inboxes already exist; our value is qualification tied to meeting
  outcomes for each client account.

## Product principles

- **Quality over volume.** Acceptance rate decides how many invites LinkedIn
  allows, so better targeting and better messages are also what raise volume.
- **Account safety is a feature.** Limits live in code, never in the AI.
  Pause instead of pushing through warnings.
- **Human in the loop first.** Automate a step fully only after it has proven
  itself.
- **Learn from outcomes.** Record which criteria and messages lead to accepted
  invites, replies, and meetings, and use that to improve.
- **Never sell "undetectable."** It isn't true.
- **Account owners know their account is automated.**

## Working sketch of the flow (not the plan)

1. Client's LinkedIn account connected through Unipile, with a Brazilian proxy.
2. Client criteria, pitch, and search URL set up.
3. Search → leads saved.
4. Full profiles fetched (Unipile first, Harvest to fill gaps).
5. AI evaluates each profile against the criteria.
6. Repeat until ~200 qualified for the week.
7. AI writes the connection note → approved → sent within daily limits.
8. Accepted → AI writes the 3-message sequence → approved → sent.
9. Replies → AI sorts them, pulls out phone numbers, drafts answers.
10. Phone number → call list → caller → "meeting booked" recorded.

## Not goals right now

AI replying on its own, calendar integration, WhatsApp, billing, self-service
signup, multiple customers besides Ascendia, polished UI.
