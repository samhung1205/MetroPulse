# AGENTS.md

## Project
MetroPulse

## One-line Summary
MetroPulse is a Taipei Metro recommendation web app extended from an academic PageRank-based passenger-flow research project.

## Current Stack
Keep and extend the existing stack unless explicitly asked to change it:
- Hono
- TypeScript
- Vite
- Cloudflare Pages
- Cloudflare D1
- Wrangler

Do **not** rewrite the project into React/Next.js or another stack unless the task explicitly requires a migration plan.

## Core Product Goal
Build and improve a demo-ready, explainable recommendation website where users can:
- choose an origin station
- choose a time period
- choose a preference type
- receive Top 5 recommended stations with reasons

## Core Research Logic
The project must preserve the original research background:
- `e_ij`: passenger flow from station `i` to station `j`
- `s_i`: total outbound flow from station `i`
- `p_ij = gamma * (e_ij / s_i) + (1 - gamma) * (1 / n)`
- `gamma = 0.85`
- Power Method computes PageRank
- `PR_j` represents station popularity / importance in a given time period

## Production Data & Temporal Architecture
Production `mrt-rank-db` (Cloudflare D1) holds **real passenger-flow data**, not test fixtures —
as of this writing, daily granularity covers 2025-03-19..2026-08-31 (rolling 18-month retention
window on `daily_od_flow`; 2025-01-01..2025-03-18 daily rows were already purged per policy),
`year:2025` is fully materialized, and `holiday_events` has 10 confirmed holiday ranges plus the
existing lunar-new-year entries. Treat any script or query touching this database as touching real
production state, not a disposable sandbox — local `.wrangler/state/v3/d1` and any `--db-name`
other than `mrt-rank-db` are the safe places to experiment.

Temporal data model (five tables, see README "生產環境與資料維運" for full detail):
- `daily_od_flow` — rolling 18-month window, sole input for range materialization.
- `range_od_flow` / `range_pagerank` — permanent, pre-aggregated per `range_id`
  (`month:YYYY-MM` / `year:YYYY` / `holiday:<event_key>:YYYY`). Production queries read these,
  never `daily_od_flow` directly.
- `date_ranges` — completeness/coverage bookkeeping per range.
- `holiday_events` — human-maintained holiday metadata; the only source of truth for which
  holidays exist and their date ranges.

**Year aggregation must be rebuilt from monthly `range_od_flow`, never from averaging monthly
PageRank values.** PageRank is not a linearly additive quantity — the only correct way to compute
`year:YYYY` is to sum the 12 months' `range_od_flow` (batched by period to avoid a remote D1 CPU
limit on scanning ~22M+ row `daily_od_flow` in one query), rebuild the transition matrix, and rerun
Power Method from scratch. `materialize_year_range.py` already does this correctly — do not
"optimize" it back into a direct full-year `daily_od_flow` scan or into averaging per-month
`pr_value`.

Every temporal script's correctness is judged against these invariants (see `verify_range_parity.py`
/ `verify_year_parity.py` / `verify_holiday_parity.py`):
- **OD conservation**: aggregated `range_od_flow` totals per period must exactly match an
  independent `daily_od_flow` scan.
- **118-station coverage**: PageRank output must cover all 118 stations with no gaps, `pr_value`
  summing to ≈1.0 (Power Method normalization invariant), `pr_rank` a complete 1..118 permutation.
- **No silent downgrade**: `materialize_year_range.py` / `materialize_holiday_range.py` must refuse
  (non-zero exit) to recompute a range that is already `is_complete=1` — this protects a completed
  range from ever being accidentally clobbered by a re-run.

## Retention & Purge Rules
`daily_od_flow` retention is `scripts/retention.py`, rolling 18-month window by default. It only
ever deletes from `daily_od_flow` — `range_*` / `date_ranges` / `holiday_events` / `real_*` /
`data_months` / `stations` have no delete path in this script and must never gain one without an
explicit, separate decision.
- **A connected holiday/year still marked incomplete in `date_ranges` (including one that has
  never been materialized at all) blocks purge of any date it covers**, unless the caller passes
  `--acknowledge-unmaterialized-ranges` explicitly — never make this the default.
- Production-scale purges must be **batch-deleted** (`--batch-days`, default 7) — a single
  unbatched DELETE over the full window can exceed D1's CPU time limit (code 7429) and be rolled
  back cleanly, but wastes the run. Batches are resumable: re-running after a partial failure picks
  up from whatever is still in scope, no manual bookkeeping needed.
- **Any production destructive operation (purge, large DELETE, schema change) requires a
  `--dry-run` first and a fresh Cloudflare D1 Time Travel recovery bookmark
  (`wrangler d1 time-travel info <db>`) captured immediately before executing** — this is not
  optional process, it's how every purge in this project's history has actually been run.
- `--purge` must never be wired into an unattended automated schedule. `--dry-run` can be
  scheduled; a human reviews the output before anyone runs `--purge`.

## R2 Archive Role
Cloudflare R2 bucket `metropulse-raw-od-archive` stores the raw monthly CSVs
(`import_od_data.py --archive-to-r2`) for provenance and future re-import — it is **not** read by
the deployed Worker at request time (no R2 binding in `wrangler.jsonc`). D1 is the only production
query path.

## Monthly Maintenance SOP
- **Availability check is automated**: `.github/workflows/monthly-data-check.yml` runs on a
  biweekly schedule (plus manual `workflow_dispatch`), calling `scripts/check_latest_od_month.py`
  (read-only — no Cloudflare credentials, just the site's own public `/api/analytics/months` and a
  HEAD request against the official CSV). It only opens/updates a GitHub Issue when a new month is
  published; it never imports anything.
- **Production import requires human approval to trigger, but the run itself is automated**:
  `.github/workflows/monthly-data-import.yml` is `workflow_dispatch`-only (year/month required,
  optional `holiday_event_key`). It runs import → R2 archive → `verify_range_parity.py` (must be
  6/6 PASS) → `materialize_year_range.py` (safe no-op if the year isn't complete yet) →
  `verify_year_parity.py` → optional `materialize_holiday_range.py` /
  `verify_holiday_parity.py` → `verify_recommend_baseline.py`. Any failing step stops the job.
- **Retention purge is never automated** — see Retention & Purge Rules above; it has no workflow
  and must stay that way.
- If proposing further automation, keep the human-approval gate before any write step and never
  wire `--purge` into a schedule.

## Recommendation Philosophy
The recommendation system should remain explainable.
Prefer rule-based or interpretable scoring over black-box models.

Default recommendation shape:
`Score(j) = w1 * PR_j + w2 * p_ij + w3 * PreferenceMatch_j - w4 * TravelCost_ij`

Any change to recommendation behavior should explain:
1. what changed
2. why it changed
3. what user-facing effect it causes

## How to Work on This Repo
Before making code changes:
1. inspect the relevant files first
2. summarize the current implementation briefly
3. propose a short plan
4. default to minimal necessary changes
5. if the issue is structural or repeatedly recurring, propose a refactor plan first
6. end with validation steps and expected result

## Change Strategy
Prefer **smallest useful change**, not broad refactors.

That means:
- do not rename many files unless necessary
- do not move code across the project without strong reason
- do not rewrite working modules just for style consistency
- preserve current stack and routing style
- optimize for project continuity and demo reliability

Larger refactors are allowed only when:
- there is a recurring structural problem
- the current code blocks further progress
- the user explicitly asks for refactoring or migration

## Most Common Task Types
Typical tasks in this repo:
- improve homepage UI
- fix API or rendering bugs
- refine recommendation formula and explanations
- improve station detail page
- adjust D1 schema / queries / seed flow
- prepare deployment and smoke-test checks

## Files Likely Relevant by Task
- entry / page behavior: `src/index.ts`
- API routes: `src/routes/`
- recommendation logic / shared logic: `src/lib/`
- DB access and queries: `src/db/`
- scripts and deployment: `package.json`, `wrangler.jsonc`
- production data ETL / validation / retention: `scripts/*.py`
- monthly automation: `.github/workflows/monthly-data-check.yml`, `.github/workflows/monthly-data-import.yml`

## Deployment Rules
Use the existing deploy flow first.
Default deploy entry is:
- `npm run deploy`

Production deploy may use the explicit production script (`npm run deploy:prod`) when needed.
Do not invent a new deployment workflow unless asked.

**The production deployment target is always the existing `metro-go` Cloudflare Pages project**
(Direct Upload, no Git integration, production branch `main`, D1 binding `mrt_rank_db` →
`mrt-rank-db`, no R2 binding). `npm run deploy:prod` already targets it explicitly
(`--project-name metro-go --branch main`) — never create a second Pages project, never create a
second production hostname, and never change the D1 binding to point at a different database
without an explicit, separate decision from the user.

## Overnight Time Window (Future Backlog Rule)
The six time periods (see README) deliberately exclude 23:00 and 00:00–06:00 — this is intentional,
not a gap to "fix" by extending the period list. Ordinary nights have no stable, comparable
ridership pattern worth recommending on. If a future task asks for overnight analysis, it should be
scoped as an **event-specific** analysis (e.g. New Year's Eve extended/overnight service), separate
from and **not a modification of** the existing six-period model.

## Documentation Sync Rule
Whenever a code change affects user-facing behavior, project structure, setup steps, deployment flow, API behavior, recommendation logic, or any README-described feature, update `README.md` in the same task.

Do not assume README updates are optional.
After making changes, explicitly check whether the README content is still accurate.
If it is no longer accurate, update it before finishing the task.

## Quality Bar
Every meaningful change should try to preserve or improve:
- demo readiness
- explainability
- maintainability
- compatibility with current stack
- clear user-facing behavior

## Communication Style for AI Agents
When responding in this repo:
- be concrete
- explain current state first
- then propose a short plan
- avoid dumping huge rewrites
- call out risks or assumptions clearly
- keep suggestions practical for a student project
