# Verify-Expectations Sanctioned Writer (#2764) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a fourth sanctioned run-dir writer CLI, `plugin/bin/set-verify-expectations.js`, so a worktree-isolated wrap-up session can write or update `verify-expectations.json` in the anchored run directory.

**Architecture:** A small library (`plugin/bin/lib/verify-expectations/write.js`) owns validation, the read-modify-write merge, and the locked atomic write. A thin CLI wraps it on the same `run(argv, deps)` seam, sanctioned-writer exit vocabulary (0/2/3, no 1), and `resolveTarget` anchoring guard as `log-decision.js`, `stage-item.js`, `set-config.js`. `wrap-up-engine.js finish-console` routes its existing step-1 write through the same library so there is one read-modify-write implementation. Skill prose that instructed a direct write is repointed at the CLI.

**Tech Stack:** Node 18+, `node --test`, no external deps.

**Spec:** `.claude-tweaks/pipelines/2026-10-04T124944-record-2764/work/2764-spec.md`

## Global Constraints

- Payload source is `plugin/` in this worktree, never the installed plugin cache.
- Exit codes: 0 written (path echoed on stdout), 2 malformed invocation, 3 run dir missing / not anchored under the main checkout / file unwritable. No exit 1.
- Anchoring goes through `plugin/bin/lib/stage-item/write.js`'s exported `resolveTarget` — never a re-derived predicate.
- `require.main === module` guard sets `process.exitCode = run(...)`; never `process.exit`.
- Both real file locations are supported by one `--run <dir>` argument: a single-spec run's `{run-dir}/verify-expectations.json` and a multi-spec run's `{parent-run-dir}/spec-{n}/verify-expectations.json` (`$PIPELINE_RUN_DIR` is the per-spec subdirectory there). The reader, `engine-verify.js`'s `readExpectations(runDir)`, joins the filename onto whichever directory it is handed.
- `engine-verify.js`'s `unknown (expectations file missing)` rendering is kept unchanged as the defensive path for a write step that never ran.
- Commit messages: `{Verb} {what} — {detail}`, `refs #2764` (never `closes`/`fixes`), ending with the line `Claude-Session: https://claude.ai/code/session_015ZX5aJf9QxottoX6taiskk`.
- Never run `git stash`. One plain command per Bash call; no `&&` chains, loops, or heredocs.
- Run long commands in the foreground; never `run_in_background`.
- Established-maturity rule: for any task modifying pre-existing behavior, a characterization test must cover it before the change (Task 1's `finish-console` edit is covered by the existing `tests/bin-lib/wrap-up/finish-console-cli.test.js`; run it before and after).
- Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same.

## Review Focus

- An existing file holding unparseable JSON, `null`, or an array: the writer starts from `{}` rather than throwing or spreading array indices (Task 1 lib test).
- A `--file` payload naming a key also given by a flag, or a key outside the five allowed: exit 2, nothing written (Task 1 CLI test).
- A dangling list flag (`--deferred` with no value) or an empty list entry (`a,,b`): exit 2 (Task 1 CLI test).
- A repeated `--oversight-exempt` for the same record: the array stays deduplicated and numerically sorted (Task 1 lib test).
- A worktree-local shadow run dir with a pre-existing file: exit 3 and the shadow file is byte-unchanged (Task 1 CLI test).

---

### Task 1: Library, CLI, and finish-console routing

**Files:**
- Create: `plugin/bin/lib/verify-expectations/write.js`
- Create: `plugin/bin/set-verify-expectations.js`
- Modify: `plugin/bin/wrap-up-engine.js` (the `runFinishConsole` step-1 block and the require list)
- Test: `tests/bin-lib/verify-expectations/write.test.js`
- Test: `tests/bin-lib/verify-expectations/cli.test.js`

**Interfaces:**
- Consumes: `resolveTarget({ runDir, cwd, mainRoot })` from `plugin/bin/lib/stage-item/write.js` → `{ ok: true, dir }` or `{ ok: false, reason: 'missing' | 'not-anchored' }`; `writeFileAtomic(filePath, content)` from `plugin/bin/lib/atomic-write.js`; `withLock(lockPath, fn)` from `plugin/bin/lib/file-lock.js`.
- Produces: `FILE_NAME`, `FIELD_KEYS`, `validateFields(fields) -> string | null`, `mergeExpectations(existing, fields) -> object`, `writeExpectations({ runDir, fields }) -> { file, data }` from the library; `run(argv, deps) -> 0 | 2 | 3` and `parseArgs` from the CLI.

- [ ] **Step 1: Write the failing tests**

`tests/bin-lib/verify-expectations/write.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  FILE_NAME, validateFields, mergeExpectations, writeExpectations,
} = require('../../../plugin/bin/lib/verify-expectations/write');

function tmpRunDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vexp-write-'));
}

test('mergeExpectations: an empty existing object gets the version-1 defaults', () => {
  assert.deepEqual(mergeExpectations({}, {}), { version: 1, memory: [], upstream: [] });
});

test('mergeExpectations: provided memory/upstream/deferred/issues replace, unowned fields survive', () => {
  const existing = { version: 1, memory: [{ file: 'a.md', indexFile: 'M.md' }], upstream: [], custom: 'kept', deferred: ['worktree'] };
  const out = mergeExpectations(existing, { upstream: [{ url: 'https://github.com/o/r/issues/1' }], deferred: ['design-caches', 'design-caches'], issues: [7] });
  assert.deepEqual(out.memory, [{ file: 'a.md', indexFile: 'M.md' }], 'memory not provided, so preserved');
  assert.deepEqual(out.upstream, [{ url: 'https://github.com/o/r/issues/1' }]);
  assert.deepEqual(out.deferred, ['design-caches'], 'replaced and deduplicated');
  assert.deepEqual(out.issues, [7]);
  assert.equal(out.custom, 'kept');
});

test('mergeExpectations: oversightExempt unions with the existing array, deduplicated and numerically sorted', () => {
  const out = mergeExpectations({ version: 1, memory: [], upstream: [], oversightExempt: [30, 4] }, { oversightExempt: [4, 12] });
  assert.deepEqual(out.oversightExempt, [4, 12, 30]);
});

test('validateFields: accepts the five allowed keys and rejects everything else with a named reason', () => {
  assert.equal(validateFields({}), null);
  assert.equal(validateFields({ memory: [{ file: 'a.md', indexFile: 'M.md' }], upstream: [{ url: 'u' }], deferred: ['run-dir-archival'], issues: [1], oversightExempt: [2] }), null);
  assert.match(validateFields({ version: [1] }), /unknown field "version"/);
  assert.match(validateFields({ memory: 'x' }), /"memory" must be an array/);
  assert.match(validateFields({ memory: [{ file: 'a.md' }] }), /memory\[0\] must be \{file, indexFile\}/);
  assert.match(validateFields({ upstream: [{}] }), /upstream\[0\] must be \{url\}/);
  assert.match(validateFields({ deferred: ['Bad Token'] }), /deferred\[0\]/);
  assert.match(validateFields({ issues: [0] }), /issues\[0\] must be a positive integer/);
  assert.match(validateFields({ oversightExempt: [1.5] }), /oversightExempt\[0\] must be a positive integer/);
  assert.match(validateFields([]), /must be an object/);
});

test('writeExpectations: creates the file when absent and returns its path and data', () => {
  const runDir = tmpRunDir();
  const { file, data } = writeExpectations({ runDir, fields: {} });
  assert.equal(file, path.join(runDir, FILE_NAME));
  assert.deepEqual(data, { version: 1, memory: [], upstream: [] });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), data);
  assert.deepEqual(fs.readdirSync(runDir), [FILE_NAME], 'no lock dir or tmp file is left behind');
});

test('writeExpectations: unparseable, null, or array content in the existing file is treated as empty, never thrown on', () => {
  for (const garbage of ['not json', 'null', '[1,2]']) {
    const runDir = tmpRunDir();
    fs.writeFileSync(path.join(runDir, FILE_NAME), garbage);
    const { data } = writeExpectations({ runDir, fields: { issues: [9] } });
    assert.deepEqual(data, { version: 1, memory: [], upstream: [], issues: [9] }, `content: ${garbage}`);
  }
});

test('writeExpectations: a second write preserves what the first recorded', () => {
  const runDir = tmpRunDir();
  writeExpectations({ runDir, fields: { oversightExempt: [5] } });
  writeExpectations({ runDir, fields: { oversightExempt: [5] } });
  const { data } = writeExpectations({ runDir, fields: { memory: [{ file: 'a.md', indexFile: 'M.md' }] } });
  assert.deepEqual(data.oversightExempt, [5]);
  assert.deepEqual(data.memory, [{ file: 'a.md', indexFile: 'M.md' }]);
});
```

`tests/bin-lib/verify-expectations/cli.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../../../plugin/bin/set-verify-expectations');
const { runVerify } = require('../../../plugin/bin/lib/wrap-up/engine-verify');

const RUN_ID = '2026-09-21T213441-spec-2697-2757-2758-2759';
const DEFERRED = 'design-caches,worktree,ephemeral-server,claim-release,run-dir-archival';

// Same anchoring fixture shape as tests/bin-lib/set-config/cli.test.js: a
// fake main checkout (.git directory) holding the real run dirs, plus a
// linked worktree (.git FILE) carrying a worktree-local shadow that must be
// refused. `worktree` doubles as the cwd of the simulated worktree-isolated
// session. Both real locations of the file are present: a single-spec run
// dir and a multi-spec run's per-spec `spec-{n}/` subdirectory.
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vexpcli-'));
  const main = path.join(root, 'main');
  const pipelines = path.join(main, '.claude-tweaks', 'pipelines');
  const singleDir = path.join(pipelines, '2026-08-20T090000-spec-12');
  const specDir = path.join(pipelines, RUN_ID, 'spec-2758');
  const worktree = path.join(main, '.claude', 'worktrees', 'flow-spec-2758');
  const shadow = path.join(worktree, '.claude-tweaks', 'pipelines', RUN_ID, 'spec-2758');
  fs.mkdirSync(singleDir, { recursive: true });
  fs.mkdirSync(specDir, { recursive: true });
  fs.mkdirSync(shadow, { recursive: true });
  fs.mkdirSync(path.join(main, '.git'));
  fs.writeFileSync(path.join(worktree, '.git'), 'gitdir: ../../../.git/worktrees/flow-spec-2758\n');
  return { root, main, singleDir, specDir, worktree, shadow };
}

function fakeDeps(cwd) {
  const out = []; const err = [];
  return {
    deps: { cwd: () => cwd, readFile: (p) => fs.readFileSync(p), stdout: (s) => out.push(s), stderr: (s) => err.push(s) },
    out, err,
  };
}

const readJson = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'verify-expectations.json'), 'utf8'));
const exists = (dir) => fs.existsSync(path.join(dir, 'verify-expectations.json'));

test('cli: a worktree-isolated session (cwd inside the linked worktree) writes spec-{n}/verify-expectations.json into the anchored main-checkout run dir', () => {
  const { specDir, worktree, shadow } = fixture();
  const { deps, out } = fakeDeps(worktree);
  const code = run(['--run', specDir, '--deferred', DEFERRED], deps);
  assert.equal(code, 0);
  assert.deepEqual(readJson(specDir), { version: 1, memory: [], upstream: [], deferred: DEFERRED.split(',') });
  assert.ok(out.join('').includes(path.join(fs.realpathSync(specDir), 'verify-expectations.json')), 'the written path is echoed');
  assert.ok(!exists(shadow), 'nothing is written into the worktree-local shadow');
});

test('cli: a worktree-local shadow run dir is refused (exit 3) and its existing file is byte-unchanged', () => {
  const { worktree, shadow } = fixture();
  const before = '{"version":1,"memory":[],"upstream":[],"sentinel":true}';
  fs.writeFileSync(path.join(shadow, 'verify-expectations.json'), before);
  const { deps, err } = fakeDeps(worktree);
  const code = run(['--run', shadow, '--deferred', DEFERRED], deps);
  assert.equal(code, 3);
  assert.ok(/not anchored/.test(err.join('')));
  assert.equal(fs.readFileSync(path.join(shadow, 'verify-expectations.json'), 'utf8'), before);
});

test('cli: a path outside the main checkout is refused (exit 3), nothing written', () => {
  const { root, worktree } = fixture();
  const outside = path.join(root, 'elsewhere', '.claude-tweaks', 'pipelines', 'run-x');
  fs.mkdirSync(outside, { recursive: true });
  const { deps, err } = fakeDeps(worktree);
  assert.equal(run(['--run', outside], deps), 3);
  assert.ok(/not anchored/.test(err.join('')));
  assert.ok(!exists(outside));
});

test('cli: a missing run dir is exit 3 and names it', () => {
  const { main, worktree } = fixture();
  const { deps, err } = fakeDeps(worktree);
  assert.equal(run(['--run', path.join(main, 'nope')], deps), 3);
  assert.ok(/does not exist/.test(err.join('')));
});

test('cli: after the deferred write, the per-spec verify probe reads skip (nothing recorded), not unknown (expectations file missing)', () => {
  const { specDir, worktree } = fixture();
  const probe = () => {
    const { rows } = runVerify({ runDir: specDir, base: 'main', deps: { git: () => '', gh: () => '' } });
    return ['memory-updates', 'upstream-feedback'].map((check) => rows.find((r) => r.check === check));
  };
  for (const row of probe()) {
    assert.equal(row.result, 'unknown');
    assert.match(row.detail, /expectations file missing/);
  }
  assert.equal(run(['--run', specDir, '--deferred', DEFERRED], fakeDeps(worktree).deps), 0);
  for (const row of probe()) {
    assert.equal(row.result, 'skip');
    assert.match(row.detail, /nothing recorded/);
  }
});

test('cli: no field flags creates the empty file in a single-spec run dir, and a re-run leaves recorded fields intact', () => {
  const { singleDir, worktree } = fixture();
  assert.equal(run(['--run', singleDir], fakeDeps(worktree).deps), 0);
  assert.deepEqual(readJson(singleDir), { version: 1, memory: [], upstream: [] });
  assert.equal(run(['--run', singleDir, '--oversight-exempt', '41'], fakeDeps(worktree).deps), 0);
  assert.equal(run(['--run', singleDir], fakeDeps(worktree).deps), 0);
  assert.deepEqual(readJson(singleDir), { version: 1, memory: [], upstream: [], oversightExempt: [41] });
});

test('cli: --oversight-exempt appends to the existing array (deduplicated, sorted) and preserves every other field', () => {
  const { singleDir, worktree } = fixture();
  fs.writeFileSync(path.join(singleDir, 'verify-expectations.json'), JSON.stringify({ version: 1, memory: [{ file: 'a.md', indexFile: 'M.md' }], upstream: [], oversightExempt: [90] }));
  assert.equal(run(['--run', singleDir, '--oversight-exempt', '12'], fakeDeps(worktree).deps), 0);
  assert.equal(run(['--run', singleDir, '--oversight-exempt', '12,90'], fakeDeps(worktree).deps), 0);
  const data = readJson(singleDir);
  assert.deepEqual(data.oversightExempt, [12, 90]);
  assert.deepEqual(data.memory, [{ file: 'a.md', indexFile: 'M.md' }]);
});

test('cli: --issues and --file compose in one call', () => {
  const { root, singleDir, worktree } = fixture();
  const payload = path.join(root, 'payload.json');
  fs.writeFileSync(payload, JSON.stringify({ memory: [{ file: 'm.md', indexFile: 'MEMORY.md' }], upstream: [{ url: 'https://github.com/o/r/issues/3' }] }));
  assert.equal(run(['--run', singleDir, '--issues', '2764,2765', '--file', payload], fakeDeps(worktree).deps), 0);
  assert.deepEqual(readJson(singleDir), {
    version: 1,
    memory: [{ file: 'm.md', indexFile: 'MEMORY.md' }],
    upstream: [{ url: 'https://github.com/o/r/issues/3' }],
    issues: [2764, 2765],
  });
});

test('cli: a malformed --file payload is exit 2 and nothing is written', () => {
  const { root, singleDir, worktree } = fixture();
  const write = (name, body) => { const p = path.join(root, name); fs.writeFileSync(p, body); return p; };
  const cases = [
    [['--file', path.join(root, 'absent.json')], /could not read --file/],
    [['--file', write('bad.json', 'not json')], /not valid JSON/],
    [['--file', write('arr.json', '[]')], /must contain a JSON object/],
    [['--file', write('unknown.json', '{"version":1}')], /unknown field "version"/],
    [['--file', write('entry.json', '{"memory":[{"file":"m.md"}]}')], /memory\[0\]/],
    [['--file', write('dup.json', '{"issues":[1]}'), '--issues', '2'], /given by both --file and --issues/],
    [['--file'], /--file requires a path/],
  ];
  for (const [args, pattern] of cases) {
    const { deps, err } = fakeDeps(worktree);
    assert.equal(run(['--run', singleDir, ...args], deps), 2, args.join(' '));
    assert.match(err.join(''), pattern);
  }
  assert.ok(!exists(singleDir));
});

test('cli: malformed invocations are exit 2 and nothing is written', () => {
  const { singleDir, worktree } = fixture();
  const cases = [
    [['--deferred', DEFERRED], /--run <run-dir> is required/],
    [['--run', singleDir, '--bogus'], /unknown argument: --bogus/],
    [['--run', singleDir, '--deferred'], /--deferred requires a comma-separated value/],
    [['--run', singleDir, '--deferred', 'worktree,,claim-release'], /--deferred has an empty entry/],
    [['--run', singleDir, '--deferred', 'Not A Token'], /deferred\[0\]/],
    [['--run', singleDir, '--issues', '12,abc'], /--issues entries must be record numbers/],
    [['--run', singleDir, '--oversight-exempt', '0'], /oversightExempt\[0\] must be a positive integer/],
  ];
  for (const [args, pattern] of cases) {
    const { deps, err } = fakeDeps(worktree);
    assert.equal(run(args, deps), 2, args.join(' '));
    assert.match(err.join(''), pattern);
  }
  assert.ok(!exists(singleDir));
});

test('cli: --help prints usage, exit 0, before any run-dir resolution', () => {
  const { worktree } = fixture();
  const { deps, out } = fakeDeps(worktree);
  assert.equal(run(['--help'], deps), 0);
  assert.ok(out.join('').includes('usage: set-verify-expectations.js'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/verify-expectations/write.test.js tests/bin-lib/verify-expectations/cli.test.js`
Expected: FAIL with `Cannot find module` for `plugin/bin/lib/verify-expectations/write` and `plugin/bin/set-verify-expectations`

- [ ] **Step 3: Write the library**

`plugin/bin/lib/verify-expectations/write.js`:

```js
// bin/lib/verify-expectations/write.js — the one read-modify-write
// implementation for a run directory's verify-expectations.json (#2764),
// the file `wrap-up-engine.js verify` (lib/wrap-up/engine-verify.js's
// readExpectations) reads. Consumed by bin/set-verify-expectations.js — the
// fourth sanctioned run-dir writer, alongside log-decision.js (decisions.md),
// stage-item.js (staged/), and set-config.js (config.yml) — and by
// bin/wrap-up-engine.js's finish-console verb.
//
// Run-dir anchoring is the caller's job (the CLI goes through
// lib/stage-item/write.js's resolveTarget; wrap-up-engine.js's main() guards
// --run-dir itself) — this module writes into whatever directory it is given.
//
// Merge rules: every field this call does not provide is preserved, including
// keys this module does not know. `memory`, `upstream`, `deferred`, and
// `issues` are each owned whole by one wrap-up step, so a provided value
// replaces the stored one. `oversightExempt` accumulates one record at a time
// (verification-brief.md's Oversight-floor gate), so a provided value is
// unioned into the stored array. An existing file that is unparseable or not
// a JSON object is treated as empty — the same posture finish-console had
// before it moved here.
//
// Write shape: a read-modify-write of one shared file, so it runs under
// lib/file-lock.js's withLock (best-effort, fail-open) and lands via
// lib/atomic-write.js's tmp+rename — the pairing lib/log-decision/append.js
// uses for decisions.md.
'use strict';

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../atomic-write');
const { withLock } = require('../file-lock');

const FILE_NAME = 'verify-expectations.json';
// The only version lib/wrap-up/engine-verify.js's readExpectations accepts.
const VERSION = 1;
const FIELD_KEYS = Object.freeze(['memory', 'upstream', 'deferred', 'issues', 'oversightExempt']);
// A deferred cleanup item is a plain lowercase token (cleanup-procedures.md's
// vocabulary: design-caches, worktree, ephemeral-server, claim-release,
// run-dir-archival). The shape is validated, not the membership — the reader
// only ever looks tokens up in a Set, so an unknown token is inert.
const SAFE_TOKEN = /^[a-z][a-z0-9-]*$/;

const isPositiveInt = (n) => Number.isInteger(n) && n > 0;
const isNonEmptyString = (s) => typeof s === 'string' && s !== '';

// fields -> null when valid, else a one-line reason naming the offender.
function validateFields(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return 'fields must be an object';
  for (const key of Object.keys(fields)) {
    if (!FIELD_KEYS.includes(key)) return `unknown field ${JSON.stringify(key)} (allowed: ${FIELD_KEYS.join(', ')})`;
    if (!Array.isArray(fields[key])) return `"${key}" must be an array`;
  }
  for (const [i, m] of (fields.memory || []).entries()) {
    if (!m || !isNonEmptyString(m.file) || !isNonEmptyString(m.indexFile)) return `memory[${i}] must be {file, indexFile} (both non-empty strings)`;
  }
  for (const [i, u] of (fields.upstream || []).entries()) {
    if (!u || !isNonEmptyString(u.url)) return `upstream[${i}] must be {url} (a non-empty string)`;
  }
  for (const [i, d] of (fields.deferred || []).entries()) {
    if (typeof d !== 'string' || !SAFE_TOKEN.test(d)) return `deferred[${i}] must be a lowercase token (letters, digits, -): ${JSON.stringify(d)}`;
  }
  for (const key of ['issues', 'oversightExempt']) {
    for (const [i, n] of (fields[key] || []).entries()) {
      if (!isPositiveInt(n)) return `${key}[${i}] must be a positive integer`;
    }
  }
  return null;
}

function readExisting(file) {
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

// (existing object, validated fields) -> the object to store. Pure.
function mergeExpectations(existing, fields = {}) {
  const stored = (key) => (Array.isArray(existing[key]) ? existing[key] : []);
  const out = {
    ...existing,
    version: VERSION,
    memory: fields.memory ?? stored('memory'),
    upstream: fields.upstream ?? stored('upstream'),
  };
  if (fields.deferred) out.deferred = [...new Set(fields.deferred)];
  if (fields.issues) out.issues = [...new Set(fields.issues)];
  if (fields.oversightExempt) {
    const prior = stored('oversightExempt').map(Number).filter(isPositiveInt);
    out.oversightExempt = [...new Set([...prior, ...fields.oversightExempt])].sort((a, b) => a - b);
  }
  return out;
}

// { runDir, fields? } -> { file, data }. Throws when the file is unwritable.
function writeExpectations({ runDir, fields = {} }) {
  const file = path.join(runDir, FILE_NAME);
  return withLock(`${file}.lock`, () => {
    const data = mergeExpectations(readExisting(file), fields);
    writeFileAtomic(file, `${JSON.stringify(data, null, 2)}\n`);
    return { file, data };
  });
}

module.exports = {
  FILE_NAME, VERSION, FIELD_KEYS, validateFields, mergeExpectations, writeExpectations,
};
```

- [ ] **Step 4: Write the CLI**

`plugin/bin/set-verify-expectations.js`:

```js
#!/usr/bin/env node
// bin/set-verify-expectations.js — write or update verify-expectations.json
// in a run directory, the sanctioned path for a worktree-isolated session
// (#2764). The fourth of the sanctioned-write family: bin/log-decision.js
// (decisions.md), bin/stage-item.js (staged/), bin/set-config.js
// (config.yml), this (verify-expectations.json).
//   node bin/set-verify-expectations.js --run <run-dir> [--deferred <item>[,<item>...]]
//     [--issues <n>[,<n>...]] [--oversight-exempt <n>[,<n>...]] [--file <payload.json>] [--help]
// --run is the directory `wrap-up-engine.js verify --run-dir` will read:
// a single-spec run's own run dir, or a multi-spec run's per-spec
// `spec-{n}/` subdirectory ($PIPELINE_RUN_DIR in both cases).
// Read-modify-write: every field the call does not name is preserved.
//   (no field flags)     create the file with the version-1 defaults
//                        ({"version":1,"memory":[],"upstream":[]}) when it is
//                        absent; an existing file keeps its recorded fields.
//   --deferred           replace `deferred` (the multi-spec defer protocol's
//                        cleanup items).
//   --issues             replace `issues` (a run with no materialized header).
//   --oversight-exempt   add record numbers to `oversightExempt` (a union —
//                        the Oversight-floor gate records one at a time).
//   --file               a JSON object carrying any of memory, upstream,
//                        deferred, issues, oversightExempt — the path for
//                        `memory`/`upstream`, whose entries are objects. A key
//                        named by both --file and its flag is refused.
// Exit 0 on success (echoes the written file's path — the run dir's
// realpath, which can differ from the --run input string); 2 on a malformed
// invocation (missing --run, an unknown argument, a dangling or empty list
// value, a non-numeric record number, an unreadable/unparseable/non-object
// --file, an unknown or invalid field — nothing is written on this code);
// 3 when the run dir is missing or not anchored under the main checkout (a
// worktree-local shadow — _shared/pipeline-run-dir.md's Anchoring section,
// [IL-127]), or the file is unwritable. No exit 1, like its three siblings.
'use strict';

const fs = require('fs');
const { resolveTarget } = require('./lib/stage-item/write');
const { validateFields, writeExpectations } = require('./lib/verify-expectations/write');

const USAGE = 'usage: set-verify-expectations.js --run <run-dir> [--deferred <item>[,<item>...]] [--issues <n>[,<n>...]] [--oversight-exempt <n>[,<n>...]] [--file <payload.json>] [--help]\n';

// flag -> the verify-expectations.json field it sets.
const LIST_FLAGS = Object.freeze({
  '--deferred': 'deferred',
  '--issues': 'issues',
  '--oversight-exempt': 'oversightExempt',
});
const NUMERIC_FIELDS = new Set(['issues', 'oversightExempt']);

function parseArgs(argv) {
  const o = { run: null, lists: {}, file: null, sawFile: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? null;
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--run') o.run = next();
    else if (a === '--file') { o.sawFile = true; o.file = next(); }
    else if (Object.hasOwn(LIST_FLAGS, a)) o.lists[a] = next();
    else return { error: `unknown argument: ${a}` };
  }
  return o;
}

const realDeps = {
  cwd: () => process.cwd(),
  readFile: (p) => fs.readFileSync(p),
  mainRoot: undefined,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  const usageError = (message) => { deps.stderr(`set-verify-expectations.js: ${message}\n` + USAGE); return 2; };
  if (o.error) { deps.stderr(o.error + '\n' + USAGE); return 2; }
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.run) return usageError('--run <run-dir> is required');

  const fields = {};
  for (const [flag, raw] of Object.entries(o.lists)) {
    const key = LIST_FLAGS[flag];
    if (raw === null || raw.trim() === '') return usageError(`${flag} requires a comma-separated value`);
    const parts = raw.split(',').map((s) => s.trim());
    if (parts.includes('')) return usageError(`${flag} has an empty entry: ${JSON.stringify(raw)}`);
    if (NUMERIC_FIELDS.has(key)) {
      if (parts.some((p) => !/^\d+$/.test(p))) return usageError(`${flag} entries must be record numbers: ${JSON.stringify(raw)}`);
      fields[key] = parts.map(Number);
    } else {
      fields[key] = parts;
    }
  }

  if (o.sawFile) {
    if (!o.file) return usageError('--file requires a path');
    let raw;
    try { raw = deps.readFile(o.file); } catch (err) {
      return usageError(`could not read --file ${o.file} (${err && err.message})`);
    }
    let payload;
    try { payload = JSON.parse(raw.toString('utf8')); } catch (err) {
      return usageError(`--file ${o.file} is not valid JSON (${err && err.message})`);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return usageError(`--file ${o.file} must contain a JSON object`);
    }
    for (const [key, value] of Object.entries(payload)) {
      if (Object.hasOwn(fields, key)) {
        const flag = Object.keys(LIST_FLAGS).find((f) => LIST_FLAGS[f] === key);
        return usageError(`"${key}" is given by both --file and ${flag}`);
      }
      fields[key] = value;
    }
  }

  const invalid = validateFields(fields);
  if (invalid) return usageError(invalid);

  let target;
  try { target = resolveTarget({ runDir: o.run, cwd: deps.cwd(), mainRoot: deps.mainRoot }); } catch (err) {
    deps.stderr(`set-verify-expectations.js: ${err && err.message}\n`);
    return 3;
  }
  if (!target.ok) {
    if (target.reason === 'missing') deps.stderr(`set-verify-expectations.js: run dir does not exist: ${o.run}\n`);
    else deps.stderr(`set-verify-expectations.js: run dir is not anchored under the main checkout (a worktree-local shadow): ${o.run} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path\n`);
    return 3;
  }

  let result;
  try { result = writeExpectations({ runDir: target.dir, fields }); } catch (err) {
    deps.stderr(`set-verify-expectations.js: could not write verify-expectations.json (${err && err.message})\n`);
    return 3;
  }
  deps.stdout(result.file + '\n');
  return 0;
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
```

- [ ] **Step 5: Run the new tests to verify they pass**

Run: `node --test tests/bin-lib/verify-expectations/write.test.js tests/bin-lib/verify-expectations/cli.test.js`
Expected: PASS, 0 failures

- [ ] **Step 6: Characterize finish-console before changing it**

Run: `node --test tests/bin-lib/wrap-up/finish-console-cli.test.js`
Expected: PASS, 0 failures (the existing suite is the characterization for the next step)

- [ ] **Step 7: Route finish-console's step-1 write through the library**

In `plugin/bin/wrap-up-engine.js`, add beside the other `require` lines near the top (after the `writeFileAtomic` require, which stays — step 3's ledger write still uses it):

```js
const { writeExpectations } = require('./lib/verify-expectations/write');
```

Replace the step-1 block inside `runFinishConsole`:

```js
  const expectationsPath = path.join(args.runDir, 'verify-expectations.json');
  let existing = {};
  try {
    existing = JSON.parse(fs.readFileSync(expectationsPath, 'utf8'));
  } catch { existing = {}; }
  const expectations = {
    ...existing, version: 1, memory, upstream,
  };
  try {
    writeFileAtomic(expectationsPath, `${JSON.stringify(expectations, null, 2)}\n`);
  } catch (e) {
```

with:

```js
  try {
    writeExpectations({ runDir: args.runDir, fields: { memory, upstream } });
  } catch (e) {
```

Leave the comment above the block, the `catch` body, and everything after it unchanged.

- [ ] **Step 8: Run the finish-console, engine, and conformance suites**

Run: `node --test tests/bin-lib/wrap-up/finish-console-cli.test.js tests/bin-lib/wrap-up/engine-verify.test.js tests/bin-lib/exit-code-conformance.test.js tests/bin-lib/verify-expectations/write.test.js tests/bin-lib/verify-expectations/cli.test.js`
Expected: PASS, 0 failures

- [ ] **Step 9: Commit**

```bash
git add plugin/bin/lib/verify-expectations/write.js plugin/bin/set-verify-expectations.js plugin/bin/wrap-up-engine.js tests/bin-lib/verify-expectations/write.test.js tests/bin-lib/verify-expectations/cli.test.js
git commit -m "Add set-verify-expectations.js — a fourth sanctioned run-dir writer, refs #2764" -m "Claude-Session: https://claude.ai/code/session_015ZX5aJf9QxottoX6taiskk"
```

---

### Task 2: Repoint skill prose at the CLI and register it

**Files:**
- Modify: `plugin/skills/wrap-up/review-console-appendix.md` (step 4 of the Multi-spec defer protocol)
- Modify: `plugin/skills/wrap-up/review-console.md` (On-approval step 11; the nothing-to-review fast path paragraph)
- Modify: `plugin/skills/wrap-up/verification-brief.md` (the Oversight-floor gate's `oversightExempt` write)
- Modify: `plugin/skills/_shared/pipeline-run-dir.md` (tool-level pinning paragraph; Sanctioned-write CLIs bullet)
- Modify: `docs/plugin-structure.md` (lib row, unit-suite command line, CLI row)
- Modify: `docs/journeys/release-a-claim-and-log-a-pipeline-decision.md` (frontmatter `files:`, a new step, a changelog line)
- Modify: `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md` (Sanctioned-writer vocabulary bullet; boundary-guard shape 3; read-modify-write bullet)
- Modify: `.claude/skills/gh-api-module-pattern/SKILL.md` (frontmatter description's writer list)
- Modify: `.claude/skills/run-directory-fact-packs/SKILL.md` (the sanctioned-writers parenthetical)
- Test: `tests/verify-expectations-writer-conformance.test.js`

**Interfaces:**
- Consumes: `plugin/bin/set-verify-expectations.js` from Task 1 — flags `--run`, `--deferred`, `--issues`, `--oversight-exempt`, `--file`; exit 0/2/3.
- Produces: nothing later tasks rely on.

Before editing, read `docs/skill-authoring.md` (the "Instruction-prose diet", "Plugin-root references", and "Executable snippets in skill prose" sections) and `.claude/skills/skill-prose-conformance-tests/SKILL.md`. Operative text states the rule and cites `#2764`; it does not retell the incident. Write `${CLAUDE_PLUGIN_ROOT}` literally in skill prose.

Measured sizes at plan time (shared ceiling 46,080 bytes): `review-console.md` 32,751; `review-console-appendix.md` 2,399; `verification-brief.md` 20,236; `pipeline-run-dir.md` 21,591. Every edit below is a few hundred bytes at most and `verification-brief.md` shrinks. File-specific byte pins were not enumerated at plan time; Step 6's full-suite run surfaces any, and if one fails, trim the new wording rather than the pre-existing text.

- [ ] **Step 1: Write the failing conformance test**

`tests/verify-expectations-writer-conformance.test.js`:

```js
'use strict';
// #2764: pins that the wrap-up skill prose routes every
// verify-expectations.json write a worktree-isolated session can reach
// through bin/set-verify-expectations.js, and executes the one fenced
// snippet that names it (docs/skill-authoring.md's "Executable snippets in
// skill prose" — extract and run).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PLUGIN = path.join(ROOT, 'plugin');
const read = (...segments) => fs.readFileSync(path.join(ROOT, ...segments), 'utf8');
const CLI_CALL = 'node "${CLAUDE_PLUGIN_ROOT}/bin/set-verify-expectations.js" --run "$PIPELINE_RUN_DIR"';

test('the multi-spec defer protocol writes the deferred shape through the sanctioned writer', () => {
  const appendix = read('plugin', 'skills', 'wrap-up', 'review-console-appendix.md');
  assert.ok(
    appendix.includes(`${CLI_CALL} --deferred design-caches,worktree,ephemeral-server,claim-release,run-dir-archival`),
    'step 4 must name the CLI call with all five deferred items',
  );
});

test('the Review Console names the sanctioned writer for its non-finish-console writes', () => {
  const consoleDoc = read('plugin', 'skills', 'wrap-up', 'review-console.md');
  const calls = consoleDoc.split(CLI_CALL).length - 1;
  assert.ok(calls >= 2, `expected the CLI call in step 11 and in the nothing-to-review fast path, found ${calls}`);
  assert.ok(consoleDoc.includes(`${CLI_CALL} --file`), 'step 11 must name the --file form for memory/upstream');
});

test('pipeline-run-dir.md registers the fourth sanctioned writer in both places it lists the family', () => {
  const doc = read('plugin', 'skills', '_shared', 'pipeline-run-dir.md');
  const mentions = doc.split('bin/set-verify-expectations.js').length - 1;
  assert.ok(mentions >= 2, `expected the tool-level pinning paragraph and the Sanctioned-write CLIs bullet to name it, found ${mentions}`);
});

test('no wrap-up skill file still hand-writes verify-expectations.json with fs.writeFileSync', () => {
  const dir = path.join(PLUGIN, 'skills', 'wrap-up');
  const offenders = fs.readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .filter((name) => {
      const body = fs.readFileSync(path.join(dir, name), 'utf8');
      return body.includes('fs.writeFileSync(') && body.includes('verify-expectations.json');
    });
  assert.deepEqual(offenders, []);
});

test('the Oversight-floor gate snippet in verification-brief.md runs and records the exemption', () => {
  const doc = read('plugin', 'skills', 'wrap-up', 'verification-brief.md');
  const m = /Record the exemption \(#2383\)[\s\S]*?```bash\n([\s\S]*?)```/.exec(doc);
  assert.ok(m, 'extraction pattern is out of sync with the doc');
  const snippet = m[1].trim();
  assert.ok(snippet.includes(`${CLI_CALL} --oversight-exempt {N}`), `unexpected snippet: ${snippet}`);

  const main = fs.mkdtempSync(path.join(os.tmpdir(), 'vexp-conf-'));
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', '2026-08-20T090000-spec-12');
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(path.join(main, '.git'));
  fs.writeFileSync(path.join(runDir, 'verify-expectations.json'), JSON.stringify({ version: 1, memory: [], upstream: [], oversightExempt: [7] }));

  const command = snippet.split('${CLAUDE_PLUGIN_ROOT}').join(PLUGIN).split('{N}').join('42');
  execFileSync('/bin/sh', ['-c', command], { cwd: main, env: { ...process.env, PIPELINE_RUN_DIR: runDir }, encoding: 'utf8' });

  const data = JSON.parse(fs.readFileSync(path.join(runDir, 'verify-expectations.json'), 'utf8'));
  assert.deepEqual(data.oversightExempt, [7, 42]);
  assert.deepEqual(data.memory, []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/verify-expectations-writer-conformance.test.js`
Expected: FAIL — the appendix, console, and pipeline-run-dir assertions fail, the offender list names `verification-brief.md`, and the snippet assertion fails with `unexpected snippet`

- [ ] **Step 3: Edit the three wrap-up skill files**

`plugin/skills/wrap-up/review-console-appendix.md`, step 4 — replacing:

```
4. Write `verify-expectations.json` in this spec's own run directory: `{"version": 1, "memory": [], "upstream": [], "deferred": ["design-caches", "worktree", "ephemeral-server", "claim-release", "run-dir-archival"]}`. The five deferred
```

with:

```
4. Write `verify-expectations.json` in this spec's own run directory (`$PIPELINE_RUN_DIR`, the per-spec `spec-{N}/` subdirectory) through the sanctioned writer — a direct Write there is refused from a worktree-isolated session (#2764): `node "${CLAUDE_PLUGIN_ROOT}/bin/set-verify-expectations.js" --run "$PIPELINE_RUN_DIR" --deferred design-caches,worktree,ephemeral-server,claim-release,run-dir-archival`, which leaves `{"version": 1, "memory": [], "upstream": [], "deferred": ["design-caches", "worktree", "ephemeral-server", "claim-release", "run-dir-archival"]}`. The five deferred
```

and, at the end of the same step, replacing:

```
Preserve any `oversightExempt` array `verification-brief.md`'s Oversight-floor gate already wrote into this same file earlier in this spec's own run — read-modify-write this step too, never a blind overwrite.
```

with:

```
The writer read-modify-writes, so an `oversightExempt` array `verification-brief.md`'s Oversight-floor gate already recorded in this same file is preserved.
```

`plugin/skills/wrap-up/review-console.md`, step 11 — replacing:

```
writes it (preserving other fields), logs the outcomes, and flips the named ledger rows in one call — `memory` holds
```

with:

```
writes it (preserving other fields), logs the outcomes, and flips the named ledger rows in one call; on any other resolution path, write the object's `memory`/`upstream` keys to a scratch JSON file and run `node "${CLAUDE_PLUGIN_ROOT}/bin/set-verify-expectations.js" --run "$PIPELINE_RUN_DIR" --file {scratch-file}` (#2764 — never a direct Write, which a worktree-isolated session is refused; add `--issues {n}[,{m}]` for the `issues` key below) — `memory` holds
```

and in the same step, replacing:

```
read the existing file first (when present) and carry its `oversightExempt` value forward unchanged into this write, same as any other field this step doesn't itself own.
```

with:

```
both writers above read-modify-write, carrying `oversightExempt` and every other field this step doesn't itself own forward unchanged.
```

Same file, the nothing-to-review fast path paragraph — replacing:

```
Write an empty `verify-expectations.json` (`{"version": 1, "memory": [], "upstream": []}`) in `$PIPELINE_RUN_DIR` if it does not already exist — nothing was resolved
```

with:

```
Run `node "${CLAUDE_PLUGIN_ROOT}/bin/set-verify-expectations.js" --run "$PIPELINE_RUN_DIR"` — with no field flags it creates an empty `verify-expectations.json` (`{"version": 1, "memory": [], "upstream": []}`) when none exists and leaves an existing one's fields intact — nothing was resolved
```

`plugin/skills/wrap-up/verification-brief.md` — replacing the sentence fragment and fenced block:

````
  this record was deliberately skipped, not silently missed: append `N` to
  `$PIPELINE_RUN_DIR/verify-expectations.json`'s `oversightExempt` array (read-modify-write —
  the console's own later write, `review-console.md` Step 10, preserves this field rather than
  clobbering it; create the file with the version-1 defaults first when it doesn't exist yet):

  ```bash
  node -e "
  const fs = require('fs');
  const p = process.argv[1] + '/verify-expectations.json';
  let data = { version: 1, memory: [], upstream: [] };
  if (fs.existsSync(p)) { try { data = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {} }
  const s = new Set(data.oversightExempt || []);
  s.add(Number(process.argv[2]));
  data.oversightExempt = [...s].sort((a, b) => a - b);
  fs.writeFileSync(p, JSON.stringify(data));
  " "$PIPELINE_RUN_DIR" "{N}"
  ```
````

with:

````
  this record was deliberately skipped, not silently missed: add `N` to
  `$PIPELINE_RUN_DIR/verify-expectations.json`'s `oversightExempt` array through the sanctioned
  writer (#2764) — it creates the file with the version-1 defaults when absent, unions `N` into
  the array, and preserves every other field, as the console's own later write
  (`review-console.md` Step 10) does:

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/bin/set-verify-expectations.js" --run "$PIPELINE_RUN_DIR" --oversight-exempt {N}
  ```
````

- [ ] **Step 4: Register the writer in `pipeline-run-dir.md`**

In the tool-level pinning paragraph, replacing:

```
refs #1376/#1580) the same way — none of the three are
subject to this tool-level pinning, and all work identically from a worktree session or the
main checkout.
```

with:

```
refs #1376/#1580) the same way, and `bin/set-verify-expectations.js` writes or updates
`verify-expectations.json` (`--run <run-dir>` plus `--deferred`/`--issues`/`--oversight-exempt`/`--file`,
refs #2764) — none of the four are
subject to this tool-level pinning, and all work identically from a worktree session or the
main checkout.
```

In the CLI-argument-boundary list, replacing:

```
- **Sanctioned-write CLIs** — `bin/log-decision.js`, `bin/stage-item.js`, and `bin/set-config.js`
  (`--run`, refs #1376) — the run-dir writers
```

with:

```
- **Sanctioned-write CLIs** — `bin/log-decision.js`, `bin/stage-item.js`, `bin/set-config.js`
  (`--run`, refs #1376), and `bin/set-verify-expectations.js` (`--run`, refs #2764) — the run-dir writers
```

and replacing:

```
A fourth writer imports that `resolveTarget`
  rather than re-deriving the predicate.
```

with:

```
A further writer imports that `resolveTarget`
  rather than re-deriving the predicate, as the third and fourth did.
```

- [ ] **Step 5: Register the writer in the maintainer docs and project skills**

`docs/plugin-structure.md`:
- After the `plugin/bin/lib/set-config/` row, add one row in the same style: `plugin/bin/lib/verify-expectations/ → write.js — verify-expectations.json read-modify-write (validateFields over the five known keys memory/upstream/deferred/issues/oversightExempt; mergeExpectations preserves every field a call does not name, replaces memory/upstream/deferred/issues, unions oversightExempt; writeExpectations runs under file-lock.js's withLock and lands via atomic-write.js) — the fourth of the sanctioned-write family. Consumed by plugin/bin/set-verify-expectations.js and plugin/bin/wrap-up-engine.js's finish-console verb`. Match the surrounding rows' exact column alignment and arrow glyph.
- In the "unit suites only" command line that lists `tests/bin-lib/set-config/*.test.js`, add `tests/bin-lib/verify-expectations/*.test.js` after it and `+ verify-expectations` to that line's trailing comment.
- After the two `set-config.js` CLI rows, add: `node plugin/bin/set-verify-expectations.js --run <run-dir> [--deferred <item>[,<item>...]] [--issues <n>[,<n>...]] [--oversight-exempt <n>[,<n>...]] [--file <payload.json>]   # Set-verify-expectations CLI (#2764) — write or update a run dir's verify-expectations.json from a worktree-isolated session (read-modify-write; no field flags creates the empty version-1 file; --run is a single-spec run dir or a multi-spec run's per-spec spec-{n}/ subdirectory); exit 0 wrote (prints the file's path), 2 malformed invocation, 3 run dir missing or not anchored under the main checkout, or the file unwritable`.

`.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`:
- In the *Sanctioned-writer* vocabulary bullet, change the parenthesised CLI list to `` `plugin/bin/log-decision.js`, `plugin/bin/stage-item.js`, `plugin/bin/set-config.js`, `plugin/bin/set-verify-expectations.js` `` and the trailing `(`decisions.md`, `staged/`, `config.yml` respectively)` to `(`decisions.md`, `staged/`, `config.yml`, `verify-expectations.json` respectively)`; change `Copying *Split-1/2* into a fourth writer` to `Copying *Split-1/2* into a further writer`.
- In the boundary-guard bullet's shape (3), change `(`log-decision.js`, `stage-item.js`, `set-config.js`)` to `(`log-decision.js`, `stage-item.js`, `set-config.js`, `set-verify-expectations.js`)`, and change `Import that `resolveTarget` when you add a fourth writer instead of re-deriving the predicate — `set-config.js` (#1376) does, on its record's own instruction` to `Import that `resolveTarget` when you add another writer instead of re-deriving the predicate — `set-config.js` (#1376) and `set-verify-expectations.js` (#2764) both do`.
- In the "A sanctioned writer that read-modify-writes a shared file guards it" bullet, append one sentence at the bullet's end: `` `plugin/bin/lib/verify-expectations/write.js`'s `writeExpectations` (#2764) is the family's fourth member and takes the full pairing from the start — `withLock` plus `atomic-write.js`'s tmp+rename — because it read-modify-writes one shared `verify-expectations.json` that the Oversight-floor gate, the multi-spec defer protocol, and `wrap-up-engine.js finish-console` all write. ``

`.claude/skills/gh-api-module-pattern/SKILL.md`: in the frontmatter `description`, change `(the run-directory writers log-decision.js, stage-item.js, set-config.js, compose-context.js)` to `(the run-directory writers log-decision.js, stage-item.js, set-config.js, set-verify-expectations.js, compose-context.js)`.

`.claude/skills/run-directory-fact-packs/SKILL.md`: change `(`log-decision.js`, `stage-item.js`, `set-config.js`)` to `(`log-decision.js`, `stage-item.js`, `set-config.js`, `set-verify-expectations.js`)`.

`docs/journeys/release-a-claim-and-log-a-pipeline-decision.md`:
- Add `  - plugin/bin/set-verify-expectations.js` and `  - plugin/bin/lib/verify-expectations/write.js` to the frontmatter `files:` list after the `set-config` entries.
- Add a step after step 5a, numbered `5b`, in the same field layout as its neighbours (URL / Action / Should understand, plus whatever other fields step 5a carries). URL: `mkdir -p /tmp/ve-journey/.git && cd /tmp/ve-journey && node "$PLUGIN_ROOT/bin/set-verify-expectations.js" --run /tmp/ve-journey --deferred design-caches,worktree; echo "exit=$?"; node "$PLUGIN_ROOT/bin/set-verify-expectations.js" --run /tmp/ve-journey --oversight-exempt 42; cat verify-expectations.json; node "$PLUGIN_ROOT/bin/set-verify-expectations.js" --run /tmp/ve-journey --issues abc; echo "exit=$?"`. Action: run the three calls from inside the scratch checkout — a deferred write, an exemption added to the same file, a malformed record number. Should understand: the first call prints the written path and exits 0; after the second the file holds `version`, empty `memory`/`upstream`, the two `deferred` items, and `oversightExempt: [42]` — the second call preserved the first's field; the third exits 2 and leaves the file unchanged.
- Before writing that step, run its three commands for real against this checkout's `plugin/` (substitute the absolute `plugin` path for `$PLUGIN_ROOT`, and use a directory under the session scratchpad instead of `/tmp`) and confirm the output matches what the step says. Run them as separate Bash calls.
- Add a changelog line at the end of the journey's history list, in the neighbours' style: `- Extended during build of record #2764 (`bin/set-verify-expectations.js` — the `verify-expectations.json` fourth of the sanctioned-write family) — added step 5b (a deferred write, a preserved-field second write, a malformed-value refusal); step tested live in this session`.

- [ ] **Step 6: Run the conformance test, then the full suite**

Run: `node --test tests/verify-expectations-writer-conformance.test.js`
Expected: PASS, 0 failures

Run: `npm test > "{scratchpad}/npm-test-task2.log" 2>&1` (foreground, timeout 20 minutes; substitute the session scratchpad directory), then read the log's final summary lines.
Expected: 0 failures. A prose-pinning or byte-budget test that fails names the file — fix by trimming the new wording, never by loosening the test.

- [ ] **Step 7: Commit**

```bash
git add plugin/skills/wrap-up/review-console-appendix.md plugin/skills/wrap-up/review-console.md plugin/skills/wrap-up/verification-brief.md plugin/skills/_shared/pipeline-run-dir.md docs/plugin-structure.md docs/journeys/release-a-claim-and-log-a-pipeline-decision.md .claude/skills/gh-api-module-pattern/cli-wrapper-contract.md .claude/skills/gh-api-module-pattern/SKILL.md .claude/skills/run-directory-fact-packs/SKILL.md tests/verify-expectations-writer-conformance.test.js
git commit -m "Route verify-expectations.json writes through set-verify-expectations.js — refs #2764" -m "Claude-Session: https://claude.ai/code/session_015ZX5aJf9QxottoX6taiskk"
```
