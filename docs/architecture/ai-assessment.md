# AI animal assessment (Part 15)

Decision support for growth, readiness for sale, recorded cost of ownership and suggested price ranges. Code: `services/api/src/modules/ai/`; web: _Sale assessment_ on an animal, and `/admin/ai`.

## What it is, and is not

- **Decision support only.** Every assessment carries a disclaimer: not veterinary diagnosis or professional advice, based only on the records entered and the market data shown. FARM+ does not interpret health records (it counts them and shows dates, including a _recorded_ medicine withdrawal period).
- **The owner decides.** Nothing here creates a listing, changes an animal or finalises a sale; there is no endpoint that does (tested: listings, orders and the animal are untouched). Owners/managers (`listings.manage`) review an assessment (accept/dismiss, with a note) or dismiss single suggestions; every decision is kept in a history.
- **Numbers are calculated, not generated.** A deterministic engine (`engine.ts`, pure and unit-tested) produces every figure. An AI model may only add a short plain-language explanation of those figures, and may be switched off entirely: with `AI_PROVIDER=none` assessments are complete without it.
- **Nothing is invented.** Missing data produces `unknown`, `null` and a warning — never a guess. A cost of "no records" is _unknown, not zero_. No agronomic thresholds and no market prices ship with FARM+ (see below).

## Output (`AssessmentDTO`)

`animalId`, `assessmentDate`, `animalType`, `readinessScore` (only when a validated method exists), `readinessFactors`, `estimatedPriceRange` (only when supportable), `expectedProceeds`, `costSummary`, `growth`, `health`, `dataQualityWarnings`, `confidence` (+ explanation and reasons), `recommendations`, `narrative`, `modelVersion`, `criteria` used, `review` (`reviewedBy`, `reviewedAt`), `requestedBy`, `disclaimer`.

### Readiness (animal-type-specific)

Factors are either facts about the records (animal available, not already listed, recent weight, average daily gain, no running withdrawal period) or comparisons with **configured criteria** for the animal type (minimum age/weight, target weight range, minimum gain, no illness/treatment within N days, vaccination within N days). Each factor says its basis (`recorded_data` / `configured_criteria`), what was measured and what it was compared with.
**Criteria are supplied by an administrator** (`animal_types.manage`) with a mandatory _source_; every change is a new version, and each assessment records the version it used. FARM+ ships none, so without criteria there are only the fact-based factors and a `no_criteria` warning.
**A score exists only if the criteria are marked _validated_ (with a validation reference), and only if every criterion could be evaluated**: it is the share of configured criteria met (equal weights). Otherwise `readinessScore` is `null` and a note says why.

### Price range and proceeds — authorised data only

Bases, never blended, each reported with its sample size: (1) **completed FARM+ sales** (orders that reached DELIVERED) of the same animal type and sex in the last `ai.marketWindowDays`, **other farms only**, aggregated (only the 25th/median/75th percentile are returned — never an individual sale or extreme); (2) **prices an administrator imported**, each with a source and an _authorisation_ statement (per animal, or per kg × the latest recent weight). A range (middle half of observations, with the median) is suggested only with at least `ai.minMarketSamples` observations (default 5); otherwise there is no range and the shortfall is disclosed. The range is not adjusted for age, condition, breed or location, and says so.
**Expected proceeds** subtract the platform fee under today's commission rules (read-only; the real fee is fixed at checkout). Shipping is excluded. "Net over recorded cost" is _not profit_ (unrecorded costs are not in it) and is withheld when no cost is recorded.

### Costs, growth, health

Costs: only expenses recorded against **this animal** (requires `expenses.read`; otherwise omitted with a warning). Farm-wide costs are not allocated (the count is disclosed). Growth: first/latest weights, average daily gain (needs two weights ≥ 7 days apart), share of estimated (tape/visual) weights. Health: counts by type for 90 days, latest dates, running withdrawal end.

### Confidence

A **data-completeness** indicator (`low`/`medium`/`high`) with reasons — not a statistical probability, and labelled so. Low without weights, without a supportable price range, without criteria or for an unavailable animal; medium with unvalidated criteria or old/approximate data.

## The AI explanation

- **Provider abstraction** (`provider.ts`): `none`, `mock` (dev/test; refused in production) and `anthropic`. The Anthropic adapter follows the documented Messages API and is tested against a fake HTTP endpoint (request shape, parsing, error mapping, timeout); **it has not been run against the live service here.** The key (`AI_API_KEY`) is read from the server environment, sent only in the provider request header, and never logged, stored or returned (tested across responses, audit logs, usage rows and stored assessments).
- **Data minimisation / "never claim a model has data it was not given":** the model receives only a JSON of the engine's results — numbers, enumerations and our own sentences; money in baht. No names, notes, suppliers, addresses, ids or free text from records, so there is also no route for prompt injection through them. The exact facts sent are stored with the assessment (`inputs.aiFactsSent`) so what the model saw is auditable.
- **Validation (`narrative.ts`):** a single JSON object matching a strict schema with length limits; no links, markup or control characters; **blocked stems** (`ai.blockedNarrativeTerms`: diagnos, prescri, treat, cure, guarantee… — a starter list); and **every number must appear in the facts** (plus small counting numbers 0–10). Anything else is **rejected and discarded**: the assessment is stored without an explanation (`narrative.status = rejected` with the reason code), the raw output is neither shown nor stored, and the figures are unaffected. Provider failures (timeout, rate limit, auth, unavailable, bad response) likewise never break an assessment.
- Shown to users labelled **AI-generated**, and the model name appears in `modelVersion` (`farmplus-assessment/1.0.0 · criteria:buffalo@v2 · ai:anthropic:<model>`) only when its output was accepted.

## Traceability and audit

`ai_assessments` stores, once and immutably: the calculated `result`, the minimised `inputs` (weight readings, record counts, expense totals by category, market statistics used, settings, criteria id/version, permissions applied), engine version, criteria reference and model version. Only the review and per-suggestion dismissals change afterwards. Each assessment and review is in the audit log (actor, model version, AI outcome).

## Monitoring AI usage, cost and errors

Every provider call (and every skipped call) is a row in `ai_usage_logs`: provider, model, status (`ok`/`error`/`rejected`/`skipped`), error code, tokens, latency, computed cost, user and farm — **never prompt or output text**. `GET /admin/ai/usage` (`reports.read`; page `/admin/ai`) totals calls, error/rejection rate, tokens, p95 latency, errors by code, per-day series, today's budget use. **Cost** is computed from per-million-token rates you set (`ai.inputCostPerMillionMicros`, `ai.outputCostPerMillionMicros`, millionths of a baht); it shows "not configured" until set. **Budgets:** `ai.dailyNarrativeLimit` (platform) and `ai.perUserDailyNarratives`; beyond them the explanation is skipped (assessment still runs) and the skip is logged. `ai.narrativeEnabled` is a kill switch. Assessment requests are rate-limited.

## Access

Run an assessment: farm **members** with `animals.read` + `records.read` (not platform staff — it can cost money and writes to the farm's history); costs need `expenses.read`. Read: `animals.read` (staff with `farms.read` may read). Review/dismiss: `listings.manage` (owner/manager). Every lookup includes the farm id (other farms: 404). Criteria and market data: `animal_types.manage`. Usage: `reports.read`.

## Configuration

Env: `AI_PROVIDER` (`none`|`mock`|`anthropic`), `AI_API_KEY`, `AI_MODEL` (default `claude-sonnet-5-5`), `AI_BASE_URL`, `AI_TIMEOUT_MS`, `AI_MAX_OUTPUT_TOKENS`. Settings: `ai.narrativeEnabled`, `ai.dailyNarrativeLimit`, `ai.perUserDailyNarratives`, `ai.minMarketSamples`, `ai.marketWindowDays`, `ai.weightFreshDays`, `ai.inputCostPerMillionMicros`, `ai.outputCostPerMillionMicros`, `ai.blockedNarrativeTerms`.

## Limits

- Not validated against real outcomes: the engine is arithmetic on records; nothing here has been shown to predict readiness or prices. Treat ranges as past observations, not forecasts.
- Market data is thin by nature (few completed sales); ranges are per animal type and sex, not adjusted for age, weight, breed or region. Imported per-kg prices need a recent weight.
- No cost allocation of shared (farm-wide) costs; purchase prices are only counted if entered as an expense.
- The narrative checks are mechanical (schema, stems, numbers): they do not guarantee a sentence is wise. Starter term lists need the platform owner's review.
- No scheduled/bulk assessments; no mobile screens (web only).
