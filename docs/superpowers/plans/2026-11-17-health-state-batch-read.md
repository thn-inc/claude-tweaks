# Health-State Batch Read Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the git processes `plugin/bin/lib/health-core/durable-state.js` starts per read: no read at all when `origin/health-state` does not resolve, and one `git cat-file --batch` per read round instead of one `git show` per state file.

**Architecture:** `createNamespacedState`'s `readFilesAt(root, ref)` already resolves every spec to its default for a falsy `ref` with no git call. Task 1 makes `writeState` read at the commit sha `currentRefShas` resolved (null when the ref is missing) instead of at the ref name. Task 2 replaces the per-file `showFileAt` with one `cat-file --batch` read parsed by byte length, and teaches the three unit-test fake runners to answer it from their existing per-file `show` rules.

**Tech Stack:** Node 18+ (CI runs Node 20), `node:test`, git plumbing via the module's injectable `run(cmd, args, opts)`.

**Spec:** `.claude-tweaks/pipelines/2026-11-17T181851-spec-5872/work/5872-spec.md` (record #5872)

Scope keywords: showFileAt, readFilesAtFetchedTip, readFilesAt

## Global Constraints

- Keep every existing test and assertion: no test removed, skipped, or loosened (AC1). A test whose title says "via git show" may be retitled to name the batched read; its body and assertions stay.
- Tolerant-fetch semantics, the `health-state: fetch failed, treating as empty state: ${message}` stderr line, and the missing-ref silence are unchanged (AC2). Do not touch `readStateWithMeta`'s fetch/catch or `readState`'s stderr branch.
- `DEFAULT_RUN_TIMEOUT_MS` (30000) still applies to every git call, the batch read included (AC3): the batch call passes no `timeout` of its own, so `defaultRun`'s and the makeExec branch's default stays in force.
- Fetch count per invocation stays as is: each fetch (readState's, each CAS attempt's, the post-push ambiguity re-check's) guards a read against a remote that can move in between.
- Governing skill `gh-api-module-pattern` (`.claude/skills/gh-api-module-pattern/SKILL.md`), quoted:
  - "**A test fixture's real-subprocess runner forwards the caller's options object.** Spread `opts` and override only what the fixture owns (`cwd`, `stdio`) instead of rebuilding a narrowed options object. `tests/bin-lib/issues/claims-git-cas.test.js`'s `realRunner` hardcodes `encoding: 'utf8'`, dropping the `encoding: 'buffer'` that `plugin/bin/lib/issues/claims-git-cas.js`'s `readClaimBlobsGitB…`" (the batch read depends on `encoding: 'buffer'` reaching the spawn).
  - "**The real runner's spawn options (`timeout`, `windowsHide`, quiet `stdio`, `maxBuffer`) need a test of their own, because a fake runner never sees them.**"
  - "**A seam that pipes a child whose output the module does not control sets `maxBuffer: LARGE_MAX_BUFFER_BYTES`** … `execFileSync` buffers piped output up to a 1 MiB default. Past it the child is killed and the throw carries `{code: 'ENOBUFS', signal: 'SIGTERM'}`" — one batch read concatenates every state file (queue-order's `order.json` alone is read elsewhere with a 64 MiB buffer), so the batch call passes `maxBuffer: LARGE_MAX_BUFFER_BYTES` from `plugin/bin/lib/shared-primitives.js`.
- Other `.claude/skills/` naming this module: none name `durable-state.js`; `windows-checkout-test-parity` does not apply (blob bytes come back raw from `cat-file`, no CRLF conversion, no path separators in the read).
- Parser: module-private in `durable-state.js`, position-based like `plugin/bin/load-delta.js`'s `parseBatchOutput` (the input is `{ref}:{path}`, which git echoes back on a `missing` line), but tolerant: a `missing`/`ambiguous`/any non-content header, a non-`blob` object, or a truncated stream degrades that slot (and the rest, when truncated) to the spec's default — never throws. Accepts a Buffer or a string (fake runners return strings).

## Review Focus

- A state file whose JSON contains multi-byte UTF-8 and embedded newlines must round-trip exactly (byte-length framing, not line splitting) — Task 2's real-repo test.
- A batch response that is a non-blob object (a tree at that path) followed by a blob must still read the blob — Task 2's crafted-buffer test.
- A truncated batch stream (process killed mid-output) must degrade the unread slots to defaults, not throw — Task 2's crafted-buffer test.
- A caller-supplied `run` that ignores `encoding` and returns a string must still parse — Task 2's string-response test.
- Concurrent writer moves `origin/health-state` between `rev-parse` and the read: the mutator must see the commit it builds on — Task 1 reads at the resolved sha.

---

### Task 1: writeState reads at the resolved commit, skipping the read when the ref does not resolve

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/health-core/durable-state.js` (`writeState`, ~line 397-398; the `readFilesAtFetchedTip` comment ~lines 223-231)
- Test: `tests/bin-lib/health-core/durable-state.test.js`

**Interfaces:**
- Consumes: `currentRefShas(root) -> { commitSha: string|null, treeSha: string|null }`, `readFilesAt(root, ref) -> values` (existing).
- Produces: `writeState` reads `readFilesAt(root, parentSha)`; `readFilesAtFetchedTip` stays for `readStateWithMeta` only.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/health-core/durable-state.test.js`, next to the other writeState tests. The read-call predicate is implementation-agnostic so it holds before and after Task 2:

```js
const isStateRead = (c) => c.cmd === 'git' && (c.args.includes('show') || c.args.includes('cat-file'));

test('AC4.1: writeState against an unresolvable origin/health-state starts no state-file read and hands the mutator the defaults', () => {
  const { run, calls } = fakeRunner([
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), throws: "couldn't find remote ref health-state" },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'rev-parse'), throws: 'unknown revision or path not in the working tree' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'show'), returns: JSON.stringify({ stale: true }) },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'cat-file'), returns: 'x blob 2\n{}\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'hash-object'), returns: 'blob-sha\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'mktree'), returns: 'tree-sha-1\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'commit-tree'), returns: 'commit-sha-1\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'push'), returns: '' },
  ]);
  let seen = null;
  const ds = createDurableState('code-health', { run, sleep: () => {}, includeRemembered: true });
  assert.deepStrictEqual(ds.writeState('/repo', (current) => { seen = current; return current; }), { ok: true });
  assert.deepStrictEqual(seen, { cursors: {}, retryQueue: [], runs: [], remembered: {} });
  assert.strictEqual(calls.filter(isStateRead).length, 0, 'no show/cat-file may run when the ref does not resolve');
});

test('writeState reads the state files at the commit sha rev-parse resolved, the same commit it parents the new one on', () => {
  const { run, calls } = fakeRunner([...baseWriteStateRules(), pushRule({ returns: '' })]);
  const ds = createDurableState('code-health', { run, sleep: () => {} });
  assert.deepStrictEqual(ds.writeState('/repo', (current) => current), { ok: true });
  const reads = calls.filter(isStateRead);
  assert.ok(reads.length > 0);
  const readText = reads.map((c) => `${c.args.join(' ')} ${c.opts && c.opts.input ? c.opts.input : ''}`).join('\n');
  assert.match(readText, /commit-sha-1:code-health\/cursors\.json/);
  assert.doesNotMatch(readText, /origin\/health-state:/);
});
```

(`baseWriteStateRules()`'s combined rev-parse returns `commit-sha-1\ntree-sha-1\n`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tools/run-tests.js tests/bin-lib/health-core/durable-state.test.js`
Expected: FAIL — the AC4.1 test counts read calls `> 0` (the current code runs `show` at `origin/health-state` after `rev-parse` fails), and the second test sees `origin/health-state:` in the read argv.

- [ ] **Step 3: Implement** in `writeState`: `const current = readFilesAt(root, parentSha);` in place of `readFilesAtFetchedTip(root)`. Update the comment above `readFilesAtFetchedTip` so it no longer claims writeState's CAS loop uses it: writeState reads at the sha it resolved (no git call when it is null), which also keeps the mutator's input and the commit's parent on one commit; the never-refetch-inside-the-loop rationale stays.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tools/run-tests.js tests/bin-lib/health-core/durable-state.test.js tests/bin-lib/dispatch/queue-order.test.js tests/bin-lib/issues/merge-lane-breaker.test.js`
Expected: PASS, every test (44 + 2 new in durable-state, 28 queue-order, 22 merge-lane-breaker).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/health-core/durable-state.js tests/bin-lib/health-core/durable-state.test.js
git commit -m "Read health-state at the resolved commit in writeState — no read when the ref does not resolve (refs #5872)"
```

---

### Task 2: One `git cat-file --batch` per read round

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/health-core/durable-state.js` (`showFileAt` ~lines 173-183 removed, `readFilesAt` ~lines 240-246, new module-private parser, `require('../shared-primitives')` for `LARGE_MAX_BUFFER_BYTES`)
- Create: `tests/helpers/fake-cat-file-batch.js`
- Modify: `tests/bin-lib/health-core/durable-state.test.js` (fakeRunner ~line 108; new tests)
- Modify: `tests/bin-lib/dispatch/queue-order.test.js` (fakeRunner ~line 13)
- Modify: `tests/bin-lib/issues/merge-lane-breaker.test.js` (fakeRunner ~line 17)

**Interfaces:**
- Consumes: Task 1's `writeState` → `readFilesAt(root, parentSha)`.
- Produces:
  - `readFilesAt(root, ref)`: falsy `ref` or no specs → defaults, no git call (unchanged); otherwise exactly one call `run('git', ['-C', root, 'cat-file', '--batch'], { input, encoding: 'buffer', maxBuffer: LARGE_MAX_BUFFER_BYTES })` with `input` = one `${ref}:${statePath(namespace, spec.file)}\n` line per spec, in spec order. A thrown call → every spec its default. Each slot: blob text → `JSON.parse`, a parse failure or empty slot → that spec's default.
  - module-private `parseBatchBlobs(out, count) -> Array<string|null>` (Buffer or string in; `count` entries out; never throws).
  - `tests/helpers/fake-cat-file-batch.js` exports `answerCatFileBatch(args, opts, showOne) -> Buffer`: for each non-empty line `obj` of `opts.input`, `showOne(['-C', root, 'show', obj])` (root = the arg after `-C`); a throw, `undefined` or `null` → `${obj} missing\n`; a value → `${'0'.repeat(40)} blob ${Buffer.byteLength(String(value))}\n${value}\n`. Also exports `isCatFileBatch(cmd, args) -> boolean` (`cmd === 'git' && args.includes('cat-file') && args.includes('--batch')`).

- [ ] **Step 1: Write the helper and wire it into the three fakeRunners.** Each fakeRunner keeps its rule loop first; only when no rule matched and `isCatFileBatch(cmd, args)` is true does it return `answerCatFileBatch(args, opts, (showArgs) => <the same rule loop run on showArgs>)`, where a rule `throws` value throws as today. `durable-state.test.js`'s fakeRunner records the real `cat-file` call in `calls` once and never the synthetic `show` dispatches. `queue-order.test.js` and `merge-lane-breaker.test.js` fakeRunners take `(cmd, args, opts)`. No rule, title-free assertion, or rule list changes in these files.

- [ ] **Step 2: Write the failing tests** in `tests/bin-lib/health-core/durable-state.test.js`:

```js
const { LARGE_MAX_BUFFER_BYTES } = require('../../../plugin/bin/lib/shared-primitives');

test('AC5.1: a read round at a resolving ref starts exactly one git process for every file spec, a cat-file --batch fed one ref:path line per spec', () => {
  const { run, calls } = fakeRunner([
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), returns: '' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'show') && matchArgs(args, 'cursors.json'), returns: JSON.stringify({ '.': { lastSweptMs: 7 } }) },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'show'), throws: 'fatal: path does not exist' },
  ]);
  const ds = createDurableState('code-health', { run, sleep: () => {}, includeRemembered: true, includeDeclined: true });
  const state = ds.readState('/repo');
  assert.deepStrictEqual(state, { cursors: { '.': { lastSweptMs: 7 } }, retryQueue: [], runs: [], remembered: {}, declined: {} });
  const reads = calls.filter((c) => c.cmd === 'git' && !c.args.includes('fetch'));
  assert.strictEqual(reads.length, 1);
  assert.deepStrictEqual(reads[0].args, ['-C', '/repo', 'cat-file', '--batch']);
  assert.strictEqual(reads[0].opts.input, ['cursors.json', 'retry-queue.json', 'runs.json', 'remembered.json', 'declined.json']
    .map((f) => `origin/health-state:code-health/${f}\n`).join(''));
  assert.strictEqual(reads[0].opts.encoding, 'buffer');
  assert.strictEqual(reads[0].opts.maxBuffer, LARGE_MAX_BUFFER_BYTES);
});
```

Plus, each with a fake whose `cat-file` rule returns the crafted value (rule-first, so the helper is bypassed):
- `'a non-blob slot degrades to its default and the following blob still reads (byte-length framing skips the tree body)'` — response `Buffer.concat([Buffer.from('t'.repeat(40) + ' tree 5\nabcde\n'), Buffer.from('b'.repeat(40) + ' blob 9\n{"k":"v"}\n')])` for a two-spec namespace `[{key:'a',file:'a.json',default:{d:1}},{key:'b',file:'b.json',default:{}}]` → `{ a: { d: 1 }, b: { k: 'v' } }`.
- `'a truncated batch stream degrades the unread slots to defaults and never throws'` — response `'b'.repeat(40) + ' blob 9\n{"k":"v"}\n'` (string) for a three-spec namespace → first slot `{k:'v'}`, second and third their defaults.
- `'missing and ambiguous headers degrade only their own slot'` — response `'origin/health-state:ns/a.json missing\norigin/health-state:ns/b.json ambiguous\n' + 'c'.repeat(40) + ' blob 2\n[]\n'` → `{ a: {…default}, b: {…default}, c: [] }`.
- `'a failed batch process degrades every spec to its default'` — `cat-file` rule `throws: 'fatal: not a git repository'` → every default, `readState` writes nothing to stderr (`withCapturedStderr`).
- `'AC3.1: the default runner gives the batch read the 30 s timeout, windowsHide, a 64 MiB maxBuffer and a Buffer result'` — temporarily replace `require('child_process').execFileSync` with a recorder (returns `''` for fetch, `Buffer.from('')` for cat-file), `delete require.cache[require.resolve(<durable-state path>)]`, re-require, call `createNamespacedState('ns', [{ key: 'a', file: 'a.json', default: {} }]).readState('/repo')`, restore both in `finally` (and re-delete the cache entry); assert the cat-file call's options include `timeout: 30000`, `windowsHide: true`, `encoding: 'buffer'`, `maxBuffer: LARGE_MAX_BUFFER_BYTES`, and `input: 'origin/health-state:ns/a.json\n'`.
- `'a real repo round-trips multi-byte, multi-line JSON, an invalid-JSON file and a missing file through the batch read'` — real bare origin + clone, built like the `café.json` test (~line 683): one writer namespace `ns` with specs `[{key:'a',file:'a.json',default:{}},{key:'bad',file:'bad.json',default:{},serialize:()=>'{nope'}]` writes `{ a: { note: 'café ☕\nline two', n: [1, 2] } }`; a reader `createNamespacedState('ns', [{key:'a',file:'a.json',default:{}},{key:'bad',file:'bad.json',default:{fallback:true}},{key:'gone',file:'gone.json',default:[]}], { sleep })` → `readState(clone)` deep-equals `{ a: { note: 'café ☕\nline two', n: [1, 2] }, bad: { fallback: true }, gone: [] }`.

Retitle `'readState parses each file via git show, defaulting missing files to {}/[]'` → `'readState parses each file via the batched read, defaulting missing files to {}/[]'` and `'readState parses declined.json via git show for a skill that opts in, defaulting to {} when missing'` → `'readState parses declined.json via the batched read for a skill that opts in, defaulting to {} when missing'`; bodies unchanged.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node tools/run-tests.js tests/bin-lib/health-core/durable-state.test.js`
Expected: FAIL — AC5.1 sees five `show` calls, not one `cat-file`; the crafted-buffer and AC3.1 tests see no `cat-file` call.

- [ ] **Step 4: Implement** `readFilesAt` and `parseBatchBlobs` per the Interfaces block; delete `showFileAt` (its only caller is `readFilesAt`) and move its "works for a branch ref or a bare sha" note onto `readFilesAt`. Parser header regex: `/^[0-9a-f]+ (\S+) (\d+)$/`; any other header is a body-less slot.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node tools/run-tests.js tests/bin-lib/health-core/durable-state.test.js tests/bin-lib/dispatch/queue-order.test.js tests/bin-lib/issues/merge-lane-breaker.test.js tests/bin-lib/code-health/cli-validate-findings.test.js tests/bin-lib/docs-health/cli-validate-findings.test.js tests/bin-lib/journey-health/cli-validate-findings.test.js tests/bin-lib/harness-health/cli-validate-findings.test.js tests/bin-lib/code-health/durable-integration.test.js tests/bin-lib/docs-health/durable-integration.test.js tests/bin-lib/harness-health/durable-integration.test.js tests/bin-lib/journey-health/durable-integration.test.js tests/windows-hide-spawn-conformance.test.js tests/git-path-read-conformance.test.js`
Expected: PASS, every file; quote the runner's `ℹ tests` / `ℹ pass` / `ℹ fail` lines.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/health-core/durable-state.js tests/helpers/fake-cat-file-batch.js tests/bin-lib/health-core/durable-state.test.js tests/bin-lib/dispatch/queue-order.test.js tests/bin-lib/issues/merge-lane-breaker.test.js
git commit -m "Read every health-state file in one git cat-file --batch (refs #5872)"
```

---

## Controller evidence (not dispatched)

Run by the controller after Task 2, results logged per the AC-evidence persistence rule (`decisions.md` `AC evidence` entry + `$PIPELINE_RUN_DIR/evidence/*.txt`):

- AC6.1: `node {scratchpad}/count-git.js {worktree} AFTER {out.json} <the eleven files measured at base>` — the same script and file list as the base run (`base-counts.txt`, code-health VF 670 / docs-health VF 463 / journey-health VF 380 / harness-health VF 324 git processes). Before/after table goes in the PR body.
- Real-input probe: read the live `origin/health-state` in this repo with the new reader (`createDurableState(ns, { includeRemembered: true, includeDeclined: true }).readState(worktree)` for each namespace present on the branch) and compare each value with an independent `git show origin/health-state:{ns}/{file}` + `JSON.parse` per file; every value must deep-equal.
- AC1.1/AC1.2: compare the test titles in the touched test files at base and HEAD (`node --test --test-reporter=spec` name lists, or a title grep), every base title present at HEAD (modulo the two retitles), and the full suite green.

Waived AC1.1: no test step can prove a negative about other tests — the controller's base-vs-HEAD title comparison and full-suite run above carry it.
Waived AC1.2: same controller title comparison above, plus review of the test-file diffs (only fakeRunner fallbacks, two retitles and new tests).
Waived AC6.1: a measurement, not a test — the controller's AC6.1 count run above, logged as AC evidence and tabled in the PR body.
Waived AC2.1: covered by the existing tests at ~lines 200-218 and 267-300 (unchanged), which stay green.
Waived AC7.1: covered by queue-order and merge-lane-breaker suites passing with no assertion changed (Task 2 Step 1 changes only their fakeRunner fallback).
