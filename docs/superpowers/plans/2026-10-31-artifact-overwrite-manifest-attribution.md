# Artifact-overwrite manifest-window attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the multi-spec artifact-overwrite check attribute an untrailered commit to a spec through `manifest.yml`'s phase-transition windows, so a spec's own review fix to its own story/journey file stops tripping the HARD-GATE.

**Architecture:** `plugin/bin/lib/flow/artifact-overwrite-check.js` gains two pure helpers (`computeSpecWindows`, `attributeByWindow`) and a per-commit attribution (refs trailer first, then the single manifest window containing the commit's author date, else none) that replaces the refs-only `getRefs` in the same-spec self-edit test. The CLI `plugin/bin/check-artifact-overwrite.js` gains `--run <dir>`, reads and parses `{dir}/manifest.yml` with `manifest.js`'s `parseManifestYaml`, and passes it through as `opts.manifest`. The procedure doc passes `--run "{parent}"`.

**Tech Stack:** Node 18+ CommonJS, `node --test`, git CLI via the module's injectable `git(argv, cwd)` runner.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T163025-record-4593/work/4593-spec.md` (record #4593)

## Global Constraints

- Use the commit's **author** date (`%aI`), never the committer date.
- Author date and message come from one git call per commit: `git log -1 --format=%aI%n%B {sha}` (first line = date, rest = message) — no extra git call per commit.
- Parse the manifest with `manifest.js`'s `parseManifestYaml` — no second YAML reader. `manifest.js` itself is not modified.
- Trailer attribution takes precedence over the manifest window.
- A commit whose author date falls inside no window, or inside more than one, stays unattributed — never guessed.
- Fail closed: an unattributable self-edit stays in `overwrites[]`, exit code stays 1.
- Unattributable reason must contain the literal `unattributable — no refs trailer and no manifest window` and must not contain `refs trailer does not match`.
- `--run <dir>` with no readable / parseable `manifest.yml` → exit 3, stderr names the manifest path. Without `--run`, behavior is today's refs-only.
- Every existing test in `tests/bin-lib/flow/artifact-overwrite-check.test.js` and `tests/bin-lib/flow/check-artifact-overwrite-cli.test.js` passes unchanged.
- Fixture commits pin `GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE`.
- Commit messages: `{Verb} {what} — {detail}`, body `refs #4593`, never `closes`/`fixes`.

Waived plugin/bin/lib/flow/manifest.js: read only — Task 2 imports `parseManifestYaml`; the spec expects no change to it.

## Review Focus

1. Parallel-wave overlap: two specs whose recorded transitions interleave (spec A still transitioning after spec B started) must make commits in the overlap unattributed, not attributed to B — otherwise B overwriting A's file inside the overlap reads as B self-editing (a false clean). Pinned in Task 1 (`computeSpecWindows: a spec still transitioning after the next spec started overlaps it`, plus the overlap fixture).
2. Spec ids are numbers from `refs #N` but may be numbers or strings from `parseManifestYaml`'s `coerceId` — attribution must compare as strings so trailer `#10` and window `10` match. Pinned in Task 1 (trailer-in-window self-edit fixture).
3. A manifest spec with no `startedAt` but `phases[]` uses its earliest `phases[].at`; a spec with neither gets no window. Pinned in Task 1 (`computeSpecWindows` unit tests).
4. An unparseable `%aI` line (empty, garbage) yields no window, never a throw. Pinned in Task 1 (`attributeByWindow` with `NaN`).
5. A `--run` path that is not anchored under the cwd's main checkout (a worktree-local shadow, `[IL-127]`) must be refused (exit 3) rather than read — a stale shadow manifest would give confident wrong windows. Pinned in Task 2.

---

### Task 1: Manifest-window attribution in the check module

**Files:**
- Modify: `plugin/bin/lib/flow/artifact-overwrite-check.js` (header comment test 1 at lines 17-20 and the fail-closed note at 62-64; `getRefs` at 357-364; the self-edit loop and reason strings at 384-424; `module.exports`)
- Test: `tests/bin-lib/flow/artifact-overwrite-check.test.js` (append new tests; do not edit existing ones)

**Interfaces:**
- Produces: `checkArtifactOverwrite(opts)` accepts optional `opts.manifest` — the object `parseManifestYaml` returns (`{ multispec: { specs: [{ id, startedAt?, phases?: [{ phase, status, at }] }] } }`), or `null`/`undefined` for refs-only.
- Produces: `computeSpecWindows(manifest) -> Array<{ id: string, start: number, end: number }>` (ms epoch; `end` is `Infinity` for the last window), exported.
- Produces: `attributeByWindow(windows, timeMs) -> string | null` — the one window id whose `[start, end)` contains `timeMs`; `null` for zero or more than one match, or a non-finite `timeMs`; exported.

**Window rule (the algorithm the tests do not fully determine):** for each spec, `first` = `Date.parse(startedAt)` when finite, else the earliest finite `Date.parse(phases[].at)`; `last` = the latest finite value among `startedAt` and every `phases[].at`. Drop specs with no finite `first`. Sort by `first` ascending. Window i = `[first_i, end_i)` where `end_i = Math.max(first_{i+1}, last_i)` for every window but the last, and `Infinity` for the last. `Math.max` with `last_i` is what makes a still-running spec's window overlap the next one (Review Focus 1); in a sequential run `last_i < first_{i+1}` and it reduces to the spec's "up to the next spec's first recorded transition".

**Attribution:** replace `getRefs` with a cached `getAttribution(sha) -> { ids: Set<string>, source: 'refs trailer' | 'manifest window' | null }`: one `git(['log', '-1', '--format=%aI%n%B', sha], cwd)` call; refs from `extractRefs(message)` (stringified) when non-empty; else `attributeByWindow(windows, Date.parse(dateLine))`; else empty. Windows are computed once per call from `opts.manifest`.

**Self-edit verdict per deleted line (blamed sha present):** commit's or blamed's attribution empty → overwrite, unattributable culprit; else no intersection → overwrite, mismatch culprit; else self-edit.

**Reasons:**
- mismatch: `deleted line {L} (as of parent {commit}~1) traces to commit {blamed}, attributed to {fmt(blamed)}, which does not match {commit}'s own attribution {fmt(commit)}, and the deletion is neither a list reflow, a step-markup reformat, a step renumber, nor a reference-preserving Origin line` where `fmt` = `#10, #11 (refs trailer)` / `#10 (manifest window)`.
- unattributable: `deleted line {L} (as of parent {commit}~1) traces to commit {blamed} — unattributable — no refs trailer and no manifest window for {the deleting commit | the blamed commit | either commit}, so the same-spec self-edit test cannot run, and the deletion is neither a list reflow, a step-markup reformat, a step renumber, nor a reference-preserving Origin line`.
- no-blame reason unchanged.

- [ ] **Step 1: Write the failing tests** — append to the test file a `commitAt(fx, message, iso)` helper (passes `env: { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso }` to `git commit`) and a `manifestOf(specs)` helper returning `{ multispec: { parent: 'p/', specs } }`. Tests (spec A = id `10`, B = id `12`; A transitions at `2026-01-01T10:00:00Z` (running) and `2026-01-01T11:00:00Z` (complete), B at `2026-01-01T12:00:00Z`):
  - `computeSpecWindows: sequential specs partition the timeline, last window open-ended` — ids `['10','12']`, A `end === Date.parse(B start)`, B `end === Infinity`.
  - `computeSpecWindows: startedAt missing falls back to the earliest phases[].at; a spec with neither gets no window`.
  - `computeSpecWindows: a spec still transitioning after the next spec started overlaps it` — A has a phase at 13:00 → A `end` = 13:00, and `attributeByWindow(windows, Date.parse('2026-01-01T12:30:00Z')) === null`.
  - `attributeByWindow: no window, or a non-finite time, is null` — time before every start → `null`; `NaN` → `null`.
  - AC1.1/AC1.2/AC1.3 `manifest window: an untrailered self-edit inside spec A's window passes clean` — `stories/x-A.yaml` added at 10:15, one line changed at 10:45, no trailers, `manifest` supplied → `clean: true`.
  - AC2.1/AC2.2 `manifest window: the modifying commit inside spec B's window is still an overwrite` — modify at 12:30 → one overwrite for that path and commit; reason does not match `/unattributable/`.
  - AC3.1/AC3.2 `no manifest: an untrailered self-edit reports an unattributable overwrite` — AC1's history, no manifest → one overwrite; reason matches `/unattributable — no refs trailer and no manifest window/` and does not match `/refs trailer does not match/`.
  - AC4.1 `a refs trailer takes precedence over the manifest window` — add untrailered at 10:15 (window A, id 10), modify at 10:45 with `(refs #12)` → overwrite whose reason does not match `/unattributable/`; and a second history: add at 10:15 untrailered, modify at 12:30 (window B) with `(refs #10)` → `clean: true`.
  - AC5.1 `an author date before every spec's first transition is unattributed` — add at 09:00, modify at 10:45, no trailers, manifest supplied → overwrite with `/unattributable/`; control in the same test: a manifest whose A starts at 08:00 → `clean: true`.
  - Overlap fixture `overlapping windows leave a commit unattributed` — A phases at 10:00 and 13:00, B at 12:00; add at 12:15, modify at 12:45, no trailers → overwrite with `/unattributable/`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/flow/artifact-overwrite-check.test.js`
Expected: FAIL after Step 1 — `computeSpecWindows is not a function` and the AC1 fixture reports `clean: false`.

- [ ] **Step 3: Implement** the helpers, `getAttribution`, the verdict and reasons above in `plugin/bin/lib/flow/artifact-overwrite-check.js`; add `@param {object|null} [opts.manifest]` to the JSDoc; rewrite header test 1 to name both attribution sources and their order, and the overlap/no-window rule; update the closing "Fails closed" note to say an unattributable self-edit is reported with its own reason.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/flow/artifact-overwrite-check.test.js`
Expected: PASS, every existing test included (AC8.1).

- [ ] **Step 5: Go-red proof (verification)** — AC7.1: temporarily make `getAttribution` skip the window fallback, re-run Step 4's command, confirm AC1, AC2, AC4, AC5 and the overlap fixture each fail, then restore.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/flow/artifact-overwrite-check.js tests/bin-lib/flow/artifact-overwrite-check.test.js
git commit -m "Add manifest-window attribution to the artifact-overwrite check — untrailered self-edits attribute by spec window"
```

### Task 2: `--run <dir>` on the CLI

**Files:**
- Modify: `plugin/bin/check-artifact-overwrite.js` (header usage/exit-code comment lines 11-22, `USAGE`, `run`)
- Modify: `docs/plugin-structure.md:232` (the CLI's usage line: add `[--run <dir>]`, and the attribution order sentence)
- Test: `tests/bin-lib/flow/check-artifact-overwrite-cli.test.js` (append)

**Interfaces:**
- Consumes: Task 1's `opts.manifest`.
- Produces: `run(argv, deps)` — new optional deps `resolveRunDir(runDir) -> { ok: true, dir } | { ok: false, reason }` (default: `require('./lib/stage-item/write.js').resolveTarget({ runDir })`) and `readFile(path) -> string` (default `fs.readFileSync(path, 'utf8')`).

`--run` handling: resolve; `!ok` → stderr `check-artifact-overwrite: --run {dir} rejected ({reason}) — not a run dir anchored under this checkout` and exit 3. Read `path.join(dir, 'manifest.yml')`; a read error → stderr `check-artifact-overwrite: cannot read manifest {path}: {err.message}`, exit 3; `parseManifestYaml(text) === null` → stderr `check-artifact-overwrite: manifest {path} does not parse`, exit 3. Otherwise `opts.manifest` = the parsed object. Header comment states the reader boundary posture (strict anchoring through `resolveTarget`, refusal on exit 3, because a worktree-local shadow manifest would yield confident wrong windows).

- [ ] **Step 1: Write the failing tests:**
  - `--run with a parseable manifest passes it through as opts.manifest` — fake `resolveRunDir` returns `{ ok: true, dir: '/r' }`, fake `readFile` returns a two-spec manifest text, fake `check` captures opts → `opts.manifest.multispec.specs.length === 2`, exit 0.
  - `without --run, opts.manifest is undefined` (refs-only).
  - `--run whose manifest does not parse exits 3 naming it`.
  - `--run refused by the anchoring check exits 3 and never reads a manifest` (`readFile` fake throws if called).
  - AC6.1 `end-to-end: --run <dir> with no manifest.yml exits 3 and stderr names the missing manifest` — spawn the real CLI with `cwd` = a fixture repo, `--run` = an existing directory inside it with no `manifest.yml`; `status === 3`, stderr matches `/manifest\.yml/`, stdout empty.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/flow/check-artifact-overwrite-cli.test.js`
Expected: FAIL after Step 1 — `unknown argument: --run`.

- [ ] **Step 3: Implement** in `plugin/bin/check-artifact-overwrite.js`; update `docs/plugin-structure.md:232`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/flow/check-artifact-overwrite-cli.test.js`
Expected: PASS, every existing test included (AC8.1).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/check-artifact-overwrite.js tests/bin-lib/flow/check-artifact-overwrite-cli.test.js docs/plugin-structure.md
git commit -m "Add --run to check-artifact-overwrite — reads the run's manifest.yml for window attribution"
```

### Task 3: Procedure doc and its pin

**Files:**
- Modify: `plugin/skills/flow/multispec-artifact-namespacing.md` (command block line 44; test 1 at lines 51-54; HARD-GATE sentence's "both commits' spec ids (`refs #{N}`)" at 85)
- Modify: `plugin/skills/flow/multispec-run-dir-layout.md:37` ("nothing else consumes it" — `bin/check-artifact-overwrite.js --run` now reads `phases[]`/`startedAt` too)
- Test: `tests/multispec-artifact-namespacing-conformance.test.js` (extend the "holds the full completion-check procedure" test; add one go-red)

- [ ] **Step 1: Write the failing test** — AC9.1: in `multispec-artifact-namespacing.md holds the full completion-check procedure`, add `assert.match(text, /check-artifact-overwrite\.js" --base "\{EXPECTED_BASE\}" --run "\{parent\}"/)`; add `go-red proof: a command block without --run "{parent}" fails the same assertion` against the old command line.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/multispec-artifact-namespacing-conformance.test.js`
Expected: FAIL after Step 1 — on the new `--run "{parent}"` assertion.

- [ ] **Step 3: Edit the docs** — command becomes `node "${CLAUDE_PLUGIN_ROOT}/bin/check-artifact-overwrite.js" --base "{EXPECTED_BASE}" --run "{parent}" --path docs/journeys/ --path stories/`, with one sentence naming `{parent}` as the multi-spec parent run dir holding `manifest.yml` (`$MULTISPEC_PARENT_DIR`). Test 1 names both attribution sources in order (refs trailer, else the one manifest window holding the commit's author date; none or several windows → unattributed, reported as `unattributable`). The HARD-GATE sentence reports each commit's attribution instead of only `refs #{N}`, and says an `unattributable` reason means a missing attribution, not a confirmed cross-spec deletion. Keep `HARD-GATE: stop before rendering the console` verbatim. Update the layout doc's `phases[]` consumer sentence.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/multispec-artifact-namespacing-conformance.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/flow/multispec-artifact-namespacing.md plugin/skills/flow/multispec-run-dir-layout.md tests/multispec-artifact-namespacing-conformance.test.js
git commit -m "Pass the run's manifest to the artifact-overwrite check — procedure names both attribution sources"
```
