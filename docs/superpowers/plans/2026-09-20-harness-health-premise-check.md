# Harness-Health Premise-Check Threading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thread a `Premise-check:` command through harness-health's `toIssuePayload` for mechanically re-checkable patch findings, so materialize.js's existing premise-check machinery can auto-detect an already-resolved harness-health finding before a build starts.

**Architecture:** A finding only carries `assetType`/`target` (an id), never a file path (`plugin/skills/harness-health/judge-procedure.md`'s finding schema has no `path` field) — but a single `validate-findings` invocation always corresponds to one target, whose id/kind are already passed as `--target`/`--kind` and are already resolvable back to a real file via `plugin/bin/lib/harness-health/scope.js`'s `listTargets`/`listMemory`. Add a small `resolveTargetPath(root, kind, id, memoryDir)` helper to `scope.js`, call it once in `bin/harness-health.js`'s `cmdValidateFindings` to attach a `path` field onto each survivor finding, then have `issue-payload.js`'s `toIssuePayload` build a safe, single-line `Premise-check:` shell command from `finding.path` + `finding.oldString`/`finding.newString` — additive intent checks the proposed string's absence (exit 0 while absent, non-zero once present), removal checks the opposite way against the old string. Degrades to no `Premise-check:` line (never a wrong one) when no path resolves, or the anchor string is empty, multi-line, or over a length ceiling.

**Tech Stack:** Node.js (`node --test`), no new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-09-19T225754-record-2621/work/2621-spec.md` (materialized from GitHub issue #2621)

## Global Constraints

- Scope this record to harness-health only — the identical fix in docs-health/journey-health/code-health's issue-payload.js is an explicit, separately-specced follow-up (do not touch those files).
- `new-skill` findings never get a `Premise-check:` line (no existing file content to check against) — this is already true by construction (`buildPremiseCheck` gates on `finding.kind !== 'patch'`), not something a task needs to special-case beyond that gate.
- No shell injection: any value interpolated into the composed command must be safely single-quote-escaped.
- Never guess wrong: a string too long or multi-line to safely anchor (or a target whose path can't be resolved) must degrade to no `Premise-check:` line, not a wrong one.
- `specShapedBody`'s existing `premiseCheck` validation (`plugin/bin/lib/issues/record.js:690-692`) throws if the command contains a newline — the anchor-selection logic must filter out multi-line content itself, before ever reaching that call, so the throw path is never hit in normal operation.

---

### Task 1: `resolveTargetPath` in scope.js

**Files:**
- Modify: `plugin/bin/lib/harness-health/scope.js` (add function + export, near `listTargets`/`listMemory` at the bottom of the file, before `module.exports` at line 304)
- Test: `tests/bin-lib/harness-health/scope.test.js`

**Interfaces:**
- Consumes: `listTargets(root)` and `listMemory(memoryDir)`, both already defined in this file (returns `{ kind, id, path, ... }` objects).
- Produces: `resolveTargetPath(root, kind, id, memoryDir)` → returns the matching target's `path` string, or `null` when `kind`/`id` is missing, no match is found, or `kind === 'memory'` and `memoryDir` is missing. Consumed by Task 2 (`bin/harness-health.js`).

- [ ] **Step 1: Write the failing tests**

Add to `tests/bin-lib/harness-health/scope.test.js` (append near the end of the file, after the existing `selectMemoryTarget`/`listDesignArtifacts` tests):

```javascript
// ─── resolveTargetPath ───────────────────────────────────────────────────────

test('resolveTargetPath resolves a skill id to its file path', (t) => {
  const root = tmp(t);
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth');
  assert.strictEqual(
    resolveTargetPath(root, 'skill', 'auth'),
    path.join(root, '.claude', 'skills', 'auth.md'),
  );
});

test('resolveTargetPath resolves a claude-md id to CLAUDE.md', (t) => {
  const root = tmp(t);
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# CLAUDE');
  assert.strictEqual(resolveTargetPath(root, 'claude-md', 'CLAUDE'), path.join(root, 'CLAUDE.md'));
});

test('resolveTargetPath resolves a memory id when memoryDir is given', (t) => {
  const root = tmp(t);
  const memoryDir = tmp(t);
  fs.writeFileSync(path.join(memoryDir, 'MEMORY.md'), '- [Some Memory](some-memory.md) — hook\n');
  assert.strictEqual(
    resolveTargetPath(root, 'memory', 'some-memory', memoryDir),
    path.join(memoryDir, 'some-memory.md'),
  );
});

test('resolveTargetPath returns null for a memory id when memoryDir is omitted', (t) => {
  const root = tmp(t);
  assert.strictEqual(resolveTargetPath(root, 'memory', 'some-memory'), null);
});

test('resolveTargetPath returns null when no target matches kind+id', (t) => {
  const root = tmp(t);
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth');
  assert.strictEqual(resolveTargetPath(root, 'skill', 'billing'), null);
  assert.strictEqual(resolveTargetPath(root, 'rule', 'auth'), null, 'kind must also match, not just id');
});

test('resolveTargetPath returns null when kind or id is missing', (t) => {
  const root = tmp(t);
  assert.strictEqual(resolveTargetPath(root, null, 'auth'), null);
  assert.strictEqual(resolveTargetPath(root, 'skill', null), null);
});
```

Update the require block at the top of `tests/bin-lib/harness-health/scope.test.js` to add `resolveTargetPath`:

```javascript
const {
  listSkills, extractDomainPaths, domainChurn, selectTarget,
  listRules, parseRulePaths, listClaudeMd, listTargets,
  readDesignIntegrationFlag, listDesignArtifacts,
  listMemory, selectMemoryTarget, resolveTargetPath,
} = require('../../../plugin/bin/lib/harness-health/scope');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/harness-health/scope.test.js`
Expected: FAIL with "resolveTargetPath is not a function" (or "is not defined")

- [ ] **Step 3: Implement `resolveTargetPath`**

In `plugin/bin/lib/harness-health/scope.js`, add this function after `selectTarget` (immediately before the `module.exports` block currently at line 304):

```javascript
// ─── resolveTargetPath ──────────────────────────────────────────────────────
// Maps a finding's (assetType, target-id) pair — the only identity a filed
// finding carries (judge-procedure.md's schema has no path field) — back to
// the concrete file path harness-health scanned it from. issue-payload.js
// uses this to anchor a Premise-check: command against the target's live
// content (#2621). A findings batch always corresponds to one target
// (judge-procedure.md: "Write the findings array to
// /tmp/harness-health-findings-{target.id}.json"), so a caller with `root`
// (and, for memory, `memoryDir`) in scope resolves it once per batch rather
// than per finding. Returns null on any unresolved case — unknown kind/id,
// or a memory kind with no memoryDir — never guesses.
function resolveTargetPath(root, kind, id, memoryDir) {
  if (!kind || !id) return null;
  if (kind === 'memory') {
    if (!memoryDir) return null;
    const found = listMemory(memoryDir).find((t) => t.id === id);
    return found ? found.path : null;
  }
  const found = listTargets(root).find((t) => t.kind === kind && t.id === id);
  return found ? found.path : null;
}
```

Update `module.exports` at the bottom of the file to include it:

```javascript
module.exports = {
  listSkills, parseRulePaths, listRules, listClaudeMd, listTargets,
  extractDomainPaths, domainChurn, selectTarget,
  readDesignIntegrationFlag, listDesignArtifacts,
  listMemory, selectMemoryTarget, resolveTargetPath,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/harness-health/scope.test.js`
Expected: PASS (all tests, including the pre-existing ones)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/harness-health/scope.js tests/bin-lib/harness-health/scope.test.js
git commit -m "Add resolveTargetPath to harness-health scope.js

refs #2621"
```

---

### Task 2: `buildPremiseCheck` in issue-payload.js

**Files:**
- Modify: `plugin/bin/lib/harness-health/issue-payload.js`
- Test: `tests/bin-lib/harness-health/issue-payload.test.js`

**Interfaces:**
- Consumes: nothing new from other tasks — a pure function operating on a `finding` object (`kind`, `intent`, `oldString`, `newString`) plus a `targetPath` string.
- Produces: `buildPremiseCheck(finding, targetPath)` → returns a single-line shell command string, or `undefined`. Consumed within this same file by `toIssuePayload` (this task, Step 3) and directly by this task's own unit tests.

- [ ] **Step 1: Write the failing tests**

Add to `tests/bin-lib/harness-health/issue-payload.test.js` (append at the end of the file):

```javascript
// ── Premise-check threading (#2621) ─────────────────────────────────────────

const { buildPremiseCheck } = require('../../../plugin/bin/lib/harness-health/issue-payload');
const { extractPremiseCheck } = require('../../../plugin/bin/lib/issues/record');

test('buildPremiseCheck for an additive patch checks for the proposed string\'s absence', () => {
  const finding = patchFinding({ oldString: 'old text', newString: 'new text' });
  const cmd = buildPremiseCheck(finding, '/repo/.claude/skills/auth.md');
  assert.strictEqual(cmd, "! grep -qF -- 'new text' '/repo/.claude/skills/auth.md'");
});

test('buildPremiseCheck for a removal checks for the old string\'s presence', () => {
  const finding = patchFinding({ intent: 'remove', oldString: 'old text', newString: '' });
  const cmd = buildPremiseCheck(finding, '/repo/CLAUDE.md');
  assert.strictEqual(cmd, "grep -qF -- 'old text' '/repo/CLAUDE.md'");
});

test('buildPremiseCheck single-quote-escapes an anchor string containing a literal quote', () => {
  const finding = patchFinding({ oldString: 'old', newString: "it's new" });
  const cmd = buildPremiseCheck(finding, '/repo/CLAUDE.md');
  assert.strictEqual(cmd, "! grep -qF -- 'it'\\''s new' '/repo/CLAUDE.md'");
});

test('buildPremiseCheck single-quote-escapes a target path containing a space', () => {
  const finding = patchFinding({ oldString: 'old', newString: 'new' });
  const cmd = buildPremiseCheck(finding, '/repo/my skills/auth.md');
  assert.strictEqual(cmd, "! grep -qF -- 'new' '/repo/my skills/auth.md'");
});

test('buildPremiseCheck returns undefined for a new-skill finding', () => {
  const finding = newSkillFinding();
  assert.strictEqual(buildPremiseCheck(finding, '/repo/.claude/skills/queue.md'), undefined);
});

test('buildPremiseCheck returns undefined when no target path was resolved', () => {
  const finding = patchFinding();
  assert.strictEqual(buildPremiseCheck(finding, null), undefined);
  assert.strictEqual(buildPremiseCheck(finding, undefined), undefined);
});

test('buildPremiseCheck returns undefined when the anchor string is multi-line', () => {
  const finding = patchFinding({ oldString: 'old', newString: 'line one\nline two' });
  assert.strictEqual(buildPremiseCheck(finding, '/repo/CLAUDE.md'), undefined);
});

test('buildPremiseCheck returns undefined when the anchor string is empty', () => {
  const finding = patchFinding({ oldString: 'old', newString: '' });
  assert.strictEqual(buildPremiseCheck(finding, '/repo/CLAUDE.md'), undefined);
});

test('buildPremiseCheck returns undefined when the anchor string is over the length ceiling', () => {
  const finding = patchFinding({ oldString: 'old', newString: 'x'.repeat(401) });
  assert.strictEqual(buildPremiseCheck(finding, '/repo/CLAUDE.md'), undefined);
});

test('buildPremiseCheck accepts an anchor string exactly at the length ceiling', () => {
  const finding = patchFinding({ oldString: 'old', newString: 'x'.repeat(400) });
  assert.ok(buildPremiseCheck(finding, '/repo/CLAUDE.md'));
});

// ── Wired into toIssuePayload's composed body ───────────────────────────────

test('toIssuePayload includes a Premise-check: line when finding.path resolves', () => {
  const finding = patchFinding({ path: '/repo/.claude/skills/auth.md', oldString: 'old', newString: 'new' });
  const payload = toIssuePayload(finding);
  assert.strictEqual(extractPremiseCheck(payload.body), "! grep -qF -- 'new' '/repo/.claude/skills/auth.md'");
});

test('toIssuePayload omits Premise-check: when finding.path is absent', () => {
  const payload = toIssuePayload(patchFinding());
  assert.strictEqual(extractPremiseCheck(payload.body), null);
});

test('toIssuePayload omits Premise-check: for a new-skill finding even if path were present', () => {
  const payload = toIssuePayload({ ...newSkillFinding(), path: '/repo/.claude/skills/queue.md' });
  assert.strictEqual(extractPremiseCheck(payload.body), null);
});

test('toIssuePayload composes Premise-check: alongside an existing verifiedAsOf stamp', () => {
  const finding = patchFinding({ path: '/repo/CLAUDE.md', oldString: 'old', newString: 'new' });
  const payload = toIssuePayload(finding, 'abc1234');
  assert.strictEqual(extractVerifiedAsOf(payload.body), 'abc1234');
  assert.strictEqual(extractPremiseCheck(payload.body), "! grep -qF -- 'new' '/repo/CLAUDE.md'");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/harness-health/issue-payload.test.js`
Expected: FAIL with "buildPremiseCheck is not a function" (or not exported), and the `toIssuePayload` Premise-check assertions failing since no such line is emitted yet.

- [ ] **Step 3: Implement `buildPremiseCheck` and thread it through `toIssuePayload`**

In `plugin/bin/lib/harness-health/issue-payload.js`, add after the existing `require` block (after line 16, before `const ASSET_TYPE_LABELS = ...`):

```javascript
// Shell single-quote escape: wraps `str` in single quotes, closing/
// reopening the quote around an escaped literal `'`. Single-quoted content
// has no metacharacter interpretation at all in POSIX sh, so this is immune
// to shell injection regardless of what the string contains (backticks, $,
// ", spaces) — the one thing it can't hold safely is a literal newline,
// filtered out separately in buildPremiseCheck below.
function shQuote(str) {
  return `'${str.replace(/'/g, "'\\''")}'`;
}

// Anchor-length ceiling: keeps the composed `grep -F` pattern well clear of
// a real command-line limit and avoids anchoring on a huge, more likely
// non-unique substring. Not tied to any other constant in this codebase —
// chosen generously above the size of a typical oldString/newString (a
// sentence or a few lines of prose/code).
const MAX_PREMISE_ANCHOR_LENGTH = 400;

// Builds a Premise-check: command (#1829/#2621) for a mechanically
// re-checkable patch finding. Additive intent (the common case) checks for
// the proposed string's absence in the target file — exit 0 while absent
// (finding still unresolved), non-zero once present (finding resolved),
// mirroring claude-md-curation.md's existing wc -l-over-budget shape's
// polarity. A removal checks the opposite way against the string being
// removed — exit 0 while it's still present (unresolved), non-zero once
// it's gone (resolved). Returns undefined — never a wrong command — when:
// the finding isn't a patch (new-skill candidates have no existing content
// to check against), no targetPath was resolved for it, or the anchor
// string can't be safely anchored (empty, multi-line, or over the length
// ceiling above). materialize.js's own "no Premise-check: line" fallback
// handles the undefined case.
function buildPremiseCheck(finding, targetPath) {
  if (finding.kind !== 'patch' || !targetPath) return undefined;
  const isRemoval = finding.intent === 'remove';
  const anchor = isRemoval ? finding.oldString : finding.newString;
  if (!anchor || anchor.includes('\n') || anchor.length > MAX_PREMISE_ANCHOR_LENGTH) return undefined;
  const grep = `grep -qF -- ${shQuote(anchor)} ${shQuote(targetPath)}`;
  return isRemoval ? grep : `! ${grep}`;
}
```

Then modify the `toIssuePayload` function body — find this block (around line 51-58):

```javascript
  const body = specShapedBody({
    header: kindLine,
    currentState: [...relatedBlocks, finding.reason],
    deliverables,
    acceptanceCriteria: finding.description,
    filedBy: '/claude-tweaks:harness-health',
    verifiedAsOf,
  });
```

Replace it with:

```javascript
  const premiseCheck = buildPremiseCheck(finding, finding.path);

  const body = specShapedBody({
    header: kindLine,
    currentState: [...relatedBlocks, finding.reason],
    deliverables,
    acceptanceCriteria: finding.description,
    filedBy: '/claude-tweaks:harness-health',
    verifiedAsOf,
    premiseCheck,
  });
```

Finally update `module.exports` at the bottom of the file (currently `module.exports = { toIssuePayload };`):

```javascript
module.exports = { toIssuePayload, buildPremiseCheck };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/harness-health/issue-payload.test.js`
Expected: PASS (all tests, including every pre-existing test in this file)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/harness-health/issue-payload.js tests/bin-lib/harness-health/issue-payload.test.js
git commit -m "Thread Premise-check: through harness-health's toIssuePayload

refs #2621"
```

---

### Task 3: Wire `resolveTargetPath` into `bin/harness-health.js`'s `cmdValidateFindings`

**Files:**
- Modify: `plugin/bin/harness-health.js`
- Test: `tests/bin-lib/harness-health/cli-validate-findings.test.js`

**Interfaces:**
- Consumes: `resolveTargetPath(root, kind, id, memoryDir)` from Task 1 (`plugin/bin/lib/harness-health/scope.js`).
- Produces: each finding object passed to `toIssuePayload` (via `dedupAndDispatch`, `plugin/bin/lib/health-core/validate-findings-dispatch.js`) now carries a `path` field when resolvable — consumed by Task 2's `buildPremiseCheck`.

- [ ] **Step 1: Write the failing test**

Add to `tests/bin-lib/harness-health/cli-validate-findings.test.js` (append at the end of the file):

```javascript
// ── Premise-check threading end-to-end (#2621) ──────────────────────────────

test('validate-findings: a patch finding against a real target file carries a Premise-check: line resolvable to that file', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth\n\nSee `src/auth/login.js`.\n');
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding()]));

  const result = runValidateFindings(root, findingsFile, ['--target', 'auth', '--kind', 'skill']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  const payloads = JSON.parse(result.stdout);
  assert.strictEqual(payloads.length, 1);
  const expectedPath = path.join(root, '.claude', 'skills', 'auth.md');
  assert.ok(
    payloads[0].body.includes(`Premise-check: ! grep -qF -- 'See \`src/auth/session.js\`.' '${expectedPath}'`),
    `expected a Premise-check: line anchored on the resolved target path, got body:\n${payloads[0].body}`,
  );
});

test('validate-findings: a patch finding against an unresolvable target carries no Premise-check: line', () => {
  const root = tmp();
  // No .claude/skills/auth.md on disk — the target can't resolve to a path.
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding()]));

  const result = runValidateFindings(root, findingsFile, ['--target', 'auth', '--kind', 'skill']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  const payloads = JSON.parse(result.stdout);
  assert.strictEqual(payloads.length, 1);
  assert.ok(!payloads[0].body.includes('Premise-check:'), 'must degrade to no line, not a wrong one');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/harness-health/cli-validate-findings.test.js`
Expected: The first new test FAILs (no `Premise-check:` line yet, since `path` is never attached to the finding). The second new test already PASSes today (nothing to regress there — kept as a guard against a future regression).

- [ ] **Step 3: Wire `resolveTargetPath` into `cmdValidateFindings`**

In `plugin/bin/harness-health.js`, update the import at line 19-21:

```javascript
const {
  selectTarget, listTargets, listMemory, selectMemoryTarget,
} = require('./lib/harness-health/scope');
```

to:

```javascript
const {
  selectTarget, listTargets, listMemory, selectMemoryTarget, resolveTargetPath,
} = require('./lib/harness-health/scope');
```

Then in `cmdValidateFindings` (starting at line 153), find this block (around line 211-217):

```javascript
    const id = fingerprint({
      assetType: v.value.assetType,
      target: v.value.target,
      section: v.value.section || v.value.kind,
      description: v.value.description,
    });
    const value = { ...v.value, id };
```

Replace it with:

```javascript
    const id = fingerprint({
      assetType: v.value.assetType,
      target: v.value.target,
      section: v.value.section || v.value.kind,
      description: v.value.description,
    });
    // Resolved once per batch, not per finding: a findings file always
    // corresponds to one target (judge-procedure.md's per-target dispatch),
    // so every finding in it shares the same assetType/target this CLI
    // invocation was already given via --kind/--target. issue-payload.js's
    // buildPremiseCheck reads this to anchor a Premise-check: command
    // against the target's live content (#2621) — undefined here (no
    // --target/--kind, or an unresolvable one, e.g. a --gap-scan-only run)
    // simply means no Premise-check: line gets emitted, never a wrong one.
    const targetPath = resolveTargetPath(root, args.kind, args.target, args.memoryDir) || undefined;
    const value = { ...v.value, id, path: targetPath };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/harness-health/cli-validate-findings.test.js`
Expected: PASS (all tests, including every pre-existing test in this file — the pre-existing tests use a bare `tmp()` root with no `.claude/skills/auth.md` on disk, so `resolveTargetPath` returns `null` there and `path` stays `undefined`, an unchanged no-op for them).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/harness-health.js tests/bin-lib/harness-health/cli-validate-findings.test.js
git commit -m "Resolve and thread target path into harness-health findings for Premise-check

refs #2621"
```

---

### Task 4: Full-suite verification

**Files:** none (verification only)

**Interfaces:** none — this task runs the full test suite to confirm no cross-file regression from Tasks 1-3.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — every suite green, including `tests/bin-lib/harness-health/*` and `tests/bin-lib/docs-health/*`/`tests/bin-lib/journey-health/*`/`tests/bin-lib/code-health/*` (untouched by this change, must remain green as-is).

- [ ] **Step 2: If anything fails, fix and re-run**

Diagnose against the specific failing test's output — do not guess. Re-run the single failing file in isolation (`node --test path/to/file.test.js`) to confirm the fix, then re-run `npm test` in full before concluding.
