# Unknown-Relation Stop Card Rendered in Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `formatStopCard` renders the adopted-branch "relation could not be determined" stop card from a `reason` option, and the collision check's runnable command prints `card` for both stop cases.

**Architecture:** `formatStopCard({ branch, remoteSha, prLookup, reason })` keeps its heading and three options; when `reason` is set, the second paragraph says the relation to this worktree's history could not be determined (naming the reason) instead of claiming the commit is outside it. The fenced command in `adopted-branch-collision-check.md` adds `card` when `state === 'foreign'` or (`state === 'unreachable'` and `remoteSha` is set), passing `reason` only for the unreachable case. Its prose items 3 and 4 say the command prints the card for both.

**Tech Stack:** Node 18+, `node --test`, bash (extract-and-run fixture test).

**Spec:** `.claude-tweaks/pipelines/2026-10-10T143833-spec-3093-3094-3087/spec-3093/work/3093-spec.md`

## Global Constraints

- `formatStopCard`'s existing call shape (`{ branch, remoteSha, prLookup }`) and output stay byte-identical when `reason` is absent — `tests/adopted-branch-collision-prose-conformance.test.js:52` pins the documented card against it.
- The fenced command stays an unquoted `<<NODE_EVAL_EOF` heredoc whose JS body contains no `$`, backtick or backslash other than `${CLAUDE_PLUGIN_ROOT}` (the shell expands the body, #3091).
- `plugin/skills/build/adopted-branch-collision-check.md` is 5958 B — far from the 46080 B ceiling.
- Commit style `{Verb} {what} — {detail}`, ending with `Claude-Session: https://claude.ai/code/session_01TTWaqgMumX4GGXgtA8CkKa`.

## Review Focus

- **`unreachable` with `remoteSha` null** (`ls-remote-failed`, `no-output`) must still carry no card — it fails open. Pinned by the stub-root test's second case.
- **The `foreign` card is unchanged** — pinned by the existing unit test and prose-conformance test.

---

### Task 1: `reason` option on `formatStopCard`, card printed for both stop cases

**Files:**
- Modify: `plugin/bin/lib/worktree/remote-branch-collision.js:142-156`
- Modify: `plugin/skills/build/adopted-branch-collision-check.md:33-42` (fenced command) and `:57-66` (items 3-4 prose)
- Test: `tests/bin-lib/worktree/remote-branch-collision.test.js` (append after line 143)
- Test: `tests/adopted-branch-collision-snippet-fixture.test.js` (append a test)

**Interfaces:**
- Produces: `formatStopCard({ branch, remoteSha, prLookup, reason })` — `reason` optional string; returns the card markdown.

- [ ] **Step 1: Write the failing tests**

Append to `tests/bin-lib/worktree/remote-branch-collision.test.js`, after the `formatStopCard: names the branch…` test:

```js
test('formatStopCard with a reason: names it and does not claim the commit is outside HEAD\'s history (#3093)', () => {
  const card = formatStopCard({ branch: 'b', remoteSha: SHA_A, prLookup: { ok: true, prs: [] }, reason: 'fetch-failed' });
  assert.match(card, /^## Build: Adopted branch collides with an unrelated branch on origin/);
  assert.match(card, /could not be determined \(`fetch-failed`\)/);
  assert.doesNotMatch(card, /is not in this worktree's history/);
  assert.match(card, /no PR found/);
  assert.match(card, /git branch -m b-\{suffix\}/);
});
```

Append to `tests/adopted-branch-collision-snippet-fixture.test.js`:

```js
// A stub plugin root: the real node-eval-file.js and the real formatStopCard, with
// classifyRemoteBranch pinned to an `unreachable` result — the one state a fixture repo
// cannot produce on demand (a fetch that fails after ls-remote succeeds).
function stubPluginRoot(t, result) {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'adopted-branch-stub-root-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'bin', 'lib', 'worktree'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'plugin', 'bin', 'node-eval-file.js'), path.join(dir, 'bin', 'node-eval-file.js'));
  const real = path.join(ROOT, 'plugin', 'bin', 'lib', 'worktree', 'remote-branch-collision.js').split(path.sep).join('/');
  fs.writeFileSync(path.join(dir, 'bin', 'lib', 'worktree', 'remote-branch-collision.js'), [
    `const real = require(${JSON.stringify(real)});`,
    `module.exports = { ...real, classifyRemoteBranch: () => (${JSON.stringify(result)}), findPrsForBranch: () => ({ ok: true, prs: [] }) };`,
  ].join('\n'));
  return dir.split(path.sep).join('/');
}

test('the snippet prints the unknown-relation card for unreachable with remoteSha set, and no card without one (#3093)', (t) => {
  const r = originWithTwoClones('adopted-branch-unreachable-');
  t.after(() => fs.rmSync(r.root, { recursive: true, force: true }));
  r.run(r.work, ['checkout', '-q', '-b', 'worktree-record-2']);
  const run = (result) => {
    const stdout = execFileSync('bash', ['-c', extractSnippet()], {
      cwd: r.work, timeout: 60000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...r.env, CLAUDE_PLUGIN_ROOT: stubPluginRoot(t, result) },
    });
    return JSON.parse(stdout.trim());
  };
  const sha = 'c19a97b7a4ff1b8e9ff51f5834326eaabbd189b5';
  const known = run({ state: 'unreachable', reason: 'fetch-failed', remoteSha: sha });
  assert.strictEqual(known.state, 'unreachable');
  assert.match(known.card, /`worktree-record-2` already exists on `origin` at `c19a97b7a`/);
  assert.match(known.card, /could not be determined \(`fetch-failed`\)/);
  assert.doesNotMatch(known.card, /is not in this worktree's history/);
  const unknown = run({ state: 'unreachable', reason: 'ls-remote-failed', remoteSha: null });
  assert.strictEqual(unknown.card, undefined, 'unreachable without a remoteSha fails open — no stop card');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/worktree/remote-branch-collision.test.js tests/adopted-branch-collision-snippet-fixture.test.js`
Expected: FAIL — the unit test finds `is not in this worktree's history` (no `reason` support); the snippet test finds `known.card` undefined.

- [ ] **Step 3: Implement `reason` in `formatStopCard`**

Replace `remote-branch-collision.js:142-156` with:

```js
// `reason` set → the unknown-relation card (`unreachable` with a remoteSha:
// fetch-failed / ancestry-check-failed, adopted-branch-collision-check.md item 3):
// the branch is confirmed on origin but its relation to HEAD could not be
// determined, so the card must not claim the commit is outside HEAD's history.
function formatStopCard({ branch, remoteSha, prLookup, reason }) {
  const short = String(remoteSha || '').slice(0, 9);
  const relation = reason
    ? `its relation to this worktree's history could not be determined (\`${reason}\`)`
    : "that commit is not in this worktree's history";
  const outcome = reason ? 'may be rejected' : 'would be rejected';
  return [
    '## Build: Adopted branch collides with an unrelated branch on origin',
    '',
    `\`${branch}\` already exists on \`origin\` at \`${short}\`, and ${relation} — ` +
      `${describePrs(prLookup)}. Pushing this branch ${outcome} non-fast-forward.`,
    '',
    `Options: (1) rename this worktree's local branch (\`git branch -m ${branch}-{suffix}\`) and ` +
      're-run, (2) delete the stale remote branch ' +
      `(\`git push origin --delete ${branch}\`) and re-run, (3) stop and resume the existing ` +
      'remote branch/PR instead.',
  ].join('\n');
}
```

Confirm the no-`reason` output is byte-identical to before (same words, same `would be rejected`).

- [ ] **Step 4: Print the card for both stop cases**

In `adopted-branch-collision-check.md`'s fenced command, replace

```
if (r.state === 'foreign') {
  out.card = m.formatStopCard({ branch, remoteSha: r.remoteSha, prLookup: repo ? m.findPrsForBranch({ branch, repo }) : null });
}
```

with

```
if (r.state === 'foreign' || (r.state === 'unreachable' && r.remoteSha)) {
  const reason = r.state === 'foreign' ? null : r.reason;
  out.card = m.formatStopCard({ branch, remoteSha: r.remoteSha, prLookup: repo ? m.findPrsForBranch({ branch, repo }) : null, reason });
}
```

In item 3's `remoteSha` set bullet, replace "Stop as for `foreign` (item 4), stating in the card that the relation could not be determined (`{reason}`) rather than that the commit is not in this worktree's history." with "Stop as for `foreign` (item 4) — the command prints this case's `card` too, stating that the relation could not be determined (`{reason}`) rather than that the commit is not in this worktree's history."

In item 4, replace "(`formatStopCard` — the command above prints it as `card`)" with "(`formatStopCard` — the command above prints it as `card`, for this case and item 3's)".

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/worktree/remote-branch-collision.test.js tests/adopted-branch-collision-snippet-fixture.test.js tests/adopted-branch-collision-prose-conformance.test.js`
Expected: PASS, all.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/worktree/remote-branch-collision.js plugin/skills/build/adopted-branch-collision-check.md tests/bin-lib/worktree/remote-branch-collision.test.js tests/adopted-branch-collision-snippet-fixture.test.js
git commit -m "Render the adopted-branch unknown-relation stop card in code — formatStopCard reason option, card printed for both stop cases (#3093)

Claude-Session: https://claude.ai/code/session_01TTWaqgMumX4GGXgtA8CkKa"
```
