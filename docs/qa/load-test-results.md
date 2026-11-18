# Load and performance test

## Method

`pnpm load` (`e2e/load/load-test.mjs`) starts a throw-away stack — in-memory MongoDB and the API from source (`tsx`), development mode, rate limiting off, mock providers — then **seeds through the public API** (1 farm, 3,000 animals,
400 active listings, a buyer and a conversation) and drives each scenario with autocannon for 8 s (`LOAD_DURATION`) at the stated concurrency. It fails (exit 1) on any connection error, timeout, unexpected HTTP status, or error log line from the API, and checks that `/ready` is still 200 afterwards.
Results are written to `e2e/load/results/latest.json`.

**Environment of the recorded run (13 Oct 2026):** Apple M1, 8 CPU cores, 8 GB RAM, Node 26.5; the load generator, the API and MongoDB all on the same machine.

## Results

| Scenario                                                                | Conns |  req/s | p50 ms | p97.5 ms | p99 ms | max ms | Statuses                   |
| ----------------------------------------------------------------------- | ----: | -----: | -----: | -------: | -----: | -----: | -------------------------- |
| `GET /health` (framework baseline)                                      |    50 | 30,966 |      1 |        2 |      3 |     23 | 200 × 247,710              |
| `GET /ready` (database ping)                                            |    50 | 13,808 |      3 |        5 |      5 |     16 | 200 × 110,457              |
| `POST /auth/login` (password hashing)                                   |    10 |     50 |    193 |      299 |    311 |    326 | 200 × 400                  |
| `GET /notifications/unread-count` (authenticated, 2 queries)            |    50 |  1,519 |     31 |       41 |     47 |    135 | 200 × 12,150               |
| `GET /farms/:id/animals?pageSize=20` (farm of 3,000)                    |    40 |    486 |     80 |      117 |    131 |    183 | 200 × 3,885                |
| `GET /marketplace/listings?q=…` (400 listings)                          |    40 |    408 |     95 |      116 |    124 |    321 | 200 × 3,265                |
| `GET /farms/:id/dashboard` (cached 60 s)                                |    20 |  1,052 |     18 |       24 |     28 |    118 | 200 × 8,414                |
| `GET /farms/:id/dashboard?fresh=true` (aggregations every time)         |    10 |    214 |     45 |       63 |     66 |     83 | 200 × 1,710                |
| `POST /conversations/:id/messages` (write + notification + unread push) |    20 |    895 |     20 |       34 |     57 |    126 | 201 × 123, **429 × 7,033** |

**No errors, no timeouts, no 5xx, no error-level log lines; the API was still ready afterwards.** The 429s are the designed per-user chat limit (120/minute) doing its job under a flood.

## What the numbers say

- **Authentication is the dominant cost of an ordinary request.** Each authenticated call verifies the token and loads the session, the user and the roles/permissions (4 small queries) so that revocation takes effect immediately (a deliberate choice, tested in `qa/security-dynamic`): ~1,500 req/s for a trivial endpoint versus 31,000 for an unauthenticated one. If throughput ever becomes the constraint, a very short (seconds) per-session permission cache is the lever — at the price of delaying revocation by that many seconds; do not do it without a security decision.
- **Password hashing is slow on purpose** (~50 sign-ins/s on this machine at 10 concurrent): sign-in floods are limited by CPU, which is why sign-in is rate limited per client (10 per 15 minutes) and accounts lock after repeated failures.
- **The dashboard cache matters 5×** (1,052 vs 214 req/s) — the justification recorded in Part 16.
- Page reads at tens of ms and ~400–500 req/s on a single Node process with a co-located in-memory database; list/search latency is dominated by DTO assembly and the authentication cost, not scans (see the query-plan audit: no hot query scans a collection).
- The webhook-lookup defect found by the query-plan audit (F2) would not show in this run's data volume; it grows with payment history.

## Limits of this test (read before quoting a number)

- In-memory MongoDB on the same host: **no network latency, no replication, no disk**. These are _relative_ costs and a regression baseline, **not production capacity**.
- 8-second runs of one scenario at a time: no mixed-workload soak, no memory-growth observation over hours, no autoscaling or multi-instance behaviour (Socket.IO needs a Redis adapter first).
- Realtime fan-out (thousands of sockets) was not load tested; the realtime correctness suite covers behaviour, not scale.
- Seeded volume is modest (3,000 animals, 400 listings). Repeat with `LOAD_ANIMALS=50000 LOAD_LISTINGS=5000` and against **staging** (real Atlas, real network) before sizing production.

## Suggested release gates once staging exists

Zero 5xx and zero timeouts at 2× expected peak for 30 minutes; p99 < 1 s for read endpoints and < 2 s for writes at expected peak; sign-in p99 < 1 s at expected sign-in rate; Atlas CPU < 60 % and connections < 50 % of the limit at peak.
