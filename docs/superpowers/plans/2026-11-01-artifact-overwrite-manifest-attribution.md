# Artifact-overwrite manifest-window attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the multi-spec artifact-overwrite check attribute an untrailered commit to a spec through `manifest.yml`'s phase-transition windows, so a spec's own review fix to its own story/journey file stops tripping the HARD-GATE.

**Architecture:** `plugin/bin/lib/flow/artifact-overwrite-check.js` gains two exported pure helpers (`computeSpecWindows`, `attributeByWindow`) and a cached per-commit attribution (refs trailer first, then the single manifest window holding the commit's author date, else none) that replaces the refs-only `getRefs` in the same-spec self-edit test. The CLI `plugin/bin/check-artifact-overwrite.js` gains `--run <dir>`: it anchors the dir through `lib/stage-item/write.js`'s `resolveTarget`, reads `{dir}/manifest.yml`, parses it with `manifest.js`'s `parseManifestYaml`, and passes the result as `opts.manifest`. The procedure doc passes `--run "{parent}"`.

**Tech Stack:** Node 18+ CommonJS, `node --test`, git CLI via the module's injectable `git(argv, cwd)` runner.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T000440-record-4593/work/4593-spec.md` (record #4593)

## Global Constraints

- Use the commit's **author** date (`%aI`), never the committer date.
- Author date and message come from one git call per commit: `git log -1 --format=%aI%n%B {sha}` (first line = date, the rest = message) — no extra git call per commit.
- Parse the manifest with `manifest.js`'s `parseManifestYaml` — no second YAML reader. `manifest.js` itself is not modified.
- Trailer attribution takes precedence over the manifest window.
- A commit whose author date falls inside no window, or inside more than one, stays unattributed — never guessed.
- **Plan Review Clarification Q2 (Reading B):** window attribution turns off whenever the manifest names a `not-run` spec (a spec whose `status` is `not-run`, or any of whose `phases[].status` is `not-run`) — the check then behaves refs-only for that run.
- Fail closed: an unattributable self-edit stays in `overwrites[]`, exit code stays 1.
- The unattributable reason contains the literal `unattributable — no refs trailer and no manifest window` and never contains `refs trailer does not match`.
- `--run <dir>` with an unanchored dir, or no readable / parseable `manifest.yml` → exit 3, stderr names the problem (the manifest path for a read/parse failure). Without `--run`, behavior is today's refs-only.
- Every existing test in `tests/bin-lib/flow/artifact-overwrite-check.test.js` and `tests/bin-lib/flow/check-artifact-overwrite-cli.test.js` passes unchanged — append new tests, never edit existing ones.
- Fixture commits pin both `GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE`.
- Commit messages: `{Verb} {what} — {detail}`, body `refs #4593`, never `closes`/`fixes`.
- Governing skill `gh-api-module-pattern` (`cli-wrapper-contract.md`), quoted verbatim:
  - "A guard added to an existing `run(argv, deps)` reaches the environment through `deps` too. … inject it (`deps.cwd`, `deps.mainRoot`, `deps.isAnchored`) as you write it, and add the fake to every consuming test's deps object in the same commit."
  - "A read-only run-dir *reader* still owes a stated boundary posture. … Pick one when you write the reader: import `lib/stage-item/write.js`'s `resolveTarget` and refuse a non-anchored `--run` on the sanctioned writers' exit 3, or state in the header why an unanchored read is safe for this CLI's callers"

Waived plugin/bin/lib/flow/manifest.js: read only — Task 2 imports `parseManifestYaml` and `manifestPath`; the spec expects no change to it.
Waived AC7.1 for AC3 and the pure-helper unit tests: per Plan Review Clarification Q1 (Reading B), AC7 covers only the fallback-dependent fixtures (AC1, AC2, AC4, AC5); AC3 is proven by reverting its unattributable reason string (Task 1 Step 5), and the `computeSpecWindows`/`attributeByWindow` unit tests are exempt.

## Review Focus

1. Parallel-wave overlap: a spec still transitioning after the next spec started must make commits in the overlap unattributed, not attributed to the later spec — otherwise B overwriting A's file inside the overlap reads as B self-editing (a false clean). Pinned in Task 1 (`computeSpecWindows: a spec still transitioning after the next spec started overlaps it`, and the overlap fixture with its clean control).
2. Spec ids are numbers from `refs #N` but numbers or strings from `parseManifestYaml`'s `coerceId` — attribution compares as strings so trailer `#10` and window `10` match. Pinned in Task 1 (AC4's trailer-in-B-window self-edit history).
3. A manifest spec with no `startedAt` but `phases[]` uses its earliest `phases[].at`; a spec with neither gets no window. Pinned in Task 1 (`computeSpecWindows` unit tests).
4. An unparseable `%aI` line (empty, garbage) yields no window, never a throw. Pinned in Task 1 (`attributeByWindow` with `NaN`).
5. A `--run` path not anchored under the cwd's main checkout (a worktree-local shadow, `[IL-127]`) must be refused (exit 3) rather than read — a stale shadow manifest would give confident wrong windows. Pinned in Task 2.

---

### Task 1: Manifest-window attribution in the check module

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/flow/artifact-overwrite-check.js` (header test 1 at lines 17-20 and the fail-closed note at 62-64; `getRefs` at 357-364; the self-edit loop and reason strings at 384-424; JSDoc at 319-327; `module.exports`)
- Test: `tests/bin-lib/flow/artifact-overwrite-check.test.js` (append new tests)

**Interfaces:**
- Produces: `checkArtifactOverwrite(opts)` accepts optional `opts.manifest` — the object `parseManifestYaml` returns (`{ multispec: { parent, specs: [{ id, status?, startedAt?, phases?: [{ phase, status, at }] }] } }`), or `null`/`undefined` for refs-only.
- Produces: `computeSpecWindows(manifest) -> Array<{ id: string, start: number, end: number }>` (ms epoch; `end` is `Infinity` for the last window), exported. Returns `[]` for a falsy manifest, one with no `multispec.specs` array, or one naming a `not-run` spec.
- Produces: `attributeByWindow(windows, timeMs) -> string | null` — the one window id whose `[start, end)` contains `timeMs`; `null` for zero or several matches, or a non-finite `timeMs`; exported.

**Window rule (the algorithm the tests do not fully determine):** for each spec, `first` = `Date.parse(startedAt)` when finite, else the earliest finite `Date.parse(phases[].at)`; `last` = the latest finite value among `startedAt` and every `phases[].at`. Drop specs with no finite `first`. Sort by `first` ascending. Window i = `[first_i, end_i)` where `end_i = Math.max(first_{i+1}, last_i)` for every window but the last, and `Infinity` for the last. The `Math.max` with `last_i` is what makes a still-running spec's window overlap the next one (Review Focus 1); in a sequential run `last_i < first_{i+1}` and it reduces to the spec's "up to the next spec's first recorded transition".

**Attribution:** replace `getRefs` with a cached `getAttribution(sha) -> { ids: Set<string>, source: 'refs trailer' | 'manifest window' | null }`: one `git(['log', '-1', '--format=%aI%n%B', sha], cwd)` call; ids = `extractRefs(message)` stringified when non-empty (source `refs trailer`); else `attributeByWindow(windows, Date.parse(dateLine.trim()))` when non-null (source `manifest window`); else empty (source `null`). Windows are computed once per call from `opts.manifest`.

**Self-edit verdict per deleted line (blamed sha present):** the deleting commit's or the blamed commit's attribution empty → overwrite, unattributable culprit; else no intersection → overwrite, mismatch culprit; else self-edit.

**Reasons:**
- mismatch: `deleted line {L} (as of parent {commit}~1) traces to commit {blamed}, attributed to {fmt(blamed)}, which does not match {commit}'s own attribution {fmt(commit)}, and the deletion is neither a list reflow, a step-markup reformat, a step renumber, nor a reference-preserving Origin line`, where `fmt` renders `#10, #11 (refs trailer)` / `#10 (manifest window)`.
- unattributable: `deleted line {L} (as of parent {commit}~1) traces to commit {blamed} — unattributable — no refs trailer and no manifest window for {the deleting commit | the blamed commit | either commit}, so the same-spec self-edit test cannot run, and the deletion is neither a list reflow, a step-markup reformat, a step renumber, nor a reference-preserving Origin line`.
- no-blame reason unchanged.

- [ ] **Step 1: Write the failing tests** — append to the test file a `commitAt(fx, message, iso)` helper (passes `env: { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso }` to `git commit`) and a `manifestOf(specs)` helper returning `{ multispec: { parent: 'p/', specs } }`. Fixture timeline: spec A = id `10` with `startedAt` and phases at `2026-01-01T10:00:00Z` (running) and `2026-01-01T11:00:00Z` (complete); spec B = id `12` with `startedAt`/phase at `2026-01-01T12:00:00Z`. Every fixture file is `stories/x-A.yaml`, walked with `paths: ['stories/']`; the modify commit changes one of its lines. Tests:
  - `computeSpecWindows: sequential specs partition the timeline, last window open-ended` — ids `['10','12']`, A `end === Date.parse('2026-01-01T12:00:00Z')`, B `end === Infinity`.
  - `computeSpecWindows: startedAt missing falls back to the earliest phases[].at; a spec with neither gets no window`.
  - `computeSpecWindows: a spec still transitioning after the next spec started overlaps it` — A also has a phase at 13:00 → A `end === Date.parse('2026-01-01T13:00:00Z')`, and `attributeByWindow(windows, Date.parse('2026-01-01T12:30:00Z')) === null`.
  - `computeSpecWindows: a manifest naming a not-run spec yields no windows` — add spec `14` with `status: 'not-run'` → `[]`; and a spec whose only `phases[]` entry has `status: 'not-run'` → `[]`.
  - `attributeByWindow: no window, or a non-finite time, is null` — a time before every start → `null`; `NaN` → `null`.
  - `AC1.1 AC1.2 AC1.3: an untrailered self-edit inside spec A's window passes clean with the manifest supplied` — add at 10:15, modify at 10:45, no trailers, `manifest` supplied → `clean: true`.
  - `AC2.1 AC2.2: the modifying commit inside spec B's window is still an overwrite` — modify at 12:30 → exactly one overwrite, with that path and the modifying commit's sha; its reason does not match `/unattributable/`.
  - `AC3.1 AC3.2: with no manifest, an untrailered self-edit reports an unattributable overwrite` — AC1's history, no manifest → one overwrite; reason matches `/unattributable — no refs trailer and no manifest window/` and does not match `/refs trailer does not match/`.
  - `AC4.1: a refs trailer takes precedence over the manifest window` — history 1: add untrailered at 10:15, modify at 10:45 with `(refs #12)` → one overwrite whose reason does not match `/unattributable/`; history 2: add untrailered at 10:15, modify at 12:30 (B's window) with `(refs #10)` → `clean: true`.
  - `AC5.1: an author date before every spec's first transition leaves the commit unattributed` — add at 09:00, modify at 10:45, no trailers, manifest supplied → one overwrite matching `/unattributable/`; control in the same test, same history, a manifest whose A starts at 08:00 → `clean: true`.
  - `overlapping windows leave a commit unattributed` — A phases at 10:00 and 13:00, B at 12:00; add at 12:15, modify at 12:45, no trailers → one overwrite matching `/unattributable/`; control in the same test, same history, A's phases at 10:00 and 11:00 only (no overlap, both commits in B's window) → `clean: true`.
  - `a manifest naming a not-run spec falls back to refs-only` — AC1's history with spec `14` (`status: 'not-run'`) added to the manifest → one overwrite matching `/unattributable/`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/flow/artifact-overwrite-check.test.js`
Expected: FAIL after Step 1 — `computeSpecWindows is not a function`, and the AC1 fixture reports `clean: false`.

- [ ] **Step 3: Implement** the helpers, `getAttribution`, the verdict and the reasons above in `plugin/bin/lib/flow/artifact-overwrite-check.js`; add `@param {object|null} [opts.manifest]` to the JSDoc; rewrite header test 1 to name both attribution sources in order, the no-window/several-windows rule and the not-run switch-off; update the closing "Fails closed" note to say an unattributable self-edit is reported with its own `unattributable` reason. Export `computeSpecWindows` and `attributeByWindow`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/flow/artifact-overwrite-check.test.js`
Expected: PASS, every existing test included (AC8.1).

- [ ] **Step 5: Go-red proof (verification, uncommitted)** — AC7.1: temporarily make `getAttribution` skip the window fallback, re-run Step 4's command, confirm the AC1, AC2, AC4 (history 2) and AC5 (control) tests each fail; restore. Then temporarily revert the unattributable reason to the old `whose refs trailer does not match` wording, re-run, confirm AC3's test fails; restore. Record both runs' pass/fail counts in the task report.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/flow/artifact-overwrite-check.js tests/bin-lib/flow/artifact-overwrite-check.test.js
git commit -m "Add manifest-window attribution to the artifact-overwrite check — untrailered self-edits attribute by spec window" -m "refs #4593"
```

### Task 2: `--run <dir>` on the CLI

**Files:**
- Modify: `plugin/bin/check-artifact-overwrite.js` (header usage/exit-code comment lines 11-22, `USAGE`, `run`)
- Modify: `docs/plugin-structure.md:237` (the CLI's usage line: add `[--run <dir>]`, and the attribution order sentence)
- Test: `tests/bin-lib/flow/check-artifact-overwrite-cli.test.js` (append)

**Interfaces:**
- Consumes: Task 1's `opts.manifest`.
- Produces: `run(argv, deps)` — new optional deps `resolveRunDir(runDir) -> { ok: true, dir } | { ok: false, reason }` (default: `(runDir) => require('./lib/stage-item/write.js').resolveTarget({ runDir })`) and `readFile(path) -> string` (default `fs.readFileSync(path, 'utf8')`).

`--run` handling (after arg parsing, before `check`): resolve; `!ok` → stderr `check-artifact-overwrite: --run {dir} rejected ({reason}) — not a run dir anchored under this checkout` and exit 3, with no read. Read `manifestPath(dir)` (from `manifest.js`); a read error → stderr `check-artifact-overwrite: cannot read manifest {path}: {err.message}`, exit 3; `parseManifestYaml(text) === null` → stderr `check-artifact-overwrite: manifest {path} does not parse`, exit 3. Otherwise `opts.manifest` = the parsed object. The header comment states the reader boundary posture (strict anchoring through `resolveTarget`, refusal on exit 3, because a worktree-local shadow manifest would yield confident wrong windows) and adds the three new exit-3 causes to the exit-code list.

- [ ] **Step 1: Write the failing tests:**
  - `--run with a parseable manifest passes it through as opts.manifest` — fake `resolveRunDir` returns `{ ok: true, dir: '/r' }`, fake `readFile` returns a manifest text with `multispec:`, `  parent: p/`, `  specs:` and two `    - id:` entries; fake `check` captures opts → `opts.manifest.multispec.specs.length === 2`, exit 0.
  - `without --run, opts.manifest is undefined (refs-only)`.
  - `--run whose manifest does not parse exits 3 naming it` — `readFile` returns `not yaml` → exit 3, stderr matches `/manifest\.yml does not parse/`, the fake `check` never called.
  - `--run refused by the anchoring check exits 3 and never reads a manifest` — fake `resolveRunDir` returns `{ ok: false, reason: 'not-anchored' }`, `readFile` fake throws if called → exit 3, stderr matches `/rejected \(not-anchored\)/`.
  - `--run outside any checkout is refused end-to-end (exit 3)` — spawn the real CLI with `cwd` = a fixture repo and `--run` = a fresh `mkdtemp` directory outside every git repo → `status === 3`, stderr matches `/rejected/`.
  - `AC6.1: end-to-end, --run <dir> with no manifest.yml exits 3 and stderr names the missing manifest` — spawn the real CLI with `cwd` = a fixture repo (like the existing end-to-end test) and `--run` = an existing directory inside it with no `manifest.yml` → `status === 3`, stderr matches `/manifest\.yml/`, stdout is empty.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/flow/check-artifact-overwrite-cli.test.js`
Expected: FAIL after Step 1 — `unknown argument: --run`.

- [ ] **Step 3: Implement** in `plugin/bin/check-artifact-overwrite.js`; update `docs/plugin-structure.md:237`'s usage to `--base <ref> [--head <ref>] [--path <pathspec>]... [--run <dir>]` and its self-edit clause to "trace via `git blame` back to a commit attributed to the same spec — by its `refs #{N}` trailer, else (with `--run <dir>`, #4593) by the one `manifest.yml` phase window holding its author date". Add "or a `--run` dir unanchored or with no readable manifest" to its exit-3 clause.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/flow/check-artifact-overwrite-cli.test.js`
Expected: PASS, every existing test included (AC8.1).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/check-artifact-overwrite.js tests/bin-lib/flow/check-artifact-overwrite-cli.test.js docs/plugin-structure.md
git commit -m "Add --run to check-artifact-overwrite — reads the run's manifest.yml for window attribution" -m "refs #4593"
```

### Task 3: Procedure doc, journey and their pin

**Files:**
- Modify: `plugin/skills/flow/multispec-artifact-namespacing.md` (command block line 44; test 1 at lines 51-54; the HARD-GATE sentence's "plus both commits' spec ids (`refs #{N}`)" at 85; the exit-3 sentence at 87-90; the fixture-coverage list at 91-93)
- Modify: `plugin/skills/flow/multispec-run-dir-layout.md:37` ("nothing else consumes it" — `bin/check-artifact-overwrite.js --run` now reads `phases[]`/`startedAt` too)
- Modify: `docs/journeys/catch-a-silent-journey-overwrite.md` (line 18's command gains `--run "$MULTISPEC_PARENT_DIR"`; line 60's test (1) names both attribution sources)
- Test: `tests/multispec-artifact-namespacing-conformance.test.js` (extend the "holds the full completion-check procedure" test; add one go-red)

- [ ] **Step 1: Write the failing test** — AC9.1: factor the procedure assertions into one `assertCompletionProcedure(text)` function holding the two existing `assert.match` calls plus `assert.match(text, /check-artifact-overwrite\.js" --base "\{EXPECTED_BASE\}" --run "\{parent\}"/)`; the existing test calls it on the live file; add `go-red proof: a command block without --run "{parent}" fails the procedure assertions`, which runs `assertCompletionProcedure` on a flattened copy of today's line-44 command plus the two other pinned phrases and expects it to throw.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/multispec-artifact-namespacing-conformance.test.js`
Expected: FAIL after Step 1 — on the new `--run "{parent}"` assertion.

- [ ] **Step 3: Edit the docs** — command becomes `node "${CLAUDE_PLUGIN_ROOT}/bin/check-artifact-overwrite.js" --base "{EXPECTED_BASE}" --run "{parent}" --path docs/journeys/ --path stories/`, followed by one sentence naming `{parent}` as the multi-spec parent run dir that holds `manifest.yml` (`$MULTISPEC_PARENT_DIR`). Test 1 names both attribution sources in order (the commit's `refs #{N}` trailer, else the one manifest window holding its author date — a spec's window runs from its first recorded transition to the later of the next spec's first transition and its own last one; no window or several → unattributed; window attribution is off when the manifest names a `not-run` spec). The HARD-GATE sentence reports each commit's attribution instead of only `refs #{N}`, and says an `unattributable` reason means a missing attribution, not a confirmed cross-spec deletion. Keep `HARD-GATE: stop before rendering the console` verbatim. The exit-3 sentence adds "or a `--run` directory that is unanchored or holds no readable `manifest.yml`". The fixture-coverage list adds "manifest-window attribution (in-window self-edit, cross-window, trailer precedence, before-every-window, overlap, not-run)". Update the layout doc's `phases[]` consumer sentence and the journey's two lines.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/multispec-artifact-namespacing-conformance.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/flow/multispec-artifact-namespacing.md plugin/skills/flow/multispec-run-dir-layout.md docs/journeys/catch-a-silent-journey-overwrite.md tests/multispec-artifact-namespacing-conformance.test.js
git commit -m "Pass the run's manifest to the artifact-overwrite check — procedure names both attribution sources" -m "refs #4593"
```
