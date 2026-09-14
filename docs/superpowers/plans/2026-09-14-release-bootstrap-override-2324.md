# Release Bootstrap Override (#2324) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit `--release-type <type>` / `--extra-file <path>` override to `plugin/bin/lib/init/release-bootstrap.js` and its CLI, so a repo whose real manifest is not its root stack manifest (this repo: `plugin/.claude-plugin/plugin.json`, not the stale root `package.json`) can bootstrap release-please as `simple` against the correct file.

**Architecture:** `resolveReleaseType(root)` today always runs the stack-marker scan. Add an optional second parameter carrying the override; when given, it short-circuits the scan entirely and returns the override's `releaseType`/`extraFiles` directly (validated against the existing stack vocabulary plus `simple`). `bootstrapRelease` forwards the override through, and — independently — seeds the manifest version from the override's own `--extra-file` (via the already-existing `versionOfJson` helper) instead of `readStackManifestVersion`'s 4-type lookup, since `readStackManifestVersion` has no case for `simple` or an arbitrary overridden type. The CLI wrapper gains two new optional flags, validated the same way `--integration-model` already is.

**Tech Stack:** Node.js (CommonJS), `node:test`/`node:assert/strict` (no external test framework — this repo's convention).

**Spec:** `.claude-tweaks/pipelines/2026-09-14T162728-record-2324-standalone/work/2324-spec.md` (materialized from GitHub issue #2324)

## Global Constraints

- Without the override, `resolveReleaseType`'s existing single-row stack rule is byte-for-byte unchanged — every existing test in `tests/bin-lib/init/release-bootstrap.test.js` and `tests/bin-lib/init/release-bootstrap-cli.test.js` must keep passing unmodified.
- The override's `releaseType` value must validate against the closed vocabulary: `RELEASE_STACK_TABLE`'s eight types (`node`, `python`, `rust`, `go`, `java`, `ruby`, `php`, `dotnet`) plus `simple`. An unrecognized value is a usage error at the CLI (exit 2) and a thrown error at the lib level (consistent with how `isValidBranchName` is already enforced at both layers).
- `docs/plugin-structure.md`'s CLI reference line for `release-bootstrap.js` must stay in sync with the CLI's actual flags (existing repo convention — every `bin/*.js` CLI is listed there).

---

### Task 1: Add the `--release-type` / `--extra-file` override to the lib and CLI

**Files:**
- Modify: `plugin/bin/lib/init/release-bootstrap.js:176-181` (`resolveReleaseType`), `:300-374` (`bootstrapRelease`), `:399-404` (exports)
- Modify: `plugin/bin/release-bootstrap.js` (CLI argv parsing and usage string)
- Test: `tests/bin-lib/init/release-bootstrap.test.js` (append new tests; existing tests unchanged)
- Test: `tests/bin-lib/init/release-bootstrap-cli.test.js` (append new tests; existing tests unchanged)

**Interfaces:**
- Consumes: `RELEASE_STACK_TABLE` (existing array of `{releaseType, markers}`), `versionOfJson(file)` (existing, returns a semver string or `null`), `readStackManifestVersion(root, releaseType)` (existing, unchanged) — all already defined in `plugin/bin/lib/init/release-bootstrap.js`.
- Produces: `resolveReleaseType(root, override)` — `override` is `{releaseType, extraFile} | undefined`; new optional second parameter, existing single-parameter call sites (production and test) keep working since `override` defaults to `undefined`. `RELEASE_TYPE_VALUES` — a new exported `Set` of the eight stack types plus `'simple'`, added to `module.exports` alongside the existing names, consumed by the CLI's `parseArgs` for validation (mirrors how the CLI already imports `isValidBranchName`).

- [ ] **Step 1: Write the failing lib tests**

Append to `tests/bin-lib/init/release-bootstrap.test.js` (after the existing `resolveReleaseType` tests, i.e. after line 67):

```javascript
test('resolveReleaseType: override releaseType + extraFile bypasses the stack scan entirely', () => {
  const root = tmp();
  write(root, 'package.json', '{"version":"1.0.0"}'); // would otherwise resolve to node
  write(root, 'plugin/.claude-plugin/plugin.json', '{"version":"6.121.0"}');
  const r = rb.resolveReleaseType(root, { releaseType: 'simple', extraFile: 'plugin/.claude-plugin/plugin.json' });
  assert.deepEqual(r, { releaseType: 'simple', extraFiles: [{ type: 'json', path: 'plugin/.claude-plugin/plugin.json', jsonpath: '$.version' }] });
});

test('resolveReleaseType: override releaseType alone (no extraFile) still bypasses the scan, with no extra-files', () => {
  const root = tmp();
  write(root, 'go.mod', 'module x'); // would otherwise resolve to go
  assert.deepEqual(rb.resolveReleaseType(root, { releaseType: 'node' }), { releaseType: 'node', extraFiles: [] });
});

test('resolveReleaseType: an unrecognized override releaseType throws', () => {
  const root = tmp();
  assert.throws(() => rb.resolveReleaseType(root, { releaseType: 'bogus' }), /invalid release-type/);
});

test('resolveReleaseType: no override -> unchanged single-row behavior (AC: "without the override the same fixture still resolves node")', () => {
  const root = tmp();
  write(root, 'package.json', '{"version":"1.0.0"}');
  write(root, 'plugin/.claude-plugin/plugin.json', '{"version":"6.121.0"}');
  assert.deepEqual(rb.resolveReleaseType(root), { releaseType: 'node', extraFiles: [] });
});

test('RELEASE_TYPE_VALUES: the eight stack types plus simple, nothing else', () => {
  assert.deepEqual([...rb.RELEASE_TYPE_VALUES].sort(), ['dotnet', 'go', 'java', 'node', 'php', 'python', 'ruby', 'rust', 'simple'].sort());
});
```

Append to the same file (after the existing `bootstrapRelease` tests — find the last `test(...)` block in the file and add after it):

```javascript
test('bootstrapRelease: --release-type/--extra-file override seeds the manifest from the named file, not the 4-type stack lookup (AC1)', () => {
  const root = tmp();
  write(root, 'package.json', '{"version":"1.0.0"}');
  write(root, 'plugin/.claude-plugin/plugin.json', '{"version":"6.121.0"}');
  const r = rb.bootstrapRelease({
    root, integrationModel: 'local-merge', releaseType: 'simple', extraFile: 'plugin/.claude-plugin/plugin.json', listTags: () => [],
  });
  assert.equal(r.verdict, 'fresh');
  assert.equal(r.releaseType, 'simple');
  assert.equal(r.version, '6.121.0');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'release-please-config.json'), 'utf8'));
  assert.equal(config.packages['.']['release-type'], 'simple');
  assert.deepEqual(config.packages['.']['extra-files'], [{ type: 'json', path: 'plugin/.claude-plugin/plugin.json', jsonpath: '$.version' }]);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '.release-please-manifest.json'), 'utf8'));
  assert.equal(manifest['.'], '6.121.0');
});

test('bootstrapRelease: without the override, the same fixture still resolves node (AC2)', () => {
  const root = tmp();
  write(root, 'package.json', '{"version":"1.0.0"}');
  write(root, 'plugin/.claude-plugin/plugin.json', '{"version":"6.121.0"}');
  const r = rb.bootstrapRelease({ root, integrationModel: 'local-merge', listTags: () => [] });
  assert.equal(r.releaseType, 'node');
  assert.equal(r.version, '1.0.0');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/init/release-bootstrap.test.js`
Expected: FAIL — `rb.resolveReleaseType is not a function with 2 args` / `TypeError` on the override tests (the second parameter doesn't exist yet), `rb.RELEASE_TYPE_VALUES` undefined, and the new `bootstrapRelease` override test fails because the option is silently ignored (resolves `node` instead of `simple`).

- [ ] **Step 3: Implement the lib change**

In `plugin/bin/lib/init/release-bootstrap.js`, add the type-vocabulary constant right after `RELEASE_STACK_TABLE`'s closing `];` (after line 42):

```javascript
const RELEASE_TYPE_VALUES = new Set([...RELEASE_STACK_TABLE.map((row) => row.releaseType), 'simple']);
```

Replace `resolveReleaseType` (lines 176-181):

```javascript
function resolveReleaseType(root, override) {
  if (override && override.releaseType !== undefined) {
    if (!RELEASE_TYPE_VALUES.has(override.releaseType)) {
      throw new Error(`invalid release-type override: ${override.releaseType}`);
    }
    const extraFiles = override.extraFile
      ? [{ type: 'json', path: override.extraFile, jsonpath: '$.version' }]
      : [];
    return { releaseType: override.releaseType, extraFiles };
  }
  const entries = rootEntries(root);
  const matched = RELEASE_STACK_TABLE.filter((row) => row.markers.some((m) => markerMatches(m, entries)));
  if (matched.length === 1) return { releaseType: matched[0].releaseType, extraFiles: [] };
  return { releaseType: 'simple', extraFiles: findSimpleExtraFile(root, entries) };
}
```

In `bootstrapRelease` (around line 300), add `releaseType` and `extraFile` to the destructured parameters:

```javascript
function bootstrapRelease({ root, integrationModel, branch, dryRun = false, listTags, releaseType: releaseTypeOverride, extraFile } = {}) {
```

Replace line 318-320:

```javascript
  const { releaseType, extraFiles } = resolveReleaseType(root, { releaseType: releaseTypeOverride, extraFile });
  const { tags, failure: tagsFailure } = normalizeListTagsResult((listTags || defaultListTags)(root));
  const seedSourceVersion = extraFile ? versionOfJson(path.join(root, extraFile)) : readStackManifestVersion(root, releaseType);
  const version = seedManifestVersion({ tags, manifestVersion: seedSourceVersion });
```

Add `RELEASE_TYPE_VALUES` to `module.exports` (line 400, in the same list as `RELEASE_STACK_TABLE`):

```javascript
  RELEASE_STACK_TABLE, RELEASE_TYPE_VALUES, CONFLICT_MARKERS, CONFIG_FILE, MANIFEST_FILE, WORKFLOW_FILE,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/init/release-bootstrap.test.js`
Expected: PASS — every test, old and new.

- [ ] **Step 5: Write the failing CLI tests**

Append to `tests/bin-lib/init/release-bootstrap-cli.test.js` (after the last existing test):

```javascript
test('CLI: --release-type simple --extra-file <path> overrides detection and seeds the manifest from that file (AC1)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-cli-'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"version":"1.0.0"}');
  fs.mkdirSync(path.join(root, 'plugin', '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'plugin', '.claude-plugin', 'plugin.json'), '{"version":"6.121.0"}');
  const r = run(['--root', root, '--integration-model', 'local-merge', '--release-type', 'simple', '--extra-file', 'plugin/.claude-plugin/plugin.json']);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.releaseType, 'simple');
  assert.equal(out.version, '6.121.0');
});

test('CLI: an unrecognized --release-type is a usage error naming the flag', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-cli-'));
  const r = run(['--root', root, '--integration-model', 'local-merge', '--release-type', 'bogus']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--release-type/);
});
```

- [ ] **Step 6: Run CLI tests to verify they fail**

Run: `node --test tests/bin-lib/init/release-bootstrap-cli.test.js`
Expected: FAIL — `unknown argument: --release-type` (usage error, but the test expects `status 0` for the first test and a message naming `--release-type` for the second, which won't match "unknown argument").

- [ ] **Step 7: Implement the CLI change**

In `plugin/bin/release-bootstrap.js`, update the usage string (line 14) and the header comment (line 8):

```javascript
const USAGE = 'usage: release-bootstrap.js --integration-model <pr-first|local-merge|unresolved> [--root <dir>] [--branch <name>] [--release-type <type>] [--extra-file <path>] [--dry-run]\n';
```

Import `RELEASE_TYPE_VALUES` alongside the existing import (line 6):

```javascript
const { bootstrapRelease, isValidBranchName, RELEASE_TYPE_VALUES } = require('./lib/init/release-bootstrap');
```

Add the two new flags to `VALUE_FLAGS` (line 15):

```javascript
const VALUE_FLAGS = new Set(['--root', '--branch', '--integration-model', '--release-type', '--extra-file']);
```

In `parseArgs`, add `releaseType: undefined, extraFile: undefined` to the initial `opts` object (line 17), and handle the two new flags in the `VALUE_FLAGS` branch (extend the existing `if (a === '--root') ... else if (a === '--branch') ...` chain):

```javascript
      if (a === '--root') opts.root = next;
      else if (a === '--branch') opts.branch = next;
      else if (a === '--release-type') opts.releaseType = next;
      else if (a === '--extra-file') opts.extraFile = next;
      else opts.integrationModel = next;
```

After the existing `--branch` validation (the `if (!opts.help && !isValidBranchName(opts.branch))` line), add:

```javascript
  if (!opts.help && opts.releaseType !== undefined && !RELEASE_TYPE_VALUES.has(opts.releaseType)) {
    return { error: `invalid --release-type: ${opts.releaseType}` };
  }
```

In `main`, pass the two new options through to `bootstrapRelease`:

```javascript
    const result = bootstrapRelease({
      root: opts.root, integrationModel: opts.integrationModel, branch: opts.branch, dryRun: opts.dryRun,
      releaseType: opts.releaseType, extraFile: opts.extraFile,
    });
```

- [ ] **Step 8: Run CLI tests to verify they pass**

Run: `node --test tests/bin-lib/init/release-bootstrap-cli.test.js`
Expected: PASS — every test, old and new.

- [ ] **Step 9: Run the full existing suite for this module to confirm no regressions**

Run: `node --test tests/bin-lib/init/release-bootstrap.test.js tests/bin-lib/init/release-bootstrap-cli.test.js tests/init-release-bootstrap-conformance.test.js`
Expected: PASS — all tests, including the stack-table conformance test (unchanged, since `RELEASE_STACK_TABLE` itself was not modified).

- [ ] **Step 10: Commit**

```bash
git add plugin/bin/lib/init/release-bootstrap.js plugin/bin/release-bootstrap.js tests/bin-lib/init/release-bootstrap.test.js tests/bin-lib/init/release-bootstrap-cli.test.js
git commit -m "Add --release-type/--extra-file override to release-bootstrap for repos whose real manifest isn't the root stack manifest

refs #2324"
```

---

### Task 2: Document the override as the escape hatch

**Files:**
- Modify: `plugin/skills/init/bootstrap/step-21-release.md:53`
- Modify: `docs/plugin-structure.md:170`

**Interfaces:**
- Consumes: nothing new — prose-only task, no code interfaces.
- Produces: nothing consumed by later tasks — this is the plan's last task.

- [ ] **Step 1: Update step-21-release.md's stack-table section**

In `plugin/skills/init/bootstrap/step-21-release.md`, replace line 53's parenthetical (currently: `(a repo whose only manifest is a Claude plugin manifest lands here; a repo that also carries a root package.json resolves node — this plugin's own migration, unit 8 of #2250, needs an explicit override, tracked in the run ledger)`):

```markdown
Under `simple`, `extra-files` names the first version-bearing JSON manifest found — `.claude-plugin/plugin.json`, `plugin/.claude-plugin/plugin.json`, then root `*.json` files with a top-level `version` — as `{type: json, path, jsonpath: $.version}` (a repo whose only manifest is a Claude plugin manifest lands here; a repo that also carries a root `package.json` resolves `node`). A repo whose real manifest is not its root stack manifest — this plugin's own migration (#2259) is the first consumer — uses the CLI's `--release-type <type> --extra-file <path>` override (`plugin/bin/lib/init/release-bootstrap.js`'s `resolveReleaseType`) to bypass the stack scan entirely: `--release-type` is validated against this table's types plus `simple`, and when `--extra-file` is given the manifest seed reads that file's own version instead of the stack lookup above. Without the override, this step's single-row rule is unchanged.
```

- [ ] **Step 2: Update docs/plugin-structure.md's CLI reference line**

In `docs/plugin-structure.md:170`, replace the existing line:

```
node plugin/bin/release-bootstrap.js --integration-model <pr-first|local-merge|unresolved> [--root <dir>] [--branch <name>] [--dry-run]   # Init Step 21's release bootstrap (#2253) — one JSON line {verdict, tool?, evidence?, reason?, releaseType?, version?, tagsFailure?, written[], policyRows[]}; writes release-please-config.json + .release-please-manifest.json (+ .github/workflows/release-please.yml under pr-first) on `fresh`, nothing on `already-bootstrapped`/`conflict`/`skipped`; exit 0 on every verdict, 2 usage, 1 unexpected error (`plugin/bin/lib/init/release-bootstrap.js`, tests in `tests/bin-lib/init/`)
```

with:

```
node plugin/bin/release-bootstrap.js --integration-model <pr-first|local-merge|unresolved> [--root <dir>] [--branch <name>] [--release-type <type>] [--extra-file <path>] [--dry-run]   # Init Step 21's release bootstrap (#2253) — one JSON line {verdict, tool?, evidence?, reason?, releaseType?, version?, tagsFailure?, written[], policyRows[]}; writes release-please-config.json + .release-please-manifest.json (+ .github/workflows/release-please.yml under pr-first) on `fresh`, nothing on `already-bootstrapped`/`conflict`/`skipped`; exit 0 on every verdict, 2 usage, 1 unexpected error; `--release-type`/`--extra-file` (#2324) override stack-marker detection for a repo whose real manifest isn't the root stack manifest (`plugin/bin/lib/init/release-bootstrap.js`, tests in `tests/bin-lib/init/`)
```

- [ ] **Step 3: Commit**

```bash
git add plugin/skills/init/bootstrap/step-21-release.md docs/plugin-structure.md
git commit -m "Document the release-bootstrap --release-type/--extra-file override

refs #2324"
```

---

## Self-Review

**Spec coverage:**
- Deliverables ¶1 ("Add an explicit override to the code twin and CLI... validated against the stack table's type vocabulary plus simple; when given, they replace resolveReleaseType's verdict and the manifest seed reads the named file") → Task 1, Steps 3 and 7.
- Deliverables ¶2 ("Step 21 prose: document the override as the escape hatch... and note that #2259 uses it") → Task 2, Step 1.
- Deliverables ¶3 ("Tests: override selects simple + the plugin manifest on a fixture carrying a root package.json; an unknown --release-type is a usage error; the override is reflected in the rendered config and the seeded version") → Task 1, Steps 1 and 5.
- Acceptance Criterion 1 (fixture with root `package.json` 1.0.0 + plugin manifest 6.121.0, override produces `simple` + matching `extra-files` + manifest `6.121.0`) → Task 1's `bootstrapRelease` override test and the CLI override test.
- Acceptance Criterion 2 ("Without the override the same fixture still resolves node — the single-row rule is unchanged") → Task 1's explicit no-override test on the same two-file fixture.

**Placeholders:** none — every step names the exact file, line range, and full code to write or run.

**Type consistency:** `resolveReleaseType(root, override)` is called identically in `bootstrapRelease` (Task 1 Step 3) and in every new test (Task 1 Step 1); `RELEASE_TYPE_VALUES` is defined once (lib) and consumed once (CLI's `parseArgs`), matching name in both places.
