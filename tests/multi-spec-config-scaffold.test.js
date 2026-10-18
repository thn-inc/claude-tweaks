// tests/multi-spec-config-scaffold.test.js — pins #925's fix: a multi-spec
// run's spec-{N}/ subdirectory must carry its own copy of the parent's
// config.yml before that spec's PIPELINE_RUN_DIR is exported, or
// `resolve-policy.js --run "{parent}/spec-{N}"` silently resolves every
// Manifesto-set lever to `source: default` with no error.
//
// flow/multi-spec.md previously asserted the copy existed ("written by
// /flow in the same step that creates the subdirectory (Step 3)") but no
// step anywhere in flow/SKILL.md or flow/multi-spec.md ever actually
// performed it — Step 3 is the parent-level Manifesto, which never touches
// a spec-{N}/ subdirectory. The concrete scaffolding step lives in the
// extracted sub-file multispec-config-scaffold.md (multi-spec.md itself
// stays focused on orchestration, with the scaffolding step lazily-loaded
// on its own). Three things are pinned here: multi-spec.md cites
// the sub-file at the right ordering point, the sub-file itself states a
// concrete scaffolding step (not just an assertion) and corrects the false
// Step-3 attribution, and the underlying mechanism — resolve-policy.js
// reading whatever --run dir it's given — already resolves correctly once
// that directory actually carries a config.yml, so the fix is prose-only;
// no resolve-policy.js code change was needed or made.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MULTI_SPEC = fs.readFileSync(path.join(ROOT, 'plugin', 'skills', 'flow', 'multi-spec.md'), 'utf8');
const SCAFFOLD_SUBFILE = fs.readFileSync(path.join(ROOT, 'plugin', 'skills', 'flow', 'multispec-config-scaffold.md'), 'utf8');
const CLI = path.join(ROOT, 'plugin', 'bin', 'resolve-policy.js');
const FIXTURES = path.join(__dirname, 'fixtures', 'resolve-policy');

test("multi-spec.md cites the scaffolding sub-file at the right point", () => {
  assert.match(
    MULTI_SPEC,
    /Scaffold the per-spec subdirectory before exporting its `PIPELINE_RUN_DIR`.*multispec-config-scaffold\.md/,
    'multi-spec.md must point downstream readers to the sub-file that actually states the scaffolding step',
  );
});

test("multispec-config-scaffold.md states a concrete scaffolding step, not just an assertion", () => {
  assert.match(
    SCAFFOLD_SUBFILE,
    /cp\s+"\{parent\}\/config\.yml"\s+"\{parent\}\/spec-\{N\}\/config\.yml"/,
    'the sub-file must give the literal copy command — an assertion that a copy "exists" with no step performing it is exactly the gap #925 fixes',
  );
});

test("multispec-config-scaffold.md corrects the false Step-3 attribution", () => {
  assert.match(
    SCAFFOLD_SUBFILE,
    /Step 3 is the parent-level Manifesto[\s\S]*?which writes only the \*\*parent's\*\* `config\.yml`/,
    'Step 3 (the Manifesto) only ever wrote the parent config.yml — citing it as the copy site was itself part of the #925 gap and must not resurface',
  );
});

test("multi-spec.md orders the scaffold step before PIPELINE_RUN_DIR export", () => {
  const scaffoldIdx = MULTI_SPEC.indexOf('Scaffold the per-spec subdirectory before exporting');
  const envTableIdx = MULTI_SPEC.indexOf('For each per-spec invocation, `/flow` exports these environment variables');
  assert.ok(scaffoldIdx !== -1, 'scaffolding instruction must exist');
  assert.ok(envTableIdx !== -1, 'env-var export table must exist');
  assert.ok(scaffoldIdx < envTableIdx, 'the scaffold step must be documented before the env-var export table, matching its "before exporting PIPELINE_RUN_DIR" ordering claim');
});

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function runOk(args, cwd) {
  const res = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  assert.strictEqual(res.status, 0, `expected exit 0, got ${res.status}; stderr: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

test('AC: a scaffolded spec-{N}/ (config.yml copied per the documented step) resolves the parent\'s Manifesto value, not the schema default', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-spec-scaffold-'));
  tempDirs.push(tmp);
  const parent = path.join(tmp, 'run');
  const specDir = path.join(parent, 'spec-925');
  fs.mkdirSync(specDir, { recursive: true });
  // Mirrors the documented `cp "{parent}/config.yml" "{parent}/spec-{N}/config.yml"` step.
  fs.copyFileSync(path.join(FIXTURES, 'run-config-override.yml'), path.join(parent, 'config.yml'));
  fs.copyFileSync(path.join(FIXTURES, 'run-config-override.yml'), path.join(specDir, 'config.yml'));

  const out = runOk(['--run', specDir, 'dispatch-retry-ceiling'], tmp);
  assert.deepStrictEqual(out['dispatch-retry-ceiling'], { value: 7, source: 'run-config' });
});

test('Reproduction: an UNscaffolded spec-{N}/ (no config.yml copy) silently drops the Manifesto value to source:default', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-spec-scaffold-'));
  tempDirs.push(tmp);
  const parent = path.join(tmp, 'run');
  const specDir = path.join(parent, 'spec-925');
  fs.mkdirSync(specDir, { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, 'run-config-override.yml'), path.join(parent, 'config.yml'));
  // No config.yml written into specDir — this is the #925 failure mode.

  const out = runOk(['--run', specDir, 'dispatch-retry-ceiling'], tmp);
  assert.deepStrictEqual(out['dispatch-retry-ceiling'], { value: 3, source: 'default' });
});
