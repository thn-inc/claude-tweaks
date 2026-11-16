# code-health status --fail-on refusal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `code-health.js status --fail-on` exit 2 with a one-line reason when it cannot trust the local cache, instead of passing on an absent or corrupt cache.

**Architecture:** One new helper in `plugin/bin/code-health.js`, `readGateCache(root)`, inspects `cachePath(root)` with `plugin/bin/lib/path-guard` (`lstatType`, `resolveWithin`), reads and parses it once, and returns either the cache object or a refusal reason from one table. `cmdStatus` calls it only when `--fail-on` is set; plain `status` keeps `readCache`. The CI doc states what the gate reads and its limits.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-15T210059-spec-5528-5529/spec-5529/work/5529-spec.md`

Scope keywords: `--fail-on`, `readCache(root)`

Waived tests/path-guard-conformance.test.js: run unchanged in Task 1 Step 4 to prove no `existsSync`/`realpathSync` was added; not edited.
Waived tests/bin-lib/code-health/skill-md.test.js: run unchanged in Task 2 Step 4 to prove the pinned heading survives; not edited.

## Global Constraints

- Refusal line, stderr, exactly: `status: --fail-on cannot evaluate: {path}: {reason}` followed by `\n`; nothing on stdout; exit 2.
- `{reason}` is one of exactly three strings, defined in one table in `plugin/bin/code-health.js`:
  - `no cache file (no sweep has written one under this root)`
  - `not a regular file inside the checkout`
  - `not a readable code-health cache`
- Use `cachePath` from the cache module; never rebuild the path by hand.
- No `fs.existsSync` or `fs.realpathSync` in `plugin/bin/code-health.js` (`tests/path-guard-conformance.test.js` counts them; the file has no allowlist entry).
- Plain `status` (no `--fail-on`) and the status line format are unchanged. Exit codes: 0 pass/informational, 1 gate evaluated and failed, 2 gate could not evaluate.
- Every existing case in `tests/bin-lib/code-health/status-v2.test.js` and `tests/code-health-misc/cli.test.js` passes with no edit.
- Tests assert exit code, empty stdout and the path; they do not pin the reason wording.
- Closed rule: a state fitting none of the three reasons gets a new reason added to the table, to `ci-integration.md`'s list and as a test case in the same change — a plan amendment, not a question.

## Review Focus

1. An empty (0-byte) cache file — a crashed write. Expected: refused as unreadable, exit 2. Test added in Task 1.
2. A cache whose entry value is an array (`{"a":[]}`) — `typeof` says object. Expected: refused, exit 2. Test added in Task 1.
3. A cache entry that is a string (`{"a":"open"}`). Expected: refused, exit 2. Test added in Task 1.
4. A `.claude-tweaks` path component that is a regular file (lstat gives ENOTDIR). Expected: treated as no cache file, exit 2. Test added in Task 1.
5. `--root` given as a relative path. Expected: same verdict as the absolute path; the stderr line names the path built from the given root. Covered by `resolveWithin` canonicalizing root; no extra test (the existing cwd-fallback tests exercise root resolution).

---

### Task 1: Refusal gate in cmdStatus

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/code-health.js` (imports near `:6-21`; `cmdStatus` at `:64-110`)
- Test: `tests/bin-lib/code-health/status-v2.test.js` (append new cases; do not edit existing ones)

**Interfaces:**
- Consumes: `cachePath(root)` from `./lib/code-health/cache` (re-exported, `plugin/bin/lib/code-health/cache.js:96`); `lstatType(p)` → `{ type: 'missing'|'unreadable'|'symlink'|'file'|'directory'|'other', code }` and `resolveWithin(p, root)` → resolved path or `null`, both from `./lib/path-guard`.
- Produces: `FAIL_ON_REFUSAL` (frozen object, keys `missing`, `notRegular`, `unreadable` mapping to the three reason strings) and `readGateCache(root)` → `{ ok: true, cache }` | `{ ok: false, path, reason }`. Module-private; nothing else imports them.

- [ ] **Step 1: Write the failing tests** (append to `status-v2.test.js`)

Add a helper `cacheFile(root)` = `path.join(root, '.claude-tweaks', 'code-health', 'cache.json')` and `assertRefused(result, root)`:
```js
assert.strictEqual(result.status, 2, `expected exit 2: ${result.stdout}${result.stderr}`);
assert.strictEqual(result.stdout, '');
const lines = result.stderr.split('\n').filter(Boolean);
assert.strictEqual(lines.length, 1, `expected one stderr line: ${result.stderr}`);
assert.ok(lines[0].includes(cacheFile(root)), `expected cache path in: ${lines[0]}`);
```
Tests (each on a fresh `tmp()` root):
- (AC1.1) `AC1: status --fail-on regressed and risk-high exit 2 when no cache file exists` — run both values, `assertRefused` each.
- (AC2.1) `AC2: status --fail-on regressed and risk-high exit 0 on an empty {} cache` — write `{}` to `cacheFile(root)`; each exits 0 and stdout includes `open:0 regressed:0 closed:0 wontfix:0`.
- (AC3.1) `AC3: plain status with no cache file exits 0 and prints the counts line` — `cli(['status','--root',root])` exits 0, stdout includes `open:0 regressed:0`.
- AC6, one test each, all `--fail-on regressed`, all `assertRefused`:
  - (AC6.1) `AC6: refuses a dangling symlink at the cache path` — `fs.symlinkSync(path.join(root,'nowhere.json'), cacheFile(root))`.
  - (AC6.2) `AC6: refuses a symlink to a JSON file outside the root holding a regressed entry` — outside file in a second `tmp()` with `{"x":{"status":"regressed"}}`.
  - (AC6.3) `AC6: refuses a symlink to a regular JSON file inside the root` — target `path.join(root,'real.json')` holding `{}`.
  - (AC6.4) `AC6: refuses when .claude-tweaks/code-health is a symlink to an outside directory holding cache.json` — `fs.symlinkSync(outsideDir, path.join(root,'.claude-tweaks','code-health'), 'dir')`, outside `cache.json` = `{}`.
  - (AC6.5) `AC6: refuses a directory at the cache path` — `fs.mkdirSync(cacheFile(root), { recursive: true })`.
  - (AC6.6) `AC6: refuses a cache file containing "not json"`.
  - (AC6.7) `AC6: refuses a cache file containing []`.
  - (AC6.8) `AC6: refuses a cache file containing {"a":null}`.
- Review Focus: `refuses an empty 0-byte cache file`, `refuses a cache entry that is an array ({"a":[]})`, `refuses a cache entry that is a string ({"a":"open"})`, `refuses when .claude-tweaks is a regular file` (write a file at `path.join(root,'.claude-tweaks')`).

Symlink cases are written unguarded, matching `tests/bin-lib/path-guard/path-guard.test.js` (CI allows symlinks; `.claude/skills/windows-checkout-test-parity` line 134: never skip on a setup throw). Pass `'dir'` as the type for the directory symlink so it works on win32.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test "tests/bin-lib/code-health/status-v2.test.js"`
Expected: FAIL after Step 1 — the AC1 and AC6/Review Focus cases fail (exit 0 or 1 instead of 2); AC2, AC3 and the eleven existing cases pass.

- [ ] **Step 3: Implement `readGateCache(root)` and wire it into `cmdStatus`**

In `plugin/bin/code-health.js`: import `cachePath` alongside the existing `./lib/code-health/cache` destructure and `{ lstatType, resolveWithin }` from `./lib/path-guard`. Add `FAIL_ON_REFUSAL` next to `FAIL_ON_VALUES`. `readGateCache(root)`:
- `p = cachePath(root)`; `t = lstatType(p).type`.
- `missing` → `missing`; `unreadable` → `unreadable`; anything other than `file` → `notRegular`.
- `file`: `real = resolveWithin(p, root)`; `null` → `notRegular`.
- Read `real` with `fs.readFileSync(real, 'utf8')` and `JSON.parse` inside one try; a throw → `unreadable`.
- Plain-object test: `v !== null && typeof v === 'object' && !Array.isArray(v)`; the top value and every value in it must pass, else `unreadable`.
- Return `{ ok: true, cache }` or `{ ok: false, path: p, reason: FAIL_ON_REFUSAL[key] }`.

In `cmdStatus`, after the `FAIL_ON_VALUES` check: when `failOn` is set, call `readGateCache(root)`; on `!ok` write `status: --fail-on cannot evaluate: ${path}: ${reason}\n` to `ctx.stderr` and return 2; otherwise use its `cache`. When `failOn` is unset, keep `readCache(root)`. Everything after (counts, line, exit 1 branches) is unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test "tests/bin-lib/code-health/status-v2.test.js" "tests/code-health-misc/cli.test.js" "tests/path-guard-conformance.test.js"`
Expected: PASS — the three existing exit-1 cases (AC4.1) and every other existing case in both files (AC5.1) pass with zero edits to existing cases (`git diff` on the two status test files shows additions only).

Proof(public-contract): the exit-code contract change is pinned both ways — AC4/AC5's existing exit-0/exit-1 cases in `status-v2.test.js` and `code-health-misc/cli.test.js` pass with no edit, and the new AC1/AC6 cases pin exit 2 with empty stdout; Task 2 documents exit 2 and the PR description states the silent-pass-to-exit-2 behaviour change for CI jobs and other-worktree hooks.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/code-health.js tests/bin-lib/code-health/status-v2.test.js
git commit -m "Refuse code-health status --fail-on on an untrusted cache — exit 2 with the cache path and a reason"
```

### Task 2: Correct the CI gating documentation

**Role:** integration

**Files:**
- Modify: `plugin/skills/code-health/ci-integration.md:5-22` (Regression and Risk Gating section only)

**Interfaces:**
- Consumes: Task 1's three reason strings and exit-2 behaviour (verbatim from Global Constraints).
- Produces: nothing code consumes; `tests/bin-lib/code-health/skill-md.test.js` pins the `## Regression and Risk Gating` heading, which stays.

- [ ] **Step 1: Write the section text**

Opening sentence names the local, git-ignored cache (`.claude-tweaks/code-health/cache.json`) under `--root` or the current directory. Then: each checkout and linked worktree has its own cache, so a hook that runs elsewhere passes `--root` naming the checkout the sweep ran in. The two existing exit-code bullets change from "exits `0` otherwise" to "exits `0` when the cache is accepted and no entry matches", each pointing to the exit-2 bullet. Exit-code list adds: `2` — the gate could not evaluate (unrecognized `--fail-on` value, or the cache is not accepted), a setup problem, not a finding, with the three reasons listed verbatim. Limits: the gate cannot tell a stale cache from a fresh one, and it is not suited to a fresh CI checkout (no sweep has written a cache there, so it exits 2). Keep the two example commands.

- [ ] **Step 2: Verify the section fails the AC7 checks before the edit**

Run: `grep -n "stale" "plugin/skills/code-health/ci-integration.md"`
Expected: FAIL (no match, exit 1) before the edit.

- [ ] **Step 3: Edit the section** per Step 1.

- [ ] **Step 4: Verify**

Run: `grep -n -E "stale|--root|exits .2.|git-ignored" "plugin/skills/code-health/ci-integration.md"` then `node --test "tests/bin-lib/code-health/skill-md.test.js"`
Expected: matches for each term inside the Regression and Risk Gating section (AC7.1: local cache in the opening sentence, exit 2 and its meaning, `--root` for another worktree, stale cache not detected); skill-md tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/code-health/ci-integration.md
git commit -m "Say what code-health status --fail-on reads — local cache, --root for other worktrees, exit 2, no staleness check"
```
