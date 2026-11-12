# CI Health Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, reporting-only CLI, `plugin/bin/ci-health.js`, that reports per-workflow run duration, trend, superseded and cancelled runs, push-run coverage and Actions budget headroom, files one issue only on a threshold breach under `--file`, and is wired into `/claude-tweaks:harness-health` Step 1 through a new sub-file.

**Architecture:** Flat sibling modules under `plugin/bin/lib/ci-health/`: `constants.js` (the one code definition of the 900 s watch plus every threshold), `stats.js` (pure statistics over a runs array), `fetch.js` (repo read and paged runs read behind an injected runner), `billing.js` (owner-type-routed billing reads, its own `{available, …}` envelope), `thresholds.js` (breach detection, issue composition, dedup-then-file over injected deps), `render.js` (the fixed report lines). The CLI resolves the repo the way `activity-gather.js` does, runs both halves independently, and renders. `_shared/pr-first-merge.md` names the constant beside its literal `900`, and a twin-pin test keeps them equal.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `gh` CLI through `repo-resolve.js`'s `ghOptions` seam, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-12T102742-spec-5160-5161-5162/spec-5161/work/5161-spec.md` (record #5161)

**Scope keywords:** `ci-health`, `MERGE_GATE_WATCH_SECONDS`, `CI_HEALTH_GH_TIMEOUT_MS`, `pinGhHost`, `PIN_WIRED`, `ci-health-check.md`, `budget_amount`, `netAmount`, `Bounded watch`

**Scope and edit discipline (quoted for every implementer):** "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."

**Task dependencies:** Task 0 first (fixtures). Tasks 1, 2 independent of each other (2 imports Task 1's `constants.js`, so 1 lands first). Task 3 needs 1. Task 4 needs 0, 1, 3 (`httpStatusOf`, `errorText`). Task 5 needs 1, 2's workflow shape, 4's billing shape. Task 6 needs 1-5. Task 7 needs 6. Longest chain: 0 → 1 → 3 → 4 → 5 → 6 → 7.

## Spec claims corrected (fact-checked against the tree at `c726c5635`)

- The exit-code scan is `tests/bin-lib/exit-code-conformance.test.js`, not `tests/exit-code-conformance.test.js` (AC11).
- `DEADLINE=$(( $(date +%s) + 900 ))` is `pr-first-merge.md` line 210, not 220; the park message `checks still pending after 15m` is line 259, not 263; the heading `**Bounded watch (…) — 15 minutes, fixed.**` is line 203 and the "(Fixed by design, not a policy key — …)" sentence line 204.
- The runs listing's `repository.default_branch` is `null` (probed live: `gh api --method GET repos/thn-inc/claude-tweaks/actions/runs -f per_page=1` → `repository.default_branch` type `null`). The superseded rule needs the default branch, so the owner read becomes one full `repos/{o}/{r}` read (no `--jq`) that yields `owner.type`, `owner.login` and `default_branch` together. An unreadable repo read leaves `defaultBranch` unknown: `superseded` and `supersededShare` are then `null`, never guessed.
- `harness-health/SKILL.md` measures 49,345 B (`wc -c`, matches the spec).

## ASSUMPTION probe result (the spec's `ASSUMPTION — verify at build:` Gotcha, run read-only at authoring)

Token scopes: `admin:org`, `repo`, `workflow`, …, no `user`. Field names and statuses only:

| Read | Status | Field names (key paths) |
|---|---|---|
| `gh api --method GET repos/thn-inc/claude-tweaks --jq .owner.type` | 200 | `owner.type` = `Organization` |
| `gh api --method GET organizations/thn-inc/settings/billing/budgets` | 200 | `budgets[].{id, budget_type, budget_product_sku, budget_scope, budget_amount, prevent_further_usage, budget_entity_name, budget_alerting.{will_alert, alert_recipients[]}}`, `has_next_page`, `total_count` |
| `gh api --method GET organizations/thn-inc/settings/billing/usage/summary` | 200 | `organization`, `timePeriod.{year, month}`, `usageItems[].{product, sku, unitType, pricePerUnit, grossQuantity, grossAmount, discountQuantity, discountAmount, netQuantity, netAmount}` |
| `gh api --method GET users/{login}/settings/billing/usage` | 404, stderr `This API operation needs the "user" scope` | not readable — field names from GitHub's REST docs only (`usageItems[].{date, product, sku, quantity, unitType, pricePerUnit, grossAmount, discountAmount, netAmount, repositoryName}`). **Blocking-verification downgrade, stated:** this endpoint's body is never used for headroom (the user endpoint exposes no budget, so `headroomPct` is always `null`), only its 200/403/404/410 status, so the unverified body shape cannot change any figure. |
| `gh api --method GET repos/thn-inc/claude-tweaks/actions/runs -f "created=>=2026-11-10" -f per_page=100 -f page=1` | 200 | `total_count`, `workflow_runs[].{id, name, path, workflow_id, event, status, conclusion, created_at, run_started_at, updated_at, run_attempt, head_sha, head_branch, head_repository.full_name, …}`; 100 rows; events seen `pull_request, push, release, schedule, workflow_dispatch`; conclusions seen `null, cancelled, failure, skipped, success` |

**Corrected facts the plan builds on:**

- An Actions budget is a `budgets[]` entry whose `budget_product_sku` lower-cases to `actions` and whose `budget_scope` is `organization`. Its amount is `budget_amount` (a number). SKU-level budgets (`budget_product_sku` such as `actions_linux`) and repository- or cost-center-scoped budgets are not Actions budgets for this check (spend is compared at org level only).
- Actions spend is the sum of `netAmount` over `usageItems[]` whose `product` lower-cases to `actions` (the summary's product is `Actions`, capitalised; the budget's SKU is `actions`, lower-case). `netAmount` (after discounts) is what a budget counts.
- A field the formula needs that is absent or not a finite number (`budgets`, `budget_amount`, `usageItems`, `netAmount`) yields `headroomPct: null` with a one-line `reason`, never a guess.
- `has_next_page: true` on budgets: headroom is computed over the listed page and the report line appends ` (first page of budgets only)`.
- The legacy `orgs/{org}/settings/billing/actions` (410) is never called.

## Byte budgets (measured, not estimated)

- `plugin/skills/harness-health/SKILL.md`: 49,345 B now (`wc -c`). Task 7 adds 393 B (two inserts below, measured with `wc -c` on the verbatim text) → 49,738 B of `RAIL_BYTES` 52,500 B (`node -p "require('./plugin/bin/lib/skill-audit/budgets.js').RAIL_BYTES"` → `52500`): 2,762 B headroom.
- Composed `merge` bundle (`_shared/pr-first-merge.md` + `_shared/pr-checklist-refresh.md`): measured by `node plugin/bin/context-cost-report.js --plugin-root plugin` (the `rail:` suite in `tests/bin-lib/skill-audit/context-cost.test.js` gates it through `rail.js`'s `composedRailViolations`). Now `max` 52,120 B (the `unresolved` combination; `pr-first`+`gh` 51,440 B) at all four merge sites. Task 1 adds exactly 73 B (`wc -c` of the inserted text) → 52,193 B, 307 B headroom. No trim needed; `pr-first-merge.md` goes 37,474 → 37,547 B.

## Global Constraints

- `MERGE_GATE_WATCH_SECONDS = 900` is the one code definition of the watch bound; the gate's shell keeps the literal `900`; the watch value never changes.
- Runs read: `repos/{o}/{r}/actions/runs`, `--method GET`, `created=>={date}` (default window 30 days, `--days N`), `per_page=100`, paged to a cap of 10 pages (1,000 runs); each call an explicit 15 s timeout. Hitting the cap sets `truncated: true` and renders exactly `window truncated at 1000 runs: statistics cover the newest runs only`; a truncated window never files.
- Percentiles: nearest-rank over `updated_at` minus `run_started_at`, completed runs only. Weekly buckets: consecutive 7-day windows anchored at the window start (UTC, by `created_at`); trailing partial bucket out of the trend, in whole-window figures. `trend` = last full bucket p50 / first full bucket p50: `rising` at ≥ 1.25, `falling` at ≤ 0.8, else `flat`; fewer than two full buckets or fewer than 5 completed runs in either → the literal `insufficient`.
- Superseded: per workflow, among runs on non-default branches keyed by `head_repository.full_name` + `head_branch`, a run whose `head_sha` is not the head of the newest run (by `created_at`) for that key, whatever its conclusion; denominator = that workflow's non-default-branch runs. Default-branch runs are never superseded. Stated in `stats.js`'s header comment.
- Push flag: a workflow's distinct `head_sha` among its `event: push` runs ÷ distinct push `head_sha` across every workflow; flagged at ≥ 0.9 with ≥ 10 distinct push `head_sha` in the window; below the floor or with zero push runs the rate is `null`. Informational, never files.
- Billing: `{available: false, status, reason}` for any 403, 404 or 410; never render "no budget" or "no spend" for an unreadable endpoint. Owner type unreadable → `{available: false, status: null, reason: "owner type unreadable"}`, `gh` absent included (gh absence renders from the runs half's `ghAbsent`). No Actions budget, a budget of 0, or the user endpoint → `{available: true, headroomPct: null}` and the line `no Actions budget to compare`.
- Filing only with `--file`: one issue per run, title exactly `CI health: workflow p90 duration or Actions budget headroom breaches a threshold`, labels including `by:harness-health`, `risk:low`, `size:low`, typed like every other harness-health filing (`type:task` label under `work-types: labels`, the native task Issue Type via `--type task` otherwise; `harness-health/filing.md`'s type branch); body lists breaches (workflow name and p90 seconds; headroom percentage and floor) and never an amount; states that p90 is run duration and excludes queue wait, so it is advisory evidence for the watch, not a verdict on it. Breach kinds: whole-window p90 above `MERGE_GATE_WATCH_SECONDS` for a workflow with ≥ 1 `pull_request` run and ≥ 5 completed runs; readable `headroomPct` below `--min-headroom-pct` (default 10). Dedup: exact title among open `by:harness-health` issues (`deps.openIssueTitles()`); create via `deps.createIssue({title, body, labels, type})`.
- Exit codes: 0 report written (partial allowed; a failed filing named in `failures[]`), 2 usage or every runs read failed. No 1, no 3 (no run-dir argument). "Every runs read failed" = the runs half read no page, whatever billing returns (AC7 "every page failing exits 2", per the spec's Plan Review Clarifications); stdout still carries the full report, billing line included. A runs half that read at least one page with billing `available: false` is exit 0 (partial).
- Never write an amount, plan name or organisation billing identifier into a fixture, issue body, log line or this plan.
- Commits: subject `{Verb} {what} — {detail}`, body `Refs #5161`, blank line, `Claude-Session: https://claude.ai/code/session_01UwjosHPH1h2CvkLU7eHG4x`; message written to a scratchpad file and committed with `git -C "<worktree>" commit -F <file>`; staging by explicit path.
- Tests run as focused `node --test <file>` only; no task runs `npm test` or `plugin/bin/verify.js`. The orchestrator's central run selects the repo-wide `plugin/bin` scans (`tests/gh-host-seam-conformance.test.js`, `tests/windows-hide-spawn-conformance.test.js`, `tests/bin-lib/exit-code-conformance.test.js`, `tests/path-guard-conformance.test.js`, `tests/skill-size-single-source.test.js`) and the rail suite.
- Shell: one plain command per Bash call; `git -C "<worktree>" …`; file content only through Write/Edit; never `git stash`; never push.

**Governing-skill rules, quoted verbatim.** `.claude/skills/gh-api-module-pattern/SKILL.md` and `cli-wrapper-contract.md` govern every `plugin/bin/` file here:

- "Export `defaultRunner` = `execFileSync('gh', args, ghOptions(args, { encoding: 'utf8', windowsHide: true }))` — always an argv array, never a shell string (no injection surface, no quoting bugs)."
- "**Every real spawn passes `windowsHide: true` in a form `tests/windows-hide-spawn-conformance.test.js` can see.** … A spread — `{ ...QUIET, timeout }` with the flag inside `QUIET` — satisfies neither and fails the full suite"
- "**Every `gh` spawn wraps its options in `plugin/bin/lib/repo-resolve.js`'s `ghOptions(args, …)`.**"
- "**A CLI that takes an explicit `--repo` pins that repo's host for every gh call it makes.** … `realDeps` defines `pinGhHost: (repoSpec) => pinExplicitRepoHost(repoSpec)`, `run()` calls `deps.pinGhHost(repoSpec)` once `--repo` is parsed, and the CLI joins `PIN_WIRED` in `tests/gh-host-seam-conformance.test.js`, which fails when either half goes missing or an unlisted CLI wires one."
- "Tests never touch real `gh`: fake runners branch on the `args` shape … and `throw new Error('unexpected ' + args.join(' '))` on anything unhandled — a wrong endpoint fails loudly instead of passing silently. Record values inside the runner, assert after it returns"
- "**Any `-f`/`-F` field flips `gh api`'s default method from `GET` to `POST`.** … a REST *read* that needs a query parameter passes `--method GET` explicitly … pin `--method GET` … in the asserted argv."
- "**A caller-overridable REST path has no bound-variable escape hatch.** … the interpolated `owner`/`repo` values need their own validation before they reach the path" (the `.`/`..` guard, each half its own test case).
- "**Bound every remote-contacting call on the seam** … Omitting the bound is defensible only with a stated reason" / bounds that "deliberately stay their own values and say why beside themselves".
- "**The quiet posture is owed by any call the module catches and recovers from** … It now passes `stdio: ['ignore', 'pipe', 'pipe']`, keeping stderr piped because [the catch] matches on `err.stderr`/`err.message`."
- "**A seam that writes a body widens to `runner(args, input)` and pipes it on stdin, instead of staging a temp file.**"
- "Logic lives in an exported `run(argv, deps)`; every side effect … goes through `deps` so tests inject fakes. **Every** `deps` call that can throw … is try/caught into the documented exit-code contract"
- "`require.main === module` guard sets `process.exitCode = run(...)` (never `process.exit`, which can truncate piped stdout). `--help` short-circuits before any availability probe."
- "**The inverse decision needs the same evidence: a domain outcome no caller can act on differently stays on the base code, overloaded and documented.** … Say so in the file's header comment beside the vocabulary, with the condition that would reopen it"
- "**A value-taking flag given as the last argv element reads `undefined`** … Validate the value inside `parseArgs` … and pin both the trailing bare flag and the empty-string value with their own test cases."
- "Every malformed-input class must actually reach its malformed code — `Number('') === 0` passes `Number.isInteger`, so validate positivity and pair-structure explicitly."
- "When an endpoint has no GitHub MCP equivalent, say so and name the real fallback; never invent an MCP row in `plugin/skills/_shared/github-write-transport.md`."

`.claude/skills/prose-code-twin-pin/SKILL.md` governs Task 1: "*A number the prose states* is an exported constant. … pins the prose's "10 minutes" and asserts `MERGE_GRACE_MS` and `CLOSE_WINDOW_MS` equal it." `.claude/skills/skill-prose-conformance-tests/SKILL.md` governs Tasks 1 and 7: "Pinning a skill file's size against a byte literal … Import `RAIL_BYTES` from `budgets.js` and assert against it; to pin that a stub stays a pointer, assert it carries none of the procedure's own call sites instead of capping its bytes."; "Anchoring a fence or line extraction regex on a bare `\n` … Write `\r?\n`, and add a CRLF input"; "Slicing a region between two anchors … Assert `end !== -1` before slicing". `.claude/skills/bin-source-scan-conformance/` does not apply: no task adds a source scan; Task 6 only adds a roster entry.

## Review Focus

1. A completed run whose `run_started_at` is after its `updated_at` (clock skew) must be excluded and counted in `skippedRuns`, never a negative duration — test in Task 2.
2. A workflow renamed mid-window (same `path`, two `name`s) must report as one workflow keyed by `path`, named from its newest run — test in Task 2.
3. A fork PR run whose `head_repository` is `null` (deleted fork) must not throw in the superseded key — test in Task 2.
4. `--repo` values `-evil/x`, `acme/.`, `acme/..`, `./x`, `../x` and a trailing bare `--days` must exit 2 before any `gh` call — test in Task 6.
5. A usage summary whose Actions `netAmount` is missing or a string must give `headroomPct: null` with a reason, never `NaN` — test in Task 4.

## Acceptance-criterion map

| Spec AC | Clause ids (plan-audit) | Task | Test |
|---|---|---|---|
| 1 | AC1.1 | 2 (+6 render) | `stats.test.js` "AC1.1", `cli.test.js` "AC1.1 render" |
| 2 | AC2.1 | 2 | `stats.test.js` "AC2.1" |
| 2b | AC2.2-AC2.5 | 2 | `stats.test.js` "AC2.2"…"AC2.5" |
| 3 | AC3.1-AC3.3 | 2 | `stats.test.js` "AC3.1"…"AC3.3" |
| 4 | AC4.1, AC4.2 | 4, 6 | `billing.test.js` "AC4.1", `cli.test.js` "AC4.1 render / AC4.2" |
| 5 | AC5.1 | 6 | `cli.test.js` "AC5.1" |
| 6 | AC6.1, AC6.2 | 6, 2 | `cli.test.js` "AC6.1", `stats.test.js` "AC6.2" |
| 7 | AC7.1-AC7.3 | 3, 6 | `fetch.test.js` "AC7.1/AC7.3", `cli.test.js` "AC7.1", "AC7.2", "AC7.3" |
| 7b | AC7.4-AC7.7 | 4, 5, 6 | `billing.test.js` "AC7.4", "AC7.6", "AC7.7"; `thresholds.test.js` "AC7.5", "AC7.7"; `cli.test.js` "AC7.7 render" |
| 8 | AC8.1-AC8.5 | 5, 6 | `thresholds.test.js` "AC8.1"…"AC8.5"; `cli.test.js` "AC8.1 via run", "AC8.5" |
| 9 | AC9.1, AC9.2 | 1 | `ci-health-watch-twin-pin.test.js` |
| 10 | AC10.1, AC10.2 | 7 | `tests/bin-lib/harness-health/skill-md.test.js` "AC10.1", "AC10.2" |
| 11 | AC11.1 | 6 | `node --test tests/gh-host-seam-conformance.test.js tests/bin-lib/exit-code-conformance.test.js` |

---

### Task 0: Live billing read and synthetic fixtures

**Role:** integration

**Files:**
- Create: `tests/fixtures/ci-health/org-budgets.json`, `tests/fixtures/ci-health/org-usage-summary.json`, `tests/fixtures/ci-health/user-usage.json`, `tests/fixtures/ci-health/repo-org.json`, `tests/fixtures/ci-health/repo-user.json`
- Test: `tests/bin-lib/ci-health/fixtures.test.js`

**Interfaces:**
- Produces: the five fixture files. `org-budgets.json`: `{budgets: [{id: "b-1", budget_type: "ProductPricing", budget_product_sku: "actions", budget_scope: "organization", budget_amount: 100, prevent_further_usage: true, budget_entity_name: "example-org", budget_alerting: {will_alert: false, alert_recipients: []}}, {id: "b-2", …sku "git_lfs", amount 50…}], has_next_page: false, total_count: 2}`. `org-usage-summary.json`: `{organization: "example-org", timePeriod: {year: 2026, month: 11}, usageItems: [{product: "Actions", sku: "actions_linux", unitType: "minutes", pricePerUnit: 1, grossQuantity: 70, grossAmount: 70, discountQuantity: 10, discountAmount: 10, netQuantity: 60, netAmount: 60}, {product: "Actions", sku: "actions_windows", …netAmount 35}, {product: "Packages", sku: "packages_storage", …netAmount 7}]}` (Actions spend 95 of budget 100). `user-usage.json`: `{usageItems: [{date: "2026-11-01", product: "Actions", sku: "actions_linux", quantity: 5, unitType: "minutes", pricePerUnit: 1, grossAmount: 5, discountAmount: 0, netAmount: 5, repositoryName: "example-user/widgets"}]}`. `repo-org.json`: `{full_name: "example-org/widgets", default_branch: "main", owner: {login: "example-org", type: "Organization"}}`; `repo-user.json` the same with `example-user` / `User`. All values synthetic.

- [ ] **Step 1: Write the failing test** `tests/bin-lib/ci-health/fixtures.test.js`: a `PROBED_KEYS` map per fixture (the table's key paths, `[]` for array indices) and a `keyPaths(json)` helper; one test per fixture asserting `keyPaths(fixture)` ⊆ `PROBED_KEYS[name]` and that the formula fields are present (`budgets[].budget_amount`, `budgets[].budget_product_sku`, `budgets[].budget_scope`, `usageItems[].product`, `usageItems[].netAmount`, `owner.type`, `default_branch`); one test asserting no string value in any fixture contains `thn-inc` or `thomasholknielsen`.
- [ ] **Step 2: Run it on today's tree**

Run: `node --test tests/bin-lib/ci-health/fixtures.test.js`
Expected: FAIL (`ENOENT` on the fixture files).

- [ ] **Step 3: Re-run the live keys-only reads** (read-only, field names only; never print values of amount fields), each as its own command, and confirm the key paths match the ASSUMPTION table above:
  - `gh api --method GET organizations/thn-inc/settings/billing/budgets --jq "[paths|map(if type==\"number\" then \"[]\" else . end)|join(\".\")]|unique|.[]"`
  - `gh api --method GET organizations/thn-inc/settings/billing/usage/summary --jq "[paths|map(if type==\"number\" then \"[]\" else . end)|join(\".\")]|unique|.[]"`
  Expected: the key paths in the table. A 403/404 means the token lost `admin:org`: record the status in the task report and build on the authoring-time table.
- [ ] **Step 4: Write the five fixtures** with the synthetic values in Interfaces.
- [ ] **Step 5: Run it.** Run: `node --test tests/bin-lib/ci-health/fixtures.test.js` — Expected: PASS.
- [ ] **Step 6: Commit** `tests/fixtures/ci-health/*.json` (five explicit paths) and the test: subject `Add CI health billing fixtures — synthetic values over live-probed field names`.

### Task 1: The watch constant and its twin pin

**Role:** integration

**Files:**
- Create: `plugin/bin/lib/ci-health/constants.js`
- Modify: `plugin/skills/_shared/pr-first-merge.md:204`
- Test: `tests/ci-health-watch-twin-pin.test.js`

**Interfaces:**
- Produces (`constants.js`, all exported): `MERGE_GATE_WATCH_SECONDS = 900`, `CI_HEALTH_GH_TIMEOUT_MS = 15000` (comment beside it: a 100-run page and the billing summary are not 5 s calls; github.com-only reads, so it deliberately does not follow `gh-timeout-ms`, mirroring `ACTIVITY_GH_TIMEOUT_MS`), `RUNS_PER_PAGE = 100`, `MAX_RUN_PAGES = 10`, `DEFAULT_DAYS = 30`, `MAX_DAYS = 400`, `BUCKET_DAYS = 7`, `MIN_BUCKET_RUNS = 5`, `TREND_RISING = 1.25`, `TREND_FALLING = 0.8`, `PUSH_RATE_FLAG = 0.9`, `PUSH_SAMPLE_FLOOR = 10`, `P90_BREACH_MIN_RUNS = 5`, `DEFAULT_MIN_HEADROOM_PCT = 10`, `NO_WORK_CONCLUSIONS = Object.freeze(['skipped'])` (comment beside it: a run with this conclusion did no CI work, so it counts in `runs` and `noWorkRuns` and stays out of the percentiles, the weekly buckets, `completedRuns` and both 5-run floors; the spec's Plan Review Clarifications).

- [ ] **Step 1: Write the failing test** `tests/ci-health-watch-twin-pin.test.js` (prose read live: the gate prose is the declared contract, `[IL-80]` carve-out stated in a header comment):
  - `watchSection(text)`: `start = text.indexOf('**Bounded watch (')`, `open = text.indexOf('```bash', start)`, `close = text.indexOf('\n```', open + 7)` with `\r?\n` tolerance; assert each `!== -1` before slicing.
  - `assertWatchTwin(text, seconds)`: in the section, `/DEADLINE=\$\(\( \$\(date \+%s\) \+ (\d+) \)\)/g` matches exactly once and its number equals `seconds`; the section includes `` `MERGE_GATE_WATCH_SECONDS` `` and `bin/lib/ci-health/constants.js`; the heading's `— (\d+) minutes, fixed\.\*\*` times 60 equals `seconds`; the whole file's `checks still pending after (\d+)m` times 60 equals `seconds`.
  - `test('AC9.1: constants.js exports MERGE_GATE_WATCH_SECONDS = 900 and the gate prose names it beside an equal literal', …)`: `strictEqual(MERGE_GATE_WATCH_SECONDS, 900)`; `assertWatchTwin(GATE, MERGE_GATE_WATCH_SECONDS)`; and the same over `GATE.replace(/\n/g, '\r\n')`.
  - `test('AC9.2: changing either side alone fails', …)`: `assert.throws` for `assertWatchTwin(GATE.replace('+ 900 ))', '+ 1800 ))'), MERGE_GATE_WATCH_SECONDS)`, for `assertWatchTwin(GATE, 1800)`, and for `assertWatchTwin(GATE.replace('`MERGE_GATE_WATCH_SECONDS`', '`WATCH`'), MERGE_GATE_WATCH_SECONDS)` — each through the same helper.
- [ ] **Step 2: Run it on today's tree**

Run: `node --test tests/ci-health-watch-twin-pin.test.js`
Expected: FAIL (`Cannot find module '../plugin/bin/lib/ci-health/constants'`).

- [ ] **Step 3: Create `constants.js`** with the Interfaces values and a header naming it the one code definition of the watch bound, cited by `_shared/pr-first-merge.md`.
- [ ] **Step 4: Edit `pr-first-merge.md` line 204** (one Edit; nothing else in the file changes). Replacing:

  ```text
  (Fixed by design, not a policy key — `pr-first-merge-appendix.md`'s "Rationale notes".) Poll
  ```

  with:

  ```text
  (Fixed by design, not a policy key — `pr-first-merge-appendix.md`'s "Rationale notes"; `900` is `MERGE_GATE_WATCH_SECONDS` in `bin/lib/ci-health/constants.js`.) Poll
  ```

  The inserted text is exactly 73 B (measured with `wc -c`). The heading line 203 and the `DEADLINE=` line stay byte-identical (pinned by `tests/merge-verification-gate-conformance.test.js:131-132`).
- [ ] **Step 5: Run it and the bundle measure.** Run: `node --test tests/ci-health-watch-twin-pin.test.js tests/merge-verification-gate-conformance.test.js tests/merge-watch-ready-run.test.js` — Expected: PASS. Run: `node plugin/bin/context-cost-report.js --plugin-root plugin` — Expected: every `merge` row `max` 52,193 (≤ 52,500). If a sibling merge has grown the bundle past 52,500, trim restatement inside `pr-first-merge.md` (never a sentence telling the reader what to do) and state the measured size in the task report.
- [ ] **Step 6: Commit** the three paths: subject `Single-source the merge-gate watch bound — MERGE_GATE_WATCH_SECONDS pinned to the gate prose`.

### Task 2: Run statistics

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/ci-health/stats.js`
- Test: `tests/bin-lib/ci-health/stats.test.js`

**Interfaces:**
- Consumes: Task 1's constants.
- Produces: `durationSeconds(run) -> number|null` (completed, both timestamps parse, `updated_at >= run_started_at`; else `null`); `nearestRank(sortedAsc: number[], p: number) -> number|null` (rank `ceil(p/100*n)`, 1-based); `computeStats(runs, { from: Date, days: number, defaultBranch: string|null }) -> Workflow[]`, sorted by `path`. `Workflow` = `{name, path, events: string[] (sorted distinct), runs, completedRuns, skippedRuns, noWorkRuns, p50Seconds, p90Seconds, weeklyP50Seconds: (number|null)[], trend: 'insufficient' | {ratio: number (2 dp), label: 'rising'|'falling'|'flat'}, superseded: number|null, supersededShare: number|null (2 dp), cancelled, pushRunRate: number|null (2 dp), pushesOnNearlyEveryPush: boolean}`. Grouping key is `path`; `name` from the newest run by `created_at`. `completedRuns` counts the runs that entered the percentiles. `skippedRuns` = completed runs with a missing or unparsable `run_started_at`/`updated_at` or a negative duration. `noWorkRuns` = completed runs whose `conclusion` is in `NO_WORK_CONCLUSIONS` (counted in `runs`; out of the percentiles, the weekly buckets, `completedRuns`, the trend's per-bucket `MIN_BUCKET_RUNS` floor, and therefore the p90 breach's `P90_BREACH_MIN_RUNS` floor, which Task 5 reads from `completedRuns`). `fullBuckets = floor(days / 7)`; a run's bucket is `floor((created_at - from) / 7d)`; buckets `>= fullBuckets` are the partial tail.

- [ ] **Step 1: Write the failing tests** with a `run({name, path, event, created, seconds, conclusion = 'success', status = 'completed', branch = 'main', sha, headRepo = 'o/r'})` builder (sets `run_started_at = created`, `updated_at = created + seconds`), `NOW = 2026-11-12T10:00:00Z`:
  - `AC1.1`: `ci.yml` `pull_request` runs of 600/700/800/1200/1300 s in one week → `runs` 5, `p50Seconds` 800, `p90Seconds` 1300.
  - `AC2.1`: four runs on branch `f` (default `main`) with shas sha1, sha2, sha3, sha3 created in that order, last `conclusion: 'cancelled'` → `superseded` 2, `supersededShare` 0.5, `cancelled` 1; a fifth run on `main` changes neither count.
  - `AC2.2`: `days: 21`, `from` = 2026-10-22T00:00Z, five 400 s runs in week 1, five 450 s in week 2, five 600 s in week 3 → `weeklyP50Seconds` `[400, 450, 600]`, `trend` `{ratio: 1.5, label: 'rising'}`; plus three 9,000 s runs created on 2026-11-12 (partial bucket) change the trend not at all but do change `p90Seconds`.
  - `AC2.3`: 600/500/400 → `{ratio: 0.67, label: 'falling'}`. `AC2.4`: 500/520/540 → `label: 'flat'`. `AC2.5`: `days: 10` → `'insufficient'`; `days: 21` with only 4 completed runs in week 3 → `'insufficient'`.
  - `AC3.1`/`AC3.2`/`AC3.3`: 20 distinct push shas; workflow A pushes on 19 → `pushRunRate` 0.95, flagged; workflow B on 5 → 0.25, not flagged; a fixture with 6 distinct push shas → every `pushRunRate` `null`, none flagged; a workflow with zero push runs → `null`.
  - `AC6.2`: a completed run missing `run_started_at` and one missing `updated_at` → excluded from `p50Seconds`/`p90Seconds` (assert the values equal those of the fixture without them) and `skippedRuns` 2.
  - Review Focus 1-3: a run with `run_started_at` after `updated_at` → `skippedRuns` 1; same `path` with names `CI` (older) and `Tests` (newer) → one workflow named `Tests`; a `pull_request` run with `head_repository: null` → no throw, counted in the denominator; `defaultBranch: null` → `superseded` and `supersededShare` `null`.
  - No-work runs (`NO_WORK_CONCLUSIONS`): the AC1.1 fixture plus one 5 s `conclusion: 'skipped'` run in the same week → `runs` 6, `noWorkRuns` 1, `completedRuns` 5, `p50Seconds` 800, `p90Seconds` 1300 (unchanged); the AC2.2 fixture plus three 5 s skipped runs in week 1 → `weeklyP50Seconds` still `[400, 450, 600]` and `trend` still `{ratio: 1.5, label: 'rising'}`; the AC2.2 fixture with week 3 cut to 4 working runs plus 1 skipped run → `trend` `'insufficient'` (the skipped run does not meet the per-bucket floor); a `pull_request` workflow with 4 working runs over 900 s plus 1 skipped run → `runs` 5, `completedRuns` 4 (below `P90_BREACH_MIN_RUNS`, so no p90 breach — Task 5 pins the breach side).
- [ ] **Step 2: Run it on today's tree**

Run: `node --test tests/bin-lib/ci-health/stats.test.js`
Expected: FAIL (`Cannot find module`).

- [ ] **Step 3: Implement `stats.js`** with the header comment stating the superseded rule verbatim from Global Constraints (default-branch runs never superseded).
- [ ] **Step 4: Run it.** Same command — Expected: PASS.
- [ ] **Step 5: Commit** both paths: subject `Compute CI run statistics — percentiles, weekly trend, superseded and push-run coverage`.

### Task 3: Repo and paged runs reads

**Role:** integration

**Files:**
- Create: `plugin/bin/lib/ci-health/fetch.js`
- Test: `tests/bin-lib/ci-health/fetch.test.js`

**Interfaces:**
- Consumes: `CI_HEALTH_GH_TIMEOUT_MS`, `RUNS_PER_PAGE`, `MAX_RUN_PAGES`.
- Produces: `errorText(err) -> string` (stderr, else message + stdout, trimmed, first 300 chars); `httpStatusOf(err) -> number|null` (`/HTTP (\d{3})/` over stderr then message); `isGhAbsent(err) -> boolean` (`err.code === 'ENOENT'`); `readRepo({owner, repo}, {runner}) -> {ok: true, ownerType, ownerLogin, defaultBranch} | {ok: false, status, error, ghAbsent}` with argv `['api', '--method', 'GET', \`repos/${owner}/${repo}\`]`; `fetchRuns({owner, repo, from: 'YYYY-MM-DD'}, {runner}) -> {available, runs, pages, truncated, ghAbsent, failures: [{query, status, error}]}`. Page argv exactly `['api', '--method', 'GET', \`repos/${owner}/${repo}/actions/runs\`, '-f', \`created=>=${from}\`, '-f', 'per_page=100', '-f', \`page=${n}\`]`, opts `{ timeout: CI_HEALTH_GH_TIMEOUT_MS }`. Stop after a page shorter than 100; `truncated` when page 10 holds 100; a throwing or non-array page pushes `{query: \`runs page ${n}\`, status, error}` and stops; `available` = page 1 succeeded; on `isGhAbsent` stop with `ghAbsent: true`. Paths start with a literal `repos/`, so no value can read as a flag (owner/repo are validated by the CLI in Task 6).

- [ ] **Step 1: Write the failing tests** with a recording fake runner (record argv inside, assert after):
  - argv of page 1 deep-equals the exact array above for `from` `2026-10-13` (pins `--method GET`) and carries `{timeout: 15000}`.
  - `AC7.1`: page 1 returns 100 runs, page 2 throws `HTTP 503` → `runs.length` 100, `available` true, `failures` `[{query: 'runs page 2', status: 503, …}]`, no page 3 call.
  - `AC7.3`: ten pages of 100 → `truncated` true, exactly 10 calls; a 40-run page 3 → 3 calls, `truncated` false.
  - page 1 throwing `HTTP 401`, `HTTP 403` and a `API rate limit exceeded … (HTTP 429)` → `available` false, `failures[0].status` 401 / 403 / 429.
  - ENOENT on page 1 → `ghAbsent` true, `available` false.
  - `readRepo` maps `tests/fixtures/ci-health/repo-org.json` to `{ok: true, ownerType: 'Organization', ownerLogin: 'example-org', defaultBranch: 'main'}`; a throw maps to `{ok: false, status, …}`.
- [ ] **Step 2: Run it on today's tree**

Run: `node --test tests/bin-lib/ci-health/fetch.test.js`
Expected: FAIL (`Cannot find module`).

- [ ] **Step 3: Implement `fetch.js`.**
- [ ] **Step 4: Run it.** Same command — Expected: PASS.
- [ ] **Step 5: Commit** both paths: subject `Read workflow runs page by page — 1,000-run cap, per-page failures, gh-absent signal`.

### Task 4: Billing reads

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/ci-health/billing.js`
- Test: `tests/bin-lib/ci-health/billing.test.js`

**Interfaces:**
- Consumes: Task 3's `errorText`, `httpStatusOf`, `isGhAbsent`; Task 0's fixtures; `CI_HEALTH_GH_TIMEOUT_MS`.
- Produces: `headroomFrom(budgetsJson, summaryJson) -> {headroomPct: number|null, reason: string|null, firstPageOnly: boolean}` (pure; Actions budget and spend per the corrected facts; minimum across Actions budgets with `budget_amount > 0`; `null` + `reason` `'no Actions budget to compare'` when none, or a reason naming the missing field); `readBilling({repoRead}, {runner}) -> {billing, failures}`. `billing` is `{available: true, scope: 'org'|'user', headroomPct, reason?, firstPageOnly?}` or `{available: false, status, reason}`. Routing: `repoRead.ok === false` → `{available: false, status: null, reason: 'owner type unreadable'}` with no call, whatever `repoRead.ghAbsent` says (the spec's string; gh absence reaches the render through the runs half's `ghAbsent`, Task 6); `Organization` → `organizations/${login}/settings/billing/budgets` then `…/usage/summary` (stop at the first failure); `User` → `users/${login}/settings/billing/usage`, 200 → `{available: true, scope: 'user', headroomPct: null, reason: 'no Actions budget to compare'}`. Every argv is `['api', '--method', 'GET', path]` with `{timeout}`. A failed read → `{available: false, status: httpStatusOf(err), reason}` (`reason` `'HTTP {status}'` for 403/404/410, else `errorText`), plus a `failures` entry `{query: 'billing budgets'|'billing usage summary'|'billing usage', status, error}`.

- [ ] **Step 1: Write the failing tests:**
  - `AC4.1` ×3: the org budgets read throwing `gh: Not Found (HTTP 404)`, `… (HTTP 403)`, `… (HTTP 410)` → `billing` deep-equals `{available: false, status: 404|403|410, reason: 'HTTP 404'|…}`.
  - `AC7.4`: fixtures as written → `headroomPct` 5.
  - `AC7.6`: budgets with Actions `budget_amount` 100 and 1000 → 5 (the smaller).
  - `AC7.7`: no Actions budget (only `git_lfs`), an Actions budget of 0, and the user route with `user-usage.json` → `headroomPct: null`, `reason: 'no Actions budget to compare'`, `available: true`.
  - an Actions `budget_scope: 'repository'` budget and an `actions_linux` SKU budget are ignored → `null`; `has_next_page: true` → `firstPageOnly: true`.
  - Review Focus 5: `netAmount` missing, and `netAmount: "95"` → `headroomPct: null`, `reason` naming `netAmount`.
  - `repoRead: {ok: false, ghAbsent: false}` and `repoRead: {ok: false, ghAbsent: true}` → each `billing` deep-equals `{available: false, status: null, reason: 'owner type unreadable'}` (no `'gh absent'` reason), zero runner calls.
- [ ] **Step 2: Run it on today's tree**

Run: `node --test tests/bin-lib/ci-health/billing.test.js`
Expected: FAIL (`Cannot find module`).

- [ ] **Step 3: Implement `billing.js`.** Header comment: never logs or returns an amount, only the percentage; the legacy `orgs/{org}/settings/billing/actions` (410) is never called.
- [ ] **Step 4: Run it.** Same command — Expected: PASS.
- [ ] **Step 5: Commit** both paths: subject `Read Actions budget headroom — org budgets and usage summary, unavailable states as data`.

### Task 5: Breaches and filing

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/ci-health/thresholds.js`
- Test: `tests/bin-lib/ci-health/thresholds.test.js`

**Interfaces:**
- Consumes: `Workflow` (Task 2), `billing` (Task 4), constants; `recordPayload`, `specShapedBody` from `plugin/bin/lib/issues/record.js`.
- Produces: `BREACH_TITLE` (exact spec title); `breachesOf({workflows, billing}, {minHeadroomPct, watchSeconds}) -> [{kind: 'p90-over-watch', workflow, p90Seconds} | {kind: 'headroom-below-floor', headroomPct, floor}]` (p90 eligible only when `events` includes `pull_request` and `completedRuns >= P90_BREACH_MIN_RUNS`); `composeBreachIssue(breaches, {repo, days, watchSeconds, minHeadroomPct, workTypes}) -> {title, body, labels, type}` via `specShapedBody({header, currentState: one line per breach, deliverables, acceptanceCriteria, releaseNote: 'No user-visible change — CI health evidence.', filedBy: '/claude-tweaks:harness-health'})` and `recordPayload({title, body, type: 'task', origin: 'harness-health', risk: 'low', size: 'low', ready: false, fingerprint: 'ci-health-threshold-breach'})` (`ready: false`: the record asks for a human decision about the watch or the workflow, so it is not born-ready; `recordPayload`'s labels come out `['by:harness-health', 'risk:low', 'size:low']`). Type expression, the `harness-health/filing.md` "Type expression branch" (the spec's Plan Review Clarifications): `workTypes` is the project's `work-types` value, passed in by Task 6 (`thresholds.js` never reads config, so a test passes the string); `'labels'` → append `'type:task'` to `labels` and return `type: null`; any other value (`'native'`, or `null` when the key is unset) → `labels` unchanged and `type: 'task'`, which Task 6's `createIssue` turns into `--type task` (the native Issue Type). Body states: "p90 is run duration and excludes queue wait — advisory evidence for the merge gate's {watchSeconds} s watch, not a verdict on it", and never an amount. `fileBreaches({breaches, truncated, file}, {openIssueTitles, createIssue}, composeArgs) -> {filed: {title, number}|null, skipped: 'no --file'|'no breach'|'window truncated'|'open issue exists'|null, failure: {query, error}|null}`; order: no `--file` → skipped; no breach; truncated; `openIssueTitles()` throw → failure `{query: 'open issue titles'}`, nothing filed; title present → skipped; `createIssue` throw → failure `{query: 'file issue'}`.

- [ ] **Step 1: Write the failing tests** (fakes record calls, assert after):
  - `AC8.1`: one `pull_request` workflow `ci.yml` with p90 1300 over 5 completed runs, `file: true`, `openIssueTitles: () => []`, `workTypes: 'native'` → `createIssue` called once with `title === BREACH_TITLE`, `labels` including each of `by:harness-health`, `risk:low`, `size:low` (an includes check per label, not a deep-equal of the list), no `type:*` label, `type === 'task'`, body includes `ci.yml` and `1300`, body `doesNotMatch(/[$€£]\s?\d|\bUSD\b/)`. Same fixture with `workTypes: 'labels'` → `labels` includes the three plus `type:task`, `type === null`; with `workTypes: null` → the native shape (`type === 'task'`, no `type:*` label).
  - `AC8.2`: p90 breach plus `billing {available: true, headroomPct: 5}` at floor 10 → one call, body includes `ci.yml` and `5%` and `10%`.
  - `AC8.3`: `openIssueTitles` returning `[BREACH_TITLE]` → zero calls, `skipped: 'open issue exists'`. (Closed issues never reach this list: the real dep reads `--state open`, pinned in Task 6.)
  - `AC8.4`: a slow workflow whose `events` is `['push']`, one `['schedule']`, every p90 ≤ 900, and `billing {available: false, status: 404}` → `breachesOf` `[]`, zero calls.
  - `AC8.5`: a breach with `file: false` → zero calls, `skipped: 'no --file'`.
  - `AC7.5`: `headroomPct` 5 → breach at `minHeadroomPct` 10, none at 3. `AC7.7`: `headroomPct: null` → no breach.
  - a p90-breach workflow with 4 completed runs → no breach; the same with `runs: 5, noWorkRuns: 1, completedRuns: 4` (a skipped run does not lift it to the floor) → no breach; `truncated: true` with a breach → zero calls, `skipped: 'window truncated'`; `createIssue` throwing → `failure.query` `'file issue'`.
- [ ] **Step 2: Run it on today's tree**

Run: `node --test tests/bin-lib/ci-health/thresholds.test.js`
Expected: FAIL (`Cannot find module`).

- [ ] **Step 3: Implement `thresholds.js`.**
- [ ] **Step 4: Run it.** Same command — Expected: PASS.
- [ ] **Step 5: Commit** both paths: subject `Detect CI health breaches and file one deduplicated issue — title-exact, open-only`.

### Task 6: The CLI, the report render, and the seam roster

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/ci-health.js`, `plugin/bin/lib/ci-health/render.js`
- Modify: `tests/gh-host-seam-conformance.test.js:303-304` (add `'ci-health.js'` to `PIN_WIRED`)
- Modify: `docs/plugin-structure.md:72` (add a `plugin/bin/lib/ci-health/` line after the `lib/activity/` line) and after line 156 (the CLI command line)
- Test: `tests/bin-lib/ci-health/cli.test.js`

**Interfaces:**
- Consumes: Tasks 1-5; `ghAvailable` is not used (gh absence arrives as ENOENT from the runner); `remoteUrl`, `originSpecOf`, `repoSlug`, `ghOptions`, `pinExplicitRepoHost` from `./lib/repo-resolve`; `readWorkTypes` from `./lib/work-backend` (the one CLAUDE.md `work-types:` reader; never throws, `null` when the key is absent).
- Produces: `run(argv, deps) -> 0|2`, `parseArgs`, `realDeps`, `USAGE`. `renderReport(report) -> string[]` in `render.js`. Usage: `ci-health.js [--days N] [--repo owner/name] [--min-headroom-pct N] [--file] [--json] [--help]`. `deps` = `{runner, remoteUrl, pinGhHost, workTypes(), openIssueTitles(slug), createIssue(slug, {title, body, labels, type}), now, stdout, stderr}`. `realDeps.workTypes = () => readWorkTypes(process.cwd())` (the checkout the CLI runs in, as `reflect-apply.js:121` does); `run` calls `deps.workTypes()` once, only when `--file` is set, and passes the value as Task 5's `composeArgs.workTypes`, so a test injects `workTypes: () => 'labels'` / `() => 'native'` / `() => null` and needs no real CLAUDE.md. `realDeps.runner = (args, opts = {}) => execFileSync('gh', args, ghOptions(args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: CI_HEALTH_GH_TIMEOUT_MS, input: opts.input, windowsHide: true }))`; `openIssueTitles` runs `['issue', 'list', '--repo', slug, '--label', 'by:harness-health', '--state', 'open', '--json', 'title', '--limit', '500']`; `createIssue` runs `['issue', 'create', '--repo', slug, '--title', title, '--body-file', '-', ...labels.flatMap((l) => ['--label', l]), ...(type ? ['--type', type] : [])]` with `{input: body}` (one `--label` per entry, so the labels branch's `type:task` rides along; `--type task` only on the native branch, matching `harness-health/filing.md`'s two example calls) and returns the number parsed from `/\/issues\/(\d+)/`. `run` binds the slug when calling Task 5's `fileBreaches`: `{openIssueTitles: () => deps.openIssueTitles(slug), createIssue: (issue) => deps.createIssue(slug, issue)}`. Report envelope (`--json` prints it, one line): `{repo, window: {days, from}, truncated, ghAbsent, workflows, watchSeconds, billing, failures, breaches, filed}`, where `workflows` is Task 2's `Workflow[]` with every field (`skippedRuns` and `noWorkRuns` included) and `ghAbsent` is `fetchRuns`'s `ghAbsent`.
- Exit vocabulary in the header comment: 0 report written (partial allowed: a runs half that read at least one page, whatever billing returns; a failed filing in `failures[]`); 2 malformed invocation, an unresolvable or non-github.com origin, or every runs read failed (the runs half read no page), whatever billing returns. On that read-failure exit 2 the full report still goes to stdout (billing line included), so nothing read is lost; a usage or origin error writes one line to stderr and nothing to stdout. State the overload decision: the harness-health sub-file tells a read failure from a usage error by whether stdout carries report lines, so no third code is earned; reopen when a caller must branch on the code itself.
- Arg rules: `--days` integer 1..400 (default 30); `--min-headroom-pct` number 0..100 (default 10); `--repo` must match `/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/` and neither segment may be `.` or `..`; a value-taking flag with a missing, empty or `--`-leading value is usage. With `--repo`, call `deps.pinGhHost({host: 'github.com'})`; without it, resolve origin through `originSpecOf(deps.remoteUrl())`, requiring host `github.com` (activity-gather.js's shape). `from` = UTC date of `now` minus `days` days.
- Render lines (exact): header `ci health: {repo}, last {days} days (from {from})`; `window truncated at 1000 runs: statistics cover the newest runs only`; `runs unavailable ({reason})` where reason is `gh absent` or the first failure's `HTTP {status}`/error; `no workflow runs in the last {days} days` only when runs are available and `workflows` is empty; per workflow `{name} ({path}): {runs} runs, p50 {p50}s, p90 {p90}s[ — over the {watch}s merge-gate watch], trend {label} {ratio}|insufficient, superseded {n} ({share})|n/a, cancelled {n}[, skipped {skippedRuns}][, no-work {noWorkRuns}][, runs on {pct}% of pushes (informational; a repo's only push workflow always reads 100%)]` (each bracketed count only when non-zero); billing `billing unavailable (gh absent)` when the envelope's `ghAbsent` is true, else `billing unavailable ({status ?? reason})`, `billing: Actions budget headroom {h}% (floor {floor}%)[ (first page of budgets only)]`, or `billing: no Actions budget to compare`; `breach: …` per breach; `filed #{n}: {title}`, `not filed: {skipped}` when `--file` and breaches exist; `failed read: {query}: {error}` per failure.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/ci-health/cli.test.js` (a `deps()` builder like `tests/bin-lib/activity/gather-cli.test.js`'s; a fake runner branching on `args[3]` paths and throwing `unexpected …` otherwise; `NOW = 2026-11-12T10:00:00Z`):
  - `--help` exits 0 before any runner call.
  - usage exit 2 with zero runner calls: `--days 0`, `--days abc`, trailing bare `--days`, `--days ''`, `--min-headroom-pct 101`, `--bogus`, and Review Focus 4's `--repo` values `-evil/x`, `acme/.`, `acme/..`, `./x`, `../x`; a non-github.com origin exits 2.
  - `AC1.1 render`: the AC1 fixture renders `ci.yml (.github/workflows/ci.yml): 5 runs, p50 800s, p90 1300s — over the 900s merge-gate watch`.
  - `AC4.1 render` / `AC4.2`: billing 404/403/410 each render exactly `billing unavailable (404)` etc.; across those runs no stdout line matches `/no (Actions )?budget|no spend/i`.
  - `AC5.1`: runner throwing `Object.assign(new Error('spawn gh ENOENT'), {code: 'ENOENT'})` → exit 2; `--json` envelope has `ghAbsent === true`, `billing` deep-equal `{available: false, status: null, reason: 'owner type unreadable'}`, runs `failures`/`workflows: []`; stdout includes `runs unavailable (gh absent)` and `billing unavailable (gh absent)` and no line matches `/no workflow runs|no Actions budget|headroom \d/`.
  - `AC6.1`: runs page `[]` with `--file` → exit 0, `workflows: []`, line `no workflow runs in the last 30 days`, `createIssue` never called.
  - `AC7.1`: page 2 throws → exit 0, workflows from page 1, `failures[0].query === 'runs page 2'`. `AC7.2`: every call throws `HTTP 500` → exit 2. Also: every runs page throws `HTTP 500` while the repo read and both org billing reads answer with the Task 0 fixtures → exit 2 (every runs read failed, whatever billing returns), and stdout still carries the full report: the header, `runs unavailable (HTTP 500)` and `billing: Actions budget headroom 5% (floor 10%)`. Partial: runs page 1 answers (fewer than 100 runs) while the org budgets read throws `HTTP 404` → exit 0, `billing unavailable (404)` on stdout.
  - `AC7.3`: ten full pages with a `pull_request` p90 over 900, `--file` → `truncated: true`, the truncation line, `createIssue` never called.
  - `AC7.7 render`: user-owned repo fixture → `billing: no Actions budget to compare`.
  - `AC1.1 render` with no-work runs: the AC1 fixture plus one 5 s `conclusion: 'skipped'` run → the `ci.yml` line starts `ci.yml (.github/workflows/ci.yml): 6 runs, p50 800s, p90 1300s` and includes `, no-work 1`; the envelope's `ci.yml` workflow has `noWorkRuns: 1`.
  - `AC8.1 via run`: `--file` with a breach and `workTypes: () => 'labels'` → `createIssue` called once with the slug, `BREACH_TITLE`, and `labels` including `by:harness-health`, `risk:low`, `size:low` and `type:task`; with `workTypes: () => 'native'` → `labels` including the three, no `type:*` label, `type === 'task'`; `AC8.5`: same fixture without `--file` → zero calls, and `workTypes` never called.
  - `realDeps` argv pins (call the real `openIssueTitles`/`createIssue` builders with an injected runner seam, or export `issueListArgs(slug)`/`issueCreateArgs(slug, {title, labels, type})` and deep-equal them): `--state open` and `--body-file -` present; `issueCreateArgs` with `labels` `['by:harness-health', 'risk:low', 'size:low']`, `type: 'task'` ends `--label by:harness-health --label risk:low --label size:low --type task`; with `labels` plus `type:task`, `type: null` ends `--label size:low --label type:task` and carries no `--type`.
- [ ] **Step 2: Run it on today's tree**

Run: `node --test tests/bin-lib/ci-health/cli.test.js`
Expected: FAIL (`Cannot find module`).

- [ ] **Step 3: Implement `render.js` and `ci-health.js`**; add `'ci-health.js'` to `PIN_WIRED`; add the two `docs/plugin-structure.md` lines in the neighbouring entries' shape (module line naming `constants.js`/`stats.js`/`fetch.js`/`billing.js`/`thresholds.js`/`render.js`, consumed by `harness-health/ci-health-check.md`; command line with the usage, the 15 s bound, the exit vocabulary and the test paths).
- [ ] **Step 4: Run it and the seam scans.** Run: `node --test tests/bin-lib/ci-health/cli.test.js tests/gh-host-seam-conformance.test.js tests/bin-lib/exit-code-conformance.test.js tests/windows-hide-spawn-conformance.test.js` — Expected: PASS (AC11.1).
- [ ] **Step 5: Real-input probe** (no commit of output). From the worktree, run `node plugin/bin/ci-health.js --days 7 --json` and, independently, `gh api --method GET repos/thn-inc/claude-tweaks/actions/runs -f "created=>={from}" -f per_page=1 --jq .total_count` with `{from}` copied from the envelope's `window.from`. Expected: the sum of `workflows[].runs` equals `total_count` when `truncated` is false, and `truncated` is true when `total_count` > 1000; `billing.available` true (the token holds `admin:org`). Report the two counts, `truncated`, `billing.available` and `failures.length` in the task report — never the headroom value or any amount. A mismatch is a defect to fix in this task.
- [ ] **Step 6: Commit** the four paths plus the test: subject `Add the ci-health CLI — runs and billing halves, fixed report lines, threshold filing under --file`.

### Task 7: Harness-health wiring

**Role:** integration

**Files:**
- Create: `plugin/skills/harness-health/ci-health-check.md`
- Modify: `plugin/skills/harness-health/SKILL.md:10` (scope sentence) and after line 122 (pointer paragraph)
- Modify: `docs/plugin-structure.md:130` (append `ci-health-check.md` to the harness-health sub-file row)
- Test: `tests/bin-lib/harness-health/skill-md.test.js`
- Waived _shared/github-write-transport.md: read by Step 3 to cite its CRUD-only MCP coverage; not modified.

**Interfaces:**
- Consumes: Task 6's CLI, flags, exit codes and render lines.

- [ ] **Step 1: Write the failing tests** appended to `tests/bin-lib/harness-health/skill-md.test.js` (import `RAIL_BYTES` from `plugin/bin/lib/skill-audit/budgets.js`; never a byte literal):
  - `AC10.1`: `Buffer.byteLength(read(), 'utf8') <= RAIL_BYTES`; the body includes `` `ci-health-check.md` ``; the text before `\n## When to Use` matches `/CI run health/`.
  - `AC10.2`: SKILL.md does not include `${CLAUDE_PLUGIN_ROOT}/bin/ci-health.js`; `ci-health-check.md` includes `node "${CLAUDE_PLUGIN_ROOT}/bin/ci-health.js" --file`, `--dry-run`, `github-write-transport.md`, and `_shared/label-bootstrap.md`.
- [ ] **Step 2: Run it on today's tree**

Run: `node --test tests/bin-lib/harness-health/skill-md.test.js`
Expected: FAIL (the two new tests: no `ci-health-check.md` pointer or file yet).

- [ ] **Step 3: Write `ci-health-check.md`** (house heading style of the skill's other sub-files) carrying: runs every firing; skipped under `--dry-run` with the Step 8 line `ci health: skipped (--dry-run never calls gh)`; the invocation fence `node "${CLAUDE_PLUGIN_ROOT}/bin/ci-health.js" --file` (add `--repo {owner}/{name}`, read from that checkout's origin, when `--root` names another checkout); exit 0 → copy every stdout line into Step 8's SUMMARIZE report under a `ci health:` lead; exit 2 with any stdout lines (every runs read failed: the report still names what was unavailable, billing line included) → copy every stdout line under the same `ci health:` lead, exactly as for exit 0; exit 2 with empty stdout (a usage or origin error) → report `ci health: failed ({first stderr line})`; a `failed read: file issue` line naming a missing label → bootstrap `by:harness-health`, `risk:low`, `size:low` (and `type:task` under `work-types: labels`) per `_shared/label-bootstrap.md` and re-run once with `--file`; `gh` absent (a cloud Routine sandbox) reports both halves unavailable and is never a clean result — `_shared/github-write-transport.md`'s MCP path covers record CRUD, not workflow-run or billing reads, so there is no fallback read; the check reports and files only, never edits a workflow, and never changes the merge gate's 15-minute watch whatever p90 it measures.
- [ ] **Step 4: Edit SKILL.md.** After line 10's `Never edits code — only harness documentation.` insert ` It also reports CI run health (workflow run duration, superseded runs, Actions budget headroom) through one deterministic check, `` `ci-health-check.md` ``.` After the Skill-load check paragraph (line 122) insert a blank line and `**CI run health check (#5161, runs every firing).** Read `` `ci-health-check.md` `` in this skill's directory and apply it: it runs `` `bin/ci-health.js` ``, files only on a threshold breach, and gives Step 8's SUMMARIZE report its `` `ci health:` `` lines.` Then add `ci-health-check.md` to `docs/plugin-structure.md:130`'s harness-health row.
- [ ] **Step 5: Run it and measure.** Run: `node --test tests/bin-lib/harness-health/skill-md.test.js tests/bin-lib/skill-audit/context-cost.test.js` — Expected: PASS. Run: `wc -c "plugin/skills/harness-health/SKILL.md"` — Expected: 49,738 (±2 for whitespace); report the measured value.
- [ ] **Step 6: Commit** the four paths: subject `Wire the CI health check into harness-health — sub-file procedure, Step 1 pointer, widened scope`.
