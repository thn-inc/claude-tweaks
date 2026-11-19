# Pipeline Cost Report Review Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `reviews` section to `tools/pipeline-cost-report.js` that prints what task review, plan review and lens review returned, by model tier and, for lens review, by lens, with every figure's unparsed count beside it.

**Architecture:** A fifth reader module, `tools/pipeline-cost-report/reviews.js`, beside #5914's `spend.js`/`funnel.js`/`records.js`/`runs.js` and #5916's `guards.js`. It takes the run listing the CLI builds once (`ctx.runs`, from `runs.js`'s `listRuns`), resolves archived stubs with `guards.js`'s `resolveRun`, reads dispatches with `guards.js`'s `readTiming`, reports with `readReport` and task-review items with `parseReviewCounts`, and reads lens identity, verdicts and confirmations with `tools/review-replay/archive.js`'s `readCost` and `readRun`. It adds only the parsers no sibling has: the task-review verdict, the plan-review table, the lens-review table, the routing classes and the plan-review human-stop lines.

**Tech Stack:** Node 18+ built-ins, `node --test` through `tools/run-tests.js`.

**Spec:** `.claude-tweaks/pipelines/2026-11-19T055619-spec-5914-5916-5925/spec-5925/work/5925-spec.md`

**Scope keywords:** pipeline-cost-report, reviews.js, readRun, readCost, resolveRun, readTiming, readReport, parseReviewCounts, listRuns, SECTIONS

## Global Constraints

- No file under `plugin/` changes (AC11). `reviews.js` may `require` sibling `tools/` modules only.
- The section honours `--since`, `--until` (both inclusive, UTC) and `--json`; `--runs <n>` (default 20, the CLI's existing `DEFAULT_RUNS`) sets the yield window. The yield alone ignores `--since` (it walks every listed run dated on or before `--until`), as `guards` is independent of the window.
- A run's date is the leading `YYYY-MM-DD` of its directory name (`run.date` from `listRuns`). Runs are ordered by date, then full directory name.
- Shares are fractions from 0 to 1 in `--json`, `null` when their denominator is 0; the markdown prints whole percents with `Math.round` and `none` for null. Per-agent and per-review means print with `toFixed(2)`.
- Every figure carries the number of reports or runs it could not parse, and an unparsed item is in no share's numerator or denominator.
- `--json` adds `reviews` and changes by adding fields, never by renaming one (a later phase reads `reviews.lens.yield.byLens`).
- Read-only. Tests use temp dirs and fixture text; nothing spawns a process or calls `git`/`gh`.
- Governing skill, `.claude/skills/parse-signal-discipline/SKILL.md` (every parser here reads loose real-world prose), quoted: "When the check hits an input it cannot confidently parse, that outcome must be distinguishable from "this input legitimately does not need this check" — collapsing both into one `null`/skip return turns an unparseable input into a silent false negative: the check reports nothing, and nothing downstream ever learns the check didn't actually run." Each parser below returns `null` only for "could not parse" and a zero-count result for "parsed, nothing found". No other project skill under `.claude/skills/` names `tools/pipeline-cost-report*` or `tools/review-replay/` (`git grep -l -e pipeline-cost-report -e review-replay -- .claude/skills` prints nothing).
- Display names of run units are built with a literal `/` (`${run.name}/spec-${id}`), never `path.join`, so they read the same on Windows.

## Build-time findings (verified against real runs, logged in the run's decisions.md)

The four ASSUMPTIONs and the Current State were probed on 2026-11-19 against `.claude-tweaks/pipelines/` (top level, `archive/`, `spec-{N}` members) and the subagent transcripts. Where a premise was reversed, the corrected fact below is what the plan builds.

1. **Task review (confirmed).** 464 of 470 task-review reports since 2026-11-08 carry `**Task quality:** Approved` or `**Task quality:** Needs fixes` (some with a trailing clause: `Needs fixes (one cheap Important item).`); one writes `Task quality: Approved` unbolded. Items sit under `#### Critical (Must Fix)` / `#### Important (Should Fix)` / `#### Minor (Nice to Have)`, which `guards.js`'s `parseReviewCounts` already counts. A dispatch labelled `task review` that is really a re-review reports `**Fix round:** …` and is unparsed.
2. **Plan review (premise reversed).** Findings are rows of `| Severity | Class | Resolution | Path:Line | Finding | Evidence | Suggested resolution |`; the Class cell is the kind. It is written `missing-review-risk` (hyphenated), beside `cross-task contract`, `undecided behaviour`, `spec gap`, a fifth value `mischaracterized-role`, and row-cap overflow rows with no kind: `| info | — | — | — | +2 more | — | — |` and `| +1 more | | | | | | |`. A report with no findings is `No findings.`.
3. **Plan-review human stop (confirmed).** Two fixed forms, both on `Common Step 1.6` and naming `needs-human`: `- KEPT-PROMPT 08:28:18 — Common Step 1.6 (plan review): plan review: 2 needs-human spec gap(s) asked inline. Reversibility: n/a.` and the dispatched-call form (`REFUSED`/`AUTO`) naming `HARD-GATE plan-review-needs-human` or `question posted`/`question comment posted`. A line that only mentions a settled gap (`amended spec and plan for 4 finding(s) (1 needs-human spec gap settled in a converged round …`) is not a stop. The pattern exists, so `humanStops` is always a number.
4. **Run enumeration (confirmed).** `listRuns` returns `{ name, date, dir, archived, members: [{ id, dir }] }` and keeps the top-level copy of a name found in both places (`runs.js:49-56`). `guards.js`'s `resolveRun` (`guards.js:43-57`) re-points a top-level run with no `timing.json` at `archive/{name}` and re-lists its members there; this plan exports it. No member step is added in `reviews.js`.
5. **Multi-spec timing (Current State reversed).** A member's `decisions.md` and `review-findings.json` sit in `spec-{N}/`, but a member's `timing.json` is a stub with no dispatches (`{"dispatches":{"notFound":"no transcript resolved"}, "transcripts": [] …}`), and the parent's `timing.json` lists every member's dispatches. Lens descriptions do not name the member (`Lens 3a convention A`), so lens agents cannot be split by member.
6. **Routing outcomes (Current State reversed).** The four classes are the ones the record's own measurement script matched, keyed by the first `path:line` on the line (below, Task 4). That script's 63/29/5/3 split was a share of every routed location, refuted ones included, not of confirmed locations, so the confirmed-location shares will not reproduce it; over 2026-11-08..2026-11-18 the confirmed-location rule gives fixed 660, staged 149, deferred 47, dismissed 137 and 441 unrouted. By the user's plan-review decision (Deliverable 6 as amended), the section prints both splits: the confirmed-location shares, and beside them the same four shares over every routed location, refuted ones included.
7. **Duplicate dispatch listings.** One agent can appear in two runs' `timing.json` (`a09d135d0b9a177c3` in `2026-11-19T073130-spec-5903` and `2026-11-19T073235-adhoc-standalone`).
8. **Lens report format.** A `| Severity | Path:Line | Finding | Evidence |` table or `No findings.`; 25 reports open `No findings` and continue in prose with no row, 4 open `No findings` yet hold rows, 3 put `No findings.` after a prose paragraph. Lens reviewers ran on `fast` and `standard` only in that window (the UX lens 3g on `standard`).

## Decisions (the user's at plan review, and those made here)

The first five bullets are the user's plan-review decisions (the spec's `## Plan Review Clarifications`; Deliverables 1, 6 and 7 as amended on the record). The rest are made here.

- **Which directory feeds which figure** (user decision; from finding 5). Dispatch figures (task review, plan review, lens agents by tier and lens) are read once per run from the resolved run directory's `timing.json`, the parent's for a multi-spec run. Decision figures (per-run verdicts, outcomes, plan-review human stops) are read once per *run unit*: each `spec-{N}` member of a run that has members, else the run directory. The parent's own `decisions.md` and `review-findings.json` are never read when it has members (AC8).
- **The yield's window** (user decision). The yield ignores `--since`, as `guards` does: it walks every listed run dated on or before `--until`, newest first (date, then name, descending), until `n` slots are filled. `collectReviews` therefore walks twice: the window walk (`since..until`) for every other figure, and the yield walk (`until` only) for the yield, each with its own `agentId` dedupe.
- **Yield slots for a multi-spec run** (user decision). A multi-spec run is one slot. Its agents for a lens are the parent's lens agents for that lens; its confirmed count is the sum over its members; it is readable only when every member is readable (no member `excluded`), else it counts in `unparsed` and takes no slot.
- **Two outcome splits** (user decision). `lens.outcomes` keeps Deliverable 6's shares over confirmed locations and adds `allRouted`: the same four shares over every location (distinct `path:line` of a readable unit) that has at least one classified routing line, confirmed or not, refuted ones included. That is the 2026-11-18 measurement's division, so 63/29/5/3 can be checked against it (rates, not counts).
- **Exit code on a failed pipelines listing** (user decision). Under `--section all`, a failed default `--pipelines` listing makes the section `reviews: unavailable — {first line}` and leaves the exit code alone, as the CLI header documents for `Runs: unavailable`. Only `--section reviews` exits 1 on it.
- **A run with no timing.json** (plan-review undecided-behaviour row). `readTiming` returns null for an absent file; such a run is kept, never dropped: its `timing` is `'missing'` with no dispatches, it counts in `window.noTiming` (printed beside `timingUnparsed`), and its units are still read for the decision figures. In the yield, a run whose timing is `'missing'` or `'unparsed'` cannot count agents, so for each lens whose slots are still open it adds 1 to that lens's `unparsed` when one of its readable units records a verdict (confirmed, refuted or can't tell) for that lens: the lens ran but its agents cannot be counted. With no such verdict, nothing shows the lens ran, and the run is passed over for that lens.
- **Dedupe.** Each `agentId` is counted once in the whole section, in the first run (by date, then name) whose `timing.json` lists it. A dispatch with no `agentId` is kept and is unparsed when its report cannot be found.
- **Task review** reads `role === 'task review'` only. `re-review` dispatches are counted per tier and printed beside the table. A report with no verdict line is unparsed. Items are counted only for `needs-fixes` reports; one with none of the three headings counts in `items.unparsed` but stays in the needs-fixes share. "Minor only" is `critical + important === 0 && minor > 0`, over the needs-fixes reports whose items parsed.
- **Plan review kinds.** The Class cell is lowercased, `*`/`` ` ``/`_` removed, `-` turned into a space, `behavior` turned into `behaviour`, and matched against the four kinds; the JSON keys are `cross-task contract`, `undecided behaviour`, `spec gap`, `missing review risk` and `other`. An overflow row (any cell matching `/^\+(\d+) more\b/`) adds N findings, all to `other`. A finding row is a table row after the header whose first cell is a severity word.
- **Lens report** is no-finding only when it holds no finding row, no overflow row, and some line matches `/^[\s*_`>#-]*No findings?\b/im`; rows win over a "No findings" opening. An overflow row (any cell matching `/^\+(\d+) more\b/`, the lens prompt's "+N more" cap row, `plugin/skills/review/step3-lens-dispatch.md:149`) is never a finding row itself, even when its first cell is a severity word: its N is added to the report's `overflow` count, which counts toward `perAgent.total` and is printed in its own column.
- **A clean lens review is unparsed for the verdict figures** (settled at plan review after the answered round: Reading A, the spec's Gotcha "A member directory with no `decisions.md` review lines is unparsed for the confirmed figures, never zero"). A unit with no line `readRun` counts as a verdict (for example a review whose agents all returned "No findings", which logs `Step 3: Reproduction: lens "3b" — both agents No findings.`) is `excluded` and unparsed in `perRun` and the yield, never confirmed 0, and the yield's markdown says so: `A run with no recorded verdict line (a fully clean review included) takes no slot and is counted unparsed.`
- **A lens dispatch with no `agentId`** is kept: `lensAgentsOf` keeps a `readCost` lens agent whose `agentId` is null, takes its tier from the timing item with the same `description` (`unknown` when none), and counts it in `agents` and `unparsed` (no report can be found for it).
- **Outcome classes** are the measurement script's patterns plus nothing else (Task 4); a confirmed location with no classified line is `unrouted`.
- **`--section all`** runs the section (see the exit-code decision above).

## Review Focus

1. A run present at the top level and under `archive/` counts once, and a top-level stub reads its archived copy. Test: `AC7.1: a run at the top level and under archive/ is counted once` (Task 2).
2. A multi-spec run's dispatches come from the parent while its verdicts come from the members, never both from one. Tests: `AC8.1: two spec members count two runs and none from the parent` (Task 3) and `a multi-spec run's dispatches are read once from the parent` (Task 2).
3. A report or decisions file the tool cannot read is never a zero. Tests: `AC2.1`, `AC9.2`, `a unit with no review lines is unparsed for the verdict figures` (Tasks 2-3).
4. The same agent listed by two runs' timing files is counted once. Test: `an agentId listed by two runs counts once` (Task 2).
5. The yield ignores `--since` but every other figure honours it, and a run with no timing.json is counted, never silently dropped. Tests: `the yield ignores --since and stops at --until` (Task 4), `a run with no timing.json is counted, not dropped` (Task 2).
6. A failed pipelines listing exits 1 only under `--section reviews`. Test: `a pipelines listing failure: --section reviews exits 1, --section all leaves the code alone` (Task 5).
7. Adding the section must not change what the other sections print or pin. Tests: the updated `usage names every section key` and `sections are separated by a single blank line` in `cli.test.js` (Task 5).

---

### Task 1: Report parsers and real-sample fixtures

**Role:** integration
**Review risk:** high

**Files:**
- Create: `tools/pipeline-cost-report/reviews.js`
- Create: `tests/pipeline-cost-report/reviews.test.js`
- Create: `tests/fixtures/pipeline-cost-report/reviews/task-reviews.txt`
- Create: `tests/fixtures/pipeline-cost-report/reviews/plan-reviews.txt`
- Create: `tests/fixtures/pipeline-cost-report/reviews/lens-reports.txt`

**Interfaces:**
- Produces:
  - `SEVERITIES = ['critical','high','medium','low','info']`, `PLAN_KINDS = ['cross-task contract','undecided behaviour','spec gap','missing review risk']`.
  - `parseTaskVerdict(text: string) -> 'approved' | 'needs-fixes' | null`.
  - `parsePlanReview(text: string) -> { findings: number, byKind: { [kind]: number } } | null` (`byKind` holds the four kinds and `other`, zeros included).
  - `parseLensReport(text: string) -> { critical, high, medium, low, info, overflow } | null` (all zero = no finding; `overflow` is the summed N of `+N more` rows).

- [ ] **Step 1: Write the fixtures and the failing tests.** Each fixture file holds several real reports, each opened by a line `=== {name} ({run}, {agentId}) ===`. Test helper `sample(file, name)` returns the text between that header and the next `=== ` line, trimmed. Write the fixtures exactly as below (trimmed from the named real reports; no machine paths).

`tests/fixtures/pipeline-cost-report/reviews/task-reviews.txt`:

```text
=== needs-fixes-important (2026-11-15T070442-spec-5381, abfc2a20b8d343338) ===
### Issues
#### Critical (Must Fix)
None.

#### Important (Should Fix)
- **Fragile git stderr pins (plan-mandated).** `tests/bin-lib/code-health/cli-validate-findings.test.js:75` and `tests/bin-lib/docs-health/cli-validate-findings.test.js:141` assert git's literal `fatal: not a git repository (or any of the parent directories): .git` lines.
  - **Why it breaks:** the text depends on git's locale and version.
  - **Fix:** pass an explicit env.

#### Minor (Nice to Have)
- `tests/bin-lib/code-health/cli-validate-findings.test.js:67`: the pin passes no `cwd`, so it inherits the repo cwd.
- `tests/bin-lib/design-detect/cli.test.js:99-101`: the pin uses `assert.equal`, which is consistent but different from the other four files. Acceptable.

### Assessment
**Task quality:** Needs fixes
**Reasoning:** The git `fatal:` stderr pins are environment-fragile.

STATUS: DONE
=== needs-fixes-minor-only (2026-11-11T005324-spec-5153, a79ac9fe8b6969207) ===
### Issues
#### Critical (Must Fix)
None.

#### Important (Should Fix)
None.

#### Minor (Nice to Have)
- **M1. A failed GraphQL call whose body has an empty `nodes` reads as "no requirement".** Location: lib `ready-run.js:118-132` (`readReadyEvent`).
  - Fix: `if (nodes.length === 0) return cause ? { failed: cause } : null;`
- **M2. A missing or non-numeric `total_count` skips the truncation check.** Location: lib `:190`.
- **M3. The `docs/plugin-structure.md:47` row overstates the fail-closed rule.**

### Assessment
**Task quality:** Needs fixes

**Reasoning:** Three Minor gaps must still be fixed in this build under the rules.

STATUS: DONE
=== approved-unbolded (2026-11-17T080323-spec-5844, a9e2bc290a8eec12d) ===
### Issues
#### Critical (Must Fix)
None.

#### Important (Should Fix)
None.

#### Minor (Nice to Have)
- `tools/count-node-procs-fixture/sample.test.js:73`: `git --version` verifies the git-not-counted property but touches no repo state.

### Assessment
Task quality: Approved
Reasoning: The diff meets the in-scope deliverables with exact, non-loosened assertions.

STATUS: DONE
=== fix-round-no-verdict (2026-11-17T204803-spec-5881-5882-5883, a6d65e74747f887be) ===
### New Breakage in the Fix Diff
None. The diff adds four lines to the test file (`marker.test.js:126-129`) and changes no code.

### Verdict
**Fix round:** All findings are addressed, and the fix adds no new Critical or Important breakage.

STATUS: DONE
```

`tests/fixtures/pipeline-cost-report/reviews/plan-reviews.txt`:

```text
=== rows-with-overflow (2026-11-16T100700-record-4621, a76000107c0607668) ===
| Severity | Class | Resolution | Path:Line | Finding | Evidence | Suggested resolution |
|---|---|---|---|---|---|---|
| high | spec gap | needs-human | docs/superpowers/plans/2026-11-16-upstream-filing-ownership.md:32 | Cloud and Routine sandboxes use the proxy origin, so the plan reads it as `owner-unresolved`. | `repo-resolve.js:167` names this proxy shape as one that does not parse. | Reading A: keep AC7 as written. / Reading B: read the proxy's path as github.com `owner/repo`. |
| high | cross-task contract | — | docs/superpowers/plans/2026-11-16-upstream-filing-ownership.md:178 | AC4 needs a `decisions.md` entry naming the issue created. Only `--filed {url}` (Task 4) writes that line. | Task 5 (plan:178) "below unattended". | Task 5's review-console.md edit: call `--filed {url}` after every owned filing. |
| medium | missing-review-risk | — | docs/superpowers/plans/2026-11-16-upstream-filing-ownership.md:148 | Task 4 touches shared mutable state and decision logic without `Review risk: high`. | No `**Review risk:** high` line. | Add `**Review risk:** high` to Task 4. |
| info | — | — | — | +2 more | — | — |

STATUS: DONE
=== undecided-behaviour (2026-11-19T073112-spec-5902, af08f158fffb59c29) ===
| Severity | Class | Resolution | Path:Line | Finding | Evidence | Suggested resolution |
|---|---|---|---|---|---|---|
| medium | undecided behaviour | — | docs/superpowers/plans/2026-11-19-station-events.md:91 | The merge-station mapping produces an incoherent visit. | `merge.js` emits `merge-call` with status `ok` on non-merges. | Map `merge-call` by its outcome, not its status. |

STATUS: DONE
=== no-findings (2026-11-15T231106-spec-5550-5551, a7f7c2602ff84ba3d) ===
No findings.

STATUS: DONE
```

`tests/fixtures/pipeline-cost-report/reviews/lens-reports.txt`:

```text
=== table (2026-11-19T073235-adhoc-standalone, a14c6815468a1c781) ===
The table is below. Lens 3a found three convention issues, all in the new run-manifest code.

| Severity | Path:Line | Finding | Evidence |
|---|---|---|---|
| medium | plugin/bin/lib/run-manifest/write.js:27 | `CEREMONY_PROFILES` re-declares the `['fast-lane','standard']` vocabulary a sixth time instead of importing one source. | Same literal at issues/record-vocabulary.js:17. |
| low | plugin/bin/lib/run-manifest/write.js:36 | The model-stance list is inlined in the fill validator, duplicating a constant that already exists. | model-profiles/profiles.js:32 `STANCES`. |
| low | plugin/bin/set-config.js:92 | `hasEveryManifestoLever` re-implements the every-Manifesto-lever loop already in the same file. | Line 92 in `isManifestoAutoBatch`. |

STATUS: DONE
=== no-findings (2026-11-19T073235-adhoc-standalone, ab10320041063da8c) ===
No findings.

STATUS: DONE
=== no-findings-then-prose (2026-11-15T162121-spec-5304-5305-5306-5307-5309-5310-5311-5312-5313-5314-5315-5316-5317-5409, ad01fce4bebe28d91) ===
No findings on the error-handling lens.

- **Empty branch:** `queue-pull.js:777-793` resolves the branch from the policy key. Nothing is excluded by mistake, so the pass fails open, which the record asks for.
- **Probe failures:** a failed `git cat-file` probe still counts as missing, but only when a branch exists.

STATUS: DONE
=== prose-then-no-findings (2026-11-17T181851-spec-5872, ae8846f082762753b) ===
All namespaces and file names are string constants, so nothing untrusted reaches the batch stdin.

No findings.

STATUS: DONE
```

Tests in `tests/pipeline-cost-report/reviews.test.js` (header and `DIR`/`fresh` helpers in `guards.test.js`'s style):
  - `parseTaskVerdict reads the bold, unbolded and trailing-clause verdicts`: `needs-fixes-important` → `'needs-fixes'`; `needs-fixes-minor-only` → `'needs-fixes'`; `approved-unbolded` → `'approved'`; `'**Task quality:** Needs fixes (one cheap Important item).'` → `'needs-fixes'`; `'**Task quality:** Approved, with one recommended follow-up'` → `'approved'`.
  - `AC2.1: a task-review report with no verdict line is unparsed`: `parseTaskVerdict(sample('fix-round-no-verdict')) === null`; `parseTaskVerdict('API Error 403') === null`.
  - `the real needs-fixes reports' items`: `parseReviewCounts` (imported from `guards.js`) on `needs-fixes-important` is `{ critical: 0, important: 1, minor: 2 }`, on `needs-fixes-minor-only` `{ critical: 0, important: 0, minor: 3 }`.
  - `parsePlanReview reads the real table, kinds and overflow`: `rows-with-overflow` → `{ findings: 5, byKind: { 'cross-task contract': 1, 'undecided behaviour': 0, 'spec gap': 1, 'missing review risk': 1, other: 2 } }`; `undecided-behaviour` → findings 1, `byKind['undecided behaviour'] === 1`.
  - `parsePlanReview: a stated no-findings report is zero, an unstructured one is null`: `no-findings` → `{ findings: 0, byKind: { …all 0 } }`; `'Agent crashed: API Error 529'` → `null`.
  - `parsePlanReview buckets an unknown kind and normalises case and hyphens`: a table with rows of class `Mischaracterized-Role`, `Missing Review Risk`, `undecided behavior` → `other: 1`, `'missing review risk': 1`, `'undecided behaviour': 1`.
  - `parseLensReport counts rows by severity`: `table` → `{ critical: 0, high: 0, medium: 1, low: 2, info: 0, overflow: 0 }`.
  - `parseLensReport counts a "+N more" overflow row in overflow, never as a finding`: `'| Severity | Path:Line | Finding | Evidence |\n|---|---|---|---|\n| low | a.js:1 | x | y |\n| info | — | +3 more | — |'` → `{ low: 1, info: 0, overflow: 3 }`; `'| Severity | Path:Line | Finding | Evidence |\n|---|---|---|---|\n| medium | a.js:1 | x | y |\n| +2 more | | | |'` → `{ medium: 1, overflow: 2 }`.
  - `AC9.1: a lens report opening "No findings" and continuing in prose with no row is no-finding`: `no-findings-then-prose` and `prose-then-no-findings` and `no-findings` each give all zeros (not null).
  - `parseLensReport: rows win over a "No findings" opening; no structure is null`: `'No findings in scope.\n\n| Severity | Path:Line | Finding | Evidence |\n|---|---|---|---|\n| low | a.js:1 | x | y |'` → `low: 1`; `'Agent crashed'` → `null`.

- [ ] **Step 2: Run to verify it fails**

Run: `node tools/run-tests.js tests/pipeline-cost-report/reviews.test.js`
Expected: FAIL with `Cannot find module` for `tools/pipeline-cost-report/reviews.js`.

- [ ] **Step 3: Implement the three parsers in `tools/pipeline-cost-report/reviews.js`.** Header comment in `runs.js`/`guards.js` style that lists every format the module parses, each with the real excerpt the build observed: the task-review verdict (`**Task quality:** Needs fixes`, also unbolded `Task quality: Approved`) and its `#### Critical (Must Fix)` / `#### Important (Should Fix)` / `#### Minor (Nice to Have)` items; the plan-review table header, the `missing-review-risk` spelling, the `| info | — | — | — | +2 more | — | — |` overflow row and `No findings.`; the lens table header `| Severity | Path:Line | Finding | Evidence |` and the `No findings on the error-handling lens.` opening; the decisions.md lines read in Tasks 2-4 (their excerpts are in those tasks); and the multi-spec member `timing.json` stub `{"dispatches":{"notFound":"no transcript resolved"}}` (Build-time finding 5). Verdict regex: `/^\s*(?:\*\*)?Task quality:?(?:\*\*)?:?\s*(?:\*\*)?\s*(Approved|Needs fixes)\b/im`. Table cells: split a `|`-row on `|`, drop the first and last pieces, trim, remove `*` and `` ` ``. A plan-review table starts at a row whose first cell is `Severity` (case-insensitive) and the Class column is found by header name; a lens finding row is any `|`-row whose first cell is a severity word and none of whose cells matches the overflow pattern `/^\+(\d+) more\b/`; a row with such a cell adds its N to `overflow`. No-findings test: `/^[\s*_`>#-]*No findings?\b/im`.

- [ ] **Step 4: Run to verify it passes**

Run: `node tools/run-tests.js tests/pipeline-cost-report/reviews.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/pipeline-cost-report/reviews.js tests/pipeline-cost-report/reviews.test.js tests/fixtures/pipeline-cost-report/reviews
git commit -m "Add the review report parsers to the cost report — refs #5925"
```

### Task 2: Run walk, task review, plan review and human stops

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `tools/pipeline-cost-report/reviews.js`
- Modify: `tools/pipeline-cost-report/guards.js` (add `resolveRun` to `module.exports`; no other change)
- Test: `tests/pipeline-cost-report/reviews.test.js`

**Interfaces:**
- Consumes: Task 1's parsers; `guards.js` `resolveRun(run, fsImpl)`, `readTiming(dir, fsImpl)`, `readReport({ roots, sessions, agentId }, fsImpl)`, `parseReviewCounts(text)`; `archive.js` `readRun(dir, deps)`.
- Produces:
  - `walkRuns(runs, { since, until, fsImpl }) -> Walked[]`, `Walked = { run, items: Dispatch[], sessions: string[], timing: 'ok' | 'missing' | 'unparsed', units: [{ name, dir }] }`: runs dated `since..until` (a null `since` has no lower bound, for the yield walk), each through `resolveRun`, sorted by date then name; `Walked.run` is `resolveRun`'s result, so every later reader of `walked.run.dir` (Task 3's `readCost`, Task 4's yield) reads the archived copy of a top-level stub. When the resolved run is still a top-level directory with no `decisions.md` and `archive/{name}` exists with a `decisions.md` (an archived copy with no `timing.json`, which `resolveRun` leaves unresolved, as for `2026-11-16T092428-record-5694`), `walkRuns` builds the units, and the members, from `archive/{name}` instead; `timing` stays as read; `items` dropped of any `agentId` seen in an earlier run of the same walk (or earlier in the same file); `readTiming` returning null sets `timing: 'missing'` and a throw `timing: 'unparsed'`, both with empty items and sessions, and the run is kept either way; `units` are the members (`${run.name}/spec-${id}`) or `[{ name: run.name, dir: run.dir }]`.
  - `readVerdicts(unit, fsImpl) -> { name, excluded, text, confirmed, refuted, cantTell }`: `readRun(unit.dir, { fs: fsImpl, git: () => { throw new Error('reviews reads no git'); } })`; `excluded` is `readRun`'s (`no-decisions`, `decisions-unreadable`, `no-review`, or null); `text` is the decisions.md text or null when unreadable; `confirmed` is `[{ lens, path, line, how: 'pair' | 'tiebreak' }]` (`pairConfirmed`, then `verdicts` with `verdict === 'confirmed'`); `refuted` and `cantTell` are the matching `verdicts`. All three are empty when `excluded`.
  - `isHumanStop(line) -> boolean`.
  - `collectTaskReview(walked, { roots, fsImpl }) -> { byTier: { [tier]: { n, unparsed, approved, needsFixes, items: { critical, important, minor, n, unparsed }, minorOnly: { count, of, share } } }, reReviews: { n, byTier: { [tier]: number } } }`. A missing `tier` is `unknown`.
  - `collectPlanReview(walked, verdictsByRun, { roots, fsImpl }) -> { reviews, n, unparsed, withFindings, findingsPerReview, byKind, humanStops: { runs, n, unparsed } }` (`reviews === n`, the parsed reports).
  - `collectReviews({ runs, since, until, n, roots }, { fsImpl }) -> { window: { since, until, runs, units, noTiming, timingUnparsed }, taskReview, planReview }` (Tasks 3-4 add `lens`). It walks the window once and computes `verdictsByRun = walked.map((w) => w.units.map((u) => readVerdicts(u, fsImpl)))` once, for every window collector; `noTiming` and `timingUnparsed` count the window's runs with `timing` `'missing'` and `'unparsed'`. Task 4 adds the separate yield walk.

- [ ] **Step 1: Write the failing tests.** Fixture helpers in the test file: `writeRun(pipelines, name, { items, sessions }, projects)` and `writeReport(projects, session, agentId, text)` as in `guards.test.js` (report files under `slug-sub`); `item(agentId, role, tier, description)`; `runObj(pipelines, name)` building `{ name, date, dir, archived: false, members }` (members from any `spec-{N}` subdirectories). Tests:
  - `AC1.1: four capable task reviews, three needing fixes, one Minor-only`. One run, four `task review` dispatches on `capable`: reports `approved-unbolded`, `needs-fixes-important`, `needs-fixes-minor-only`, and `needs-fixes-important` again. Expect `byTier.capable` `n === 4`, `needsFixes === 0.75`, `approved === 0.25`, `minorOnly` `{ count: 1, of: 3, share: 1/3 }`, `items` `{ critical: 0, important: 2, minor: 7, n: 3, unparsed: 0 }`.
  - `AC2.1: a report with no verdict line is in neither share`. The AC1.1 run plus a fifth `task review` whose report is `fix-round-no-verdict`, and a sixth with no transcript: `n === 4`, `unparsed === 2`, `needsFixes === 0.75`.
  - `re-reviews are counted beside the table, not in it`: two `re-review` dispatches (`capable`, `standard`) give `reReviews` `{ n: 2, byTier: { capable: 1, standard: 1 } }` and leave `byTier` unchanged.
  - `AC3.1: two plan reviews, three finding rows and none, give 50% and 1.5`. Reports: a table with three severity rows (no overflow) and `no-findings`. Expect `reviews === 2`, `withFindings === 0.5`, `findingsPerReview === 1.5`, `unparsed === 0`.
  - `human stops: the two real forms count, a settled gap does not`. `isHumanStop` is true for `- KEPT-PROMPT 08:28:18 — Common Step 1.6 (plan review): plan review: 2 needs-human spec gap(s) asked inline. Reversibility: n/a.`, for `- REFUSED 00:38:24 — Common Step 1.6 (plan review): plan review: 1 needs-human spec gap (AC1 baseline comparability) — dispatched call cannot ask; question posted as issuecomment-6903297698; HARD-GATE plan-review-needs-human; 5 plan-amendment rows and 1 low row not applied. Reversibility: n/a.` and for `- AUTO 23:02:28 — Common Step 1.6 (plan review): plan review returned 6 rows (1 needs-human spec gap). First round, no AskUserQuestion in this subagent session, so the needs-human gate took the dispatched-call branch: question posted on the record. Reversibility: n/a.`; false for `- AUTO 03:03:43 — Common Step 1.6 (plan review): amended spec and plan for 4 finding(s) (1 needs-human spec gap settled in a converged round; 2 cross-task contract; 1 undecided behaviour); commit 625421378. Reversibility: high.` and for `- AUTO 00:32:10 — Section E: released claim on #5540 (failed: plan-review-needs-human). Reversibility: high.` Through `collectPlanReview`: three units, one with a KEPT-PROMPT line, one with only the settled line, one with no decisions.md → `humanStops` `{ runs: 1, n: 2, unparsed: 1 }`.
  - `AC7.1: a run at the top level and under archive/ is counted once`. `{pipelines}/2026-11-18T1-spec-1/timing.json` lists task review `t1`; `{pipelines}/archive/2026-11-18T1-spec-1/timing.json` lists task review `t2`; both reports exist. `collectReviews({ runs: listRuns(pipelines).runs, … })` gives `taskReview.byTier.capable.n === 1` and `window.runs === 1`.
  - `a top-level stub reads its archived copy`. The top-level `2026-11-18T2-spec-2` holds only `work/`; `archive/2026-11-18T2-spec-2/timing.json` lists one task review → `n === 1`.
  - `a stub whose archived copy has decisions but no timing.json reads its decisions from the archive`. The top-level `2026-11-16T1-record-7` holds only `work/`; `archive/2026-11-16T1-record-7/` holds a `decisions.md` with the KEPT-PROMPT human-stop line and no `timing.json` → `window.noTiming === 1`, `planReview.humanStops` `{ runs: 1, n: 1, unparsed: 0 }`.
  - `an agentId listed by two runs counts once`. Runs `2026-11-18T1-a` and `2026-11-18T2-b` both list task review `dup` → `n === 1`.
  - `a multi-spec run's dispatches are read once from the parent`. Parent `timing.json` lists two task reviews; members `spec-1` and `spec-2` each hold the real stub `{"dispatches":{"notFound":"no transcript resolved"},"transcripts":[]}` → `n === 2`, `window.units === 2`, `window.timingUnparsed === 0`.
  - `a run with no timing.json is counted, not dropped`. Run `2026-11-18T1-spec-1` has a `timing.json` with one task review; run `2026-11-18T2-spec-2` holds only a `decisions.md` with the KEPT-PROMPT human-stop line; run `2026-11-18T3-spec-3` holds a `timing.json` reading `{` → `window` `{ runs: 3, units: 3, noTiming: 1, timingUnparsed: 1 }`, `taskReview.byTier.capable.n === 1`, and `planReview.humanStops.runs === 1` (the timing-less run's decisions are still read).
  - `--since/--until bound the runs read`. Runs dated `2026-11-16`, `2026-11-17`, `2026-11-19`, window `2026-11-17..2026-11-18` → only the 17th's task review is counted.

- [ ] **Step 2: Run to verify it fails**

Run: `node tools/run-tests.js tests/pipeline-cost-report/reviews.test.js`
Expected: FAIL with `collectTaskReview is not a function` (and `resolveRun` undefined from `guards.js`).

- [ ] **Step 3: Implement.** Export `resolveRun` from `guards.js`. Human-stop patterns, both tested against a line: `/^- KEPT-PROMPT\b.*\bCommon Step 1\.6\b.*\bneeds-human\b/` and `/^- [A-Z][A-Z-]*\b.*\bCommon Step 1\.6\b.*\bneeds-human\b.*(?:HARD-GATE|question (?:comment )?posted)/`. A unit counts toward `humanStops.n` when its `text` is non-null, and toward `runs` when any line matches; a null `text` is `unparsed`. Add the two decisions.md stop excerpts to the header comment.

- [ ] **Step 4: Run to verify it passes**

Run: `node tools/run-tests.js tests/pipeline-cost-report/reviews.test.js tests/pipeline-cost-report/guards.test.js`
Expected: PASS (reviews 22 tests; guards unchanged and green).

- [ ] **Step 5: Commit**

```bash
git add tools/pipeline-cost-report/reviews.js tools/pipeline-cost-report/guards.js tests/pipeline-cost-report/reviews.test.js
git commit -m "Add the task-review and plan-review figures to the cost report — refs #5925"
```

### Task 3: Lens agents by tier and lens, and per-run verdicts

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `tools/pipeline-cost-report/reviews.js`
- Modify: `tools/review-replay/archive.js` (add `readCost` to `module.exports`; no other change)
- Create: `tests/fixtures/pipeline-cost-report/reviews/decisions.md`
- Test: `tests/pipeline-cost-report/reviews.test.js`

**Interfaces:**
- Consumes: Task 2's `walkRuns`, `readVerdicts`, `collectReviews`; `archive.js` `readCost(deps, dir) -> { lensAgents: [{ agentId, lens, side }] , cost } | null`.
- Produces:
  - `lensAgentsOf(walked, fsImpl) -> [{ agentId, lens, side, tier }]`: `readCost({ fs: fsImpl }, walked.run.dir)`'s `lensAgents`; one with an `agentId` is kept only when that `agentId` is in `walked.items` (so Task 2's dedupe holds), `tier` from that item (`unknown` when absent); one whose `agentId` is null is kept, `tier` from the item with the same `description` (`unknown` when none); `[]` when `readCost` returns null.
  - `collectLensAgents(walked, { roots, fsImpl }) -> { byTier, byLens }`, each `{ [key]: { agents, n, unparsed, noFinding, perAgent: { total, critical, high, medium, low, info, overflow } } }`: `agents` counts every lens agent, `n` the parsed ones (a null-`agentId` agent is always unparsed), `noFinding` the share of parsed with all zeros, `perAgent` the mean per parsed agent of each severity's rows, of `overflow`, and of `total` (the severities plus `overflow`), null when `n === 0`.
  - `collectPerRun(walked, verdictsByRun) -> { rows: [{ run, confirmed, pair, tiebreak, refuted, cantTell, byLens: { [lens]: { confirmed, pair, tiebreak, refuted, cantTell } } }], totals: { confirmed, pair, tiebreak, refuted, cantTell }, byLens, n, unparsed }`: one row per readable unit (`excluded === null`), `run` is the unit name; an excluded unit counts in `unparsed`.
  - `collectReviews` adds `lens: { byTier, byLens, perRun }`.

- [ ] **Step 1: Write the fixture and the failing tests.** `tests/fixtures/pipeline-cost-report/reviews/decisions.md`, trimmed from `archive/2026-11-17T204803-spec-5881-5882-5883/spec-5882/decisions.md`:

```text
- AUTO 16:08:28 — Reproduction: lens "3a" finding plugin/skills/release/disposition.md:71 reproduced. Confirmed. Reversibility: high.
- AUTO 16:08:28 — Reproduction: lens "3b" finding plugin/skills/release/disposition.md:71 reproduced. Confirmed. Reversibility: high.
- AUTO 16:08:28 — Reproduction: lens "3f" finding plugin/bin/release-block.js:181 reproduced. Confirmed. Reversibility: high.
- STAGED 16:08:35 — Reproduction: lens "3a" finding plugin/skills/_shared/release-block.md:3 not reproduced. Staged to Review Console as low-confidence. Reversibility: high.
- AUTO 16:14:12 — Tiebreak tiebreak:39ef8ab99aa3: lens "3g" finding plugin/bin/release-block.js:162 digested: evidence-unverified. Severity: info. Reversibility: high.
- AUTO 16:17:17 — Reproduction: lens "3a" finding plugin/skills/_shared/release-block.md:3 confirmed by tiebreak:2a37952f7854. Confirmed. Reversibility: high.
- AUTO 16:17:17 — Tiebreak tiebreak:4e1515328d51: lens "3a" finding plugin/bin/release-block.js:198 dropped: refuted by tiebreak. Evidence: plugin/bin/release-block.js:198 " return unreadable(deps, `could not read`);". Severity: low. Reversibility: high.
- AUTO 16:17:21 — Reproduction: lens "3f" finding tests/release-block-cli.test.js:413 confirmed by tiebreak:c125a0a31cf5. Confirmed. Reversibility: high.
- AUTO 16:20:58 — Step 3 Routing: applied medium-severity security fix at plugin/skills/release/disposition.md:71. Reversibility: high (commit e4ce36e0c).
- AUTO 16:21:01 — Step 3 Routing: applied low-severity test-quality fix at plugin/bin/release-block.js:181. Reversibility: high (commit e4ce36e0c).
- STAGED 16:21:21 — Step 3 Routing: medium-severity architecture finding at plugin/skills/_shared/release-block.md:3 (lens 3a, tiebreak-confirmed): the release-block check is keyed on Step 1's engine or work-backend. Stage path: staged/build-deviation-1.md. Reversibility: high.
```

Tests (lens agents use descriptions `Lens 3a convention A`, `Lens 3a convention B`, `Lens 3b security A`, `Lens 3b security B`, role `lens reviewer`):
  - `AC4.1: per-lens no-finding share and findings per agent`. One run: `3a` A (`fast`) reports `| Severity | Path:Line | Finding | Evidence |` with two `low` rows, `3a` B (`fast`) reports `No findings.`, both `3b` (`standard`) report `No findings.`. Expect `byLens['3a']` `{ agents: 2, n: 2, unparsed: 0, noFinding: 0.5, perAgent.total: 1 }` and `byLens['3b']` `{ noFinding: 1, perAgent.total: 0 }`; `byTier.fast.perAgent.low === 1`.
  - `AC9.2: a lens reviewer whose transcript is missing is unparsed and in neither part of the share`. Add `Lens 3a convention C` with no report: `byLens['3a']` `{ agents: 3, n: 2, unparsed: 1, noFinding: 0.5 }`.
  - `AC9.1: a "No findings" opening followed by prose counts as no-finding for its agent`. A `3c` agent whose report is `lens-reports.txt`'s `no-findings-then-prose` → `byLens['3c'].noFinding === 1`, `unparsed === 0`.
  - `the real decisions excerpt: confirmed, pair, tiebreak, refuted and can't-tell`. One unit holding the fixture `decisions.md` → row `{ confirmed: 5, pair: 3, tiebreak: 2, refuted: 1, cantTell: 1 }`, `byLens['3a']` `{ confirmed: 2, pair: 1, tiebreak: 1, refuted: 1, cantTell: 0 }`, `byLens['3g'].cantTell === 1`.
  - `AC5.1: one pair-confirmed, one tiebreak-confirmed, one refuted`. A unit whose decisions.md is the fixture's first line, its `confirmed by tiebreak:2a37952f7854` line and its `refuted by tiebreak` line → row `{ confirmed: 2, pair: 1, tiebreak: 1, refuted: 1, cantTell: 0 }`.
  - `AC8.1: two spec members count two runs and none from the parent`. Parent `2026-11-18T1-spec-1-2` holds a full `timing.json` and a decisions.md with the fixture's 3b `reproduced` line; members `spec-1` and `spec-2` each hold the timing stub, a `review-findings.json` of `[]` and a decisions.md with one `reproduced` line (3a, 3f). Expect `perRun.n === 2`, row names `['2026-11-18T1-spec-1-2/spec-1', '2026-11-18T1-spec-1-2/spec-2']`, `totals.confirmed === 2`, `byLens['3b']` absent.
  - `a unit with no review lines is unparsed for the verdict figures, never zero`. A unit whose decisions.md holds only `- AUTO 10:00:00 — Step 1: started. Reversibility: n/a.` and one with no decisions.md → `perRun` `{ n: 0, unparsed: 2, rows: [] }`.
  - `lens agents come from the parent of a multi-spec run and honour the dedupe`. The AC8.1 parent lists two lens agents and a run listed earlier holds one of them → `byLens` counts one agent.
  - `a top-level stub's lens agents are read from its archived copy`. Task 2's stub fixture with `archive/2026-11-18T2-spec-2/timing.json` also listing a `Lens 3a convention A` agent whose report is `No findings.` → `byLens['3a']` `{ agents: 1, n: 1, noFinding: 1 }`.
  - `a lens dispatch with no agentId is kept and unparsed`. A `Lens 3b security A` item with no `agentId` on `standard` → `byLens['3b']` `{ agents: 1, n: 0, unparsed: 1 }`, `byTier.standard.agents === 1`.

- [ ] **Step 2: Run to verify it fails**

Run: `node tools/run-tests.js tests/pipeline-cost-report/reviews.test.js`
Expected: FAIL with `collectLensAgents is not a function`.

- [ ] **Step 3: Implement.** Export `readCost` from `archive.js`. Lens identity is `readCost`'s (archive.js `LENS_RE`, `/^(?:Review )?[Ll]ens (3[a-j])/`), never a second regex in `reviews.js`. Add the two decisions.md verdict excerpts (a `reproduced` line and a `confirmed by tiebreak:` line) to the header comment.

- [ ] **Step 4: Run to verify it passes**

Run: `node tools/run-tests.js tests/pipeline-cost-report/reviews.test.js tests/review-replay/baseline.test.js`
Expected: PASS (reviews 32 tests; the review-replay suite unchanged and green).

- [ ] **Step 5: Commit**

```bash
git add tools/pipeline-cost-report/reviews.js tools/review-replay/archive.js tests/pipeline-cost-report/reviews.test.js tests/fixtures/pipeline-cost-report/reviews/decisions.md
git commit -m "Add the lens agent and verdict figures to the cost report — refs #5925"
```

### Task 4: Lens outcomes and the per-lens yield

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `tools/pipeline-cost-report/reviews.js`
- Test: `tests/pipeline-cost-report/reviews.test.js`

**Interfaces:**
- Consumes: Task 3's `lensAgentsOf`, Task 2's `walkRuns`/`readVerdicts`.
- Produces:
  - `classifyRouting(line) -> 'fixed' | 'staged' | 'deferred' | 'dismissed' | null`.
  - `collectOutcomes(verdictsByRun) -> { fixed, dismissed, staged, deferred, counts: { fixed, dismissed, staged, deferred }, unrouted, n, unparsed, allRouted: { fixed, dismissed, staged, deferred, counts, n } }`: the top-level shares are over `n` (routed confirmed locations), null when `n === 0`; `allRouted` holds the same four shares over every distinct `path:line` of a readable unit that has a classified line, confirmed or not (refuted ones included), null when its `n === 0`; `unparsed` counts excluded units.
  - `collectYield(yieldWalked, { n, fsImpl }) -> { runs: n, byLens: { [lens]: { runs, agents, confirmed, rate, unparsed } } }`, `yieldWalked` being `walkRuns(runs, { since: null, until, fsImpl })`; verdicts are read with `readVerdicts` only for the runs the walk reaches, once per unit.
  - `collectReviews` adds `lens.outcomes` (from the window's `verdictsByRun`) and `lens.yield` (from the yield walk).

- [ ] **Step 1: Write the failing tests.**
  - `classifyRouting reads the four real classes`: `fixed` for `- AUTO 16:20:58 — Step 3 Routing: applied medium-severity security fix at plugin/skills/release/disposition.md:71. Reversibility: high (commit e4ce36e0c).`; `staged` for the fixture's `STAGED 16:21:21` line; `deferred` for `- AUTO 23:31:55 — Step 3 Routing: materiality-floor: Test quality at tests/bin-lib/wrap-up/engine-cli.test.js:707 routed below floor (tiebreak-cant-tell) → digest. Reversibility: high.`; `dismissed` for `- AUTO 07:05:57 — Step 3 Routing: Don't fix (refuted by tiebreak): low Architecture at plugin/bin/lib/hooks/worktree-reap.js:91 — three existing tests already fail on a quiet-set rename. Reversibility: high.`; `null` for `- AUTO 18:09:05 — Review Console: Console item review-contested-1.md (Contested findings): dismissed — superseded. Reversibility: n/a.` and for the fixture's `STAGED 16:08:35 … not reproduced` line.
  - `AC10.1: one fixed, one staged and one unrouted location print 50%, 50% and one unrouted`. A unit with three confirmed locations (fixture lines: 3f `release-block.js:181` reproduced, 3a `release-block.md:3` confirmed by tiebreak, 3f `release-block-cli.test.js:413` confirmed by tiebreak) and the fixture's `16:21:01` applied line and `16:21:21` STAGED line → `{ fixed: 0.5, staged: 0.5, dismissed: 0, deferred: 0, unrouted: 1, n: 2 }`, and `allRouted` `{ fixed: 0.5, staged: 0.5, dismissed: 0, deferred: 0, n: 2 }`.
  - `the real decisions excerpt's outcomes`: the whole fixture → counts `{ fixed: 2, staged: 1, deferred: 0, dismissed: 0 }`, `unrouted: 1`; the location confirmed by two lenses (`disposition.md:71`) counts once.
  - `allRouted divides by every routed location, refuted ones included`: the whole fixture → `allRouted.counts` `{ fixed: 2, staged: 1, deferred: 0, dismissed: 1 }`, `allRouted.n === 4`, `allRouted.dismissed === 0.25` (the refuted `release-block.js:198` is dismissed there and absent from the confirmed split).
  - `a location's first class by precedence wins`: one location with a `Don't fix` line and a later `applied … fix at` line → `fixed`.
  - `AC6.1: --runs 2 uses the two latest runs in which the lens ran`. Runs `2026-11-16T1-spec-1` (two `3a` agents, decisions with four 3a confirmations), `2026-11-17T1-spec-2` (two agents, one), `2026-11-18T1-spec-3` (two agents, two); `collectYield(walkRuns(runs, { since: null, until: '2026-11-18' }), { n: 2 })` → `byLens['3a']` `{ runs: 2, agents: 4, confirmed: 3, rate: 0.75, unparsed: 0 }` (all three runs would give 7/6, the earliest two 1.25).
  - `the yield ignores --since and stops at --until`: the AC6.1 runs plus `2026-11-20T1-spec-9` (two `3a` agents, five confirmations); `collectReviews({ since: '2026-11-18', until: '2026-11-18', n: 2, … })` → `lens.yield.byLens['3a']` `{ runs: 2, agents: 4, confirmed: 3, rate: 0.75 }` (the 17th counts though it is before `--since`; the 20th is after `--until`), while `lens.perRun.n === 1` (the window figures still honour `--since`).
  - `an unreadable run takes no yield slot and counts unparsed`: add `2026-11-19T1-spec-4` with two `3a` agents and a decisions.md with no review lines → `byLens['3a']` unchanged figures with `unparsed: 1`.
  - `a run with no timing.json counts unparsed for a lens it shows ran, and is passed over for one it does not`: the AC6.1 runs, each also listing one `Lens 3b security A` agent, plus `2026-11-19T2-spec-5` with no `timing.json` and a decisions.md holding one `Reproduction: lens "3a" finding a.js:1 reproduced. Confirmed.` line → `byLens['3a']` `{ runs: 2, agents: 4, confirmed: 3, unparsed: 1 }` and `byLens['3b'].unparsed === 0`.
  - `a multi-spec run is one yield slot, readable only when every member is`: a parent with two `3a` agents and members holding one and two 3a confirmations → `{ runs: 1, agents: 2, confirmed: 3 }`; with one member's decisions.md removed → `{ runs: 0, unparsed: 1, rate: null }`.
  - `a lens with no agents is absent; an empty window gives an empty byLens`: a readable run with no `3b` agent adds no `byLens['3b']`; `collectYield([], { n: 20 })` gives `{ runs: 20, byLens: {} }`.

- [ ] **Step 2: Run to verify it fails**

Run: `node tools/run-tests.js tests/pipeline-cost-report/reviews.test.js`
Expected: FAIL with `classifyRouting is not a function`.

- [ ] **Step 3: Implement.** Classes, tested in this order on each decisions.md line (the record's measurement script, `routing.js`, attached to #5925):
  - `fixed`: `/Step 3 Routing: applied .*fix at/i`
  - `staged`: `/^- STAGED .*Step 3 Routing: .*finding/i`
  - a line matching `/Console item/` is `null`
  - `deferred`: `/→ digest|routed to digest|materiality-floor|routed below floor/i`
  - `dismissed`: `/dropped: refuted by tiebreak|→ declined|Don't fix|not fixed/i`

  A classified line belongs to the first `/([\w./@-]+\.[\w]+):(\d+)/` match on it; a location's outcome is its highest class in the order fixed, staged, deferred, dismissed. Confirmed locations are the distinct `${path}:${line}` of a unit's `confirmed`; one with no classified line is `unrouted`. `allRouted` takes every distinct location of a readable unit with a classified line, by the same precedence. Yield: walk the yield walk (every listed run dated on or before `--until`, `--since` ignored) newest first (date, then name, descending); for each lens a run is a candidate when it has at least one lens agent for it (`lensAgentsOf`); a candidate whose units are all readable takes a slot (agents += its agents for the lens, confirmed += its units' confirmed for the lens) until `n` slots are filled; an unreadable candidate before that adds 1 to `unparsed`. A run whose `timing` is `'missing'` or `'unparsed'`, reached while a lens's slots are open, adds 1 to that lens's `unparsed` when one of its readable units records a confirmed, refuted or can't-tell verdict for the lens, and is otherwise passed over. Add the four routing excerpts to the header comment.

- [ ] **Step 4: Run to verify it passes**

Run: `node tools/run-tests.js tests/pipeline-cost-report/reviews.test.js`
Expected: PASS, 43 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/pipeline-cost-report/reviews.js tests/pipeline-cost-report/reviews.test.js
git commit -m "Add the lens outcome and yield figures to the cost report — refs #5925"
```

### Task 5: The `reviews` section in the CLI

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `tools/pipeline-cost-report.js` (header comment, `SECTIONS`, `USAGE`)
- Modify: `tests/pipeline-cost-report/cli.test.js` (the two pins below)
- Modify: `docs/plugin-structure.md` (the two `pipeline-cost-report.js` entries, lines ~167 and ~285)
- Modify: `tools/pipeline-cost-report/reviews.js` (header comment final read)
- Test: `tests/pipeline-cost-report/reviews.test.js`

**Interfaces:**
- Consumes: `collectReviews` (Tasks 2-4), `ctx.runs` (`{ runs, … } | { error }`), `ctx.roots`, `ctx.since`, `ctx.until`, `ctx.opts.runs`, `ctx.deps.fs`.
- Produces: the `reviews` entry in `SECTIONS`, appended after `guards`: when `ctx.runs.error` is set, `collect` throws it under `--section reviews` (exit 1) and returns `{ error: ctx.runs.error }` under `--section all` (rendered `reviews: unavailable — …` by the shared `render`, exit code left alone — the user's plan-review decision); else it returns `collectReviews({ runs: ctx.runs.runs, since: ctx.since, until: ctx.until, n: ctx.opts.runs || DEFAULT_RUNS, roots: ctx.roots }, { fsImpl: ctx.deps.fs })`; `failed: () => false`; `unreadable: () => 0`.

Return-shape widening (plan-authoring check): the report gains a `reviews` key and the usage line a section. `git grep -n -F -e "records|guards|all" -e "Guards: not run" -- tests` (run 2026-11-19) prints three lines; `guards.test.js:756` is an `includes` check the new section leaves true, and the two pins that change are `cli.test.js:390` (`'--section spend|funnel|records|guards|all]'` becomes `'--section spend|funnel|records|guards|reviews|all]'`) and `cli.test.js:140` (the separation regex now expects `Guards: not run — --split <YYYY-MM-DD> not given\.\n\n## Reviews\n` and, separately, that the reviews section's last line is followed by `\n\nRuns: `). `guards.test.js`'s `--section all without --split marks guards not run and exits 0` runs the new section over its fixture and must stay green unchanged.

- [ ] **Step 1: Write the failing tests** in `reviews.test.js`, through `run({ argv, deps })` with `cli.test.js`'s harness shape (`--pipelines` and `--projects` temp dirs, fake `gh`, `--repo o/r`, `deps.git` returning a path):
  - `AC1.1 markdown: 75% needing fixes and 1 of 3 Minor only`. The Task 2 AC1.1 fixture, `--section reviews --since 2026-11-18 --until 2026-11-18`: a `### Task review` table row starting `| capable | 4 | 25% | 75% |` and containing `| 1 of 3 |`, and its Unparsed cell `0; items 0`.
  - `AC3.1 markdown`: the line `Reviews: 2; with a finding: 50%; findings per review: 1.50; unparsed: 0.`
  - `AC4.1 markdown`: `### Lens review by lens` rows starting `| 3a | 2 | 50% | 1.00 |` and `| 3b | 2 | 100% | 0.00 |`, each ending with its unparsed count `| 0 |`; the line `Each lens runs on one fixed model profile, so this table compares lenses, not models.` under `### Lens review by tier`.
  - `AC10.1 markdown`: the line `Of 2 routed confirmed locations: fixed 50%, dismissed 0%, staged 50%, deferred 0%; 1 unrouted (left out of the shares); 0 run units unparsed.` and, below it, `Of 2 routed locations, refuted ones included (the 2026-11-18 measurement's division): fixed 50%, dismissed 0%, staged 50%, deferred 0%.`
  - `AC6.1 --json: the 3a rate uses the two latest runs, whatever --since says`. The Task 4 AC6.1 fixture, `--section reviews --since 2026-11-18 --until 2026-11-18 --runs 2 --json` → `reviews.lens.yield` `{ runs: 2, byLens: { '3a': { runs: 2, agents: 4, confirmed: 3, rate: 0.75, unparsed: 0 } } }`; the markdown run prints `Up to 2 most recent runs per lens dated on or before 2026-11-18, whatever --since says.` and `A run with no recorded verdict line (a fully clean review included) takes no slot and is counted unparsed.`
  - `--json carries every figure under reviews with n and unparsed`. Keys: `reviews.window` (with `noTiming` and `timingUnparsed`), `reviews.taskReview.byTier`, `reviews.taskReview.reReviews`, `reviews.planReview.{reviews,n,unparsed,withFindings,findingsPerReview,byKind,humanStops}`, `reviews.lens.{byTier,byLens,perRun,outcomes,yield}`, `reviews.lens.outcomes.allRouted`; `reviews.lens.yield.byLens['3a']` has exactly the keys `runs, agents, confirmed, rate, unparsed`.
  - `the task-review and verdict notes print`: `The task-review tier follows the plan's review-risk flag, so the capable tier reviews the riskier tasks; the tiers are printed side by side, not compared.` and `"Confirmed" is the tiebreak judge's verdict or a pair's agreement, not ground truth.`
  - `a pipelines listing failure: --section reviews exits 1, --section all leaves the code alone`: no `--pipelines`, `deps.git` throwing. `--section reviews` → output holds `reviews: unavailable — cannot resolve the pipelines directory`, exit 1. `--section all --all-projects --json` with the same deps → `json.reviews.error` matches `/cannot resolve the pipelines directory/`, no other section key carries an `error`, and exit 0 (mirrors `cli.test.js`'s `a failed default --pipelines lookup prints Runs: unavailable and leaves the exit code alone`; if the harness's funnel or records stub makes another section fail here, fix the stub in this test, not the assertion).
  - `--section reviews is accepted; an unknown section lists it`: `--section bogus` exits 2 and the usage holds `--section spend|funnel|records|guards|reviews|all]`.

- [ ] **Step 2: Run to verify it fails**

Run: `node tools/run-tests.js tests/pipeline-cost-report/reviews.test.js`
Expected: FAIL with `--section must be one of spend|funnel|records|guards|all` (the CLI cases) and the Task 1-4 cases still green.

- [ ] **Step 3: Implement.**
  - `SECTIONS`: the `reviews` entry above. Markdown render, in order, each table with no rows printing `none.` instead:
    - `## Reviews`, then `{runs} runs dated {since} to {until} ({units} run units: a multi-spec run counts once per spec member for the verdict figures); {noTiming} without a timing.json, {timingUnparsed} with an unreadable one.`
    - `### Task review`, the tier note above, then `| Tier | Reviews | Approved | Needs fixes | Critical | Important | Minor | Minor only | Unparsed |`; Minor only is `{count} of {of}`, Unparsed `{unparsed}; items {items.unparsed}`. Then `Re-reviews (not in the table): {n} ({tier} {k}, …).`
    - `### Plan review`, `Reviews: {reviews}; with a finding: {pct}; findings per review: {x.xx}; unparsed: {u}.`, `Stopped to ask a human: {runs} of {n} run units; {u} unparsed.`, then `| Kind | Findings |` in the order of `PLAN_KINDS`, then `other`.
    - `### Lens review by tier` (the profile note) and `### Lens review by lens`, both `| {Tier or Lens} | Agents | No finding | Findings per agent | Critical | High | Medium | Low | Info | Overflow | Unparsed |` with per-agent means (Overflow is the mean `+N more` count); tiers ordered `fast, standard, capable, frontier`, then others by name; lenses by name.
    - `### Lens verdicts`, the confirmed note, `| Run | Confirmed | Both reviewers | Tiebreak | Refuted | Can't tell |`, then the same columns per lens, then `Run units read: {n}; unparsed: {u}.`
    - `### Lens outcomes`, the two outcomes lines above (a null share prints `none`).
    - `### Lens yield`, `Up to {runs} most recent runs per lens dated on or before {until}, whatever --since says.`, `A run with no recorded verdict line (a fully clean review included) takes no slot and is counted unparsed.`, `| Lens | Runs | Agents | Confirmed | Confirmed per agent | Unparsed |`.
  - `USAGE`, the header comment's usage line and Sections list (a `reviews` paragraph: what it reads, the multi-spec rule, `--runs` for the yield and its independence from `--since`), the header's Exit codes paragraph (a pipelines listing failure exits 1 under `--section reviews` only; under `--section all` it prints `reviews: unavailable —` and leaves the code alone, like `Runs: unavailable`), and the two `docs/plugin-structure.md` entries (add `reviews` to the `--section` list, one clause on what it prints, and `reviews.js` to the module list).
  - Update the two `cli.test.js` pins as described above.
  - Re-read the `reviews.js` header comment against Deliverable 9: every format it parses, each with one real excerpt, and the multi-spec stub.

- [ ] **Step 4: Run the focused suites**

Run: `node tools/run-tests.js tests/pipeline-cost-report/reviews.test.js tests/pipeline-cost-report/cli.test.js tests/pipeline-cost-report/guards.test.js`
Expected: PASS.

- [ ] **Step 5: Real-input probe and independent count.** From the worktree, against the main checkout's real runs and transcripts (the window ends 2026-11-18, so new runs cannot move it):

Run: `node tools/pipeline-cost-report.js --section reviews --since 2026-11-08 --until 2026-11-18 --runs 20 --json`
Expected: exit 0. An independent scratch count over the same runs with this plan's rules (2026-11-19, before the build) gave the figures below; quote the printed values beside them in your report and reconcile every difference before the whole-branch review (a difference means the reader or the count is wrong, or a transcript was deleted since; name which):
  - `taskReview.byTier.capable`: `n` 240, `unparsed` 14, 93 needing fixes (`needsFixes` ≈ 0.3875), `items` `n` 90 / `unparsed` 3, `minorOnly` 2 of 90; `standard`: `n` 206, `unparsed` 6, 27 needing fixes, `minorOnly` 0 of 25. `reReviews.byTier`: capable 286, standard 147, fast 22.
  - `planReview`: `reviews` 101, `unparsed` 5, 100 with a finding, 565 findings, `byKind` cross-task contract 181, undecided behaviour 128, spec gap 114, missing review risk 86, other 56; `humanStops` `{ runs: 94, n: 458, unparsed: 5 }`.
  - `lens.byTier`: fast `agents` 458, `unparsed` 16, 84 of 442 no-finding, 1,076 rows; standard `agents` 782, `unparsed` 22, 427 of 760 no-finding, 652 rows. `lens.byLens['3a']`: `agents` 232, `unparsed` 8, 47 no-finding.
  - `lens.perRun`: `n` 143, `unparsed` 320, totals pair 309, tiebreak 1,258, refuted 285, can't-tell 80; the row `2026-11-17T204803-spec-5881-5882-5883/spec-5882` is `{ confirmed: 14, pair: 4, tiebreak: 10, refuted: 4, cantTell: 2 }` (read by hand from that member's decisions.md).
  - `lens.outcomes.counts`: fixed 660, staged 149, deferred 47, dismissed 137; `unrouted` 441. `lens.outcomes.allRouted`: no scratch count was taken; check its shares, not its counts, against the record's 2026-11-18 figures (fixed 63%, dismissed 29%, staged 5%, deferred 3%, top-level runs only), and explain any share more than 5 points off in the report.
  - `lens.yield.byLens`: `3a` `{ runs: 20, agents: 46, confirmed: 62, unparsed: 6 }`, `3f` `{ runs: 20, agents: 46, confirmed: 56, unparsed: 6 }` — that count was bounded by the window; with the user's decision the yield walk is bounded by `--until` alone (here 2026-11-18, the same newest edge), and timing-less runs now add to `unparsed`, so `unparsed` may rise and the slot runs may differ; name each difference.

This command reads the real archive only after Tasks 1-4 exist, so it is unverified at plan time.

- [ ] **Step 6: AC11 check and evidence.** Run `git diff --name-only origin/main...HEAD -- plugin/` and expect no output. Control (run 2026-11-19): the same shape over a commit that touches `plugin/`, `git diff --name-only e2c39d576d~1 e2c39d576d -- plugin/`, printed `plugin/skills/specify/shaping-mode-stamping.md`, so the command can see a change. Record it: `mkdir -p "$PIPELINE_RUN_DIR/evidence"`, write the command's output to `"$PIPELINE_RUN_DIR/evidence/ac11-plugin-diff.txt"` with a plain redirect, then log `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "AC evidence" --text-file "{text-file}"`, the text file holding one line: `AC11 (no file under plugin/ changes): git diff --name-only origin/main...HEAD -- plugin/ printed 0 paths; output at evidence/ac11-plugin-diff.txt`.

- [ ] **Step 7: Commit**

```bash
git add tools/pipeline-cost-report.js tools/pipeline-cost-report/reviews.js tests/pipeline-cost-report/reviews.test.js tests/pipeline-cost-report/cli.test.js docs/plugin-structure.md
git commit -m "Add the reviews section to the pipeline cost report — refs #5925"
```

Waived plugin/skills/review/step3-lens-dispatch.md: read only — the spec's Gotcha cites it for each lens's fixed model profile, which Task 5's lens-by-tier note states; AC11 forbids changing it.

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (`reviews`, `--since`/`--until`/`--json`, run date, multi-spec members, parent not read) | 2 (`walkRuns`, window test), 3 (AC8.1), 5 (CLI) |
| Deliverable 2 (task review by tier, re-reviews beside, items, Minor only) | 2, 5 (render) |
| Deliverable 3 (plan review: share, per review, by kind with `other`, human stops) | 1 (parser), 2 |
| Deliverable 4 (lens per tier and lens: agents, no-finding share, per-agent by severity) | 3 |
| Deliverable 5 (per run and per lens: confirmed, pair, tiebreak, refuted, can't tell) | 3 |
| Deliverable 6 (outcomes, `unrouted`, and the all-routed split beside it) | 4, 5 (render) |
| Deliverable 7 (`yield.byLens`, `--runs`, `--since` ignored and `--until` bounding, a multi-spec run one summed slot, unreadable takes no slot, additive shape) | 4, 5 |
| Plan Review Clarifications (five user decisions) | Decisions section; 2 (parent timing), 4 (yield window, slots, two splits), 5 (exit code) |
| Deliverable 8 (unparsed beside every figure) | 1-5 |
| Deliverable 9 (tests on real-sample fixtures; header comment) | 1 (fixtures, header), 2-4 (header excerpts), 5 (final read) |
| AC1.1 | 2, 5 |
| AC2.1 | 1, 2 |
| AC3.1 | 2, 5 |
| AC4.1 | 3, 5 |
| AC5.1 | 3 |
| AC6.1 | 4, 5 |
| AC7.1 | 2 |
| AC8.1 | 3 |
| AC9.1 | 1, 3 |
| AC9.2 | 3 |
| AC10.1 | 4, 5 |
| AC11.1 | 5 (Step 6) |
