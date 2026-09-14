# `--release-as` on the local release engine (#2326) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `--release-as <version>` to `bin/release-local.js` so `/claude-tweaks:release --as` works under `local-merge`, replacing the skill's current pr-first-only refusal.

**Architecture:** `precheck()` (`plugin/bin/lib/release/precheck.js`) already computes a "base" version from tags/manifest/tsv before deriving the next candidate via `nextVersion(base, part)`. Add an optional `releaseAs` option that, when set, uses that literal version as the candidate instead of deriving one, but still runs it through the same collision check (`checkCollisions`) and additionally requires it to be strictly ahead of the computed base (a usage error, not a collision, when it isn't). `bin/release-local.js` gains a `--release-as <version>` flag (strict `^\d+\.\d+\.\d+$`), threads it into the `precheck()` call, surfaces the not-ahead case as a usage error (exit 2), and names the override in the printed plan line. The `/claude-tweaks:release` skill then swaps its local-merge refusal for passing `--release-as {version}` through to the engine.

**Tech Stack:** Node.js (`node --test`), no new dependencies.

**Spec:** `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/record-2326/.claude-tweaks/pipelines/2026-09-14T204253-record-2326/work/2326-spec.md`

## Global Constraints

- `--release-as` value must match `^\d+\.\d+\.\d+$` exactly (strict semver, no `v` prefix, no pre-release/build suffix) — same validation the `/claude-tweaks:release` skill's own `--as` flag already uses.
- `precheck()` is shared with `bin/release.js` (via `bin/lib/release/run.js`, `keySource: 'tsv'`) — the new `releaseAs` option must be a no-op for every existing caller that omits it (backward compatible).
- Never change `release-local.js`'s existing exit-code contract (0/1/2/3/4/5) — the not-ahead `--release-as` case is a new *usage error*, so it reuses exit `2`, already the CLI's usage-error code.

---

### Task 1: `precheck()` accepts an explicit `releaseAs` candidate

**Files:**
- Modify: `plugin/bin/lib/release/precheck.js`
- Test: `tests/bin-lib/release/precheck.test.js`

**Interfaces:**
- Consumes: nothing new — `compareVersions`, `nextVersion`, `checkCollisions`, `collectClaims` already defined in this file.
- Produces: `precheck(deps, part, opts)` — `opts.releaseAs` (string, strict semver, optional). Return shape gains a top-level `base` field (the computed base version, always present, not just under `releaseAs`) alongside the existing `candidate`, `claims`, `result`. When `releaseAs` is given and not ahead of `base`, `result` is `{ ok: false, usageError: true, conflicts: [], suggested: null }` — the `usageError: true` flag is what `release-local.js`'s Task 2 checks to distinguish this from an ordinary collision (`result.ok === false` with populated `conflicts`).

- [ ] **Step 1: Failing test**

```js
// Appended to tests/bin-lib/release/precheck.test.js
test('releaseAs: an explicit candidate ahead of the base skips derivation and still runs collision checks', () => {
  const deps = tagDeps({ tags: 'v1.2.0\n', local: '1.2.0', origin: '1.2.0' });
  const { candidate, base, result } = precheck(deps, 'minor', { keySource: 'tags', versionAtRef: deps.versionAtRef, releaseAs: '7.0.0' });
  assert.strictEqual(base, '1.2.0');
  assert.strictEqual(candidate, '7.0.0');
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.conflicts, []);
});

test('releaseAs: a candidate at or behind the base is a usage error, never a collision', () => {
  const deps = tagDeps({ tags: 'v1.2.0\n', local: '1.2.0', origin: '1.2.0' });
  const behind = precheck(deps, 'minor', { keySource: 'tags', versionAtRef: deps.versionAtRef, releaseAs: '1.0.0' });
  assert.strictEqual(behind.base, '1.2.0');
  assert.strictEqual(behind.result.ok, false);
  assert.strictEqual(behind.result.usageError, true);
  assert.deepStrictEqual(behind.result.conflicts, []);
  const equal = precheck(deps, 'minor', { keySource: 'tags', versionAtRef: deps.versionAtRef, releaseAs: '1.2.0' });
  assert.strictEqual(equal.result.usageError, true);
});

test('releaseAs: a sibling worktree claim on the override version still collides', () => {
  const deps = tagDeps({ tags: 'v1.2.0\n', worktrees: SIBLING_WORKTREES, wtVersion: '7.0.0' });
  const { result } = precheck(deps, 'minor', { keySource: 'tags', versionAtRef: deps.versionAtRef, releaseAs: '7.0.0' });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.usageError, undefined);
  assert.strictEqual(result.conflicts[0].source, 'worktree-branch');
});

test('releaseAs omitted: existing callers see the same `base` field added but unchanged candidate/result behavior', () => {
  const a = precheck(baseDeps({ tsv: '6.70.1\t2026-08-09\trelease\n6.71.0\t2026-08-09\twip-never-shipped\n' }), 'minor');
  assert.strictEqual(a.base, '6.71.0');
  assert.strictEqual(a.candidate, '6.72.0');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/release/precheck.test.js`
Expected: FAIL — `releaseAs` tests fail because `precheck()` ignores `opts.releaseAs` and never returns a top-level `base`; `TypeError`/`AssertionError` on `base`/`usageError` being `undefined`.

- [ ] **Step 3: Implement**

```js
// plugin/bin/lib/release/precheck.js — replace the existing precheck() function body
function precheck(deps, part, opts = {}) {
  const branch = opts.branch || 'main';
  if (opts.hasOrigin !== false) deps.git(['fetch', 'origin', branch]);
  const claims = collectClaims(deps, opts);
  const known = [claims.localMain, claims.originMain, claims.tsvTip, claims.tagTip].filter(Boolean);
  const base = known.length ? known.sort(compareVersions).pop() : '0.0.0';
  if (opts.releaseAs) {
    if (compareVersions(opts.releaseAs, base) <= 0) {
      return { candidate: opts.releaseAs, base, claims, result: { ok: false, usageError: true, conflicts: [], suggested: null } };
    }
    return { candidate: opts.releaseAs, base, claims, result: checkCollisions(opts.releaseAs, claims, part) };
  }
  const candidate = nextVersion(base, part);
  return { candidate, base, claims, result: checkCollisions(candidate, claims, part) };
}
```

Also update line 246-252's existing byte-for-byte test (`keySource tsv is byte-for-byte the pre-#2254 path`) — no change needed, since `a` and `b` both gain the same `base` field and stay `deepStrictEqual`. Confirm by re-reading it, no edit required.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/release/precheck.test.js`
Expected: PASS (all tests, including the pre-existing ones)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/release/precheck.js tests/bin-lib/release/precheck.test.js
git commit -m "precheck.js: accept an explicit releaseAs candidate, bypassing derivation but not collision checks

refs #2326"
```

---

### Task 2: `bin/release-local.js` gains `--release-as <version>`

**Files:**
- Modify: `plugin/bin/release-local.js`
- Test: `tests/bin-lib/release-local/cli.test.js`

**Interfaces:**
- Consumes: `precheck(deps, part, opts)` from Task 1 — `opts.releaseAs`, return `{ candidate, base, claims, result }` where `result.usageError === true` signals a not-ahead override.
- Produces: `parseArgs(argv)` gains `opts.releaseAs` (string or `null`). `run(argv, deps)`'s exit-code contract is unchanged except the new usage-error path (still exit `2`).

- [ ] **Step 1: Failing test**

```js
// Appended to tests/bin-lib/release-local/cli.test.js
test('parseArgs: --release-as requires a strict-semver value', () => {
  assert.deepStrictEqual(parseArgs(['--release-as', '7.0.0']), { dryRun: false, branch: null, root: null, releaseAs: '7.0.0', help: false });
  assert.match(parseArgs(['--release-as']).error, /requires a value/);
  assert.match(parseArgs(['--release-as', 'v7.0.0']).error, /strict semver/);
  assert.match(parseArgs(['--release-as', '7.0']).error, /strict semver/);
});

test('AC 1 (#2326): --dry-run --release-as 7.0.0 on a minor-only history plans v7.0.0 and names the override', () => {
  const { deps, state } = makeDeps();
  assert.strictEqual(run(['--dry-run', '--release-as', '7.0.0'], deps), 0);
  assert.match(state.out, /v7\.0\.0 \(minor — --release-as override\) from v1\.2\.0/);
  assert.deepStrictEqual(state.writes, []);
});

test('AC 2 (#2326): --release-as 1.0.0 when the base is 1.2.0 exits 2 naming both versions', () => {
  const { deps, state } = makeDeps();
  assert.strictEqual(run(['--release-as', '1.0.0'], deps), 2);
  assert.match(state.err, /--release-as 1\.0\.0 is not ahead of the current version 1\.2\.0/);
  assert.match(state.err, /usage/);
  assert.deepStrictEqual(state.writes, []);
});

test('#2326: --release-as ahead of base performs a live run at that exact version', () => {
  const { deps, state } = makeDeps();
  assert.strictEqual(run(['--release-as', '9.9.9'], deps), 0);
  assert.strictEqual(state.files['package.json'], '{\n  "name": "x",\n  "version": "9.9.9"\n}\n');
  assert.match(state.out, /released v9\.9\.9/);
});

test('#2326: --release-as colliding with a sibling worktree claim still exits 4', () => {
  const { deps, state } = makeDeps({ worktrees: 'worktree /repo\nbranch refs/heads/main\n\nworktree /w\nbranch refs/heads/wt\n', files: {} });
  deps.git = ((orig) => (args) => (args.join(' ') === 'show wt:.release-please-manifest.json' ? '{".": "9.9.9"}' : orig(args)))(deps.git);
  assert.strictEqual(run(['--release-as', '9.9.9'], deps), 4);
  assert.match(state.err, /collision on v9\.9\.9/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/release-local/cli.test.js`
Expected: FAIL — `parseArgs` returns `{ error: 'unknown argument: --release-as' }`; the AC tests fail because the flag is not recognized.

- [ ] **Step 3: Implement**

```js
// plugin/bin/release-local.js

// USAGE — replace the existing usage array's first line and exit-code doc comment
const USAGE = [
  'usage: release-local.js [--dry-run] [--root <dir>] [--branch <name>] [--release-as <version>]',
  'exit 0 released (or dry-run plan printed); 1 git/engine failure — nothing written, or a NAMED PARTIAL STATE with a recovery command;',
  '     2 usage, no release-please-config.json (run /claude-tweaks:init first), a malformed/unsupported config, or --release-as not ahead of the current base;',
  '     3 nothing to release; 4 version collision;',
  '     5 release-hook failed after the tag (and push) landed — re-run the hook alone',
].join('\n');

// parseArgs — add a strict-semver constant near the top of the file, alongside RELEASE_HOOK_UNSET_RE
const RELEASE_AS_RE = /^\d+\.\d+\.\d+$/;

function parseArgs(argv) {
  const opts = { dryRun: false, branch: null, root: null, releaseAs: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { opts.help = true; continue; }
    if (a === '--dry-run') { opts.dryRun = true; continue; }
    if (a === '--release-as') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) return { error: '--release-as requires a value' };
      i += 1;
      if (!RELEASE_AS_RE.test(next)) return { error: `--release-as must be strict semver (X.Y.Z), got "${next}"` };
      opts.releaseAs = next;
      continue;
    }
    if (VALUE_FLAGS.has(a)) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) return { error: `${a} requires a value` };
      i += 1;
      if (a === '--root') opts.root = next; else opts.branch = next;
      continue;
    }
    return { error: `unknown argument: ${a}` };
  }
  return opts;
}

// planLines — add a releaseAs param and name the override in the first line
function planLines({ version, part, history, hook, edits, unconventional, releaseAs }) {
  const counts = { feat: 0, fix: 0, breaking: 0 };
  for (const c of history.commits) {
    if (c.breaking) counts.breaking += 1;
    if (c.type === 'feat') counts.feat += 1;
    if (c.type === 'fix') counts.fix += 1;
  }
  const versionLabel = releaseAs ? `${part} — --release-as override` : part;
  const lines = [
    `release-local: v${version} (${versionLabel}) from ${history.lastTag || 'no prior tag'} — ${history.commits.length} commit(s): ${counts.feat} feat, ${counts.fix} fix, ${counts.breaking} breaking`,
    `hook: ${hook || 'no hook configured'}`,
    `manifest: ${edits.length ? edits.join(', ') : 'none (tag only)'}`,
  ];
  if (unconventional.length) {
    lines.push(`unconventional (${unconventional.length}):`);
    for (const c of unconventional) lines.push(`  ${c.sha.slice(0, 7)} ${c.subject}`);
  }
  return lines;
}

// run() — inside the try block, replace the existing precheck() call and its
// immediately following collision check with:
    const check = precheck(deps, part, {
      keySource: 'tags', branch, hasOrigin: remoteBranchExists,
      versionAtRef: (ref) => manifest.versionAtRef(targets, (p) => deps.git(['show', `${ref}:${p}`])),
      releaseAs: opts.releaseAs,
    });
    version = check.candidate;
    if (opts.releaseAs && check.result.usageError) {
      throw new UsageError(`--release-as ${opts.releaseAs} is not ahead of the current version ${check.base} — pass a version greater than ${check.base}`);
    }
    if (!check.result.ok) {
      const lines = check.result.conflicts.map((c) => `  - ${c.source}: ${c.detail} claims v${c.version}`);
      deps.stderr(`version collision on v${version}:\n${lines.join('\n')}\nSuggested renumber: v${check.result.suggested}. Resolve and re-run.\n`);
      return 4;
    }

// run() — update the planLines(...) call a few lines below to pass releaseAs:
    for (const line of planLines({ version, part, history, hook, edits, unconventional, releaseAs: opts.releaseAs })) deps.stdout(`${line}\n`);
```

Note: `UsageError` is already caught by the existing `catch` block (`if (err instanceof UsageError) { ... return 2; }`), unconditionally on `stage`, so no change to error handling is needed beyond throwing it.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/release-local/cli.test.js`
Expected: PASS (all tests, including every pre-existing one — the default `(minor)`/`(major)` plan-line format is unchanged when `releaseAs` is not given)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/release-local.js tests/bin-lib/release-local/cli.test.js
git commit -m "release-local.js: add --release-as <version>, threaded through precheck

refs #2326"
```

---

### Task 3: `/claude-tweaks:release` passes `--release-as` under `local-merge`

**Files:**
- Modify: `plugin/skills/release/SKILL.md`
- Modify: `plugin/skills/release/execute.md`

**Interfaces:**
- Consumes: `bin/release-local.js --release-as <version>` from Task 2.
- Produces: no code interface — prose only.

- [ ] **Step 1: Failing test**

This task is a documentation change with no executable test of its own — `skill-prose-conformance-tests` pins skill prose only where a byte-pinned assertion already exists for this text, and none does. Verify the current (soon-to-be-stale) text is present before editing, as the "RED" checkpoint:

Run: `grep -n "is pr-first only" plugin/skills/release/SKILL.md plugin/skills/release/execute.md`
Expected: FAIL (in the sense of "matches", confirming the stale text is still there to replace) — two matches, one per file.

- [ ] **Step 2: Implement — SKILL.md's `--as` row (ruling 17)**

In `plugin/skills/release/SKILL.md`, replace the `--as <version>` table row (the line containing `**pr-first only.**`) with:

```markdown
| `--as <version>` | The `Release-As:` override. Validated against `^\d+\.\d+\.\d+$` — a strict three-part semver, no `v` prefix, no pre-release or build suffix; anything else is a usage error, printed and exited before Step 1. **Both engines.** Under pr-first the value becomes a pushed `Release-As:` commit release-please re-renders; under local-merge (#2326, ledger row 90 closed) it is passed straight through as `bin/release-local.js --release-as {version}`, which validates it is ahead of the derived base and exits `2` (naming both versions) if it is not. Either way the value becomes the **effective version** for every gate and render up to Step 5: Step 4's console row, the major-bump HARD-GATE, Step 5's engine invocation. Steps 6 and 7 use the **shipped** version the engine actually produced (Step 5's "Two versions, reconciled once") — under `--as` the two are expected to agree, and a disagreement is `PARTIAL`, never a `Shipped in` comment carrying the override. |
```

Also update the Step 1 pack-reading paragraph (the one containing `First, the `--as` check this step owns:`) — remove the local-merge-refusal sentence entirely, since Step 1 no longer stops the run for this case:

Before:
```markdown
**First, the `--as` check this step owns:** when `--as` was given and `engine.value` is `local-merge`, print `--as is pr-first only (release-local.js derives the version from history); use a breaking commit or a manual tag`, log it as `SKIP`, and stop — before Step 2, before the review, before any console. `execute.md` keeps a back-stop for the same case; this is where it is decided.
```

After: delete the sentence — Step 1 has nothing left to gate on `--as`/`engine.value` combined, since both engines now accept the flag. Leave the rest of the paragraph (the pack-reading procedure around it) unchanged.

- [ ] **Step 3: Implement — execute.md's back-stop**

In `plugin/skills/release/execute.md`, replace the `### local-merge` section's opening (`**`--as` back-stop.**` paragraph through the ledger-row-90 sentence) with:

```markdown
**`--as` passthrough.** When `--as {version}` was given, pass it to the engine as `--release-as {version}` (#2326, ledger row 90 closed). The engine validates it is strictly ahead of its own derived base and exits `2` (a usage error, naming both versions) if it is not — that exit is handled by the same exit-code table below, row `2`, no special case needed here.

**Invoke the engine.** One call, no flags the CLI does not define — its own are `--dry-run`, `--root <dir>`, `--branch <name>` and `--release-as <version>`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/release-local.js" --root "$RUN_ROOT"{--release-as {version}, when --as was given}
```
```

- [ ] **Step 4: Run test to verify it passes**

Run: `grep -n "is pr-first only\|ledger row 90" plugin/skills/release/SKILL.md plugin/skills/release/execute.md`
Expected: PASS (in the sense of "no longer matches the stale refusal wording") — the only remaining `ledger row 90` mention is the new "closed" note in each file; `is pr-first only` matches zero times.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/release/SKILL.md plugin/skills/release/execute.md
git commit -m "release skill: pass --release-as through to release-local.js under local-merge

Closes ledger row 90 of docs/plans/2026-09-11-release-skill-ledger.md.

refs #2326"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (`bin/release-local.js --release-as`, threaded into `precheck.js`, into the manifest/CHANGELOG writers) — Tasks 1+2 (the writers already consume the shared `version` variable, no separate change needed). Deliverable 2 (`/claude-tweaks:release` Step 1's refusal replaced, Input table + `execute.md` back-stop updated, ledger row 90 closed) — Task 3. Deliverable 3 (tests) — Task 1's `precheck.test.js` additions, Task 2's `cli.test.js` additions. AC 1 — Task 2's `AC 1 (#2326)` test. AC 2 — Task 2's `AC 2 (#2326)` test. AC 3 (`/claude-tweaks:release --as 7.0.0` on a `local-merge` fixture reaches Step 4 with the effective version and the major-bump gate fires) is a skill-prose behavior already implied by SKILL.md's existing "effective version" definition (`--as` when given, otherwise derived) — Task 3's edit keeps that definition intact for local-merge, so no separate code path is needed; there is no existing executable harness for `/claude-tweaks:release`'s own Step 4 console (no `tests/` suite drives the skill prose end-to-end), so this AC is satisfied by inspection of the unchanged "effective version" definition plus Task 2's engine-level exit contract, not by a new test.
- **Placeholders:** none.
- **Type consistency:** `precheck()`'s new `base` return field and `result.usageError` flag (Task 1) are read by name in Task 2's `release-local.js` changes (`check.base`, `check.result.usageError`) — consistent between both tasks.
