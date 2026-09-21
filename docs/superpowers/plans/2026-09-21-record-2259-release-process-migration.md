# This Repo's Migration to the New Release Process (Record #2259) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire this repo's hand-rolled `plugin/bin/release.js` tooling and adopt the shipped `/claude-tweaks:release` + release-please path instead, so this repo dogfoods the exact release engine every consumer project uses.

**Architecture:** Retro-tag the 276-line `docs/shipped-versions.tsv` history onto real annotated `v*` git tags (the tsv itself is never git-sha-accurate, so this step includes a documented, evidence-based resolution algorithm for the 25 lines that don't resolve 1:1 against a bump commit), bootstrap `release-please-config.json`/`.release-please-manifest.json`/`.github/workflows/release-please.yml` via the already-shipped `bin/lib/init/release-bootstrap.js`, add a `mirror-marketplace.yml` workflow to replace `mirror.js`'s job, then retire the old tooling — which turned out to have three real consumers the original record's Key Files list missed (`release-local.js`, `release-preflight/pack.js`, and a `post-tool-use.js` hook check) — and rewrite the docs that describe the old process.

**Tech Stack:** Node.js (`node --test`), git, GitHub Actions, `gh` CLI, release-please (`googleapis/release-please-action@v4`).

**Spec:** `.claude-tweaks/pipelines/2026-09-14T153807-record-2259-standalone/work/2259-spec.md` (archived; record #2259 on GitHub is the live copy).

## Global Constraints

- **Deliverable 6 ("first release through the new path") is explicitly out of this plan's own task list** — see the spec's Overview and Gotchas: it is a separate, post-merge action taken after the PR from Tasks 1-6 merges, because the tooling it exercises doesn't exist until that PR lands. It is documented at the end of this plan as a follow-up, not a checkbox task.
- **Never fall back to a best-guess match on retro-tag ambiguity.** An incorrect historical tag is worse than a blocked migration (spec Gotchas). Every one of the 25 non-1:1 tsv lines below is resolved with cited evidence (a `git log --all -S` exhaustive search, or a CHANGELOG entry that explicitly narrates the collision), never a guess.
- **`precheck.js` and `run.js` survive this migration** — `run.js`'s `guardReleasableTree`/`pushAfterAncestryCheck` and `precheck.js`'s `precheck`/`collectClaims`/`checkCollisions` are imported directly by the *shipped* `plugin/bin/release-local.js` (confirmed via `grep`), which every `local-merge` consumer project depends on. The original record's Key Files list named both for deletion — that is a factual error in the record, corrected here.
- **Real, previously-undocumented consumers of the "retired" modules** (found via `grep -rln` across `plugin/`, `tests/`, `docs/` — none of these were in the original record):
  - `plugin/bin/lib/release-preflight/pack.js` (the *shipped* `/claude-tweaks:release` Step 1 fact pack) imports `nextVersion` from `compose.js`.
  - `plugin/bin/lib/hooks/post-tool-use.js`'s `checkPluginVersionBump` (`#307`, the "release-bypass" nudge) imports `shipped-record.js`'s `RECORD_PATH` and checks for the `Release vX.Y.Z — ` commit-message shape and a `docs/shipped-versions.tsv` line — all three of its checks become permanently-wrong false positives once release-please's bot (different commit shape, different CHANGELOG grammar, no tsv) does every future bump. It is removed outright, not ported — see Task 5.
- Every task below runs `npm test` (or a scoped `node --test <file>`) before its commit; the full suite runs once more at the end of Task 6.

---

### Task 1: Retro-tag resolver — pure logic, fixture-tested

**Files:**
- Create: `scripts/lib/retro-tag-resolve.js`
- Test: `scripts/lib/retro-tag-resolve.test.js`

**Interfaces:**
- Produces: `resolveRetroTags(deps, { tsvLines })` → `{ resolved: [{version, sha, date, source}], tombstones: [{version, reason}], collisions: [{version, candidates: [sha], chosen: sha, reason}], unresolved: [{version, candidates: [sha]}] }`. `deps` is `{ git, iterBumpCommits, findAllVersionCommits }` (all three injectable for the fixture tests below — never a real `execFileSync` in this task's own tests).
- Consumes: nothing from an earlier task.

This is the resolution algorithm validated live against this repo's actual history before writing this plan (276 tsv lines; 251 resolved 1:1 via `iterBumpCommits(deps, 'HEAD')`; 14 exhaustive-zero-match; 11 two-candidate collisions — every candidate pair shares the same parent version and neither is an ancestor of the other, confirming they are two sessions racing for the same next version number, not a walk artifact). The rule set below is what a live `git log --all -S` search and a CHANGELOG cross-check actually proved, not a guess:

1. Exactly one bump commit for a tsv version → `resolved`.
2. Zero bump commits found by `iterBumpCommits` **and** zero commits found by an exhaustive `git log --all -S'"version": "{v}"' -- plugin/.claude-plugin/plugin.json .claude-plugin/plugin.json` → `tombstones`. This is airtight, not a guess: a version that never appears in the manifest at *any* commit, on *any* ref, was reserved (written up in CHANGELOG.md) and then reverted or renumbered before ever landing — `precheck.js`'s own `tsvTip` comment already documents this as expected ("a version can be documented (a wip-never-shipped tombstone line) without the manifest ever reaching it"). Confirmed live for all 14: `v6.75.0`'s own CHANGELOG heading literally reads "never shipped; the causal-depth-contract build's premature bump, reverted the same session."
3. Two or more bump commits for the same version → `collisions`. Pick the **chronologically later** commit (by author date) as `chosen`. Validated live against `v6.24.0` (the one case that even survives a `--first-parent`-only walk, meaning it's a genuinely rarer variant): its CHANGELOG entry states outright — *"This number shipped twice. `main`'s tip first reported 6.24.0 on 2026-07-30, then rolled back to 6.23.2 and worked forward through 6.23.7 before returning to 6.24.0 on 2026-08-02."* The later commit (`701ce72d58`, Aug 2, "/dispatch's gh-CLI/MCP bridge (closes #61)") is exactly the one whose subject matches the surviving heading text; the earlier one (`1f0bd8048a`, Jul 30) is the reverted attempt. `reason` must always cite this: `` `later of two candidates sharing parent version {parentVersion}; CHANGELOG v{version} entry: "{first ~80 chars}"` ``.
4. Three or more candidates, or a tie on author date to the second → `unresolved`, never auto-chosen. (Not observed live — all 11 real collisions are exactly 2 candidates with distinct timestamps — but the function must not silently assume this holds for a future release-history state a caller passes in.)

- [ ] **Step 1: Write the failing tests** — a small fixture graph is enough; do not touch the real repo in this task.

```javascript
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveRetroTags } = require('./retro-tag-resolve.js');

function makeDeps({ bumps, allSearchHits }) {
  return {
    iterBumpCommits: () => bumps[Symbol.iterator](),
    // Mirrors `git log --all -S'"version": "X"' ...` — returns commit shas or [].
    findAllVersionCommits: (version) => allSearchHits[version] || [],
    authorDate: (sha) => ({
      a1: '2026-01-01T10:00:00Z', a2: '2026-01-01T09:00:00Z',
      b1: '2026-02-01T10:00:00Z', b2: '2026-02-01T09:00:00Z', b3: '2026-02-01T11:00:00Z',
    }[sha]),
    parentVersion: (sha) => ({ a1: '0.9.0', a2: '0.9.0' }[sha] || null),
  };
}

test('a single bump commit resolves cleanly', () => {
  const deps = makeDeps({ bumps: [{ sha: 'x1', version: '1.0.0' }], allSearchHits: {} });
  const out = resolveRetroTags(deps, { tsvLines: [{ version: '1.0.0', date: '2026-01-01', source: 'release' }] });
  assert.deepEqual(out.resolved, [{ version: '1.0.0', sha: 'x1', date: '2026-01-01', source: 'release' }]);
  assert.deepEqual(out.tombstones, []);
  assert.deepEqual(out.collisions, []);
});

test('zero bump commits AND zero exhaustive search hits is a tombstone', () => {
  const deps = makeDeps({ bumps: [], allSearchHits: {} });
  const out = resolveRetroTags(deps, { tsvLines: [{ version: '9.9.9', date: '2026-01-01', source: 'release' }] });
  assert.equal(out.tombstones.length, 1);
  assert.equal(out.tombstones[0].version, '9.9.9');
  assert.match(out.tombstones[0].reason, /no commit.*manifest/i);
});

test('zero bump commits but a hit in the exhaustive search is NOT a tombstone — it is unresolved', () => {
  const deps = makeDeps({ bumps: [], allSearchHits: { '9.9.9': ['z1'] } });
  const out = resolveRetroTags(deps, { tsvLines: [{ version: '9.9.9', date: '2026-01-01', source: 'release' }] });
  assert.equal(out.tombstones.length, 0);
  assert.equal(out.unresolved.length, 1);
  assert.deepEqual(out.unresolved[0].candidates, ['z1']);
});

test('two candidates with the same parent version: the later-dated one is chosen, with a cited reason', () => {
  const deps = makeDeps({ bumps: [{ sha: 'a1', version: '1.1.0' }, { sha: 'a2', version: '1.1.0' }], allSearchHits: {} });
  const out = resolveRetroTags(deps, { tsvLines: [{ version: '1.1.0', date: '2026-01-01', source: 'release' }] });
  assert.equal(out.collisions.length, 1);
  assert.equal(out.collisions[0].chosen, 'a1'); // a1 = 10:00, a2 = 09:00
  assert.deepEqual(out.collisions[0].candidates.sort(), ['a1', 'a2']);
  assert.match(out.collisions[0].reason, /later of two candidates/);
});

test('three or more candidates never auto-resolve', () => {
  const deps = makeDeps({ bumps: [{ sha: 'b1', version: '2.0.0' }, { sha: 'b2', version: '2.0.0' }, { sha: 'b3', version: '2.0.0' }], allSearchHits: {} });
  const out = resolveRetroTags(deps, { tsvLines: [{ version: '2.0.0', date: '2026-02-01', source: 'release' }] });
  assert.equal(out.unresolved.length, 1);
  assert.equal(out.collisions.length, 0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test scripts/lib/retro-tag-resolve.test.js`
Expected: FAIL with "Cannot find module './retro-tag-resolve.js'"

- [ ] **Step 3: Implement**

```javascript
'use strict';

function resolveRetroTags(deps, { tsvLines }) {
  const byVersion = new Map();
  for (const b of deps.iterBumpCommits()) {
    if (!byVersion.has(b.version)) byVersion.set(b.version, []);
    byVersion.get(b.version).push(b.sha);
  }

  const resolved = [];
  const tombstones = [];
  const collisions = [];
  const unresolved = [];

  for (const line of tsvLines) {
    const candidates = byVersion.get(line.version) || [];
    if (candidates.length === 1) {
      resolved.push({ version: line.version, sha: candidates[0], date: line.date, source: line.source });
      continue;
    }
    if (candidates.length === 0) {
      const hits = deps.findAllVersionCommits(line.version);
      if (hits.length === 0) {
        tombstones.push({ version: line.version, reason: `no commit anywhere in history ever set the manifest to "version": "${line.version}" (exhaustive git log --all -S search) — a documented-but-never-committed reservation` });
      } else {
        unresolved.push({ version: line.version, candidates: hits });
      }
      continue;
    }
    if (candidates.length === 2) {
      const dated = candidates.map((sha) => ({ sha, date: deps.authorDate(sha) })).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      if (dated[0].date === dated[1].date) { unresolved.push({ version: line.version, candidates }); continue; }
      const parentVersion = deps.parentVersion(candidates[0]) || deps.parentVersion(candidates[1]);
      collisions.push({
        version: line.version,
        candidates,
        chosen: dated[0].sha,
        reason: `later of two candidates sharing parent version ${parentVersion}; verify against the CHANGELOG v${line.version} entry before applying`,
      });
      continue;
    }
    unresolved.push({ version: line.version, candidates });
  }

  return { resolved, tombstones, collisions, unresolved };
}

module.exports = { resolveRetroTags };
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test scripts/lib/retro-tag-resolve.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/retro-tag-resolve.js scripts/lib/retro-tag-resolve.test.js
git commit -m "Add retro-tag resolver: version-to-commit matching with tombstone and collision handling"
```

---

### Task 1 Fix: the "later commit wins" heuristic is wrong — replace with mandatory explicit overrides

**Why this exists:** Task 2's implementer ran the script above as a dry-run against this repo's real history and manually cross-checked all 11 collisions against their CHANGELOG entries (full findings: `.superpowers/sdd/2026-09-21-record-2259-release-process-migration/task-2-report.md`, and the ledger's Task 2 entry). The "pick the chronologically later candidate" rule (Step 3 above) is **wrong in 6 of 11 real cases** — every wrong case is a later, unrelated "merge origin/main into worktree-X" commit that incidentally inherited an already-published version number, while the true origin of that release is the *earlier* candidate, identifiable by its subject matching the CHANGELOG heading (or an explicit "renumbered to vX.Y.Z" message on the reconciling merge). One version (`v6.64.3`) isn't a collision at all — its tsv `source` column reads `wip-never-shipped` and its CHANGELOG entry confirms it never reached `main`'s tip; neither candidate should be tagged. Two more tsv lines (`4.5.0-phase1`, `4.5.0-phase2`) are real commits but non-strict-semver version strings with no dedicated CHANGELOG heading (folded into the parent `v4.5.0` entry) — not taggable at all under this project's `vX.Y.Z` tag convention.

**Files:**
- Modify: `scripts/lib/retro-tag-resolve.js`
- Modify: `scripts/lib/retro-tag-resolve.test.js`

**Interfaces:**
- Produces (replaces Task 1's original shape): `resolveRetroTags(deps, { tsvLines, overrides = {} })` → `{ resolved: [{version, sha, date, source, reason?}], excluded: [{version, reason}], unresolved: [{version, candidates}] }`. `overrides` is `{ [version]: { action: 'use', sha, reason } | { action: 'exclude', reason } }` — the caller's explicit, evidenced decision for a version the automatic logic cannot safely resolve on its own. **No automatic multi-candidate resolution survives** — a version with 2+ real candidate commits and no matching `overrides` entry always lands in `unresolved`, never auto-picked.
- Consumes: nothing new.

- [ ] **Step 1: Rewrite the test file**

```javascript
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveRetroTags } = require('./retro-tag-resolve.js');

function makeDeps({ bumps, allSearchHits }) {
  return {
    iterBumpCommits: () => bumps[Symbol.iterator](),
    findAllVersionCommits: (version) => allSearchHits[version] || [],
  };
}

test('a single bump commit resolves cleanly', () => {
  const deps = makeDeps({ bumps: [{ sha: 'x1', version: '1.0.0' }], allSearchHits: {} });
  const out = resolveRetroTags(deps, { tsvLines: [{ version: '1.0.0', date: '2026-01-01', source: 'release' }] });
  assert.deepEqual(out.resolved, [{ version: '1.0.0', sha: 'x1', date: '2026-01-01', source: 'release' }]);
  assert.deepEqual(out.excluded, []);
  assert.deepEqual(out.unresolved, []);
});

test('zero bump commits AND zero exhaustive search hits is excluded as a tombstone', () => {
  const deps = makeDeps({ bumps: [], allSearchHits: {} });
  const out = resolveRetroTags(deps, { tsvLines: [{ version: '9.9.9', date: '2026-01-01', source: 'release' }] });
  assert.equal(out.excluded.length, 1);
  assert.equal(out.excluded[0].version, '9.9.9');
  assert.match(out.excluded[0].reason, /no commit.*manifest/i);
});

test('zero bump commits but a hit in the exhaustive search is unresolved, not excluded', () => {
  const deps = makeDeps({ bumps: [], allSearchHits: { '9.9.9': ['z1'] } });
  const out = resolveRetroTags(deps, { tsvLines: [{ version: '9.9.9', date: '2026-01-01', source: 'release' }] });
  assert.equal(out.excluded.length, 0);
  assert.equal(out.unresolved.length, 1);
  assert.deepEqual(out.unresolved[0].candidates, ['z1']);
});

test('two or more candidates with NO override is always unresolved — never auto-picked', () => {
  const deps = makeDeps({ bumps: [{ sha: 'a1', version: '1.1.0' }, { sha: 'a2', version: '1.1.0' }], allSearchHits: {} });
  const out = resolveRetroTags(deps, { tsvLines: [{ version: '1.1.0', date: '2026-01-01', source: 'release' }] });
  assert.equal(out.unresolved.length, 1);
  assert.deepEqual(out.unresolved[0].candidates.sort(), ['a1', 'a2']);
});

test('an explicit "use" override resolves a multi-candidate version to the cited sha', () => {
  const deps = makeDeps({ bumps: [{ sha: 'a1', version: '1.1.0' }, { sha: 'a2', version: '1.1.0' }], allSearchHits: {} });
  const out = resolveRetroTags(deps, {
    tsvLines: [{ version: '1.1.0', date: '2026-01-01', source: 'release' }],
    overrides: { '1.1.0': { action: 'use', sha: 'a2', reason: 'CHANGELOG heading verbatim-matches a2 subject' } },
  });
  assert.equal(out.unresolved.length, 0);
  assert.deepEqual(out.resolved, [{ version: '1.1.0', sha: 'a2', date: '2026-01-01', source: 'release', reason: 'CHANGELOG heading verbatim-matches a2 subject' }]);
});

test('an explicit "exclude" override excludes regardless of candidate count', () => {
  const deps = makeDeps({ bumps: [{ sha: 'a1', version: '6.64.3' }, { sha: 'a2', version: '6.64.3' }], allSearchHits: {} });
  const out = resolveRetroTags(deps, {
    tsvLines: [{ version: '6.64.3', date: '2026-08-08', source: 'wip-never-shipped' }],
    overrides: { '6.64.3': { action: 'exclude', reason: 'tsv source is wip-never-shipped; CHANGELOG confirms it never reached main' } },
  });
  assert.equal(out.resolved.length, 0);
  assert.equal(out.excluded.length, 1);
  assert.equal(out.excluded[0].version, '6.64.3');
});

test('tsv source wip-never-shipped excludes even with no override supplied', () => {
  const deps = makeDeps({ bumps: [{ sha: 'a1', version: '6.64.3' }], allSearchHits: {} });
  const out = resolveRetroTags(deps, { tsvLines: [{ version: '6.64.3', date: '2026-08-08', source: 'wip-never-shipped' }] });
  assert.equal(out.excluded.length, 1);
  assert.match(out.excluded[0].reason, /wip-never-shipped/);
});

test('a non-strict-semver version string is excluded as not independently taggable', () => {
  const deps = makeDeps({ bumps: [{ sha: 'p1', version: '4.5.0-phase1' }], allSearchHits: {} });
  const out = resolveRetroTags(deps, { tsvLines: [{ version: '4.5.0-phase1', date: '2026-05-03', source: 'walk' }] });
  assert.equal(out.excluded.length, 1);
  assert.match(out.excluded[0].reason, /non-standard version string/);
});

test('three or more candidates with no override is unresolved', () => {
  const deps = makeDeps({ bumps: [{ sha: 'b1', version: '2.0.0' }, { sha: 'b2', version: '2.0.0' }, { sha: 'b3', version: '2.0.0' }], allSearchHits: {} });
  const out = resolveRetroTags(deps, { tsvLines: [{ version: '2.0.0', date: '2026-02-01', source: 'release' }] });
  assert.equal(out.unresolved.length, 1);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test scripts/lib/retro-tag-resolve.test.js`
Expected: FAIL — the old implementation's exports/shape (`collisions`, `tombstones`, no `overrides` param) don't match the new tests (e.g. `out.excluded` is `undefined`).

- [ ] **Step 3: Rewrite the implementation**

```javascript
'use strict';

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

function resolveRetroTags(deps, { tsvLines, overrides = {} }) {
  const byVersion = new Map();
  for (const b of deps.iterBumpCommits()) {
    if (!byVersion.has(b.version)) byVersion.set(b.version, []);
    byVersion.get(b.version).push(b.sha);
  }

  const resolved = [];
  const excluded = [];
  const unresolved = [];

  for (const line of tsvLines) {
    const override = overrides[line.version];
    if (override) {
      if (override.action === 'use') {
        resolved.push({ version: line.version, sha: override.sha, date: line.date, source: line.source, reason: override.reason });
      } else if (override.action === 'exclude') {
        excluded.push({ version: line.version, reason: override.reason });
      } else {
        throw new Error(`unknown override action for ${line.version}: ${override.action}`);
      }
      continue;
    }

    if (!SEMVER_RE.test(line.version)) {
      excluded.push({ version: line.version, reason: `non-standard version string "${line.version}" (not strict X.Y.Z) — not independently taggable under this project's vX.Y.Z convention` });
      continue;
    }

    if (line.source === 'wip-never-shipped') {
      excluded.push({ version: line.version, reason: `tsv source is wip-never-shipped — documented as never having reached main's tip, regardless of any candidate commit found` });
      continue;
    }

    const candidates = byVersion.get(line.version) || [];
    if (candidates.length === 1) {
      resolved.push({ version: line.version, sha: candidates[0], date: line.date, source: line.source });
      continue;
    }
    if (candidates.length === 0) {
      const hits = deps.findAllVersionCommits(line.version);
      if (hits.length === 0) {
        excluded.push({ version: line.version, reason: `no commit anywhere in history ever set the manifest to "version": "${line.version}" (exhaustive git log --all -S search) — a documented-but-never-committed reservation` });
      } else {
        unresolved.push({ version: line.version, candidates: hits });
      }
      continue;
    }
    // 2+ real candidates, no override: never auto-pick. Validated live against this
    // repo's own history that "pick the later commit" is wrong 6 times out of 11 —
    // an unresolved-without-override outcome is the only safe default.
    unresolved.push({ version: line.version, candidates });
  }

  return { resolved, excluded, unresolved };
}

module.exports = { resolveRetroTags };
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test scripts/lib/retro-tag-resolve.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/retro-tag-resolve.js scripts/lib/retro-tag-resolve.test.js
git commit -m "Fix retro-tag resolver: replace unreliable later-wins heuristic with mandatory explicit overrides"
```

---

### Task 2: Retro-tag this repo's real history

**Files:**
- Create: `scripts/retro-tag-history.js`
- Test: none (this script is a one-time migration tool, run once against real history; `resolveRetroTags` already has unit coverage from Task 1/Task 1 Fix — this task's own correctness is verified by its `--dry-run` report against the real repo)

**Interfaces:**
- Consumes: `resolveRetroTags` from `scripts/lib/retro-tag-resolve.js` (Task 1 Fix's shape: `{ resolved, excluded, unresolved }`, `overrides` param); `iterBumpCommits` from `plugin/bin/lib/release/status.js` (present until Task 5 retires it — this task runs *before* Task 5, per the spec's own stated ordering).
- Produces: the real `v*` tags this repo has never had; the CLI itself is not imported by anything else.

**The override map below is not a placeholder — every entry is a specific, cited finding from a real, completed investigation** (full evidence: `.superpowers/sdd/2026-09-21-record-2259-release-process-migration/task-2-report.md`, and the ledger's Task 2 entry). Ten of this repo's 276 tsv lines are real version-number collisions (two sessions independently bumping to the same next version); each is resolved here to the specific commit that is the true origin of that release, proven by one or both of: (a) the commit's own subject verbatim-matching the surviving CHANGELOG heading, or (b) an explicit "renumbered to vX.Y.Z" message on the merge that reconciles the two branches.

- [ ] **Step 1: Write the CLI**

```javascript
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveRetroTags } = require('./lib/retro-tag-resolve.js');

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const git = (a) => execFileSync('git', a, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function iterBumpCommits() {
  // Deliberately re-requires the still-live module rather than vendoring its logic —
  // this script runs once, before Task 5 deletes status.js.
  return require(path.join(repoRoot, 'plugin/bin/lib/release/status.js')).iterBumpCommits({ git }, 'HEAD');
}

function findAllVersionCommits(version) {
  try {
    const out = git(['log', '--all', '--format=%H', `-S"version": "${version}"`, '--', 'plugin/.claude-plugin/plugin.json', '.claude-plugin/plugin.json']).trim();
    return out ? out.split('\n') : [];
  } catch { return []; }
}

function commitDate(sha) { return git(['show', '--no-patch', '--format=%aI', sha]).trim().slice(0, 10); }

// Every entry below is a real, cited finding — see this task's own prose above and
// .superpowers/sdd/2026-09-21-record-2259-release-process-migration/task-2-report.md.
// Ten real collisions; v6.64.3 (wip-never-shipped) and the two 4.5.0-phase* lines need
// no entry here — resolveRetroTags excludes them on its own (source column / non-semver).
const OVERRIDES = {
  '5.5.0': { action: 'use', sha: '878dc0dec7d8ef055034acd495271d61d4160ea8', reason: 'CHANGELOG v5.5.0 heading is a verbatim match for this commit\'s subject ("Document generic issue ingestion across consumers"); the other candidate\'s content shipped as v5.6.0 per the reconciling merge 9aed4f47e\'s own message' },
  '6.19.0': { action: 'use', sha: '756b03478f24929a47cfd4808cfe2eeacda31b2d', reason: 'first-parent mainline side of the merge into v6.20.0; CHANGELOG body matches ("Shared record-staleness threshold + bucket predicates")' },
  '6.24.0': { action: 'use', sha: '701ce72d5857009e5f9ec2c9b2af8517bbb76b2b', reason: 'CHANGELOG v6.24.0 explicitly narrates: "This number shipped twice ... before returning to 6.24.0 on 2026-08-02"' },
  '6.34.0': { action: 'use', sha: '4a8441be7fe7ff34ba8e486069e2517e837dbab3', reason: 'CHANGELOG heading/body ("Skill-bloat reduction Phase 2: the Relationship table leaves the payload") matches this commit\'s content exactly' },
  '6.39.0': { action: 'use', sha: 'a6eaa653fcb941f95bdb513fc49996409e5b9193', reason: 'CHANGELOG heading "Routines report which build they resolved (closes #129)" matches this commit almost verbatim' },
  '6.39.2': { action: 'use', sha: '0881abf54d5f02cc32b11140411d1b9944c924b3', reason: 'CHANGELOG heading "One broken journey no longer pins journey-health\'s rotation (closes #131)" matches this commit\'s own subject ("renumber the journey-health Phase 0 fix to 6.39.2"); the other candidate\'s content shipped as v6.39.3 per its own successor merge 17e3d10de5' },
  '6.52.0': { action: 'use', sha: '18677cb88d5a5c7d037e7627db36b21d9231df32', reason: 'CHANGELOG v6.52.0 is entirely about "Impeccable\'s own doctor findings reach /tidy", matching this commit; the other candidate\'s content shipped as v6.53.0 per the reconciling merge 7346175de2\'s own "renumber to 6.53.0" message' },
  '6.56.0': { action: 'use', sha: '75d9f8ee5060482993ee76c23ce76d8474cca89f', reason: 'CHANGELOG v6.56.0 body matches this commit exactly (closes #148); the other candidate\'s content is separately, correctly captured as v6.57.0' },
  '6.64.1': { action: 'use', sha: 'f383e4480aab1fa69084f59f9dcd7bc1ef249004', reason: 'diff adds skills/routine/record-freshness.md and compareRoutineRecords/readRoutineRecordsAtRef, an exact match for the CHANGELOG v6.64.1 entry; branch name worktree-routine-record-freshness-190 literally encodes the entry\'s own #190 reference' },
  '6.94.0': { action: 'use', sha: '61df3e44aafcefa6e5c0969822f7ddfb1a0de8c0', reason: 'CHANGELOG v6.94.0 heading is a verbatim match for this commit\'s own subject; the other candidate is a later, unrelated worktree\'s "merge origin/main" that incidentally inherited the already-published state (confirmed: this commit is an ancestor of the other candidate)' },
};

function changelogSummary(version) {
  const changelog = fs.readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf8');
  const m = new RegExp(`^## v${version.replace(/\./g, '\\.')} — (.+)$`, 'm').exec(changelog);
  if (!m) throw new Error(`no CHANGELOG heading for v${version} — cannot compose a tag message`);
  return m[1].trim();
}

function main(argv) {
  const dryRun = argv.includes('--dry-run');
  const tsvPath = path.join(repoRoot, 'docs/shipped-versions.tsv');
  const tsvLines = fs.readFileSync(tsvPath, 'utf8').split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => { const [version, date, source] = l.split('\t'); return { version, date, source }; });

  const { resolved, excluded, unresolved } = resolveRetroTags(
    { iterBumpCommits, findAllVersionCommits },
    { tsvLines, overrides: OVERRIDES },
  );

  if (unresolved.length > 0) {
    console.error(`ABORT: ${unresolved.length} tsv line(s) could not be resolved automatically — no tags created:`);
    for (const u of unresolved) console.error(`  ${u.version}: candidates ${u.candidates.join(', ')}`);
    console.error('Add an explicit override to the OVERRIDES map above (with cited evidence) and retry — never guess.');
    return 1;
  }

  console.log(`Resolved: ${resolved.length} (${Object.keys(OVERRIDES).length} via override), ${excluded.length} excluded:`);
  for (const e of excluded) console.log(`  EXCLUDED v${e.version}: ${e.reason}`);

  console.log(`\n${resolved.length} tags to create (${tsvLines.length} tsv lines − ${excluded.length} excluded):`);
  for (const t of resolved) {
    const summary = changelogSummary(t.version);
    const tagName = `v${t.version}`;
    const date = t.date || commitDate(t.sha);
    console.log(`  ${tagName} @ ${t.sha.slice(0, 10)} (${date}) — ${summary}${t.reason ? ` [override: ${t.reason}]` : ''}`);
    if (!dryRun) {
      execFileSync('git', ['tag', '-a', tagName, t.sha, '-m', `${tagName} — ${summary}`], {
        cwd: repoRoot,
        env: { ...process.env, GIT_COMMITTER_DATE: date },
      });
    }
  }

  if (dryRun) { console.log('\n[dry-run] no tags created, nothing pushed'); return 0; }

  execFileSync('git', ['push', 'origin', '--tags'], { cwd: repoRoot, stdio: 'inherit' });
  console.log(`\nPushed ${resolved.length} tags to origin.`);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { main, OVERRIDES };
```

- [ ] **Step 2: Dry-run against the real repo**

Run: `node scripts/retro-tag-history.js --dry-run`
Expected: **exactly 259 tags to create, 0 unresolved.** (276 tsv lines − 14 confirmed tombstones − 1 `wip-never-shipped` line (`v6.64.3`) − 2 non-semver lines (`4.5.0-phase1`, `4.5.0-phase2`) = 259.) If `unresolved` is non-zero, or the count differs from 259, STOP — this means either a new release shipped since this plan was written (re-derive the numbers) or the OVERRIDES map above has a typo — do not proceed to Step 3 on a mismatch.

- [ ] **Step 3: Present the dry-run output for human sign-off — do not run Step 4 without it**

This step pushes 259 new tags to `origin` — a public, shared, effectively-irreversible action (a published tag should never be moved once others may have fetched it). Print the full dry-run output and stop for explicit confirmation before proceeding to Step 4, regardless of execution mode (auto or interactive) — this is the exact class of action `subagent-driven-development`'s own stop conditions name ("a side effect outside this worktree that norms say you ask about first... a publish").

- [ ] **Step 4: Run for real (only after Step 3's sign-off)**

Run: `node scripts/retro-tag-history.js`
Expected: 259 tags created and pushed. Verify: `git tag -l 'v*' | wc -l` reports 259 (before/after delta — confirmed live: this repo carries zero pre-existing `v*` tags today).

- [ ] **Step 5: Commit the script** (the tags themselves are pushed refs, not a commit)

```bash
git add scripts/retro-tag-history.js
git commit -m "Add and run the retro-tag script: 259 annotated v* tags for this repo's shipped history"
```

---

### Task 3: Bootstrap release-please

**Files:**
- Modify: none (the bootstrap CLI already exists and is unit-tested — `plugin/bin/release-bootstrap.js` / `plugin/bin/lib/init/release-bootstrap.js`)
- Create (via the CLI, not by hand): `release-please-config.json`, `.release-please-manifest.json`, `.github/workflows/release-please.yml`

**Interfaces:**
- Consumes: `bootstrapRelease` (already shipped, `plugin/bin/lib/init/release-bootstrap.js`) — no code changes needed here; this task is invocation only.

- [ ] **Step 1: Dry-run the bootstrap**

Run: `node plugin/bin/release-bootstrap.js --integration-model pr-first --release-type simple --extra-file plugin/.claude-plugin/plugin.json --dry-run`
Expected: `{"verdict":"fresh","releaseType":"simple","version":"6.128.0","written":["release-please-config.json",".release-please-manifest.json",".github/workflows/release-please.yml"],"policyRows":[...]}`. The version must read `6.128.0` — confirming `seedManifestVersion` picked up Task 2's newly-pushed `v6.128.0` tag (the highest `v*` tag) rather than falling through to the manifest-read path, since a `v*` tag now exists.

- [ ] **Step 2: Run for real**

Run: `node plugin/bin/release-bootstrap.js --integration-model pr-first --release-type simple --extra-file plugin/.claude-plugin/plugin.json`
Expected: the three files above are written. `.release-please-manifest.json` reads `{".": "6.128.0"}`.

- [ ] **Step 3: Add the two commented policy rows `bootstrapRelease` returned**

Append `renderPolicyRows()`'s two lines (`# release-hook: ...` and `# release-train: false`) to `.claude-tweaks/policy.yml`, commented exactly as returned — this is the documented manual landing step `init/worktree-policy-finalization.md` already performs for a normal `/claude-tweaks:init` bootstrap; do the same here by hand since this is a standalone migration, not an `/init` run.

- [ ] **Step 4: Contingency — only if Deliverable 6's later release-please PR looks wrong**

Do not do this now. If, when Task 7 (the post-merge first real release, see the bottom of this plan) actually runs, release-please's proposed PR includes commits from *before* the `v6.128.0` retro-tag (visible as an unexpectedly large commit range in its diff), add a top-level `"last-release-sha": "{the sha Task 2 tagged v6.128.0 at}"` to `release-please-config.json` and re-trigger the action (an empty commit, or the workflow's manual re-run button). This is a named, addressed risk with a concrete trigger and fix — not expected to be needed, since release-please's default behavior is to resolve the last release from the highest matching `v*` tag, which Task 2 already created with the exact name it expects (`include-component-in-tag: false` in the rendered config means bare `v{version}` tags, matching Task 2's tag names exactly).

- [ ] **Step 5: Verify and commit**

Run: `node --test tests/bin-lib/init/release-bootstrap.test.js` (confirms this task changed no code, only invoked already-tested code)
Expected: PASS, unchanged from before this task.

```bash
git add release-please-config.json .release-please-manifest.json .github/workflows/release-please.yml .claude-tweaks/policy.yml
git commit -m "Bootstrap release-please: config, manifest seeded to 6.128.0, workflow, policy rows"
```

---

### Task 4: Marketplace-mirror workflow

**Files:**
- Create: `.github/workflows/mirror-marketplace.yml`

**Interfaces:**
- Consumes: nothing from this repo's own code — a `release: published` GitHub event and the `MARKETPLACE_TOKEN` secret (Manual Steps item, still unresolved — confirmed live via `gh secret list`, which currently returns nothing for this repo).
- Produces: the same catalog write `plugin/bin/lib/release/mirror.js`'s `mirrorRelease` performs today, preserving its two invariants: `sha` (never `ref`) pin, and no `version` field in the catalog entry.

- [ ] **Step 1: Write the workflow**

```yaml
name: mirror-marketplace

on:
  release:
    types: [published]

jobs:
  mirror:
    runs-on: ubuntu-latest
    steps:
      - name: Mirror the release into the marketplace catalog
        env:
          GH_TOKEN: ${{ secrets.MARKETPLACE_TOKEN }}
          TAG: ${{ github.event.release.tag_name }}
          RESOLVED_SHA: ${{ github.sha }}
        run: |
          if [ -z "${GH_TOKEN}" ]; then
            echo "::error::MARKETPLACE_TOKEN secret is missing or empty — cannot write to thomasholknielsen/claude-tweaks-marketplace. See docs/releasing.md's Manual Steps." >&2
            exit 1
          fi
          CURRENT=$(gh api repos/thomasholknielsen/claude-tweaks-marketplace/contents/.claude-plugin/marketplace.json)
          BLOB_SHA=$(echo "$CURRENT" | jq -r '.sha')
          CONTENT=$(echo "$CURRENT" | jq -r '.content' | base64 -d)
          NEW_CONTENT=$(echo "$CONTENT" | jq --arg sha "$RESOLVED_SHA" '
            (.plugins[] | select(.name == "claude-tweaks")) |= (
              del(.version) | .source = {source: "git-subdir", url: "https://github.com/thomasholknielsen/claude-tweaks", path: "plugin", sha: $sha}
            )
          ')
          ENCODED=$(echo "$NEW_CONTENT" | base64 -w0)
          gh api -X PUT repos/thomasholknielsen/claude-tweaks-marketplace/contents/.claude-plugin/marketplace.json \
            -f "message=Mirror claude-tweaks ${TAG}" \
            -f "content=${ENCODED}" \
            -f "sha=${BLOB_SHA}" \
            -f "branch=main"
```

**Fix applied before first review completed:** the original draft resolved the release commit via `git rev-parse "${SHA}"` against `github.event.release.target_commitish` — but this job has no `actions/checkout` step, so no `.git` directory exists on the runner and that command would fail 100% of the time. Fixed by using the `github.sha` context directly (GitHub's own resolved commit SHA for the event that triggered this workflow) — this needs no checkout and no local git resolution at all, and is more precise than `target_commitish` (which for a release event is typically a branch name, not the exact release commit).

- [ ] **Step 2: Lint the workflow YAML**

Run: `node -e "require('js-yaml') ? require('js-yaml').load(require('fs').readFileSync('.github/workflows/mirror-marketplace.yml','utf8')) : (()=>{throw new Error('js-yaml not installed')})()" 2>&1 || python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/mirror-marketplace.yml'))"`
Expected: no output (valid YAML) — use whichever of the two commands finds a working YAML parser already on the machine; neither is a new dependency for this repo.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/mirror-marketplace.yml
git commit -m "Add mirror-marketplace workflow, triggered on release: published (fails loudly without MARKETPLACE_TOKEN)"
```

**AC7 note (PR description, not a code step):** whoever finalizes this PR's description must explicitly list the `MARKETPLACE_TOKEN` human precondition (the still-open ledger item from `docs/plans/2026-09-14-record-2259-ledger.md`) as a merge precondition — the mechanical work (the workflow failing loudly without it) is done by Step 1 above; naming it in the PR body is a documentation act at PR-finalization time, not a file this task touches.

---

### Task 5: Retire the old release tooling

**Files:**
- Modify: `plugin/bin/lib/changelog.js` (gains `nextVersion`)
- Modify: `plugin/bin/lib/release/precheck.js:3` (import `nextVersion` from `../changelog.js` instead of `./compose.js`)
- Modify: `plugin/bin/lib/release-preflight/pack.js:15` (same import change)
- Modify: `plugin/bin/lib/release/run.js` (drop the `runRelease` export and its now-unneeded requires of `precheck.js`, `unnamed-records.js`, `compose.js`, `mirror.js`; keep `guardReleasableTree`/`pushAfterAncestryCheck`)
- Modify: `plugin/bin/lib/hooks/post-tool-use.js` (remove `checkPluginVersionBump`, its call site, and its now-dead `MANIFEST_PATHS`/`readManifestAtRef`/`shipped-record` imports — confirmed via `grep` that nothing else in this file uses those two imports)
- Delete: `plugin/bin/release.js`
- Delete: `plugin/bin/lib/release/compose.js`, `plugin/bin/lib/release/mirror.js`, `plugin/bin/lib/release/status.js`, `plugin/bin/lib/release/unnamed-records.js`
- Delete: `plugin/bin/lib/shipped-record.js`
- Delete: `plugin/bin/lib/changelog-git.js` (added during Task 5 execution — a 4th real consumer of `shipped-record.js`, not caught by this plan's original two-more-found-during-planning note; its own only caller repo-wide was `tests/changelog-coverage.test.js`, itself deleted below, so once that test is gone this file has zero callers left anywhere — confirmed via `grep -rn "changelog-git" plugin/ tests/ docs/ scripts/` (no hits) and the repo-wide sweep `grep -rn "changelog-git" . --include="*.js" --include="*.md"` (one hit: a historical prose mention in `CHANGELOG.md`, never edited per this repo's convention). It has no dedicated test file (`find tests -iname "*changelog-git*"` → no results).)
- Delete: `docs/shipped-versions.tsv`
- Delete: `tests/bin-lib/release/compose.test.js`, `mirror.test.js`, `status.test.js`, `status-cli.test.js`, `unnamed-records.test.js`, `install-message.test.js`
- Delete: `tests/changelog-coverage.test.js`, `tests/shipped-record.test.js`
- Modify: `tests/bin-lib/release/run.test.js` (remove the 9 `runRelease`-specific tests: `'dry-run composes but writes nothing'`, `'live run: write → add → verify staged → commit → ancestor check → push → mirror, in order'`, `'the release commit sha is captured after the commit and pinned into the mirror'`, `'refuses to run off main or with a dirty tree'`, `'aborts before commit when the staged set is not exactly the release trio [IL-42]'`, `'aborts before push when origin/main moved during compose'`, and the 4 `'unnamed-records gate: ...'` tests — keep `'guardReleasableTree: branch and clean-tree checks, parameterized by branch'`, `'pushAfterAncestryCheck: fetch → ancestry → push of every ref; divergence throws the caller's message and pushes nothing'`, `'pushAfterAncestryCheck: remoteBranchExists:false pushes without the fetch or the ancestry check'`)
- Modify: `tests/changelog.test.js` (gains `nextVersion` coverage, moved from the deleted `compose.test.js`)

**Interfaces:**
- Consumes: nothing new — this task only moves/removes existing code.
- Produces: `nextVersion(current, part)` now lives on `plugin/bin/lib/changelog.js`'s existing export surface (`compareVersions`, `parseChangelogVersions`, `extractChangelogRange`, `findHeadingDefects`, `findCoverageGaps`, `nextVersion`).

- [ ] **Step 1: Move `nextVersion` into `changelog.js` and update its two real call sites**

Add to `plugin/bin/lib/changelog.js` (before its `module.exports`):

```javascript
function nextVersion(current, part) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(current).trim());
  if (!m) throw new Error(`Invalid semver version: "${current}"`);
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (part === 'major') return `${major + 1}.0.0`;
  if (part === 'minor') return `${major}.${minor + 1}.0`;
  if (part === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`part must be "major", "minor" or "patch", got "${part}"`);
}
```

Add `nextVersion` to that file's `module.exports` object.

In `plugin/bin/lib/release/precheck.js:3`, change `const { nextVersion } = require('./compose.js');` to `const { nextVersion } = require('../changelog.js');`.

In `plugin/bin/lib/release-preflight/pack.js:15`, change `const { nextVersion } = require('../release/compose.js');` to `const { nextVersion } = require('../changelog.js');`.

- [ ] **Step 2: Move `nextVersion`'s tests into `tests/changelog.test.js`**

Copy the `nextVersion` test cases out of `tests/bin-lib/release/compose.test.js` into `tests/changelog.test.js`, updating the `require` path to `../plugin/bin/lib/changelog.js` (or that file's existing relative path convention).

Run: `node --test tests/changelog.test.js`
Expected: PASS, including the moved `nextVersion` cases.

- [ ] **Step 3: Trim `run.js`**

Rewrite `plugin/bin/lib/release/run.js` to:

```javascript
'use strict';

// Reused by bin/release-local.js (#2254): the branch/clean-tree guard, and the
// fetch → ancestry re-check → push ordering. `onDiverged` is the caller's own
// partial-state message (the commit/tag already exist locally — do NOT re-run).
function guardReleasableTree(deps, { branch = 'main' } = {}) {
  const current = deps.git(['branch', '--show-current']).trim();
  if (current !== branch) throw new Error(`releases run from ${branch}; current branch is "${current}"`);
  if (deps.git(['status', '--porcelain', '--untracked-files=no']).trim() !== '') {
    throw new Error('working tree has tracked modifications — commit or restore them first');
  }
}

// `remoteBranchExists: false` — the branch is not on origin yet (release-local's
// first release into a fresh remote, #2254): there is no origin/<branch> to fetch
// or compare against, so the fetch would die with "couldn't find remote ref" and
// the ancestry check would have nothing to check. Push straight out.
function pushAfterAncestryCheck(deps, { branch = 'main', refs = [branch], onDiverged, remoteBranchExists = true }) {
  if (!remoteBranchExists) { deps.git(['push', 'origin', ...refs]); return; }
  deps.git(['fetch', 'origin', branch]);
  try {
    deps.git(['merge-base', '--is-ancestor', `origin/${branch}`, 'HEAD']);
  } catch {
    throw new Error(onDiverged);
  }
  deps.git(['push', 'origin', ...refs]);
}

module.exports = { guardReleasableTree, pushAfterAncestryCheck };
```

- [ ] **Step 4: Trim `run.test.js`**

Remove the 9 `runRelease`-specific `test(...)` blocks named in this task's Files list above (each is a top-level `test('...', () => { ... })` block — delete the whole block, its body included). Keep the 3 named `guardReleasableTree`/`pushAfterAncestryCheck` blocks and any shared setup they use. Remove now-unused fixture helpers (e.g. any mock `precheck`/`unnamedRecordsGate`/`mirrorRelease`/`compose` stand-ins) that only the deleted tests referenced.

Run: `node --test tests/bin-lib/release/run.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Remove `checkPluginVersionBump` from `post-tool-use.js`**

Delete:
- The comment block and two `require` lines at (current) lines 202-211 (`MANIFEST_PATHS`, `readManifestAtRef` from `../manifest-path`, and `RECORD_PATH: SHIPPED_RECORD_PATH` from `../shipped-record`).
- The `RELEASE_COMMIT_MESSAGE_RE` constant.
- The whole `checkPluginVersionBump(recentByDir)` function.
- Its call site: the `// Plugin-version-bump release-follow-up nudge (warn tier)` comment and the `if (hasCommand) { const versionBumpNudge = ...; if (versionBumpNudge) return versionBumpNudge; }` block.

Run: `grep -n "checkPluginVersionBump\|SHIPPED_RECORD_PATH\|RELEASE_COMMIT_MESSAGE_RE" plugin/bin/lib/hooks/post-tool-use.js`
Expected: no output.

Find and remove (or update, if it tests other functions in the same file too) this check's corresponding test cases in `tests/hooks-post-tool-use*.test.js` (grep for `checkPluginVersionBump` or `release.js.*bypassed` across `tests/` to find them — the exact file name depends on this repo's current test-file layout for `post-tool-use.js`, which this plan does not re-derive since it changes independently of this migration).

Run: `node --test tests/bin-lib/hooks/post-tool-use.test.js` (or whichever file the grep above found)
Expected: PASS, with the removed check's tests gone and every other test in the file unaffected.

- [ ] **Step 6: Delete the six retired files, their tests, and the tsv**

```bash
git rm plugin/bin/release.js
git rm plugin/bin/lib/release/compose.js plugin/bin/lib/release/mirror.js plugin/bin/lib/release/status.js plugin/bin/lib/release/unnamed-records.js
git rm plugin/bin/lib/shipped-record.js
git rm plugin/bin/lib/changelog-git.js
git rm docs/shipped-versions.tsv
git rm tests/bin-lib/release/compose.test.js tests/bin-lib/release/mirror.test.js tests/bin-lib/release/status.test.js tests/bin-lib/release/status-cli.test.js tests/bin-lib/release/unnamed-records.test.js tests/bin-lib/release/install-message.test.js
git rm tests/changelog-coverage.test.js tests/shipped-record.test.js
```

- [ ] **Step 7: Full-suite verification**

Run: `npm test`
Expected: green, with the retired suites gone and no new failures. (Pre-existing environmental failures in `tests/impeccable-plugin-contract.test.js` — confirmed unrelated to this diff, see this build's baseline — are excluded from this expectation.)

- [ ] **Step 8: Sweep for lingering references (AC6)**

Run: `grep -rn "plugin/bin/release\.js\|release/compose\.js\|release/mirror\.js\|release/status\.js\|release/unnamed-records\.js\|lib/shipped-record\|lib/changelog-git" plugin/ docs/ tests/`
Expected: zero matches outside `docs/decisions/0018-release-please-engine.md` (written in Task 6, describing the retirement historically) and `docs/incident-log.md` (pre-existing citations of past incidents, never edited by this migration). If Task 6 has not yet run, expect zero matches at all — Task 6's own ADR is the only place these names are allowed to survive as prose, and running this sweep now (before Task 6 writes it) makes that boundary visible.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Retire plugin/bin/release.js and its single-use siblings; keep run.js/precheck.js (shared with release-local.js) and relocate nextVersion into changelog.js"
```

---

### Task 6: Docs rewrite and ADR

**Files:**
- Modify: `docs/releasing.md` (full rewrite)
- Modify: `CLAUDE.md` (Versioning bullet, Releasing section's invocation line, commit-message-style bullet)
- Modify: `docs/plugin-structure.md` (CLI list)
- Modify: `CHANGELOG.md` (preamble + one boundary comment)
- Create: `docs/decisions/0018-release-please-engine.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Rewrite `docs/releasing.md`**

```markdown
# Releasing

This repo dogfoods the same release engine every consumer project uses: `/claude-tweaks:release`, driving release-please under `integration-model: pr-first`.

**The whole-branch review still gates the bump** — `/claude-tweaks:release`'s Step 3 runs `/claude-tweaks:review base:{lastTag}` unconditionally, before any merge, for the same reason this always applied: a plan that schedules its version bump as the final step has, by that ordering alone, decided that any cross-task defect ships and is fixed as a patch (`[IL-97]`).

**Invocation:** `/claude-tweaks:release` (no arguments for the on-demand path; `--train` for the scheduled release-train Routine). It reads the preflight fact pack, renders one console, merges the release-please PR via `gh pr merge --squash`, verifies the resulting tag/GitHub Release/`release: published` workflow run, and books the shipped records. Full procedure: `plugin/skills/release/SKILL.md`.

**What replaced `plugin/bin/release.js`:** release-please (`googleapis/release-please-action@v4`, `.github/workflows/release-please.yml`) computes the version from Conventional Commits on `main` and opens/updates a standing release PR; merging that PR is the bump. `release-please-config.json` pins `release-type: simple` with `plugin/.claude-plugin/plugin.json`'s `$.version` as an `extra-files` target; `.release-please-manifest.json` tracks the current version. History before the migration (bootstrapped {date}) was retro-tagged onto real `v*` git tags — see `docs/decisions/0018-release-please-engine.md`.

**The marketplace mirror** is now `.github/workflows/mirror-marketplace.yml`, triggered on `release: published` — the same catalog write `plugin/bin/lib/release/mirror.js` used to perform by hand, preserving its two invariants: the catalog entry is pinned by `sha` (never `ref`), and carries no `version` field (the payload's own `plugin/.claude-plugin/plugin.json` is the single version authority).

## After the merge: which release carried it

Unchanged — `_shared/pr-first-merge-post-merge.md` Step 4.1 answers this from tag ancestry alone:

```
git describe --tags --contains --first-parent --match 'v*' <merge-sha>
```
```

- [ ] **Step 2: `CLAUDE.md` edits**

In the Versioning bullet list, change:
`- Version lives in \`plugin/.claude-plugin/plugin.json\`` to
`- Version is the \`v*\` git tag; release-please bumps \`plugin/.claude-plugin/plugin.json\` as part of merging its release PR.`

In the Releasing section, change the invocation line to point at `/claude-tweaks:release` (no arguments) and remove the "never the consumer-facing..." carve-out sentence — that carve-out described the very state this migration ends.

In the commit-message-style bullet, append: "on `main`, release commits are release-please's own conventional-commit-shaped subjects — feature-branch commits keep the `{Verb} {what} — {detail}` style."

- [ ] **Step 3: `docs/plugin-structure.md`**

Remove the `plugin/bin/release.js` row from the CLI list. Add rows for `plugin/bin/release-local.js` and `plugin/bin/release-preflight.js` if either is missing from that list already (check first — `#2253`-`#2256` may have already added them).

- [ ] **Step 4: `CHANGELOG.md`**

Replace the current preamble (lines 1-9, from `# Changelog` through the `docs/shipped-versions.tsv` sentence) with:

```markdown
# Changelog

Every version this plugin has shipped, newest first. "Shipped" means a value the
`version` field in `.claude-plugin/plugin.json` held at the tip of `main` — the
marketplace `source` is an unpinned git URL, so an install tracks that tip, and
every distinct value it reported is a build someone could be running.

Which versions those are is now **recorded as git tags** — every entry below the
boundary comment has a matching annotated `v{version}` tag, created either by
release-please (post-migration) or by the one-time retro-tag script that ran
against this repo's pre-migration history (`docs/decisions/0018-release-please-engine.md`).
Entries above the boundary comment keep their pre-migration `## vX.Y.Z — {summary}`
heading form unchanged; entries below it are release-please-generated.
```

Insert immediately above the current newest heading (`## v6.128.0 — ...`):

```
<!-- release-please boundary: entries above this line predate the 2026-09-XX migration to release-please and keep their `## vX.Y.Z — {summary}` heading form; entries below are release-please-generated. -->
```

- [ ] **Step 5: Write the ADR**

Create `docs/decisions/0018-release-please-engine.md` recording: (1) this repo now dogfoods `/claude-tweaks:release` rather than maintaining a parallel hand-rolled engine; (2) history before the migration was retro-tagged rather than left untagged, so `git describe`-based tooling (`#2257`) works uniformly across the whole history rather than only post-migration; (3) `run.js`/`precheck.js` were kept, not retired, because they are shared with `release-local.js`; (4) the CHANGELOG keeps its pre-migration heading grammar above the boundary comment rather than being rewritten, since rewriting historical entries would misrepresent what was actually documented at the time.

- [ ] **Step 6: Verify and commit**

Run: `npm test` (confirms no prose-conformance test pins text this task just changed in a way that breaks it — if one does, update that test's expectation, since it was pinning the pre-migration prose by design)

```bash
git add docs/releasing.md CLAUDE.md docs/plugin-structure.md CHANGELOG.md docs/decisions/0018-release-please-engine.md
git commit -m "Rewrite release docs around /claude-tweaks:release; add ADR 0018"
```

---

## Post-Plan Follow-Up (not a task in this plan — do not execute as part of this build)

**Deliverable 6, "first release through the new path":** after the PR containing Tasks 1-6 merges, run `/claude-tweaks:release` for real — cutting the version that carries this very migration through the tooling it just installed. This is deliberately a separate action (the spec's own Overview and Gotchas): the tooling this step exercises does not exist until the PR above has landed, so it cannot be part of the same PR's diff. No rollback of Tasks 1-6 is planned if this step hits trouble — debug and re-run `/claude-tweaks:release` against whatever partial state it reports, per that skill's own named-partial-state-plus-recovery-command contract (`docs/superpowers/plans` is not the place to pre-script a fix-forward for a failure that hasn't happened yet).

Immediately after this real release lands, re-verify the CHANGELOG boundary comment (Task 6 Step 4) against the newly-generated real release-please entry — its own generation logic is the first thing that could disturb the comment's position, and this is the first real chance to observe that.
