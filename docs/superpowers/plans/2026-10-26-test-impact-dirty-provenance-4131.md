# Test-impact map dirty-tree provenance and trace signal cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A test-impact map records whether it was traced from a tree with tracked changes, verify.js refuses such a map by a stated rule, and an interrupted `trace` removes its temp dir.

**Architecture:** The map codec (`plugin/bin/lib/verify/impact.js`) gains an optional `dirty` boolean under the same `version: 1` — older parsers ignore unknown top-level keys, so the field is additive (expand-contract with no contract step: a version bump would make every older reader refuse every new map as `wrong-version`). `mapProblem` refuses a dirty map as `map-dirty` (fail closed, like `map-from-failing-suite`), and verify.js reports `mapDirty` in `scope.impact`. `tools/test-impact.js trace` moves from `spawnSync` to an async spawn so SIGINT/SIGTERM handlers can run while the suite is running. A signal is forwarded to the suite, and once the suite exits the temp dir is removed and no map is written.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-26T082048-record-4131/work/4131-spec.md` (record #4131)

## Global Constraints

- `IMPACT_MAP_VERSION` stays `1`.
- A map without `dirty` (every map written before this change) parses exactly as today, with `map.dirty === false`.
- `dirty` counts tracked changes only — the same `git --no-optional-locks status --porcelain --untracked-files=no` the clean-tree refusal already runs; untracked files never count.
- CI never passes `--allow-dirty` (`tests/test-impact-cli.test.js` already pins this for `.github/workflows/test-impact-map.yml`); the workflow is not edited.
- An interrupted trace never writes or replaces the `--out` map.
- Tracing stays POSIX-only (`impact-selection.md` Known limits); the signal end-to-end test skips on win32.

## Review Focus

- `dirty` present but not a boolean (`"true"`, `1`, `null`) → `map-invalid: bad-shape`, never read as clean. (Task 1)
- `--allow-dirty` on a tree that is actually clean → `dirty: false`: the field records the tree, not the flag. (Task 3)
- SIGTERM sent to the trace process alone (`timeout`, `kill <pid>`; the suite is not signalled) → forwarded to the suite, so the trace ends promptly instead of after the whole suite. (Task 2)
- An interrupt when a good map already exists at `--out` → that map is left byte-identical. (Task 2)
- A dirty map cached at the commit `fetch` chose → `fetch` replaces it rather than reporting "already current"; otherwise a `map-dirty` fallback could never self-heal through `impact.fetch`. (Task 3)

---

### Task 1: The `dirty` field in the codec, verify's `map-dirty` rule, and its report

**Files:**
- Modify: `plugin/bin/lib/verify/impact.js` (`encodeImpactMap`, `parseImpactMap`, `mapProblem`, `readMap`, `lazyImpactContext`)
- Modify: `plugin/bin/verify.js` (the `map-unlocatable` stub object near line 625; `impactReport` near line 1015)
- Modify: `plugin/skills/test/impact-selection.md` (The map; When the impact suite runs full; Report)
- Create: `tests/fixtures/test-impact/parse-impact-map-v1.js`
- Test: `tests/bin-lib/verify/impact.test.js`, `tests/bin-lib/verify/impact-cli.test.js`

**Interfaces:**
- Produces: `encodeImpactMap({ commit, tracedAt, exitCode, node, tests, dirty })` — `dirty` optional; when `dirty !== undefined` the output carries `dirty: Boolean(dirty)` placed after `node`, otherwise no `dirty` key (so the existing round-trip deep-equal at `impact.test.js:42` is unchanged).
- Produces: `parseImpactMap(text)` → `map.dirty: boolean` (`raw.dirty === true`); a present non-boolean `dirty` → `{ ok: false, reason: 'bad-shape' }`.
- Produces: `mapProblem` returns `'map-dirty'` for a parsed dirty map, checked right after `map-from-failing-suite` and before ancestry.
- Produces: `loadImpactContext(...)` / `lazyImpactContext(...)` expose `mapDirty` (`true`/`false` when the map parsed, else `null`); `report.json` `scope.impact.mapDirty` (`null` when the map was not read, as `mapCommit` is).

- [ ] **Step 1: Write the failing tests**

In `tests/fixtures/test-impact/parse-impact-map-v1.js`, freeze the pre-change reader: copy `parseImpactMap`, `decodeTests`, `isPlainObject`, `KINDS`, `SHA_RE` and `IMPACT_MAP_VERSION = 1` verbatim from `git show 3ad36593f:plugin/bin/lib/verify/impact.js`, with a header comment saying it is the v1 reader as shipped before #4131 and must never be edited; export `{ parseImpactMap }`.

In `tests/bin-lib/verify/impact.test.js` add:

```js
test('AC1.1: a dirty map parses with dirty: true; a clean or older map with dirty: false', () => {
  const tests = { 'tests/a.test.js': { f: ['src/x.js'] } };
  const enc = (extra) => encodeImpactMap({ commit: SHA, tracedAt: 't', exitCode: 0, node: 'v', tests, ...extra });
  assert.strictEqual(enc({ dirty: true }).dirty, true);
  assert.strictEqual(enc({ dirty: false }).dirty, false);
  assert.strictEqual(Object.hasOwn(enc({}), 'dirty'), false);
  assert.strictEqual(parseImpactMap(JSON.stringify(enc({ dirty: true }))).map.dirty, true);
  assert.strictEqual(parseImpactMap(JSON.stringify(enc({ dirty: false }))).map.dirty, false);
  assert.strictEqual(parseImpactMap(JSON.stringify(enc({}))).map.dirty, false);
  for (const dirty of ['true', 1, null, 0]) {
    assert.deepStrictEqual(parseImpactMap(JSON.stringify({ ...enc({}), dirty })), { ok: false, reason: 'bad-shape' }, String(dirty));
  }
});

test('AC1.2: the v1 reader shipped before the dirty field still parses dirty and clean maps', () => {
  const v1 = require(path.join(__dirname, '..', '..', 'fixtures', 'test-impact', 'parse-impact-map-v1.js'));
  for (const dirty of [true, false, undefined]) {
    const text = JSON.stringify(encodeImpactMap({ commit: SHA, tracedAt: 't', exitCode: 0, node: 'v', tests: { 'tests/a.test.js': { f: ['src/x.js'] } }, dirty }));
    const parsed = v1.parseImpactMap(text);
    assert.strictEqual(parsed.ok, true, `dirty ${dirty}: ${parsed.reason}`);
    assert.deepStrictEqual(parsed.map.tests['tests/a.test.js'].f, ['src/x.js']);
  }
});
```

Extend the existing `mapProblem` cases table with `[{ ...base, parsed: dirtyOk }, 'map-dirty']` (where `dirtyOk` parses an `encodeImpactMap({ …, dirty: true })`) and `[{ ...base, parsed: dirtyOk, isAncestor: false }, 'map-dirty']` (dirty wins over ancestry). Extend `loadImpactContext: missing, unreadable, …`: `run({ [MAP_PATH]: mapText({ dirty: true }) })` has `problem === 'map-dirty'` and `mapDirty === true`; the fresh-map test asserts `ctx.mapDirty === false`; `run({})` has `mapDirty === null`. Add a `lazyImpactContext` assertion that `mapDirty` is forwarded.

In `tests/bin-lib/verify/impact-cli.test.js` add:

```js
test('AC3.1: a map traced from a dirty tree runs full as map-dirty and reports mapDirty', async () => {
  const r = impactRepo();
  fs.writeFileSync(path.join(r.gitDir, DEFAULT_MAP_NAME), mapJson(r.base, { dirty: true }));
  commitFile(r, 'src/x.js', 'x2\n');
  const run = await runCli(ARGS, r.repo);
  assert.strictEqual(run.code, 0, run.stderr + run.stdout);
  assert.strictEqual(r.marker(), 'FULL');
  const imp = r.report().scope.impact;
  assert.strictEqual(imp.fallback, 'map-dirty');
  assert.strictEqual(imp.mapDirty, true);
  assert.strictEqual(imp.mapCommit, r.base);
  assert.match(run.stdout, /^Impact: full tests — map-dirty$/m);
});
```

and in `selects the subset (AC1.1 report shape)` add `assert.strictEqual(imp.mapDirty, false);`; in `missing map runs full and names it (AC5.1)` add `assert.strictEqual(imp.mapDirty, null);`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/verify/impact.test.js tests/bin-lib/verify/impact-cli.test.js`
Expected: FAIL — `dirty` absent from the encoded map, `map-dirty` never returned, `mapDirty` undefined.

- [ ] **Step 3: Implement the codec, rule and report**

`impact.js` per the Interfaces block. `readMap` adds `mapDirty: parsed && parsed.ok ? parsed.map.dirty : null` to its return; `lazyImpactContext` adds a `mapDirty` getter beside `mapCommit`. Update the module header comment with one sentence: an optional `dirty` boolean records a trace of a tree with tracked changes, and such a map is never used (`map-dirty`). In `verify.js`, add `mapDirty: null` to the `map-unlocatable` stub and `mapDirty: mapRead ? impactCtx.mapDirty : null` to `impactReport` after `mapAgeCommits`.

`impact-selection.md`:
- The map: shape becomes `{version: 1, commit, tracedAt, exitCode, node, dirty, paths, tests}`, followed by: "`dirty` is `true` when the traced tree held tracked changes (`trace --allow-dirty`; untracked files never count), so the map's `commit` is not what was traced. A map written before the field existed has no `dirty` key and reads as `false`; an older reader ignores the key, so the version stays 1. A `dirty` that is not a boolean is `bad-shape`."
- Fallback table, row after `map-from-failing-suite`: `` | `map-dirty` | The map was traced from a tree with tracked changes (`dirty: true`): its reads belong to no commit, so it is never used. `fetch` replaces a cached dirty map. | ``
- Report: add `mapDirty` after `mapAgeCommits` in the key list, and to the sentence naming the fields that are `null` when the map is not read.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/verify/impact.test.js tests/bin-lib/verify/impact-cli.test.js tests/bin-lib/verify/scope.test.js tests/verify-scope-declaration.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/verify/impact.js plugin/bin/verify.js plugin/skills/test/impact-selection.md tests/fixtures/test-impact/parse-impact-map-v1.js tests/bin-lib/verify/impact.test.js tests/bin-lib/verify/impact-cli.test.js
git commit -m "Record a test-impact map's dirty-tree provenance — verify refuses a dirty map as map-dirty (refs #4131)"
```

### Task 2: `trace` cleans up its temp dir on SIGINT and SIGTERM

**Files:**
- Modify: `tools/test-impact.js` (`defaultDeps`, `trace`, `run`, the CLI entry, header comment)
- Test: `tests/test-impact-cli.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `run({ argv, deps })` returns `Promise<number>` for every subcommand (an `async function`); the CLI entry becomes `run({ argv: process.argv.slice(2) }).then((code) => { process.exitCode = code; })`.
- Produces: `deps.spawn(cmd, args, opts)` returns a ChildProcess-like object: an EventEmitter with `kill(signal)` that emits `'exit'(code, signal)` and/or `'error'(err)`. Default: `child_process.spawn(cmd, args, { ...opts, stdio: 'inherit' })`.
- Produces: `deps.signals` — `{ on(sig, fn), removeListener(sig, fn) }`, default `process`.
- Produces: exit codes `130` (SIGINT) / `143` (SIGTERM) for an interrupted trace, which prints `test-impact.js trace: interrupted by {SIG} — no map written` on stderr.

- [ ] **Step 1: Write the failing tests**

Convert the existing suite to the async seam: every `run(...)` call is awaited inside an `async` test, and every trace fake `spawn` returns a fake child built by a new helper:

```js
// A fake child: runs `body(opts)` (which may write trace files), then emits 'exit' with `status`/`signal`
// on a later tick, unless `hold` is set — then it exits only when killed. Records kill() calls.
function fakeChild({ status = 0, signal = null, body = () => {}, hold = false } = {}) { /* … */ }
```

`withTempDir` stays synchronous for the `buildMap` tests; add `withTempDirAsync(fn)` (awaits `fn(dir)` before removing the dir) for every test that awaits `run`. Then add:

```js
test('AC2.1: SIGINT during the suite forwards to the suite, removes the trace dir and writes no map', async () => {
  await withTempDirAsync(async (dir) => {
    const out = path.join(dir, 'map.json');
    fs.writeFileSync(out, 'previous map\n');
    const signals = new EventEmitter();
    let child = null;
    let traceDir = null;
    const spawn = (cmd, args, opts) => {
      traceDir = opts.env.CT_TRACE_DIR;
      fs.writeFileSync(path.join(traceDir, '1-1-a.trace'), traceText([['T', 'tests/a.test.js'], ['f', 'lib/x.js']]));
      child = fakeChild({ hold: true });
      setImmediate(() => signals.emit('SIGINT', 'SIGINT'));
      return child;
    };
    const { deps, errs } = makeDeps({ git: fakeGit({ root: dir }), spawn, signals, cwd: dir });
    assert.strictEqual(await run({ argv: ['trace', '--out', out], deps }), 130);
    assert.deepStrictEqual(child.kills, ['SIGINT']);
    assert.strictEqual(fs.existsSync(traceDir), false);
    assert.strictEqual(fs.readFileSync(out, 'utf8'), 'previous map\n', 'an interrupt never replaces the map');
    assert.deepStrictEqual(errs, ['test-impact.js trace: interrupted by SIGINT — no map written']);
    assert.strictEqual(signals.listenerCount('SIGINT') + signals.listenerCount('SIGTERM'), 0, 'handlers are removed');
  });
});
```

Also add: the same shape for `SIGTERM` → `143` and `child.kills` `['SIGTERM']`; a second signal while the suite still holds → `child.kills` `['SIGINT', 'SIGKILL']`; a normal run (`fakeChild({ status: 0, body })`) leaves `listenerCount` 0 for both signals. Change the spawn-error path's fake to `fakeChild` emitting `'error'` and assert it still reports `the suite did not start` and removes the trace dir.

End-to-end (skip on win32, `'signals and tracing are POSIX-only'`), named `AC2.1: SIGINT to a running real trace leaves no ct-test-impact-trace-* dir`: build a git fixture under `withTempDirAsync` like `traceFixture` but whose committed `tools/run-tests.js` is `require('fs').writeFileSync(process.env.CT_E2E_READY, ''); setInterval(() => {}, 1000);` (keep the copied real `tools/test-impact/tracer.js`, which `NODE_OPTIONS` requires). Spawn the CLI with `child_process.spawn(process.execPath, [CLI, 'trace', '--out', out], { cwd: root, env: { ...env, CT_E2E_READY: ready } })`, where `env` sets `TMPDIR` to `{tmp}/tmp`. Poll every 50 ms, for up to 30 s, until `ready` exists. Then assert `{tmp}/tmp` holds an entry starting `ct-test-impact-trace-`, proving the probe can see a leak. Send `cli.kill('SIGINT')` to the CLI process alone, await its `'exit'`, and assert the code is `130`, that no `ct-test-impact-trace-*` entry remains in `{tmp}/tmp`, and that `out` does not exist.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/test-impact-cli.test.js`
Expected: FAIL after Step 1 — the sync `trace` reads a fake child as a spawnSync result (no `status` → exit 1 path), so the interrupt tests never see 130 and the end-to-end CLI dies on SIGINT leaving its temp dir.

- [ ] **Step 3: Implement async `trace` with signal handling**

In `trace` (now `async`): install one handler per `SIGINT`/`SIGTERM` on `deps.signals` immediately before `deps.spawn`. On the first signal, record it and `child.kill(sig)`; on any later one, `child.kill('SIGKILL')`. Await a `waitForExit(child)` helper resolving once with `{ status, signal, error }` on the first of `'exit'` / `'error'`. Then `await new Promise((r) => setImmediate(r))` so a signal delivered alongside the suite's own exit runs its handler before the check. If interrupted: print the interrupted line and return `128 + os.constants.signals[sig]`, skipping `buildMap` and the write. `finally` removes both handlers, then removes the trace dir (existing `rmQuiet`). `fetch` only becomes `async` by `run` being async; its body is unchanged. Header comment: the Seam paragraph names `spawn` (→ child, async), `signals`, and `run` returning a Promise; the Exit codes paragraph adds `130/143 trace interrupted by SIGINT/SIGTERM (the suite is sent the signal, the temp dir removed, no map written)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/test-impact-cli.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/test-impact.js tests/test-impact-cli.test.js
git commit -m "Remove an interrupted test-impact trace's temp dir — forward SIGINT/SIGTERM to the suite (refs #4131)"
```

### Task 3: `trace` writes `dirty`; `fetch` never keeps or takes a dirty map

**Files:**
- Modify: `tools/test-impact.js` (`trace`, `fetch`, header comment)
- Modify: `tools/test-impact/build-map.js` (`buildMap` passes `dirty` through)
- Test: `tests/test-impact-cli.test.js`

**Interfaces:**
- Consumes: Task 1's `encodeImpactMap({ …, dirty })` and `parseImpactMap(text).map.dirty`; Task 2's async `run` and `fakeChild`.
- Produces: `buildMap({ traceDir, commit, exitCode, node, dirty, now, fsImpl })` — forwards `dirty` to `encodeImpactMap` unchanged (absent → no key).

- [ ] **Step 1: Write the failing tests**

In `tests/test-impact-cli.test.js`:
- `AC1.1: trace --allow-dirty on a dirty tree writes dirty: true and warns`. Use `fakeGit({ root, status: ' M lib/x.js\n' })` and `--allow-dirty`; the written map parses with `map.dirty === true`. stderr holds exactly `test-impact.js trace: traced a dirty tree (tracked changes) — the map records dirty: true, which verify.js refuses as map-dirty`. The stdout `trace: …` line is unchanged. Fold this into the existing `trace runs the suite under the tracer env…` test, which already uses that status.
- `trace on a clean tree writes dirty: false, with or without --allow-dirty`. Status `''`, run both arg forms: `map.dirty === false`, raw JSON has `"dirty":false`, `errs` empty.
- `fetch replaces a cached dirty map at the chosen commit`. The cached `out` holds `mapText(SHA_A)` encoded with `dirty: true` and the download is a clean `mapText(SHA_A)`. Exit 0, one download call, and `out` now equals the clean text.
- `fetch exits 1 on a downloaded map traced from a dirty tree, leaving the cache alone`. stderr matches `/traced from a dirty tree/`.
- In the end-to-end `trace under a path with a space…` test, add `assert.strictEqual(parsed.map.dirty, false)` (the fixture is committed clean; `--allow-dirty` does not make it dirty).

Give `mapText` an optional third `dirty` parameter passed to `encodeImpactMap`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/test-impact-cli.test.js`
Expected: FAIL — `map.dirty` is `false` for the `--allow-dirty` dirty case; the cached dirty map counts as current.

- [ ] **Step 3: Implement**

`trace` always runs the status call. `dirty = status.trim() !== ''`, and the exit-2 refusal fires only when `dirty && !allowDirty`. Pass `dirty` to `buildMap`, and print the warning line after the map is written, only when `dirty`. In `fetch`, the "already current" branch also requires `!cached.map.dirty`. After the exitCode check, refuse an artifact whose `map.map.dirty` is set, printing `test-impact.js fetch: run {id}'s map was traced from a dirty tree` and returning 1. Header comment: the `trace` paragraph says the map records `dirty: true` when `--allow-dirty` traced tracked changes. The `fetch` paragraph says a dirty cached map is replaced and a dirty artifact refused. In `build-map.js`, update the header's "encoded by" sentence to say `dirty` is passed through.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/test-impact-cli.test.js tests/bin-lib/verify/impact.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/test-impact.js tools/test-impact/build-map.js tests/test-impact-cli.test.js
git commit -m "Write a test-impact map's dirty flag from trace — fetch replaces a dirty cached map (refs #4131)"
```

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 — optional `dirty` written by `trace`, absent in older maps | 1 (codec), 3 (trace writes it) |
| Deliverable 1 — `verify.js` reports it in `scope.impact` | 1 |
| Deliverable 1 — explicit treatment rule in `impact-selection.md` | 1 (`map-dirty`) |
| Deliverable 2 — remove the temp dir on SIGINT and SIGTERM | 2 |
| AC1.1 dirty true / clean false-or-absent | 1, 3 |
| AC1.2 older reader parses both | 1 (frozen v1 reader fixture) |
| AC2.1 SIGINT test, no temp dir left | 2 (unit + end-to-end) |
| AC3.1 `impact-selection.md` states the treatment | 1 (prose, plus the `map-dirty` e2e that proves the stated rule) |

Premise-refs: plugin/bin/lib/verify/impact.js
Premise-refs: tools/test-impact.js
Premise-refs: tools/run-tests.js
