# Artifact-Overwrite Manifest-Window Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the multi-spec artifact-overwrite check attribute an untrailered commit to a spec through the run's `manifest.yml` phase windows, so a spec's own review fix to its own story/journey file stops tripping the HARD-GATE.

**Architecture:** Two pure functions in `plugin/bin/lib/flow/artifact-overwrite-check.js` turn a parsed manifest into per-spec time windows and look a commit's author date up in them; `checkArtifactOverwrite` gains an optional `manifest` input and attributes each commit trailer-first, window-second. `plugin/bin/check-artifact-overwrite.js` gains `--run <dir>`, reads `<dir>/manifest.yml` itself (exit 3 when it cannot), and passes the parsed manifest through. The procedure doc passes `--run "{parent}"` for a sequential run.

**Tech Stack:** Node 18+ CommonJS, `node --test`, real `git` fixtures.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T180930-record-4593/work/4593-spec.md` (record #4593, including its Plan Review Clarifications Q1–Q4)

**Scope keywords:** checkArtifactOverwrite, check-artifact-overwrite, artifact-overwrite-check

## Global Constraints

- Attribution order, verbatim from the spec: "1. its own `refs #N` trailer, when present (unchanged); 2. otherwise, the single spec whose manifest window contains the commit's author date. A spec's window runs from its first recorded transition (`startedAt`, else its earliest `phases[].at`) up to the next spec's first recorded transition. The last spec's window is open-ended. 3. otherwise the commit is unattributed (an empty set, as today)."
- "A commit whose author date falls inside no window, or inside more than one, stays unattributed. The fallback never guesses."
- Q2/Q4: window attribution is switched off (refs-only) whenever any manifest spec has status `not-run` or `failed`.
- Q3: a spec's window ends at the next spec's first recorded transition; a `parallel` run omits `--run` and stays refs-only.
- Use the commit's **author** date (`%aI`), fetched in the same `git log -1` call as `%B` — never the committer date, never a second git call per commit.
- Parse the manifest with `manifest.js`'s `parseManifestYaml` — no second YAML reader. `manifest.js` itself is read-only for this change.
- Unattributable `reason` must contain `unattributable — no refs trailer and no manifest window` and must not contain `refs trailer does not match`; the entry stays in `overwrites[]` and the exit code stays 1.
- `--run` naming a dir with no readable `manifest.yml`, or one that does not parse, exits 3 with stderr naming the manifest path — never a silent refs-only fallback.
- Every existing test in `tests/bin-lib/flow/artifact-overwrite-check.test.js` and `tests/bin-lib/flow/check-artifact-overwrite-cli.test.js` passes unchanged.
- Governing skill `gh-api-module-pattern` (`cli-wrapper-contract.md`), quoted rules that apply:
  - "Every malformed-input class must actually reach its malformed code"; "A value-taking flag given as the last argv element reads `undefined` … Validate the value inside `parseArgs` … `typeof v !== 'string' || !v.trim() || v.startsWith('--')` returns a usage error — and pin both the trailing bare flag and the empty-string value with their own test cases."
  - "A guard added to an existing `run(argv, deps)` reaches the environment through `deps` too." → the manifest read goes through `deps.readFile`.
  - "A file the CLI is about to read is read directly with `ENOENT`/`ENOTDIR` caught as 'absent', never checked for existence first" — no `fs.existsSync`.
  - "A read-only run-dir *reader* still owes a stated boundary posture … or state in the header why an unanchored read is safe for this CLI's callers." → this CLI states it (see Task 2 Step 3).
  - "Adding a flag that a CLI forwards into a library function needs one CLI-level test of the forwarding, and the same sweep of every restated command line."
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."

## Decided rulings (not open questions)

- **Catch-up-merge commits (issue comment 6555467984).** Upstream commits a catch-up merge brings into `{EXPECTED_BASE}..HEAD` are authored inside the run's windows, so date attribution assigns them to whichever spec was running. Traced: this can only clear a deletion when the deleting commit and every blamed commit land in the *same* window, i.e. a spec (or upstream) editing a line no other run spec wrote — not a cross-spec overwrite inside the run. A genuine spec-B-deletes-spec-A line still pairs an A-window commit with a B-window commit and still fails. The first-parent filtering that comment proposes is a separate false-positive shape (upstream commits as adder/modifier) and is filed as its own record during the build (Common Step 4), not folded in here.
- **Fail closed on an unusable manifest.** Window attribution is also off when any spec lacks a parseable first transition (a `startedAt` that does not parse, or no `startedAt` and no parseable `phases[].at`). Without this, a spec with a missing start would silently widen its predecessor's window over its own commits — a confident wrong attribution.
- **Equal starts.** Two specs with the same first transition get identical windows; a date inside them matches both and stays unattributed ("inside more than one").
- **Run-dir boundary posture:** unanchored read, stated in the CLI header. `manifest.yml`'s only writers (`hooks.js manifest-init` / `spec-status`) refuse a non-anchored `--run`, so a worktree-local shadow run dir never holds a `manifest.yml`; a dir without one exits 3 — loud, never a refs-only or wrong verdict.

## Review Focus

1. A manifest where a spec is `not-run` or `failed` must keep refs-only behavior (Q2/Q4), never a window-based clean — tested in Task 1 (`computeSpecWindows` off cases + one fixture).
2. A spec with no recorded transition must not extend the previous spec's window — Task 1 `computeSpecWindows` off case.
3. An author date exactly at a window boundary belongs to the later spec (start inclusive, next start exclusive) — Task 1 boundary unit test.
4. `--run ""` and a trailing bare `--run` are malformed (exit 2), not a manifest read of `manifest.yml` in cwd — Task 2.
5. Non-numeric manifest ids must never intersect numeric `refs #N` ids by accident — covered by id equality via `Set.has` on `coerceId` output (numbers stay numbers); no extra test.

---

### Task 1: Manifest-window attribution in the check

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/flow/artifact-overwrite-check.js` (header comment lines 17-20 and 62-64; `getRefs` at 357-364; self-edit loop and reasons at 384-424; `module.exports`)
- Test: `tests/bin-lib/flow/artifact-overwrite-check.test.js` (append new tests; do not edit existing ones)
- Waived `plugin/bin/lib/flow/manifest.js`: read only — the tests call its `manifestInit`/`transitionSpec`/`readManifest` as the real writer.

**Interfaces:**
- Produces:
  - `computeSpecWindows(manifest) -> { windows: Array<{ id, start: number, end: number }> | null, off: string | null }` — `manifest` is `parseManifestYaml`'s shape (`{ multispec: { specs: [...] } }`) or null/undefined. `start`/`end` are epoch ms; last `end` is `Infinity`. `off` strings exactly: `'no manifest'`, `'manifest names no specs'`, `` `spec #${id} is ${status}` `` (for `not-run`/`failed`), `` `spec #${id} has no parseable first transition` ``. `windows` is null exactly when `off` is non-null.
  - `attributeByWindow(windows, authorDateMs) -> Set` — the one matching spec id, else an empty Set (no windows, non-finite date, zero or 2+ matches). Match is `ms >= start && ms < end`.
  - `checkArtifactOverwrite(opts)` gains `opts.manifest` (optional, same shape). Return shape unchanged.
  - Both new functions exported from the module.

- [ ] **Step 1: Write the failing tests** (append to the test file; add `computeSpecWindows`, `attributeByWindow` to the destructured require, and `const { manifestInit, transitionSpec, readManifest } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'flow', 'manifest.js'));`)

Helpers (new, below the existing `commit` helper):

```js
const T0 = '2026-01-01T10:00:00.000Z'; // spec 10 first transition
const T1 = '2026-01-01T12:00:00.000Z'; // spec 11 first transition
function commitAt(fx, message, iso) {
  fx.git('add', '-A');
  execFileSync('git', ['commit', '-q', '-m', message], {
    cwd: fx.dir, encoding: 'utf8', timeout: FIXTURE_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso },
  });
  return fx.git('rev-parse', 'HEAD').trim();
}
// Real writer: manifestInit + transitionSpec with a pinned clock.
function manifestRun(transitions /* [[id, status, phase, iso], ...] */, ids = [10, 11]) {
  const runDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-artifact-manifest-')));
  manifestInit({ runDir, specs: ids, parent: 'p/' });
  for (const [specId, status, phase, iso] of transitions) transitionSpec({ runDir, specId, status, phase, now: new Date(iso) });
  return { runDir, manifest: readManifest(runDir) };
}
const SEQUENTIAL = [[10, 'running', 'build', T0], [10, 'complete', 'wrap-up', '2026-01-01T11:59:00.000Z'], [11, 'running', 'build', T1], [11, 'complete', 'wrap-up', '2026-01-01T14:00:00.000Z']];
const STORY = 'stories/x-10.yaml';
const STORY_V1 = 'name: x\nsteps:\n  locator: old-a\n  other: keep\n';
const STORY_V2 = 'name: x\nsteps:\n  locator: new-a\n  other: keep\n';
```

Tests (names carry the AC ids; spec-file AC numbering, one clause each unless noted):

```js
test('AC1.1, AC1.2, AC1.3: untrailered self-edit inside spec 10\'s window is clean with the manifest', () => {
  const fx = repo();
  write(fx.dir, STORY, STORY_V1); commitAt(fx, 'Add story', '2026-01-01T10:30:00Z');
  write(fx.dir, STORY, STORY_V2); commitAt(fx, 'Review fix: locator', '2026-01-01T11:30:00Z');
  const { manifest } = manifestRun(SEQUENTIAL);
  const result = checkArtifactOverwrite({ base: fx.base, paths: ['stories/'], cwd: fx.dir, manifest });
  assert.deepStrictEqual(result, { clean: true, overwrites: [] });
});

test('AC2.1, AC2.2: the modifying commit in spec 11\'s window is still one overwrite, reported as a spec mismatch', () => {
  // add at 10:30 (spec 10), modify at 12:30 (spec 11), no trailers
  // assert: clean false; overwrites.length === 1; overwrites[0].path === STORY;
  //         overwrites[0].commit === modifySha;
  //         reason matches /#10/ and /#11/ and /by manifest window/;
  //         reason does NOT match /unattributable/   (this assertion is what goes red without the fallback)
});

test('AC3.1, AC3.2: the untrailered self-edit with no manifest reports an unattributable overwrite', () => {
  // same history as AC1, no manifest option
  // assert: clean false; overwrites.length === 1;
  //         reason includes 'unattributable — no refs trailer and no manifest window';
  //         reason does not include 'refs trailer does not match';
  //         reason includes `deleting commit ${modifySha} and blamed commit ${addSha}`;
  //         reason includes '(manifest windows off: no manifest)'
});

test('AC4.1: a refs #N trailer wins over a different spec\'s manifest window', () => {
  // add untrailered at 10:30 (window → 10); modify 'Fix locator (refs #10)' at 12:30 (window would say 11)
  // with manifest: assert clean true (trailer #10 ∩ window #10)
});

test('AC5.1: an author date before every spec\'s first transition leaves that commit unattributed', () => {
  // add untrailered at 09:00 (before T0); modify untrailered at 10:30 (window → 10)
  // with manifest: assert clean false; one entry; reason includes `blamed commit ${addSha}`
  //   and 'unattributable'; reason does NOT include 'deleting commit' (the deleting commit IS attributed —
  //   this is what goes red without the fallback, since then both commits are unattributable)
});

test('Q2/Q4: a manifest naming a failed spec keeps refs-only behavior for the AC1 history', () => {
  // SEQUENTIAL but spec 11's last transition status 'failed'
  // assert clean false; reason includes '(manifest windows off: spec #11 is failed)'
});

test('computeSpecWindows: sequential specs tile [start, next start) with an open-ended last window', () => {
  const { windows, off } = computeSpecWindows(manifestRun(SEQUENTIAL).manifest);
  assert.strictEqual(off, null);
  assert.deepStrictEqual(windows, [
    { id: 10, start: Date.parse(T0), end: Date.parse(T1) },
    { id: 11, start: Date.parse(T1), end: Infinity },
  ]);
});

test('computeSpecWindows: turned off by a not-run spec, a failed spec, a spec with no transition, no specs, and no manifest', () => {
  // not-run: manifestRun([[10,'running','build',T0],[10,'complete','wrap-up',T1],[11,'not-run','build',T1]]) → off 'spec #11 is not-run', windows null
  // failed:  ... [11,'failed','build',...] → off 'spec #11 is failed'
  // no transition: manifestRun([[10,'running','build',T0]]) (spec 11 pending, untouched) → off 'spec #11 has no parseable first transition'
  // unparseable: { multispec: { parent: 'p/', specs: [{ id: 10, status: 'complete', startedAt: 'not-a-date' }] } } → off 'spec #10 has no parseable first transition'
  // phases fallback: { multispec: { parent:'p/', specs: [{ id: 10, status: 'complete', phases: [{ phase:'build', status:'running', at: T1 }, { phase:'test', status:'running', at: T0 }] }] } } → windows [{ id:10, start: Date.parse(T0), end: Infinity }]
  // { multispec: { parent: 'p/', specs: [] } } → off 'manifest names no specs'; null → off 'no manifest'
});

test('attributeByWindow: start is inclusive, the next start exclusive; no match and two matches are both unattributed', () => {
  const windows = [{ id: 10, start: 100, end: 200 }, { id: 11, start: 200, end: Infinity }];
  assert.deepStrictEqual([...attributeByWindow(windows, 100)], [10]);
  assert.deepStrictEqual([...attributeByWindow(windows, 200)], [11]);
  assert.deepStrictEqual([...attributeByWindow(windows, 99)], []);
  assert.deepStrictEqual([...attributeByWindow(windows, NaN)], []);
  assert.deepStrictEqual([...attributeByWindow(null, 150)], []);
  const tied = [{ id: 10, start: 100, end: Infinity }, { id: 11, start: 100, end: Infinity }];
  assert.deepStrictEqual([...attributeByWindow(tied, 150)], []);
});
```

The commented test bodies follow the AC1 test's shape; the assertions listed are the full set each must make.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/flow/artifact-overwrite-check.test.js`
Expected: FAIL after Step 1 — `computeSpecWindows is not a function` / `attributeByWindow is not a function`, and the AC1 test reports an overwrite.

- [ ] **Step 3: Implement**

- `computeSpecWindows(manifest)` / `attributeByWindow(windows, ms)` per the Interfaces block. First transition = `Date.parse(spec.startedAt)` when `startedAt` is present (unparseable → off), else the minimum `Date.parse(p.at)` over `phases[]` (none parseable, or no phases → off). Check `not-run`/`failed` before transitions, in manifest order. Sort by start ascending; each window's `end` is the smallest start strictly greater than its own, else `Infinity` (so tied starts share one window).
- In `checkArtifactOverwrite`: destructure `manifest`; compute `const { windows, off } = computeSpecWindows(manifest)` once. Replace `getRefs` with `getAttribution(sha) -> { ids: Set, source: 'refs trailer' | 'manifest window' | null }`, cached per sha, one call `git(['log', '-1', '--format=%aI%n%B', sha], cwd)`: the first line is the author date, the rest the message. Trailer refs non-empty → `{ ids, source: 'refs trailer' }`; else window ids non-empty → `'manifest window'`; else `{ ids: new Set(), source: null }`.
- Self-edit stays `dAttr.ids.size > 0 && setsIntersect(dAttr.ids, bAttr.ids)`. Record on the culprit which side(s) had `source === null`.
- Reasons (the no-blame reason at line 422 is unchanged):
  - unattributable (either side empty): `` `deleted line ${lineNo} (as of parent ${commit}~1) traces to commit ${blamedSha}; unattributable — no refs trailer and no manifest window for ${who}${off ? ` (manifest windows off: ${off})` : ''}, so a same-spec self-edit cannot be confirmed, and the deletion is neither a list reflow, a step-markup reformat, a step renumber, nor a reference-preserving Origin line` `` where `who` is `deleting commit ${commit}`, `blamed commit ${blamedSha}`, or `deleting commit ${commit} and blamed commit ${blamedSha}`.
  - mismatch (both attributed): `` `deleted line ${lineNo} (as of parent ${commit}~1) traces to commit ${blamedSha}, attributed to ${fmt(bAttr)}, which does not match ${commit}'s own ${fmt(dAttr)}, and the deletion is neither …` `` (same tail as today), `fmt` = ids as `#10, #11` plus ` (by {source})`.
- Header comment: rewrite test 1 (lines 17-20) to name both attribution sources and their order, the author-date rule, and when windows are off (a `not-run`/`failed` spec, a spec with no parseable first transition, no manifest); update the "Fails closed" sentence (62-64) to say "no blame, no attribution from a refs trailer or a manifest window".

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/flow/artifact-overwrite-check.test.js`
Expected: PASS, every pre-existing test included.

- [ ] **Step 5: Prove discrimination (AC7.1, Q1)** — scratch, not committed. Temporarily make `getAttribution` skip the window branch; re-run the file: AC1.1, AC2.1, AC4.1 and AC5.1 must FAIL. Restore. Temporarily change the unattributable reason to the old `whose refs trailer does not match` wording; AC3.1 must FAIL. Restore. Record both runs with `log-decision.js --status AUTO --step "AC evidence"` (one line each, naming the mutation and the failing test names).

- [ ] **Step 6: Commit**

```bash
git -C "{worktree}" add plugin/bin/lib/flow/artifact-overwrite-check.js tests/bin-lib/flow/artifact-overwrite-check.test.js
git -C "{worktree}" commit -m "Attribute untrailered commits by manifest window — refs #4593"
```

### Task 2: `--run <dir>` on the CLI

**Role:** integration

**Files:**
- Modify: `plugin/bin/check-artifact-overwrite.js` (header comment, `USAGE`, `run`)
- Test: `tests/bin-lib/flow/check-artifact-overwrite-cli.test.js` (append only)

**Interfaces:**
- Consumes: `checkArtifactOverwrite(opts)` with `opts.manifest` (Task 1); `parseManifestYaml(text)` from `./lib/flow/manifest.js`.
- Produces: `run(argv, deps)` accepts `deps.readFile` (default `fs.readFileSync`), and `--run <dir>`.

- [ ] **Step 1: Write the failing tests**

```js
test('AC6.1: --run naming a dir with no manifest.yml exits 3 and stderr names the missing manifest', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-cao-run-')));
  const io = fakeIo();
  const code = run(['node', 'check-artifact-overwrite.js', '--base', 'a', '--run', dir],
    { ...io, check: () => { throw new Error('check must not run'); } });
  assert.strictEqual(code, 3);
  assert.ok(io.err().includes(path.join(dir, 'manifest.yml')), io.err());
  assert.strictEqual(io.out(), '');
});

test('--run naming a manifest.yml that does not parse exits 3 naming it', () => {
  // write 'not: a manifest\n' to <dir>/manifest.yml; same assertions as AC6.1
});

test('--run with an empty value, a trailing bare --run, or a flag as its value is malformed (exit 2)', () => {
  // ['--base','a','--run',''] → 2, /--run requires a directory/
  // ['--base','a','--run'] → 2, /requires a value/
  // ['--base','a','--run','--path'] → 2, /--run requires a directory/
});

test('--run forwards the parsed manifest into the check', () => {
  // dir with a manifest written by manifestInit + transitionSpec (real writer);
  // fake check records opts; assert opts.manifest.multispec.specs.map(s => s.id) deep-equals [10, 11]
  //   and opts has no `run` key
});

test('end-to-end: an untrailered self-edit exits 0 with --run and 1 without it', () => {
  // real repo fixture: add stories/x-10.yaml at 10:30Z, modify one line at 11:30Z, no trailers
  //   (GIT_AUTHOR_DATE/GIT_COMMITTER_DATE pinned); manifest via manifestInit/transitionSpec with
  //   spec 10 running at 10:00Z, spec 11 running at 12:00Z
  // spawnSync('node', [CLI, '--base', base, '--path', 'stories/', '--run', runDir], { cwd: dir }) → status 0, JSON clean
  // same without --run → status 1
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/flow/check-artifact-overwrite-cli.test.js`
Expected: FAIL after Step 1 — `unknown argument: --run` (exit 2 where 3/0 expected).

- [ ] **Step 3: Implement**

- Arg loop: `case '--run':` rejects `!value.trim() || value.startsWith('--')` with `check-artifact-overwrite: --run requires a directory` + USAGE, exit 2; else `opts.run = value`.
- After the `--base` check, when `opts.run` is set: `const file = path.join(opts.run, 'manifest.yml')`; `deps.readFile(file, 'utf8')` in try/catch → `check-artifact-overwrite: cannot read manifest ${file}: ${err.message}`, exit 3; `parseManifestYaml(text)` null → `check-artifact-overwrite: manifest ${file} does not parse as a multi-spec manifest`, exit 3; then pass `{ ...opts-without-run, manifest }` to `check`.
- `USAGE` and header Usage line gain `[--run <dir>]`; header: `--run` documented (reads `<dir>/manifest.yml`, the multi-spec parent run dir; enables manifest-window attribution; omitted for a `parallel` run); exit 3 also covers an unreadable/unparseable manifest named by `--run`; boundary posture paragraph per the Decided rulings (unanchored read, why safe).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/flow/check-artifact-overwrite-cli.test.js tests/bin-lib/flow/artifact-overwrite-check.test.js`
Expected: PASS.

- [ ] **Step 5: Prove the forwarding test discriminates** — scratch: drop `manifest` from the object passed to `check`; the forwarding and end-to-end tests must FAIL; restore.

- [ ] **Step 6: Commit**

```bash
git -C "{worktree}" add plugin/bin/check-artifact-overwrite.js tests/bin-lib/flow/check-artifact-overwrite-cli.test.js
git -C "{worktree}" commit -m "Add --run to check-artifact-overwrite for manifest-window attribution — refs #4593"
```

### Task 3: Procedure doc and restated command lines

**Role:** integration

**Files:**
- Modify: `plugin/skills/flow/multispec-artifact-namespacing.md` (command block at line 44, test 1 at 51-54, exit paragraph at 86-90)
- Modify: `tests/multispec-artifact-namespacing-conformance.test.js` (one new assertion + its go-red control)
- Modify: `docs/plugin-structure.md:239` (the `check-artifact-overwrite.js` command line)
- Modify: `docs/journeys/catch-a-silent-journey-overwrite.md` (step 1's command, step 2's and step 6's test-1 descriptions)

**Interfaces:**
- Consumes: the CLI flag from Task 2.

- [ ] **Step 1: Write the failing test** — factor the assertion so the control reuses it:

```js
function assertRunFlagInCommand(text) {
  assert.match(text, /check-artifact-overwrite\.js" --base "\{EXPECTED_BASE\}" --run "\{parent\}"/);
}
test('AC9.1: multispec-artifact-namespacing.md passes --run "{parent}" to the check', () => {
  assertRunFlagInCommand(read(NAMESPACING_FILE));
});
test('go-red proof: a command block without --run fails the same assertion', () => {
  assert.throws(() => assertRunFlagInCommand(flatten('node "${CLAUDE_PLUGIN_ROOT}/bin/check-artifact-overwrite.js" --base "{EXPECTED_BASE}" --path docs/journeys/')));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/multispec-artifact-namespacing-conformance.test.js`
Expected: FAIL after Step 1 — on AC9.1 only.

- [ ] **Step 3: Edit the doc**

- Command: `node "${CLAUDE_PLUGIN_ROOT}/bin/check-artifact-overwrite.js" --base "{EXPECTED_BASE}" --run "{parent}" --path docs/journeys/ --path stories/`, followed by one sentence: `{parent}` is the multi-spec parent run dir that holds `manifest.yml` (`$MULTISPEC_PARENT_DIR`); a run started with the `parallel` token (`multispec-parallel-waves.md`) omits `--run`, because wave members build concurrently in their own worktrees and their windows overlap, so its check stays refs-only.
- Test 1: attribution sources and order — the deleting commit's and each blamed commit's own `refs #{N}` trailer first; otherwise the one spec whose `manifest.yml` window (first recorded transition up to the next spec's) holds the commit's author date; otherwise unattributed (a date in no window or in two). Windows are off — refs-only — when the manifest names a `not-run` or `failed` spec or a spec with no parseable first transition. An unattributable deletion still fails, with a reason saying `unattributable` so the manual ruling can tell a missing attribution from a confirmed cross-spec deletion.
- Exit paragraph: exit `3` also covers an unreadable or unparseable `manifest.yml` named by `--run`; the HARD-GATE report names both commits' spec attributions (the `reason` text) instead of "both commits' spec ids (`refs #{N}`)".
- Byte headroom: file is 6,828 B before the edit against `RAIL_BYTES` 52,500 — no risk; record `wc -c` after.

- [ ] **Step 4: Sweep restated command lines and test-1 prose**

Run: `git grep -n -i -e "check-artifact-overwrite.js\" --base" -e "check-artifact-overwrite.js --base" -e "refs #{N}\` trailer" -e "same-spec self-edit" -- plugin docs .claude/skills ":!docs/superpowers/plans"`
Expected hits to fix: `docs/plugin-structure.md:239` (add `[--run <dir>]` to the command, the trailer-then-manifest-window attribution to the self-edit clause, and exit 3's manifest case), `docs/journeys/catch-a-silent-journey-overwrite.md` (step 1's URL gains `--run "{parent}"`; step 2 and step 6's test-1 wording name both sources). The journey's steps 2-4 commands (lines 25, 32, 39) are replays of this repo's own history with no manifest and stay as they are. Every other hit is either the doc edited in Step 3 or the code from Tasks 1-2. (Grep run once at authoring: 13 hits, exactly these.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/multispec-artifact-namespacing-conformance.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C "{worktree}" add plugin/skills/flow/multispec-artifact-namespacing.md tests/multispec-artifact-namespacing-conformance.test.js docs/plugin-structure.md docs/journeys/catch-a-silent-journey-overwrite.md
git -C "{worktree}" commit -m "Pass --run to the artifact-overwrite check and describe manifest attribution — refs #4593"
```

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable: manifest-window attribution fallback | 1 |
| Deliverable: CLI `--run` flag, exit 3 on unreadable/unparseable | 2 |
| Deliverable: distinct unattributable reason | 1 |
| Deliverable: procedure update | 3 |
| Deliverable: module header comment | 1 |
| AC1.1, AC1.2, AC1.3, AC2.1, AC2.2, AC3.1, AC3.2, AC4.1, AC5.1 | 1 |
| AC6.1 | 2 |
| AC7.1 (Q1: AC1/2/4/5 by removing the fallback, AC3 by reverting the reason) | 1 Step 5 |
| AC8.1 (existing tests unchanged) | 1 Step 4, 2 Step 4 |
| AC9.1 | 3 |
| Technical Approach: `%aI` with `%B` in one call; `parseManifestYaml` reuse; pure window function | 1, 2 |
| Gotchas: author date; pinned `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`; parallel overlap → omit `--run`; #4590 already merged (rebase not needed) | 1, 3 |
