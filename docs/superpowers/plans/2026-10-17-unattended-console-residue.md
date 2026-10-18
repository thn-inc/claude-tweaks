# Unattended Console Residue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pending-review and contested items that an `unattended` Review Console leaves unresolved are shown to a human: at the run's own final stop, and at a later SessionStart once the run is closed or archived. An unmapped staged prefix also warns when it is staged, not later at the console.

**Architecture:** One new pure module, `plugin/bin/lib/console/residue.js`, owns the predicate ("which `console.json` items are unresolved") and the line format. It has four consumers:
- `console-resolve.js` prints a "Needs a human" block after its table.
- A new `plugin/bin/console-residue.js` CLI prints that block for one run (for the Pipeline Summary) and records a human's acknowledgement (`--ack` / `--ack-all`).
- `session-residue.js` scans closed and archived runs for unacknowledged residue, for both the SessionStart banner and `hooks.js check-session-residue`.
- `stage-item.js` warns on an id that `classifyStagedItem` would route to `unmapped-prefix`.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T191422-record-3370/work/3370-spec.md` (record #3370)

**Scope keywords:** collectApprovableStandalone, check-session-residue, unmapped-prefix, keep-staged

## Global Constraints

- No pending or contested item is ever auto-applied by this change. Every new code path is read-only toward `staged/` and toward resolution. The only write is the human-invoked `--ack`, which writes the additive `residueAcknowledgedAt` field.
- "Unresolved" means `console.json` items whose `resolution` is exactly `pending` or `keep-staged`, and nothing else.
- Every command a rendered line offers is paste-ready, on its own line, with absolute paths.
- SessionStart stays best-effort. A scan error never throws out of `session-start.js`, the same `try { … } catch {}` wrapping as its siblings.
- `stage-item.js`'s warning goes to stderr and never changes the exit code. A canonical id prints nothing to stderr.
- Commit messages: `{Verb} {what} — {detail}`, and reference the record as `refs #3370`. Never write `closes`/`fixes`.

## Review Focus

1. **Item count.** The real archive holds 71 consoles with unresolved items (probed 2026-10-17; one run alone has 17 items). The banner must stay bounded: at most `MAX_REPORTED` runs, at most 5 item lines per run, and a `… and N more` line. Task 4 tests this.
2. **Scan cost on the hot path.** There are 1314 archive dirs. The scan must go newest-first and stop once `MAX_REPORTED` unacknowledged runs are found, never reading every `console.json` per session. Task 4 tests the early exit with a counting `readFile` seam.
3. **Malformed `console.json`.** A malformed file, or a PR-rendered one (items with `kind`/`summary` and no `resolution`), must be skipped silently by the scan. `--ack` must never rewrite a file that does not parse. Tests are in Tasks 1 and 2.
4. **Multi-spec run dirs.** These carry `spec-{N}/console.json` and no top-level console. They must surface too, and `--ack` must cover both levels. Tests are in Tasks 1 and 2.
5. **Extensions.** An id that is canonical only through its extension (`review-2` + `.patch`) must not warn. Task 5 tests this.

---

### Task 1: Residue predicate and formatter

**Files:**
- Create: `plugin/bin/lib/console/residue.js`
- Test: `tests/bin-lib/console/residue.test.js`

**Interfaces:**
- Produces:
  - `UNRESOLVED_RESOLUTIONS`: `Set(['pending', 'keep-staged'])`
  - `unresolvedItems(consoleJson) -> item[]`. Returns `[]` for a non-object input or when `items` is not an array.
  - `readRunResidue(runDir, { readFile, readdir }?) -> { dir, consoles: [{ path, items, acknowledged }] }`. Reads `{runDir}/console.json` and every `{runDir}/spec-*/console.json`.
    - Unparseable or absent files are skipped.
    - `items` holds the unresolved items only. Consoles with zero unresolved items are omitted.
    - `acknowledged` is `typeof residueAcknowledgedAt === 'string'`.
    - The defaults for the injected readers are `fs.readFileSync(p, 'utf8')` and `fs.readdirSync` (try/catch → `[]`).
  - `formatResidueLines({ dir, consoles }, { pluginRoot, maxItems = 5 }) -> string[]`. Exact shape:
    ```
    - {basename(dir)}: {k} item(s) no human has reviewed ({console path, relative to dir, e.g. console.json or spec-12/console.json})
      - {id} — {section}: {resolution} ({reason})
        cat "{consoleDir}/staged/{id}"        ← only when that file exists (fs.existsSync)
      … and {k - maxItems} more — see "{consoleDir}/console.json"   ← only when k > maxItems
      mark reviewed: node "{pluginRoot}/bin/console-residue.js" --ack --run "{dir}"
    ```
    `{consoleDir}` is the dir holding that `console.json`, so a spec-level item's `cat` points at `spec-N/staged/`.

- [ ] **Step 1: Write the failing tests.** Use a tmp dir fixture that writes the real #2821 `console.json` shape. Copy the items verbatim from `.claude-tweaks/pipelines/archive/2026-10-16T210949-spec-2821/console.json` in the main checkout: 9 items. Four are unresolved: `reflect-1.md` pending, `review-13-record.md` pending, `review-debate-deviation.md` keep-staged, and `decision:STAGED 01:00:20 — Step 3: full mode (wrap-up): pattern obs` keep-staged. Tests:
  - `unresolvedItems returns exactly the four pending/keep-staged items of the #2821 console`: assert the ids, in order.
  - `unresolvedItems ignores a PR-rendered console`: items `[{kind:'q', summary:'x'}]` → `[]`. `null` → `[]`.
  - `readRunResidue skips an unparseable console.json and reads spec-*/console.json`: top-level is `'{nope'`, `spec-12/console.json` has 1 pending → one console whose `path` ends `spec-12/console.json`.
  - `readRunResidue marks acknowledged`: `residueAcknowledgedAt: '2026-10-17T00:00:00Z'` → `acknowledged === true`.
  - `formatResidueLines names every item, cats only existing staged files, ends with the ack command`:
    - `staged/review-13-record.md` exists and `staged/reflect-1.md` does not.
    - Assert a line `    cat "{dir}/staged/review-13-record.md"`, and no `cat` line for `reflect-1.md`.
    - Assert the last line equals `  mark reviewed: node "/p/bin/console-residue.js" --ack --run "{dir}"`.
  - `formatResidueLines caps items at maxItems`: 7 pending items, maxItems 5 → 5 item lines plus `… and 2 more`.

- [ ] **Step 2: Run to verify it fails.** Run: `node --test tests/bin-lib/console/residue.test.js`. Expected: FAIL with `Cannot find module '../../../plugin/bin/lib/console/residue'`.

- [ ] **Step 3: Implement `plugin/bin/lib/console/residue.js`** per the Interfaces block. Pure apart from the default fs readers. Header comment cites #3370.

- [ ] **Step 4: Run to verify it passes.** Same command; Expected: PASS.

- [ ] **Step 5: Commit.** `git add plugin/bin/lib/console/residue.js tests/bin-lib/console/residue.test.js`, then `git commit -m "Add console residue predicate and formatter — refs #3370"`.

### Task 2: `console-residue.js` CLI (print + acknowledge)

**Files:**
- Create: `plugin/bin/console-residue.js`
- Modify: `docs/plugin-structure.md`: add one line in the `node plugin/bin/…` CLI list next to `console-resolve.js`'s line, and add `residue.js` to the `plugin/bin/lib/console/` line.
- Test: `tests/bin-lib/console/residue-cli.test.js`

**Interfaces:**
- Consumes: Task 1's `readRunResidue`, `formatResidueLines`. Also `resolveTarget` from `plugin/bin/lib/stage-item/write.js` (anchoring) and `writeFileAtomic` from `plugin/bin/lib/atomic-write.js`.
- Produces: `run(argv, deps) -> exitCode` (sync). Deps: `{ cwd, mainRoot, stdout, stderr, now, pluginRoot }`. `pluginRoot` defaults to `path.resolve(__dirname, '..')`. Usage:
  - `console-residue.js --run <dir>`: print `formatResidueLines` for that run when it has unacknowledged residue; print nothing otherwise. Exit 0.
  - `console-residue.js --ack --run <dir>`: for every console in `readRunResidue` with items, re-read the raw file, parse it, set `residueAcknowledgedAt` to `new Date(now()).toISOString()`, and write it atomically, preserving every other field. Print `claude-tweaks: marked {n} console(s) reviewed for {run-id}`. Exit 0.
  - `console-residue.js --ack-all`: same write over every run Task 4's `collectUnresolvedConsoles(cwd, { limit: Infinity })` yields. Print `claude-tweaks: marked {n} console(s) reviewed across {m} run(s)`. Exit 0.
  - Exit 2: malformed (unknown flag, `--run` missing a value, `--ack` without `--run`, `--ack-all` with `--run`), with the usage line on stderr.
  - Exit 3: `--run` missing, or not anchored under the main checkout per `resolveTarget`. Use the same message shape as `console-resolve.js`.
  - Header comment: exit codes plus #3370.
  - `require.main` guard: `process.exitCode = run(process.argv.slice(2))`.

- [ ] **Step 1: Write the failing tests.** Fixture: the git-root shape `tests/bin-lib/stage-item/cli.test.js` uses (`main/.git` dir), with a run dir under `main/.claude-tweaks/pipelines/archive/2026-10-16T210949-spec-2821/` holding the Task 1 #2821 console. Tests:
  - `--run prints the residue block naming all four unresolved items`: stdout contains `review-13-record.md`, `review-debate-deviation.md`, `reflect-1.md`, and the `--ack --run` line.
  - `--ack writes residueAcknowledgedAt and keeps every other field`: deepEqual of the parsed file minus `residueAcknowledgedAt` against the original object, and `residueAcknowledgedAt === '2026-10-17T12:00:00.000Z'` from an injected `now`. A second `--run` call prints nothing.
  - `--ack never rewrites an unparseable console.json`: the bytes are unchanged and the exit is 0.
  - `--ack covers spec-*/console.json`.
  - `exit 2 on --ack without --run; exit 3 on a run dir outside the main checkout`.
  - `--ack-all marks every unacknowledged run`: two archived runs → both acknowledged.

- [ ] **Step 2: Run to verify it fails.** `node --test tests/bin-lib/console/residue-cli.test.js`. Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement `plugin/bin/console-residue.js`.** `--ack-all` depends on Task 4's `collectUnresolvedConsoles`. Implement Task 4 first, or implement `--ack-all` in this task against that interface and land its test with Task 4. The executor orders Task 4 before this step.

- [ ] **Step 4: Run to verify it passes.** Same command; Expected: PASS.

- [ ] **Step 5: Commit.** Stage the CLI, its test, and `docs/plugin-structure.md`; message `Add console-residue CLI to show and acknowledge unattended residue — refs #3370`.

### Task 3: `console-resolve.js` carries unresolved items into its output

**Files:**
- Modify: `plugin/bin/console-resolve.js` (the final `stdout(...)` near the end of `run`)
- Modify: `plugin/skills/wrap-up/review-console.md`, the "Auto-resolution short-circuit" section's paragraph that begins "Resolve every item in one process". Two sentences:
  - The CLI ends its output with a `Needs a human` block whenever any item resolved `pending`/`keep-staged`.
  - Carry that block verbatim into the consolidated `PushNotification` and into the run's final human-facing stop (`/flow`'s Pipeline Summary `### Needs a human`, Task 6), never only `console.json`.
- Test: `tests/bin-lib/console/cli.test.js` (append)

**Interfaces:**
- Consumes: Task 1's `unresolvedItems`, `formatResidueLines`.
- Produces:
  - Table mode: after the table, when any item is unresolved, print a blank line, then `Needs a human — {k} item(s) this console did not resolve (never auto-applied):`, then `formatResidueLines({ dir: runDir, consoles: [{ path: consolePath, items }] }, { pluginRoot: path.resolve(__dirname, '..') })`.
  - `--json` mode: add `unresolved: item[]` (always present, possibly `[]`).
  - Nothing printed when there are none.

- [ ] **Step 1: Write the failing tests (AC1.1 run-own-final-stop half; AC3.1).**
  - `unattended: an unmapped-prefix item and a contested item print a Needs a human block naming both`. Staged: `{ 'review-13-record.md': 'x', 'review-debate-deviation.md': 'y', 'wrap-up-memory-1.md': 'm' }`. Assert stdout matches `/Needs a human — 2 item\(s\)/` and contains both ids plus `--ack --run`. Assert `wrap-up-memory-1.md` does not appear after the `Needs a human` line.
  - AC3.1: in the same fixture, `console.json`'s `review-13-record.md` item still resolves `pending` and `review-debate-deviation.md` still resolves `keep-staged`, and both staged files are byte-identical after the run, so nothing was applied.
  - `unattended: no unresolved items prints no Needs a human block` (the existing `THREE` fixture).
  - `--json carries unresolved` (both cases).
  - Return-shape widening check: before editing, grep `tests/` for `deepStrictEqual` against the `--json` stdout object and for literal row counts parsed from stdout. Record the hits in the commit body. As of authoring, `cli.test.js` only deepEquals `cj.merge` and grant objects, so no existing assertion is defanged.

- [ ] **Step 2: Run to verify it fails.** `node --test tests/bin-lib/console/cli.test.js`. Expected: FAIL on the two new assertions.

- [ ] **Step 3: Implement** the stdout change, plus the `review-console.md` sentences.

- [ ] **Step 4: Run to verify it passes.** `node --test tests/bin-lib/console/cli.test.js tests/console-resolve-conformance.test.js`. Expected: PASS.

- [ ] **Step 5: Commit.** `Print a Needs a human block for unresolved console items — refs #3370`

### Task 4: SessionStart and `check-session-residue` surface closed/archived residue

**Files:**
- Modify: `plugin/bin/lib/hooks/session-residue.js` (add `collectUnresolvedConsoles`, export it)
- Modify: `plugin/bin/lib/hooks/session-start.js`: a new `try { … } catch {}` block right after the `collectApprovableStandalone` block.
- Modify: `plugin/bin/hooks.js`, the `check-session-residue` branch: include the new list in the "no pending residue" emptiness test and as its own block.
- Test: `tests/bin-lib/hooks/session-residue.test.js` (append), `tests/hooks-session-start.test.js` (append), `tests/hooks-dispatcher.test.js` (append, near the existing `check-session-residue` tests)

**Interfaces:**
- Consumes: Task 1's `readRunResidue`, `formatResidueLines`.
- Produces: `collectUnresolvedConsoles(cwd, { exclude, pluginRoot, limit = MAX_REPORTED, readFile } = {}) -> [{ dir, consoles, lines }]`.
  - Candidates, newest first by basename:
    - clean top-level runs: `ctxLib.iterRunDirsWithState(cwd, { status: 'clean' })`
    - plus every `RUN_ID_RE`-shaped dir under `{mainCheckoutRoot(cwd) || cwd}/.claude-tweaks/pipelines/archive/`
  - Merge the two lists by basename, descending.
  - Skip `exclude` (via `sameDir`).
  - Keep a run when `readRunResidue` yields at least one console with `acknowledged === false`, listing only those consoles.
  - Stop as soon as `limit` runs are kept.
  - `lines = formatResidueLines(...)`.
- Banner text, built with the existing `advisoryBanner(header, lines, trailer)`:
  - Header: `claude-tweaks: closed or archived run(s) whose unattended Review Console left item(s) no human has reviewed:`
  - Trailer:
    - `Read each item, then act on it (apply it, file it with /claude-tweaks:capture, or drop it) and mark the run reviewed with its own command above.`
    - `Relay this list once, in your first reply to the user, one line per item with its command — do not proceed silently without mentioning it.`

- [ ] **Step 1: Write the failing tests (AC1.1 SessionStart half).**
  - session-residue: `collectUnresolvedConsoles surfaces an archived run's unmapped-prefix and contested items with a paste-ready command` (**the record's AC1 fixture**). The archived run `archive/2026-10-16T210949-spec-2821/` holds a console with one `unmapped-prefix` pending item and one `keep-staged` contested item, and its `staged/` holds both files. Assert one entry whose lines include both ids, a `cat "…/staged/review-13-record.md"` line, and the `--ack --run` line.
  - `acknowledged consoles are skipped`; `a clean un-archived run is surfaced too`; `exclude drops the caller's own run`.
  - `stops reading once limit runs are kept`: 6 archived runs, all unresolved, with a `readFile` seam counting `console.json` reads → reads ≤ `MAX_REPORTED` (+ any `spec-*` reads, zero here). The result has length `MAX_REPORTED`, newest first.
  - session-start: `#3370: an archived run with unreviewed console items gets its own banner naming both items`. Assert the header line, both ids, and the relay sentence.
  - hooks-dispatcher: `check-session-residue: reports an archived run's unreviewed console items`. The `runHook` output contains `review-13-record.md`, and not `no pending residue`.

- [ ] **Step 2: Run to verify it fails.** `node --test tests/bin-lib/hooks/session-residue.test.js tests/hooks-session-start.test.js tests/hooks-dispatcher.test.js`. Expected: FAIL on the new tests only.

- [ ] **Step 3: Implement** `collectUnresolvedConsoles`, the banner block, and the `check-session-residue` block. Update `session-residue.js`'s header comment ("Two consumers…") to name the third detection.

- [ ] **Step 4: Run to verify it passes.** Same command, plus `npm run test:perf`. Expected: PASS. The perf suite's SessionStart budget still holds.

- [ ] **Step 5: Commit.** `Surface closed and archived runs' unreviewed console items at SessionStart — refs #3370`

### Task 5: `stage-item.js` warns on an unmapped prefix

**Files:**
- Modify: `plugin/bin/lib/console/resolve.js`: export `CANONICAL_PREFIXES` and `nearestCanonicalPrefixes(id, n = 3)`.
- Modify: `plugin/bin/stage-item.js`: after the successful write, before `return 0`.
- Test: `tests/bin-lib/console/resolve.test.js` (append), `tests/bin-lib/stage-item/cli.test.js` (append)

**Interfaces:**
- Produces:
  - `CANONICAL_PREFIXES`: a literal array with one string per alternative in every `SECTION_MAP` row except the `.patch` row: `'review-unconfirmed-'`, `'review-contested-'`, `'review-debate-'`, `'polish-suggestion-'`, …, `'wrap-up-upstream-'`. Each alternative carries the trailing `-` its regex requires.
  - `nearestCanonicalPrefixes(id, n) -> string[]`: the `n` prefixes with the smallest Levenshtein distance between the prefix and `id.slice(0, prefix.length)`. Ties keep `CANONICAL_PREFIXES` order.
  - Stage-item warning, on stderr, only when `classifyStagedItem(result.id + ext).reason === 'unmapped-prefix'`, where `ext` is `path.extname(o.file)`:
    `stage-item.js: warning: --id {id} matches no Review Console SECTION_MAP prefix — the console will route it to Pending review (unmapped-prefix), never auto-resolved. Nearest canonical prefixes: {a}, {b}, {c}\n`

- [ ] **Step 1: Write the failing tests (AC2.1, AC2.2).**
  - resolve: `every CANONICAL_PREFIXES entry classifies without unmapped-prefix`: for each `p`, `classifyStagedItem(p + '1.md').reason !== 'unmapped-prefix'`.
  - resolve, the go-red control: `every SECTION_MAP row except .patch is covered by some CANONICAL_PREFIXES entry`: each row's regex matches at least one `p + '1.md'`.
  - resolve: `nearestCanonicalPrefixes('review-13-record') includes a review-* prefix`.
  - stage-item cli: `--id review-13-record (.md file) warns naming the unmapped prefix and nearest canonical prefixes; exit 0, file still written`. Assert stderr matches `/--id review-13-record matches no Review Console SECTION_MAP prefix/` and `/Nearest canonical prefixes: .*review-/`.
  - stage-item cli: `a canonical id prints nothing to stderr`: `--id polish-suggestion-1` with a `.md` file → `err.join('') === ''`. Also `--id review-2` with the existing `.patch` fixture → `''`.

- [ ] **Step 2: Run to verify it fails.** `node --test tests/bin-lib/console/resolve.test.js tests/bin-lib/stage-item/cli.test.js`. Expected: FAIL on the new tests.

- [ ] **Step 3: Implement.** Require `../lib/console/resolve` from `stage-item.js`. `resolve.js` already requires `../issues/grant-maturation` and `../wrap-up/pack`; confirm the require has no cycle back to `stage-item/write.js`.

- [ ] **Step 4: Run to verify it passes.** Same command; Expected: PASS.

- [ ] **Step 5: Commit.** `Warn at staging time when a staged id matches no console prefix — refs #3370`

### Task 6: Pipeline Summary renders the run's own residue

**Files:**
- Modify: `plugin/skills/flow/summary-template.md`: one paragraph before the template, plus a `### Needs a human` section in the template, placed directly after `**Reconcile:**`.
- Modify: `plugin/skills/flow/multispec-summary.md`: one sentence. The same CLI runs once against the parent run dir, which covers every `spec-*/console.json`.

**Interfaces:**
- Consumes: Task 2's CLI. Prose: `Run node "{pluginRoot}/bin/console-residue.js" --run "{run-dir}"`, using the archive path when cleanup already archived the run (the same rule the Timing section states). Render its stdout verbatim under `### Needs a human`, and omit the section when it prints nothing. Never hand-compose it.

- [ ] **Step 1:** Edit both files. Before committing, check `wc -c` against the 50 KB ceiling (both files are far under it).
- [ ] **Step 2:** Run `node --test tests/flow-subfile-table-completeness.test.js`. Expected: PASS. The full `npm test` runs once, centrally, at Common Step 5, not per task.
- [ ] **Step 3: Commit.** `Render unattended console residue in the Pipeline Summary — refs #3370`

## Execution order

Task 1 → Task 4 → Task 2 → Task 3 → Task 5 → Task 6. Task 2's `--ack-all` consumes Task 4's scanner.

## Known consequence (stated, not hidden)

Four existing producers stage ids that `SECTION_MAP` does not map: `release-held`, `upstream-draft-{N}`, `shipped-close-*`, and `dispatch-target-missing-*` (grep of `stage-item.js … --id` across `plugin/`). After Task 5 each of them prints the warning. That is the intended fail-loud behavior. Whether any of them deserves a `SECTION_MAP` row is a follow-up decision, recorded in the ledger, not made here.

Waived AC4.1: the full `npm test` (including the archived-run scan and staging-time warning tests added in Tasks 4 and 5) is run once centrally at /build Common Step 5 and again at /test, not as a per-task step.
