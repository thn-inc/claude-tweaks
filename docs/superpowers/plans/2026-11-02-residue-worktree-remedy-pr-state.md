# Residue Worktree Remedy Reflects PR State — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `bin/residue.js`'s worktree probe reports `remedy: auto` only for a worktree whose branch's PR merged or never existed, so no consumer reading the field alone removes a worktree whose PR is open or closed-unmerged.

**Architecture:** `probeWorktrees` gains an injectable `prStateOf(branch)` lookup (same return contract as `plugin/bin/lib/reconcile/pr-state.js`'s `resolvePrState`). It is consulted only for a worktree that would otherwise be `auto` (unlocked, not confirmed dirty). Every answer except a merged PR or a confirmed "no PR" flips the remedy to `record`, and the answer is shown in `evidence`. `bin/residue.js` backs the lookup with reconcile's per-pass `createPrStateResolver`, prefetching all candidate branches in one batched read first.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `gh` CLI (through the existing `pr-state.js`/`pr-state-batch.js` seams only).

**Spec:** `.claude-tweaks/pipelines/2026-11-02T121136-record-4821/work/4821-spec.md`

## Global Constraints

- Remedy vocabulary is fixed: `auto` / `record` (`plugin/bin/lib/residue/finding.js`'s `REMEDIES`); no new value.
- `auto` only for PR state `MERGED` or `null` (no PR for the branch). `OPEN`, `CLOSED`, `'gh-absent'`, `'network-failure'`, and any other string → `record`. This fails closed: a lookup that cannot confirm the PR state never yields `auto`.
- Locked worktrees and `dirty === true` worktrees are already `record`. Never look up their PR state (no extra `gh` call).
- Under `cliScope === 'blast-radius'` the probe still returns before any per-worktree work (#3479). No PR lookup and no prefetch.
- No new `gh` call site. All lookups go through `pr-state.js` (`resolvePrState`, `FETCH_TIMEOUT_MS` bound) or `pr-state-cache.js`'s `createPrStateResolver` (batch through `pr-state-batch.js`, `BATCH_TIMEOUT_MS` bound). Governing-skill rule, quoted from `.claude/skills/gh-api-module-pattern/SKILL.md`: "**Bound every remote-contacting call on the seam; a local-only call owes no bound.** `execFileSync` has no default timeout, so a black-holed remote hangs the caller indefinitely." Both seams already comply. This plan adds no spawn, so the `windowsHide`/path-guard source-scan suites see nothing new (Source-scan lint check: no new `fs.*`/`execFileSync` in `plugin/bin/`).
- `residue.js` stays a read-only reporter. Do NOT call the resolver's `persist()`, because that writes `reconcile-cache.json`. Reading the persisted cache is fine.
- Exit-code contract of `residue.js` is unchanged: 0 on any render (degraded included), 2 on malformed invocation.
- `plugin/skills/tidy/scan-procedures.md` is 52,460 B against `RAIL_BYTES` 52,500. Task 2's edit there must leave it ≤ 52,500 B (the exact text below is +20 B → 52,480 B, 20 B headroom). Verify with `wc -c`.
- Commit messages: `{Verb} {what} — {detail}`, reference `refs #4821` (never `closes`/`fixes`), end with the `Claude-Session:` trailer the controller supplies.

## Review Focus

1. A worktree whose PR lookup fails (`gh` absent, offline) must read `record`, not `auto`, with the reason visible in evidence. This is pinned in Task 1 (`AC1.1` gh-absent/network-failure test).
2. A closed-unmerged PR (failure tombstone) must stay `record`, matching reconcile's `pr-closed-unmerged` skip. Pinned in Task 1.
3. The prefetch must never include the main checkout's branch, this run's own head branch, or a locked worktree's branch. Pinned in Task 1 (`prStateBranches` test).
4. Blast-radius scope must spawn no `gh` call at all, neither prefetch nor lookup. Pinned in Task 1 (blast-radius test counts `prStateOf` calls) and Task 2 (`prStateBranches` returns `[]`, so prefetch never runs).
5. A worktree with no branch (detached HEAD) has nothing to look up. It must not crash, and it must not be reported `auto` on an unknown PR state. Pinned in Task 1: `prStateOf` is not called for a null branch, and the remedy is `record` with `PR: unknown (no branch)`.

---

### Task 1: PR-state-aware remedy in the worktree probe

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/residue/probes/worktrees.js` (`probeWorktrees`, new `prStateBranches`, new `describePrState`, exports, header comment)
- Test: `tests/bin-lib/residue/probes-git.test.js`

**Interfaces:**
- Consumes: `resolvePrState(repoRoot, branch)` from `plugin/bin/lib/reconcile/pr-state.js`. It returns a PR object `{number, state: 'OPEN'|'CLOSED'|'MERGED', …}`, `null` (no PR), or a failure string `'gh-absent'|'network-failure'`.
- Produces:
  - `probeWorktrees({ scope, isPidAlive, isDirty, cliScope, pathImpl, prStateOf })`. `prStateOf(branch) -> PR object | null | string` defaults to `(b) => resolvePrState(scope.worktrees[0].path, b)` (the main checkout is `worktrees[0]`).
  - `prStateBranches({ scope, cliScope }) -> string[]`: the branches `probeWorktrees` may look up. It excludes `worktrees[0]`, a worktree whose `branch === scope.headBranch`, locked worktrees, and branchless ones. It returns `[]` when `!scope || !scope.ran` or `cliScope === 'blast-radius'`, and the result is deduped.
  - `describePrState(pr) -> string`, the evidence segment. Map `MERGED`/`OPEN`/`CLOSED` objects to `#${number} ${state}`, `null` to `none`, a failure string `s` to `unknown (${s})`, and anything else to `unknown (unrecognized answer)`.
  - Export all three alongside the existing exports.

Remedy rule for an unlocked worktree, in order:
1. `dirty === true` → `record`, no lookup, no PR segment in evidence.
2. No branch → `record`, no lookup, evidence segment `PR: unknown (no branch)`.
3. Otherwise `pr = prStateOf(wt.branch)`; `auto` iff `pr === null || (pr && typeof pr === 'object' && pr.state === 'MERGED')`, else `record`.

Unlocked evidence becomes `git worktree list --porcelain: unlocked, branch {b}, dirty: {d}, PR: {describePrState}, {reaper part}`. The PR segment sits **before** the reaper part, so the existing `, in reaper domain$` anchors keep matching. When rule 1 applies, omit the `PR: …, ` segment. Locked evidence is unchanged.

- [ ] **Step 1: Update existing auto-asserting tests and write the failing tests**

Existing tests that assert `remedy: 'auto'` (named "an unlocked worktree in the harness domain is auto-remediable", "an unlocked worktree outside the reaper domain is still auto-remediable", "a confirmed-clean unlocked worktree still auto-remediates…", "an unreadable dirty check (git status failed) does not force record…", "the default (no isDirty override) never crashes…") get `prStateOf: () => null` added to their `probeWorktrees` call, with no other change to their assertions. The remaining SCOPE-based tests ("the main working tree…", "a locked worktree…", "the worktree this session…", "a sibling worktree…", the reaper-domain and blast-radius-equivalence tests) also get `prStateOf: () => null` so the suite never spawns `gh`. In the win32 AC1.1 test, add it to the `probeWorktrees` call.

New tests (append after the "the default (no isDirty override)…" test):

```js
const OPEN_PR = { number: 12, state: 'OPEN' };
const CLOSED_PR = { number: 13, state: 'CLOSED' };
const MERGED_PR = { number: 14, state: 'MERGED' };
const doneOf = (r) => r.findings.find((f) => f.subject === '/repo/.claude/worktrees/done');

test('AC1.1: an unlocked clean worktree whose branch has an open PR routes to record, not auto (#4821)', () => {
  const r = probeWorktrees({ scope: SCOPE, isDirty: () => false, prStateOf: () => OPEN_PR });
  assert.strictEqual(doneOf(r).remedy, 'record');
  assert.match(doneOf(r).evidence, /, PR: #12 OPEN, in reaper domain$/);
  assert.deepStrictEqual(validateFinding(doneOf(r)), []);
});

test('AC1.1: a closed-unmerged PR (failure tombstone) routes to record (#4821)', () => {
  const r = probeWorktrees({ scope: SCOPE, isDirty: () => false, prStateOf: () => CLOSED_PR });
  assert.strictEqual(doneOf(r).remedy, 'record');
  assert.match(doneOf(r).evidence, /PR: #13 CLOSED/);
});

test('AC1.1: a merged PR keeps the worktree auto-remediable (#4821)', () => {
  const r = probeWorktrees({ scope: SCOPE, isDirty: () => false, prStateOf: () => MERGED_PR });
  assert.strictEqual(doneOf(r).remedy, 'auto');
  assert.match(doneOf(r).evidence, /PR: #14 MERGED/);
});

test('AC1.1: a branch with no PR stays auto-remediable (#4821)', () => {
  const r = probeWorktrees({ scope: SCOPE, isDirty: () => false, prStateOf: () => null });
  assert.strictEqual(doneOf(r).remedy, 'auto');
  assert.match(doneOf(r).evidence, /PR: none/);
});

for (const failure of ['gh-absent', 'network-failure']) {
  test(`AC1.1: an unconfirmed PR state (${failure}) fails closed to record (#4821)`, () => {
    const r = probeWorktrees({ scope: SCOPE, isDirty: () => false, prStateOf: () => failure });
    assert.strictEqual(doneOf(r).remedy, 'record');
    assert.match(doneOf(r).evidence, new RegExp(`PR: unknown \\(${failure}\\)`));
  });
}

test('the PR lookup runs only for unlocked, not-confirmed-dirty worktrees, keyed by branch (#4821)', () => {
  const asked = [];
  const isDirty = (p) => p === '/repo/.worktrees/fallback';
  probeWorktrees({ scope: SCOPE, isDirty, prStateOf: (b) => { asked.push(b); return null; } });
  assert.deepStrictEqual(asked, ['worktree-done']);
});

test('a dirty worktree stays record with no PR segment and no lookup (#4821)', () => {
  let calls = 0;
  const r = probeWorktrees({ scope: SCOPE, isDirty: () => true, prStateOf: () => { calls += 1; return MERGED_PR; } });
  assert.strictEqual(calls, 0);
  assert.strictEqual(doneOf(r).remedy, 'record');
  assert.doesNotMatch(doneOf(r).evidence, /PR:/);
});

test('a branchless unlocked worktree is record with PR unknown and no lookup (#4821)', () => {
  let calls = 0;
  const scope = { ...SCOPE, worktrees: [SCOPE.worktrees[0], { path: '/repo/.claude/worktrees/detached', branch: null, locked: false }] };
  const r = probeWorktrees({ scope, isDirty: () => false, prStateOf: () => { calls += 1; return null; } });
  assert.strictEqual(calls, 0);
  assert.strictEqual(r.findings[0].remedy, 'record');
  assert.match(r.findings[0].evidence, /PR: unknown \(no branch\)/);
});

test('under blast-radius no PR lookup runs (#4821)', () => {
  let calls = 0;
  probeWorktrees({ scope: SCOPE, cliScope: 'blast-radius', prStateOf: () => { calls += 1; return null; } });
  assert.strictEqual(calls, 0);
});

test('the default PR lookup against an unreachable main checkout fails closed to record (#4821)', () => {
  const r = probeWorktrees({ scope: SCOPE, isDirty: () => false });
  assert.strictEqual(doneOf(r).remedy, 'record');
  assert.match(doneOf(r).evidence, /PR: unknown \((gh-absent|network-failure)\)/);
});

test('prStateBranches lists only unlocked sibling branches, deduped, and nothing under blast-radius or an unrun scope (#4821)', () => {
  const scope = { ...SCOPE, worktrees: [...SCOPE.worktrees, { path: '/repo/.claude/worktrees/dup', branch: 'worktree-done', locked: false }, { path: '/repo/.claude/worktrees/nob', branch: null, locked: false }] };
  assert.deepStrictEqual(prStateBranches({ scope }), ['worktree-done', 'worktree-fallback']);
  assert.deepStrictEqual(prStateBranches({ scope, cliScope: 'blast-radius' }), []);
  assert.deepStrictEqual(prStateBranches({ scope: { ran: false, worktrees: [] } }), []);
});

test('describePrState renders each answer shape (#4821)', () => {
  assert.strictEqual(describePrState(OPEN_PR), '#12 OPEN');
  assert.strictEqual(describePrState(null), 'none');
  assert.strictEqual(describePrState('gh-absent'), 'unknown (gh-absent)');
  assert.strictEqual(describePrState(undefined), 'unknown (unrecognized answer)');
});
```

Add `prStateBranches, describePrState` to the file's `require` of `probes/worktrees`.

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `node --test tests/bin-lib/residue/probes-git.test.js`
Expected: FAIL after Step 1. The `#4821` tests fail (`prStateBranches is not a function`, or the remedy is `auto` where `record` is expected); the updated pre-existing tests pass.

- [ ] **Step 3: Implement in `plugin/bin/lib/residue/probes/worktrees.js`**

Add `const { resolvePrState } = require('../../reconcile/pr-state');`. Implement the three functions per the Interfaces block. Inside the unlocked branch of `probeWorktrees`, apply the remedy rule in its stated order. Replace the now-false comment above `const remedy = …` with one stating the PR-state rule and why (reconcile's `reap-merged.js` `decideReap` skips `pr-open`/`pr-closed-unmerged`, so a remedy of `auto` there would let a field-only consumer remove live work, #4821). Add one header-comment line naming the PR-state input. Do not require `reap-merged.js`, because it requires this module and that would be a cycle.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/residue/probes-git.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Discrimination check**

Temporarily change the remedy expression to ignore `pr` (`auto` whenever not dirty), then run Step 4's command. Expected: the OPEN, CLOSED, gh-absent, network-failure, branchless, and default-lookup `#4821` tests go red. Restore the line and re-run until it is green. Report the red test names in the task reply.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/residue/probes/worktrees.js tests/bin-lib/residue/probes-git.test.js
git commit -m "Report worktree remedy from PR state — open or closed-unmerged PRs route to record (refs #4821)"
```

### Task 2: Wire a batched PR-state resolver into `residue.js`, sweep prose, prove on real worktrees

**Role:** integration

**Files:**
- Modify: `plugin/bin/residue.js` (`main` becomes async; resolver + prefetch + `prStateOf` passed to `probeWorktrees`; entry point)
- Modify: `plugin/skills/tidy/scan-procedures.md:103`
- Modify: `plugin/skills/wrap-up/residue-sweep.md:94`
- Test: `tests/bin-lib/residue/cli.test.js` (existing suite must stay green; no new test is required, since the wiring is exercised by the real-input probe below)

**Interfaces:**
- Consumes: `prStateBranches({ scope, cliScope })` and `probeWorktrees({ …, prStateOf })` from Task 1; `createPrStateResolver({ root })` from `plugin/bin/lib/reconcile/pr-state-cache.js`, which returns `{ byBranch(b), prefetch({ branches }) }`.
- Produces: nothing new for other tasks.

- [ ] **Step 1: Implement the wiring in `plugin/bin/residue.js`**

In `main`, after `resolveScope`, compute `const prBranches = prStateBranches({ scope, cliScope: opts.scope })`. When it is non-empty:
- create `const prStates = createPrStateResolver({ root: scope.worktrees[0].path })`;
- `await prStates.prefetch({ branches: prBranches })`, wrapped in try/catch, because prefetch is an accelerator and a throw just leaves keys for the per-item path;
- set `prStateOf = (b) => prStates.byBranch(b)`.

Otherwise leave `prStateOf` undefined. That is safe because `probeWorktrees` only looks up branches `prStateBranches` would list. Pass `prStateOf` into the existing `probeWorktrees({ scope, cliScope: opts.scope, prStateOf })` call. Make `main` `async`. Change the entry line to `if (require.main === module) main().catch((err) => { process.stderr.write(\`residue.js: ${err && err.message ? err.message : err}\n\`); process.exitCode = 1; });`. Never call `prStates.persist()` (Global Constraints).

- [ ] **Step 2: Sweep the two prose sites**

`plugin/skills/tidy/scan-procedures.md` line 103: replace
`, and reaper-domain membership; replaces \`git worktree list\` one-for-one. Under \`ran: false\` treat worktrees as **\`unknown\`**, not clean — an empty \`findings\` array there is never "no worktrees."`
with
`, the branch's PR, and reaper-domain membership; \`remedy: auto\` only when that PR merged or none exists. Under \`ran: false\` treat worktrees as **\`unknown\`**, not clean — an empty \`findings\` is never "no worktrees."`

`plugin/skills/wrap-up/residue-sweep.md` line 94: replace `(an unlocked stale worktree,` with `(an unlocked stale worktree whose branch's PR merged or never existed,`. The reflow of the following lines is up to the implementer; keep the line length near its neighbours.

Run: `wc -c plugin/skills/tidy/scan-procedures.md`
Expected: `52480` (must be ≤ 52500).

- [ ] **Step 3: Run the residue suites**

Run: `node --test tests/bin-lib/residue/`
Expected: PASS, 0 failures.

- [ ] **Step 4: Real-input probe on this repo's own worktrees (AC evidence)**

Baseline, captured at plan time against `origin/main` 327e20400 from this worktree: `node plugin/bin/residue.js --base HEAD --scope repo --no-suite --json` reported 52 `kind: worktree` findings, 48 `auto` and 4 `record` (2 locked), with no PR segment.

Run the same command after the change, writing to `$PIPELINE_RUN_DIR/evidence/residue-worktrees-after.json`. Use the absolute run-dir path from the controller and a plain Bash redirect, after `mkdir -p` on `$PIPELINE_RUN_DIR/evidence`. Count findings by remedy and by PR answer (`OPEN`/`CLOSED`/`MERGED`/`none`/`unknown`) with a scratch node script. Then reconcile against an independent count over the same worktrees: for each finding's branch, `gh pr list --head {branch} --state all --json number,state`. Expected: every finding with an OPEN or CLOSED governing PR is `record`. `auto` appears only on `MERGED`/`none`. The two counts agree per branch.

Log one `decisions.md` entry with `node "{plugin-root}/bin/log-decision.js" --run "{run-dir}" --section "/build" --status AUTO --step "AC evidence" --text-file "{text-file}"`. The text file holds one line: `AC1.1 (a test reproduces open-PR worktrees marked auto and passes after the change): residue.js --scope repo on this repo's worktrees — before 48 auto / 52; after {N} auto ({breakdown by PR answer}); independent gh pr list count agrees on {M}/{M} branches; full output {run-dir}/evidence/residue-worktrees-after.json`.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/residue.js plugin/skills/tidy/scan-procedures.md plugin/skills/wrap-up/residue-sweep.md
git commit -m "Back residue worktree remedy with batched PR-state lookups — prefetch candidates, sweep remedy prose (refs #4821)"
```

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (remedy reflects PR state) | Task 1 (rule), Task 2 (live resolver) |
| AC1.1 (a test reproduces the behavior and passes after the change) | Task 1 `AC1.1:` tests + Step 5 discrimination; Task 2 Step 4 real-input evidence |
| Release Note | PR body (no code) |
