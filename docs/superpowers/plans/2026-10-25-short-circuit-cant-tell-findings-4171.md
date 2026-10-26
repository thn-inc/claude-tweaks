# Short-circuit can't-tell findings (#4171) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A run that merges through the wrap-up auto-merge short-circuit (no Review Console, no `console.json`) can no longer archive with a can't-tell tiebreak finding unfiled, and the short-circuit's FYI names every such finding.

**Architecture:** One new pure-ish module, `plugin/bin/lib/console/finding-outcomes.js`, owns "which can't-tell findings does this run hold, and which already carry a `filed as #N (work-fingerprint …)` decisions.md line". Three consumers use it: `console-filings.js --fyi` (the FYI's Low-confidence / Contested / Dropped-by-tiebreak markdown), `archive-merged.js` (a new `cant-tell-unfiled` archive skip on the reconcile path, scoped to console-less auto-merge runs), and `hooks.js archive-run` (the same refusal on the verb path). The skill prose in `wrap-up/auto-merge-short-circuit.md` gains a "Can't-tell findings" step: at `consoleAutoResolve` it files them via `review-console.md`'s existing "Can't-tell filings" procedure; below it, or on any filing failure, it refuses the short-circuit so the normal console renders them.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill files.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T131017-record-4171/work/4171-spec.md`

**Scope keywords:** finding-outcomes, unfiledCantTell, cant-tell-unfiled, renderFindingFyi

## Global Constraints

- Filed-evidence line shapes (both `AUTO`, written via `log-decision.js --text`): created `'{item} filed as #{number} (work-fingerprint {fingerprint})'`; deduped (already exists in `review-console.md`) `'{item} already filed as #{number} (work-fingerprint {fingerprint})'`. Fingerprint shape is `consolefinding-{8 hex}` (`health-core/fingerprint.js`'s `fingerprintFromBasis`).
- New archive skip reason literal: `cant-tell-unfiled`. It is a structurally-stuck reason.
- The short-circuit refusal line must not contain the word `needs-human` — `console/resolve.js`'s `needsHumanVerdict` would read it as a merge-check verdict and force `leave-open`.
- Guard scope is exactly the console-less auto-merge runs `consoleReplacedByAutoMerge(dir)` already recognizes, with top-level `console.json` absent (`readTopLevelConsoleState(dir) === 'none'`). Every other run's archival is unchanged.
- `RAIL_BYTES` = 52,500. Headroom at authoring: `auto-merge-short-circuit.md` 33,093 B, `review-console.md` 32,718 B, `_shared/autonomy-ceiling.md` 36,545 B — each task adds well under 4 KB.
- Commit style `{Verb} {what} — {detail}`, `refs #4171`, never `closes`/`fixes`. Never `git stash`.

## Review Focus

1. A can't-tell finding duplicated within the batch (two items, one fingerprint): the second item must count as filed once the first's fingerprint has a filed line — pinned in Task 1 (`AC1.1: an in-batch duplicate rides on its twin's filed line`).
2. A `filed as #N` phrase inside a non-`AUTO` line (e.g. a `SKIP` trace quoting it) must not count as filing evidence — pinned in Task 1.
3. A legacy Low-confidence row (no tiebreak verdict) must never block archival — it has no fingerprint and is not a can't-tell item — pinned in Task 1 and Task 3.
4. A run whose console DID render (`console.json` present, or a `Review Console: terminal decision` line) must archive exactly as before even with unfiled can't-tell items — pinned in Task 3.
5. A multi-spec run's `spec-N/` can't-tell items are reported `spec-N/`-prefixed and checked against that spec dir's own `decisions.md` — pinned in Task 3.

---

### Task 1: `finding-outcomes.js` — filed evidence, outcomes, unfiled set, FYI renderer

**Files:**
- Create: `plugin/bin/lib/console/finding-outcomes.js`
- Modify: `plugin/bin/lib/console/resolve.js` (`findingItems` return; extract and export `renderDroppedBlock`; `renderRows` uses it)
- Modify: `docs/plugin-structure.md:37` (append one sentence describing finding-outcomes.js to the `plugin/bin/lib/console/` entry)
- Test: `tests/bin-lib/console/finding-outcomes.test.js`

**Interfaces:**
- Consumes: `resolve.js` `findingItems({ runDir, deps })`, `runIdOf(runDir)`; `finding-filing.js` `planFilings({ items, findings, runId })`.
- Produces:
  - `resolve.js` `findingItems` now returns `{ items, findings, decisions, dropped }` — `decisions` the raw decisions.md text (`''` when absent), `dropped` = `droppedByTiebreak(decisions)` (existing shape `{ id, lens, path, line, severity, evidence }`). Existing `items`/`findings` unchanged (only consumer `.items`/`.findings` — `console-filings.js:112`, `tests/bin-lib/console/resolve.test.js:703`).
  - `resolve.js` `renderDroppedBlock(dropped) -> string[]` — the lines `renderRows` emits today for the block (`''`, `'#### Dropped by tiebreak (read-only — no decision)'`, `''`, header, separator, rows); `[]` when `dropped` is empty. `renderRows` output stays byte-identical.
  - `finding-outcomes.js` exports:
    - `FILED_LINE_RE` — matches an `AUTO` decisions line carrying `(?:already )?filed as #(\d+) \(work-fingerprint (consolefinding-[0-9a-f]{8})\)`; anchored on `^- AUTO `.
    - `filedRecords(decisions: string) -> Map<string, number>` — fingerprint → record number, first line wins.
    - `cantTellOutcomes({ runDir, deps }) -> { rows, dropped }` — `rows` one per Low-confidence/Contested item from `findingItems`, in its order: `{ id, section, tiebreak (object|null), fingerprint (string|null), filedAs (number|null) }`. `fingerprint` for a can't-tell item is `planFilings({ items: [{ ...item, resolution: 'filed' }], findings, runId: runIdOf(runDir) })[0].fingerprint`; `null` for a legacy row.
    - `unfiledCantTell({ runDir, deps }) -> [{ item, fingerprint }]` — can't-tell rows whose `fingerprint` has no `filedRecords` entry, one per distinct fingerprint (first item wins).
    - `renderFindingFyi({ rows, dropped }) -> string` — `''` when both are empty. Otherwise up to three sections joined by `\n`: `#### Low-confidence findings` and `#### Contested findings` (each only when it has rows) with table `| Item | Path:Line | Severity | Lens | Recommendation | Filed as |` (`—` for null fields; `Filed as` is `#N` or `—`), then `renderDroppedBlock(dropped)`. Every cell escaped with resolve.js's `cell` (export it).

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/console/finding-outcomes.test.js`, using a tmpdir run dir with `decisions.md` + `review-findings.json` built like `console-filings-cli.test.js`'s `seed()` (`- STAGED … Tiebreak tiebreak:{id}: lens "3a" finding {file}:{line} console: verdict:cant-tell. Severity: medium. Recommendation: file.`) and deps `{ readFile, readdir }`:
  - `AC1.1: unfiledCantTell lists every can't-tell finding with no filed line` — 2 findings, no filed lines → 2 entries, `item` = `tiebreak:{id}`, `fingerprint` matching `/^consolefinding-[0-9a-f]{8}$/`.
  - `AC1.1: a created or deduped AUTO filed line clears its finding` — append `- AUTO 10:01:00 — Queue write: tiebreak:{id0} filed as #501 (work-fingerprint {fp0}). Reversibility: n/a.` and `- AUTO 10:01:01 — Queue write: tiebreak:{id1} already filed as #77 (work-fingerprint {fp1}). Reversibility: n/a.` → `[]`.
  - `AC1.1: an in-batch duplicate rides on its twin's filed line` — two verdict lines whose findings share lens/path/claim (different ids/lines) and one filed line for the shared fingerprint → `[]`; with no filed line → exactly 1 entry.
  - `a filed phrase in a non-AUTO line is not evidence` — the same text on a `- SKIP ` line → finding still unfiled.
  - `a legacy row is never unfiled` — only a `- STAGED … Single-read (low tier): lens "3b" finding src/legacy.js:4 not directly verified. Staged to Review Console as low-confidence.` line → `unfiledCantTell` `[]`; `cantTellOutcomes` row has `fingerprint: null`, `filedAs: null`.
  - `AC2.1: renderFindingFyi names every can't-tell finding` — output contains every `tiebreak:{id}`, `#### Low-confidence findings`, `Filed as`, and `#501` for the filed one; a high-severity `dropped: refuted by tiebreak` line (shape: `- AUTO … Tiebreak tiebreak:{id}: lens "3a" finding src/x.js:3 dropped: refuted by tiebreak. Evidence: src/x.js:3 "q". Severity: high. Reversibility: high.`) renders under `#### Dropped by tiebreak (read-only — no decision)`.
  - `renderFindingFyi is empty for a run with no findings` → `''`.
  - `renderRows is unchanged by the dropped-block extraction` — `resolveAll`'s `table` for a fixture with one high drop equals the pre-change literal block (assert the five block lines verbatim).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/console/finding-outcomes.test.js`
Expected: FAIL — `Cannot find module '…/finding-outcomes'`

- [ ] **Step 3: Implement** `resolve.js` changes and `finding-outcomes.js` per the Interfaces block. Header comment names #4171, the two producer lines (`wrap-up/auto-merge-short-circuit.md`'s Can't-tell findings, `wrap-up/review-console.md`'s Can't-tell filings) and that it never calls `gh`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/console/finding-outcomes.test.js tests/bin-lib/console/resolve.test.js tests/bin-lib/console/console-filings-cli.test.js`
Expected: PASS

- [ ] **Step 5: Commit** — `git add` the four files; `git commit -m "Add finding-outcomes module — which can't-tell findings a run holds and which are filed, refs #4171"`

### Task 2: `console-filings.js --fyi`

**Files:**
- Modify: `plugin/bin/console-filings.js` (header comment, `USAGE`, `parseArgs`, `run`)
- Modify: `docs/plugin-structure.md:158` (add the `| --run <dir> --fyi` alternative and one clause describing it)
- Test: `tests/bin-lib/console/console-filings-cli.test.js`

**Interfaces:**
- Consumes: Task 1's `cantTellOutcomes`, `renderFindingFyi`.
- Produces: `console-filings.js --run <dir> --fyi` — read-only, prints `renderFindingFyi(cantTellOutcomes(...))` followed by `\n` when non-empty, prints nothing when empty, exit 0. Same refusals as `--list`: combined with `--existing`/`--out-dir`/`--only`/`--list` → exit 2; unanchored/missing run dir → exit 3.

- [ ] **Step 1: Write the failing tests** in `console-filings-cli.test.js`:
  - `AC2.1: --fyi prints every can't-tell finding and writes nothing` — `seed(f, { n: 2 })`, writes recorded via override → stdout contains both `tiebreak:{id}` and `#### Low-confidence findings`; `writes` is `[]`.
  - `--fyi on a run with no findings prints nothing` → exit 0, `out.join('') === ''`.
  - `--fyi with --existing, --out-dir, --only or --list is exit 2`.
  - extend the `--help` test's flag list with `'--fyi'`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/console/console-filings-cli.test.js`
Expected: FAIL after Step 1 — the new tests fail with `unknown argument: --fyi` (the file's existing tests already pass)

- [ ] **Step 3: Implement** the `--fyi` flag (boolean, like `--list`; mutually exclusive with it).

- [ ] **Step 4: Run to verify they pass** — same command, Expected: PASS

- [ ] **Step 5: Commit** — `"Add console-filings --fyi — the short-circuit FYI's finding sections, refs #4171"`

### Task 3: reconcile archive guard — `cant-tell-unfiled`

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` (`unfiledCantTellFindings`, `runTiebreakCoverage`, `archiveUnlessTiebreakGap`, `CANT_TELL_UNFILED_HINT`, `STRUCTURALLY_STUCK_REASONS` + its comment, `skippedEntry`, `archiveMergedRun`'s return, the clean loop's `onSkip`, `module.exports`)
- Modify: `plugin/bin/lib/reconcile/index.js:502-504` (pass `unfiled` through to `result.runs` like `missing`)
- Modify: `plugin/bin/lib/reconcile/escalate-residue.js:121-127` (name `cant-tell-unfiled` in the reason list; one remedy line)
- Modify: `docs/reconcile-checks.md` (one paragraph after the #3945 tiebreak paragraph; add the reason to the consolidated-escalation reason list)
- Test: `tests/bin-lib/reconcile/archive-merged.test.js`, `tests/bin-lib/reconcile/escalate-residue.test.js`

**Interfaces:**
- Consumes: Task 1's `unfiledCantTell({ runDir, deps })` with deps `{ readFile: (p) => fs.readFileSync(p, 'utf8'), readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } } }`.
- Produces:
  - `unfiledCantTellFindings(runDir) -> string[]` — `[]` unless `readTopLevelConsoleState(runDir) === 'none' && consoleReplacedByAutoMerge(runDir)`; otherwise the `item` ids of `unfiledCantTell` for `runDir` plus each `listSpecDirs(runDir)` dir (sorted), the latter prefixed `spec-N/`. A throw while reading fails closed: return `['(unreadable: {message})']`.
  - `runTiebreakCoverage(dir)` returns `{ ...checkRunTiebreakCoverage(...), unfiledCantTell: unfiledCantTellFindings(dir) }`.
  - `archiveUnlessTiebreakGap(coverage)`: existing artifact checks first (only when `artifactPresent`), then `unfiledCantTell.length > 0` → `{ action: 'skip', reason: 'cant-tell-unfiled', unfiled, hint: CANT_TELL_UNFILED_HINT }`.
  - `CANT_TELL_UNFILED_HINT` (exported) = `"file the run's can't-tell findings through wrap-up/review-console.md's Can't-tell filings (console-filings.js --run {run-dir}), logging each as '{item} filed as #{n} (work-fingerprint {fp})', or write a resolved console.json"`.
  - Skip entries and `archiveMergedRun`'s skipped result carry `unfiled` when present.

- [ ] **Step 1: Write the failing tests** in `archive-merged.test.js` (reuse its existing merged-PR / fixture helpers):
  - `AC1.1: decideArchiveCore skips cant-tell-unfiled when coverage names unfiled findings` — `decideArchiveCore({ state: 'MERGED', … }, 'none', false, undefined, { artifactPresent: false, unfiledCantTell: ['tiebreak:abc'] })` → `{ action: 'skip', reason: 'cant-tell-unfiled', unfiled: ['tiebreak:abc'], hint: CANT_TELL_UNFILED_HINT }`; with `unfiledCantTell: []` → archive.
  - `AC1.1: unfiledCantTellFindings names an auto-merge run's unfiled can't-tell finding` — run dir with a `Fast-lane auto-merge: issue #12, assess-agent-autonomy verdict auto-merge` AUTO line + one can't-tell verdict + `review-findings.json`, no `console.json` → `['tiebreak:{id}']`; after appending the created filed line → `[]`.
  - `a rendered console turns the guard off` — same run with a `console.json` `{"resolved":true}` → `[]`; and (separately) with a `Review Console: terminal decision` line → `[]`.
  - `a non-auto-merge run is never guarded` — no auto-merge line → `[]`.
  - `a spec dir's unfiled finding is spec-prefixed` — finding under `spec-7/` → `['spec-7/tiebreak:{id}']`.
  - `cant-tell-unfiled is structurally stuck` — `STRUCTURALLY_STUCK_REASONS.has('cant-tell-unfiled')` (export the set if it is not exported).
  - In `escalate-residue.test.js`: the body names `` `cant-tell-unfiled` `` in its reason list and carries a line starting `` For a `cant-tell-unfiled` directory ``.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/escalate-residue.test.js`
Expected: FAIL after Step 1 — the new tests fail with `unfiledCantTellFindings is not a function` / missing reason text (the files' existing tests already pass)

- [ ] **Step 3: Implement** per the Interfaces block. The clean loop's `onSkip` tracks `cant-tell-unfiled` the way it tracks the two tiebreak reasons. Update the comment blocks above `STRUCTURALLY_STUCK_REASONS`, `iterCleanRunDirs` and the clean loop to name it.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/escalate-residue.test.js tests/reconcile.test.js`
Expected: PASS

- [ ] **Step 5: Commit** — `"Refuse reconcile archival of an auto-merge run holding an unfiled can't-tell finding — cant-tell-unfiled, refs #4171"`

### Task 4: `hooks.js archive-run` refusal

**Files:**
- Modify: `plugin/bin/hooks.js` (archive-run branch, inside the existing `consoleState === 'none' && consoleReplacedByAutoMerge(runDir)` block, after the staged-pending refusal)
- Modify: `docs/reconcile-checks.md` (the Task 3 paragraph gains one sentence: archive-run refuses the same condition)
- Test: `tests/archive-run-verb.test.js`

**Interfaces:**
- Consumes: Task 3's `unfiledCantTellFindings`, `CANT_TELL_UNFILED_HINT`.
- Produces: stdout `claude-tweaks: archival refused — cant-tell-unfiled ({n} can't-tell finding(s) an auto-merge path never filed: {ids joined ', '}) — {CANT_TELL_UNFILED_HINT}, then re-run archive-run\n`, exit 0, nothing moved.

- [ ] **Step 1: Write the failing tests** in `archive-run-verb.test.js` (reuse its terminal-run fixture):
  - `AC1.1: archive-run refuses an auto-merge run with an unfiled can't-tell finding` — stdout matches `/archival refused — cant-tell-unfiled/` and names `tiebreak:{id}`; the run dir still exists.
  - `archive-run archives the same run once its finding has a filed line` — append the created filed line → archived (assert whatever the file's existing success tests assert).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/archive-run-verb.test.js`
Expected: FAIL after Step 1 — the first new test archives instead of refusing (the file's existing tests already pass)

- [ ] **Step 3: Implement** the refusal.

- [ ] **Step 4: Run to verify they pass** — same command, Expected: PASS

- [ ] **Step 5: Commit** — `"Refuse archive-run on an auto-merge run holding an unfiled can't-tell finding, refs #4171"`

### Task 5: short-circuit prose — file or refuse, and the FYI

**Files:**
- Modify: `plugin/skills/wrap-up/auto-merge-short-circuit.md` — new `**Can't-tell findings — before acceptance labeling (#4171).**` paragraph placed after the Verdict backstop block (ends "…never passes through shell quoting.") and before `**Both layers pass — acceptance labeling runs first, before the merge.**`; and in both FYI sentences (`pr-first`: "Still generate this console's full content (Auto-applied / Skill updates / Configuration updates sections, …) and attach it to a `PushNotification`"; `local-merge`: the same sentence) add the `console-filings.js --fyi` output.
- Modify: `plugin/skills/wrap-up/review-console.md:95` — after "File each printed `file` entry's `proposal` through step 7's check-then-create before the next dir's call;" add the created-record log line (same `log-decision.js` shape as the deduped one, text `'{item} filed as #{number} (work-fingerprint {fingerprint})'`).
- Modify: `plugin/skills/_shared/autonomy-ceiling.md:173` — in the `consoleAutoResolve` row's can't-tell sentence, after "the live-session caller per `wrap-up/review-console.md`'s "Can't-tell filings"," add "the auto-merge short-circuit per `wrap-up/auto-merge-short-circuit.md`'s Can't-tell findings (which refuses the short-circuit instead when this capability is not granted),".
- Test: `tests/auto-merge-short-circuit-cant-tell.test.js` (new)

**Interfaces:**
- Consumes: Task 2's `--fyi`; Task 1's `FILED_LINE_RE` (the test asserts the documented line shapes, substituted, match it — prose/code twin).

The new paragraph must say, in this order:
1. This branch renders no console, so nothing else files a can't-tell Low-confidence/Contested finding before the merge closes the record and reconcile archives the run.
2. List them: `node "${CLAUDE_PLUGIN_ROOT}/bin/console-filings.js" --run "$PIPELINE_RUN_DIR" --list`; rows with `cantTell: true`. None → continue below unchanged.
3. Resolve the ceiling as `review-console.md`'s Auto-resolution short-circuit does and check `bookkeepingPermissions(ceiling).consoleAutoResolve`.
4. Granted: file every can't-tell item now — whatever the tiebreak recommended — through `review-console.md`'s "Can't-tell filings" procedure with `{item-run-dir}` = `$PIPELINE_RUN_DIR`, which logs each created record as `{item} filed as #{number} (work-fingerprint {fingerprint})` and each deduped one as `{item} already filed as #{number} (…)`. Those lines are what `archive-run` and reconcile read (`cant-tell-unfiled`).
5. Not granted, or any non-zero `console-filings.js` exit or failed create: do not merge. Log `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status AUTO --step "Auto-merge short-circuit" --reversibility n/a --text-file "{text-file}"` with the one line `#{n} has {k} can't-tell finding(s) ({ids}) — {consoleAutoResolve not granted at {ceiling} | filing failed: {reason}}; short-circuit refused, Review Console renders normally` (text-file per the Verdict backstop's own rule — `{reason}` can carry an error message), then go to "Any layer fails" below; the rendered console carries the rows, and at `unattended` its own Can't-tell filings dedups anything this call already filed.

- [ ] **Step 1: Write the failing test** `tests/auto-merge-short-circuit-cant-tell.test.js` reading the live files:
  - `AC1.1: the short-circuit lists, then files or refuses, before acceptance labeling` — index of `Can't-tell findings — before acceptance labeling` is greater than the index of `never passes through shell quoting` and less than the index of `**Both layers pass — acceptance labeling runs first`; the paragraph contains `--list`, `consoleAutoResolve`, `Can't-tell filings`, `short-circuit refused, Review Console renders normally`, and `"Any layer fails"`.
  - `AC1.1: the refusal line never reads as a needs-human verdict` — the refusal template text does not match `/needs-human/i`.
  - `AC1.1: the documented filed lines match the guard's reader` — substitute `tiebreak:aaaaaaaaaaaa`, `501`, `consolefinding-0123abcd` into `review-console.md`'s created and deduped `--text` templates (extract each by its literal `filed as #{number} (work-fingerprint {fingerprint})` / `already filed as #{number}`), prefix `- AUTO 10:00:00 — Queue write: `, and assert `FILED_LINE_RE` matches both and `filedRecords` maps the fingerprint to 501.
  - `AC2.1: both FYI sentences carry the --fyi sections` — `auto-merge-short-circuit.md` contains `console-filings.js" --run "$PIPELINE_RUN_DIR" --fyi` at least twice (pr-first and local-merge FYI sentences).
  - `autonomy-ceiling names the short-circuit as a can't-tell filing caller` — the `consoleAutoResolve` row contains `auto-merge-short-circuit.md`'s Can't-tell findings.
  - go-red control: one helper `assertShortCircuitOrder(text)` used by the first test; a control test runs it on the file text with the new paragraph removed and expects it to throw.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/auto-merge-short-circuit-cant-tell.test.js`
Expected: FAIL — the paragraph is absent

- [ ] **Step 3: Edit the three skill files** per the Files block and the ordered paragraph content above.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/auto-merge-short-circuit-cant-tell.test.js tests/auto-merge-short-circuit-verdict-backstop.test.js tests/auto-merge-short-circuit-ledger-deletion.test.js tests/auto-merge-short-circuit-dispatch-call.test.js tests/log-decision-text-file-sites-conformance.test.js tests/review-console-unattended-no-ask-conformance.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS

- [ ] **Step 5: Commit** — `"File or refuse can't-tell findings in the auto-merge short-circuit, and list them in its FYI, refs #4171"`

## Real-input probe

Before the whole-branch review, run `unfiledCantTellFindings` and `console-filings.js --fyi` against the archived run `.claude-tweaks/pipelines/archive/2026-10-23T213805-spec-3946-3949-3816-3950` (main checkout). It holds only `dropped`/`digested` tiebreak lines, all severity low, and no can't-tell `console` verdict (independent count: `grep -c "console: verdict" …/spec-3949/decisions.md` → 0), so the expected outputs are `[]` and an empty `--fyi`.

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (resolve finding items or refuse) | 5 (prose), 1/3/4 (filed evidence + guards) |
| Deliverable 2 (FYI lists findings + Dropped by tiebreak) | 1 (renderer), 2 (`--fyi`), 5 (prose) |
| AC1.1 (never archives unfiled; record or named-reason refusal) | 1, 3, 4, 5 |
| AC2.1 (FYI names every can't-tell finding) | 1, 2, 5 |
| AC3.1 (`npm test` passes) | Common Step 5 verification |
