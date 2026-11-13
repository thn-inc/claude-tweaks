# Trust Verdict Window Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the trust verdict's `clean` reachable: grade each class over a lookback window and replace zero-tolerance follow-ups with a rate threshold, so machine grants can originate again (record #5291, maintainer decision "Bridge", 2026-11-13).

**Architecture:** All verdict logic stays in the pure `plugin/bin/lib/issues/trust.js`. Two new policy keys feed it. Rows gain the fields readers need (`followUpRecords`, `followUpRate`, `mixedReasons`, window/threshold echo, `oldestClosedAt`), so gate 2 and the backlog overview explain a refusal without re-reading policy. Every `trustRows` caller builds its policy from one exported `TRUST_POLICY_KEYS` list, pinned by a conformance test.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-13T034409-spec-5291/work/5291-spec.md` (worktree copy)

Scope keywords: trustRows, trust-revert-window-days, followUps, machineGrantOutlook, no time window

## Global Constraints

- New policy key `trust-evaluation-window-days`: integer, min 1, default 30.
- New policy key `trust-follow-up-rate-max-percent`: integer, min 0, max 100, default 30. `0` restores zero tolerance.
- `followUpRate` = `followUpRecords / total`, where `followUpRecords` = distinct in-window records with at least one corrective follow-up. `followUps` (count) stays on the row for display.
- `clean` requires `changesRequested === 0 && negativeEvidence === 0 && !batchOnly && followUpRecords * 100 <= followUpRateMaxPercent * total` (integer compare, no float), plus the unchanged `MIN_SAMPLES`/`MIN_VERDICTS`/ungradable-kind floors.
- `mixedReasons` order is fixed: `['changes-requested', 'follow-up-rate', 'negative-evidence', 'batch-only']` filtered to those that fail; `[]` unless `verdict === 'mixed'`.
- Window membership: a closed record with a parseable `closedAt` is in-window iff `now - closedAtMs <= windowDays * MS_PER_DAY` (inclusive; a future `closedAt` is in-window). A closed record with no parseable `closedAt` is out of window (decided by the user at plan review, 2026-11-13) — every live caller reads the session record snapshot, whose `UNION_FIELDS` include `closedAt`, so only hand-built fixtures lack one. A closed record outside the window forms no cell but is still scanned as a follow-up source, like an open record.
- Rate display: `followUpRatePercent(row)` = `Math.ceil((row.followUpRecords * 1000) / row.total) / 10` (one decimal, rounded up, so a rate that fails the integer compare never renders equal to the threshold: 7/23 → `30.5`, 6/20 → `30`, 1/3 → `33.4`); `null` when `row.total` is not a positive number or `row.followUpRecords` is not an integer.
- `TRUST_POLICY_KEYS` = `Object.freeze(['trust-revert-window-days', 'trust-evaluation-window-days', 'trust-follow-up-rate-max-percent'])`, exported from `trust.js`. Defaults come only from `bin/lib/policy-schema.js` via `resolveValue` — no new default constants in `trust.js` (`single-source-constant-guard`).
- Gate order, gates 1, 3, 4, 5, the merge-lane breaker and `permittedGrants`' mapping are unchanged.
- Never write the literal tokens `TBD`, `TODO` or `<!-- ambiguity:` in skill prose.
- Commit subjects: `{Verb} {what} — {detail}`, body ends `refs #5291` (never "closes").
- Quoted from the `policy-key-addition` project skill (sites 1-4): "`key` (flat kebab-case, `tests/policy-key-naming.test.js`), `type` …, and `default` … `summary`, `category` and `tier` are required (`tests/policy-schema-metadata.test.js`)." "The core tier has an enforced cap of 12 … so a new key is `advanced` unless it replaces a core one." "`tests/policy-schema.test.js` pins `POLICY_KEYS.length`. Bump it in the same commit." "Every key needs a table row there that starts `` | `{key}` | `` (`tests/policy-key-naming.test.js`), and its summary must not be copied verbatim from the row's `summary` (`tests/policy-schema-metadata.test.js`). State the value the resolver returns for unset, set and malformed input, from the code, not from intent." "**Pin each new validation branch with its own assertion.**" "**Changing what an existing value does needs two greps, not one.** Grep the key's kebab-case name across `plugin/skills/`, `docs/journeys/` and `README.md`."
- Quoted from the `bin-source-scan-conformance` project skill: "Import it: `const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');`." "A scan reports `misparsed` and `unparseable` as an offender, with `STRIPPER_VERDICT_MESSAGES[verdict]` as the text." "A new suite that imports the stripper is itself a caller, and two hand-written lists must name it by test-file stem: the header comment of `tests/helpers/strip-comments.js` and `parse-signal-discipline` item 15." "If the suite reads a source file as text, read it through `readText` from `tests/helpers/read-skill.js`, not a raw `fs.readFileSync`."
- Size: `_shared/policy-schema.md` is 47,121 B; the rail is 52,500 B (`RAIL_BYTES`). Two rows (~1.2 KB) land near 48.3 KB — over the soft 90% flag, under the rail. Keep each row to one table line.

## Review Focus

1. A class whose fetched history is shorter than the window (this repo: 23 days vs 30) — rows must still grade; `oldestClosedAt` must report the true oldest graded close. Pinned in Task 2 (`oldestClosedAt` test).
2. A record closed exactly `windowDays` ago — inclusive boundary, so it stays in-window (Task 2 boundary test, AC3 days 29/30/31).
3. `total === 0` never divides by zero — impossible for a cell, but `followUpRate` is computed defensively as `0` (Task 2).
4. A threshold of `0` restores today's behavior exactly — one follow-up record makes the class `mixed` (Task 2).
5. The all-refused overview line when some refusals are not `trust` (e.g. `needs-label`) — counts list every key, the trust suffix lists only classes refused at trust (Task 3).

---

### Task 1: Register the two policy keys

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js` (two `POLICY_KEYS` rows right after `trust-revert-window-days`, category `autonomy-trust`, tier `advanced`)
- Modify: `plugin/skills/_shared/policy-schema.md` (two Config Lever Index rows right after the `trust-revert-window-days` row)
- Test: `tests/policy-schema.test.js` (bump the `POLICY_KEYS.length` pin from 103 to 105; two new tests beside the `trust-revert-window-days` test)

**Interfaces:**
- Produces: `resolveValue('trust-evaluation-window-days', raw)` → integer ≥ 1, default 30; `resolveValue('trust-follow-up-rate-max-percent', raw)` → integer 0-100, default 30.

- [ ] **Step 1: Write the failing tests** in `tests/policy-schema.test.js`, modeled on the `trust-revert-window-days` test:
  - `test('AC6.1: trust-evaluation-window-days is a recognized integer key with a floor of 1, defaulting to 30', …)` — asserts `type === 'integer'`, `min === 1`, `default === 30`; `auditPolicy` flags `0` and `-5`, accepts `45`.
  - `test('AC6.1: trust-follow-up-rate-max-percent is an integer key bounded 0..100, defaulting to 30', …)` — asserts `type`, `min === 0`, `max === 100`, `default === 30`; `auditPolicy` accepts `0` and `100`, flags `101`, `-1` and `banana`; `resolveValue('trust-follow-up-rate-max-percent', '101')` returns `30`.
  - `test('AC6.1: resolvePolicyKeys flags a malformed trust window and rate and resolves their defaults', …)` — `resolvePolicyKeys(['trust-evaluation-window-days', 'trust-follow-up-rate-max-percent'], { policyRaw: 'trust-evaluation-window-days: 0\ntrust-follow-up-rate-max-percent: 101\n' })`; assert each entry has `value` equal to its default (`30`, `30`) and `invalid === true`; a valid `policyRaw` (`45`, `20`) resolves `45`/`20` with no `invalid`.
  - Bump the length pin to `105`.
- [ ] **Step 2: Run** `node --test tests/policy-schema.test.js` — Expected: FAIL (keys missing, length 103).
- [ ] **Step 3: Add the two rows** to `POLICY_KEYS`. Summaries (plain, verb-first, distinct from the doc rows): window — "Sets how many days back a closed record still counts toward its class's trust verdict."; rate — "Sets the largest share of a class's recent records, in percent, that may draw a corrective follow-up while the class still reads clean." Add both doc rows to `_shared/policy-schema.md`'s table: reader column `bin/lib/issues/trust.js` (verdict engine); state unset → default, set → the integer, malformed (window `0`/negative/non-integer; rate outside 0-100 or non-integer) → default with `invalid: true`; say `0` on the rate restores zero tolerance; say a window at or below `trust-revert-window-days` leaves only acceptance dispositions as evidence.
- [ ] **Step 4: Run** `node --test tests/policy-schema.test.js tests/policy-schema-metadata.test.js tests/policy-key-naming.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** — `Register trust evaluation window and follow-up rate keys — two advanced autonomy-trust levers`.

### Task 2: Windowed verdict with a follow-up rate in trust.js

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/trust.js` (`trustRows`, the notPlanned comment at the verdict block that says the table "has no time window", new exports)
- Test: `tests/bin-lib/issues/trust.test.js` (new tests; existing closed-record fixtures that carry no `closedAt` and call `trustRows(records)` with the default clock — about 35 of them, lines 30-302 and 781-897 — gain `closedAt: RECENT`, where `const RECENT = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()` is declared once near the top (the file's `MS_PER_DAY_FIXTURE` is declared only at line 308); update the `backward compatibility` test whose fixture is `closedAt: '2020-01-01T00:00:00Z'` to `closedAt: RECENT`, keeping its intent; update the comment near line 257 that says the table "has no time window to age it out" — the ungradable kind is pinned at any window)
- Test: `tests/bin-lib/issues/grant-sampling.test.js` (the two closed fixtures at lines 100-108 gain an in-window `closedAt` the same way)
- Test: `tests/bin-lib/backlog-grant-gate/backlog-grant-gate.test.js` (fixtures with `closedAt: '2026-01-01T00:00:00Z'` → a date 20 days before `Date.now()`; moved here from Task 4 because this task's window filter is what turns them red)

**Interfaces:**
- Consumes: Task 1's two keys via `resolveValue`.
- Produces:
  - `TRUST_POLICY_KEYS: readonly string[]` (Global Constraints order).
  - `trustRows(records, gitLog, now, policy)` rows gain: `followUpRecords: number`, `followUpRate: number` (0..1), `mixedReasons: string[]`, `evaluationWindowDays: number`, `followUpRateMaxPercent: number`, `oldestClosedAt: string|null` (ISO of the earliest parseable `closedAt` among the cell's graded records).
  - `followUpRatePercent(row) -> number|null` (Global Constraints' rate-display rule).
  - `describeMixedReasons(row) -> string` — `''` for a non-mixed row, and `''` for a mixed row with no `mixedReasons` array (a bare `{ verdict: 'mixed' }`, as hand-built rows in `grant-gate.test.js` and `backlog.test.js` are); otherwise comma-joined parts in `mixedReasons` order: `${n} changes-requested`, `follow-up rate ${followUpRatePercent(row)}% > ${row.followUpRateMaxPercent}%`, `${n} negative`, `batch-only approvals`. Example: `follow-up rate 33.4% > 30%, 2 negative`. Callers drop the surrounding parentheses when it returns `''`.

- [ ] **Step 1: Write the failing tests** (names carry the AC clause ids; use the file's `NOW` and `closedDaysAgo`):
  - `AC1.1/AC1.2: 10 in-window records, 6 dispositioned, 2 with one follow-up each read clean at the default and mixed at 10%` — fixture: 10 `by:capture risk:low` records closed 15 days ago with commits in `gitLog` for 6 of them (operationalGood), plus 2 open records whose bodies carry `Origin: reflect full from #{n}` naming two of the 10. Assert default → `verdict 'clean'`, `followUpRecords 2`, `followUpRate 0.2`; with `{ 'trust-follow-up-rate-max-percent': 10 }` → `verdict 'mixed'`, `mixedReasons ['follow-up-rate']`.
  - `AC2.1: three follow-ups on one record count one followUpRecord and three followUps` — assert `followUpRecords 1`, `followUps 3`, `followUpRate === 1 / total`.
  - `AC3.1: a record closed 31 days ago forms no cell under the default window and does under 45` — assert `trustRows([r31], …, NOW, {})` is `[]`; with `{ 'trust-evaluation-window-days': 45 }` one row, `total 1`.
  - `AC3.2: a changes-requested record ages out — 31 days ago no longer pins, 29 days ago still does` — a clean-qualifying 8-record class (closed 15 days ago, operational) plus one `demo:changes-requested` record of the same class at 31 vs 29 days: 31 → `clean`; 29 → `mixed` with `mixedReasons ['changes-requested']`. Add a 30-day case asserting it pins (inclusive boundary).
  - `AC4.1: an out-of-window closed follow-up still counts against an in-window target` — target closed 10 days ago; follow-up record `state: 'CLOSED'`, closed 60 days ago, body `Origin: reflect full from #{target}`; assert the target's row `followUps 1`, `followUpRecords 1`, and no row exists for the follow-up's own class.
  - `AC5.1: one in-window negative-evidence record pins the class at any rate threshold` — 8-record operational class plus one reverted record; with `{ 'trust-follow-up-rate-max-percent': 100 }` assert `verdict 'mixed'`, `mixedReasons` includes `'negative-evidence'`.
  - `AC6.1: malformed window and rate fall back to the schema defaults` — `{ 'trust-evaluation-window-days': 0 }` grades like `{}`; `{ 'trust-follow-up-rate-max-percent': 'banana' }` echoes `followUpRateMaxPercent 30`.
  - `threshold 0 restores zero tolerance` — the AC1 fixture with `max-percent: 0` → `mixed`.
  - `a closed record with no parseable closedAt forms no cell but still counts as a follow-up source` — one in-window target plus a closed record with no `closedAt` whose body is `Origin: reflect full from #{target}`, and a second closed record with `closedAt: 'not-a-date'`; assert no row for the follow-up's own class, and the target row `followUps 1`, `followUpRecords 1`.
  - `oldestClosedAt reports the earliest graded close and evaluationWindowDays echoes the window` — records at 3, 12, 20 days → `oldestClosedAt === closedDaysAgo(20)`, `evaluationWindowDays 30`.
  - `describeMixedReasons renders every reason in order` — a hand-built row `{ verdict: 'mixed', mixedReasons: ['changes-requested','follow-up-rate','negative-evidence','batch-only'], changesRequested: 1, followUpRecords: 1, total: 3, followUpRate: 1/3, followUpRateMaxPercent: 30, negativeEvidence: 2 }` → `'1 changes-requested, follow-up rate 33.4% > 30%, 2 negative, batch-only approvals'`; a clean row → `''`; a bare `{ verdict: 'mixed' }` → `''`.
  - `followUpRatePercent rounds up at one decimal so a failing rate never reads as the threshold` — `{ followUpRecords: 7, total: 23 }` → `30.5`; `{ followUpRecords: 6, total: 20 }` → `30`; `{ followUpRecords: 1, total: 3 }` → `33.4`; `{ total: 0 }` → `null`; and `trustRows` on a 23-record class with 7 follow-up records at the default threshold reads `mixed` with `describeMixedReasons` containing `follow-up rate 30.5% > 30%`.
  - `TRUST_POLICY_KEYS lists the three trust keys in order and every one is a POLICY_KEYS key`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/issues/trust.test.js` — Expected: FAIL (new exports undefined, rows lack fields).
- [ ] **Step 3: Implement** in `trust.js`: resolve the two new keys with `resolveValue` beside `resolveRevertWindowDays`; filter `closed` by the window rule; track a per-cell `Set` of follow-up target numbers next to the `followUps` counter; compute the new row fields and the new `clean` rule from Global Constraints; add `TRUST_POLICY_KEYS`, `followUpRatePercent` and `describeMixedReasons` to `module.exports`. Then add the in-window `closedAt` to the legacy fixtures listed under Files in `trust.test.js`, `grant-sampling.test.js` and `backlog-grant-gate.test.js`. Rewrite the notPlanned comment's "this table has no time window" sentence to say records now age out of the window, and why `notPlanned` still stays out of the verdict (a declined record is not a quality outcome).
- [ ] **Step 4: Run** `node --test tests/bin-lib/issues/trust.test.js tests/bin-lib/issues/grant-sampling.test.js tests/accept-label-reader-conformance.test.js tests/bin-lib/backlog-grant-gate/backlog-grant-gate.test.js tests/bin-lib/issues/grant-gate.test.js tests/bin-lib/issues/backlog.test.js` — Expected: PASS.
- [ ] **Step 5: Real-input probe** — run the worktree's `node plugin/bin/backlog-grant-gate.js` (needs Task 4 for the CLI threading; until then run a scratch script calling `trustRows` on a fresh `gh issue list --state all` fetch) and record per-class `total`, `followUpRecords`, `followUpRate`, `verdict` for every `producer:*` class to `$PIPELINE_RUN_DIR/evidence/trust-rows-after.txt`. Expected on 2026-11-13 data: `producer:capture|low` clean (~25%), `producer:capture|elevated` mixed (~33%, 2 negative). Log one `AC evidence` decision entry citing the file.
- [ ] **Step 6: Commit** — `Grade trust over a lookback window with a follow-up rate — clean becomes reachable`.

### Task 3: Explain refusals in gate 2 and the backlog overview outlook

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/issues/grant-gate.js` (gate 2 deny reason)
- Modify: `plugin/bin/lib/issues/backlog.js` (`machineGrantOutlook` return shape; new `allRefusedOutlookLine`; export it)
- Test: `tests/bin-lib/issues/grant-gate.test.js`
- Test: `tests/bin-lib/issues/backlog.test.js`

**Interfaces:**
- Consumes: `describeMixedReasons(row)` and `followUpRatePercent(row)` from Task 2.
- Produces:
  - Gate 2 deny reason for a `mixed` row: `class ${classKey} verdict is mixed (${describeMixedReasons(row without its follow-up-rate entry)}) — follow-up rate ${followUpRatePercent(row)}% (max ${row.followUpRateMaxPercent}%) — only a clean class earns a machine-originated grant`. The parenthesized reasons are dropped when `describeMixedReasons` returns `''`; the rate segment is dropped when `followUpRatePercent(row)` is `null` (a bare hand-built row), so a bare `{ verdict: 'mixed' }` row reads exactly as today. The rate segment appears whichever reasons fired (spec Deliverable 4). Other verdicts keep today's text.
  - `machineGrantOutlook(...)` returns `{ eligible, refused, excludedOrigin, trustRefusedClasses }` — `trustRefusedClasses: string[]`, unique `classKey`s from `failedKey === 'trust'` denies, first-seen order.
  - `allRefusedOutlookLine(outlook, trustRowsArray) -> string|null` — `null` unless `outlook.eligible.length === 0` and `refused` is non-empty. Otherwise `# machine grants: none possible — all ${n} candidates refused (${k}: ${c}, …)` with keys in descending count order (ties: key ascending), `n` = sum of counts; when `trustRefusedClasses` is non-empty append ` — trust: ` plus `; `-joined `${classKey} ${part}`, where `part` is `mixed (${describeMixedReasons(row)})` for a mixed row (plain `mixed` when that returns `''`), the row's verdict otherwise, `no-cell` when no row.

- [ ] **Step 1: Write the failing tests:**
  - grant-gate: `AC7.1: a mixed row's deny reason names the rate and the threshold` — row `{ key, kind: 'producer', verdict: 'mixed', mixedReasons: ['follow-up-rate'], followUpRecords: 1, total: 3, followUpRate: 1/3, followUpRateMaxPercent: 30, changesRequested: 0, negativeEvidence: 0 }`; assert reason matches `/33\.4%/` and `/30%/` and still `/mixed/`.
  - grant-gate: `AC7.1: a mixed row pinned only by negative evidence still names the rate and the threshold` — same row with `mixedReasons: ['negative-evidence']`, `negativeEvidence: 1`, `followUpRecords: 0` → reason matches `/1 negative/` and `/follow-up rate 0% \(max 30%\)/`.
  - grant-gate: the existing bare `{ verdict: 'mixed' }` fixture (near line 159) keeps passing unchanged, and its reason contains no `()` and no `follow-up rate`.
  - backlog: `AC9.1: allRefusedOutlookLine renders the all-refused line` — outlook `{ eligible: [], refused: { trust: [1..104] }, excludedOrigin: 0, trustRefusedClasses: [] }` → string includes `none possible — all 104 candidates refused (trust: 104)`.
  - backlog: `allRefusedOutlookLine appends each trust-refused class with its reasons` — `trustRefusedClasses: ['producer:capture|elevated']` with a mixed row (`followUpRecords: 1`, `total: 3`, max 30, negative 2) → includes `trust: producer:capture|elevated mixed (follow-up rate 33.4% > 30%, 2 negative)`; with a bare `{ key, verdict: 'mixed' }` row (as at `backlog.test.js` near line 644) the part reads `mixed`, with no empty parentheses.
  - backlog: `allRefusedOutlookLine lists every refusing key by count and returns null when any candidate is eligible` — refused `{ trust: [1,2], 'needs-label': [3] }` → includes `(trust: 2, needs-label: 1)`; with `eligible: [9]` → `null`; with `refused: {}` → `null`.
  - backlog: `machineGrantOutlook reports the classes refused at trust` — one mixed `producer:code-health|low` record → `trustRefusedClasses ['producer:code-health|low']`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/issues/grant-gate.test.js tests/bin-lib/issues/backlog.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** the reason text, the extra return field (read `result.snapshot.classKey`), and `allRefusedOutlookLine`.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** — `Name the failing trust conditions in gate 2 and the overview — refusals read in plain words`.

### Task 4: Thread TRUST_POLICY_KEYS through every trustRows caller

**Role:** integration

**Files:**
- Modify: `plugin/bin/backlog-grant-gate.js` (add both new keys to the `resolvePolicyKeys` list; replace `windowDays` with `trust: Object.fromEntries(TRUST_POLICY_KEYS.map((k) => [k, resolved[k].value]))`)
- Modify: `plugin/bin/lib/backlog-grant-gate/backlog-grant-gate.js` (call `trustRows(records, gitLog, Date.now(), Object.fromEntries(TRUST_POLICY_KEYS.map((k) => [k, (pol.trust || {})[k]])))`; update the header comment naming `windowDays`)
- Modify: `plugin/skills/_shared/trust-table.md` (Fetch snippet: build `policy` from `TRUST_POLICY_KEYS` and three argv values; the resolve paragraph resolves all three keys and names the three placeholders)
- Modify: `plugin/skills/backlog/trust-signal.md` (same snippet change; placeholders from refine-mode's resolve)
- Modify: `plugin/skills/backlog/refine-mode.md` (resolve line becomes `--values autonomy trust-revert-window-days trust-evaluation-window-days trust-follow-up-rate-max-percent`, with the line-to-placeholder comment updated)
- Modify: `plugin/skills/capture/SKILL.md` (same resolve-line widening and snippet change)
- Modify: `docs/journeys/refine-the-backlog-through-decision-lanes.md` (its quoted `resolve-policy.js --values autonomy trust-revert-window-days` line)
- Modify: `docs/plugin-structure.md` (the `backlog-grant-gate.js` CLI line's list of resolved keys gains the two new keys)
- Modify: `plugin/skills/backlog/mcp-transport.md` (step 3's "call `trustRows` directly" sentence: pass a policy built from `TRUST_POLICY_KEYS` with the values `resolve-policy.js --values` prints for those keys)
- Modify: `tests/bin-lib/backlog-grant-gate/backlog-grant-gate.test.js` (`windowDays: 14` → `trust: { 'trust-revert-window-days': 14 }` in every `computeOutlook` call; the `closedAt` re-dating already landed in Task 2)
- Modify: `tests/helpers/strip-comments.js` header list and `.claude/skills/parse-signal-discipline/SKILL.md` item 15 list (add stem `trust-policy-keys`, alphabetical)
- Create: `tests/trust-policy-keys-conformance.test.js`

Snippet shape for the three skill files (placeholders `{resolved-window}`, `{resolved-eval-window}`, `{resolved-follow-up-rate}`, passed after `--` in `TRUST_POLICY_KEYS` order):
`const policy = Object.fromEntries(TRUST_POLICY_KEYS.map((k, i) => [k, process.argv[1 + i]]));`

**Interfaces:**
- Consumes: `TRUST_POLICY_KEYS` (Task 2).

- [ ] **Step 1: Write the failing conformance test** `tests/trust-policy-keys-conformance.test.js`:
  - Walks `plugin/bin/**/*.js` (skip `plugin/bin/lib/issues/trust.js`) through `readText` + `stripComments`; reports any `stripperVerdict` other than `ok` as an offender with `STRIPPER_VERDICT_MESSAGES[verdict]`. A site is a match of `/\btrustRows\(\s*[A-Za-z_$]/` in the stripped text; a file with a site must also contain `TRUST_POLICY_KEYS` in its stripped text.
  - Walks `plugin/skills/**/*.md` through `readText`; for each fenced code block containing a site, the same block must contain `TRUST_POLICY_KEYS`.
  - `AC8.1: every trustRows call site builds its policy from TRUST_POLICY_KEYS` — offenders `[]`.
  - Floor: total sites ≥ 4, and the site files equal exactly `['plugin/bin/lib/backlog-grant-gate/backlog-grant-gate.js', 'plugin/skills/_shared/trust-table.md', 'plugin/skills/backlog/trust-signal.md', 'plugin/skills/capture/SKILL.md']` (sorted).
  - `AC8.2` go-red rows: the block-checker flags a planted fence `node -e "trustRows(r, g, n, { 'trust-revert-window-days': process.argv[1] })"`; the js-checker flags a planted `const rows = trustRows(records, log, now, {});`; the js-checker reports a planted mis-parse (`if (b) /"/.test(b); trustRows(x);`) as an offender.
- [ ] **Step 2: Run** `node --test tests/trust-policy-keys-conformance.test.js tests/strip-comments-callers-twin.test.js` — Expected: FAIL on the four real sites (go-red rows pass).
- [ ] **Step 3: Apply the call-site changes** listed in Files, then update the grant-gate test fixtures.
- [ ] **Step 4: Run** `node --test tests/trust-policy-keys-conformance.test.js tests/strip-comments-callers-twin.test.js tests/bin-lib/backlog-grant-gate/backlog-grant-gate.test.js tests/backlog-grant-gate-cli.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** — `Pass every trust policy key at each trustRows call site — one list, pinned by a scan`.

### Task 5: Describe the windowed rule in the shared contracts and the overview

**Role:** integration

**Files:**
- Modify: `plugin/skills/_shared/autonomy-ceiling.md` — replace the **Not currently time-windowed** paragraph with the window + rate rule (both keys by name, `changesRequested`/`negativeEvidence` zero tolerance inside the window, recovery once a record ages out); fix the Revocation paragraph's "the same precedence `changesRequested`/`followUps` already had" (followUps is now a rate); add a short paragraph saying `grant-origination-enabled` still gates every machine grant and `fleet-daily-grant-cap` still bounds grants per calendar day; add the removal condition: the bridge is re-decided (retired or kept) when #4623 ships.
- Modify: `plugin/skills/_shared/trust-table.md` — add a `Follow-up rate` column after `Follow-ups` (render `followUpRatePercent(row)` with a `%` suffix, the same figure gate 2 prints); add a header line above the table: `Window: last {evaluationWindowDays} days (oldest graded close {N} days ago) · follow-up rate ≤ {followUpRateMaxPercent}%`, values from the rows, `N` from the minimum `oldestClosedAt`; rewrite **Known limitation: no time window** as **Evaluation window** describing the shipped rule and the fetch-limit bound (the window can be shorter than the key when `backlog-fetch-limit` truncates history — the truncation warning still applies); fix the Negative Evidence paragraph's "reads `mixed` even when `Changes Requested` and `Follow-ups` are both `0`" (now: even when the follow-up rate is under the threshold); reword the Not Planned paragraph's "with no time window in this table an unrecoverable one".
- Modify: `plugin/skills/backlog/machine-grant-outlook.md` (4,840 B today) — when `eligible` is empty and `refused` non-empty, render the `allRefusedOutlookLine` output under `# specified {n}` in place of the `# machine-grant live …` line; keep the live line for the eligible > 0 case. The file has no `node -e` snippet today (the outlook is computed in prose), so author a new fenced `bash` block in `overview-mode.md`'s house style (re-resolve `ST_BACKLOG_OVERVIEW_VIEWS` = `backlog-overview-views.json` and `ST_BACKLOG_OVERVIEW_TRUST_ROWS` via `session-tmp-resolve.js --value`, then one `node -e` with `require('$ST_…')` reads): it computes `const outlook = machineGrantOutlook(require('$ST_BACKLOG_OVERVIEW_VIEWS').funnel.specified, { ceiling: 'unattended', grantOriginationEnabled: true }, rows)` (this file's load gate already fixed both values) with `rows = require('$ST_BACKLOG_OVERVIEW_TRUST_ROWS')`, prints `allRefusedOutlookLine(outlook, rows)` when non-null, and otherwise prints a one-line JSON `{ eligible, refusedTotal, refused, excludedOrigin }` the live line renders from. It reads rows from the JSON file Step 1.5 wrote and never calls `trustRows(`, so it is not a `trust-policy-keys` conformance site and the Task 4 roster stays at four files. No test reads this file today: create `tests/machine-grant-outlook-snippet.test.js`, which extracts the fence through `readText`, substitutes temp fixture paths for the two `$ST_…` variables and the plugin root, runs it with `node`, and asserts the all-refused line for a fixture whose one specified record is refused at `trust`, and the JSON form when it is eligible (`skill-prose-conformance-tests`: byte-pin an executable snippet and run it).
- Modify: `docs/journeys/triage-backlog-via-funnel-overview.md` — step 2 names the all-refused line as the machine-grant line's zero-eligible form.
- Create: `tests/machine-grant-outlook-snippet.test.js` (described above).

- [ ] **Step 1: Sweep** — run `git grep -n -i -E "no time window|all-time|followUps|Follow-ups|time-windowed" -- plugin/skills docs/journeys README.md` and classify each hit in this task's commit message body as changed or no-change.
- [ ] **Step 2: Edit** the four files as listed.
- [ ] **Step 3: Run** `node --test tests/skill-size-single-source.test.js tests/machine-grant-outlook-snippet.test.js` plus every test file that reads the four edited files (`git grep -l -E "autonomy-ceiling|trust-table|machine-grant-outlook|triage-backlog-via-funnel" -- tests`) — Expected: PASS; `wc -c` of each edited skill file stays under 52,500.
- [ ] **Step 4: Commit** — `Describe the windowed trust rule in the shared contracts — window, rate, removal condition`.

### Operational (orchestrator, not an implementer task)

- After the build, post one comment on #4623 linking #5291 and stating the removal condition (Deliverable 7).
- AC10: quote the before run (2026-11-13 shaping: 104 candidates, 0 eligible, all refused at `trust`) and an after run of the worktree's `node plugin/bin/backlog-grant-gate.js` in the PR description, with per-class verdicts for every `producer:*` class; if the after run shows 0 eligible, name the blocking condition.
- AC11: full `npm test` runs at Common Step 5 (verify).

Waived AC10.1: operational evidence in the PR description, not a test — recorded by the orchestrator from a live CLI run.
Waived AC10.2: same — the orchestrator names the blocking condition if the after run shows 0 eligible.
Waived AC11.1: the full suite is Common Step 5's verify run, not a task test.

Check B classification (2026-11-13 audit): no change needed — `CHANGELOG.md` (release-please), `docs/journeys/resolve-a-policy-key.md` and `tests/resolve-policy-*.test.js` + `tests/fixtures/resolve-policy/*.yml` + `tests/bin-lib/console/fixtures/staged/patch-journey-2567.md` (use `trust-revert-window-days` only as an example key), `docs/skill-graph.md` (describes the table generically), `plugin/bin/lib/issues/autonomy.js` (comment only), `plugin/bin/lib/issues/merge-lane-breaker.js` and `plugin/skills/backlog/refine-headless.md` (revert window, unchanged), `plugin/skills/_shared/policy-schema-coverage.md` (`resolveRevertWindowDays` still the first caller), `tests/accept-label-reader-conformance.test.js` and `tests/bin-lib/issues/grant-sampling.test.js` (run in Task 2 Step 4, no edit), the ledger file.

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1, AC3.1, AC3.2, AC4.1 | Task 2 |
| Deliverable 2, AC1.1, AC1.2, AC2.1 | Task 2 |
| Deliverable 3, AC5.1 | Task 2 |
| Deliverable 4, AC7.1 | Tasks 2, 3 |
| Deliverable 5, AC8.1 | Task 4 |
| Deliverable 6 | Tasks 1, 5 |
| Deliverable 7 | Task 5 + Operational |
| Deliverable 8, AC9.1 | Tasks 3, 5 |
| AC6.1 | Tasks 1, 2 |
| AC10 | Operational |
| AC11 | Common Step 5 |
