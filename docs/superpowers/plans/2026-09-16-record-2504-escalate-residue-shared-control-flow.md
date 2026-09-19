# escalate-residue.js Shared Control-Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the real, mechanical duplication across `escalate-residue.js`'s four escalate/resolve functions (the find-issue + error-handling + no-hit/not-found skeleton, byte-identical across all four) behind two small shared helpers, without forcing the genuinely divergent per-hit branching (2-way dedup-hit/reopen for the single-path residue variants vs. 3-way dedup-hit/append/reopen for the multi-path structurally-stuck variants) into one shape — and document in code why that divergent remainder deliberately stays split.

**Architecture:** Extract `findOrCreateIssue({ repo, marker, runner, createArgs, onHit })` (used by `escalateResidue`/`escalateStructurallyStuck`) and `findHitForResolve({ repo, marker, runner, onHit })` (used by `resolveResidue`/`resolveStructurallyStuck`) — each owns the no-repo guard, the `findResidueDuplicate` try/catch, and (for the escalate helper) the no-hit create-issue call; each hands a found hit to the caller's `onHit` callback for the reason-specific accept/append/reopen/close logic, which stays in the four original functions unchanged. No behavior change — every existing test in `tests/bin-lib/reconcile/escalate-residue.test.js` must still pass unmodified, since the AC treats that suite as the acceptance test.

**Tech Stack:** Node.js (CommonJS), `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-09-16T084657-record-2504/work/2504-spec.md` (materialized from issue #2504).

## Global Constraints

- No behavior change: `tests/bin-lib/reconcile/escalate-residue.test.js` passes unmodified — do not edit that file.
- No new dependencies; no new exports needed (the new helpers are internal, not part of the module's public API surface at `module.exports`).
- Preserve exact argv shapes passed to `runner(...)` for every `gh issue ...` call (tests assert on `calls[i][1]`/`calls[i][2]` and on `--body` argument content) — a reordered or renamed flag would flip a green test red even with identical net effect.
- Match the project's existing style in this file: `'use strict'`, CommonJS `require`/`module.exports`, comments explaining *why* above non-obvious blocks (this file already does this extensively).

---

### Task 1: Extract shared find-hit helpers and route the four functions through them

**Files:**
- Modify: `plugin/bin/lib/reconcile/escalate-residue.js:151-306` (the four functions `escalateStructurallyStuck`, `escalateResidue`, `resolveStructurallyStuck`, `resolveResidue`)
- Test: `tests/bin-lib/reconcile/escalate-residue.test.js` (existing suite, unmodified — run only, not written)

**Interfaces:**
- Consumes: `findResidueDuplicate({ repo, marker, runner })` (already defined, line 102, unchanged), `errorText` (imported, unchanged), `parseStuckPaths`/`structurallyStuckBody`/`structurallyStuckMarker`/`residueBody`/`residueFingerprint` (already defined, unchanged).
- Produces: two new internal (non-exported) helpers other tasks/files never need to know about:
  - `findOrCreateIssue({ repo, marker, runner, createArgs, onHit }) -> result object` — `createArgs` is the tail of the `gh issue create` argv (everything after `--repo {repo}`, e.g. `['--title', t, '--body', b, '--label', 'bug']`); `onHit(hit)` returns the same shape as `findOrCreateIssue` itself.
  - `findHitForResolve({ repo, marker, runner, onHit }) -> result object` — `onHit(hit)` returns the same shape as `findHitForResolve` itself.

- [ ] **Step 1: Run the existing suite to confirm current green baseline**

Run: `node --test tests/bin-lib/reconcile/escalate-residue.test.js`
Expected: PASS (all 17 tests) — this is the baseline the refactor must not break. Not a TDD red step (no new behavior is being added — this is a pure internal refactor), so there is no "Expected: FAIL" step for this task.

- [ ] **Step 2: Add the two shared helpers**

Insert immediately above `function escalateStructurallyStuck(...)` (currently line 151), replacing nothing yet:

```javascript
// Shared find-hit skeleton for the two escalate* functions below: resolve
// the no-repo guard and the findResidueDuplicate try/catch once, then either
// create a fresh issue (no hit) or hand the found hit to the caller's onHit
// for the reason-specific accept/append/reopen logic. That per-hit logic is
// deliberately NOT folded in here — escalateResidue's hit branch is a plain
// 2-way dedup-hit/reopen split, escalateStructurallyStuck's is a 3-way
// dedup-hit/append/reopen split over a multi-path body it has to parse and
// re-render first (see that function's own header comment) — forcing those
// two shapes through one callback would trade real duplication (this
// skeleton) for fake unification (a callback with reason-specific branches
// inside it, no clearer than leaving the two functions separate).
function findOrCreateIssue({
  repo, marker, runner, createArgs, onHit,
}) {
  if (!repo) return { status: 'escalation-failed', reason: 'no-repo-slug' };
  let hit;
  try {
    hit = findResidueDuplicate({ repo, marker, runner });
  } catch (err) {
    return { status: 'escalation-failed', reason: errorText(err) };
  }
  if (!hit) {
    try {
      const out = runner(['issue', 'create', '--repo', repo, ...createArgs]);
      const m = /\/issues\/(\d+)/.exec(String(out));
      return { status: 'filed', number: m ? Number(m[1]) : null };
    } catch (err) {
      return { status: 'escalation-failed', reason: errorText(err) };
    }
  }
  return onHit(hit);
}

// Shared find-hit skeleton for the two resolve* functions below — same
// rationale as findOrCreateIssue above, minus the create branch (resolve
// never files a new issue) and with the resolution-failed/not-found status
// vocabulary instead of escalation-failed/filed.
function findHitForResolve({
  repo, marker, runner, onHit,
}) {
  if (!repo) return { status: 'resolution-failed', reason: 'no-repo-slug' };
  let hit;
  try {
    hit = findResidueDuplicate({ repo, marker, runner });
  } catch (err) {
    return { status: 'resolution-failed', reason: errorText(err) };
  }
  if (!hit) return { status: 'not-found' };
  return onHit(hit);
}

```

- [ ] **Step 3: Rewrite `escalateStructurallyStuck` to route through `findOrCreateIssue`**

Replace the existing `escalateStructurallyStuck` function body (currently lines 151-201, from `function escalateStructurallyStuck({ repo, targetPath, runner = defaultRunner }) {` through its closing `}`) with:

```javascript
function escalateStructurallyStuck({ repo, targetPath, runner = defaultRunner }) {
  const marker = structurallyStuckMarker();
  return findOrCreateIssue({
    repo,
    marker,
    runner,
    createArgs: ['--title', 'reconcile: structurally-stuck run directories', '--body', structurallyStuckBody([targetPath]), '--label', 'bug'],
    onHit: (hit) => {
      const existingPaths = parseStuckPaths(hit.body);
      const alreadyNamed = existingPaths.includes(targetPath);
      const updatedPaths = alreadyNamed ? existingPaths : [...existingPaths, targetPath];

      if (hit.state !== 'CLOSED') {
        if (alreadyNamed) return { status: 'dedup-hit', number: hit.number };
        try {
          runner(['issue', 'edit', String(hit.number), '--repo', repo, '--body', structurallyStuckBody(updatedPaths)]);
          runner(['issue', 'comment', String(hit.number), '--repo', repo, '--body', `Also stuck: \`${targetPath}\``]);
          return { status: 'appended', number: hit.number };
        } catch (err) {
          return { status: 'escalation-failed', reason: errorText(err), number: hit.number };
        }
      }

      try {
        runner(['issue', 'edit', String(hit.number), '--repo', repo, '--body', structurallyStuckBody(updatedPaths)]);
        runner(['issue', 'comment', String(hit.number), '--repo', repo, '--body',
          `Reconcile is seeing \`${targetPath}\` stuck at structurally-stuck again — reopening rather than filing a duplicate.`]);
        runner(['issue', 'reopen', String(hit.number), '--repo', repo]);
        return { status: 'reopened', number: hit.number };
      } catch (err) {
        return { status: 'escalation-failed', reason: errorText(err), number: hit.number };
      }
    },
  });
}
```

- [ ] **Step 4: Rewrite `escalateResidue`'s non-`structurally-stuck` branch to route through `findOrCreateIssue`**

Replace the existing `escalateResidue` function body (currently lines 203-237) with:

```javascript
function escalateResidue({
  repo, reason, targetPath, count, firstFailedAt, lastError, runner = defaultRunner,
}) {
  if (reason === 'structurally-stuck') return escalateStructurallyStuck({ repo, targetPath, runner });
  const { body, marker } = residueBody({
    reason, targetPath, count, firstFailedAt, lastError,
  });
  const title = `reconcile: ${reason} stuck on ${targetPath}`;

  return findOrCreateIssue({
    repo,
    marker,
    runner,
    createArgs: ['--title', title, '--body', body, '--label', 'bug'],
    onHit: (hit) => {
      if (hit.state !== 'CLOSED') return { status: 'dedup-hit', number: hit.number };
      try {
        runner(['issue', 'comment', String(hit.number), '--repo', repo, '--body',
          `Reconcile is seeing this path fail \`${reason}\` again (${count} consecutive passes since it was `
          + 'last resolved) — reopening rather than filing a duplicate.']);
        runner(['issue', 'reopen', String(hit.number), '--repo', repo]);
        return { status: 'reopened', number: hit.number };
      } catch (err) {
        return { status: 'escalation-failed', reason: errorText(err), number: hit.number };
      }
    },
  });
}
```

Note: `!repo` no longer short-circuits before `residueBody`/`title` are computed — `residueBody` is a pure string-building function with no side effects (it does not call `runner`), so computing it when `repo` is null/falsy changes nothing observable; `findOrCreateIssue`'s own no-repo guard still returns `escalation-failed`/`no-repo-slug` without ever calling `runner`, exactly as before.

- [ ] **Step 5: Rewrite `resolveStructurallyStuck` to route through `findHitForResolve`**

Replace the existing `resolveStructurallyStuck` function body (currently lines 253-282) with:

```javascript
function resolveStructurallyStuck({ repo, targetPath, runner = defaultRunner }) {
  const marker = structurallyStuckMarker();
  return findHitForResolve({
    repo,
    marker,
    runner,
    onHit: (hit) => {
      const existingPaths = parseStuckPaths(hit.body);
      if (!existingPaths.includes(targetPath)) return { status: 'not-found' };
      if (hit.state === 'CLOSED') return { status: 'already-closed', number: hit.number };
      const remaining = existingPaths.filter((p) => p !== targetPath);
      try {
        runner(['issue', 'edit', String(hit.number), '--repo', repo, '--body', structurallyStuckBody(remaining)]);
        if (remaining.length === 0) {
          runner(['issue', 'comment', String(hit.number), '--repo', repo, '--body',
            `\`${targetPath}\` no longer exists on disk — the last remaining stuck path. Closing.`]);
          runner(['issue', 'close', String(hit.number), '--repo', repo]);
          return { status: 'closed', number: hit.number };
        }
        runner(['issue', 'comment', String(hit.number), '--repo', repo, '--body',
          `\`${targetPath}\` no longer exists on disk — resolved by other means, removed from the stuck-paths list `
          + `(${remaining.length} path(s) still stuck).`]);
        return { status: 'path-removed', number: hit.number };
      } catch (err) {
        return { status: 'resolution-failed', reason: errorText(err), number: hit.number };
      }
    },
  });
}
```

- [ ] **Step 6: Rewrite `resolveResidue`'s non-`structurally-stuck` branch to route through `findHitForResolve`**

Replace the existing `resolveResidue` function body (currently lines 286-306) with:

```javascript
function resolveResidue({
  repo, reason, targetPath, runner = defaultRunner,
}) {
  if (reason === 'structurally-stuck') return resolveStructurallyStuck({ repo, targetPath, runner });
  const marker = `<!-- fingerprint: ${residueFingerprint(reason, targetPath)} -->`;
  return findHitForResolve({
    repo,
    marker,
    runner,
    onHit: (hit) => {
      if (hit.state === 'CLOSED') return { status: 'already-closed', number: hit.number };
      try {
        runner(['issue', 'comment', String(hit.number), '--repo', repo, '--body', 'This path no longer exists on disk — resolved by other means. Closing.']);
        runner(['issue', 'close', String(hit.number), '--repo', repo]);
        return { status: 'closed', number: hit.number };
      } catch (err) {
        return { status: 'resolution-failed', reason: errorText(err), number: hit.number };
      }
    },
  });
}
```

- [ ] **Step 7: Run the existing suite to verify no behavior changed**

Run: `node --test tests/bin-lib/reconcile/escalate-residue.test.js`
Expected: PASS (all 17 tests, unmodified) — this is the acceptance criterion. Read the output; do not proceed to commit on anything short of full pass.

- [ ] **Step 8: Run the full project suite (targeted directory + full `npm test`) to confirm no cross-file regression**

Run: `node --test tests/bin-lib/reconcile/` then `npm test`
Expected: PASS — the reconcile directory suite and the full repo suite both green. (`npm test` runs the full `tests/` glob per this repo's `CLAUDE.md`; a failure count that varies run-to-run on byte-identical code is machine load, not a regression — re-run only the affected file(s) in isolation before concluding anything is broken, per `CLAUDE.md`'s own note.)

- [ ] **Step 9: Commit**

```bash
git add plugin/bin/lib/reconcile/escalate-residue.js
git commit -m "escalate-residue.js: unify find/error/no-hit skeleton across escalate/resolve functions, keep divergent hit-branching split

refs #2504"
```
