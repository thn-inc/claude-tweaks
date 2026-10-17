# Wrap-up record resolution via the worktree mirror (#3365) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every wrap-up reader resolve a run's records through the one existing resolution (`pack.js`'s `resolveRecords`, which falls back to the worktree's mirror of the run dir) instead of globbing the main-checkout `${RUN_DIR}/work/*-spec.md`, and skip Section C step 2 under `pr-first`.

**Architecture:** One code change: `engine-verify.js`'s `resolvedIssueNumbers` calls `resolveRecords` (worktree read from `run-state.json` via `readRunStateWithParent`) before its existing `verify-expectations.json` fallback. Every prose reader under `plugin/skills/wrap-up/` (plus `dispatch/two-call-gate.md`'s description of it) cites `{run-dir}/wrap-up-pack.json`'s `inputs.records`, with a worktree-mirror glob fallback only where the pack can be absent. A new prose-conformance test pins that no wrap-up file globs `${RUN_DIR}/work/` any more.

**Tech Stack:** Node 18+ (CommonJS), `node --test`, markdown skill files.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T100123-spec-3368-3365/spec-3365/work/3365-spec.md` (materialized from GitHub issue #3365)

Scope keywords: RUN_DIR}/work, resolvedIssueNumbers

## Global Constraints

- Reuse, don't re-derive: call `resolveRecords`/`worktreeMirror` from `plugin/bin/lib/wrap-up/pack.js`; never copy the ladder.
- The `verify-expectations.json` `issues` array stays as `resolvedIssueNumbers`' fallback, after record resolution.
- `current-branch` runs keep the run dir and the spec in the same checkout — `resolveRecords`' first rung (own `work/`) must keep winning there. Never make the mirror the primary read.
- Section C step 3's `local-merge` handoff text is unchanged; only step 2's source and its `pr-first` skip move.
- Prefer replacing a glob sentence over appending. All touched files are well under the 50 KB `CEILING_BYTES` (`plugin/bin/lib/skill-audit/context-cost.js`); largest is `cleanup-procedures-execution.md` at 38,601 B.
- Commits: stage explicit paths; `{Verb} {what} — {detail}`; body `refs #3365` (never closes/fixes); last line `Claude-Session: https://claude.ai/code/session_01LzjeBaJPYTntRsRJ2VHX8r`. Never `git stash`.
- **Ruling R1 — header rungs only in `resolvedIssueNumbers`.** It accepts `resolveRecords` results only when `source` is `'headers'` or `'worktree-headers'`; the manifest rungs (`'manifest'`, `'worktree-manifest'`) fall through to the expectations fallback. Why: a multi-spec parent's `manifest.yml` lists every targeted record, including `not-run`/`failed` specs, whose PR-body line is `Refs`, not `Fixes` (`_shared/pr-checklist-refresh.md`) — counting them would make `carrier-commit` fail a correct run. This keeps a parent run dir's behavior identical to today. Cost if wrong: a parent-dir verify keeps relying on expectations, as it does today.
- **Ruling R2 — Section E captures `parked-at-shaping` at cleanup planning.** Cleanup items execute in order, and item 4 removes the worktree (and its mirror) before item 7's Section E reads the header, so "read the header at the worktree-mirror path" from inside Section E would find nothing. Section E's restore reads the field during Phase 4's cleanup planning, while the worktree still exists, and carries the value to item 7. Cost if wrong: an extra early read.
- **Ruling R3 — Review Console step 11 always records `issues`.** Verify runs after cleanup executes, so under `pr-first` the worktree mirror is gone by then and the main checkout has no `work/` until reconcile — `resolvedIssueNumbers` then needs the expectations `issues` key. The step-11 `--issues` write therefore always runs on its non-Approve-all path, from `inputs.records` (else Phase 1's record); header-read priority makes it harmless when a header resolves. This replaces the spec's "repoint the omit-`issues` condition" (logged as `premise reversed:`). The Approve-all path (`finish-console` drops `issues`) is out of scope — filed as a follow-up after build.

## Review Focus

1. A closed run (`run-state.json` `worktree: null`, `worktreeAtClose` set) whose worktree directory still exists must still resolve the mirror — pinned in Task 1 (`worktreeAtClose` test).
2. A multi-spec `spec-{N}/` run dir carries no `worktree` of its own; it must inherit the parent's — pinned in Task 1 (spec-dir test).
3. A parent multi-spec run dir with only a manifest must not resolve `not-run` ids as carrier-commit obligations — pinned in Task 1 (manifest-only test, Ruling R1).
4. A `cleanup-only` run never writes `wrap-up-pack.json` (Phase 3 skipped) — Section C step 2's mirror fallback covers it; pinned by Task 2's conformance assertion that step 2 names the fallback.
5. A line-wrapped `${RUN_DIR}/work/` in prose must still be caught by the absence pin — pinned in Task 2 by whitespace-collapsing plus a frozen line-wrapped control.

---

### Task 1: `resolvedIssueNumbers` resolves through `resolveRecords`

**Files:**
- Modify: `plugin/bin/lib/wrap-up/engine-verify.js` (lines 365-394 `resolvedIssueNumbers` and its comment; `module.exports` at ~895)
- Test: `tests/bin-lib/wrap-up/engine-verify.test.js` (add after the `#1223` expectations-fallback block, ~line 942)

**Interfaces:**
- Consumes: `resolveRecords(deps, runDir, worktree)` → `{ records: number[], source: 'headers'|'worktree-headers'|'manifest'|'worktree-manifest'|'unavailable' }` from `./pack`; `readRunStateWithParent(runDir)` → `{ state, parentRunDir }` (already imported).
- Produces: `resolvedIssueNumbers(runDir)` → `number[]`, now exported from `engine-verify.js` for direct testing.

- [ ] **Step 1: Write the failing tests** — add `resolvedIssueNumbers` to the test file's require of `../../../plugin/bin/lib/wrap-up/engine-verify`, then append:

```js
// ---- #3365: resolvedIssueNumbers reads the worktree mirror ----
//
// The materialized header is committed in the worktree only, so a
// main-checkout run dir has no work/ before merge. These fixtures put the run
// dir under a real `.claude-tweaks/pipelines/{run-id}` path (worktreeMirror
// keys on that segment) and the header only under the worktree's mirror.

function mirrorFixture({ runId = '2026-10-17T075913-spec-3337', specSubdir = null, record = 3337, state }) {
  const root = makeTmpDir('verify-mirror-');
  const parentDir = path.join(root, 'main', '.claude-tweaks', 'pipelines', runId);
  const runDir = specSubdir ? path.join(parentDir, specSubdir) : parentDir;
  fs.mkdirSync(runDir, { recursive: true });
  const wtDir = path.join(root, 'wt');
  const mirrorWork = specSubdir
    ? path.join(wtDir, '.claude-tweaks', 'pipelines', runId, specSubdir, 'work')
    : path.join(wtDir, '.claude-tweaks', 'pipelines', runId, 'work');
  fs.mkdirSync(mirrorWork, { recursive: true });
  if (record !== null) {
    fs.writeFileSync(path.join(mirrorWork, `${record}-spec.md`), `---\nrecord: ${record}\n---\n# ${record}: title\n`);
  }
  fs.writeFileSync(path.join(parentDir, 'run-state.json'), JSON.stringify(state(wtDir)));
  if (specSubdir) fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));
  return { root, runDir, wtDir };
}

test('#3365: resolvedIssueNumbers resolves a record from the worktree mirror when the run dir has no work/', () => {
  const { runDir } = mirrorFixture({ state: (wt) => ({ status: 'active', worktree: wt }) });
  assert.deepStrictEqual(resolvedIssueNumbers(runDir), [3337]);
});

test('#3365: resolvedIssueNumbers still falls back to expectations issues when neither location has a header', () => {
  const { runDir } = mirrorFixture({ record: null, state: (wt) => ({ status: 'active', worktree: wt }) });
  writeExpectations(runDir, { version: 1, memory: [], upstream: [], issues: [900] });
  assert.deepStrictEqual(resolvedIssueNumbers(runDir), [900]);
});

test('#3365: resolvedIssueNumbers reads worktreeAtClose when a closed run nulled worktree', () => {
  const { runDir } = mirrorFixture({ state: (wt) => ({ status: 'closed', worktree: null, worktreeAtClose: wt }) });
  assert.deepStrictEqual(resolvedIssueNumbers(runDir), [3337]);
});

test('#3365: a multi-spec spec-{N}/ run dir inherits the parent run-state worktree for the mirror read', () => {
  const { runDir } = mirrorFixture({ specSubdir: 'spec-3337', state: (wt) => ({ status: 'active', worktree: wt }) });
  assert.deepStrictEqual(resolvedIssueNumbers(runDir), [3337]);
});

test('#3365: a closed multi-spec spec-{N}/ dir reads the parent worktreeAtClose for the mirror read', () => {
  const { runDir } = mirrorFixture({ specSubdir: 'spec-3337', state: (wt) => ({ status: 'closed', worktree: null, worktreeAtClose: wt }) });
  assert.deepStrictEqual(resolvedIssueNumbers(runDir), [3337]);
});

test('#3365: a parent run dir with only a manifest does not treat manifest ids as resolved records (Ruling R1)', () => {
  const { runDir } = mirrorFixture({ record: null, state: (wt) => ({ status: 'active', worktree: wt }) });
  fs.writeFileSync(path.join(runDir, 'manifest.yml'), 'multispec:\n  specs:\n    - id: 3337\n      status: not-run\n      subdir: spec-3337/\n');
  writeExpectations(runDir, { version: 1, memory: [], upstream: [], issues: [900] });
  assert.deepStrictEqual(resolvedIssueNumbers(runDir), [900]);
});

test('#3365: carrier-commit fails, not skips, for a mirror-resolved record with no closing keyword on branch or PR', () => {
  const { runDir } = mirrorFixture({ state: (wt) => ({ status: 'active', worktree: wt }) });
  const result = runVerify({ runDir, base: 'main', deps: { git: () => '', gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'carrier-commit');
  assert.strictEqual(row.result, 'fail', row.detail);
  assert.match(row.detail, /3337/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node -e 'process.exit(typeof require("./plugin/bin/lib/wrap-up/engine-verify").resolvedIssueNumbers === "function" ? 0 : 1)'`
Expected: FAIL (exit 1) — `resolvedIssueNumbers` is not exported yet.

Then run `node --test tests/bin-lib/wrap-up/engine-verify.test.js`: the new `#3365` cases fail with `TypeError: resolvedIssueNumbers is not a function`. If you export it before implementing, the mirror, both worktreeAtClose cases, the spec-dir case, and the carrier-commit `fail` case (currently `skip`) stay red until Step 3. The expectations-fallback and manifest-only cases may already pass; they characterize behavior that must survive.

- [ ] **Step 3: Implement** — in `engine-verify.js`, add near the other requires:

```js
const { resolveRecords } = require('./pack');
```

Replace the `// ---- resolved-issue-number resolution` comment block and `resolvedIssueNumbers` body with:

```js
// ---- resolved-issue-number resolution --------------------------------------
//
// Records resolve through pack.js's resolveRecords (#3365) — the same ladder
// wrap-up-pack.json's inputs.records uses: the run dir's own work/ headers,
// then the worktree's mirror of the run dir (the materialized header is
// committed in the worktree only and reaches the main checkout by merge).
// The worktree comes from run-state.json via readRunStateWithParent (a
// multi-spec spec-{N}/ dir inherits the parent's), falling back to
// worktreeAtClose for a closed run. Only the header rungs count: manifest
// ids include not-run/failed specs whose PR-body line is `Refs`, not
// `Fixes`, so a manifest-only resolution falls through to the expectations
// fallback below, exactly as before. readdir degrades to [] and headerRecords
// skips an unreadable file, so a concurrent reconcile/archive prune reads as
// "no headers found" rather than throwing.
const RECORD_DEPS = {
  readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } },
  readFile: (p) => fs.readFileSync(p, 'utf8'),
};
const HEADER_SOURCES = new Set(['headers', 'worktree-headers']);

function resolvedIssueNumbers(runDir) {
  const { records, source } = resolveRecords(RECORD_DEPS, runDir, recordedWorktree(runDir));
  if (HEADER_SOURCES.has(source) && records.length) return records;
  const expPath = path.join(runDir, 'verify-expectations.json');
  if (fs.existsSync(expPath)) {
    try {
      const exp = JSON.parse(fs.readFileSync(expPath, 'utf8'));
      if (Array.isArray(exp.issues)) return exp.issues;
    } catch { /* malformed expectations file -- Task 5 owns reporting this on the expectations-dependent rows; this fallback simply yields nothing here */ }
  }
  return [];
}
```

Extract the `worktree-removed` check's existing worktree resolution (lines ~352-357: `readRunStateWithParent`, own `worktree` || `worktreeAtClose`, then the parent's `worktreeAtClose`) into one module-level helper defined above that check, and make the check call it — one resolution, two callers, rather than a second copy:

```js
// The run's recorded worktree path: run-state.json's `worktree` stamp (a
// multi-spec spec-{N}/ dir inherits the parent's), else `worktreeAtClose`
// for a closed run -- own first, then the parent's (readRunStateWithParent
// fills only `worktree` from the parent). null when none is usable.
function recordedWorktree(runDir) {
  const { state, parentRunDir } = readRunStateWithParent(runDir);
  const usable = (v) => (typeof v === 'string' && v ? v : null);
  let recorded = state ? usable(state.worktree) || usable(state.worktreeAtClose) : null;
  if (!recorded && parentRunDir) {
    const parent = readRunState(parentRunDir);
    recorded = parent && typeof parent === 'object' ? usable(parent.worktreeAtClose) : null;
  }
  return recorded;
}
```

In the `worktree-removed` check, replace those lines with `const recorded = recordedWorktree(runDir);` (keep the #3023 comment above it, trimmed to point at the helper) and leave the rest of the check unchanged. Add `resolvedIssueNumbers,` to `module.exports`. Leave the expectations block byte-identical to today.

Note the two header-read differences `headerRecords` brings, both intended: it only considers `{digits}-spec.md` filenames (materialize only ever writes that shape), and a file with no `record:` line now contributes its filename number instead of nothing. Every existing fixture uses `writeSpecFile(runDir, '{n}', n)`, so Step 4's full-file run confirms no existing case depends on the old shape.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/wrap-up/engine-verify.test.js`
Expected: PASS — all tests, including every pre-existing `carrier-commit` and `acceptance-labeling` case (the own-`work/` rung still wins for them).

- [ ] **Step 5: Prove AC 3 (revert turns the mirror test red), without editing the shared tree** — in a scratch worktree:

Run: `git worktree add --detach /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/66aa9b73-8113-4567-8cfb-fd7270ed81bf/scratchpad/revert-3365 HEAD`
Then in that scratch worktree only, restore the pre-change body with `git -C <scratch> show 691ecd15a:plugin/bin/lib/wrap-up/engine-verify.js` piped to a file (or edit the function back to its `path.join(runDir, 'work')`-only read, keeping the new export), and run:
Run: `node --test tests/bin-lib/wrap-up/engine-verify.test.js` (from the scratch worktree)
Expected: FAIL on `#3365: resolvedIssueNumbers resolves a record from the worktree mirror …` (actual `[]`), and on the carrier-commit `fail` case (actual `skip`). Quote the failing assertion lines in the report, then `git worktree remove --force <scratch>`.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/wrap-up/engine-verify.js tests/bin-lib/wrap-up/engine-verify.test.js
git commit -m "Resolve verify's issue numbers through the worktree mirror — carrier-commit fails instead of skipping

refs #3365

Claude-Session: https://claude.ai/code/session_01LzjeBaJPYTntRsRJ2VHX8r"
```

---

### Task 2: Section C step 2, Section E, the ordering note and two-call-gate repoint; new conformance pin

**Files:**
- Modify: `plugin/skills/wrap-up/cleanup-procedures-execution.md` (Section C step 2, lines 63-89; Section E step 7, lines 415-423)
- Modify: `plugin/skills/wrap-up/cleanup-procedures.md` (line 7)
- Modify: `plugin/skills/dispatch/two-call-gate.md` (line 27, last sentence)
- Create: `tests/wrap-up-record-resolution-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's behavior (verify resolves the mirror), cited in prose only.
- Produces: the conformance test file Task 3 extends — helper `globHits(text)` and `collapse(text)` defined below.

- [ ] **Step 1: Write the failing test** — create `tests/wrap-up-record-resolution-conformance.test.js`:

```js
'use strict';
// tests/wrap-up-record-resolution-conformance.test.js — #3365: wrap-up readers
// resolve a run's records through wrap-up-pack.json's inputs.records (pack.js's
// resolveRecords, which reads the worktree mirror), never by globbing the
// main-checkout run dir's work/, which is empty before merge in a worktree run.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const collapse = (s) => s.replace(/\s+/g, ' ');

// Every spelling of a main-checkout run-dir work/ read this repo has used.
const RETIRED = ['${RUN_DIR}/work/', '"${RUN_DIR}"/work/', '{run-dir}/work/*-spec.md'];
function globHits(text) {
  const flat = collapse(text);
  return RETIRED.filter((needle) => flat.includes(needle));
}

// Frozen pre-change excerpts (cleanup-procedures-execution.md Section C step 2
// at 691ecd15a). The second is line-wrapped mid-token-run to prove collapse()
// is what catches it.
const PRE_CHANGE_STEP_2 = 'reference. Otherwise, check for a materialized header — glob `${RUN_DIR}/work/*-spec.md`\n   (the file `skills/flow/materialize.md` writes and never deletes)';
const PRE_CHANGE_LOOP = '   for f in "${RUN_DIR}"/work/*-spec.md; do\n     [ -e "$f" ] || continue';

test('globHits catches the pre-change step 2 glob and loop (proves the absence pin can go red)', () => {
  assert.deepStrictEqual(globHits(PRE_CHANGE_STEP_2), ['${RUN_DIR}/work/']);
  assert.deepStrictEqual(globHits(PRE_CHANGE_LOOP), ['"${RUN_DIR}"/work/']);
  assert.deepStrictEqual(globHits('glob `${RUN_DIR}/work/`\n*-spec.md'), ['${RUN_DIR}/work/']);
  assert.deepStrictEqual(globHits('the mirror `{worktree}/.claude-tweaks/pipelines/{run-id}/work/*-spec.md`'), []);
});

const TASK2_FILES = [
  'plugin/skills/wrap-up/cleanup-procedures-execution.md',
  'plugin/skills/wrap-up/cleanup-procedures.md',
  'plugin/skills/dispatch/two-call-gate.md',
];
for (const rel of TASK2_FILES) {
  test(`${rel} no longer reads the main-checkout run dir's work/`, () => {
    assert.deepStrictEqual(globHits(read(rel)), []);
  });
}

function step2Block() {
  const text = read('plugin/skills/wrap-up/cleanup-procedures-execution.md');
  const start = text.indexOf('2. **Stamp the closing-keyword carrier commit');
  const end = text.indexOf('\n3. **', start);
  assert.ok(start !== -1 && end !== -1, 'Section C step 2 anchor vanished — the claims below would be vacuous');
  return collapse(text.slice(start, end));
}

test('Section C step 2 is skipped under integration-model: pr-first', () => {
  assert.match(step2Block(), /\*\*`integration-model: pr-first` \(`_shared\/integration-model\.md`\): skip this step entirely\*\*/);
});

test('Section C step 2 takes its issue set from wrap-up-pack.json inputs.records, with the worktree mirror as fallback', () => {
  const block = step2Block();
  assert.match(block, /`\{run-dir\}\/wrap-up-pack\.json`'s `inputs\.records`/);
  assert.match(block, /\{worktree\}\/\.claude-tweaks\/pipelines\/\{run-id\}\/work\/\*-spec\.md/);
});

test('Section E reads parked-at-shaping at cleanup planning, before item 4 removes the worktree (Ruling R2)', () => {
  const flat = collapse(read('plugin/skills/wrap-up/cleanup-procedures-execution.md'));
  assert.match(flat, /parked-at-shaping: true`[\s\S]{0,120}?read during cleanup planning from the worktree mirror/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/wrap-up-record-resolution-conformance.test.js`
Expected: FAIL — the three `no longer reads` tests (each live file still contains a retired spelling), the two step-2 claims, and the Section E claim; the `globHits catches …` control test PASSES (it tests the helper, not the prose).

- [ ] **Step 3: Rewrite Section C step 2** in `cleanup-procedures-execution.md`. Replace from `2. **Stamp the closing-keyword carrier commit — worktree strategy, single-terminal path only.**` through the closing ```` ``` ```` of the bash block (the line after `fi`) with:

````markdown
2. **Stamp the closing-keyword carrier commit — worktree strategy, single-terminal path only.**
   **`integration-model: pr-first` (`_shared/integration-model.md`): skip this step entirely** —
   FYI: the run's PR body already carries the `Fixes #{issue}` lines
   (`_shared/pr-early-run-lifecycle.md`). Also skip it when this run is part of a
   multi-terminal-parallel dispatch destined for `flow/worktree-merge.md`'s reconciliation merge
   (the run was launched via `/claude-tweaks:flow {spec} worktree` alongside sibling terminals,
   not a solo worktree run) — that merge stamps its own `Fixes #{issue}` lines directly
   (`--no-ff`, per "Close-via-merge" in `_shared/issue-claims.md`), and a carrier commit here
   would double-stamp the closing reference. Otherwise, take the issue set from
   `{run-dir}/wrap-up-pack.json`'s `inputs.records` (Phase 3's fact pack — `pack.js`'s
   `resolveRecords`, which already reads the worktree's mirror of the run dir, since the header
   reaches the main checkout only by merge). Only when the pack is absent (a `cleanup-only` run
   skips Phase 3), glob the worktree mirror instead —
   `{worktree}/.claude-tweaks/pipelines/{run-id}/work/*-spec.md`, where `{worktree}` is
   `run-state.json`'s `worktree` (else `worktreeAtClose`) and `{run-id}` is the run dir's path
   from its `.claude-tweaks/pipelines/` segment on — and read each match's header `record:` field:

   ```bash
   ISSUES=()
   PACK="${RUN_DIR}/wrap-up-pack.json"
   MIRROR="{worktree}/.claude-tweaks/pipelines/{run-id}"
   if [ -f "$PACK" ]; then
     ISSUES=($(node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(((p.inputs||{}).records||[]).join(" "))' "$PACK"))
   else
     for f in "${MIRROR}"/work/*-spec.md; do
       [ -e "$f" ] || continue
       ISSUES+=("$(grep -m1 '^record:' "$f" | sed 's/^record: *//')")
     done
   fi
   if [ "${#ISSUES[@]}" -gt 0 ]; then
     git commit --allow-empty -m "$(printf 'Fixes #%s\n' "${ISSUES[@]}")"
   fi
   ```
````

In the paragraph right after the block, change `the loop above finds nothing` to `the resolution above finds nothing`. Leave the rest of that paragraph and the "Why a dedicated commit" pointer unchanged.

- [ ] **Step 4: Rewrite Section E's restore read** — in step 7 (`**Remove \`bot:in-progress\`; restore \`parked\` if applicable.**`, lines 415-424), replace the text spanning lines 418-420 (it is line-wrapped in the file; match it across the wraps)

```
AND the materialized header (`${RUN_DIR}/work/*-spec.md` — read
   directly; per the step above, the file is never deleted before this point) carries
   `parked-at-shaping: true` (`materialize.md`'s field for exactly this restore-on-abandon case):
```

with

```
AND the materialized header carries
   `parked-at-shaping: true` (`materialize.md`'s field for exactly this restore-on-abandon case —
   read during cleanup planning from the worktree mirror,
   `{worktree}/.claude-tweaks/pipelines/{run-id}/work/{issue}-spec.md` resolved as in Section C
   step 2, while the worktree still exists, since item 4 removes it before this step runs):
```

Keep the following `restore \`parked\` — bootstrap the label …` text and the "Skip restoration silently …" sentence unchanged.

- [ ] **Step 5: Rewrite `cleanup-procedures.md` line 7's item list** — replace

`the worktree/carrier-commit check reads the materialized header from \`${RUN_DIR}/work/\`, the ephemeral-server teardown reads \`${RUN_DIR}/ephemeral-server.txt\`, and the issue claim release optionally reads the same materialized header again (for its \`parked-at-shaping\` restore sub-step only — its core release no longer requires it, see Section E)`

with

`the worktree/carrier-commit check reads the run's records from \`${RUN_DIR}/wrap-up-pack.json\` (\`inputs.records\`), the ephemeral-server teardown reads \`${RUN_DIR}/ephemeral-server.txt\`, and the issue claim release optionally uses the materialized header's \`parked-at-shaping\` field (captured at cleanup planning from the worktree mirror, since item 4 removes the worktree first — see Section E; its core release no longer requires it)`

- [ ] **Step 6: Re-read `two-call-gate.md` line 27 and repoint its last sentence** — replace

`it globs \`${RUN_DIR}/work/*-spec.md\` and treats an empty result as the no-commits case, no carrier commit, nothing to stamp.`

with

`under \`pr-first\` it is skipped outright, and otherwise it resolves the run's records (\`wrap-up-pack.json\`'s \`inputs.records\`, or the worktree mirror's \`work/*-spec.md\` when the pack is absent, as it is in a \`cleanup-only\` run) and treats an empty result as the no-commits case, no carrier commit, nothing to stamp.`

- [ ] **Step 7: Run tests to verify they pass**

Run: `node --test tests/wrap-up-record-resolution-conformance.test.js`
Expected: PASS (all tests in the file).

Run: `node --test tests/scratch-worktree-remote-branch-delete.test.js tests/archive-run-verb.test.js tests/dispatch-flow-rundir-handoff.test.js tests/github-write-transport-label-merge-conformance.test.js tests/local-merge-auto-finish.test.js tests/dev-url-detection-lease-conformance.test.js tests/ports-release-sites-conformance.test.js tests/ephemeral-server-handoff-conformance.test.js tests/bin-lib/wrap-up/engine-render.test.js tests/bin-lib/wrap-up/engine-cli.test.js tests/bin-lib/reconcile/release-merged.test.js tests/hooks-pipeline-shadow-guard.test.js tests/teardown-gate.test.js tests/wrap-up-pack-conformance.test.js tests/plan-citations-resolve.test.js tests/auto-merge-short-circuit-ledger-deletion.test.js tests/hooks-worktree-reap.test.js tests/flow-cleanup-only-conformance.test.js tests/dispatch-settle-and-merge-lazy-read.test.js tests/pr-first-merge.test.js tests/build-already-shipped-exit.test.js tests/bin-lib/closing-tally/closing-tally.test.js`
Expected: PASS (every existing test that reads one of the three Task 2 files, per `grep -rlF` on each filename).

- [ ] **Step 8: Prove the new pins go red at base without mutating the tree** — for each Task 2 file run `git show 691ecd15a:<file>` and confirm the retired spelling is present there:

Run: `git show 691ecd15a:plugin/skills/wrap-up/cleanup-procedures-execution.md`
Expected: output contains `glob \`${RUN_DIR}/work/*-spec.md\`` and `for f in "${RUN_DIR}"/work/*-spec.md` (quote the matching lines via a follow-up `grep -n` on the saved output in the report).
Repeat for `plugin/skills/wrap-up/cleanup-procedures.md` (`${RUN_DIR}/work/`) and `plugin/skills/dispatch/two-call-gate.md` (`${RUN_DIR}/work/*-spec.md`).

- [ ] **Step 9: Commit**

```bash
git add plugin/skills/wrap-up/cleanup-procedures-execution.md plugin/skills/wrap-up/cleanup-procedures.md plugin/skills/dispatch/two-call-gate.md tests/wrap-up-record-resolution-conformance.test.js
git commit -m "Repoint Section C step 2 and Section E at the fact pack — skip the carrier commit under pr-first

refs #3365

Claude-Session: https://claude.ai/code/session_01LzjeBaJPYTntRsRJ2VHX8r"
```

---

### Task 3: Remaining prose readers; corpus-wide absence pin

**Files:**
- Modify: `plugin/skills/wrap-up/review-console.md` (line 26; step 11 at line 120)
- Modify: `plugin/skills/wrap-up/review-console-appendix.md` (the `**\`--issues\` form:**` paragraph, lines 97-101)
- Modify: `plugin/skills/wrap-up/auto-merge-short-circuit.md` (lines 9-10)
- Modify: `plugin/skills/wrap-up/SKILL.md` (line 69; line 246)
- Modify: `plugin/skills/wrap-up/execution-and-verification.md` (lines 28-31)
- Test: `tests/wrap-up-record-resolution-conformance.test.js` (extend)

**Interfaces:**
- Consumes: `globHits`, `collapse`, `read` from Task 2's test file.
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing tests** — append to `tests/wrap-up-record-resolution-conformance.test.js`:

```js
// Corpus-wide: no file under plugin/skills/wrap-up/ reads the main-checkout run dir's work/.
const WRAPUP_DIR = 'plugin/skills/wrap-up';
const WRAPUP_FILES = fs.readdirSync(path.join(ROOT, WRAPUP_DIR)).filter((f) => f.endsWith('.md'));

test('the wrap-up corpus is non-empty (the sweep below is not vacuous)', () => {
  assert.ok(WRAPUP_FILES.length > 10, `only ${WRAPUP_FILES.length} files found under ${WRAPUP_DIR}`);
});

for (const name of WRAPUP_FILES) {
  test(`${WRAPUP_DIR}/${name} has no main-checkout work/ read`, () => {
    assert.deepStrictEqual(globHits(read(`${WRAPUP_DIR}/${name}`)), []);
  });
}

test('Review Console step 11 always records issues from inputs.records (Ruling R3)', () => {
  const flat = collapse(read('plugin/skills/wrap-up/review-console.md'));
  const start = flat.indexOf('11. Write `verify-expectations.json`');
  assert.ok(start !== -1, 'step 11 anchor vanished');
  const step11 = flat.slice(start, start + 2500);
  assert.match(step11, /`issues` array of this run's record number\(s\) — `\{run-dir\}\/wrap-up-pack\.json`'s `inputs\.records`/);
  assert.doesNotMatch(step11, /omit `issues` entirely/);
});

test('the auto-merge short-circuit applicability reads inputs.records', () => {
  assert.match(collapse(read('plugin/skills/wrap-up/auto-merge-short-circuit.md')), /wrap-up-pack\.json`'s `inputs\.records` is non-empty/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/wrap-up-record-resolution-conformance.test.js`
Expected: FAIL — the per-file sweep for `review-console.md`, `auto-merge-short-circuit.md`, `SKILL.md`, `execution-and-verification.md`; the step-11 claim; the auto-merge claim. Task 2's tests and the corpus-size test PASS.

- [ ] **Step 3: `review-console.md` line 26** — replace

`When this run's spec has a materialized header (\`record:\` field in \`${RUN_DIR}/work/*-spec.md\`)`

with

`When this run's spec has a materialized header (\`{run-dir}/wrap-up-pack.json\`'s \`inputs.records\` is non-empty — Phase 3's fact pack, which reads the worktree's mirror of the run dir)`

- [ ] **Step 4: `review-console.md` step 11** — replace

`**When no materialized header exists under \`${RUN_DIR}/work/*-spec.md\`**, also include an \`issues\` array of this run's identified record number(s) from Phase 1, recorded via \`node "${CLAUDE_PLUGIN_ROOT}/bin/set-verify-expectations.js" --run "$PIPELINE_RUN_DIR" --issues {n}[,{m}]\` after the write above; omit \`issues\` entirely when a materialized header exists.`

with

`Also include an \`issues\` array of this run's record number(s) — \`{run-dir}/wrap-up-pack.json\`'s \`inputs.records\` when non-empty, else Phase 1's identified record(s) — recorded via \`node "${CLAUDE_PLUGIN_ROOT}/bin/set-verify-expectations.js" --run "$PIPELINE_RUN_DIR" --issues {n}[,{m}]\` after the write above: verify runs after cleanup, when the worktree mirror may already be gone, so this key is the fallback it reads then (a resolvable header still takes priority).`

- [ ] **Step 5: `review-console-appendix.md` `--issues` form** — replace the paragraph starting `**\`--issues\` form:** this is the same absent-header condition` through `already takes priority and would never reach this key anyway.` with:

`**\`--issues\` form:** written on every non-Approve-all resolution (#3365) — \`engine-verify.js\`'s \`resolvedIssueNumbers()\` reads it only when no materialized header resolves (neither the run dir's own \`work/\` nor the worktree mirror, which cleanup may already have removed by the time verify runs), so it is harmless when a header resolves. \`finish-console\` drops an \`issues\` key from its stdin payload, so the Approve-all path does not write it.`

- [ ] **Step 6: `auto-merge-short-circuit.md` lines 9-10** — replace

`When this run's spec has a materialized header (\`record:\` field present in\n\`${RUN_DIR}/work/*-spec.md\` — see \`skills/flow/materialize.md\`)`

with

`When this run's spec has a materialized header (\`{run-dir}/wrap-up-pack.json\`'s \`inputs.records\` is\nnon-empty — see \`skills/flow/materialize.md\` for the header)`

- [ ] **Step 7: `SKILL.md` line 69** — replace

`3. Check whether a materialized header exists for this run (\`${RUN_DIR}/work/*-spec.md\`) — record mode`

with

`3. Check whether this run resolves a materialized header — \`{run-dir}/wrap-up-pack.json\`'s \`inputs.records\` when the pack exists, else the worktree mirror (\`cleanup-procedures-execution.md\` Section C step 2) — record mode`

- [ ] **Step 8: `SKILL.md` line 246** — replace

`- This run has a materialized header (\`${RUN_DIR}/work/*-spec.md\`) whose issue carries`

with

`- This run resolves a materialized header (\`wrap-up-pack.json\`'s \`inputs.records\`) whose issue carries`

- [ ] **Step 9: `execution-and-verification.md` lines 28-30** — replace

`Resolve the issue set from any\nmaterialized headers under \`${RUN_DIR}/work/*-spec.md\` when they exist (a multi-spec\ncurrent-branch run can resolve more than one — read each match's \`record:\` field), otherwise`

with

`Resolve the issue set from\n\`{run-dir}/wrap-up-pack.json\`'s \`inputs.records\` when non-empty (a multi-spec current-branch\nrun can resolve more than one), otherwise`

- [ ] **Step 10: Run tests to verify they pass**

Run: `node --test tests/wrap-up-record-resolution-conformance.test.js`
Expected: PASS (all).

Run: `node --test tests/multi-agent-coordination.test.js tests/console-autoresolve-drain-overlap-carveout.test.js tests/verify-expectations-writer-conformance.test.js tests/wrap-up-console-fast-path-scanned-exclusion.test.js tests/console-on-pr.test.js tests/console-autoresolve-ungranted-member-carveout.test.js tests/console-execution.test.js tests/auto-mode-flow-two-stop-budget.test.js tests/staged-patch-contract.test.js tests/local-merge-auto-finish.test.js tests/console-autoresolve-needs-human-carveout.test.js tests/console-execution-mergecheck-carveout.test.js tests/flow-claim-preflight.test.js tests/console-resolve-conformance.test.js tests/pr-first-merge.test.js tests/deferral-gate-conformance.test.js tests/multispec-review-console-render-not-skip.test.js tests/wrap-up-pack-conformance.test.js tests/multispec-not-run-callsite.test.js tests/reflect-wrap-up-insights-staging-conformance.test.js tests/ephemeral-server-handoff-conformance.test.js tests/bundle-fixes-reconciliation-2015.test.js tests/auto-merge-short-circuit-ledger-deletion.test.js tests/bin-lib/skill-audit/context-cost.test.js tests/bin-lib/calibration/cli.test.js tests/bin-lib/wrap-up/pack.test.js tests/bin-lib/skill-audit/anti-patterns.test.js tests/bin-lib/console/cli.test.js tests/merge-subject-composer-conformance.test.js tests/auto-merge-short-circuit-verdict-backstop.test.js tests/dispatch-mechanical-enforcement.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/dispatch/merge-verdict.test.js tests/pr-early-run-lifecycle.test.js tests/pr-run-comments.test.js tests/wrap-up-verify-execution-pin.test.js tests/bin-lib/wrap-up/engine-verify.test.js tests/reflect-transcript-judge-prose.test.js tests/next-actions-premise.test.js tests/wrap-up-registry-pin.test.js tests/release-lifecycle-byte-budget.test.js tests/release-recommendation-gate-conformance.test.js tests/pipeline-run-dir-adoption-anchoring.test.js tests/fast-lane-digest.test.js tests/session-tmp-root-migration.test.js tests/wrap-up-flaky-escalation-row.test.js tests/ceremony-profile-roster.test.js`
Expected: PASS (every existing test that reads one of the Task 3 files, per `grep -rlF` on each filename).

- [ ] **Step 11: Prove the corpus sweep goes red at base** —

Run: `git show 691ecd15a:plugin/skills/wrap-up/review-console.md`
Expected: contains `${RUN_DIR}/work/*-spec.md` twice (lines 26 and 120). Repeat for `auto-merge-short-circuit.md`, `SKILL.md`, `execution-and-verification.md`; quote the matching lines in the report.

- [ ] **Step 12: Commit**

```bash
git add plugin/skills/wrap-up/review-console.md plugin/skills/wrap-up/review-console-appendix.md plugin/skills/wrap-up/auto-merge-short-circuit.md plugin/skills/wrap-up/SKILL.md plugin/skills/wrap-up/execution-and-verification.md tests/wrap-up-record-resolution-conformance.test.js
git commit -m "Repoint remaining wrap-up record readers at inputs.records — step 11 always records issues for verify

refs #3365

Claude-Session: https://claude.ai/code/session_01LzjeBaJPYTntRsRJ2VHX8r"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 → Task 1 (AC 1, 2, 3). Deliverable 2 → Task 2 Step 3 (AC 4). Deliverable 3 → Task 2 Steps 4-6 and Task 3 Steps 3-9 (every listed site, plus `review-console-appendix.md`, which restates step 11's condition). Deliverable 4 → Task 1 tests + the conformance test (AC 5). AC 6 (`npm test`) → run centrally by `/build` Common Step 5. Gotchas: current-branch first rung kept (Global Constraints; existing tests in Task 1 Step 4); multi-spec prose points at `inputs.records` (Task 3); step 3 unchanged (Task 2 Step 3 replaces only step 2); two-call-gate re-read (Task 2 Step 6); size budgets measured (Global Constraints).
- **Departures from the spec, recorded as rulings:** R1 (header rungs only), R2 (Section E captures at planning), R3 (step 11 always records `issues`, replacing the spec's repointed omit-condition).
- **Placeholders:** none — `{worktree}`, `{run-id}`, `{run-dir}`, `{issue}` are the skill files' own documented placeholders, not plan gaps.
- **Type consistency:** `resolvedIssueNumbers(runDir) → number[]`; `resolveRecords(deps, runDir, worktree) → {records, source}`; test helpers `globHits`/`collapse`/`read` defined in Task 2, reused in Task 3.
- **Out of scope (follow-ups to file after build):** `finish-console`'s Approve-all path drops `issues`, so verify still skips after teardown on Approve-all runs; `flow/multispec-review-console.md`'s Shared teardown reads `spec-{id}/work/{id}-spec.md` from the main-checkout parent dir, the same class of read this record fixes for `plugin/skills/wrap-up/`.
