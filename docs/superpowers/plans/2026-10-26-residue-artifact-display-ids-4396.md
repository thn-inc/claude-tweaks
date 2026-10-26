# Residue Artifact Display IDs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On every OS, the residue artifacts probe emits each finding's `subject` and each `failed` entry with `/` separators, matching its `/`-joined evidence paths.

**Architecture:** `ARTIFACT_ROOTS` becomes a list of `/`-joined display IDs. Each fs read joins the root to a native path, `path.join(root, ...rel.split('/'))`, and every display string is built with a `/` template from a root ID plus an fs entry name. This is the parity skill's rule for an ID composed from a fixed prefix and an fs entry name (`.claude/skills/windows-checkout-test-parity/SKILL.md`, "Display IDs and native paths are two contracts"). The change is display-only. Nothing persists or compares residue finding ids across runs (Deliverable 1, answered in the run's decisions.md), so the fingerprint shift on win32 needs no migration.

**Tech Stack:** Node 18+, `node:test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-26T131247-spec-4290-4285-4396/spec-4396/work/4396-spec.md`

## Global Constraints

- The fs paths the probe reads stay native. Only the strings that land in `subject`, `failed` and `reason` are `/`-joined.
- `LEGACY_ROOTS` (`screenshots`, `traces`) are single segments and stay as they are, as do `trackedState`'s `git ls-files -- <rel>` argument and the legacy `subject: rel`.
- `finding.js` stays read-only. `subject` remains a fingerprint field.
- Every `chmodSync(` under `tests/` calls `chmodDenialSkip(` or carries `// root-safe` on the line (`tests/permission-sim-root-skip-conformance.test.js`).

## Review Focus

1. A root that exists but is a file, not a directory: the probe fails loudly with the root's `/` ID and errno, on win32 too. Pinned by Task 1's ENOTDIR test.
2. An aged entry whose subtree cannot be read: the `failed` entry is `{root}/{name} ({errno})`. Pinned by Task 1's chmod test (POSIX only, since chmod does not deny on win32).
3. A Linux-only assertion cannot tell `path.join` from a `/` template, so the proof is the per-file read of a `windows-regression.yml` run. That read is Task 2.

---

### Task 1: `/`-joined display IDs in the artifacts probe

**Files:**
- Modify: `plugin/bin/lib/residue/probes/artifacts.js`
- Test: `tests/bin-lib/residue/artifacts.test.js`
- Read only: `plugin/bin/lib/residue/finding.js` (confirms `subject` is a fingerprint field; not edited)

**AC1.1:** the probe has no seam that takes a root, so the "win32-shaped relative root" is the real `.claude-tweaks/artifacts/...` roots on a `windows-latest` checkout. The tests below pin `subject` and the `failed` entry as exact `/` strings, and on win32 the old `path.join` code fails them. Task 2's per-file Windows read is the run that exercises it. A `path.win32` simulation would need a root seam added to production code purely for a test, which the parity skill's display-ID section says still cannot tell a `/` template from `path.join` on a POSIX host.

**Interfaces:**
- Produces: `probeArtifacts` and `ARTIFACT_ROOTS` exports. Add `ARTIFACT_ROOTS` to `module.exports` if it is not already there. Its value is exactly `['.claude-tweaks/artifacts/screenshots/qa', '.claude-tweaks/artifacts/screenshots/browse', '.claude-tweaks/artifacts/traces']`.

- [ ] **Step 1: Write the failing tests (AC1.1)** in `tests/bin-lib/residue/artifacts.test.js`:

```js
test('ARTIFACT_ROOTS are /-joined display IDs on every OS (#4396)', () => {
  assert.deepStrictEqual(ARTIFACT_ROOTS, [
    '.claude-tweaks/artifacts/screenshots/qa',
    '.claude-tweaks/artifacts/screenshots/browse',
    '.claude-tweaks/artifacts/traces',
  ]);
});

test('an aged-dir subject is the /-joined root ID plus the entry name (#4396)', () => {
  const root = tmpRoot();
  mkFile(path.join(root, '.claude-tweaks/artifacts/screenshots/qa/20260601_010101_abc123/shot.png'), OLD);
  const r = probeArtifacts({ cwd: root, now: NOW, run: UNTRACKED });
  assert.strictEqual(r.findings[0].subject, '.claude-tweaks/artifacts/screenshots/qa/20260601_010101_abc123');
});

test('a root that is a file fails the probe naming its /-joined ID (#4396)', () => {
  const root = tmpRoot();
  mkFile(path.join(root, '.claude-tweaks/artifacts/traces'), FRESH);
  const r = probeArtifacts({ cwd: root, now: NOW, run: UNTRACKED });
  assert.deepStrictEqual(r, { ran: false, reason: 'could not read .claude-tweaks/artifacts/traces (ENOTDIR)', findings: [] });
});

test('an unreadable aged entry is a /-joined failed entry (#4396)', chmodDenialSkip('root ignores directory permissions'), () => {
  const root = tmpRoot();
  const entry = path.join(root, '.claude-tweaks/artifacts/screenshots/qa/run1');
  mkFile(path.join(entry, 'sub/a.png'), OLD);
  fs.chmodSync(path.join(entry, 'sub'), 0o000);
  try {
    const r = probeArtifacts({ cwd: root, now: NOW, run: UNTRACKED });
    assert.deepStrictEqual(r, { ran: false, reason: 'could not read .claude-tweaks/artifacts/screenshots/qa/run1 (EACCES)', findings: [] });
  } finally {
    fs.chmodSync(path.join(entry, 'sub'), 0o755);
  }
});
```

Add `ARTIFACT_ROOTS` to the file's existing `require('../../../plugin/bin/lib/residue/probes/artifacts')` destructure.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/residue/artifacts.test.js`
Expected: FAIL. If `ARTIFACT_ROOTS` is not exported yet, its test fails on `undefined`. On this POSIX host the subject, ENOTDIR and EACCES pins may already pass, because `path.join` is the identity for `/`. That is the expected Linux blind spot, and Task 2's Windows read is their proof.

- [ ] **Step 3: Implement** in `plugin/bin/lib/residue/probes/artifacts.js`:
  - `ARTIFACT_ROOTS` becomes the three `/` literals above, with a one-line comment saying they are display IDs.
  - In the aged-dir loop, `base` becomes `path.join(root, ...rel.split('/'))`. The per-entry `failed` entry and the `subject` become `` `${rel}/${entry.name}` ``. The root-level `failed.push(`${rel} (...)`)` stays as written, since `rel` is now already `/`-joined.
  - Leave the `LEGACY_ROOTS` loop unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/residue/artifacts.test.js tests/bin-lib/residue/cli.test.js tests/permission-sim-root-skip-conformance.test.js`
Expected: PASS, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/residue/probes/artifacts.js tests/bin-lib/residue/artifacts.test.js
git commit -m "Emit the artifacts probe's subject and failed entries /-joined on every OS — #4396"
```

### Task 2: Controller verification (folded into /build Common Step 5)

- [ ] **Step 1: Verification — full suite.** `verify.js --cmd tests="npm test"`. Expected: `fail 0`.
- [ ] **Step 2: Verification — AC3.1 and AC1.1 on Windows.** `node --test tests/bin-lib/residue/*.test.js` passes on this host (ubuntu CI runs the same files). Dispatch `windows-regression.yml` on the branch after the last code change and read `verify-report.json`: `baselineAdjudicated.new` must be empty, and no `tests/bin-lib/residue/` file may be in `failingFiles`. In `tests.log`, the four new tests read `ok`, with the chmod one as `# SKIP win32: chmod does not deny access` (AC1.1's win32 proof).
- [ ] **Step 3: Verification — AC2.1.** The PR body states Deliverable 1's answer with the grep it ran (no consumer persists residue finding ids, so no migration), copied from the decisions.md `Spec Step 3 research` line.
