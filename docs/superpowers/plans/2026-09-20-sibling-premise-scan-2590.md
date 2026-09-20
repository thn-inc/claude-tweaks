# Sibling premise-disproof scan (#2590) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before `materialize.js` plans a fresh full-pipeline investigation for a record, scan closed PRs referencing that issue number for language showing a prior attempt already reached the same "premise no longer holds" conclusion, and surface it (a `SCANNED` decision, and a staged close-review note when a match is found) instead of silently redoing the same work.

**Architecture:** Add a small pure-function module (`plugin/bin/lib/issues/sibling-premise.js`) that scans an already-fetched array of closed-PR objects (`{number, url, body}`) for a phrase pattern indicating the same record's premise was already disproved, and returns the first match or `null`. Wire it into `plugin/bin/materialize.js`'s `run()`, gated on the gh-backed path only (mirrors the existing `Premise-check:` feature's deps-injection style): a new `deps.ghSearchClosedPRs(owner, repo, n, host)` seam runs `gh pr list --state closed --search "#{n} in:body"`, the scan runs over its parsed JSON, and the result is (a) always logged as one `SCANNED` decision (scope + outcome, per `_shared/auto-decision-log.md`'s SCANNED semantics) and (b) when a match is found, also staged as a close-review proposal via the same `writeStagedItem` helper the existing `Premise-check:` feature already uses, and included in the JSON envelope's new `siblingPremiseDisproof` field. The call is guarded on `typeof deps.ghSearchClosedPRs === 'function'` so every existing test's `fakeDeps` (which doesn't define it) continues to skip this path unchanged — no existing test needs editing.

**Tech Stack:** Node.js (`node --test`), `gh` CLI via `execFileSync` (existing `repoSlug`/`parseRepo` helpers), the existing `log-decision/append.js` and `stage-item/write.js` modules.

**Spec:** `.claude-tweaks/pipelines/2026-09-20T065055-record-2590/work/2590-spec.md` (materialized from GitHub issue #2590)

## Global Constraints

- Never call `gh` on the `--record-json` path (no `repoSpec` resolved there) — this check is gh-backed only, matching materialize.js's existing author-association gate's scoping decision for `Premise-check:`.
- A search failure (network, `gh` error, unparseable JSON) must never block materialize — degrade to `siblingPremiseDisproof: null`, same fail-open posture as `computePremise`/`computeDrift`.
- Do not touch any existing test's `fakeDeps` helper — the new deps method must be optional (feature-detected), so every pre-existing materialize test keeps passing byte-for-byte.

---

### Task 1: Sibling-PR premise-disproof scan

**Files:**
- Create: `plugin/bin/lib/issues/sibling-premise.js`
- Test: `tests/bin-lib/issues/sibling-premise.test.js`
- Modify: `plugin/bin/materialize.js`
- Test: `tests/materialize-sibling-premise.test.js`

**Interfaces:**
- Produces (from `sibling-premise.js`): `SIBLING_PREMISE_PATTERN` (RegExp), `findSiblingPremiseDisproof(prs: Array<{number, url, body}>) -> {number, url, matchedPhrase} | null`
- Consumes (in `materialize.js`): `findSiblingPremiseDisproof` from the new module; existing `formatEntry`/`appendEntry` (from `./lib/log-decision/append`), `writeStagedItem` (from `./lib/stage-item/write`), `repoSlug`/`parseRepo` (from `./lib/repo-resolve`) — all already imported in this file.

- [ ] **Step 1: Write the failing test for the pure scan function**

```javascript
// tests/bin-lib/issues/sibling-premise.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { findSiblingPremiseDisproof, SIBLING_PREMISE_PATTERN } = require('../../../plugin/bin/lib/issues/sibling-premise');

test('findSiblingPremiseDisproof: empty/no-match list returns null', () => {
  assert.strictEqual(findSiblingPremiseDisproof([]), null);
  assert.strictEqual(findSiblingPremiseDisproof(null), null);
  assert.strictEqual(findSiblingPremiseDisproof([{ number: 1, url: 'https://x/1', body: 'unrelated PR body' }]), null);
});

test('findSiblingPremiseDisproof: a PR body stating "premise no longer holds" matches', () => {
  const prs = [
    { number: 1, url: 'https://x/1', body: 'Nothing to see here.' },
    { number: 2560, url: 'https://x/2560', body: 'Conclusion: premise no longer holds — all 9 tests pass.' },
  ];
  const result = findSiblingPremiseDisproof(prs);
  assert.deepStrictEqual(result, { number: 2560, url: 'https://x/2560', matchedPhrase: 'premise no longer holds' });
});

test('findSiblingPremiseDisproof: "premise already resolved"/"already satisfied"/"already disproved" all match, case-insensitively', () => {
  for (const phrase of ['premise already resolved', 'Premise Already Satisfied', 'premise already disproved']) {
    const result = findSiblingPremiseDisproof([{ number: 9, url: 'https://x/9', body: `Text. ${phrase}. More text.` }]);
    assert.ok(result, phrase);
    assert.strictEqual(result.number, 9, phrase);
  }
});

test('findSiblingPremiseDisproof: returns the FIRST matching PR when multiple match', () => {
  const prs = [
    { number: 1, url: 'https://x/1', body: 'premise no longer holds' },
    { number: 2, url: 'https://x/2', body: 'premise already resolved' },
  ];
  assert.strictEqual(findSiblingPremiseDisproof(prs).number, 1);
});

test('findSiblingPremiseDisproof: a PR with a non-string body is skipped, not thrown', () => {
  const prs = [{ number: 1, url: 'https://x/1', body: null }, { number: 2, url: 'https://x/2', body: 'premise no longer holds' }];
  assert.strictEqual(findSiblingPremiseDisproof(prs).number, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/issues/sibling-premise.test.js`
Expected: FAIL with "Cannot find module '../../../plugin/bin/lib/issues/sibling-premise'"

- [ ] **Step 3: Write the module**

```javascript
// plugin/bin/lib/issues/sibling-premise.js — #2590: before materialize.js
// plans a fresh full-pipeline investigation for a record, scan closed PRs
// referencing that issue number for language showing a prior attempt
// already reached the same "premise no longer holds" conclusion.
'use strict';

// Matches the phrase shape this codebase already uses for the same
// conclusion elsewhere (materialize.js's own Premise-check: stderr text
// says "premise already satisfied at base") plus the closed-PR wording that
// motivated #2590 ("premise no longer holds"). Case-insensitive; the two
// alternatives on the right share the "already" stem so a single group
// covers resolved/satisfied/disproved without repeating "premise already".
const SIBLING_PREMISE_PATTERN = /premise\s+(?:no longer holds|already\s+(?:resolved|satisfied|disproved))/i;

// Array<{number, url, body}> -> {number, url, matchedPhrase} | null.
// Returns the first PR (in the array's own order) whose body matches the
// pattern above. A non-array/empty input or a PR with a non-string body is
// treated as no match, never thrown.
function findSiblingPremiseDisproof(prs) {
  for (const pr of prs || []) {
    if (!pr || typeof pr.body !== 'string') continue;
    const match = pr.body.match(SIBLING_PREMISE_PATTERN);
    if (match) return { number: pr.number, url: pr.url, matchedPhrase: match[0] };
  }
  return null;
}

module.exports = { SIBLING_PREMISE_PATTERN, findSiblingPremiseDisproof };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/issues/sibling-premise.test.js`
Expected: PASS (5/5)

- [ ] **Step 5: Write the failing test for materialize.js's wiring**

```javascript
// tests/materialize-sibling-premise.test.js — #2590: materialize.js scans
// closed PRs referencing the target issue for language showing a sibling
// attempt already disproved the record's premise, before a fresh
// investigation is planned. Mirrors materialize-premise-check.test.js's
// fakeDeps shape and real-temp-git-repo harness.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { gitRepo } = require('./helpers/git-fixtures');
const wtDetect = require('../plugin/bin/lib/hooks/worktree-detect');
const { run } = require('../plugin/bin/materialize');

const SHAPED_BODY = [
  'Surface: backend',
  '',
  '## Current State',
  'Some current state text.',
  '',
  '## Deliverables',
  '- [ ] do a thing',
  '',
  '## Acceptance Criteria',
  '1. It works',
].join('\n');

function withCwd(dir, fn) {
  const prev = process.cwd();
  process.chdir(dir);
  try { return fn(); } finally { process.chdir(prev); }
}

function baseDeps() {
  const stdout = [];
  const stderr = [];
  return {
    calls: { stdout, stderr },
    ghAvailable: () => true,
    ghView: () => JSON.stringify({
      number: 2590, title: 'Test record', body: SHAPED_BODY, labels: [{ name: 'ceremony:standard' }], url: 'https://example.invalid/2590',
    }),
    remoteUrl: () => { throw new Error('remoteUrl should never be called when --repo is passed explicitly'); },
    cwd: () => process.cwd(),
    mainRoot: (cwd) => wtDetect.mainCheckoutRoot(cwd),
    isAnchored: (resolvedPath, mainRoot) => wtDetect.isAnchoredUnderRoot(resolvedPath, mainRoot),
    cwdWorktreeRoot: (cwd) => {
      const info = wtDetect.repoInfo(cwd);
      return info.isLinkedWorktree ? info.repoRoot : null;
    },
    mkdirp: (dir) => fs.mkdirSync(dir, { recursive: true }),
    writeFile: (file, content) => fs.writeFileSync(file, content),
    stdout: (s) => stdout.push(s),
    stderr: (s) => stderr.push(s),
  };
}

function runDirFor(repoDir) {
  return path.join(repoDir, '.claude-tweaks', 'pipelines', '2026-01-01T000000-record-2590');
}

test('sibling-premise: deps.ghSearchClosedPRs not defined -> skipped entirely, no stderr, no decisions.md', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const deps = baseDeps();
    const runDir = runDirFor(repo);
    const exitCode = run(['2590', '--run-dir', runDir, '--repo', 'owner/repo'], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    const envelope = JSON.parse(deps.calls.stdout.join(''));
    assert.strictEqual(envelope.siblingPremiseDisproof, null);
    assert.deepStrictEqual(deps.calls.stderr, []);
    assert.ok(!fs.existsSync(path.join(runDir, 'decisions.md')));
  });
});

test('sibling-premise: no closed PR matches -> siblingPremiseDisproof null, one SCANNED entry logged, nothing staged', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const deps = baseDeps();
    deps.ghSearchClosedPRs = () => JSON.stringify([{ number: 1, url: 'https://x/1', body: 'unrelated' }]);
    const runDir = runDirFor(repo);
    const exitCode = run(['2590', '--run-dir', runDir, '--repo', 'owner/repo'], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    const envelope = JSON.parse(deps.calls.stdout.join(''));
    assert.strictEqual(envelope.siblingPremiseDisproof, null);
    const decisions = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
    assert.match(decisions, /SCANNED/);
    assert.match(decisions, /#2590/);
    assert.ok(!fs.existsSync(path.join(runDir, 'staged')));
  });
});

test('sibling-premise: a matching closed PR -> siblingPremiseDisproof populated, SCANNED entry cites it, staged note written, stderr note', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const deps = baseDeps();
    deps.ghSearchClosedPRs = () => JSON.stringify([
      { number: 2560, url: 'https://github.com/o/r/pull/2560', body: 'Conclusion: premise no longer holds — all 9 tests pass.' },
    ]);
    const runDir = runDirFor(repo);
    const exitCode = run(['2590', '--run-dir', runDir, '--repo', 'owner/repo'], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    const envelope = JSON.parse(deps.calls.stdout.join(''));
    assert.deepStrictEqual(envelope.siblingPremiseDisproof, { number: 2560, url: 'https://github.com/o/r/pull/2560', matchedPhrase: 'premise no longer holds' });
    assert.strictEqual(deps.calls.stderr.length, 1);
    assert.match(deps.calls.stderr[0], /#2560/);

    const decisions = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
    assert.match(decisions, /SCANNED/);
    assert.match(decisions, /#2560/);

    const stagedFile = path.join(runDir, 'staged', 'sibling-premise-disproof-2590.md');
    assert.ok(fs.existsSync(stagedFile));
    const staged = fs.readFileSync(stagedFile, 'utf8');
    assert.match(staged, /#2560/);
    assert.match(staged, /premise no longer holds/);
  });
});

test('sibling-premise: a throwing/unparseable search degrades to null, never crashes, no stderr', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const deps = baseDeps();
    deps.ghSearchClosedPRs = () => { throw new Error('gh: rate limited'); };
    const runDir = runDirFor(repo);
    const exitCode = run(['2590', '--run-dir', runDir, '--repo', 'owner/repo'], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    const envelope = JSON.parse(deps.calls.stdout.join(''));
    assert.strictEqual(envelope.siblingPremiseDisproof, null);
  });
});

test('sibling-premise: --record-json path never calls ghSearchClosedPRs (gh-backed only)', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const recordJsonPath = path.join(repo, 'record.json');
    fs.writeFileSync(recordJsonPath, JSON.stringify({
      number: 2590, title: 'Test record', body: SHAPED_BODY, labels: [{ name: 'ceremony:standard' }], url: 'https://example.invalid/2590',
    }));
    const deps = baseDeps();
    deps.readFile = (file) => fs.readFileSync(file, 'utf8');
    deps.ghSearchClosedPRs = () => { throw new Error('ghSearchClosedPRs should never be called on the --record-json path'); };
    const runDir = runDirFor(repo);
    const exitCode = run(['2590', '--run-dir', runDir, '--record-json', recordJsonPath], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    const envelope = JSON.parse(deps.calls.stdout.join(''));
    assert.strictEqual(envelope.siblingPremiseDisproof, null);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `node --test tests/materialize-sibling-premise.test.js`
Expected: FAIL — `envelope.siblingPremiseDisproof` is `undefined`, not `null` (the field doesn't exist yet); the SCANNED-entry tests fail because nothing is logged.

- [ ] **Step 7: Wire the scan into materialize.js**

In `plugin/bin/materialize.js`:

1. Add the import near the other `./lib/issues/...` requires:

```javascript
const { findSiblingPremiseDisproof } = require('./lib/issues/sibling-premise');
```

2. Add `ghSearchClosedPRs` to `realDeps`, next to `ghView`:

```javascript
  // #2590: closed PRs referencing this issue, searched by body text — used
  // to detect a sibling attempt that already reached this record's own
  // "premise disproved" conclusion. Read-only; no author-association gate
  // needed (unlike ghAuthorAssociation/runPremiseCheck, nothing here
  // executes body content — it only searches and pattern-matches it).
  ghSearchClosedPRs: (owner, repo, n, host) => execFileSync('gh', ['pr', 'list', '--repo', repoSlug({ host, owner, repo }), '--state', 'closed', '--search', `#${n} in:body`, '--json', 'number,url,body'], { encoding: 'utf8' }),
```

3. In `run()`, immediately after the existing premise-check block (after the `if (premise && premise.satisfiedAtBase) { ... }` block closes, before the `const facets = parseRecordFacets(...)` line), add:

```javascript
  // #2590: sibling-PR premise-disproof scan — before planning a fresh
  // investigation, check whether a closed PR already reached the same
  // "premise disproved" conclusion for this record. gh-backed path only
  // (repoSpec is null on --record-json); best-effort, never blocks.
  let siblingPremiseDisproof = null;
  if (repoSpec && typeof deps.ghSearchClosedPRs === 'function') {
    try {
      const prs = JSON.parse(deps.ghSearchClosedPRs(repoSpec.owner, repoSpec.repo, opts.n, repoSpec.host));
      siblingPremiseDisproof = findSiblingPremiseDisproof(prs);
    } catch {
      siblingPremiseDisproof = null;
    }
    if (opts.runDir) {
      try {
        deps.mkdirp(opts.runDir);
        const mainRoot = deps.mainRoot(deps.cwd());
        const decisionTarget = resolveDecisionTarget({ runDir: opts.runDir, cwd: deps.cwd(), mainRoot });
        if (decisionTarget.ok) {
          const outcome = siblingPremiseDisproof
            ? `found closed PR #${siblingPremiseDisproof.number} already stating "${siblingPremiseDisproof.matchedPhrase}"`
            : 'no closed PR found stating the premise was already disproved';
          const entry = formatEntry({
            status: 'SCANNED',
            now: Date.now(),
            step: 'materialize',
            text: `Sibling-PR premise scan for #${opts.n}: searched closed PRs referencing #${opts.n} — ${outcome}.`,
            reversibility: 'n/a',
          });
          appendEntry({ runDir: opts.runDir, section: undefined, entry });
        }
        if (siblingPremiseDisproof) {
          const stageTarget = resolveStageTarget({ runDir: opts.runDir, cwd: deps.cwd(), mainRoot });
          if (stageTarget.ok) {
            const note = `# Staged: closed sibling PR already disproved #${opts.n}'s premise\n\n`
              + `PR #${siblingPremiseDisproof.number} (${siblingPremiseDisproof.url}) was closed without merging, but its body `
              + `already states "${siblingPremiseDisproof.matchedPhrase}" — a prior attempt already reached this record's `
              + `conclusion. Proposed action: review that PR before re-running a fresh full-suite investigation for #${opts.n}.\n`;
            writeStagedItem({
              runDir: stageTarget.dir, id: `sibling-premise-disproof-${opts.n}`, sourcePath: 'note.md', content: note,
            });
          }
        }
      } catch (err) {
        deps.stderr(`materialize.js: could not log/stage the sibling-premise scan (${err && err.message ? err.message : String(err)})\n`);
      }
    }
    if (siblingPremiseDisproof) {
      deps.stderr(
        `materialize.js: Record #${opts.n} — closed PR #${siblingPremiseDisproof.number} already states the premise `
        + `is disproved ("${siblingPremiseDisproof.matchedPhrase}") — review it before re-running the investigation.\n`,
      );
    }
  }
```

4. Add `siblingPremiseDisproof` to the final JSON envelope (the `deps.stdout(JSON.stringify({...}))` call):

```javascript
  deps.stdout(JSON.stringify({
    record: opts.n, file: outFile, ceremonySource: facets.ceremony ? 'label' : 'override', surface: meta.surface || null, uiStack: meta.uiStack || null, drift, premise, siblingPremiseDisproof,
  }, null, 2) + '\n');
```

- [ ] **Step 8: Run both new test files to verify they pass**

Run: `node --test tests/bin-lib/issues/sibling-premise.test.js tests/materialize-sibling-premise.test.js`
Expected: PASS (10/10 total)

- [ ] **Step 9: Run the full existing materialize test suite to confirm no regression**

Run: `node --test tests/materialize-*.test.js tests/bin-lib/issues/materialize-format.test.js`
Expected: PASS, same count as before this change plus the 5 new sibling-premise wiring tests

- [ ] **Step 10: Commit**

```bash
git add plugin/bin/lib/issues/sibling-premise.js tests/bin-lib/issues/sibling-premise.test.js plugin/bin/materialize.js tests/materialize-sibling-premise.test.js
git commit -m "Add sibling-PR premise-disproof scan to materialize.js

refs #2590"
```

---

## Self-review

- **Spec coverage:** Deliverable ("grep closed PRs ... for language indicating the same premise-resolved conclusion, surface a hint ... at minimum logging a SCANNED decision citing the prior PR") — covered by Task 1's `findSiblingPremiseDisproof` + the SCANNED log entry + staged note. Acceptance Criteria ("flagged at materialize ... time with a citation to that PR, before the pipeline re-runs a fresh full-suite investigation from scratch") — covered: the scan runs inside `materialize.js`, which is the resolve-before-build step every `/flow`/`/build` invocation already runs first.
- **Placeholders:** none — every step has real code.
- **Type consistency:** `findSiblingPremiseDisproof` returns `{number, url, matchedPhrase} | null` everywhere it's referenced (module, materialize.js wiring, envelope field, all tests).
