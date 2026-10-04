# docs-health verify-commit Implementation Plan (#2866)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `/claude-tweaks:docs-health` a mechanical check that classifies a cited or proposed commit hash against complete repository history before a finding is filed.

**Architecture:** A new `plugin/bin/lib/docs-health/commit-ref.js` module classifies hashes over an injectable `git` runner (the repo's gh-api-module-pattern seam); `plugin/bin/docs-health.js` gains a `verify-commit` subcommand that parses arguments and prints the `{ result }` JSON envelope its sibling subcommands use; `plugin/skills/docs-health/judge-procedure.md` point 6 instructs the judge to run it on every hash in a finding's `newString` before emitting the finding.

**Tech Stack:** Node 18+ CommonJS, `child_process.execFileSync('git', argv)`, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-04T181733-record-2866/work/2866-spec.md` (record #2866)

## Global Constraints

- Six outcome strings, exactly: `reachable`, `exists-unreachable`, `not-found`, `unverifiable`, `ambiguous`, `invalid`.
- A shallow clone never yields `reachable` or `not-found` from the shallow view; a fetch failure is `unverifiable`, never `not-found`.
- An abbreviated hash matching more than one commit is `ambiguous` (candidates listed), never a silent pick.
- Git calls use argv arrays; caller-supplied ref names are validated (`^[A-Za-z0-9][A-Za-z0-9._/-]*$`) and `rev-parse --verify` uses `--end-of-options`, never `--`.
- The remote-contacting deepen fetch carries an explicit timeout (`DEEPEN_TIMEOUT_MS = 120000`, reason stated beside it); local probes carry none.
- `judge-procedure.md`'s inlinable body must not contain `above`, `below`, `SKILL.md`, `_shared/`, `Step <digit>`, `criteria fragment`, or `judge-procedure.md` (`tests/bin-lib/docs-health/skill-md.test.js`), and its code fences must stay balanced.
- Test fixtures are real throwaway git repositories under `os.tmpdir()`; the shallow fixture is a real `git clone --depth 1 file://...`.
- Commit messages: `{Verb} {what} — {detail}`, reference `refs #2866` (never `closes`/`fixes`), end with `Claude-Session: https://claude.ai/code/session_015ZX5aJf9QxottoX6taiskk`.

## Design decisions (recorded in the run's decisions.md)

- **Shallow clone: deepen by default.** When `git rev-parse --is-shallow-repository` prints `true`, run one bounded fetch — `git fetch --quiet --unshallow --no-tags <remote> +refs/heads/*:refs/remotes/<remote>/*` — then re-check shallowness. Every branch head, not only the integration branch: `clone --depth` implies `--single-branch`, so a targeted fetch leaves a side-branch-only commit absent and it would read `not-found` (probed: git 2.56.0, `side absent` after `fetch --unshallow origin main`; `side present` after the all-heads refspec). Fetch failure (probed: exit 128, repo stays shallow) or still-shallow afterwards → every valid hash `unverifiable`. `deepen: false` (`--no-deepen`) → `unverifiable` without fetching.
- **Hash resolution:** `git rev-parse --disambiguate=<prefix>` filtered to commit objects (`git cat-file -t`). 0 → `not-found`, 1 → ancestry check, >1 → `ambiguous`. Probed: `rev-parse --verify --quiet X^{commit}` exits 1 for both unknown and ambiguous prefixes, so it cannot separate them; `--disambiguate` prints every candidate (exit 0, empty output when none) and accepts full and uppercase hashes.
- **Ancestry:** `git merge-base --is-ancestor <sha> <integration-ref>` — exit 0 `reachable`, exit 1 `exists-unreachable`, anything else `unverifiable` (probed: 128 on an invalid commit).
- **Integration ref:** `--integration-branch`, else `refs/remotes/<remote>/HEAD`'s symbolic target; the ref checked is `refs/remotes/<remote>/<branch>`, falling back to `refs/heads/<branch>`. Unresolvable → every valid hash `unverifiable`.
- **Known limit (documented in the module header):** `not-found` means absent from every ref this clone has fetched. A non-shallow single-branch clone still lacks other branches; deepening only runs for shallow clones.

## Review Focus

1. An uppercase or mixed-case hash (`CDB32B046`) — expected to classify exactly like its lowercase form; Task 1 test `uppercase input classifies like lowercase`.
2. A hash that is present in the shallow view (the clone's tip) while deepening fails — must still be `unverifiable`, never `reachable`; Task 1 test `deepen failure`.
3. A caller-supplied branch or remote beginning with `-` — must not reach git as an option; Task 1 test `rejects option-shaped names`.
4. Running outside any git repository — `unverifiable` with a reason, no throw, exit 0 from the CLI; Task 1 test `not a git repository`.
5. Mixed valid and invalid inputs in one call — output order matches input order, invalid entries stay `invalid` even when the rest are `unverifiable`; Task 1 test `invalid inputs keep their outcome`.

## Real-input probe (before the whole-branch review)

Run the finished CLI against this repository with the #2785 hashes: `node plugin/bin/docs-health.js verify-commit cdb32b046 41dc8424f 15553cf --no-deepen` from the worktree root. This checkout is shallow (`git rev-parse --is-shallow-repository` → `true`), so the expected output is three `unverifiable` entries (do not deepen the shared checkout). Record the printed JSON in decisions.md.

---

### Task 1: commit-ref classifier module

**Files:**
- Create: `plugin/bin/lib/docs-health/commit-ref.js`
- Create: `tests/bin-lib/docs-health/commit-fixtures.js`
- Test: `tests/bin-lib/docs-health/commit-ref.test.js`

**Interfaces:**
- Produces: `verifyCommits({ root, hashes, integrationBranch = null, remote = 'origin', deepen = true, git = defaultGit }) -> { root, remote, integrationBranch, integrationRef, shallow: { initial, deepened, error }, commits: [{ input, outcome, sha?, candidates?, reason? }] }`; exports `{ verifyCommits, defaultGit, OUTCOMES, DEEPEN_TIMEOUT_MS }`.
- Produces (fixtures): `makeOriginRepo() -> { dir, root, second, sideOnly, third }`, `cloneOf(origin, { depth }) -> dir`, `makeAmbiguousRepo() -> { dir, prefix, candidates }`, `tmpDir(label) -> dir`, `git(cwd, args) -> stdout`.

- [ ] **Step 1: Write the fixture helper**

`tests/bin-lib/docs-health/commit-fixtures.js`:

```js
'use strict';
// Real throwaway git repositories for the verify-commit tests (#2866).
// Not a *.test.js file, so tools/run-tests.js never runs it on its own.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// Bounds a hung fixture spawn into an error (tests/helpers/git-fixtures.js's
// FIXTURE_TIMEOUT_MS rationale).
const GIT_TIMEOUT_MS = 30000;

function git(cwd, args, input) {
  return execFileSync('git', args, {
    cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, stdio: 'pipe', input,
  });
}

function tmpDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `docs-health-commit-ref-${label}-`));
}

// main: root -> second -> third; side branches off second with one commit
// (sideOnly) that is never merged into main.
function makeOriginRepo() {
  const dir = tmpDir('origin');
  git(dir, ['init', '-q', '-b', 'main']);
  const commit = (file, msg) => {
    fs.writeFileSync(path.join(dir, file), `${msg}\n`);
    git(dir, ['add', file]);
    git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-q', '-m', msg]);
    return git(dir, ['rev-parse', 'HEAD']).trim();
  };
  const root = commit('a.txt', 'root');
  const second = commit('b.txt', 'second');
  git(dir, ['checkout', '-q', '-b', 'side']);
  const sideOnly = commit('c.txt', 'side only');
  git(dir, ['checkout', '-q', 'main']);
  const third = commit('d.txt', 'third');
  return { dir, root, second, sideOnly, third };
}

// A file:// URL, not a bare path: a local-path clone ignores --depth.
function cloneOf(origin, { depth } = {}) {
  const parent = tmpDir('clone');
  const dir = path.join(parent, 'clone');
  const args = ['clone', '-q'];
  if (depth) args.push('--depth', String(depth));
  args.push(`file://${origin.dir}`, dir);
  git(parent, args);
  return dir;
}

// 1500 empty commits with fixed identity and timestamps, so the hashes are
// deterministic; at that count two commits sharing a 4-character prefix is
// a birthday-bound near-certainty, and determinism makes it certain for this
// exact stream (probed: prefix cae9, 64 ms).
function makeAmbiguousRepo() {
  const dir = tmpDir('ambiguous');
  git(dir, ['init', '-q', '-b', 'main']);
  let stream = '';
  for (let i = 1; i <= 1500; i += 1) {
    const msg = `commit ${i}`;
    stream += `commit refs/heads/main\nmark :${i}\n`
      + `committer T <t@example.com> ${1700000000 + i} +0000\n`
      + `data ${Buffer.byteLength(msg)}\n${msg}\n`
      + `${i > 1 ? `from :${i - 1}\n` : ''}\n`;
  }
  git(dir, ['fast-import', '--quiet'], stream);
  const shas = git(dir, ['rev-list', 'main']).trim().split('\n');
  const seen = new Map();
  for (const sha of shas) {
    const prefix = sha.slice(0, 4);
    if (seen.has(prefix)) return { dir, prefix, candidates: [seen.get(prefix), sha].sort() };
    seen.set(prefix, sha);
  }
  throw new Error('makeAmbiguousRepo: no shared 4-character commit prefix — fixture is broken');
}

module.exports = { git, tmpDir, makeOriginRepo, cloneOf, makeAmbiguousRepo };
```

- [ ] **Step 2: Write the failing tests**

`tests/bin-lib/docs-health/commit-ref.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { verifyCommits, OUTCOMES } = require('../../../plugin/bin/lib/docs-health/commit-ref');
const { git, tmpDir, makeOriginRepo, cloneOf, makeAmbiguousRepo } = require('./commit-fixtures');

const outcomeOf = (result, input) => result.commits.find((c) => c.input === input).outcome;

test('OUTCOMES lists exactly the six outcome strings', () => {
  assert.deepStrictEqual([...OUTCOMES], [
    'reachable', 'exists-unreachable', 'not-found', 'unverifiable', 'ambiguous', 'invalid',
  ]);
});

test('full clone: reachable, exists-unreachable, not-found against origin/HEAD', () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin);
  const missing = '0000000000000000000000000000000000000000';
  const r = verifyCommits({ root: dir, hashes: [origin.root, origin.sideOnly.slice(0, 9), missing] });
  assert.strictEqual(r.integrationBranch, 'main');
  assert.strictEqual(r.integrationRef, 'refs/remotes/origin/main');
  assert.strictEqual(r.shallow.initial, false);
  assert.deepStrictEqual(r.commits, [
    { input: origin.root, outcome: 'reachable', sha: origin.root },
    { input: origin.sideOnly.slice(0, 9), outcome: 'exists-unreachable', sha: origin.sideOnly },
    { input: missing, outcome: 'not-found' },
  ]);
});

test('repo with no remote falls back to refs/heads/<integration-branch>', () => {
  const origin = makeOriginRepo();
  const r = verifyCommits({ root: origin.dir, hashes: [origin.third], integrationBranch: 'main' });
  assert.strictEqual(r.integrationRef, 'refs/heads/main');
  assert.strictEqual(outcomeOf(r, origin.third), 'reachable');
});

test('uppercase input classifies like lowercase', () => {
  const origin = makeOriginRepo();
  const upper = origin.second.slice(0, 10).toUpperCase();
  const r = verifyCommits({ root: origin.dir, hashes: [upper], integrationBranch: 'main' });
  assert.deepStrictEqual(r.commits, [{ input: upper, outcome: 'reachable', sha: origin.second }]);
});

test('ambiguous abbreviated hash is its own outcome, listing every candidate', () => {
  const amb = makeAmbiguousRepo();
  const r = verifyCommits({ root: amb.dir, hashes: [amb.prefix], integrationBranch: 'main' });
  assert.deepStrictEqual(r.commits, [
    { input: amb.prefix, outcome: 'ambiguous', candidates: amb.candidates },
  ]);
});

test('invalid inputs keep their outcome and input order is preserved', () => {
  const origin = makeOriginRepo();
  const r = verifyCommits({
    root: origin.dir, hashes: ['xyz', origin.root, 'abc', '-evil'], integrationBranch: 'main',
  });
  assert.deepStrictEqual(r.commits.map((c) => [c.input, c.outcome]), [
    ['xyz', 'invalid'], [origin.root, 'reachable'], ['abc', 'invalid'], ['-evil', 'invalid'],
  ]);
});

test('shallow clone is deepened over every branch head, then classified', () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin, { depth: 1 });
  assert.strictEqual(git(dir, ['rev-parse', '--is-shallow-repository']).trim(), 'true');
  const r = verifyCommits({ root: dir, hashes: [origin.root, origin.sideOnly] });
  assert.strictEqual(r.shallow.initial, true);
  assert.strictEqual(r.shallow.deepened, true);
  assert.deepStrictEqual(r.commits.map((c) => c.outcome), ['reachable', 'exists-unreachable']);
  assert.strictEqual(git(dir, ['rev-parse', '--is-shallow-repository']).trim(), 'false');
});

test('deepen failure: shallow view never yields reachable or not-found', () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin, { depth: 1 });
  git(dir, ['remote', 'set-url', 'origin', `file://${tmpDir('gone')}/missing`]);
  const missing = '1111111111111111111111111111111111111111';
  // origin.third is the clone's tip, so it IS present in the shallow view.
  const r = verifyCommits({ root: dir, hashes: [origin.third, origin.root, missing, 'nothex'] });
  assert.strictEqual(r.shallow.deepened, false);
  assert.ok(r.shallow.error, 'the fetch failure is reported');
  assert.deepStrictEqual(r.commits.map((c) => c.outcome),
    ['unverifiable', 'unverifiable', 'unverifiable', 'invalid']);
  for (const c of r.commits.slice(0, 3)) assert.match(c.reason, /shallow/);
});

test('deepen disabled: shallow clone returns unverifiable without fetching', () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin, { depth: 1 });
  const r = verifyCommits({ root: dir, hashes: [origin.third], deepen: false });
  assert.deepStrictEqual(r.commits.map((c) => c.outcome), ['unverifiable']);
  assert.strictEqual(git(dir, ['rev-parse', '--is-shallow-repository']).trim(), 'true');
});

test('unresolvable integration branch yields unverifiable', () => {
  const origin = makeOriginRepo();
  const r = verifyCommits({ root: origin.dir, hashes: [origin.root], integrationBranch: 'nope' });
  assert.strictEqual(outcomeOf(r, origin.root), 'unverifiable');
  assert.strictEqual(r.integrationRef, null);
});

test('rejects option-shaped names without invoking git on them', () => {
  const calls = [];
  const fakeGit = (args) => { calls.push(args); throw new Error(`unexpected ${args.join(' ')}`); };
  for (const opts of [{ integrationBranch: '-evil' }, { remote: '--upload-pack=x' }]) {
    const r = verifyCommits({ root: '/nowhere', hashes: ['abcd'], git: fakeGit, ...opts });
    assert.strictEqual(r.commits[0].outcome, 'unverifiable');
    assert.match(r.commits[0].reason, /invalid (remote|integration branch) name/);
  }
  assert.deepStrictEqual(calls, []);
});

test('not a git repository yields unverifiable, never a throw', () => {
  const r = verifyCommits({ root: tmpDir('plain'), hashes: ['abcd'], integrationBranch: 'main' });
  assert.strictEqual(r.commits[0].outcome, 'unverifiable');
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/docs-health/commit-ref.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/lib/docs-health/commit-ref'`.

- [ ] **Step 4: Write the module**

`plugin/bin/lib/docs-health/commit-ref.js`:

```js
'use strict';
const { execFileSync } = require('child_process');

// Classifies commit hashes a docs-health finding cites against complete
// repository history (#2866) — the check #2785's own build had to redo by
// hand after its filed replacement text named one commit that exists but is
// unreachable from main and another that never touched the cited files.
//
// Outcomes:
//   reachable           one commit, an ancestor of the integration ref
//   exists-unreachable  one commit, not on the integration branch
//   not-found           no commit in any ref this clone has fetched
//   unverifiable        history could not be made complete (a shallow clone
//                       that could not be deepened, no integration ref, a git
//                       failure) — no verdict, never reported as not-found
//   ambiguous           an abbreviated hash matching more than one commit —
//                       never silently resolved to one of them
//   invalid             not a 4-64 character hexadecimal string (a
//                       could-not-parse signal, distinct from not-found)
//
// Shallow clones: a shallow view can neither prove a commit absent nor prove
// ancestry, so one bounded fetch deepens the clone over every branch head
// (refs/heads/* only — no tags, no pull-request refs) before anything is
// classified. Every head, not only the integration branch: clone --depth
// implies --single-branch, so a targeted fetch would leave a commit living
// only on another branch absent and misreport it as not-found. A failed
// fetch, or a clone still shallow afterwards, makes every hash unverifiable;
// deepen:false skips the fetch and returns unverifiable outright.
//
// Known limit: not-found means absent from every ref this clone has fetched.
// A non-shallow single-branch clone is not deepened and still lacks other
// branches' commits.

const OUTCOMES = Object.freeze([
  'reachable', 'exists-unreachable', 'not-found', 'unverifiable', 'ambiguous', 'invalid',
]);

const HASH_RE = /^[0-9a-f]{4,64}$/i;
// Remote and branch names reach git as positional arguments; refusing a
// leading '-' (and anything outside ref-safe characters) stops flag injection.
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

// Deepening downloads the repository's whole history, which a 5s
// single-call bound would cut off on any real repository; still bounded so a
// black-holed remote ends in unverifiable rather than a hang.
const DEEPEN_TIMEOUT_MS = 120000;

// Probe-style runner: calls here are expected to fail routinely (a missing
// ref, a non-ancestor), so stderr is captured, not leaked. Throws on a
// non-zero exit; err.status carries the exit code.
function defaultGit(args, opts = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(opts.timeout ? { timeout: opts.timeout } : {}),
  });
}

function errorText(err) {
  const text = [err && err.stderr, err && err.message].filter(Boolean).map(String).join(' ').trim();
  return text.split('\n')[0] || String(err);
}

function isShallow(git, root) {
  return git(['-C', root, 'rev-parse', '--is-shallow-repository']).trim() === 'true';
}

function resolveIntegrationBranch(git, root, remote, explicit) {
  if (explicit) return explicit;
  try {
    const out = git(['-C', root, 'symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`]).trim();
    const prefix = `${remote}/`;
    return out.startsWith(prefix) ? out.slice(prefix.length) : null;
  } catch {
    return null;
  }
}

function resolveIntegrationRef(git, root, remote, branch) {
  for (const ref of [`refs/remotes/${remote}/${branch}`, `refs/heads/${branch}`]) {
    try {
      git(['-C', root, 'rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]);
      return ref;
    } catch {
      // not this ref — try the next
    }
  }
  return null;
}

// rev-parse --verify cannot tell an unknown prefix from an ambiguous one
// (both exit 1); --disambiguate lists every object carrying the prefix.
function commitCandidates(git, root, prefix) {
  const out = git(['-C', root, 'rev-parse', `--disambiguate=${prefix}`]);
  const shas = out.split('\n').map((l) => l.trim()).filter(Boolean);
  return shas.filter((sha) => git(['-C', root, 'cat-file', '-t', sha]).trim() === 'commit').sort();
}

function classifyOne(git, root, input, integrationRef) {
  let candidates;
  try {
    candidates = commitCandidates(git, root, input.toLowerCase());
  } catch (err) {
    return { input, outcome: 'unverifiable', reason: `could not resolve hash: ${errorText(err)}` };
  }
  if (candidates.length === 0) return { input, outcome: 'not-found' };
  if (candidates.length > 1) return { input, outcome: 'ambiguous', candidates };
  const sha = candidates[0];
  try {
    git(['-C', root, 'merge-base', '--is-ancestor', sha, integrationRef]);
    return { input, outcome: 'reachable', sha };
  } catch (err) {
    if (err && err.status === 1) return { input, outcome: 'exists-unreachable', sha };
    return { input, outcome: 'unverifiable', sha, reason: `ancestry check failed: ${errorText(err)}` };
  }
}

function verifyCommits({
  root, hashes, integrationBranch = null, remote = 'origin', deepen = true, git = defaultGit,
} = {}) {
  const inputs = (hashes || []).map(String);
  const result = {
    root,
    remote,
    integrationBranch: null,
    integrationRef: null,
    shallow: { initial: null, deepened: false, error: null },
    commits: [],
  };
  const invalid = (input) => ({
    input, outcome: 'invalid', reason: 'not a 4-64 character hexadecimal commit hash',
  });
  const allUnverifiable = (reason) => {
    result.commits = inputs.map((input) => (
      HASH_RE.test(input) ? { input, outcome: 'unverifiable', reason } : invalid(input)));
    return result;
  };

  if (!NAME_RE.test(remote)) return allUnverifiable(`invalid remote name: ${remote}`);
  if (integrationBranch !== null && !NAME_RE.test(integrationBranch)) {
    return allUnverifiable(`invalid integration branch name: ${integrationBranch}`);
  }

  try {
    result.shallow.initial = isShallow(git, root);
  } catch (err) {
    return allUnverifiable(`not a git repository, or git unavailable: ${errorText(err)}`);
  }

  if (result.shallow.initial) {
    if (!deepen) return allUnverifiable('shallow clone: history is incomplete and deepening was disabled');
    try {
      git(['-C', root, 'fetch', '--quiet', '--unshallow', '--no-tags', remote,
        `+refs/heads/*:refs/remotes/${remote}/*`], { timeout: DEEPEN_TIMEOUT_MS });
    } catch (err) {
      result.shallow.error = errorText(err);
      return allUnverifiable(`shallow clone: deepening fetch from ${remote} failed (${result.shallow.error})`);
    }
    try {
      if (isShallow(git, root)) return allUnverifiable('shallow clone: still shallow after deepening');
    } catch (err) {
      return allUnverifiable(`shallow clone: could not re-check after deepening: ${errorText(err)}`);
    }
    result.shallow.deepened = true;
  }

  const branch = resolveIntegrationBranch(git, root, remote, integrationBranch);
  if (!branch || !NAME_RE.test(branch)) {
    return allUnverifiable(`integration branch unresolved: pass --integration-branch or set ${remote}/HEAD`);
  }
  result.integrationBranch = branch;
  const ref = resolveIntegrationRef(git, root, remote, branch);
  if (!ref) return allUnverifiable(`integration ref not found for branch ${branch}`);
  result.integrationRef = ref;

  result.commits = inputs.map((input) => (
    HASH_RE.test(input) ? classifyOne(git, root, input, ref) : invalid(input)));
  return result;
}

module.exports = { verifyCommits, defaultGit, OUTCOMES, DEEPEN_TIMEOUT_MS };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/docs-health/commit-ref.test.js`
Expected: PASS, 12 tests.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/docs-health/commit-ref.js tests/bin-lib/docs-health/commit-fixtures.js tests/bin-lib/docs-health/commit-ref.test.js
git commit -m "Add docs-health commit-ref classifier — four history outcomes plus ambiguous/invalid, shallow clones deepened or unverifiable (refs #2866)"
```

### Task 2: `verify-commit` subcommand

**Files:**
- Modify: `plugin/bin/docs-health.js` (imports, `parseArgs`, new `cmdVerifyCommit`, `main` dispatch, usage line, `module.exports`)
- Modify: `docs/plugin-structure.md` (the `plugin/bin/lib/{code,harness,journey,docs}-health/` entry)
- Test: `tests/bin-lib/docs-health/cli-verify-commit.test.js`

**Interfaces:**
- Consumes: `verifyCommits` from Task 1.
- Produces: `node plugin/bin/docs-health.js verify-commit <sha>... [--root <dir>] [--integration-branch <name>] [--remote <name>] [--no-deepen]` → stdout `{"result": <verifyCommits result>}`, exit 0; no hash → usage on stderr, exit 2.

- [ ] **Step 1: Write the failing tests**

`tests/bin-lib/docs-health/cli-verify-commit.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { git, makeOriginRepo, cloneOf } = require('./commit-fixtures');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'docs-health.js');

test('verify-commit exits 2 with no hash argument', () => {
  const r = spawnSync('node', [CLI, 'verify-commit'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /usage: docs-health\.js verify-commit/);
});

test('verify-commit prints the result envelope for reachable and exists-unreachable hashes', () => {
  const origin = makeOriginRepo();
  const out = execFileSync('node', [
    CLI, 'verify-commit', origin.root.slice(0, 7), origin.sideOnly,
    '--root', origin.dir, '--integration-branch', 'main',
  ], { encoding: 'utf8' });
  const { result } = JSON.parse(out);
  assert.strictEqual(result.integrationRef, 'refs/heads/main');
  assert.deepStrictEqual(result.commits.map((c) => c.outcome), ['reachable', 'exists-unreachable']);
});

test('verify-commit --no-deepen on a shallow clone reports unverifiable and leaves it shallow', () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin, { depth: 1 });
  const out = execFileSync('node', [CLI, 'verify-commit', origin.root, '--root', dir, '--no-deepen'], { encoding: 'utf8' });
  const { result } = JSON.parse(out);
  assert.deepStrictEqual(result.commits.map((c) => c.outcome), ['unverifiable']);
  assert.strictEqual(git(dir, ['rev-parse', '--is-shallow-repository']).trim(), 'true');
});

test('verify-commit on a shallow clone deepens by default and classifies', () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin, { depth: 1 });
  const out = execFileSync('node', [CLI, 'verify-commit', origin.root, '--root', dir, '--remote', 'origin'], { encoding: 'utf8' });
  const { result } = JSON.parse(out);
  assert.strictEqual(result.shallow.deepened, true);
  assert.deepStrictEqual(result.commits.map((c) => c.outcome), ['reachable']);
});

test('the no-argument usage line names verify-commit', () => {
  const r = spawnSync('node', [CLI], { encoding: 'utf8' });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /verify-commit <sha>\.\.\./);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/docs-health/cli-verify-commit.test.js`
Expected: FAIL — an unknown command falls through to the generic usage (exit 2), so the `usage: docs-health.js verify-commit` and `verify-commit <sha>...` matches fail, and the three envelope tests fail because `execFileSync` throws on the non-zero exit.

- [ ] **Step 3: Implement**

In `plugin/bin/docs-health.js`:

1. After `const { checkTrackedFreshness } = require('./lib/docs-health/freshness');` add:

```js
const { verifyCommits } = require('./lib/docs-health/commit-ref');
```

2. In `parseArgs`, after the `--min-confidence` branch add:

```js
    else if (a === '--integration-branch') args.integrationBranch = argv[++i];
    else if (a === '--remote') args.remote = argv[++i];
    else if (a === '--no-deepen') args.noDeepen = true;
```

3. After `cmdCheckFreshness` add:

```js
// Classifies each commit hash against complete history (#2866) — see
// lib/docs-health/commit-ref.js for the six outcomes and the shallow-clone
// posture. Classification is data, so every outcome exits 0; only a missing
// hash argument is a usage error.
function cmdVerifyCommit(args) {
  const hashes = args._.slice(1);
  if (hashes.length === 0) {
    process.stderr.write(
      'usage: docs-health.js verify-commit <sha>... [--root <dir>] [--integration-branch <name>] ' +
      '[--remote <name>] [--no-deepen]\n',
    );
    process.exitCode = 2;
    return;
  }
  const result = verifyCommits({
    root: args.root || process.cwd(),
    hashes,
    integrationBranch: args.integrationBranch || null,
    remote: args.remote || 'origin',
    deepen: !args.noDeepen,
  });
  process.stdout.write(JSON.stringify({ result }, null, 2) + '\n');
}
```

4. In `main`, after `if (cmd === 'check-freshness') return cmdCheckFreshness(args);` add:

```js
  if (cmd === 'verify-commit') return cmdVerifyCommit(args);
```

5. In the fallthrough usage string, replace `'word-count <path>, find-refs <path> [--root <dir>], check-freshness <path> [--root <dir>], ' +` with:

```js
    'word-count <path>, find-refs <path> [--root <dir>], check-freshness <path> [--root <dir>], ' +
    'verify-commit <sha>... [--root <dir>] [--integration-branch <name>] [--remote <name>] [--no-deepen], ' +
```

6. Add `cmdVerifyCommit` to `module.exports` after `cmdCheckFreshness`.

In `docs/plugin-structure.md`, append to the end of the `plugin/bin/lib/{code,harness,journey,docs}-health/` line (after `focus-generators.js's registry)`):

```
. docs-health/ additionally holds commit-ref.js (verifyCommits — classifies a cited commit hash against complete history as reachable / exists-unreachable / not-found / unverifiable / ambiguous / invalid, deepening a shallow clone over every branch head first and never giving a verdict from a shallow view; #2866), exposed as `docs-health.js verify-commit`
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/docs-health/cli-verify-commit.test.js tests/bin-lib/docs-health/cli-check-freshness.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/docs-health.js docs/plugin-structure.md tests/bin-lib/docs-health/cli-verify-commit.test.js
git commit -m "Add docs-health verify-commit subcommand — JSON result envelope, --no-deepen, --integration-branch (refs #2866)"
```

### Task 3: judge-procedure point 6 instruction + conformance test

**Files:**
- Modify: `plugin/skills/docs-health/judge-procedure.md` (point 6, after the `check-freshness` paragraph that ends "is a `category: \"staleness\"` finding.")
- Test: `tests/bin-lib/docs-health/skill-md.test.js` (add one test after `judge-procedure.md carries all ten numbered judgment points`)

**Interfaces:**
- Consumes: the `verify-commit` subcommand name and outcome strings from Tasks 1-2.

Headroom: `judge-procedure.md` is 9754 bytes against the 40 KB per-file ceiling; this adds about 1.2 KB.

- [ ] **Step 1: Write the failing test**

Insert into `tests/bin-lib/docs-health/skill-md.test.js` after the `carries all ten numbered judgment points` test:

```js
// #2866: a finding's proposed replacement text must not cite a commit hash
// that was never checked against complete history (#2785 filed two wrong ones).
test('judge-procedure.md point 6 runs verify-commit on every cited commit hash before emitting', () => {
  const body = readJudgeBody();
  const start = body.search(/^6\. /m);
  const end = body.search(/^7\. /m);
  assert.ok(start >= 0 && end > start, 'points 6 and 7 not found');
  const point6 = body.slice(start, end);
  assert.ok(
    point6.includes('node "{plugin-root}/bin/docs-health.js" verify-commit'),
    'point 6 must carry the verify-commit invocation',
  );
  assert.match(point6, /every commit hash/i, 'point 6 must cover every commit hash a finding cites');
  assert.match(point6, /before emitting/i, 'point 6 must run the check before the finding is emitted');
  assert.match(point6, /`unverifiable`[^.]*never[^.]*`not-found`/, 'point 6 must forbid reading unverifiable as not-found');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/bin-lib/docs-health/skill-md.test.js`
Expected: FAIL — `point 6 must carry the verify-commit invocation`.

- [ ] **Step 3: Add the instruction**

In `plugin/skills/docs-health/judge-procedure.md`, directly after the point-6 line that begins `   For each path in the result's \`missing\` array` and ends `is a \`category: "staleness"\` finding.`, insert a blank line and then (three-space indent, inside point 6):

````
   Before emitting any finding whose `newString` cites a commit hash — including the replacement for a commit-hash citation that no longer resolves — verify every commit hash in that `newString` against complete repository history:

   ```bash
   node "{plugin-root}/bin/docs-health.js" verify-commit <hash> [<hash> ...] --root "{root}"
   ```

   Each entry in the result's `commits` array carries an `outcome`: `reachable` (on the integration branch — safe to cite), `exists-unreachable` (a real commit that is not on the integration branch), `not-found`, `ambiguous` (an abbreviated hash matching several commits — re-run with the full hash), `invalid`, or `unverifiable` (history could not be completed, e.g. a shallow clone that could not be deepened — no verdict, and never read it as `not-found`). Cite a hash as fact only when its outcome is `reachable`; for any other outcome, either drop the hash from `newString` or state explicitly in `newString` that the commit is unreachable from the integration branch or could not be verified, and name the outcome in `reason`.
````

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/docs-health/skill-md.test.js`
Expected: PASS (including the self-contained-body and balanced-fence tests).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/docs-health/judge-procedure.md tests/bin-lib/docs-health/skill-md.test.js
git commit -m "Require verify-commit on proposed commit citations in docs-health judge point 6 (refs #2866)"
```

## Discrimination proofs (scratch, never committed — raw output to decisions.md)

- Classifier: temporarily make `classifyOne` return `reachable` whenever `merge-base` throws, and separately make `verifyCommits` skip the shallow branch; run `node --test tests/bin-lib/docs-health/commit-ref.test.js` and confirm the exists-unreachable and both shallow tests go red; restore via `git checkout -- plugin/bin/lib/docs-health/commit-ref.js` on the uncommitted scratch edit only.
- Conformance: delete the inserted point-6 paragraph on a scratch basis, run `node --test tests/bin-lib/docs-health/skill-md.test.js`, confirm red, restore.
