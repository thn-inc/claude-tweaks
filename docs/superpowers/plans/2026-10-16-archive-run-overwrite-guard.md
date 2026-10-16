# Archive-Run Overwrite Guard (#3198) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `archiveRunDir` never silently overwrites an existing `archive/{runId}/{entry}` — it refuses on collision, or appends for the two append-only logs (`decisions.md`, `events.jsonl`). `close-run` and `release-claim.js` never recreate an absent run dir — they refuse/skip the local write instead, matching `log-decision.js`.

**Architecture:** `archive-merged.js` gains one small helper (`moveArchiveEntry`) used by its three `fs.renameSync` loops (top-level, per-spec, late-write-guard straggler sweep); a collision throws a typed error the first two loops turn into a new refusal reason (`archive-destination-exists[-partial-revert]`), the straggler loop's existing best-effort catch absorbs it unchanged. `close-run-state.js` adds an upfront `fs.existsSync(runDir)` guard returning a new `{ status: 'missing' }` (hooks.js's `close-run` handler renders it). `release-claim.js` re-resolves `resolveTarget` immediately before the `appendEntry` call (closing the TOCTOU window between the early resolve and the late write, which is where the real race lives — `release.releaseClaim`'s own GitHub calls run in between).

**Tech Stack:** Node 18+, `node --test`, no external deps.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T052544-record-3198/work/3198-spec.md`

## Root cause (confirmed by reading, not guessed)

- `archiveRunDir`'s three `fs.renameSync(src, dest)` loops (`plugin/bin/lib/reconcile/archive-merged.js`, top-level ~line 1088, per-spec ~line 1138, late-write-guard stragglers ~line 1189) never check whether `dest` already exists — a second archival pass of the same run id silently clobbers the first pass's real content.
- The actual recreation mechanism: `appendEntry` (`plugin/bin/lib/log-decision/append.js`) acquires a lock at `path.join(runDir, '.decisions.lock')` via `file-lock.js`'s `withLock`/`acquireLock`. `acquireLock`'s `ENOENT` branch (`plugin/bin/lib/file-lock.js`, the "common bootstrap race on a fresh project" comment) does `fs.mkdirSync(parentDir, { recursive: true })` — i.e. it recreates `runDir` itself when the lock's parent is missing. `log-decision.js`'s CLI never reaches this because it checks `resolveTarget` and exits 3 immediately, with no intervening work before a hypothetical `appendEntry` call. `release-claim.js` also checks `resolveTarget` early (`target.ok`), but defers the actual `appendEntry` call until *after* `release.releaseClaim(...)`'s GitHub API round-trips — a window wide enough for a concurrent, unlocked `reconcile` pass to archive (and `rmdirSync`) the run dir in between, so the stale `target.ok === true` lets a now-dead `runDir` get silently recreated by the lock's own bootstrap path.
- `close-run`'s path is similar in shape but via `ctxLib.writeRunState`'s own `acquireRunStateLock` (a separate, hand-rolled lock in `context.js` that already treats a missing `runDir` as "nothing to lock" — `e.code !== 'EEXIST'` returns `null`, no recreation there) — but `writeRunState` has no early existence guard at all, so once this run dir is observed to exist by whatever resolved it (`resolveRunArg`'s fallback resolver can return a path that was live moments ago), it just attempts the write without re-checking.

## Global Constraints

- Payload source is `plugin/` in this worktree, never the installed plugin cache.
- `archiveRunDir`'s existing refusal contract is untouched: `refuseAfterMarker`'s pre-existing-archive-dir / `movedEntries.length === 0` cleanup logic stays as-is — the new reasons are not added to `GIT_TIMING_REFUSAL_REASONS` (the collision is deterministic, not a transient git-timing race).
- `decisions.md`/`events.jsonl` are the only two append-only entries. Everything else (`run-state.json`, `manifest.yml`, `staged/`, …) refuses on collision — never guess at a third category.
- Commit messages: `{Verb} {what} — {detail}`, `refs #3198` (never `closes`/`fixes`), ending with `Claude-Session: https://claude.ai/code/session_01RJY4evdjKSR6wcvg46VpXe`.
- Never run `git stash`. One plain command per Bash call; no `&&` chains, loops, or heredocs.
- Run long commands (`npm test`) in the foreground; never `run_in_background`.
- Established-maturity-adjacent rule (this file predates the maturity table but the spirit applies): every modified function already has a direct unit test — add characterization coverage for the exact pre-fix behavior (overwrite-on-collision, recreate-on-missing) before changing it, so the new tests are provably red on the old code (verified by reverting, not asserted).
- Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same.

## Review Focus

- A second archival pass's `decisions.md`/`events.jsonl` append must leave the first pass's original bytes as an unmodified **prefix** — never reordered, never re-encoded.
- A collision on any non-append-only entry must refuse with `archive-destination-exists` (or `-partial-revert`) and leave both the stale `src` untouched and the real `archive/{runId}/{entry}` untouched.
- `close-run` against a missing run dir must create no files at the old path and must not throw.
- `release-claim.js` against a missing run dir must still release the GitHub claim and post the comment (those don't depend on the local run dir) while skipping only the local `decisions.md` write.
- The late-write-guard straggler loop's existing best-effort semantics (never refuses the whole call) must survive unchanged for ordinary move failures — only the collision case gets new behavior (append for the two log files, silent skip-and-leave-on-disk for anything else, exactly like today's generic failure catch).

---

### Task 1: `archiveRunDir` refuse-or-append on destination collision

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` (the three `fs.renameSync` loops; add `moveArchiveEntry`/`ArchiveDestinationExistsError`/`APPEND_ONLY_ARCHIVE_ENTRIES` near `refuseAfterMarker`)
- Test: `tests/bin-lib/reconcile/archive-merged.test.js` (append new tests near the other `archiveRunDir:` tests)

**Interfaces:**
- Produces: `moveArchiveEntry(src, dest, name) -> { moved: true } | { appended: true }`, throwing `ArchiveDestinationExistsError` on a non-append-only collision (propagates real `fs` errors unchanged otherwise).
- Consumes: existing `refuseAfterMarker`, `revertPlainMoves` — unchanged signatures.

- [ ] **Step 1: Write the failing test**

Add to `tests/bin-lib/reconcile/archive-merged.test.js` (near the other simple `archiveRunDir:` tests, e.g. after the "empty untracked work/" test):

```js
// #3198: a second archival pass against a run dir recreated at the same
// path (the exact race this record's Current State documents — a
// concurrent reconcile archives the run, then a stale caller holding the
// pre-archive path recreates it) must never destroy the first pass's real
// archived content. decisions.md/events.jsonl accumulate (append); every
// other entry refuses outright.
test('archiveRunDir: a second pass against a recreated run dir appends decisions.md/events.jsonl and refuses on run-state.json instead of overwriting (#3198)', () => {
  const root = makeRepo();
  const runId = '2026-10-15T184334-record-3119';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);

  fs.mkdirSync(runDir, { recursive: true });
  const realDecisions = '# decisions\n- AUTO 00:00:01 — step one. Reversibility: n/a.\n- AUTO 00:00:02 — step two. Reversibility: n/a.\n';
  fs.writeFileSync(path.join(runDir, 'decisions.md'), realDecisions);
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), '{"type":"start"}\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));

  const first = archiveRunDir(root, runDir);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(fs.readFileSync(path.join(archiveDir, 'decisions.md'), 'utf8'), realDecisions);
  assert.equal(fs.existsSync(runDir), false);

  // Simulate the race: a stale caller recreates the run dir with a stub.
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'decisions.md'), '- AUTO 00:00:03 — stub entry from a stale caller. Reversibility: n/a.\n');
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), '{"type":"stub"}\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active', stub: true }));

  const second = archiveRunDir(root, runDir);
  assert.equal(second.ok, false, JSON.stringify(second));
  assert.equal(second.reason, 'archive-destination-exists');

  const archivedDecisions = fs.readFileSync(path.join(archiveDir, 'decisions.md'), 'utf8');
  assert.ok(archivedDecisions.startsWith(realDecisions), 'original archived decisions.md content must survive byte-for-byte as a prefix');
  assert.ok(archivedDecisions.includes('stub entry from a stale caller'), 'the stub entry is appended, not dropped');
  const archivedEvents = fs.readFileSync(path.join(archiveDir, 'events.jsonl'), 'utf8');
  assert.equal(archivedEvents, '{"type":"start"}\n{"type":"stub"}\n');

  // run-state.json is not append-only — the stale stub must never land on
  // top of (or replace) the real archived one.
  const archivedState = JSON.parse(fs.readFileSync(path.join(archiveDir, 'run-state.json'), 'utf8'));
  assert.equal(archivedState.stub, undefined, 'the real archived run-state.json must be untouched');
  // The refusal leaves the stub run-state.json exactly where the race put it.
  assert.equal(fs.existsSync(path.join(runDir, 'run-state.json')), true);
});
```

Run it to confirm it fails on the current code (it will — the second `archiveRunDir` call currently returns `{ ok: true }` and silently clobbers the archived `decisions.md`/`run-state.json`):

```
node --test tests/bin-lib/reconcile/archive-merged.test.js
```

- [ ] **Step 2: Implement `moveArchiveEntry` and wire it into the three loops**

In `plugin/bin/lib/reconcile/archive-merged.js`, near `refuseAfterMarker`'s definition, add:

```js
// #3198: decisions.md/events.jsonl are append-only logs that can legitimately
// accumulate across more than one archival pass of the same run id (a race
// where a stale caller recreates runDir after it was already archived, or a
// second reconcile pass observes the same recreated dir) — losing either
// pass's content is never acceptable. Every other entry refuses outright on
// a destination collision instead of silently overwriting real archived
// content (this record's own incident: a recreated run dir's fresh
// run-state.json replaced the real archived one).
const APPEND_ONLY_ARCHIVE_ENTRIES = new Set(['decisions.md', 'events.jsonl']);

class ArchiveDestinationExistsError extends Error {
  constructor(dest) {
    super(`archive destination already exists: ${dest}`);
    this.code = 'ARCHIVE_DEST_EXISTS';
  }
}

// Moves one archive entry from `src` to `dest`. When `dest` already exists:
// an append-only log (APPEND_ONLY_ARCHIVE_ENTRIES) gets src's bytes appended
// onto dest, then src is removed — dest's original content is never
// truncated or replaced. Anything else throws ArchiveDestinationExistsError
// without touching either path, so the caller can refuse cleanly. A real
// fs failure (permissions, disk full) propagates unchanged — callers already
// catch that for their own revert/refusal handling.
function moveArchiveEntry(src, dest, name) {
  if (fs.existsSync(dest)) {
    if (APPEND_ONLY_ARCHIVE_ENTRIES.has(name)) {
      fs.appendFileSync(dest, fs.readFileSync(src));
      fs.unlinkSync(src);
      return { appended: true };
    }
    throw new ArchiveDestinationExistsError(dest);
  }
  fs.renameSync(src, dest);
  return { moved: true };
}
```

Replace the top-level loop's body (the `for (const name of entries.filter(...))` block that currently does a bare `try { fs.renameSync(src, dest); } catch (err) { ... }`) with:

```js
    for (const name of entries.filter((n) => n !== 'work' && !specDirs.includes(n))) {
      const src = path.join(runDir, name);
      if (!fs.existsSync(src)) continue;
      const dest = path.join(archiveDir, name);
      let outcome;
      try {
        outcome = moveArchiveEntry(src, dest, name);
      } catch (err) {
        const fullyReverted = revertPlainMoves(movedThisPass);
        if (err instanceof ArchiveDestinationExistsError) {
          const reason = fullyReverted ? 'archive-destination-exists' : 'archive-destination-exists-partial-revert';
          return refuseAfterMarker(reason, { entry: name, hint: err.message });
        }
        const reason = fullyReverted ? 'move-failed' : 'move-failed-partial-revert';
        return refuseAfterMarker(reason, {
          lastError: err && err.message,
          hint: reason === 'move-failed' ? ((err && err.message) || null) : null,
        });
      }
      if (outcome.moved) movedThisPass.push([src, dest]);
      movedEntries.push(name);
    }
```

Apply the same shape to the per-spec loop (`specMovedThisPass` in place of `movedThisPass`).

Replace the late-write-guard straggler loop's body with:

```js
    for (const name of stragglers) {
      const src = path.join(runDir, name);
      if (!fs.existsSync(src)) continue;
      const dest = path.join(archiveDir, name);
      try {
        moveArchiveEntry(src, dest, name);
        movedEntries.push(name);
      } catch {
        /* best-effort — leave it on disk for the next archival pass to
           retry rather than fail this whole call over a residual
           straggler; the rmdirSync below naturally stays a no-op then.
           Covers both a real move failure and a non-append-only collision
           (#3198) — either way, nothing here should destroy existing
           archive content or block the rest of this call. */
      }
    }
```

Export `moveArchiveEntry` and `ArchiveDestinationExistsError` from the module's existing `module.exports` block only if a test needs to import them directly — the Step 1 test above exercises them only through `archiveRunDir`, so no export change is required unless review finds a reason to unit-test them in isolation.

- [ ] **Step 2 verification:** `node --test tests/bin-lib/reconcile/archive-merged.test.js` — the new test passes; every pre-existing test in the file still passes (the file is large — run it in full, not a subset).

---

### Task 2: `close-run` refuses on a missing run dir

**Files:**
- Modify: `plugin/bin/lib/hooks/close-run-state.js` (`closeRunState`)
- Modify: `plugin/bin/hooks.js` (the `close-run` command handler's result-status branches)
- Test: `tests/bin-lib/hooks/close-run-state.test.js`

**Interfaces:**
- Produces: `closeRunState` gains a new return shape `{ status: 'missing' }`, checked first, before any read/write.

- [ ] **Step 1: Write the failing test**

Add to `tests/bin-lib/hooks/close-run-state.test.js`:

```js
// #3198: a run dir already archived (or otherwise removed) between
// resolution and this call must never be recreated by a write attempt —
// matching log-decision.js's own refusal instead of writing fresh
// bookkeeping files into a path a concurrent archival just removed.
test('closeRunState: a non-existent run dir refuses with status "missing" and creates nothing', () => {
  const missing = path.join(os.tmpdir(), 'close-run-state-test-missing-' + Date.now());
  const r = closeRunState(missing, { explicit: true, callerIdentity: { sessionId: 's1' } });
  assert.strictEqual(r.status, 'missing');
  assert.strictEqual(fs.existsSync(missing), false);
});
```

Run `node --test tests/bin-lib/hooks/close-run-state.test.js` to confirm it fails on current code (today it proceeds into `readRunState`/`writeRunState`, and `writeRunState` — depending on timing — can recreate `runDir` via its own atomic-write tmp file inside a directory a sibling call's lock bootstrap just recreated; the assertion that nothing exists at `missing` afterward is the one most likely to catch the live bug deterministically in a single-process test even where a parallel race is hard to reproduce head-on).

- [ ] **Step 2: Implement the guard**

In `plugin/bin/lib/hooks/close-run-state.js`, as the very first line of `closeRunState`'s body (before `const prev = ctxLib.readRunState(runDir);`):

```js
function closeRunState(runDir, {
  explicit = false, callerIdentity = null, checkLiveWorktree = true,
} = {}) {
  // #3198: a run dir can be removed (archived) by a concurrent, unlocked
  // reconcile pass between whatever resolved `runDir` for this call and
  // this point. Refuse rather than let a downstream write recreate it —
  // matching log-decision.js's own "run dir does not exist" refusal.
  if (!fs.existsSync(runDir)) {
    return { status: 'missing' };
  }
  const prev = ctxLib.readRunState(runDir);
  ...
```

In `plugin/bin/hooks.js`'s `close-run` handler, add a branch alongside the existing `refused-foreign`/`refused-live-worktree` checks:

```js
      if (r.status === 'missing') {
        process.stdout.write(`claude-tweaks: run ${path.basename(runDir)} no longer exists on disk (already archived or removed) — run not closed\n`);
        return 0;
      }
```

(Place it immediately after the `refused-live-worktree` branch, before `if (r.foreignOwner)`.)

- [ ] **Step 2 verification:** `node --test tests/bin-lib/hooks/close-run-state.test.js` passes. Also run `node --test tests/dispatch-drain-close-run-reconcile.test.js` (names `close-run` in its own title) to confirm no regression.

---

### Task 3: `release-claim.js` refuses the local write on a missing run dir

**Files:**
- Modify: `plugin/bin/release-claim.js` (`run`)
- Test: `tests/bin-lib/release-claim/cli.test.js`

**Interfaces:** No signature change — `run(argv, deps)` unchanged; behavior-only fix.

- [ ] **Step 1: Write the failing test**

Add to `tests/bin-lib/release-claim/cli.test.js` (near other `decisions.md`-focused tests):

```js
// #3198: target.ok is resolved before release.releaseClaim's own GitHub
// round-trips run — if a concurrent archival removes runDir in that window,
// the stale target.ok must not let the later appendEntry call recreate
// runDir via its lock's own bootstrap-parent-mkdir path. The claim release
// and comment (independent of the local run dir) must still go through.
test('#3198: run dir removed after target resolves but before the decisions.md write — claim still releases, no files recreated at the old path', () => {
  const runDir = mkRun();
  const out = [];
  const { calls, d } = deps({ content: live(RUN_DIR_NAME), out, mainRoot: rootOf(runDir) });
  fs.rmSync(runDir, { recursive: true, force: true });
  const code = run(['999', '--run', runDir, '--reason', 'merged: spec 999'], d);
  assert.equal(code, 0, 'the claim release itself must still succeed');
  assert.deepEqual(calls.map(callKind), ['get', 'put', 'comment']);
  const env = envelope(out);
  assert.equal(env.outcome, 'released');
  assert.equal(env.logged, false, 'the local decisions.md write must be skipped, not recreate the run dir');
  assert.equal(fs.existsSync(runDir), false, 'nothing must be recreated at the old run-dir path');
  assert.match(stderrOf(out), /run dir no longer exists/);
});
```

Run `node --test tests/bin-lib/release-claim/cli.test.js` to confirm it fails on current code — today `target.ok` was computed while `runDir` still existed, so the later `appendEntry` call proceeds and (via `file-lock.js`'s `acquireLock` ENOENT branch) recreates `runDir` with a fresh `decisions.md`/lock dir.

- [ ] **Step 2: Implement the fix**

In `plugin/bin/release-claim.js`, replace the `if (target.ok) { ... }` block (the one building `entry` and calling `appendEntry`) with a fresh re-check immediately before the write:

```js
  let logged = false;
  if (target.ok) {
    // #3198: re-resolve immediately before writing — the `target` computed
    // above ran before release.releaseClaim's own GitHub round-trips,
    // which can take long enough for a concurrent archive-run pass to
    // remove runDir out from under that stale check. Without this, the
    // appendEntry call below would let its own lock's bootstrap-parent-mkdir
    // path (file-lock.js's acquireLock ENOENT branch) silently recreate
    // runDir instead of refusing, exactly like log-decision.js already does.
    let freshTarget;
    try { freshTarget = resolveTarget({ runDir, cwd: deps.cwd(), mainRoot: deps.mainRoot }); } catch { freshTarget = { ok: false, reason: 'missing' }; }
    if (!freshTarget.ok) {
      deps.stderr(`release-claim.js: decisions.md not written — run dir no longer exists (already archived or removed): ${runDir}\n`);
    } else {
      const nothingReleased = r.outcome === 'skipped-not-owner' || r.outcome === 'unreadable' || r.outcome === 'failed';
      const entry = formatEntry({
        status: 'AUTO', now: deps.now(), step: o.step || 'Section E', text: decisionText(issue, r, reason, o.link), reversibility: nothingReleased ? 'n/a' : 'high',
      });
      try { appendEntry({ runDir, section: o.section, entry }); logged = true; } catch (err) { deps.stderr(`release-claim.js: decisions.md not written (${err && err.message})\n`); }
    }
  }
```

- [ ] **Step 2 verification:** `node --test tests/bin-lib/release-claim/cli.test.js` passes in full (not just the new test — this file is 400+ lines covering many outcomes).

---

### Task 4: Full verification

- [ ] Run the complete suite: `npm test 2>&1 | tee /tmp/npm-test-3198.log` (or the scratchpad equivalent), confirm 0 failures.
- [ ] Revert Task 1/2/3's implementation changes only (keep the new tests) and re-run the three affected test files individually to confirm each new test goes red on the pre-fix code — then re-apply.
