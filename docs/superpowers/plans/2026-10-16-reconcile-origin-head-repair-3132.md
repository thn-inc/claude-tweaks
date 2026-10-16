# Reconcile origin/HEAD Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a fresh clone with no local `refs/remotes/origin/HEAD`, `reconcile` repairs the ref once (`git remote set-head origin --auto`) and re-resolves the integration branch instead of skipping every check as `no-remote`.

**Architecture:** A new single-purpose module `plugin/bin/lib/reconcile/origin-head.js` exports `repairOriginHead(root, opts)`. `reconcile/index.js` calls it only when `resolveIntegrationBranch` returns null, drops any cached `null` for that root, re-resolves, and records the outcome on `result.originHeadRepair`. The shared offline resolver in `worktree-reap.js` is not touched.

**Tech Stack:** Node 18+, `node:test`, git CLI via `plugin/bin/lib/hooks/git-exec.js`'s `runGit`.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T174210-spec-3132/work/3132-spec.md` (record #3132)

Scope keywords: resolveIntegrationBranch, no-remote, origin/HEAD

## Global Constraints

- `resolveIntegrationBranch` (`plugin/bin/lib/hooks/worktree-reap.js`) stays offline — no `fetch`, `ls-remote`, or `remote set-head` added there.
- Never-break-a-session invariant (`docs/hooks.md`): a failed `set-head` (no network, auth failure, unreachable remote) degrades to today's `no-remote` skip and never throws.
- Bound the `set-head` round-trip with the same timeout reconcile's mirror fetch uses: `FETCH_TIMEOUT_MS` from `plugin/bin/lib/reconcile/classify.js` (5000ms).
- Do not hand-edit `scripts/claude-cloud-setup.sh`.
- A checkout with no `origin` remote produces `{"check":"all","reason":"no-remote"}` exactly as before, with no new result field.
- Commit messages: `{Verb} {what} — {detail}` style, ending with `Claude-Session: https://claude.ai/code/session_01UzyrYkCtrQSDBatA2Km7C5`.

## Review Focus

1. Origin configured but unreachable (bad URL / offline) — the repair must fail soft: `no-remote` skip plus `originHeadRepair.outcome === 'failed'`, no throw. Pinned in Task 1 (`origin points at a missing path`).
2. A caller-supplied resolver cache already holding `null` for the root (session-start passes one) — re-resolution must not return the stale cached `null`. Pinned in Task 1 (`cache holding null`).
3. Repo with no `origin` remote — result must be byte-identical to today (no `originHeadRepair` key). Pinned in Task 1.
4. A policy-configured `integration-branch` — the repair never runs (resolver already non-null). Covered by the existing policy-based tests in `tests/reconcile.test.js`, which stay green unchanged; Task 1 adds an explicit assertion that `originHeadRepair` is absent there.
5. Running from inside a linked worktree — `root` is `mainCheckoutRoot(cwd)`, so `set-head` writes into the shared common gitdir, never a different repository. No new code path; noted for the reviewer.

---

### Task 1: origin/HEAD repair inside reconcile

**Files:**
- Create: `plugin/bin/lib/reconcile/origin-head.js`
- Modify: `plugin/bin/lib/reconcile/index.js:104-114` (the `integration` resolution + `no-remote` short-circuit)
- Test: `tests/reconcile.test.js` (append new tests after the existing `'reconcile: no network / no remote resolves to no-remote, never crashes (AC4)'` test, ~line 920)
- Modify: `docs/reconcile-checks.md` (new section before `## Referenced by`)
- Modify: `docs/plugin-structure.md:27` (add `origin-head.js` to the reconcile further-modules list)

**Interfaces:**
- Produces: `repairOriginHead(root: string, opts?: { runGit?: Function, timeoutMs?: number }) -> null | { outcome: 'repaired' } | { outcome: 'failed', reason: string }` — `null` means no `origin` remote is configured, nothing attempted.
- Produces: `reconcile()` result gains an optional `originHeadRepair` key — present only when a repair was attempted: `{ outcome: 'repaired', branch: string }`, `{ outcome: 'failed', reason: string }`, or `{ outcome: 'unresolved' }` (set-head succeeded but the re-read still found nothing).

- [ ] **Step 1: Write the failing tests**

Append to `tests/reconcile.test.js`, right after the `'reconcile: no network / no remote resolves to no-remote, never crashes (AC4)'` test:

```js
// #3132: a fresh clone in a cloud/Routine sandbox has no local
// refs/remotes/origin/HEAD. A plain `git clone` normally sets it, so the
// fixture deletes it explicitly — a fixture that merely clones would pass
// vacuously.
function freshCloneWithoutOriginHead() {
  const { originDir, mainDir } = pairedFixture();
  git(['remote', 'set-head', 'origin', '--delete'], mainDir);
  fs.mkdirSync(path.join(mainDir, '.claude-tweaks'), { recursive: true });
  // local-merge + checks:['mirror'] keeps the pass fully offline once the
  // branch resolves (no gh preflight), while still proving resolution: a
  // resolved branch reaches the local-merge-model skip, an unresolved one
  // returns no-remote first.
  fs.writeFileSync(path.join(mainDir, '.claude-tweaks', 'policy.yml'), 'integration-model: local-merge\n');
  return { originDir, mainDir };
}

test('reconcile: fresh clone with no origin/HEAD repairs it and resolves the integration branch (#3132)', async () => {
  const { mainDir } = freshCloneWithoutOriginHead();
  assert.throws(() => git(['symbolic-ref', 'refs/remotes/origin/HEAD'], mainDir), 'fixture must start without origin/HEAD');

  const r = await reconcile({ cwd: mainDir, checks: ['mirror'] });

  assert.ok(!r.skipped.some((s) => s.reason === 'no-remote'), `expected no no-remote skip, got ${JSON.stringify(r.skipped)}`);
  assert.deepStrictEqual(r.skipped, [{ check: 'mirror,release,archive,archive-branches,remote-prune,console', reason: 'local-merge-model' }]);
  assert.deepStrictEqual(r.originHeadRepair, { outcome: 'repaired', branch: 'main' });
  assert.strictEqual(git(['symbolic-ref', 'refs/remotes/origin/HEAD'], mainDir).trim(), 'refs/remotes/origin/main');
});

test('reconcile: origin/HEAD repair discards a cached null for the root before re-resolving (#3132)', async () => {
  const { mainDir } = freshCloneWithoutOriginHead();
  const { mainCheckoutRoot } = require('../plugin/bin/lib/hooks/worktree-detect');
  const cache = { worktreeList: new Map(), integrationBranch: new Map([[mainCheckoutRoot(mainDir), null]]) };

  const r = await reconcile({ cwd: mainDir, checks: ['mirror'], cache });

  assert.deepStrictEqual(r.originHeadRepair, { outcome: 'repaired', branch: 'main' });
  assert.strictEqual(cache.integrationBranch.get(mainCheckoutRoot(mainDir)), 'main');
});

test('reconcile: origin configured but unreachable degrades to no-remote with a failed repair, never throws (#3132)', async () => {
  const { mainDir } = freshCloneWithoutOriginHead();
  git(['remote', 'set-url', 'origin', path.join(os.tmpdir(), 'ct-recon-missing-origin-does-not-exist')], mainDir);

  const r = await reconcile({ cwd: mainDir, checks: ['mirror'] });

  assert.deepStrictEqual(r.skipped, [{ check: 'all', reason: 'no-remote' }]);
  assert.strictEqual(r.originHeadRepair.outcome, 'failed');
  assert.strictEqual(typeof r.originHeadRepair.reason, 'string');
});

test('reconcile: no origin remote keeps the no-remote skip unchanged and attempts no repair (#3132)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-noorigin-'));
  git(['init', '-q'], dir);
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');

  const r = await reconcile({ cwd: dir });

  assert.deepStrictEqual(r.skipped, [{ check: 'all', reason: 'no-remote' }]);
  assert.ok(!('originHeadRepair' in r), 'no origin remote must not attempt (or report) a repair');
});

test('reconcile: a policy-configured integration branch never triggers the origin/HEAD repair (#3132)', async () => {
  const { mainDir } = freshCloneWithoutOriginHead();
  fs.writeFileSync(path.join(mainDir, '.claude-tweaks', 'policy.yml'), 'integration-model: local-merge\nintegration-branch: main\n');

  const r = await reconcile({ cwd: mainDir, checks: ['mirror'] });

  assert.ok(!('originHeadRepair' in r));
  assert.throws(() => git(['symbolic-ref', 'refs/remotes/origin/HEAD'], mainDir), 'repair must not run when policy already resolves the branch');
});

test('resolveIntegrationBranch stays offline: no fetch, ls-remote, or remote set-head in worktree-reap.js (#3132)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'hooks', 'worktree-reap.js'), 'utf8');
  const start = src.indexOf('function resolveIntegrationBranch(');
  assert.ok(start >= 0, 'resolveIntegrationBranch not found');
  const end = src.indexOf('\n}\n', start);
  const body = src.slice(start, end);
  for (const verb of ["'fetch'", "'ls-remote'", "'set-head'"]) {
    assert.ok(!body.includes(verb), `resolveIntegrationBranch must stay offline — found ${verb}`);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="3132" tests/reconcile.test.js`
Expected: FAIL — the fresh-clone test reports `expected no no-remote skip, got [{"check":"all","reason":"no-remote"}]`; the cache and unreachable tests fail on `originHeadRepair` being `undefined`. (The no-origin, policy, and offline-source tests already pass — they are regression pins.)

- [ ] **Step 3: Create `plugin/bin/lib/reconcile/origin-head.js`**

```js
// bin/lib/reconcile/origin-head.js — one-time origin/HEAD repair for a
// fresh clone (#3132). A brand-new clone in a cloud/Routine sandbox can
// lack the local refs/remotes/origin/HEAD symbolic ref, which leaves
// worktree-reap.js's offline resolveIntegrationBranch with nothing to read
// and reconcile skipping every check as `no-remote`. The repair lives here,
// at the one consumer that already does network work (shared-fetch.js),
// rather than in the shared resolver: that resolver is called from the
// pre/post-tool-use hook paths and must stay offline and cheap.
//
// Never throws — every failure (no network, auth, unreachable remote)
// comes back as a value the caller degrades to the existing `no-remote`
// skip, per the never-break-a-session invariant (docs/hooks.md).
'use strict';
const { runGit: defaultRunGit } = require('../hooks/git-exec');
const { FETCH_TIMEOUT_MS } = require('./classify');

// -> null                                  no `origin` remote; nothing attempted
// -> { outcome: 'repaired' }               set-head wrote refs/remotes/origin/HEAD
// -> { outcome: 'failed', reason: string } set-head failed; reason is git-exec's FAILURE class
function repairOriginHead(root, opts = {}) {
  const runGit = opts.runGit || defaultRunGit;
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : FETCH_TIMEOUT_MS;
  try {
    const remote = runGit(['remote', 'get-url', 'origin'], root);
    if (remote.failure) return null;
    const set = runGit(['remote', 'set-head', 'origin', '--auto'], root, { timeoutMs });
    if (set.failure) return { outcome: 'failed', reason: String(set.failure) };
    return { outcome: 'repaired' };
  } catch (e) {
    return { outcome: 'failed', reason: (e && e.message) || 'threw' };
  }
}

module.exports = { repairOriginHead };
```

- [ ] **Step 4: Wire it into `plugin/bin/lib/reconcile/index.js`**

Add the require next to the other reconcile-module requires (after the `shared-fetch` line):

```js
const { repairOriginHead } = require('./origin-head');
```

Replace the existing block:

```js
  const integration = bareIntegrationName(resolveIntegrationBranch(root, opts.cache));
  if (!integration) {
    result.skipped.push({ check: 'all', reason: 'no-remote' });
    return result;
  }
```

with:

```js
  let integration = bareIntegrationName(resolveIntegrationBranch(root, opts.cache));
  // #3132: a fresh clone can lack refs/remotes/origin/HEAD even with a
  // working `origin` — repair it once here (reconcile already does network
  // work) and re-resolve, rather than adding a network call to the shared
  // offline resolver. Recorded on the result only when attempted, so a
  // checkout with no `origin` keeps today's exact no-remote result.
  if (!integration) {
    const repair = repairOriginHead(root);
    if (repair) {
      if (repair.outcome === 'repaired') {
        // The caller's resolver cache may already hold this root's null.
        if (opts.cache && opts.cache.integrationBranch) opts.cache.integrationBranch.delete(root);
        integration = bareIntegrationName(resolveIntegrationBranch(root, opts.cache));
        result.originHeadRepair = integration ? { outcome: 'repaired', branch: integration } : { outcome: 'unresolved' };
      } else {
        result.originHeadRepair = repair;
      }
    }
  }
  if (!integration) {
    result.skipped.push({ check: 'all', reason: 'no-remote' });
    return result;
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test --test-name-pattern="3132" tests/reconcile.test.js`
Expected: PASS (6 tests)

Then the whole file, to confirm no existing reconcile test regressed:
Run: `node --test tests/reconcile.test.js`
Expected: PASS, 0 failures

- [ ] **Step 6: Prove the fresh-clone test discriminates**

Temporarily comment out the `const repair = repairOriginHead(root);` block's call (replace with `const repair = null;`), run `node --test --test-name-pattern="fresh clone with no origin/HEAD" tests/reconcile.test.js`, confirm it FAILS with the `no-remote` message, then restore the line exactly and re-run to PASS. Do not commit the mutation; `git diff plugin/bin/lib/reconcile/index.js` must show only the Step 4 change afterwards.

- [ ] **Step 7: Document the repair**

In `docs/reconcile-checks.md`, insert this section immediately before the `## Referenced by` heading:

```markdown
## origin/HEAD repair on a fresh clone (#3132)

`worktree-reap.js`'s `resolveIntegrationBranch` falls back to the local `refs/remotes/origin/HEAD`
when `policy.yml` sets no `integration-branch` — and a fresh clone in a cloud/Routine sandbox can
lack that symbolic ref even with a working `origin`. When the resolver returns null and an `origin`
remote is configured, `index.js` runs `git remote set-head origin --auto` once
(`origin-head.js`, bounded by `classify.js`'s `FETCH_TIMEOUT_MS`), drops any cached null for the
root, and re-resolves. The outcome is recorded on the result as `originHeadRepair` —
`{outcome: 'repaired', branch}`, `{outcome: 'failed', reason}` (degrades to the `no-remote` skip,
never throws), or `{outcome: 'unresolved'}` — and the key is absent when no repair was attempted
(no `origin` remote, or the branch already resolved). The repair lives in reconcile, never in the
shared resolver: that resolver runs on the pre/post-tool-use hook paths and stays offline.
```

In `docs/plugin-structure.md` line 27, change `(background-lock.js, escalate-residue.js, format-summary.js, issue-list-cache.js, residue-summary.js, squash-provenance.js)` to `(background-lock.js, escalate-residue.js, format-summary.js, issue-list-cache.js, origin-head.js, residue-summary.js, squash-provenance.js)`.

- [ ] **Step 8: Commit**

```bash
git add plugin/bin/lib/reconcile/origin-head.js plugin/bin/lib/reconcile/index.js tests/reconcile.test.js docs/reconcile-checks.md docs/plugin-structure.md
git commit -m "Repair a missing origin/HEAD in reconcile — fresh clones no longer skip every check as no-remote (#3132)" -m "Claude-Session: https://claude.ai/code/session_01UzyrYkCtrQSDBatA2Km7C5"
```
