# First-Call Materialize Check (#2775) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/claude-tweaks:dispatch`'s two-call gate refuse to dispatch a group's second (`review,polish,wrap-up`) call unless every group member's materialized spec header exists, so a group build can never reach its second call with an empty `work/` directory.

**Architecture:** `plugin/bin/lib/dispatch/first-call-artifact-check.js`'s `checkFirstCallArtifacts` (#2837) already re-derives the first call's run-state/config/claim/PR artifacts from raw state at the gate between calls. Add a fifth check: per member `n`, a readable `{n}-spec.md` header at `work/{n}-spec.md` or `spec-{n}/work/{n}-spec.md`, looked up in the run dir and in its worktree mirror — the exact two directory shapes and the same mirror rule `plugin/bin/lib/wrap-up/pack.js`'s `resolveRecords` ladder reads (the reader whose failure is #2775's symptom). Reuse `pack.js`'s `worktreeMirror` by exporting it rather than re-deriving it.

**Tech Stack:** Node 18+, `node --test`, no npm deps.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T172750-spec-2775-2733-2677/spec-2775/work/2775-spec.md`

## Global Constraints

- Plugin ships zero runtime npm deps; tests use `node:test` + `node:assert/strict` only.
- Injectable-runner seam: the new check reads through the existing `readFile` dep, so tests use a real tmp dir exactly like the neighbouring tests (no new dep).
- Intermediate commit messages reference the record as `refs #2775` — never `closes`/`fixes`.
- Commit style: `{Verb} {what} — {detail}`, ending with `Claude-Session: https://claude.ai/code/session_01VBD5AMkgdrgmr515Fn6fVb`.

## Investigation findings (fold into the PR description)

- **Deliverable 2 is already satisfied at base.** `plugin/bin/lib/log-decision/claim-log.js`'s `hasClaimLogFor` accepts both the documented per-target `Step 2.8: claimed #{n}` line and the batch `Step 2.8: Claimed all N targets under run …` summary (`BATCH_LOG_RE`, landed in a5f50c117 / #2861 on 2026-10-04 — after the 2026-09-22 incident run this record was filed from). `flow/claim-targets.md` mandates the per-target form. No code change for D2.
- **Deliverable 1's remaining gap.** Since the incident, a dispatched bundle runs `/flow "#a,#b" build,test`, whose multi-spec path materializes each record inside its own `/build`, and `pack.js`'s ladder reads the worktree mirror (#2391). But nothing mechanically confirms materialization happened before the second call: the bookkeeping-stamps gate keys *on* a materialize commit (so a run that never materializes is never gated), and `checkFirstCallArtifacts` checks run-state/config/claims/PR only. A first call that hand-rolls the build (the incident shape) still clears the gate.

## Gate-over-producers trace

Every producer of a dispatched group's materialized header, traced against check 5's two shapes:

| Producer | Writes | Covered by |
|---|---|---|
| Singleton group: `PIPELINE_RUN_DIR="{run}" /flow #n build,test` → `/build` Spec Step 1 (`materialize.js --run-dir {worktree-mirror of run}`) | `{mirror}/work/{n}-spec.md` | shape 1 via mirror |
| Bundle: `/flow "#a,#b" build,test` → multi-spec per-record `/build` (`--run-dir {mirror}/spec-{n}`, no slug — `materialize.md` #2294) | `{mirror}/spec-{n}/work/{n}-spec.md` | shape 2 via mirror |
| Bundle via `materialize.js --multi-record-slug n` (`dispatch/task-prompt.md` table, MCP path) | `{run}/spec-{n}/work/{n}-spec.md` (or its mirror) | shape 2 |
| `current-branch` run (no `worktree` in run-state) | `{run}/work/…` or `{run}/spec-{n}/work/…` in the run dir itself | `bases` always includes `runDir` |
| `OUTCOME: already-shipped` (no materialize commit by design, #2502) | nothing | never reaches this gate — `two-call-gate.md` section 2 routes it to section 7 before the artifact check |

## Real-input probe (run after Task 1, before the whole-branch review)

Task 1 also exports `hasMaterializedHeader` and `headerBases` so they can be probed against real run dirs. Run, and record the printed output in the build's decisions.md:

```bash
node -e "const m=require('./plugin/bin/lib/dispatch/first-call-artifact-check.js');const fs=require('fs');const R='/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/';const live=R+'2026-10-16T172750-spec-2775-2733-2677';const rs=JSON.parse(fs.readFileSync(live+'/run-state.json','utf8'));const b=m.headerBases(live,rs);console.log('live 2775',m.hasMaterializedHeader(m.defaultReadFile,b,2775),'live 2677',m.hasMaterializedHeader(m.defaultReadFile,b,2677));const arc=R+'archive/2026-09-22T143002-record-2269';const b2=m.headerBases(arc,null);console.log('archive',[2269,2624,2655,2671,2672].map(n=>n+':'+m.hasMaterializedHeader(m.defaultReadFile,b2,n)).join(' '))"
```

Expected: `live 2775 true live 2677 false` (2775's header is committed only in this run's worktree mirror; 2677 is not yet materialized), and `archive` all `true` (the incident run's backfilled `spec-{n}/work/` headers). Independent count: `ls .claude-tweaks/pipelines/2026-10-16T172750-spec-2775-2733-2677/spec-*/work/` in the worktree, and `ls` of the archive's `spec-*/work/` — the `true` set must equal the files listed.

## Review Focus

1. A multi-record group whose headers live under `spec-{n}/work/` (not `work/`) — must pass.
2. Headers committed only on the feature branch (exist in the worktree mirror, not the main-checkout run dir) — must pass; this is the real pr-first shape.
3. One member of a group materialized, another not — must fail naming the missing member, not pass on the first hit.
4. A header file whose `record:` frontmatter names a different number than its filename — must not count for the filename's record.
5. `run-state.json` with no `worktree` field (current-branch run) — must still check the run dir itself and not throw.

---

### Task 1: Materialized-header check in `checkFirstCallArtifacts`

**Files:**
- Modify: `plugin/bin/lib/wrap-up/pack.js` (export `worktreeMirror` — one-word addition to the `module.exports` block at the end of the file)
- Modify: `plugin/bin/lib/dispatch/first-call-artifact-check.js` (header comment check list; new check after the pr-first block; require `worktreeMirror`)
- Test: `tests/bin-lib/dispatch/first-call-artifact-check.test.js`

**Interfaces:**
- Consumes: `worktreeMirror(runDir, worktree) -> string|null` from `plugin/bin/lib/wrap-up/pack.js` (existing function, newly exported).
- Produces: `checkFirstCallArtifacts` gains failure `{ ok: false, reason: 'materialized-header-missing', message }`; the `{ ok: true }` shape is unchanged.

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/dispatch/first-call-artifact-check.test.js`, add a helper after `writeRunDir`:

```js
function writeHeader(baseDir, relDir, n, recordLine = `record: ${n}`) {
  const dir = path.join(baseDir, relDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${n}-spec.md`), `---\n${recordLine}\n---\n# ${n}: title\n`);
}
```

Update the existing happy-path test (`'fully-formed pr-first run passes: …'`) to write a header before calling the check — add `writeHeader(runDir, 'work', 2806);` right after its `writeRunDir(...)` call.

Append these tests at the end of the file:

```js
function localMergeGroup(runDir, issueNumbers, runState = {}) {
  writeRunDir(runDir, { runState, config: 'integration-model: local-merge\n' });
  const claims = Object.fromEntries(issueNumbers.map((n) => [n, liveClaimContent(RUN_ID)]));
  return { ghApi: fakeGhApi(claims), now: NOW };
}

test('fails materialized-header-missing when a member has no header anywhere (#2775)', () => {
  const runDir = mkRunDir();
  const deps = localMergeGroup(runDir, [2806]);
  const result = checkFirstCallArtifacts({ runDir, issueNumbers: [2806], repoSlug: REPO_SLUG }, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'materialized-header-missing');
  assert.match(result.message, /#2806/);
});

test('passes for a multi-record group whose headers live under spec-{n}/work/ (#2775)', () => {
  const runDir = mkRunDir();
  const deps = localMergeGroup(runDir, [2806, 2807]);
  writeHeader(runDir, path.join('spec-2806', 'work'), 2806);
  writeHeader(runDir, path.join('spec-2807', 'work'), 2807);
  const result = checkFirstCallArtifacts({ runDir, issueNumbers: [2806, 2807], repoSlug: REPO_SLUG }, deps);
  assert.deepEqual(result, { ok: true });
});

test('fails naming the one unmaterialized member of an otherwise-materialized group (#2775)', () => {
  const runDir = mkRunDir();
  const deps = localMergeGroup(runDir, [2806, 2807]);
  writeHeader(runDir, path.join('spec-2806', 'work'), 2806);
  const result = checkFirstCallArtifacts({ runDir, issueNumbers: [2806, 2807], repoSlug: REPO_SLUG }, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'materialized-header-missing');
  assert.match(result.message, /#2807/);
  assert.doesNotMatch(result.message, /#2806/);
});

test('passes when headers exist only in the worktree mirror of the run dir (pr-first shape, #2775)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-first-call-mirror-'));
  const runDir = path.join(root, 'main', '.claude-tweaks', 'pipelines', RUN_ID);
  const worktree = path.join(root, 'wt');
  const deps = localMergeGroup(runDir, [2806], { worktree });
  writeHeader(path.join(worktree, '.claude-tweaks', 'pipelines', RUN_ID), path.join('spec-2806', 'work'), 2806);
  const result = checkFirstCallArtifacts({ runDir, issueNumbers: [2806], repoSlug: REPO_SLUG }, deps);
  assert.deepEqual(result, { ok: true });
});

test('a header whose record: line names a different number does not count (#2775)', () => {
  const runDir = mkRunDir();
  const deps = localMergeGroup(runDir, [2806]);
  writeHeader(runDir, 'work', 2806, 'record: 9999');
  const result = checkFirstCallArtifacts({ runDir, issueNumbers: [2806], repoSlug: REPO_SLUG }, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'materialized-header-missing');
});
```

(Review Focus 5 — no `worktree` field — is exercised by the first three new tests: `localMergeGroup` defaults `runState` to `{}`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/dispatch/first-call-artifact-check.test.js`
Expected: FAIL — the three `materialized-header-missing` tests fail (the check does not exist yet, so `result.ok` is `true`); the two passing-shape tests and the updated happy path already pass.

- [ ] **Step 3: Export `worktreeMirror` from pack.js**

In `plugin/bin/lib/wrap-up/pack.js`, change the `module.exports` block to:

```js
module.exports = {
  gatherPack, resolveInputs, wrapProbe, withTimeout, parseLedger, PROBE_NAMES, resolveRecords, headerRecords, worktreeMirror,
};
```

- [ ] **Step 4: Implement the check**

In `plugin/bin/lib/dispatch/first-call-artifact-check.js`:

Add to the requires: `const { worktreeMirror } = require('../wrap-up/pack');`

Extend the check-list comment above `checkFirstCallArtifacts` with:

```js
//   5. Every member of `issueNumbers` has a materialized header (#2775): a readable
//      `{n}-spec.md` at `work/{n}-spec.md` or `spec-{n}/work/{n}-spec.md`, in the run
//      dir or its worktree mirror -- the same two shapes and mirror rule
//      `wrap-up/pack.js`'s resolveRecords ladder reads, so a group that clears this
//      gate never reaches its second call with records unresolved. A header whose
//      `record:` line names another number does not count.
```

Add this helper above `checkFirstCallArtifacts`:

```js
// The run dir plus its worktree mirror (pack.js's worktreeMirror), deduplicated.
function headerBases(runDir, runState) {
  const bases = [runDir];
  const mirror = worktreeMirror(runDir, runState && runState.worktree);
  if (mirror && path.resolve(mirror) !== path.resolve(runDir)) bases.push(mirror);
  return bases;
}

function hasMaterializedHeader(readFile, bases, n) {
  for (const base of bases) {
    for (const rel of [path.join('work', `${n}-spec.md`), path.join(`spec-${n}`, 'work', `${n}-spec.md`)]) {
      let text;
      try { text = readFile(path.join(base, rel)); } catch { continue; }
      const rec = /^record:\s*(\d+)\s*$/m.exec(text);
      if (!rec || Number(rec[1]) === n) return true;
    }
  }
  return false;
}
```

At the end of `checkFirstCallArtifacts`, replace the final `return { ok: true };` with:

```js
  let parsedRunState = null;
  try { parsedRunState = JSON.parse(runStateRaw); } catch { parsedRunState = null; }
  const bases = headerBases(runDir, parsedRunState);
  for (const issueNumber of issueNumbers) {
    if (!hasMaterializedHeader(readFile, bases, Number(issueNumber))) {
      return fail('materialized-header-missing', `no materialized header for issue #${issueNumber} under ${bases.join(' or ')} (work/ or spec-${issueNumber}/work/)`);
    }
  }

  return { ok: true };
```

Change the file's `module.exports` line to:

```js
module.exports = { checkFirstCallArtifacts, resolveIntegrationModel, headerBases, hasMaterializedHeader, defaultReadFile };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/bin-lib/dispatch/first-call-artifact-check.test.js tests/bin-lib/wrap-up/*.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/wrap-up/pack.js plugin/bin/lib/dispatch/first-call-artifact-check.js tests/bin-lib/dispatch/first-call-artifact-check.test.js
git commit -m "Gate a dispatch group's second call on materialized headers — first-call-artifact-check check 5, refs #2775"
```

### Task 2: Document check 5 at its two call sites

**Files:**
- Modify: `plugin/skills/dispatch/two-call-gate.md` (section 2, "Artifact check" paragraph)
- Modify: `plugin/skills/dispatch/sequential-execution.md` (the "Artifact check, first call only (#2837)" paragraph)

**Interfaces:**
- Consumes: Task 1's `materialized-header-missing` reason.
- Produces: prose only.

- [ ] **Step 1: Write the failing check**

Run: `grep -c "materialized header" plugin/skills/dispatch/two-call-gate.md plugin/skills/dispatch/sequential-execution.md`
Expected: FAIL signature — both files report `0`.

- [ ] **Step 2: Edit two-call-gate.md**

In section 2's "Artifact check" paragraph, after the sentence ending "that `run-state.json` records a `pr.number` whose head branch exists on `origin`.", insert:

```
It also checks (#2775) that every member has a materialized header — `work/{n}-spec.md` or `spec-{n}/work/{n}-spec.md`, in the run directory or its worktree mirror, the same shapes `/wrap-up`'s record-resolution ladder reads — so a group whose first call never materialized (a hand-rolled build) is stopped here rather than reaching the second call with its records unresolved.
```

- [ ] **Step 3: Edit sequential-execution.md**

In the "Artifact check, first call only (#2837)" paragraph, change "with no claim, no `config.yml`/`run-state.json`, or no pushed branch behind it" to "with no claim, no `config.yml`/`run-state.json`, no materialized header (#2775), or no pushed branch behind it".

- [ ] **Step 4: Verify**

Run: `grep -c "materialized header" plugin/skills/dispatch/two-call-gate.md plugin/skills/dispatch/sequential-execution.md`
Expected: PASS — each file reports `1`.

Run: `node --test tests/*dispatch*.test.js tests/bin-lib/dispatch/*.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/dispatch/two-call-gate.md plugin/skills/dispatch/sequential-execution.md
git commit -m "Document the two-call gate's materialized-header check — two-call-gate + sequential-execution, refs #2775"
```
