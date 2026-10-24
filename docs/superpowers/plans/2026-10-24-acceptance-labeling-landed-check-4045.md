# Single-source the acceptance-labeling Landed check — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the "has acceptance labeling landed?" predicate one canonical definition — a new `plugin/skills/_shared/acceptance-labeling-landed.md` — and have `_shared/pr-first-merge.md` Step 1, `dispatch/close-out.md` step 3 and tidy's `## Arm ready PR` cite it, each keeping only its own deltas.

**Architecture:** Prose-as-implementation refactor (cross-skill contract extraction per the `shared-contract-extraction` project skill), pinned by `node --test` conformance suites that read the live prose. No runtime code changes. Behavior is unchanged except that close-out now treats a failed label/comment read as not landed (spec Gotchas bullet 3's deliberate convergence on tidy's stricter rule).

**Premise reversal (logged to `decisions.md`, Spec Step 3):** the spec put the Landed check in a `### Landed check` subsection of `_shared/pr-first-merge.md` Step 1. `plan-audit.js`'s headroom check reports the composed `merge` bundle (`pr-first-merge.md` + `pr-checklist-refresh.md`, `wrap-up/auto-merge-short-circuit.md:234`, `wrap-up/merge-mode.md:25`, `wrap-up/review-console.md:122`) at 52,195 of 52,500 B (`RAIL_BYTES`) — 305 B of headroom — and the pipeline's own merge never reads the predicate (it runs Step 1 unconditionally). So the predicate moves to its own `_shared` file, the plan-authoring Size-headroom remedy "move a genuinely lazy section into its own cited file". Architecture alignment (Common Step 4.5) updates the spec's AC1/AC2/AC8 wording to match.

**Tech Stack:** Markdown skill files; `node --test` suites using `tests/helpers/read-skill.js`'s `readText`.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T105021-spec-4045/work/4045-spec.md`

**Scope keywords:** Landed check, landed rule, live-state precheck, acceptance-labeling-landed

## Global Constraints

- Behavior unchanged for every input, except close-out's failed-read convergence (spec Gotchas bullet 3).
- `_shared/pr-first-merge.md` must not grow: its byte count after Task 1 is ≤ 38,412 B (today's), so the composed `merge` bundle stays ≤ 52,195 B. Its Step 1 "Labeling has not landed when …" sentence names neither `dispatch/close-out.md` nor tidy.
- The new `_shared/acceptance-labeling-landed.md` owns recognition (the predicate and its outcome names); consumers own outcomes (what they do on each).
- Never write the literal placeholder tokens (the three the spec-shaped-body check scans for) in authored prose.
- Commit style: `{Verb} {what} — {detail}`, ending with the line `Claude-Session: https://claude.ai/code/session_01B8vNeaEMBUz6QYqF2PSGcz`. Stage files by explicit path only.

## Review Focus

- A failed label or comment read during the live tier must never read as landed in either caller (Task 1 `AC1.2 (failed read)` pin; Task 3's held pins).
- close-out with no resolvable run dir must still stop the candidate **without** running the live tier (Task 2 `AC3.2` / `AC5.3` pin) — folding tidy's behavior into close-out would silently change it.
- tidy with no resolvable run dir must still run the live tier and hold (Task 3 `AC4.2` / `AC5.2` pins).
- The multi-spec `spec-*/verify.json` read must survive the move (Task 1 `AC1.2 (verify.json tier)` pin).
- The housekeeping-marker PR flavor must stay exempt from the check (Task 3 `AC4.2` pin).

---

### Task 1: The canonical contract `_shared/acceptance-labeling-landed.md`; Step 1 cites it

**Files:**
- Create: `plugin/skills/_shared/acceptance-labeling-landed.md`
- Modify: `plugin/skills/_shared/pr-first-merge.md:40-42`
- Create: `tests/acceptance-labeling-landed-check.test.js`
- Modify: `tests/verify-json-acceptance-guard-conformance.test.js`
- Modify: `tests/tidy-arm-ready-pr-acceptance-guard.test.js`

**Interfaces:**
- Produces: file `plugin/skills/_shared/acceptance-labeling-landed.md`, H1 `# Acceptance Labeling — the Landed check`, sections `## Resolve the run dir`, `## verify.json tier`, `## Live-state tier`, `## Outcomes`. Outcome names, cited verbatim by Tasks 2-3: `landed`, `no run dir`, `verify.json missing`, `acceptance-labeling: {result}` (with `unparseable` / `row absent`), `unreadable: {verify.json | labels | comments}`.
- Produces: `tests/acceptance-labeling-landed-check.test.js` with constants `CONTRACT`, `MERGE`, `CLOSE_OUT`, `TIDY`, `SKILL_GRAPH` (whitespace-collapsed via the `read` helper) — Tasks 3-4 append tests to it.

- [ ] **Step 1: Write the failing test** `tests/acceptance-labeling-landed-check.test.js` — same header/helpers as `tests/verify-json-acceptance-guard-conformance.test.js` (`readText`, whitespace-collapsing `read`, `slice`). `CONTRACT = read('plugin','skills','_shared','acceptance-labeling-landed.md')`. Tests:
  - `AC1.1: the Landed check has exactly one home` — `CONTRACT` matches `/# Acceptance Labeling — the Landed check/`; `MERGE` does not match `/### Landed check/`.
  - `AC1.2 (run dir): resolution from the validated marker, archive fallback` — `CONTRACT` matches `/claude-tweaks-run:/`, `/validat\w+ .{0,60}`flow\/claim-targets\.md`/`, `/archive\/\{run-id\}/`.
  - `AC1.2 (verify.json tier): multi-spec read and the pass/skip rule` — matches `/read every `spec-\*\/verify\.json`/`, `/`acceptance-labeling` row/`, `/pass.{0,12}skip/`, `/every file read exists/`.
  - `AC1.2 (live-state tier)` — factor `const LIVE_PINS = [/demo:pending/, /at least one record/, /every label read succeeded/, /<!-- run-comment: brief -->/, /<!-- run-comment: try-it -->/, /brief:\{N\}.{0,20}try-it:\{N\}/, /Trusted authors/]` and `function assertLive(text) { for (const re of LIVE_PINS) assert.match(text, re); }`; call `assertLive(CONTRACT)`.
  - `AC1.2 (live-state tier): negative control` — `assert.throws(() => assertLive(slice(CONTRACT, '# Acceptance Labeling', '## Live-state tier')), assert.AssertionError)`.
  - `AC1.2 (outcomes)` — matches `/`no run dir`/`, `/`verify\.json missing`/`, `/`acceptance-labeling: \{result\}`/`, `/`unparseable`/`, `/`row absent`/`, `/`unreadable: \{verify\.json \| labels \| comments\}`/`.
  - `AC1.2 (failed read): a failed read never counts as landed` — matches `/A failed read never counts as landed/`.
  - `AC2.1: Step 1's not-landed sentence cites the contract and names no caller` — `sentence = slice(MERGE, '## Step 1:', '## Step 1.5').match(/Labeling has not landed when.*?reached this merge\./)[0]`; matches `/acceptance-labeling-landed\.md/`; `doesNotMatch` `/close-out/` and `/tidy/`.
  - `AC2.1: pr-first-merge does not grow (merge bundle headroom)` — `Buffer.byteLength(readText(<pr-first-merge path>)) <= 38412`.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/acceptance-labeling-landed-check.test.js`
Expected: FAIL — `ENOENT` on `acceptance-labeling-landed.md`.

- [ ] **Step 3: Write the contract and rewrite Step 1's sentence**

Create the file, merging the two existing copies clause by clause — `dispatch/close-out.md` step 3's bullets (lines 61-79) and tidy's guard paragraph (`tidy/actions-github-issues.md` lines 84-115). Content, one short section each:
  - Intro (2-3 sentences): the one definition of whether a PR's acceptance labeling (`demo:pending`, the Try it walkthrough) has landed; consumers cite it and state only what they do on each outcome, including whether they run the live-state tier when the run dir does not resolve. Name the three citers: `_shared/pr-first-merge.md` Step 1, `dispatch/close-out.md` step 3, tidy's `## Arm ready PR`.
  - `## Resolve the run dir`: the `claude-tweaks-run: {run-id}` marker in the PR body, the run-id validated as `flow/claim-targets.md` validates it (a marker that fails counts as no valid marker); `$RUN_ROOT/.claude-tweaks/pipelines/{run-id}/`, else `$RUN_ROOT/.claude-tweaks/pipelines/archive/{run-id}/`; neither → outcome `no run dir`.
  - `## verify.json tier`: close-out's multi-spec sentence (the marker names the parent; `verify` writes only `{parent}/spec-{N}/verify.json`; read every `spec-*/verify.json` when `spec-*/` subdirectories exist, otherwise the run dir's own); landed when every file read exists and its `acceptance-labeling` row's `result` is `pass`/`skip`.
  - `## Live-state tier`: close-out's rationale (`wrap-up/verification-brief.md`'s issue pointer comment is a plain post that duplicates on a re-run); landed when every record in the PR's `Fixes` lines carries `demo:pending` (at least one record, and every label read succeeded — an empty `Fixes` set or a failed read shows nothing), or the PR carries a trusted `<!-- run-comment: brief -->` / `<!-- run-comment: try-it -->` run comment (or the multi-spec `brief:{N}`/`try-it:{N}` form; trusted per `_shared/pr-run-comments.md`'s Trusted authors).
  - `## Outcomes`: `landed`, or the first not-landed outcome among `no run dir`, `verify.json missing`, `acceptance-labeling: {result}` (the row's `result`, or `unparseable` / `row absent` for a malformed file), `unreadable: {verify.json | labels | comments}`. Then the literal sentence `A failed read never counts as landed.`

Replace `pr-first-merge.md` lines 40-42's sentence with exactly: ``Labeling has not landed when `{run-dir}/verify.json` (each `spec-{N}/` copy, multi-spec) is missing or its `acceptance-labeling` row's `result` is anything but `pass`/`skip` — the full predicate, live-state tier included, is `_shared/acceptance-labeling-landed.md` — whichever caller reached this merge.`` (shorter than today's sentence; keeps `MERGE_PINS` and the `MERGE_ADDED` bounds of `tests/verify-json-acceptance-guard-conformance.test.js` valid).

- [ ] **Step 4: Repoint the tidy suite's Step 1 test.** In `tests/tidy-arm-ready-pr-acceptance-guard.test.js`, rename the `pr-first-merge Step 1 names tidy's Arm ready PR as a caller that holds instead of labeling` test to `pr-first-merge Step 1's not-landed sentence names no caller` and replace its two `tidy's Arm ready PR holds…` assertions with `assert.doesNotMatch(sentence[0], /tidy|close-out/)` and `assert.match(sentence[0], /acceptance-labeling-landed\.md/)`.

- [ ] **Step 5: Run the three suites**

Run: `node --test tests/acceptance-labeling-landed-check.test.js tests/verify-json-acceptance-guard-conformance.test.js tests/tidy-arm-ready-pr-acceptance-guard.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit** — `git add` the four touched files plus the new contract by path; message `Extract the acceptance-labeling Landed check into its own _shared contract — refs #4045`.

### Task 2: `dispatch/close-out.md` step 3 cites the contract

**Files:**
- Modify: `plugin/skills/dispatch/close-out.md:58-79`
- Modify: `tests/verify-json-acceptance-guard-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's contract path and outcome names.

- [ ] **Step 1: Update the pins first.** In `tests/verify-json-acceptance-guard-conformance.test.js` replace `CLOSE_OUT_PINS` with: `/acceptance-labeling-landed\.md/`, `/pr-first-merge\.md.{0,40}Step 1/`, `/Step 1 before the confirmation gate/`, `/`no run dir`.{0,160}stop this candidate/`, `/stopped: acceptance labeling unverifiable — no run dir/`, `/without (running )?the live-state tier/`, `/`PIPELINE_RUN_DIR` = the resolved run/`, `/`CLOSING_SUB_ISSUES` = the PR's `Fixes` record numbers/`. Rename the AC2.1 positive test to `AC3.1 + AC5.3: close-out step 3 cites the contract, keeps the no-run-dir stop and the Step 1 wiring`. Add `AC3.2: close-out step 3 no longer restates the live-state tier` — `doesNotMatch(closeOutStep3, /run-comment: brief/)`, `/run-comment: try-it/`, `/read every `spec-\*\/verify\.json`/`. `CLOSE_OUT_ADDED` (bounds `**Acceptance labeling first**` … `` `MULTISPEC_PARENT_DIR` = the parent. ``), the Mark-ready ordering tests and the Reporting tests stay.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/verify-json-acceptance-guard-conformance.test.js`
Expected: FAIL after Step 1 — on `/acceptance-labeling-landed\.md/` and the AC3.2 absence assertions.

- [ ] **Step 3: Rewrite the block.** Keep the bold lead `**Acceptance labeling first**` and its Step 1 → Step 2 order sentence. Then: apply `_shared/acceptance-labeling-landed.md` to this PR, with three outcome bullets — **`no run dir`**: stop this candidate and report `stopped: acceptance labeling unverifiable — no run dir`, without running the live-state tier — never guess a run dir; **`landed`** (either tier): no Step 1 run; **any other outcome**: run `_shared/pr-first-merge.md` Step 1 before the confirmation gate, with today's `PIPELINE_RUN_DIR` / `CLOSING_SUB_ISSUES` / multi-spec `MULTISPEC_PARENT_DIR` wiring verbatim, still ending `` `MULTISPEC_PARENT_DIR` = the parent. ``. The "Then, when `isDraft` …" paragraph stays.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/verify-json-acceptance-guard-conformance.test.js tests/close-out-pr-state-contract-conformance.test.js tests/pr-first-merge.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit** — `git add` both files by path; message `Cite the Landed check contract from dispatch close-out step 3 — refs #4045`.

### Task 3: tidy's `## Arm ready PR` cites the contract; single-source pin

**Files:**
- Modify: `plugin/skills/tidy/actions-github-issues.md:84-115`
- Modify: `tests/tidy-arm-ready-pr-acceptance-guard.test.js`
- Modify: `tests/acceptance-labeling-landed-check.test.js`

**Interfaces:**
- Consumes: Task 1's contract path, outcome names, and test file constants.

- [ ] **Step 1: Update the pins first.**
  - `GUARD_PINS`: drop `/read every `spec-\*\/verify\.json`/`, `/dispatch\/close-out\.md` step 3/`, `/every file read exists/`, `/validating the run-id as …/`, `/an empty `Fixes` set or a failed read shows nothing/`, `/`acceptance-labeling` row/`, `/pass.{0,12}skip/`; add `/acceptance-labeling-landed\.md/` and `/acceptance-labeling: \{result\}/`. Keep `/verify\.json/`, the `log-decision` SKIP pin, the unvalidated-marker pin and the `unreadable:` pin.
  - AC1.1's ordering test anchors on `arm.indexOf('acceptance-labeling-landed.md')` instead of `` '`acceptance-labeling` row' ``.
  - `HELD_PINS`: drop `<!-- run-comment: brief -->`, `<!-- run-comment: try-it -->`, `Trusted authors`, `no valid marker or run dir resolves`; add `/even when (it|the check) resolves `no run dir`/`. Keep `demo:pending` (the paragraph's lead and its "So a record-linked PR …" sentence still name it).
  - New `AC4.1: Arm ready PR cites the contract and no longer restates the predicate` — matches `/acceptance-labeling-landed\.md/`; `doesNotMatch(arm, …)` for `/run-comment: brief/`, `/run-comment: try-it/`, `/spec-\*\/verify\.json/`.
  - New `AC4.2 + AC5.2: tidy keeps its deltas` — matches `/even when (it|the check) resolves `no run dir`/`, `/never run labeling from a tidy sweep/`, `/not armed — acceptance labeling not landed \(\{reason\}\)/`, `/close-out stops on the same missing run dir/`, `/\/claude-tweaks:demo #\{record\}/`, `/--status SKIP/`, `/Never put an unvalidated marker value/`, `/is held, not armed/`, `/housekeeping-marker flavor .{0,120}skips this check/`, and the existing Step 3 call (AC5.4: a landed PR still reaches `run `_shared/pr-first-merge.md`'s Step 3`).
  - Append to `tests/acceptance-labeling-landed-check.test.js`: `function restaters(files)` returning, in insertion order, the keys whose text matches both `/run-comment: try-it/` and `/demo:pending/`. Test `AC6.1: the live-state clause is defined only in the contract` — `deepStrictEqual(restaters({ contract: CONTRACT, 'pr-first-merge': MERGE, 'close-out': CLOSE_OUT, tidy: TIDY }), ['contract'])`. Negative control `AC6.1: negative control — a caller restating the clause fails the pin` — the same call with `'close-out': CLOSE_OUT + ' `demo:pending` <!-- run-comment: try-it -->'` must make `deepStrictEqual` throw.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/tidy-arm-ready-pr-acceptance-guard.test.js tests/acceptance-labeling-landed-check.test.js`
Expected: FAIL after Step 1 — tidy still restates the clause (`AC4.1`, `AC6.1`).

- [ ] **Step 3: Rewrite the guard paragraph.** Keep the bold lead `**Acceptance labeling — record-linked flavor only, before Step 3.**` and its first two sentences. Replace everything from "For a PR carrying the `claude-tweaks-run:` marker" through "…Run both checks when no valid marker or run dir resolves too: … needs no run dir." with: for a PR carrying the `claude-tweaks-run:` marker, apply `_shared/acceptance-labeling-landed.md` before arming, running its live-state tier even when it resolves `no run dir` — tidy departs from `dispatch/close-out.md` step 3 here because tidy never runs Step 1 and so needs no run dir (the departure stated in the citing sentence, per the shared-contract-extraction skill). From "Otherwise do not run Step 3, and never run labeling from a tidy sweep" onward keep today's text, except: the failed-read sentence collapses to "an `unreadable` outcome holds the PR too, never passes it", and `{reason}` becomes "the contract's not-landed outcome (`verify.json missing`, `acceptance-labeling: {result}`, `no run dir`, or `unreadable: {verify.json | labels | comments}`)". The `GUARD_ADDED` bounds (bold lead … `nothing to label.`) must still match.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/tidy-arm-ready-pr-acceptance-guard.test.js tests/acceptance-labeling-landed-check.test.js tests/verify-json-acceptance-guard-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: AC6.2 revert-to-red proof.** `git show origin/main:plugin/skills/dispatch/close-out.md` and `…/tidy/actions-github-issues.md` to two scratch files (outside the repo), then a one-off `node -e` using only `fs` that applies `restaters` to `{contract: '', 'pr-first-merge': <main copy>, 'close-out': <main copy>, tidy: <main copy>}` (whitespace collapsed). Expected output: `["close-out","tidy"]` — not `["contract"]`, so AC6.1 is red on main. Quote the raw output in the task report.

- [ ] **Step 6: Commit** — `git add` the three files by path; message `Cite the Landed check contract from tidy's Arm ready PR — refs #4045`.

### Task 4: Edges and citation sweep — skill-graph and journeys

**Files:**
- Modify: `docs/skill-graph.md`
- Modify: `docs/journeys/tidy-holds-a-pr-whose-labeling-never-landed-3877.md`
- Modify: `docs/journeys/close-out-a-parked-pr-whose-labeling-never-landed-3783.md`
- Modify: `tests/tidy-arm-ready-pr-acceptance-guard.test.js`
- Modify: `tests/acceptance-labeling-landed-check.test.js`

**Interfaces:**
- Consumes: Task 1's contract path.

- [ ] **Step 1: Write the failing tests.**
  - Append `AC8.1: skill-graph names the contract on the dispatch and tidy edges` — `slice(SKILL_GRAPH, '## dispatch', '## docs-health')` and `slice(SKILL_GRAPH, '## tidy', '## visual-review')` each match `/\| `_shared\/acceptance-labeling-landed\.md` \|/`.
  - Append `AC7.1: no citation names close-out step 3 as the rule's home` — walk `plugin/` and `docs/` with `fs.readdirSync(dir, {recursive: true})`, `.md` files only, excluding paths under `docs/superpowers/plans/` and `docs/plans/` and the file `docs/incident-log.md`; no file's whitespace-collapsed text matches `/close-out\.md` step 3's (acceptance-labeling )?landed rule|live-state precheck/`.
  - In `tests/tidy-arm-ready-pr-acceptance-guard.test.js`, retarget the skill-graph test to `skill-graph records the tidy → _shared/acceptance-labeling-landed.md edge`: the tidy slice matches `/\| `_shared\/acceptance-labeling-landed\.md` \| [^|]*## Arm ready PR/`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/acceptance-labeling-landed-check.test.js tests/tidy-arm-ready-pr-acceptance-guard.test.js`
Expected: FAIL after Step 1 — AC7.1 (skill-graph's tidy row and journey 3877 still say "live-state precheck") and AC8.1.

- [ ] **Step 3: Edit the docs.**
  - `docs/skill-graph.md`, `## tidy`: retarget the `dispatch/close-out.md` row to `_shared/acceptance-labeling-landed.md` — `actions-github-issues.md`'s `## Arm ready PR` applies this contract before arming a record-linked PR, running its live-state tier even with no run dir, holds the PR for a human instead of running labeling from a sweep, and recommends `/claude-tweaks:dispatch close-out #{record}` for the hold (#3877, #4045).
  - `docs/skill-graph.md`, `## dispatch`: add one row `_shared/acceptance-labeling-landed.md` — `close-out.md` step 3 applies the contract before Mark ready: `no run dir` stops the candidate without the live tier; any other not-landed outcome runs `_shared/pr-first-merge.md` Step 1 (#3783, #4045). In the existing `_shared/pr-first-merge.md` row (`## dispatch`), replace the `Since #3783 …` sentence's restated predicate with a pointer to that new row; leave the rest of the row untouched.
  - Journey 3877: replace "`dispatch/close-out.md` step 3's live-state precheck" with "the contract's live-state tier (`_shared/acceptance-labeling-landed.md`)"; repoint the history line that calls tidy "the third caller of `pr-first-merge.md` Step 1's landed …" to name the contract; append `- Updated during build of #4045: the landed rule now lives in _shared/acceptance-labeling-landed.md, cited by pr-first-merge Step 1, close-out step 3 and tidy.`
  - Journey 3783, step 3: add one line naming `_shared/acceptance-labeling-landed.md` as the predicate close-out applies, and one bullet that a failed label/comment read now counts as not landed (Step 1 runs). Append the same history line.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/acceptance-labeling-landed-check.test.js tests/tidy-arm-ready-pr-acceptance-guard.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit** — `git add` the five files by path; message `Add the Landed check contract's skill-graph edges and repoint its journeys — refs #4045`.

## AC coverage

| AC clause | Covered by |
|---|---|
| AC1.1, AC1.2 | Task 1 Step 1 |
| AC2.1 | Task 1 Step 1 |
| AC3.1, AC3.2 | Task 2 Step 1 |
| AC4.1, AC4.2 | Task 3 Step 1 |
| AC5.1 | Tasks 2-3 delta pins together (AC5.2-AC5.4 are its cases) |
| AC5.2, AC5.4 | Task 3 Step 1 (`AC4.2 + AC5.2` test) |
| AC5.3 | Task 2 Step 1 (`AC3.1 + AC5.3` test) |
| AC6.1 | Task 3 Step 1 |
| AC6.2 | Task 3 Step 5 (revert-to-red proof) |
| AC7.1 | Task 4 Step 1 |
| AC8.1 | Task 4 Step 1 |

Waived AC9.1: `npm test` runs once centrally at Common Step 5 (Final Verification, `bin/verify.js`), not per task.
