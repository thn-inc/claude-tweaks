# Design Parts, Approval and Filing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/claude-tweaks:design` gains steps 8 (Parts and estimate), 9 (Approve) and 10 (File the issues), and `/claude-tweaks:specify`'s decomposition files an approved parts list exactly as written.

**Architecture:** One new pure module, `plugin/bin/lib/design-session/parts.js`, defines the `## Parts` table, the `## Approval` status line, its digest and the worth-it measure, and is the only parser of them; `bin/design-session.js` exposes it as four verbs (`parts`, `digest`, `check-approval`, `mark-filed`), and `status.js` learns steps 8-10. The design skill's prose drives the steps through those verbs; decomposition's Step 2 gains one branch at its top that calls `check-approval` and, on an approved list, takes the parts as its work units, while Steps 2.6-9 keep running with three narrow rules (parent kept for 2+ parts, no gate changes a part's name/size/blockers without asking, the folder is kept and marked instead of deleted).

**Tech Stack:** Node 18+ CommonJS, `node --test`, `node:crypto` sha256; markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-28T055228-spec-6353/work/6353-spec.md` (record #6353)

Waived AC2.3: "(Settled at filing from a red-team finding.)" is provenance of AC2, not a testable clause; AC2.1/AC2.2 are tested.
Waived AC7.5: "(Settled at filing from a red-team finding.)" is provenance of AC7, not a testable clause; AC7.1-AC7.4 are tested.
Waived plugin/skills/specify/SKILL.md: not modified (Global Constraints); Task 4 Step 4's `wc -c` reads it and the `rail:` test pins it.

## Global Constraints

- `plugin/skills/specify/SKILL.md` stays under the 52,500-byte read limit (it is 43,737 B; this plan does not grow it). New decomposition text goes in `decomposition-mode.md` (24,261 B before this change) and its siblings, never in `SKILL.md`.
- Every `plugin/skills/**/*.md` file stays under `RAIL_BYTES` = 52,500 B (`plugin/bin/lib/skill-audit/budgets.js`). Headroom before this change: `decomposition-mode.md` 28,239 B, `decomposition-mode-closeout.md` 31,501 B, `red-team.md` 31,812 B, `record-creation-subissues.md` 21,700 B, `record-creation.md` 35,298 B, `collapse-decision.md` 48,963 B, `mechanical-handoff.md` 42,174 B, `design/SKILL.md` 38,676 B, `help/reference-card.md` 29,967 B, `help/context-flow.md` 31,792 B. No per-file byte pin may be added outside `budgets.js` (`tests/skill-size-single-source.test.js`).
- A part's size uses the labels the repository already has: `size:low`, `size:medium`, `size:high`.
- The parts table, the status line's exact text and the heading holding the worth-it measure are defined once, in `parts.js`'s module header; prose cites the module, never restates the grammar.
- A part's unit slug is a slug of its name, stable across resume; the design-doc slug of a design folder is the folder name without its `YYYY-MM-DD-` prefix. Fingerprint: `{design-doc-slug}:{unit-slug}`.
- Repository is written `owner/name`; a cross-repository blocker is written `owner/name#N`, the form v6 already reads.
- The token estimate's per-size figures come from v6's per-size token use in the model-profile or timing data; when none is found the estimate says so instead of inventing a number. Finding at plan time: none exists — `plugin/bin/lib/timing/` and `plugin/bin/lib/model-profiles/` carry no per-size figure, and `docs/superpowers/specs/2026-11-17-standard-lane-run-graph-design.md` records that `timing.json`'s per-phase token cells are 0 for unattributed phases, "so … no rule may rest on a token cell". The estimate therefore states counts by size and the literal basis sentence pinned in Task 1.
- Skill references inside actionable instruction text use the fully-qualified `/claude-tweaks:{skill}` form.
- Commit message style for hand-written commits: `{Verb} {what} — {detail}`; end every commit message with `Claude-Session: https://claude.ai/code/session_016yg3zq2UETJxc6qz9BGb1Y`.
- Quoted from `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md` (governs `plugin/bin/design-session.js`): "Logic lives in an exported `run(argv, deps)`; every side effect (`runner`, `ghAvailable`, `remoteUrl`, `stdout`, `stderr`) goes through `deps` so tests inject fakes. **Every** `deps` call that can throw (e.g. `remoteUrl` outside a git repo) is try/caught into the documented exit-code contract" and "Above the guard and in everything `run` calls there is no `process.exitCode`, `process.exit()`, `process.chdir()` or write to `process.env`. A relative path is resolved against `deps.cwd()`, never left to `path.resolve` or `fs`".
- Quoted from `.claude/skills/skill-prose-conformance-tests/SKILL.md` (governs every new prose test): "When the pinned prose is added in the same change, there is no frozen excerpt to use as a control. Prove each assertion on a mutated copy of the live text instead: delete or alter only the pinned clause, then assert the shared assertion helper throws **with that assertion's own message** … preceded by `assert.notEqual(mutated, original)` so a replace that matched nothing cannot pass as a control." and "When one region must state many facts, use a missing-facts predicate and prove each fact returns exactly itself." (`tests/helpers/conformance-asserts.js`'s `missingFactsOf`, `assertEachPatternGoesRed`).
- Source-scan lint: code under `plugin/bin/` checks file presence through `plugin/bin/lib/path-guard` (`lstatType`), never a bare `fs.existsSync`/`fs.realpathSync` (`tests/path-guard-conformance.test.js`).
- Real-input probe: waived — no `design.md` with a `## Parts` section exists anywhere yet (`ls -d docs/superpowers/specs/*/` lists only `phase-7-trial-reviews/`); the format is defined by this change. Task 6's real filing is the real input.

## Review Focus

1. A parts table whose `Waits for` names a part that does not exist, names itself, or names a later row → `parseParts` reports an error naming the row, never a silent drop (Task 1 test `waits-for errors`).
2. A `design.md` edited after approval in a way that only touches the Issue column (filing marks) → still approved (Task 1, AC7.3); one touching any other cell → `digest-mismatch` (AC7.2).
3. A `## Parts` section present but unparseable (wrong header row, bad size) → decomposition refuses rather than falling back to its own heuristics (Task 1 `invalid-parts`, Task 4 pin).
4. Two part names that slug to the same unit slug → error, since fingerprints would collide on resume (Task 1 test `slug collision`).
5. A resumed session whose Approval section says `Status: done` but whose digest no longer matches → `status` resumes at step 9 with action `reapprove`, not `complete` (Task 2).

---

### Task 1: The parts-table parser module

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/design-session/parts.js`
- Test: `tests/bin-lib/design-session/parts.test.js`

**Interfaces:**
- Consumes: `sectionLines(designText, heading)` and `sectionField(designText, heading, key)` from `plugin/bin/lib/design-session/design-md.js`; `splitLines` from `./notes`.
- Produces (all pure, no I/O):
  - `PARTS_HEADING = 'Parts'`, `APPROVAL_HEADING = 'Approval'`, `FILING_HEADING = 'Filing'`, `FRAME_HEADING = 'Frame'`, `APPROACHES_HEADING = 'Approaches'`, `MEASURE_KEY = 'Measure'`.
  - `TABLE_HEADER = ['#', 'Part', 'Size', 'Repository', 'Waits for', 'Issue']`, `SIZES = ['size:low', 'size:medium', 'size:high']`.
  - `parseParts(designText) -> { present: boolean, parts: Part[], errors: string[] }`, `Part = { n: number, name: string, slug: string, size: string, repository: string, waitsFor: string[], issue: string|null }`.
  - `partsDigest(designText) -> string|null` — 64-char lowercase hex sha256, null when Frame, Approaches or Parts is missing.
  - `approvalLine(date, digest) -> string` — exactly `Approved: {YYYY-MM-DD} — digest sha256:{hex}`.
  - `checkApproval(designText) -> { approved: boolean, reason: 'approved'|'no-parts'|'invalid-parts'|'not-approved'|'digest-mismatch', parts: Part[], errors: string[], measure: string|null, digest: string|null }`.
  - `estimate(parts) -> { count: number, bySize: {'size:low': n, 'size:medium': n, 'size:high': n}, tokens: null, basis: string, line: string }`.
  - `measure(designText) -> string|null` — the text after `Measure:` in `## Frame`, verbatim (trimmed only at the ends).
  - `unitSlug(name) -> string`; `designSlug(folderName) -> string` (strips a leading `YYYY-MM-DD-`).
  - `markFiled(designText, marks) -> { text: string, unknown: string[] }`, `marks` = `{ [partName]: '#N' | 'left for owner/name' }`; rewrites only the Issue cell of named rows.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/design-session/parts.test.js`, over an inline fixture `APPROVED_FOUR` (a `design.md` with `## Frame` incl. `Measure: weekly orders filed — for 4 weeks`, `## Approaches` with `Chosen: A — …`, a `## Parts` section holding `Status: done`, the six-column table with four rows for `thn-inc/claude-tweaks` — `Parser` (`size:low`, waits `—`), `Decomposition branch` (`size:medium`, waits `Parser`), `Skill steps` (`size:medium`, waits `Parser`), `Docs and help` (`size:low`, waits `Decomposition branch, Skill steps`) — an `Estimate:` line, and `## Approval` with `Status: done` plus the `approvalLine` built from `partsDigest` of the same text). Tests:
  - `AC1.1/AC1.2: four parts parse with their names and blockers, in table order` (the fixture-driven half of AC1.2; Task 7 is the real-filing half) — `parseParts` names `['Parser','Decomposition branch','Skill steps','Docs and help']`, `waitsFor` of row 4 `['Decomposition branch','Skill steps']`, `errors` `[]`.
  - `AC3.1: no status line → not-approved` — `APPROVED_FOUR` with the `Approved:` line removed: `checkApproval(...).approved === false`, `reason === 'not-approved'`.
  - `AC7.1/AC7.4: the digest covers frame, approach and parts; editing one cell after approval refuses` — change row 2's Size to `size:high`: `reason === 'digest-mismatch'`; separately change one word of `## Frame`'s Problem line and of `## Approaches`: both `digest-mismatch`.
  - `AC7.2/AC7.3: filed-issue marks are left out of the digest` — `markFiled(APPROVED_FOUR, {Parser: '#7001'})` then `checkApproval` → `approved: true`, `parts[0].issue === '#7001'`.
  - `AC5.1: the measure is read word for word` — `measure(APPROVED_FOUR) === 'weekly orders filed — for 4 weeks'`.
  - `no parts section → no-parts` — a design.md with Frame and Approaches only: `reason === 'no-parts'`, `present === false`.
  - `invalid-parts` — wrong header row order, a size `small`, an empty Part cell, a repository `claude-tweaks` (no owner): each yields one `errors` entry naming its row, `checkApproval(...).reason === 'invalid-parts'`.
  - `waits-for errors` — a part waiting for an unknown name, for itself, or for a later row: each one error; `owner/name#N` and `#N` entries are accepted as external blockers.
  - `slug collision` — parts `Docs & help` and `Docs help` → one error; `unitSlug('Docs and help') === 'docs-and-help'`; `designSlug('2026-11-27-factory-v7-slice1') === 'factory-v7-slice1'`.
  - `estimate` — over `APPROVED_FOUR`'s parts: `count 4`, `bySize {'size:low':2,'size:medium':2,'size:high':0}`, `tokens null`, `line === 'Estimate: 4 parts — 2 size:low, 2 size:medium, 0 size:high. Tokens: not estimated — v6 records no per-size token use in its timing or model-profile data.'`
  - `approvalLine` — `approvalLine('2026-11-28', 'a'.repeat(64)) === 'Approved: 2026-11-28 — digest sha256:' + 'a'.repeat(64)`.
  - `fences` — a `## Parts` line inside a fenced block in an earlier section is not read as the section (reuse `sectionLines`' fence rule).

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/bin-lib/design-session/parts.test.js`
Expected: FAIL with `Cannot find module '../../../plugin/bin/lib/design-session/parts'`

- [ ] **Step 3: Implement `plugin/bin/lib/design-session/parts.js`** with the Interfaces above. The module header comment is the single definition of: the `## Parts` heading and its place (after `## Builder check`, before `## Decisions`), the six-column header row in that exact order, each column's grammar (`#` 1-based and consecutive; Part non-empty and unique by slug; Size one of `SIZES`; Repository `owner/name`; Waits for `—` or empty for none, else comma-separated entries each a part name from an earlier row, `owner/name#N`, or `#N`; Issue ignored by the approval, written only by `markFiled`), the rule that the part that makes the order visible to a user is the last row, the `Estimate:` line, the `## Approval` section's `Approved:` status line text, the digest input (the `## Frame` and `## Approaches` section lines without their `Status:` line, plus each table row's first five cells, every line right-trimmed, joined with `\n`, the three blocks each prefixed by its heading line), `## Frame`'s `Measure:` line as the worth-it measure, the parent issue's `## Worth-it measure` heading, the `## Filing` section, `unitSlug` (lowercase; every run of characters other than `a-z0-9` becomes one `-`; trimmed of `-`; never the literal `parent`, which is an error) and `designSlug`. Digest via `require('node:crypto').createHash('sha256')`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/bin-lib/design-session/parts.test.js`
Expected: PASS, every test green.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/design-session/parts.js tests/bin-lib/design-session/parts.test.js
git commit -m "Add the design parts-table parser — one definition of parts, approval line, digest and measure"
```

### Task 2: Status steps 8-10 and the four CLI verbs

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/design-session/status.js` (`SECTIONS`, the per-step loop, the reapprove branch)
- Modify: `plugin/bin/design-session.js` (header usage, `USAGE`, `VALUE_FLAGS`, `VERBS`, `runVerb`)
- Test: `tests/bin-lib/design-session/status.test.js`, `tests/bin-lib/design-session/cli.test.js`

**Interfaces:**
- Consumes: Task 1's `parseParts`, `checkApproval`, `partsDigest`, `estimate`, `markFiled`, `designSlug`, `PARTS_HEADING`, `APPROVAL_HEADING`, `FILING_HEADING`.
- Produces:
  - `readStatus` returns `steps` keyed 1..10. Step 8 is `done` only when its section says `Status: done` and `parseParts` has no errors; step 9 `done` only when `Status: done` and `checkApproval(...).approved`; step 10 `done` only when `Status: done` and every part has an `issue`. When step 9's section says `done` but the digest does not match, `readStatus` returns `{ resumeAt: 9, action: 'reapprove', round: null, openSerious: [] }`. All other branches unchanged; `resumeAt: 'complete'` only after step 10.
  - `design-session.js parts --folder <dir>` → stdout `{ present, parts, errors, estimate }`; exit 0 when present with no errors, 1 otherwise.
  - `design-session.js digest --folder <dir>` → stdout `{ ok: true, digest }` exit 0, or `{ ok: false, reason: 'missing-sections' }` exit 1.
  - `design-session.js check-approval --folder <dir>` → stdout `checkApproval(...)` plus `designSlug` (of the folder's basename); exit 0 when approved, 1 otherwise.
  - `design-session.js mark-filed --folder <dir> --marks <file>` → reads the JSON object at `--marks` (relative to `deps.cwd()`), validates each value matches `^#\d+$` or `^left for [A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`, writes `design.md` in place through `deps.fs`, prints `{ marked: [names], unknown: [names] }`; exit 0 when `unknown` is empty, 1 otherwise (nothing written); exit 2 on an unreadable or malformed `--marks` file.
  - A missing `design.md` in `--folder` is exit 2 for all four verbs (same rule as `check-evidence`).

- [ ] **Step 1: Write the failing tests.** In `status.test.js`: replace the existing `['complete', null, null]` expectation's fixture so steps 8-10 are present and done; add `steps 1-7 done, no Parts → resumeAt 8 start`; `Parts done with an invalid row → resumeAt 8 continue`; `Approval Status done but a Size cell edited → resumeAt 9 reapprove` (`AC6.1: an edit to the parts table after approval asks for a new approval first`); `Filing done but one part unmarked → resumeAt 10 continue`. In `cli.test.js` (its existing in-process `run(argv, deps)` harness): `parts` exit 0 and the estimate line; `digest` exit 0 with a 64-hex digest equal to `partsDigest`; `check-approval` exit 0 on the approved fixture, exit 1 with `reason: 'not-approved'` after the `Approved:` line is removed (`AC3.1`), `designSlug` `factory-v7-slice1` for a folder named `2026-11-27-factory-v7-slice1`; `mark-filed` writes `#7001` into row 1 and leaves `check-approval` at exit 0 (`AC7.3`), exit 1 with `unknown: ['Nope']` writing nothing, exit 2 on a non-JSON marks file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/design-session/status.test.js tests/bin-lib/design-session/cli.test.js`
Expected: FAIL after Step 1 — `resumeAt` is `'complete'` where 8 is expected, and `unexpected argument 'parts'`.

- [ ] **Step 3: Implement.** `status.js`: add `8: 'Parts', 9: 'Approval', 10: 'Filing'` to `SECTIONS` (the comment says adding a step is one row; the three content checks above are the extra conditions, applied after the per-step loop like the storyboard file check); the reapprove return goes before the generic `first` lookup returns for step 9. `design-session.js`: add the four verbs, `--marks` to `VALUE_FLAGS`, and their lines to the header comment and `USAGE`; presence checks via `lstatType`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/design-session/`
Expected: PASS for every file in the directory (brief, evidence, folder, notes, status, cli, parts).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/design-session/status.js plugin/bin/design-session.js tests/bin-lib/design-session/status.test.js tests/bin-lib/design-session/cli.test.js
git commit -m "Teach design-session steps 8-10 — parts, digest, check-approval and mark-filed verbs"
```

### Task 3: The design skill's steps 8, 9 and 10

**Role:** integration

**Files:**
- Create: `plugin/skills/design/step-8-parts.md`, `plugin/skills/design/step-9-approve.md`, `plugin/skills/design/step-10-file.md`
- Modify: `plugin/skills/design/SKILL.md` (description, When to Use "Not for", Session folder paragraph's "writes nothing outside it", the `design.md` section-order sentence, Steps table, Next Actions, Component-Skill Contract, Anti-Patterns)
- Modify: `plugin/skills/design/step-7-builder-check.md` (section 4's last sentence: `status` now resumes at step 8, not `'complete'`; render no Next Actions there)
- Test: `tests/design-skill-conformance.test.js`

**Interfaces:**
- Consumes: Task 2's verbs, written in prose as `node "${CLAUDE_PLUGIN_ROOT}/bin/design-session.js" parts --folder "{folder}"`, `… digest --folder "{folder}"`, `… check-approval --folder "{folder}"`.
- Produces: the prose Task 4's decomposition branch cites — step 10 invokes `/claude-tweaks:specify {design.md path}`.

Content each sub-file must carry (one short section each, in the style of `step-5-alternatives.md`):
- `step-8-parts.md`: add `## Parts` after `## Builder check` with `Status: in-progress`; work the parts out with the maintainer from the chosen approach and the storyboard, written in `parts.js`'s table (cite the module header, do not restate the grammar); the part that makes the order visible to a user goes last; a part for another repository names it in Repository; run `parts --folder` and fix every reported error until exit 0; write its `estimate.line` under the table as printed; show the table and estimate, confirm, set `Status: done`.
- `step-9-approve.md`: show the frame, the chosen approach, the parts and the estimate; one `AskUserQuestion` — `Approve the design, its parts and estimate (Recommended)` / `Change something first`; on approve run `digest --folder` and write `## Approval` with `Status: done` and the line `Approved: {YYYY-MM-DD} — digest sha256:{digest}`; append the decision (`by: maintainer`). **The approval rule:** once approved, the skill changes the frame, the approach or the parts only after asking for a new approval — it first sets the Approval section back to `Status: in-progress` and removes the `Approved:` line, makes the change, then runs this step again; `status`'s `reapprove` action (a `done` Approval whose digest no longer matches, e.g. after a hand edit) runs this step again the same way.
- `step-10-file.md`: run `check-approval --folder`; non-zero → stop and show the reason, run step 9 again; on exit 0 invoke `/claude-tweaks:specify {design.md path}` (repository-relative path) with the Skill tool — decomposition files the parts as written, marks each part's Issue cell and keeps the folder; then run `parts --folder` and check every part has an Issue mark; write `## Filing` with `Status: done` and `Parent: #{N}` (or `Parent: none — one part`); for a part left for another repository, tell the maintainer to run step 10 in that repository with the same design folder.

SKILL.md changes: description and opening paragraph end with "parts and estimate, approval, filing" instead of "builder check"; Lifecycle line unchanged; the "Not for" bullet "Building anything. This skill ends after the builder check and never starts a build." becomes "Building anything. This skill ends once the parts are filed and never starts a build."; "The skill writes nothing outside it" gains "except step 10, which files issues and commits through `/claude-tweaks:specify`"; section order adds `## Parts`, `## Approval`, `## Filing` after `## Builder check`, before `## Decisions`; Steps table gains rows 8-10 (`step-8-parts.md` / `## Parts` / `Status: done` and `parts` exits 0; `step-9-approve.md` / `## Approval` / `Status: done` and `check-approval` exits 0; `step-10-file.md` / `## Filing`, issue marks / `Status: done` and every part marked); Next Actions renders after step 10 (or `resumeAt: 'complete'`) the resume line only, since `/claude-tweaks:specify` already rendered the flow commands for the filed parts; Component-Skill Contract states that step 10 invokes `/claude-tweaks:specify`; Anti-Patterns: the "Writing outside the folder…creating an issue, committing…" row keeps its ban outside step 10, and a new row "Changing the frame, approach or parts after approval without a new approval | The filed issues stop matching what the maintainer approved — the problem this step exists to close".

- [ ] **Step 1: Write the failing tests** in `tests/design-skill-conformance.test.js`: add the three files to `FILES`; `AC6.1: step 9 asks for a new approval before changing an approved frame, approach or parts` — `missingFactsOf` over `step-9-approve.md` for the Status-back-to-in-progress clause, the removed `Approved:` line, and the `reapprove` action, each proven by `assertEachPatternGoesRed`; `step 10 files only through /claude-tweaks:specify` — the pinned literal `/claude-tweaks:specify {design.md path}` and the `check-approval` call; CLI-call pins for `parts`, `digest`, `check-approval` with `DS` prefix; the Steps table has rows 8, 9 and 10 in order (`requireOrder`, with a permutation control); a go-red control per new assertion via `mutate(...)` matched to its own message.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/design-skill-conformance.test.js`
Expected: FAIL with `ENOENT` on `step-8-parts.md`.

- [ ] **Step 3: Write the three sub-files and the SKILL.md / step-7 edits** listed above. Before editing, grep `tests/` for distinctive phrases of each edited block (`ends after the builder check`, `writes nothing outside it`, `resumeAt: 'complete'`, `Writing outside the folder`) and re-point every hit.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/design-skill-conformance.test.js tests/skill-catalog-completeness.test.js`
Expected: PASS. Then `wc -c plugin/skills/design/SKILL.md` prints under 52,500.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/design/ tests/design-skill-conformance.test.js
git commit -m "Add design steps 8-10 — parts and estimate, approval with a digest, filing through specify"
```

### Task 4: Decomposition takes an approved parts list as its work units

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/skills/specify/decomposition-mode.md` (a new first subsection of Step 2, `### Approved parts list (checked first)`, plus one clause in Implicit Dependency Detection)
- Modify: `plugin/skills/specify/collapse-decision.md` (one paragraph before "**1 work unit**")
- Modify: `plugin/skills/specify/record-creation.md` (Parent record body: the `## Worth-it measure` section; Idempotency: the design-doc slug of a design folder)
- Modify: `plugin/skills/specify/record-creation-subissues.md` (Scoring and Slug derivation: an approved part's size and slug are taken, not judged)
- Test: `tests/specify-approved-parts-conformance.test.js` (new)

**Interfaces:**
- Consumes: `node "${CLAUDE_PLUGIN_ROOT}/bin/design-session.js" check-approval --folder "{folder}"` (Task 2) — its JSON `parts[].{name,slug,size,repository,waitsFor}`, `measure`, `designSlug`, `reason`.
- Produces: the approved-branch outputs Task 5 forwards — per unit: title = part name, size label = part size, unit slug = part slug, blockers = Waits for; the run's `left-for` list (parts whose Repository is not this checkout's `gh repo view --json nameWithOwner -q .nameWithOwner`); the `measure` for the parent.

The branch's prose must state, in this order:
1. When the design doc is a `design.md` in a folder that holds a `## Parts` section, run `check-approval --folder "{the design.md's folder}"` before anything else in Step 2.
2. Exit 0 → the parts are this run's work units, in table order: each unit's title is the part's name, its `size:` label the part's Size, its unit slug the part's `slug`, its blockers the part's Waits for (a part name becomes the sibling sub-issue's link in Step 4; `owner/name#N` and `#N` stay as written). Skip `### Sizing Guidelines`, `### Decomposition Heuristics` (its rewrite-signal check included) and `--granularity`. Implicit Dependency Detection, Overlap Analysis, the file-overlap check, Step 2.6 and Steps 3 to 9 run as today, with the rules below.
3. A part whose Repository is not this checkout's repository is not filed: it is listed in Step 9's summary as left for that repository's run; a filed part blocked on it keeps the blocker as the part's name, written `Blocked by: {part name} (left for {owner/name})`, until that repository's run writes the `owner/name#N` form.
4. **No gate changes an approved part.** Any step from here to Step 9 whose outcome would change a part's name, size or blockers — an overlap resolution, an implicit-dependency link, a red-team resolution, a scoring judgment — stops and asks with one `AskUserQuestion`: `Keep the part as approved (Recommended)` / `Change it — the design goes back for a new approval`; choosing the change stops decomposition and names `/claude-tweaks:design {argument}`. With no human reachable it keeps the part as approved and stages the finding (red-team write-back step 5's staging).
5. Exit 1 with `reason: 'no-parts'` → Step 2 runs as today (no parts section). Exit 1 with any other reason → stop before Step 3: `The design is not approved ({reason}) — run /claude-tweaks:design {argument} to approve its parts, then decompose again.` Exit 2 → stop and show stderr.
6. The parent's body carries `## Worth-it measure` followed by `measure` word for word.

`collapse-decision.md`'s paragraph: "**An approved parts list fixes the decision.** Two or more approved parts always keep the parent, whatever the signals below say; one approved part collapses as below." `record-creation.md`: the design-doc slug of a design folder is `check-approval`'s `designSlug`; the parent body gains the `## Worth-it measure` section on the approved branch. `record-creation-subissues.md`: on the approved branch, `$SUB_ISSUE_SIZE` is the part's Size without the `size:` prefix and `$UNIT_SLUG` is the part's `slug` — no judgment, no `deriveSlug`; risk is still judged.

- [ ] **Step 1: Write the failing tests** in `tests/specify-approved-parts-conformance.test.js`, one `missingFactsOf` region per file with `assertEachPatternGoesRed`, each fact matching exactly once in its region:
  - `AC1.1: an approved list's parts become the work units, in order, with their names and blockers` — decomposition-mode.md facts 1-2 above.
  - `AC2.1: two or more approved parts keep the parent` — collapse-decision.md's paragraph, with a move-out control (paragraph moved below "**3+ work units**" goes red on its ordering assertion).
  - `AC2.2: no gate changes an approved part's name, size or blockers without asking` — fact 4.
  - `AC3.1: an unapproved parts section is refused with the not-approved message` — fact 5's second sentence.
  - `AC4.1: no parts section falls through to today's Step 2` — fact 5's `no-parts` clause, and `requireOrder` proving the branch sits before `### Sizing Guidelines`.
  - `AC5.1: the parent carries the worth-it measure word for word` — record-creation.md's `## Worth-it measure` clause.
  - `a part for another repository is left for that repository's run` — fact 3.
  - `the check-approval call is pinned` — the literal `node "${CLAUDE_PLUGIN_ROOT}/bin/design-session.js" check-approval --folder`.
  - AC8.1 (`plugin/skills/specify/SKILL.md` stays under the 52,500-byte read limit) is covered by the existing test `rail: every shipped skill .md fits one Read call (bytes and lines)` in `tests/bin-lib/skill-audit/context-cost.test.js`, run in Step 4 — no new byte pin (one outside `budgets.js` fails `tests/skill-size-single-source.test.js`). The same test covers `decomposition-mode.md`'s own read limit (spec Gotcha), so no size check is added.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/specify-approved-parts-conformance.test.js`
Expected: FAIL — the first fact's pattern does not match `decomposition-mode.md`.

- [ ] **Step 3: Write the prose** above into the four files. Grep `tests/` for `Decomposition Heuristics`, `Sizing Guidelines`, `1 work unit — always collapses`, `Parent body = design summary` and `Scoring\*\* — judge each sub-issue` and re-point any pin the insertions disturb.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/specify-approved-parts-conformance.test.js tests/specify-decomposition-collapse.test.js tests/specify-decomposition-crossref-prose.test.js tests/specify-decomposition-lazy-closeout.test.js tests/specify-record-creation-linking.test.js tests/record-queue-fetch-conformance.test.js tests/session-tmp-root-migration.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS (AC4.2: the existing decomposition suites pass unchanged). Then `wc -c plugin/skills/specify/decomposition-mode.md plugin/skills/specify/SKILL.md` — both under 52,500, `SKILL.md` still 43,737.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/specify/decomposition-mode.md plugin/skills/specify/collapse-decision.md plugin/skills/specify/record-creation.md plugin/skills/specify/record-creation-subissues.md tests/specify-approved-parts-conformance.test.js
git commit -m "Let decomposition file an approved parts list as written — parts are the work units"
```

### Task 5: Red-team, close-out and the mechanical handoff keep the parts as approved

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/specify/red-team.md` (write-back step 5)
- Modify: `plugin/skills/specify/decomposition-mode-closeout.md` (Step 7 table row + command, Step 9 summary: `### Left for another repository` block and the Artifacts Removed line)
- Modify: `plugin/skills/specify/mechanical-handoff.md` (Required-inputs row and the dispatch prompt's matching line)
- Read, no change expected: `plugin/skills/specify/planning.md` — its `## Decomposition` entry reads the sub-issues Step 3 created (re-fetched labels), not Step 2's output, so the approved branch does not change its input; Step 3 below reads it to confirm.
- Test: `tests/specify-approved-parts-conformance.test.js` (extend), `tests/specify-mechanical-handoff.test.js` (re-run; extend if it pins the Required-inputs table row set)

**Interfaces:**
- Consumes: Task 4's approved-branch outputs and Task 2's `mark-filed` verb: `node "${CLAUDE_PLUGIN_ROOT}/bin/design-session.js" mark-filed --folder "{folder}" --marks "{marks file}"`.
- Produces: none for later tasks.

Prose content:
- `red-team.md` step 5: "On an approved parts list (`decomposition-mode.md`'s Approved parts list), a finding whose resolution would change a part's name, size or blockers is always decision-worthy and is never applied: it is staged or asked as above, and the part stays as approved; the red-team may still write its marker or Open Questions row."
- Close-out Step 7: a new table row first — "Approved parts list (Step 2's approved branch) | **No** — the design folder is kept, since it holds the evidence and the notes. Mark each filed part with its issue and each part left for another repository with `left for {owner/name}`: write the marks to a session temp JSON file with the Write tool, run `mark-filed`, and commit `design.md` with this step's commit." The `git rm` block does not run on this branch.
- Close-out Step 9: under the approved branch the summary's Artifacts line reads `Design folder kept: {path} (parts marked filed)`, and a `### Left for another repository` block lists each such part with its repository and the rerun line `/claude-tweaks:design {argument}` (step 10, in that repository's checkout).
- Mechanical handoff: Required-inputs row "Approved parts (omit unless Step 2 took the approved branch) | `check-approval`'s JSON (parts, measure, designSlug), the folder path, the left-for list | Step 3 titles, sizes and slugs each unit from it and writes the measure on the parent; Step 5 keeps every part as approved; Step 7 marks and keeps the folder instead of deleting it", plus the dispatch prompt's `Approved parts:` line.

- [ ] **Step 1: Write the failing tests** — extend `tests/specify-approved-parts-conformance.test.js`: `AC2.2: red-team never changes an approved part` (red-team.md clause); `the design folder is kept and its parts marked filed` (Step 7 row, the `mark-filed` literal, and `requireOrder` proving the row precedes the `git rm` block); `parts left for another repository appear in the Step 9 summary`; `the mechanical handoff carries the approved parts` (row + prompt line).

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/specify-approved-parts-conformance.test.js`
Expected: FAIL on the red-team clause.

- [ ] **Step 3: Write the prose.** First read `plugin/skills/specify/planning.md`'s `## Decomposition` section and `mechanical-handoff.md`'s whole Required-inputs table and Dispatch prompt (the callers of Step 2's output) and record in the commit body that planning.md needs no change and why. Grep `tests/` for `Delete Consumed Artifacts`, `Artifacts Removed`, `Decision-worthy findings stage instead` and `Required inputs` to find pins to re-point.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/specify-approved-parts-conformance.test.js tests/specify-mechanical-handoff.test.js tests/specify-net-empty-teardown.test.js tests/specify-red-team-cross-ac-literal-check.test.js tests/specify-red-team-implicit-discovery-check.test.js tests/specify-review-fail-closed-guard-conformance.test.js tests/specify-planning-conformance.test.js`
Expected: PASS. `wc -c` on the three files — each under 52,500.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/specify/red-team.md plugin/skills/specify/decomposition-mode-closeout.md plugin/skills/specify/mechanical-handoff.md tests/specify-approved-parts-conformance.test.js
git commit -m "Keep approved parts intact through red-team and close-out — mark the folder, never delete it"
```

### Task 6: Skill graph, /help, CLAUDE.md and the behavior-change sweep

**Role:** integration

**Files:**
- Modify: `docs/skill-graph.md` (`## design`'s `/specify` row; a new `/design` row in `## specify`)
- Modify: `plugin/skills/help/reference-card.md` (the `/claude-tweaks:design` row's description)
- Modify: `plugin/skills/help/context-flow.md` (the `/design` and `/specify` rows of the artifact table; the "Design docs are deleted by `/specify`" bullet)
- Modify: `CLAUDE.md` (the `claude-tweaks Pipeline` section's **Artifacts:** line)
- Modify or classify no-change: every hit of the sweep below
- Test: `tests/design-skill-conformance.test.js` (extend), plus the suites the edited files are pinned by

Content: an order enters through `/claude-tweaks:design`; its step 10 invokes `/claude-tweaks:specify` on the approved `design.md`, and decomposition files the approved parts list as written (parts are the work units; 2+ parts keep the parent; the folder is kept, parts marked filed; parts for another repository are left for that repository's run). `CLAUDE.md`'s Artifacts line: "design doc (one file, phases = `## Phase N` sections), or a `/claude-tweaks:design` session folder whose approved `## Parts` are filed as written → spec (one per work unit, via `/claude-tweaks:specify`) → `/claude-tweaks:flow`." — CLAUDE.md is always loaded, so keep the edit to that clause.

- [ ] **Step 1: Write the failing test** — in `tests/design-skill-conformance.test.js`, `the skill graph and /help say decomposition files an approved parts list as written`: `docs/skill-graph.md`'s `## specify` section has a `/design` row naming `check-approval`; `context-flow.md`'s `/design` row names the parent issue and sub-issues filed through `/claude-tweaks:specify`; each with a mutation control.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/design-skill-conformance.test.js`
Expected: FAIL on the skill-graph assertion.

- [ ] **Step 3: Edit and sweep.** Make the edits above, then run the sweep and list each hit in the commit body as changed or no-change: `git grep -n -i -E "ends after the builder check|after step 7|deletes? the (consumed )?design doc|design docs are deleted|never creates an issue|creating an issue" -- plugin docs CLAUDE.md README.md`. If `README.md`'s artifact lifecycle diagram changes, `help/SKILL.md`'s must match it (CLAUDE.md Cross-references rule).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test` (impact-selected) and, since prose pins are in play, `npm test -- --full` before the PR leaves draft (spec Gotcha). Redirect output to a file and read the summary.
Expected: 0 failures.

- [ ] **Step 5: Commit**

```bash
git add docs/skill-graph.md plugin/skills/help/reference-card.md plugin/skills/help/context-flow.md CLAUDE.md tests/design-skill-conformance.test.js
git commit -m "Say where an order enters — design files its approved parts through specify as written"
```

### Task 7: One real filing, quoted in the pull request

**Role:** judgment

**Files:**
- Create (scratch, uncommitted): a throwaway git repo under the session scratchpad with `CLAUDE.md` declaring `work-backend: local-files`, and an approved `docs/superpowers/specs/2026-11-28-approved-parts-demo/design.md` with four parts for one repository (built with Task 2's `digest` verb)
- Modify (not a file): the PR body of #6369 — a Real filing block

This task is run by the controller, not a dispatched implementer. It covers AC1.2's real-filing half (one real filing quoted in the pull request) without creating GitHub issues in this repository: the local-files driver files real records through the same decomposition procedure.

- [ ] **Step 1:** Build the scratch repo and run `node {worktree}/plugin/bin/design-session.js check-approval --folder {folder}`; Expected: exit 0, four parts.
- [ ] **Step 2: Run the filing:** `claude -p --plugin-dir "{worktree}/plugin" "/claude-tweaks:specify docs/superpowers/specs/2026-11-28-approved-parts-demo/design.md"` from the scratch repo root, output redirected to a file. Expected before Tasks 4-5 land: the run does not take the approved branch (FAIL); after: four `specs/{id}-*.md` sub-issue records plus one parent, names and `Blocked by` lines matching the table, in order, and `design.md`'s Issue cells marked.
- [ ] **Step 3:** Quote the created records' titles, blockers and the marked table in the PR body's `### Real filing` block; if the headless run cannot complete (an `AskUserQuestion` it cannot answer), record that verbatim as the outcome and stage it for the Review Console instead of claiming the clause.
