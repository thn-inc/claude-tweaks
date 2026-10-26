# Standalone Run-Dir Close-Out on Every Exit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every skill that mints a standalone pipeline run directory states that every exit after its mint closes a directory it created (`close-run`, plus archival where the skill archives), and one conformance suite enumerates the minters and pins that statement for each.

**Architecture:** Release Step 8's "**Every exit runs the close-out.**" paragraph (#3898) is the model. Each minter gets its own paragraph of the same shape at the section named below, plus pointers at early stops that would otherwise skip it. A new `node --test` suite derives the minter set from the skill corpus (mint lines + `_shared/run-dir-resolution.md` step 4's allowlist), fails on any un-enumerated minter, and pins each minter's statement with go-red proofs.

**Tech Stack:** Markdown skill prose (`plugin/skills/**`), `node --test` (Node 20 in CI).

**Spec:** `.claude-tweaks/pipelines/2026-10-25T141430-record-4138/work/4138-spec.md` (record #4138)

Scope keywords: Every exit runs the close-out

## Global Constraints

- Commit subject style: `{Verb} {what} — {detail}`, no conventional-commit prefix; body `refs #4138` (never `closes`/`fixes`), then the `Claude-Session:` trailer line.
- Every edited `plugin/skills/**/*.md` stays under `RAIL_BYTES` (52,500 B, `plugin/bin/lib/skill-audit/budgets.js`). Tightest: `tidy/step-6-auto.md` 48,800 B (not edited — tidy's statement goes in `tidy/SKILL.md`), `dispatch/SKILL.md` 47,989 B (keep its additions under ~1,500 B).
- Never run `git stash`. Run tests in the foreground only.
- A skill reference inside actionable instruction text uses `/claude-tweaks:{skill}`; bare `/{skill}` only in descriptive prose.
- Never restate a cross-skill edge in a `SKILL.md`; `docs/skill-graph.md` needs no change (no new skill-to-skill edge).
- The pinned bold sentence is exactly `**Every exit runs the close-out.**` in every minter.

## Review Focus

1. **A child skill closing its parent's shared directory.** Under `/claude-tweaks:sweep`, tidy/specify/backlog adopt sweep's directory; each must never close it (inherited). `backlog/refine-closing-summary.md`'s existing close has no inherited guard today — Task 4 adds it and pins it.
2. **Dispatch's zero-eligible path.** Step 3 says to skip "the rest of Step 3" when zero groups are eligible, which today skips the only `close-run`. Task 5 pins a pointer there.
3. **Wrap-up's "Stop and re-engage" halt must stay open.** It is the deliberate resumable pause; closing it would make `resume` impossible. Task 8 pins the exception.
4. **Tidy closing before `--approve`.** `approve-mode.md` resolves standalone dirs by name glob, not status, and its own `close-run` is idempotent — closing at the end of the minting run must not block a later `--approve` archive. Task 6 states this.
5. **A created-vs-inherited misjudgment.** Each statement names how the skill tells them apart (release/wrap-up stamp; specify/backlog/tidy/sweep/init/dream: `$PIPELINE_RUN_DIR` set at invocation and returned by the resolver → inherited; dispatch: its Step 1 minted/adopted note).

## File Structure

- Create: `tests/standalone-run-dir-closeout-conformance.test.js` — derivation of the minter set + per-minter pins + go-red controls.
- Reference (unchanged — the model): `plugin/skills/release/SKILL.md` (Step 8's close-out paragraph), `tests/release-run-dir-lifecycle-conformance.test.js` (the `assertFactsAndGoRed` pattern).
- Modify (prose only): `plugin/skills/_shared/run-dir-resolution.md`, `sweep/SKILL.md`, `specify/next-mode-closeout.md`, `specify/next-mode-shape.md`, `backlog/SKILL.md`, `backlog/refine-closing-summary.md`, `backlog/refine-headless.md`, `dispatch/SKILL.md`, `tidy/SKILL.md`, `init/SKILL.md`, `wrap-up/SKILL.md`, `harness-health/dream-pass.md`.

Minter set (verified by probe against the live corpus on 2026-10-25): D1 `resolve-run-dir … --standalone {name} … --create` lines — `release/SKILL.md:65`, `specify/next-mode.md:107`, `sweep/SKILL.md:34`, `wrap-up/SKILL.md:95`; D2 `--spec-slug {x}-standalone --create` — `harness-health/dream-pass.md:47`; D3 prose `create … {ISO-timestamp}-{x}-standalone/` — `tidy/step-6-auto.md:107`, `init/phase-3-classification.md:24`, `init/update-mode.md:591`, `flow/materialize.md:177` (exempt); step-4 allowlist adds `dispatch`, `backlog`, `capture` (exempt — allowlisted, mints nothing).

Exempt, with reasons the test records:
- `flow/materialize.md` — `/build`'s record-mode directory is `run-dir-resolution.md` step 3, not step 4: it is deliberately inherited by the record's later standalone `/test`, `/review` and `/wrap-up`, whose cleanup item 8 closes and archives it.
- `capture` — on step 4's allowlist but mints nothing; it logs only when a directory already resolves (`capture/routing.md:38`).

---

### Task 1: Conformance harness, release row, shared-contract sentence

**Files:**
- Create: `tests/standalone-run-dir-closeout-conformance.test.js`
- Read (unchanged): `plugin/skills/release/SKILL.md`, `tests/release-run-dir-lifecycle-conformance.test.js`
- Modify: `plugin/skills/_shared/run-dir-resolution.md` (step 4, after the paragraph ending "…this is the bookend-end for a standalone run).")

**Interfaces:**
- Produces (later tasks add one `PINS` entry each, and Task 9 adds one test):
  - `const MINTERS = ['backlog', 'dispatch', 'harness-health', 'init', 'release', 'specify', 'sweep', 'tidy', 'wrap-up'];`
  - `const EXEMPT_FILES = { 'flow/materialize.md': '<reason above>' };` `const EXEMPT_SKILLS = { capture: '<reason above>' };`
  - `const P_STATEMENT = [/\*\*Every exit runs the close-out\.\*\*/, 'the minter states every exit runs the close-out'];`
  - `const P_CLOSE = [/close-run --run/, 'the close-out runs close-run with an explicit --run'];`
  - `const P_INHERITED = [/An \*\*(?:inherited|adopted)\*\* directory is never closed/, 'an inherited directory is never closed'];`
  - `const PINS = { release: { file: 'release/SKILL.md', from: '## Step 8', to: '## Next Actions', patterns: [P_STATEMENT, P_CLOSE, P_INHERITED] } };` — entry shape `{ file (relative to plugin/skills), from (heading line prefix), to (next heading prefix, or null = end of file), patterns: [[RegExp, fact], …] }`; a key may carry an array of such entries when one minter pins several slices.
  - `function sliceOf(text, from, to)` — the text from `\n{from}` to `\n{to}` (or EOF); throws `extraction pattern is out of sync: …` when a heading is missing.
  - `function assertFactsAndGoRed(text, patterns, message)` — every pattern matches; then for each pattern, removing **all** its matches (global replace) makes exactly that fact (and only it) missing. Same contract as `tests/release-run-dir-lifecycle-conformance.test.js` lines 309-325, but global-replace so a pattern matching twice in a slice still discriminates.
  - `function derivedMintSites(corpus)` → `[{ skill, file, line, kind: 'D1'|'D2'|'D3' }]` over `corpus = [{ file, text }]` (every `plugin/skills/**/*.md` except `_shared/`), using exactly: `D1 = /resolve-run-dir\b[^\n]*--standalone\s+(?![<\[])\S/` on lines that also contain `--create`; `D2 = /--spec-slug\s+"?[\w-]+-standalone"?\s+--create/`; `D3 = /\bcreate\b[^\n]*\{ISO-timestamp\}-[\w{}-]+-standalone\//`. `skill` = the file's first path segment.
  - `function allowlistSkills(text)` → skill names parsed from `run-dir-resolution.md`'s `standalone-auto allowlist (…)` parenthetical (strip a leading `/claude-tweaks:` or `/`). Throws when the parenthetical is not found.
  - `function uncovered(sites, allowlist)` → the sites/names not in `MINTERS`, not in `EXEMPT_FILES` by file, not in `EXEMPT_SKILLS` by skill.
  - `function exemptSkillMints(sites)` → sites whose skill is in `EXEMPT_SKILLS` (must be empty: an exempt non-minter that starts minting goes red).

- [ ] **Step 1: Write the suite**

Tests (names carry the AC clause ids; the spec's Acceptance Criteria are AC1.1 "Every standalone-minting skill states close-out on every exit after its mint, and a conformance test enumerates the minters and pins that statement for each." and AC2.1 "`npm test` passes."):

Waived AC2.1: not a test step — `/build` Common Step 5 runs the full `npm test` once centrally after the last task (the runner-written pass stamp is the evidence).
- `AC1.1: the mint-site derivation finds the known sentinel sites` — `derivedMintSites` includes files `release/SKILL.md`, `specify/next-mode.md`, `sweep/SKILL.md`, `wrap-up/SKILL.md`, `harness-health/dream-pass.md`, `tidy/step-6-auto.md`, `init/phase-3-classification.md` (a broken regex must never read as "no minters").
- `AC1.1: every derived mint site and allowlisted skill is an enumerated minter or a recorded exemption` — `assert.deepEqual(uncovered(...), [])`.
- `AC1.1: an exempt non-minter has no mint site` — `assert.deepEqual(exemptSkillMints(...), [])`.
- `AC1.1 go-red: a fake skill's mint line is reported uncovered` — append `{ file: 'fake/SKILL.md', text: 'node x/bin/hooks.js resolve-run-dir --standalone fake --create' }` to the corpus; `assert.throws(() => assertNoUncovered(...), /fake\/SKILL\.md/)`.
- `AC1.1 go-red: a mint line added to capture is reported` — append a D1 line under `capture/SKILL.md`; `exemptSkillMints` returns it.
- `AC1.1: run-dir-resolution.md step 4 states the every-exit close-out duty (with go-red)` — `assertFactsAndGoRed` over the whole file with `[/closes a directory it created on every exit after its mint/, …]` and `[/standalone-run-dir-closeout-conformance\.test\.js/, …]`.
- One generated test per `PINS` key: `` `AC1.1: ${key} states the every-exit close-out (with go-red)` `` → `assertFactsAndGoRed(sliceOf(readText(...), from, to), patterns, …)` for each entry.
- `AC1.1 go-red: removing the statement from release's Step 8 trips its pin` — strip `**Every exit runs the close-out.**` from the live slice; `assert.throws(() => assertFactsAndGoRed(...), /every exit runs the close-out/)`.

Read files with `readText` from `tests/helpers/read-skill`.

- [ ] **Step 2: Run it — the run-dir-resolution test fails, everything else passes**

Run: `node --test tests/standalone-run-dir-closeout-conformance.test.js`
Expected: FAIL — exactly one failing test, `AC1.1: run-dir-resolution.md step 4 states the every-exit close-out duty`.

- [ ] **Step 3: Add the shared-contract sentence to `run-dir-resolution.md` step 4**

One short paragraph, indented like its siblings under item 4: every minter — this allowlist, wrap-up's and release's clauses, and harness-health's dream pass — closes a directory it created on every exit after its mint (`close-run`, plus archival where that skill archives), never only on success, because a standalone directory records no owning session and session end never marks it `interrupted`; an inherited directory is the parent's to close; release Step 8's "Every exit runs the close-out" paragraph is the model and `tests/standalone-run-dir-closeout-conformance.test.js` enumerates the minters. Must contain the literal `closes a directory it created on every exit after its mint`.

- [ ] **Step 4: Run it**

Run: `node --test tests/standalone-run-dir-closeout-conformance.test.js tests/pipeline-run-dir-adoption-anchoring.test.js`
Expected: PASS (the second suite byte-pins this file's Bash snippet — the new paragraph must not touch the snippet).

- [ ] **Step 5: Commit**

`git add tests/standalone-run-dir-closeout-conformance.test.js plugin/skills/_shared/run-dir-resolution.md` then commit `Add standalone run-dir close-out conformance suite — derives minters, pins release (refs #4138)`.

---

Tasks 2-9 share one shape. **Step 1:** add the task's `PINS` entry exactly as listed. **Step 2:** `node --test tests/standalone-run-dir-closeout-conformance.test.js` — Expected: FAIL in that key's generated test only. **Step 3:** write the prose (each statement names the skill's exits after its mint, says how it tells created from inherited, and contains every pinned literal). **Step 4:** re-run the suite plus every existing test that reads an edited file — find them with `git grep -l -F '{basename}' -- tests` for each edited file's basename, and run each hit — Expected: PASS. **Step 5:** commit the edited files plus the test.

### Task 2: sweep

**Files:** Modify `plugin/skills/sweep/SKILL.md` (`## Step 4: Close-out`; `## Failure propagation`). Test: the suite.

`PINS.sweep = [ { file: 'sweep/SKILL.md', from: '## Step 4: Close-out', to: '## Next Actions', patterns: [P_STATEMENT, P_CLOSE, P_INHERITED, [/tidy --approve[\s\S]{0,200}archiv/, 'archival stays with tidy --approve']] }, { file: 'sweep/SKILL.md', from: '## Failure propagation', to: '## Step 4: Close-out', patterns: [[/Step 4's close-out still runs/, 'a failure halt still runs Step 4\'s close-out']] } ]`

Prose: after Step 4's summary log line, `close-run --run "$PIPELINE_RUN_DIR"` on the directory Step 0 created — on the normal path and on the Failure-propagation halt (the bad-argument stop precedes Step 0's mint, so it has nothing to close). Sweep does not archive: the staged remainder waits for `/claude-tweaks:tidy --approve`, which archives the `*-sweep-standalone*` directory (`tidy/approve-mode.md`). Created vs inherited: inherited when `$PIPELINE_RUN_DIR` was already set at invocation (Step 0's resolver adopted it); `An **inherited** directory is never closed`. The component steps never close sweep's directory — it is inherited to them (Task 4 pins backlog's guard).

### Task 3: specify drain

**Files:** Modify `plugin/skills/specify/next-mode-closeout.md` (`## Zero eligible or budget exhausted …`, its `**Close-out.**` paragraph); `plugin/skills/specify/next-mode-shape.md` (`## Failure self-report`, the "Firing-ending failures" paragraph).

`PINS.specify = [ { file: 'specify/next-mode-closeout.md', from: '## Zero eligible or budget exhausted', to: null, patterns: [P_STATEMENT, P_CLOSE, P_INHERITED, [/nothing eligible this firing[\s\S]{0,400}close-run/, 'the nothing-eligible exit still closes']] }, { file: 'specify/next-mode-shape.md', from: '## Failure self-report', to: null, patterns: [[/next-mode-closeout\.md`'s close-out still runs/, 'a firing-ending failure still runs the close-out']] } ]`

Prose: every exit after `## Drain start`'s mint — nothing eligible (closed silently; that exit still renders nothing), drained, budget exhausted, and a firing-ending failure — runs `close-run --run "$(cat "$RUN_DIR_FILE")"` (or the equivalent literal path read from `$RUN_DIR_FILE`). It is the run directory's close, separate from `## Release`'s per-claim release. Inherited when `$PIPELINE_RUN_DIR` was set at the firing's start (a `/claude-tweaks:sweep` parent, `--source sweep`) — `An **inherited** directory is never closed`. No archival (none today).

### Task 4: backlog

**Files:** Modify `plugin/skills/backlog/SKILL.md` (`## Component-Skill Contract`); `backlog/refine-closing-summary.md` (`**Close the run dir.**` paragraph); `backlog/refine-headless.md` (`## Step 5: Report`).

`PINS.backlog = [ { file: 'backlog/SKILL.md', from: '## Component-Skill Contract', to: '## Anti-Patterns', patterns: [P_STATEMENT, P_CLOSE, P_INHERITED, [/--reset-breaker[\s\S]{0,300}overview[\s\S]{0,300}attention|overview[\s\S]{0,300}attention[\s\S]{0,300}--reset-breaker/, 'the statement covers every mode that resolves its own directory']] }, { file: 'backlog/refine-closing-summary.md', from: '**Close the run dir.**', to: null, patterns: [P_INHERITED] }, { file: 'backlog/refine-headless.md', from: '## Step 5: Report', to: '## Cap tracking', patterns: [P_CLOSE] } ]`

(`sliceOf` keys on `\n{from}`, so a bold paragraph lead works as `from`.)

Prose: in the Component-Skill Contract paragraph, after the sentence about resolving its own standalone run dir: whenever this skill created that directory (any mode — `refine` human-present or headless, `--reset-breaker`, `overview`, `attention`), every exit after the mint closes it with `close-run --run <absolute-run-dir>` — the closing summary, the headless Step 5 report, `--reset-breaker`'s exit without touching a record, `overview`'s stop, and any stop after the resolution. A `--source sweep` firing's directory is sweep's: `An **inherited** directory is never closed`. `refine-closing-summary.md`'s existing close gains that inherited guard (inherited when `$PIPELINE_RUN_DIR` was set at invocation). `refine-headless.md` Step 5 gains one sentence: after the report, `close-run --run <absolute-run-dir>` on a created directory (cite the Contract paragraph, don't restate it).

### Task 5: dispatch

**Files:** Modify `plugin/skills/dispatch/SKILL.md` (`### Step 1`, after the "Note which resolution step actually fired (#2430)" paragraph; `### Step 3`, the zero-eligible-groups sentence). Keep total additions under ~1,500 B.

`PINS.dispatch = [ { file: 'dispatch/SKILL.md', from: '### Step 1:', to: '### Step 2:', patterns: [P_STATEMENT, P_CLOSE, P_INHERITED] }, { file: 'dispatch/SKILL.md', from: '### Step 3:', to: '### Step 4:', patterns: [[/Step 1's close-out still runs/, 'the zero-eligible stop still runs Step 1\'s close-out']] } ]`

Prose (Step 1): when `$RUN_ID` was **minted**, every exit after it closes it with `close-run --run "$RUN_ID"`'s directory — zero eligible groups, the repo-wide infra-outage stop, a queue-pull `exit 1`, every `#N`/`#N,#M` stop or completion, and bare-drain loop termination (whose existing bullet in Step 3 stays as that exit's instance). `An **adopted** directory is never closed` — report the existing skip line instead. Step 3's zero-eligible sentence ("…skip this and the rest of Step 3…") gains: Step 1's close-out still runs.

### Task 6: tidy

**Files:** Modify `plugin/skills/tidy/SKILL.md` (`## Step 7.5: Verify Execution`, end of section before `## Routine Configuration`). Do not edit `tidy/step-6-auto.md` (93% of the rail).

`PINS.tidy = [ { file: 'tidy/SKILL.md', from: '## Step 7.5: Verify Execution', to: '## Routine Configuration', patterns: [P_STATEMENT, P_CLOSE, P_INHERITED, [/--approve[\s\S]{0,300}archiv/, 'archival stays with --approve']] } ]`

Prose: when this run created a `{ISO}-tidy-standalone/` directory (Standalone auto, `step-6-auto.md`, or the `--dry-run` mint above), every exit after the mint — Step 7.5's end, `--dry-run`'s stop after Step 6, and any other stop — closes it with `close-run --run "{run-dir}"`. It is not archived here: a later `/claude-tweaks:tidy --approve` finds it by name, not status, and its own idempotent `close-run` + `archive-run` archive it (`approve-mode.md`); an unapproved run ages out via Archival compaction. Inherited (a pipeline or `/claude-tweaks:sweep` parent): `An **inherited** directory is never closed`.

### Task 7: init

**Files:** Modify `plugin/skills/init/SKILL.md` (`## Phase 9: Present Summary and Confirm`, before `### Worktree Policy Finalization`).

`PINS.init = [ { file: 'init/SKILL.md', from: '## Phase 9: Present Summary and Confirm', to: '## Important Notes', patterns: [P_STATEMENT, P_CLOSE, P_INHERITED, [/Stop here/, 'the Scope Gate stop is named']] } ]`

Prose: when this invocation created an `{ISO}-init-standalone/` directory (`phase-3-classification.md` / `update-mode.md`'s auto-mode logging), every exit after the mint closes it with `close-run --run "{run-dir}"` — Phase 9's confirm or decline, the 1u.6 early exit that skips to Phase 9, the Scope Gate's "Stop here", and a per-phase "Done" — before the worktree-always finalization, which stays the last filesystem action. Inherited: `An **inherited** directory is never closed`.

### Task 8: wrap-up

**Files:** Modify `plugin/skills/wrap-up/SKILL.md` (`### Establish the run directory (unconditional)`, after the sentence citing "Phase 4's cleanup item 8").

`PINS['wrap-up'] = [ { file: 'wrap-up/SKILL.md', from: '### Establish the run directory (unconditional)', to: '### Diff-derived ceremony default', patterns: [P_STATEMENT, P_CLOSE, [/Stop and re-engage/, 'the resumable halt is the one exception'], [/`BLOCKED`/, 'a BLOCKED verdict still closes a created directory']] } ]` (no `P_INHERITED`: item 8 is the pipeline's own closer and closes an inherited directory too, by design)

Prose: a **created** directory reaches item 8's `close-run` + `archive-run` on the normal path; every other exit after the mint — a `BLOCKED` verdict (verify exit 3) and any other stop — runs `close-run --run "$RUN_DIR"` on it. The one exception is the Review Console's "Stop and re-engage", the deliberate pause `/claude-tweaks:wrap-up resume` re-enters, which leaves the directory open. A later `/claude-tweaks:wrap-up #{n}` re-adopts a closed directory through step 2 and archives it in item 8.

### Task 9: harness-health dream pass, and the completeness check

**Files:** Modify `plugin/skills/harness-health/dream-pass.md` (`## Running it`). Test: add one test to the suite.

`PINS['harness-health'] = [ { file: 'harness-health/dream-pass.md', from: '## Running it', to: '## Reviewing proposals', patterns: [P_STATEMENT, P_CLOSE, P_INHERITED] } ]`

Also add `AC1.1: every enumerated minter carries a pin` — `assert.deepEqual(MINTERS.filter((m) => !PINS[m]), [])` — and its go-red: deleting one key from a copy of `PINS` makes the same assertion function throw naming it. Step 2 expects both the dream-pass pin and (before adding the key) this test to fail.

Prose: after `dream-scan.js` returns — any proposal count, zero included, or a non-zero exit after the mint (e.g. a rejected `--min-sessions`) — `close-run --run "{printed-run-dir}"` on the directory this pass created; staged proposals stay in it for review (closing deletes nothing). Inherited (`$PIPELINE_RUN_DIR` set and returned by the resolver): `An **inherited** directory is never closed`.

---

## As-built deviations (Common Step 4.5 — all Beneficial)

1. **Residue probe code change (beyond the prose-only plan).** `plugin/bin/lib/residue/probes/pipeline-runs.js` now skips a clean `*-tidy-standalone*` / `*-sweep-standalone*` run dir whose `staged/` is non-empty (93a13b750, tests in `tests/bin-lib/residue/probes-pipeline-runs.test.js`). Without it, closing those dirs (Tasks 2 and 6) exposed their staged items to the next `/tidy` pass's `remedy: auto` archive, hiding them from `/claude-tweaks:tidy --approve` — the final whole-branch review's Important 1.
2. **Wrap-up exits (Task 8).** No `BLOCKED` exit skips item 8 (verify runs after it); the real item-8-skipping exits are `--dry-run` (now closes a created directory) and the resumable "Stop and re-engage" halt (left open; its resume gap is filed as #4312). bcd113450.
3. **Created vs inherited, uniform rule.** Every stamp-less minter states created = the directory did not exist before this invocation's own resolution ran; anything the resolver returned (from `$PIPELINE_RUN_DIR` or a step-2 match) is inherited. Backlog's statement covers only the `refine` forms that resolve the directory (overview/attention never do). Capture's exemption reason no longer cites a line number. b44743eac.

## Notes

- Follow-up for `/build` Common Step 4 (not in this plan's scope): wrap-up's "Stop and re-engage" on a **created** standalone directory leaves it `active`; its `run-state.json` carries no `sessionId`, so session end never marks it `interrupted`, and `resume` (which requires `interrupted`) can never find it. File via `/claude-tweaks:capture`.
- Folded verification (Common Step 5): `npm test` full suite runs once centrally after the last task.
