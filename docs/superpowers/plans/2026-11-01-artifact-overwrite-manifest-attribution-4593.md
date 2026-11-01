# Artifact-Overwrite Manifest-Window Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the multi-spec artifact-overwrite check attribute an untrailered commit to a spec through the run's `manifest.yml` phase windows, so a spec's own review fix to its own story/journey file stops tripping the HARD-GATE.

**Architecture:** Two pure functions in `plugin/bin/lib/flow/artifact-overwrite-check.js` validate a parsed manifest, turn it into per-spec time windows (or say why windows are off), and look a commit's author date up in them; `checkArtifactOverwrite` gains an optional `manifest` input and attributes each commit trailer-first, window-second. `plugin/bin/check-artifact-overwrite.js` gains `--run <dir>`, reads and parses `<dir>/manifest.yml` itself (exit 3 when it cannot), and passes the parsed manifest through; an unusable-but-parsed manifest throws `ArtifactOverwriteCheckError`, which the CLI's existing catch already maps to exit 3. The procedure doc passes `--run "{parent}"` for a sequential run.

**Tech Stack:** Node 18+ CommonJS, `node --test`, real `git` fixtures.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T204326-record-4593/work/4593-spec.md` (record #4593, including its Plan Review Clarifications Q1–Q11). Revises the prior attempt's plan (closed PR #4865, commit `4f700f390`) for Q8–Q11.

**Scope keywords:** checkArtifactOverwrite, check-artifact-overwrite, artifact-overwrite-check

## Global Constraints

- Attribution order, verbatim from the spec: "1. its own `refs #N` trailer, when present (unchanged); 2. otherwise, the single spec whose manifest window contains the commit's author date. A spec's window runs from its first recorded transition (`startedAt`, else its earliest `phases[].at`) up to the next spec's first recorded transition. The last spec's window is open-ended. 3. otherwise the commit is unattributed (an empty set, as today)."
- "A commit whose author date falls inside no window, or inside more than one, stays unattributed. The fallback never guesses."
- Q2/Q4: window attribution is switched off (refs-only) whenever any manifest spec has status `not-run` or `failed`.
- Q3: a spec's window ends at the next spec's first recorded transition; a `parallel` run omits `--run` and stays refs-only.
- Q5: "A `manifest.yml` that `parseManifestYaml` accepts but that lists no specs, or where a spec has an unparseable first transition (`startedAt`, or `phases[].at` when `startedAt` is absent), is the walk's own failure: exit 3, with stderr naming the field. A spec that is simply `pending` with no recorded transitions still only turns window attribution off (refs-only)."
- Q6: "window attribution turns off (refs-only) when spec transitions interleave, meaning any spec has a `phases[].at` at or after a later-starting spec's first transition. A sequential run never interleaves. The procedure still omits `--run` for a known `parallel` run."
- Q7: first-parent filtering is out of scope (filed as #4845). Do not add `--first-parent` to the walk.
- Q8: "A spec with no `startedAt` and no `phases[]` never causes exit 3, whatever its status (`complete`, `running`, `not-run`, or a non-standard hand-written status). It turns window attribution off (refs-only). Absent data is a real manifest shape, not corruption."
- Q9: "A transition timestamp that is present but unparseable, whether `startedAt` or any `phases[].at` entry, exits 3 with stderr naming the field. Together with Q8 the rule is: an absent transition turns windows off (refs-only), and a present but unparseable one exits 3."
- Q10: "A commit whose author second equals the whole second of any later spec's first transition counts as inside two windows, so it stays unattributed (refs-only for that commit). Pin it with a fixture where a commit is authored in the same second as the second spec's start."
- Q11: "The procedure omits `--run` only when waves actually ran with two or more members. In every other case, including the no-op `parallel` cases listed in `multispec-parallel-waves.md`, it passes `--run`, with the Q6 interleave guard as the backstop."
- Use the commit's **author** date (`%aI`), fetched in the same `git log -1` call as `%B` — never the committer date, never a second git call per commit.
- Parse the manifest with `manifest.js`'s `parseManifestYaml` — no second YAML reader. `manifest.js` itself is read-only for this change.
- Unattributable `reason` must contain `unattributable — no refs trailer and no manifest window` and must not contain `refs trailer does not match`; the entry stays in `overwrites[]` and the exit code stays 1.
- `--run` naming a dir with no readable `manifest.yml`, or one that does not parse, exits 3 with stderr naming the manifest path — never a silent refs-only fallback.
- Every existing test in `tests/bin-lib/flow/artifact-overwrite-check.test.js` and `tests/bin-lib/flow/check-artifact-overwrite-cli.test.js` passes unchanged.
- Governing skill `gh-api-module-pattern` (`cli-wrapper-contract.md`), quoted rules that apply:
  - "Every malformed-input class must actually reach its malformed code"; "A value-taking flag given as the last argv element reads `undefined` … Validate the value inside `parseArgs` … `typeof v !== 'string' || !v.trim() || v.startsWith('--')` returns a usage error — and pin both the trailing bare flag and the empty-string value with their own test cases."
  - "A guard added to an existing `run(argv, deps)` reaches the environment through `deps` too." → the manifest read goes through `deps.readFile`.
  - "A file the CLI is about to read is read directly with `ENOENT`/`ENOTDIR` caught as 'absent', never checked for existence first" — no `fs.existsSync` (it would also fail `tests/path-guard-conformance.test.js`).
  - "A read-only run-dir *reader* still owes a stated boundary posture … or state in the header why an unanchored read is safe for this CLI's callers." → this CLI states it (Task 2 Step 3).
  - "Adding a flag that a CLI forwards into a library function needs one CLI-level test of the forwarding, and the same sweep of every restated command line."
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."

## Decided rulings (not open questions)

- **Q5/Q9's error set, made exact.** `computeSpecWindows` throws `ArtifactOverwriteCheckError` (→ CLI exit 3) for exactly: (a) `multispec.specs` missing or empty; (b) a spec whose `startedAt` is present (not `undefined`/`null`/`''`) but `Date.parse` gives NaN; (c) a spec with a `phases[]` entry whose `at` is present but does not parse — any such entry, not only the earliest (Q9), because the Q6 interleave test reads every `phases[].at` and an unreadable one would make that test silently pass. Each message names the spec and the field. Nothing else throws — in particular (Q8) a spec with no transition at all, whatever its status, never throws. The prior plan's guard (d) ("a ran spec with no transition throws") is removed.
- **Absent transition (Q8).** A spec with no `startedAt` and no `phases[].at` value (no `phases[]`, an empty one, or entries whose `at` is absent) has no recorded transition. That turns windows off — `` `spec #${id} has no recorded transition` `` — never exit 3. An entry whose `at` is absent is skipped when computing first transitions and the interleave test (absent data, not corruption).
- **Off set.** After validation, windows are off (refs-only, exit 0/1) when, checked in this order: no manifest is supplied; any spec's status is not `complete` or `running` (`not-run`, `failed`, `pending` per Q2/Q4/Q5, and any non-standard status such as the hand-written `wrap-up-done (...)` found in real August manifests — fail safe); any spec has no recorded transition (Q8 — reached only by a `complete`/`running` spec, since every other status is already off); or transitions interleave (Q6).
- **Same-second ambiguity (Q10).** Git author dates carry whole seconds; manifest transitions carry milliseconds. `attributeByWindow` returns an empty Set whenever `Math.floor(authorMs / 1000) === Math.floor(w.start / 1000)` for any window `w` other than the earliest one (a "later spec's first transition"), before the ordinary `start <= ms < end` lookup. The earliest window needs no rule: a commit in the same second as the first spec's start is either inside that window or before every window, and the ordinary lookup already leaves the second case unattributed.
- **`--run` omission (Q11).** The procedure doc omits `--run` only when the run's `parallel` waves actually ran with two or more members (`multispec-parallel-waves.md`'s "Several members" path). Every other run passes it — a sequential run, and every no-op `parallel` case in that file's "No-op cases" list (or a run whose waves all had one member) — with the Q6 interleave guard as the backstop.
- **Interleave rule.** For every ordered pair of distinct specs S, T with `first(T) >= first(S)`, windows are off when any of S's transition times (`startedAt` and every `phases[].at`) is `>= first(T)`. Equal first transitions therefore always count as interleaved, so tied windows never reach attribution. `attributeByWindow` keeps its "2+ matches → unattributed" rule regardless, as the spec's own backstop.
- **Premise probe (run at authoring, scratch).** Over the 105 real `manifest.yml` files under the main checkout's `.claude-tweaks/pipelines/` and `pipelines/archive/`, an approximation of the interleave rule flagged 22 as interleaved — parallel-wave runs and dispatch bundles such as `archive/2026-10-19T170937-spec-3541-3543-3585` (3541 and 3543 started 1.3 s apart) and `archive/2026-10-31T115908-record-4385` — while known sequential runs such as `archive/2026-10-31T095259-spec-4549-4550-4556` and `archive/2026-10-30T132109-spec-4609-4610` do not interleave. Q6's guard is load-bearing on real data, not hypothetical. One real manifest lists 0 specs (Q5 → exit 3).
- **Catch-up-merge commits (Q7).** Out of scope; #4845 owns first-parent filtering.
- **Run-dir boundary posture:** unanchored read, stated in the CLI header. `manifest.yml`'s only writers (`hooks.js manifest-init` / `spec-status`) refuse a non-anchored `--run`, so a worktree-local shadow run dir never holds a `manifest.yml`; a dir without one exits 3 — loud, never a refs-only or wrong verdict.

## Review Focus

1. A parallel-wave manifest (members moved to `running` one after another, then building) must never produce a window-based clean — Task 1's interleave fixture and the real-manifest probe (Task 1 Step 6).
2. A manifest where a spec is `not-run`, `failed` or `pending` must keep refs-only behavior, never a window-based clean — Task 1 off cases + one fixture.
3. A parsed-but-unusable manifest (no specs, a bad `startedAt`, a bad `phases[].at`) must exit 3, never fall back silently; a spec with no transition at all (any status) must turn windows off, never exit 3 — Task 1 throw and off cases, Task 2 CLI cases.
4. An author date in the same whole second as a later spec's first transition is unattributed (Q10); otherwise start is inclusive and the next start exclusive — Task 1 boundary unit test and Q10 fixture.
5. `--run ""` and a trailing bare `--run` are malformed (exit 2), not a manifest read of `manifest.yml` in cwd — Task 2.

---

### Task 1: Manifest-window attribution in the check

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/flow/artifact-overwrite-check.js` (header comment lines 17-20 and 62-64; `getRefs` at 357-364; self-edit loop and reasons at 384-424; `module.exports`)
- Test: `tests/bin-lib/flow/artifact-overwrite-check.test.js` (append new tests; do not edit existing ones)
- Waived `plugin/bin/lib/flow/manifest.js`: read only — the tests call its `manifestInit`/`transitionSpec`/`readManifest` as the real writer, and Step 6 calls `parseManifestYaml`.

**Interfaces:**
- Produces:
  - `computeSpecWindows(manifest) -> { windows: Array<{ id, start: number, end: number }> | null, off: string | null }` — `manifest` is `parseManifestYaml`'s shape (`{ multispec: { specs: [...] } }`) or null/undefined. `start`/`end` are epoch ms; the last `end` is `Infinity`. `windows` is null exactly when `off` is non-null. `off` strings exactly: `'no manifest'`, `` `spec #${id} is ${status}` ``, `` `spec #${id} has no recorded transition` ``, `` `spec transitions interleave (spec #${s} has a transition at or after spec #${t}'s first transition)` ``. Throws `ArtifactOverwriteCheckError` with message prefix `manifest unusable: ` followed by one of exactly three: `manifest names no specs`, `` `spec #${id} startedAt is not a valid date (${value})` ``, `` `spec #${id} phases[${i}].at is not a valid date (${value})` ``. Validation (throws) runs over every spec before any off check.
  - `attributeByWindow(windows, authorDateMs) -> Set` — the one matching spec id, else an empty Set (null windows, non-finite date, a Q10 same-second hit on any window but the earliest, zero or 2+ matches). Match is `ms >= start && ms < end`.
  - `checkArtifactOverwrite(opts)` gains `opts.manifest` (optional, same shape), calls `computeSpecWindows` once before any git call (so an unusable manifest throws before the walk). Return shape unchanged.
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
// A parallel wave: both members move to running, then spec 10 keeps transitioning after spec 11 started.
const INTERLEAVED = [[10, 'running', 'build', T0], [11, 'running', 'build', T1], [10, 'running', 'test', '2026-01-01T12:30:00.000Z'], [10, 'complete', 'wrap-up', '2026-01-01T13:00:00.000Z'], [11, 'complete', 'wrap-up', '2026-01-01T14:00:00.000Z']];
const STORY = 'stories/x-10.yaml';
const STORY_V1 = 'name: x\nsteps:\n  locator: old-a\n  other: keep\n';
const STORY_V2 = 'name: x\nsteps:\n  locator: new-a\n  other: keep\n';
```

Tests (names carry the AC clause ids):

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
  // add at 10:30 (spec 10), modify at 12:30 (spec 11), no trailers, SEQUENTIAL manifest
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
  // with SEQUENTIAL manifest: assert clean true (trailer #10 ∩ window #10)
});

test('AC5.1: an author date before every spec\'s first transition leaves that commit unattributed', () => {
  // add untrailered at 09:00 (before T0); modify untrailered at 10:30 (window → 10)
  // with SEQUENTIAL manifest: assert clean false; one entry; reason includes `blamed commit ${addSha}`
  //   and 'unattributable'; reason does NOT include 'deleting commit' (the deleting commit IS attributed —
  //   this is what goes red without the fallback, since then both commits are unattributable)
});

test('Q2/Q4: a manifest naming a failed spec keeps refs-only behavior for the AC1 history', () => {
  // SEQUENTIAL but spec 11's last transition status 'failed'
  // assert clean false; reason includes '(manifest windows off: spec #11 is failed)'
});

test('Q6: an interleaved (parallel-wave) manifest keeps refs-only behavior for the AC1 history', () => {
  // AC1 history (add 10:30, modify 11:30, no trailers) with manifestRun(INTERLEAVED).manifest
  // (under INTERLEAVED windows both commits would fall in spec 10's [T0, T1) window — a clean — if the guard were absent)
  // assert clean false; reason includes '(manifest windows off: spec transitions interleave'
});

test('Q10: a modifying commit authored in the same second as spec 11\'s first transition stays unattributed', () => {
  // manifest via manifestRun with spec 11's first transition at '2026-01-01T12:00:00.400Z' (not T1):
  //   [[10,'running','build',T0],[10,'complete','wrap-up','2026-01-01T11:59:00.000Z'],
  //    [11,'running','build','2026-01-01T12:00:00.400Z'],[11,'complete','wrap-up','2026-01-01T14:00:00.000Z']]
  // add untrailered at 11:00:00Z (spec 10); modify untrailered at '2026-01-01T12:00:00Z'
  // (the ordinary lookup would put 12:00:00.000 inside spec 10's window, a clean — so this goes red without the Q10 rule)
  // assert clean false; one entry; reason includes `deleting commit ${modifySha}` and 'unattributable'
});

test('Q8: a complete spec with no recorded transition turns windows off, never throws', () => {
  // AC1 history (add 10:30, modify 11:30, no trailers) with manifest
  //   { multispec: { parent:'p/', specs: [{ id: 10, status: 'complete', startedAt: T0 }, { id: 11, status: 'complete' }] } }
  // assert: does not throw; clean false; reason includes '(manifest windows off: spec #11 has no recorded transition)'
});

test('Q5: checkArtifactOverwrite throws ArtifactOverwriteCheckError on an unusable manifest before walking', () => {
  // git stub that throws if called; manifest { multispec: { parent: 'p/', specs: [] } }
  // assert.throws(() => checkArtifactOverwrite({ base: 'x', git: stub, manifest }), (e) => e instanceof ArtifactOverwriteCheckError && /manifest unusable: manifest names no specs/.test(e.message))
});

test('computeSpecWindows: sequential specs tile [start, next start) with an open-ended last window', () => {
  const { windows, off } = computeSpecWindows(manifestRun(SEQUENTIAL).manifest);
  assert.strictEqual(off, null);
  assert.deepStrictEqual(windows, [
    { id: 10, start: Date.parse(T0), end: Date.parse(T1) },
    { id: 11, start: Date.parse(T1), end: Infinity },
  ]);
});

test('computeSpecWindows: phases[].at gives the first transition when startedAt is absent', () => {
  // { multispec: { parent:'p/', specs: [{ id: 10, status: 'complete', phases: [{ phase:'build', status:'running', at: T1 }, { phase:'test', status:'running', at: T0 }] }] } }
  // → off null, windows [{ id: 10, start: Date.parse(T0), end: Infinity }]
});

test('computeSpecWindows: off for a not-run, failed or pending spec, an interleaved run, and no manifest', () => {
  // not-run: manifestRun([[10,'running','build',T0],[10,'complete','wrap-up','2026-01-01T11:00:00.000Z'],[11,'not-run','build',T1]]) → off 'spec #11 is not-run', windows null
  // failed:  same with [11,'failed','build',T1] → off 'spec #11 is failed'
  // pending: manifestRun([[10,'running','build',T0]]) (spec 11 untouched, pending, no transitions) → off 'spec #11 is pending'
  // interleaved: manifestRun(INTERLEAVED) → off 'spec transitions interleave (spec #10 has a transition at or after spec #11\'s first transition)'
  // equal starts: { multispec: { parent:'p/', specs: [{ id: 10, status: 'complete', startedAt: T0 }, { id: 11, status: 'complete', startedAt: T0 }] } } → off starts with 'spec transitions interleave'
  // null → off 'no manifest'
});

test('computeSpecWindows (Q8): a spec with no recorded transition turns windows off for any status, never throws', () => {
  // for each status of 'complete', 'running', 'not-run', 'wrap-up-done (hand-written)':
  //   { multispec: { parent:'p/', specs: [{ id: 10, status: 'complete', startedAt: T0 }, { id: 11, status, phases: [] }] } }
  //   → does not throw; windows null; off is 'spec #11 has no recorded transition' for 'complete'/'running',
  //     `spec #11 is ${status}` for the other two (status check runs first)
  // a phases entry with no `at` and no startedAt: [{ id: 11, status: 'complete', phases: [{ phase: 'build', status: 'running' }] }]
  //   → does not throw; off 'spec #11 has no recorded transition'
});

test('computeSpecWindows: throws manifest unusable for no specs, a bad startedAt, and a bad phases[].at', () => {
  // each via assert.throws(..., e => e instanceof ArtifactOverwriteCheckError && <message regex>):
  // { multispec: { parent:'p/', specs: [] } } → /manifest unusable: manifest names no specs/
  // [{ id: 10, status: 'complete', startedAt: 'not-a-date' }] → /spec #10 startedAt is not a valid date \(not-a-date\)/
  // (Q9) [{ id: 10, status: 'complete', startedAt: T0, phases: [{ phase: 'build', status: 'running', at: 'garbage' }] }] → /spec #10 phases\[0\]\.at is not a valid date \(garbage\)/
  // (Q9, guard order) [{ id: 10, status: 'not-run', startedAt: 'not-a-date' }] → still throws the startedAt message (validation precedes the status off check)
  // (each fixture differs from a valid one in exactly that one field, so each assertion isolates its own guard)
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

test('attributeByWindow (Q10): a commit second equal to a later window start\'s whole second is unattributed', () => {
  const windows = [{ id: 10, start: 1000, end: 5400 }, { id: 11, start: 5400, end: Infinity }];
  assert.deepStrictEqual([...attributeByWindow(windows, 5000)], []); // 5.000 s: ordinary lookup says #10
  assert.deepStrictEqual([...attributeByWindow(windows, 4000)], [10]); // previous second: unaffected
  assert.deepStrictEqual([...attributeByWindow(windows, 6000)], [11]); // next second: unaffected
  assert.deepStrictEqual([...attributeByWindow(windows, 1000)], [10]); // earliest window's own start second: no Q10 rule
});
```

The commented test bodies follow the AC1 test's shape; the assertions listed are the full set each must make.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/flow/artifact-overwrite-check.test.js`
Expected: FAIL after Step 1 — `computeSpecWindows is not a function` / `attributeByWindow is not a function`, and the AC1 test reports an overwrite.

- [ ] **Step 3: Implement**

- `computeSpecWindows(manifest)` / `attributeByWindow(windows, ms)` per the Interfaces block and the Decided rulings. Order: null/undefined manifest → off `'no manifest'`; then validate every spec (throws only the three messages); then status off check in manifest order (`complete`/`running` pass); then the no-recorded-transition off check (Q8); then the interleave check; then sort by first transition ascending and set each `end` to the next spec's start, the last to `Infinity`. "Present" means not `undefined`, `null` or `''`. First transition = `Date.parse(spec.startedAt)` when `startedAt` is present, else the minimum `Date.parse(p.at)` over `phases[]` entries whose `at` is present; none → no recorded transition. In `attributeByWindow`, apply the Q10 same-second rule (any window but the earliest by `start`) before the ordinary lookup.
- In `checkArtifactOverwrite`: destructure `manifest`; compute `const { windows, off } = computeSpecWindows(manifest)` once, before the `git log` walk. Replace `getRefs` with `getAttribution(sha) -> { ids: Set, source: 'refs trailer' | 'manifest window' | null }`, cached per sha, one call `git(['log', '-1', '--format=%aI%n%B', sha], cwd)`: the first line is the author date, the rest the message. Trailer refs non-empty → `{ ids, source: 'refs trailer' }`; else window ids non-empty → `'manifest window'`; else `{ ids: new Set(), source: null }`.
- Self-edit stays `dAttr.ids.size > 0 && setsIntersect(dAttr.ids, bAttr.ids)`. Record on the culprit which side(s) had `source === null`.
- Reasons (the no-blame reason at line 422 is unchanged):
  - unattributable (either side empty): `` `deleted line ${lineNo} (as of parent ${commit}~1) traces to commit ${blamedSha}; unattributable — no refs trailer and no manifest window for ${who}${off ? ` (manifest windows off: ${off})` : ''}, so a same-spec self-edit cannot be confirmed, and the deletion is neither a list reflow, a step-markup reformat, a step renumber, nor a reference-preserving Origin line` `` where `who` is `deleting commit ${commit}`, `blamed commit ${blamedSha}`, or `deleting commit ${commit} and blamed commit ${blamedSha}`.
  - mismatch (both attributed): `` `deleted line ${lineNo} (as of parent ${commit}~1) traces to commit ${blamedSha}, attributed to ${fmt(bAttr)}, which does not match ${commit}'s own ${fmt(dAttr)}, and the deletion is neither …` `` (same tail as today), `fmt` = ids as `#10, #11` plus ` (by {source})`.
- Header comment: rewrite test 1 (lines 17-20) to name both attribution sources and their order, the author-date rule and the same-second rule (Q10), when windows are off (no manifest, a spec not `complete`/`running`, a spec with no recorded transition, interleaved transitions) and that an unusable manifest (no specs, a present-but-invalid timestamp) throws; update the "Fails closed" sentence (62-64) to say "no blame, no attribution from a refs trailer or a manifest window".

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/flow/artifact-overwrite-check.test.js`
Expected: PASS, every pre-existing test included.

- [ ] **Step 5: Prove discrimination (AC7.1, Q1)** — scratch, not committed. (a) Temporarily make `getAttribution` skip the window branch; re-run the file: the AC1.1, AC2.1, AC4.1 and AC5.1 tests must FAIL. Restore. (b) Temporarily change the unattributable reason to the old `whose refs trailer does not match` wording; the AC3.1 test must FAIL. Restore. (c) Temporarily delete the interleave check; the Q6 fixture test and the interleaved/equal-starts `computeSpecWindows` cases must FAIL. Restore. (d) Delete each of the three throw guards in turn; its own throw case must FAIL each time. Restore. (e) Delete the Q10 same-second rule; the Q10 fixture test and the `attributeByWindow (Q10)` unit test must FAIL. Restore. (f) Delete the Q8 no-recorded-transition off check; the Q8 fixture test and the `computeSpecWindows (Q8)` `complete`/`running` cases must FAIL (or crash), never pass. Restore. Record each mutation with `log-decision.js --status AUTO --section "/build" --step "AC evidence"` (one line each, naming the mutation and the failing test names).

- [ ] **Step 6: Real-input probe (scratch)** — write a scratch script outside the repo that, for every `manifest.yml` under `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/` and its `archive/`, reads it, runs `parseManifestYaml`, then `computeSpecWindows` (catching `ArtifactOverwriteCheckError`), and tallies `windows on` / each `off` reason / each throw message. Independently count interleave with the authoring-time approximation (22 of 105 flagged). Reconcile the two interleave counts — a difference is explained (e.g. an interleaved run that the new code reports off for a status reason first) or fixed. Confirm `archive/2026-10-31T095259-spec-4549-4550-4556` yields three windows starting `2026-10-31T09:59:21.850Z`, `2026-10-31T11:44:07.624Z`, `2026-10-31T13:33:20.726Z`, and `archive/2026-10-19T170937-spec-3541-3543-3585` yields an interleave off. With Q8 the authoring-time "0-spec manifest → exit 3" count is unchanged, but any manifest the prior rule threw on for a ran-but-no-transition spec now reports off; report that count. Write the full output to `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-01T204326-record-4593/evidence/manifest-probe.txt` (plain Bash redirect, after `mkdir -p` of the `evidence` dir) and log one `AC evidence` entry with the tally.

- [ ] **Step 7: Commit**

```bash
git -C "{worktree}" add plugin/bin/lib/flow/artifact-overwrite-check.js tests/bin-lib/flow/artifact-overwrite-check.test.js
git -C "{worktree}" commit -m "Attribute untrailered commits by manifest window — refs #4593"
```

### Task 2: `--run <dir>` on the CLI

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/check-artifact-overwrite.js` (header comment, `USAGE`, `run`)
- Test: `tests/bin-lib/flow/check-artifact-overwrite-cli.test.js` (append new tests; existing tests unchanged. The file may extend its require/import lines: add `spawnSync` to the `child_process` import, a require of `plugin/bin/lib/flow/manifest.js`'s `manifestInit`/`transitionSpec`, and its own local pinned-date commit helper — Task 1's `commitAt`/`manifestRun` are locals of the other test file and are not shared)

**Interfaces:**
- Consumes: `checkArtifactOverwrite(opts)` with `opts.manifest` (Task 1), which throws `ArtifactOverwriteCheckError` on an unusable manifest; `parseManifestYaml(text)` from `./lib/flow/manifest.js`.
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

test('Q5: --run naming a manifest that parses but lists no specs exits 3 naming the field', () => {
  // write 'multispec:\n  parent: p/\n  specs:\n' to <dir>/manifest.yml; real check (no deps.check stub)
  // run(['node','check-artifact-overwrite.js','--base','a','--run',dir], io) → 3;
  // io.err() matches /manifest unusable: manifest names no specs/; io.out() === ''
});

test('Q9: --run naming a manifest with an unparseable phases[].at exits 3 naming the field', () => {
  // write 'multispec:\n  parent: p/\n  specs:\n    - id: 10\n      status: complete\n      startedAt: 2026-01-01T10:00:00.000Z\n      phases:\n        - phase: build\n          status: running\n          at: garbage\n'
  //   (check the exact indentation against manifest.js's serializeManifestYaml before committing — or write it via
  //    manifestInit + transitionSpec and then replace the one `at:` value in the file text)
  // real check; → 3; io.err() matches /spec #10 phases\[0\]\.at is not a valid date \(garbage\)/
});

test('Q8: --run naming a manifest whose spec has no recorded transition is a verdict (exit 0/1), not exit 3', () => {
  // real repo fixture with the AC1 untrailered history; manifest via manifestInit({ specs: [10, 11] }) + spec 10
  //   running at 10:00Z and complete at 11:59Z, then rewrite the file so spec 11 reads `status: complete` with no
  //   startedAt and no phases (a `pending` spec 11 would take the status-off branch first and never reach Q8's)
  // spawnSync CLI with --run → status 1 (refs-only overwrite, not 3), stdout JSON's overwrites[0].reason
  //   includes 'manifest windows off: spec #11 has no recorded transition'
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
  //   spec 10 running at 10:00Z, complete at 11:59Z, spec 11 running at 12:00Z, complete at 14:00Z
  // spawnSync('node', [CLI, '--base', base, '--path', 'stories/', '--run', runDir], { cwd: dir }) → status 0, JSON clean
  // same without --run → status 1
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/flow/check-artifact-overwrite-cli.test.js`
Expected: FAIL after Step 1 — `unknown argument: --run` (exit 2 where 3/0 expected).

- [ ] **Step 3: Implement**

- Arg loop: `case '--run':` rejects `!value.trim() || value.startsWith('--')` with `check-artifact-overwrite: --run requires a directory` + USAGE, exit 2; else `opts.run = value`.
- After the `--base` check, when `opts.run` is set: `const file = path.join(opts.run, 'manifest.yml')`; `deps.readFile(file, 'utf8')` in try/catch → `check-artifact-overwrite: cannot read manifest ${file}: ${err.message}`, exit 3; `parseManifestYaml(text)` null → `check-artifact-overwrite: manifest ${file} does not parse as a multi-spec manifest`, exit 3; then pass `{ ...opts-without-run, manifest }` to `check`. The unusable-manifest case needs no new code: the existing `ArtifactOverwriteCheckError` catch prints the message and returns 3.
- `USAGE` and header Usage line gain `[--run <dir>]`; header: `--run` documented (reads `<dir>/manifest.yml`, the multi-spec parent run dir; enables manifest-window attribution; omitted only for a run whose `parallel` waves ran with two or more members); exit 3 also covers a missing, unreadable or unparseable manifest named by `--run`, and one that lists no specs or carries a present-but-invalid transition timestamp (a spec with no transition at all is not exit 3 — it turns windows off); boundary posture paragraph per the Decided rulings (unanchored read, why safe).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/flow/check-artifact-overwrite-cli.test.js tests/bin-lib/flow/artifact-overwrite-check.test.js`
Expected: PASS.

- [ ] **Step 5: Prove the forwarding test discriminates** — scratch: drop `manifest` from the object passed to `check`; the forwarding and end-to-end tests must FAIL; restore. Log one `AC evidence` line.

- [ ] **Step 6: Commit**

```bash
git -C "{worktree}" add plugin/bin/check-artifact-overwrite.js tests/bin-lib/flow/check-artifact-overwrite-cli.test.js
git -C "{worktree}" commit -m "Add --run to check-artifact-overwrite for manifest-window attribution — refs #4593"
```

### Task 3: Procedure doc and restated command lines

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/flow/multispec-artifact-namespacing.md` (command block at line 44, test 1 at 51-54, exit paragraph at 83-90)
- Modify: `tests/multispec-artifact-namespacing-conformance.test.js` (one new assertion + its go-red control)
- Modify: `docs/plugin-structure.md:239` (the `check-artifact-overwrite.js` command line)
- Modify: `docs/journeys/catch-a-silent-journey-overwrite.md` (line 18's command; line 60's test-1 description)
- No change: `docs/journeys/catch-a-silent-journey-overwrite.md` lines 25, 28, 32, 39 — replays of this repo's own history with no manifest, whose results the trailer rule still explains.

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
function assertRunOmissionRule(text) {
  assert.match(flatten(text), /Omit `--run` only when this run's `parallel` waves actually ran with two or more members/);
}
test('Q11: the procedure omits --run only for waves that ran with two or more members', () => {
  assertRunOmissionRule(read(NAMESPACING_FILE));
});
test('go-red proof: the old "a parallel run omits --run" wording fails the Q11 assertion', () => {
  assert.throws(() => assertRunOmissionRule('a run started with the `parallel` token omits `--run`'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/multispec-artifact-namespacing-conformance.test.js`
Expected: FAIL after Step 1 — on AC9.1 only.

- [ ] **Step 3: Edit the doc**

- Command: `node "${CLAUDE_PLUGIN_ROOT}/bin/check-artifact-overwrite.js" --base "{EXPECTED_BASE}" --run "{parent}" --path docs/journeys/ --path stories/`, followed by one paragraph: `{parent}` is the multi-spec parent run dir that holds `manifest.yml` (`$MULTISPEC_PARENT_DIR`). Omit `--run` only when this run's `parallel` waves actually ran with two or more members (`multispec-parallel-waves.md`'s "Several members" path) — those members build concurrently in their own worktrees, so their windows overlap and the check stays refs-only. Every other run passes `--run`, including each no-op `parallel` case `multispec-parallel-waves.md` lists and a run whose waves each had one member; the tool also turns windows off itself when the manifest's transitions interleave, the backstop for a parallel run that reaches it with `--run`.
- Test 1: attribution sources and order — the deleting commit's and each blamed commit's own `refs #{N}` trailer first; otherwise the one spec whose `manifest.yml` window (first recorded transition up to the next spec's) holds the commit's author date; otherwise unattributed (a date in no window, in two, or in the same second as a later spec's first transition). Windows are off — refs-only — when a spec is not `complete`/`running` (e.g. `not-run`, `failed`, `pending`), a spec has no recorded transition, or the specs' transitions interleave. An unattributable deletion still fails, with a reason saying `unattributable` so the manual ruling can tell a missing attribution from a confirmed cross-spec deletion.
- Exit paragraph: exit `3` also covers a missing, unreadable, unparseable or unusable `manifest.yml` named by `--run` (no specs, or a `startedAt`/`phases[].at` that is present but not a valid date); the HARD-GATE report names both commits' spec attributions (the `reason` text) instead of "both commits' spec ids (`refs #{N}`)".
- Byte headroom: file is under 7 KB against `RAIL_BYTES` 52,500 — no risk; record `wc -c` after.

- [ ] **Step 4: Sweep restated command lines and test-1 prose**

Run: `git grep -n -i -e "check-artifact-overwrite.js\" --base" -e "check-artifact-overwrite.js --base" -e "refs #{N}\` trailer" -e "same-spec self-edit" -e "same \`refs" -- plugin docs .claude/skills ":!docs/superpowers/plans"`
Expected hits (run at authoring: 13): fix `docs/plugin-structure.md:239` (add `[--run <dir>]` to the command, the trailer-then-manifest-window attribution to the self-edit clause, and exit 3's manifest case) and `docs/journeys/catch-a-silent-journey-overwrite.md:18` (the command gains `--run "$MULTISPEC_PARENT_DIR"` after its `--base "$EXPECTED_BASE"`, matching the line's existing shell-variable style) and `:60` (test 1 names both sources). Lines 25, 28, 32, 39 stay (no-change, see Files). Every other hit is the doc edited in Step 3 or the code from Tasks 1-2.

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
| Deliverable: CLI `--run` flag, exit 3 on missing/unparseable/unusable | 1 (throw), 2 |
| Deliverable: distinct unattributable reason | 1 |
| Deliverable: procedure update | 3 |
| Deliverable: module header comment | 1 |
| AC1.1, AC1.2, AC1.3, AC2.1, AC2.2, AC3.1, AC3.2, AC4.1, AC5.1 | 1 |
| AC6.1 | 2 |
| AC7.1 (Q1: AC1/2/4/5 by removing the fallback, AC3 by reverting the reason) | 1 Step 5 |
| AC8.1 (existing tests unchanged) | 1 Step 4, 2 Step 4 |
| AC9.1 | 3 |
| Q2/Q4 (not-run/failed off), Q5 (unusable → exit 3, pending → off), Q6 (interleave off), Q7 (out of scope) | 1, 2, 3 |
| Q8 (no recorded transition → off, never exit 3), Q9 (present-but-invalid timestamp → exit 3), Q10 (same-second → unattributed), Q11 (omit `--run` only for 2+-member waves) | 1, 2, 3 |
| Technical Approach: `%aI` with `%B` in one call; `parseManifestYaml` reuse; pure window function | 1, 2 |
| Gotchas: author date; pinned `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`; parallel overlap → omit `--run` + interleave off; #4590 already merged (no rebase needed) | 1, 3 |
