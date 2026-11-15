'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync, execFileSync } = require('child_process');
const { readText } = require('../../helpers/read-skill');
const { tmpDir, runCli, tmpGitRepo, nodeCmd, scopedRepo, stampOf, commitFile } = require('./cli-helpers');

// #3002: one chunked `--no-stamp --stamp-suite` invocation covering a single --cmd.
function runStampSuiteChunk(r, cmd) {
  return runCli(['--scope', r.declPath, '--integration-branch', r.branch, '--no-stamp', '--stamp-suite', '--cmd', cmd], { cwd: r.repo });
}

test('--stamp-suite composes verifiedHead:true from two chunked, otherwise-partial runs (#3002 AC1)', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  // Chunk 1: only the `unit` check, --no-stamp (a partial --cmd set) plus
  // --stamp-suite — earns `unit` a per-suite record without ever touching
  // the single full-set stamp.
  const chunk1 = await runStampSuiteChunk(r, `unit=${r.unitCmd}`);
  assert.strictEqual(chunk1.code, 0, chunk1.stderr);
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify-pass.json')), 'a partial chunk never writes the single full-set stamp');
  const midway = JSON.parse((await runCli(['--stamp-status', '--scope', r.declPath], { cwd: r.repo })).stdout);
  assert.strictEqual(midway.verifiedHead, false, 'only one of two declared suites has a record so far');
  assert.deepStrictEqual(midway.suiteComposed, { declared: ['unit', 'other'], covered: ['unit'], missing: ['other'], complete: false });

  // Chunk 2: the other declared check, same pattern.
  const chunk2 = await runStampSuiteChunk(r, 'other=node -e 0');
  assert.strictEqual(chunk2.code, 0, chunk2.stderr);
  const after = JSON.parse((await runCli(['--stamp-status', '--scope', r.declPath], { cwd: r.repo })).stdout);
  assert.strictEqual(after.verifiedHead, true, 'both declared checks now have a passing record at this clean HEAD (#3002 AC1)');
  assert.deepStrictEqual(after.suiteComposed, { declared: ['unit', 'other'], covered: ['unit', 'other'], missing: [], complete: true });
  assert.strictEqual(after.match, false, 'suite-composed verification is never the single full-set match (#3043/#3129\'s own distinction)');
});

test('--stamp-status --scope reports verifiedHead:false when a declared check has no record yet (#3002 AC2)', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  await runStampSuiteChunk(r, `unit=${r.unitCmd}`);
  const status = JSON.parse((await runCli(['--stamp-status', '--scope', r.declPath], { cwd: r.repo })).stdout);
  assert.strictEqual(status.verifiedHead, false);
  assert.deepStrictEqual(status.suiteComposed.missing, ['other']);
});

test('a per-suite record from an earlier sha does not count, even after the missing check later passes (#3002 AC3)', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  await runStampSuiteChunk(r, `unit=${r.unitCmd}`);
  commitFile(r, 'src/a.js', '1'); // HEAD moves — the `unit` record now names a stale sha
  await runStampSuiteChunk(r, 'other=node -e 0');
  const status = JSON.parse((await runCli(['--stamp-status', '--scope', r.declPath], { cwd: r.repo })).stdout);
  assert.strictEqual(status.verifiedHead, false);
  assert.deepStrictEqual(status.suiteComposed.missing, ['unit'], '`unit`\'s record from the OLD sha must not count at the new HEAD');
});

test('a failing chunk clears that check\'s own per-suite record (#3002 Deliverable 3)', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  await runStampSuiteChunk(r, `unit=${r.unitCmd}`);
  await runStampSuiteChunk(r, 'other=node -e 0');
  const complete = JSON.parse((await runCli(['--stamp-status', '--scope', r.declPath], { cwd: r.repo })).stdout);
  assert.strictEqual(complete.verifiedHead, true);
  // Re-run `unit` and have it fail at the SAME HEAD — its own record must be
  // cleared, not left as a stale pass.
  const failing = await runStampSuiteChunk(r, 'unit=node -e "process.exit(1)"');
  assert.notStrictEqual(failing.code, 0);
  const after = JSON.parse((await runCli(['--stamp-status', '--scope', r.declPath], { cwd: r.repo })).stdout);
  assert.strictEqual(after.verifiedHead, false);
  assert.deepStrictEqual(after.suiteComposed.missing, ['unit']);
});

test('a failing chunk with preExisting declared still clears its record, with no crash (#4040)', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }], { preExisting: ['tests/known-shallow.test.js'] });
  await runStampSuiteChunk(r, `unit=${r.unitCmd}`);
  await runStampSuiteChunk(r, 'other=node -e 0');
  const complete = JSON.parse((await runCli(['--stamp-status', '--scope', r.declPath], { cwd: r.repo })).stdout);
  assert.strictEqual(complete.verifiedHead, true);
  // A failure whose output names a file, so the pre-existing adjudication
  // reaches its new/fixed split. Inside .git/ so the tree stays clean and the
  // run is allowed to clear the record.
  const tap = ['not ok 1 - a new failure', '  ---', '  stack: |-', '    at TestContext.<anonymous> (tests/new-break.test.js:12:5)', '  ...', '# tests 1', '# pass 0', '# fail 1'].join('\n');
  const failScript = path.join(r.gitDir, 'fail.js');
  fs.writeFileSync(failScript, `process.stdout.write(${JSON.stringify(tap)} + '\\n'); process.exit(1);\n`);
  const failing = await runStampSuiteChunk(r, `unit=node ${JSON.stringify(failScript)}`);
  assert.strictEqual(failing.code, 1, failing.stderr);
  assert.doesNotMatch(failing.stderr, /TypeError/);
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.strictEqual(report.preExistingAdjudicated.fixed, null);
  assert.strictEqual(report.preExistingAdjudicated.fixedReason, 'scope mode stamp-suite did not run every suite');
  const after = JSON.parse((await runCli(['--stamp-status', '--scope', r.declPath], { cwd: r.repo })).stdout);
  assert.strictEqual(after.verifiedHead, false);
  assert.deepStrictEqual(after.suiteComposed.missing, ['unit']);
});

test('a plain --no-stamp partial run with no --stamp-suite writes no per-suite records at all (#3002 AC4)', async () => {
  const r = tmpGitRepo();
  const run = await runCli(['--no-stamp', '--cmd', 'tests=node -e 0'], { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify-suites.json')));
});

// #4006: bare --stamp-status discovers .claude-tweaks/verify-scope.json at the
// checkout root, so every gate that reads bare status sees the composed and
// generated-exempt verdicts without having to pass --scope. (Inverts #3002's
// pin that a bare --stamp-status never looks at per-suite records.)
async function bareStatus(r, cwd = r.repo) {
  return JSON.parse((await runCli(['--stamp-status'], { cwd })).stdout);
}

test('AC1.1: bare --stamp-status composes two chunked per-suite records via the discovered default declaration', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  await runStampSuiteChunk(r, `unit=${r.unitCmd}`);
  await runStampSuiteChunk(r, 'other=node -e 0');
  const s = await bareStatus(r);
  assert.strictEqual(s.verifiedHead, true, 'no full stamp was ever written — the composed per-suite records are what verify HEAD');
  assert.strictEqual(s.suiteComposed.complete, true);
  assert.strictEqual(s.match, false);
  assert.strictEqual(s.present, false);
  assert.strictEqual(s.scopeError, null);
});

test('AC2.1: bare --stamp-status with one of two chunks names the uncovered check', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  await runStampSuiteChunk(r, `unit=${r.unitCmd}`);
  const s = await bareStatus(r);
  assert.strictEqual(s.verifiedHead, false);
  assert.deepStrictEqual(s.suiteComposed.missing, ['other']);
  assert.strictEqual(s.scopeError, null);
});

test('AC3.1: bare --stamp-status re-derives the generated exemption from the discovered declaration', async () => {
  const r = scopedRepo(
    [{ match: 'src/**', suites: ['unit'], static: true }],
    { generated: ['dist/**'] },
  );
  commitFile(r, 'dist/bundle.js', 'v1');
  const run = await runCli(['--scope', r.declPath, '--integration-branch', r.branch, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0'], { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  assert.strictEqual(stampOf(r.gitDir).dirty, false, 'a clean full stamp at this HEAD');
  fs.writeFileSync(path.join(r.repo, 'dist', 'bundle.js'), 'v2-regenerated'); // dirtied after the stamp
  const s = await bareStatus(r);
  assert.strictEqual(s.dirty, true);
  assert.strictEqual(s.verifiedHead, true);
  assert.deepStrictEqual(s.liveGeneratedExempt, ['dist/bundle.js']);
});

test('AC4.1: bare --stamp-status in a repo with no declaration is unchanged', async () => {
  const r = tmpGitRepo();
  const run = await runCli(['--cmd', 'tests=node -e 0'], { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  const s = await bareStatus(r);
  assert.strictEqual(s.suiteComposed, null);
  assert.strictEqual(s.liveGeneratedExempt, null);
  assert.strictEqual(s.scopeError, null, 'a missing default file is silent — never reported as a scopeError');
  assert.strictEqual(s.verifiedHead, true);
  assert.strictEqual(s.match, true);
  assert.deepStrictEqual(Object.keys(s), [
    'present', 'sha', 'head', 'dirty', 'scope', 'fullSha', 'match', 'verifiedHead', 'baselineAdjudicated',
    'preExistingAdjudicated', 'reportPath', 'legacy', 'suiteComposed', 'generatedExempt', 'liveGeneratedExempt', 'scopeError',
  ]);
});

test('AC5.1: an unreadable default declaration reports scopeError, exits 0, and keeps the single-stamp verdict', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  // Unparseable JSON: commit it, then one unscoped full pass so a clean single
  // stamp exists at the new HEAD for the verdict to fall back on.
  fs.writeFileSync(path.join(r.repo, r.declPath), '{ not json');
  r.git('add', r.declPath);
  r.git('commit', '-q', '-m', 'break the declaration');
  const full = await runCli(['--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0'], { cwd: r.repo });
  assert.strictEqual(full.code, 0, full.stderr);
  const run = await runCli(['--stamp-status'], { cwd: r.repo });
  assert.strictEqual(run.code, 0, 'status is data — still exit 0');
  const s = JSON.parse(run.stdout);
  assert.match(s.scopeError, /could not parse JSON/);
  assert.strictEqual(s.suiteComposed, null);
  assert.strictEqual(s.verifiedHead, true, 'falls back to the single full stamp');
  assert.strictEqual(s.match, true);

  // Valid JSON the declaration reader still refuses: a generated glob covering the declaration itself.
  const r2 = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }], { generated: ['**'] });
  const run2 = await runCli(['--stamp-status'], { cwd: r2.repo });
  assert.strictEqual(run2.code, 0);
  const s2 = JSON.parse(run2.stdout);
  assert.match(s2.scopeError, /generated: "\*\*" would also cover \.claude-tweaks\/verify-scope\.json itself/);
  assert.strictEqual(s2.suiteComposed, null);
});

// #4006 review: a discovered declaration is trusted only when it resolves
// inside the checkout — one reached through a symlink to an out-of-tree file
// could change without dirtying the tree under a verdict that reads verified.
const SYMLINK_SKIP = { skip: process.platform === 'win32' && 'win32: creating a symlink needs extra privileges' };

// Replace the committed declaration with a committed symlink to `target`.
function symlinkDeclaration(r, target) {
  fs.rmSync(path.join(r.repo, r.declPath));
  fs.symlinkSync(target, path.join(r.repo, r.declPath));
  r.git('add', r.declPath);
  r.git('commit', '-q', '-m', 'declaration via symlink');
}

test('a discovered declaration symlinked to a file outside the checkout is reported, never composed', SYMLINK_SKIP, async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  const outside = path.join(tmpDir(), 'verify-scope.json');
  fs.copyFileSync(path.join(r.repo, r.declPath), outside);
  symlinkDeclaration(r, outside);
  await runStampSuiteChunk(r, `unit=${r.unitCmd}`);
  await runStampSuiteChunk(r, 'other=node -e 0');
  const s = await bareStatus(r);
  assert.match(s.scopeError, /does not resolve to a path inside this checkout/);
  assert.strictEqual(s.suiteComposed, null, 'an out-of-tree declaration never feeds composition');
  assert.strictEqual(s.verifiedHead, false, 'both chunks recorded passes, but only against an untrusted declaration');
});

test('a dangling discovered declaration symlink is reported, not silent', SYMLINK_SKIP, async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  symlinkDeclaration(r, path.join(r.repo, '.claude-tweaks', 'nowhere.json'));
  const s = await bareStatus(r);
  assert.match(s.scopeError, /does not resolve to a path inside this checkout/);
  assert.strictEqual(s.suiteComposed, null);
});

test('a discovered declaration symlinked to a file inside the checkout composes as usual', SYMLINK_SKIP, async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  const inside = '.claude-tweaks/verify-scope.real.json';
  fs.copyFileSync(path.join(r.repo, r.declPath), path.join(r.repo, inside));
  r.git('add', inside);
  symlinkDeclaration(r, 'verify-scope.real.json');
  await runStampSuiteChunk(r, `unit=${r.unitCmd}`);
  await runStampSuiteChunk(r, 'other=node -e 0');
  const s = await bareStatus(r);
  assert.strictEqual(s.scopeError, null);
  assert.strictEqual(s.suiteComposed.complete, true);
  assert.strictEqual(s.verifiedHead, true);
});

test('AC6.1: an explicit --scope composes against that path, not the default file', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  commitFile(r, '.claude-tweaks/other.json', JSON.stringify({
    checks: { tests: { unit: 'placeholder' } },
    rules: [{ match: 'src/**', suites: ['unit'], static: true }],
  }));
  await runStampSuiteChunk(r, `unit=${r.unitCmd}`);
  const explicit = JSON.parse((await runCli(['--stamp-status', '--scope', '.claude-tweaks/other.json'], { cwd: r.repo })).stdout);
  assert.deepStrictEqual(explicit.suiteComposed.declared, ['unit']);
  assert.strictEqual(explicit.suiteComposed.complete, true);
  const bare = await bareStatus(r);
  assert.strictEqual(bare.suiteComposed.complete, false, 'the default file declares `other` too, which has no record');
});

test('AC7.1: a foreign --git-dir with no --scope skips discovery silently', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  await runStampSuiteChunk(r, `unit=${r.unitCmd}`);
  await runStampSuiteChunk(r, 'other=node -e 0');
  const other = tmpGitRepo();
  const s = JSON.parse((await runCli(['--stamp-status', '--git-dir', other.gitDir], { cwd: r.repo })).stdout);
  assert.strictEqual(s.suiteComposed, null);
  assert.strictEqual(s.scopeError, null);
  assert.strictEqual(s.verifiedHead, false);
});

test('AC9.1: review Step 1.5\'s literal stamp-status command reads verifiedHead:true on composed records', async () => {
  const pluginRoot = path.join(__dirname, '..', '..', '..', 'plugin');
  const steps = readText(path.join(pluginRoot, 'skills', 'review', 'code-mode-steps.md'));
  const section = steps.split('### Standalone (outside `/claude-tweaks:flow`):')[1];
  assert.ok(section, 'the Standalone heading exists in code-mode-steps.md');
  const block = section.match(/```bash\n([^\n]+)\n```/);
  assert.ok(block, 'a bash block follows the Standalone heading');
  const cmd = block[1];
  assert.strictEqual(cmd, 'node "${CLAUDE_PLUGIN_ROOT}/bin/verify.js" --stamp-status');
  // The /flow pipeline branch runs its read inline, not in a fenced block — pin it to the
  // same command so a flag added there (a --git-dir, say) cannot silently skip discovery.
  const flowBranch = steps.split('### Standalone (outside `/claude-tweaks:flow`):')[0];
  const inline = flowBranch.match(/read of the runner's own artifact \(#1921\) — `([^`]+)`/);
  assert.ok(inline, 'the /flow branch names its inline stamp-status read');
  assert.strictEqual(inline[1], cmd, 'the /flow branch runs the same bare stamp-status command');
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  await runStampSuiteChunk(r, `unit=${r.unitCmd}`);
  await runStampSuiteChunk(r, 'other=node -e 0');
  const out = spawnSync('sh', ['-c', cmd], { cwd: r.repo, encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot } });
  assert.strictEqual(out.status, 0, out.stderr);
  assert.strictEqual(JSON.parse(out.stdout).verifiedHead, true);
});

test('#4006: discovery resolves from a subdirectory of the checkout', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  await runStampSuiteChunk(r, `unit=${r.unitCmd}`);
  await runStampSuiteChunk(r, 'other=node -e 0');
  const sub = path.join(r.repo, 'src');
  fs.mkdirSync(sub);
  const s = await bareStatus(r, sub);
  assert.strictEqual(s.suiteComposed.complete, true);
  assert.strictEqual(s.scopeError, null);
});

test('#4006: discovery never counts a stale-sha per-suite record', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  await runStampSuiteChunk(r, `unit=${r.unitCmd}`);
  await runStampSuiteChunk(r, 'other=node -e 0');
  commitFile(r, 'src/a.js', '1'); // HEAD moves — both records now name a stale sha
  const s = await bareStatus(r);
  assert.strictEqual(s.verifiedHead, false);
  assert.deepStrictEqual(s.suiteComposed.missing, ['unit', 'other']);
});

test('#4006: discovery with a non-generated dirty path stays unverified', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  await runStampSuiteChunk(r, `unit=${r.unitCmd}`);
  await runStampSuiteChunk(r, 'other=node -e 0');
  fs.writeFileSync(path.join(r.repo, 'notes.txt'), 'uncommitted');
  const s = await bareStatus(r);
  assert.strictEqual(s.verifiedHead, false);
  assert.strictEqual(s.suiteComposed.complete, false);
});

test('a check that regenerates a declared generated file from a clean start still earns a clean stamp — the end-of-run read carries the exemption (#2987)', async () => {
  const r = scopedRepo(
    [{ match: 'src/**', suites: ['unit'], static: true }],
    { generated: ['dist/**'] },
  );
  commitFile(r, 'dist/bundle.js', 'v1');
  const regen = 'other=node -e "require(\'fs\').writeFileSync(\'dist/bundle.js\',\'v2\')"';
  const run = await runCli(['--scope', r.declPath, '--integration-branch', r.branch, '--cmd', `unit=${r.unitCmd}`, '--cmd', regen], { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  assert.strictEqual(fs.readFileSync(path.join(r.repo, 'dist', 'bundle.js'), 'utf8'), 'v2', 'the check really regenerated the file');
  const stamp = stampOf(r.gitDir);
  assert.strictEqual(stamp.dirty, false);
  assert.deepStrictEqual(stamp.generatedExempt, ['dist/bundle.js']);
});

test('a --stamp-suite chunk on a tree dirty outside the generated paths writes no record and says why (#3002 AC3)', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  fs.writeFileSync(path.join(r.repo, 'notes.txt'), 'uncommitted');
  const chunk = await runStampSuiteChunk(r, `unit=${r.unitCmd}`);
  assert.strictEqual(chunk.code, 0, chunk.stderr);
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify-suites.json')), 'no per-suite record against a dirty tree');
  assert.match(chunk.stdout, /CAVEAT: --stamp-suite recorded no per-suite pass this run — the working tree is dirty outside any declared `generated` path/);
});

test('--stamp-suite chunks compose on a tree whose only dirty paths are declared generated ones (#2987 + #3002)', async () => {
  const r = scopedRepo(
    [{ match: 'src/**', suites: ['unit'], static: true }],
    { generated: ['dist/**'] },
  );
  commitFile(r, 'dist/bundle.js', 'v1');
  fs.writeFileSync(path.join(r.repo, 'dist', 'bundle.js'), 'v2-regenerated');
  for (const cmd of [`unit=${r.unitCmd}`, 'other=node -e 0']) {
    const chunk = await runStampSuiteChunk(r, cmd);
    assert.strictEqual(chunk.code, 0, chunk.stderr);
    assert.doesNotMatch(chunk.stdout, /CAVEAT: --stamp-suite/);
  }
  const status = JSON.parse((await runCli(['--stamp-status', '--scope', r.declPath], { cwd: r.repo })).stdout);
  assert.strictEqual(status.suiteComposed.complete, true);
  assert.strictEqual(status.verifiedHead, true);
});

test('--stamp-status --scope naming a missing declaration reports scopeError instead of looking like no --scope at all', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  const run = await runCli(['--stamp-status', '--scope', '.claude-tweaks/missing.json'], { cwd: r.repo });
  assert.strictEqual(run.code, 0, 'status is data — still exit 0');
  const status = JSON.parse(run.stdout);
  assert.match(status.scopeError, /no declaration at .*missing\.json/);
  assert.strictEqual(status.suiteComposed, null);
  const ok = JSON.parse((await runCli(['--stamp-status', '--scope', r.declPath], { cwd: r.repo })).stdout);
  assert.strictEqual(ok.scopeError, null);
});

test('--stamp-status --scope naming an unparseable declaration reports scopeError', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  fs.writeFileSync(path.join(r.repo, '.claude-tweaks', 'broken.json'), '{ not json');
  const status = JSON.parse((await runCli(['--stamp-status', '--scope', '.claude-tweaks/broken.json'], { cwd: r.repo })).stdout);
  assert.match(status.scopeError, /could not parse JSON/);
  assert.strictEqual(status.suiteComposed, null);
});

test('--stamp-status --scope under a foreign --git-dir reports the ignored --scope in scopeError', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  const other = tmpGitRepo();
  const status = JSON.parse((await runCli(['--stamp-status', '--scope', r.declPath, '--git-dir', other.gitDir], { cwd: r.repo })).stdout);
  assert.match(status.scopeError, /--scope: ignored — --git-dir names another checkout/);
  assert.strictEqual(status.suiteComposed, null);
});

test('a --scope declaration at a non-default path whose generated glob covers itself is a usage error (#2987)', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  const decl = JSON.parse(fs.readFileSync(path.join(r.repo, r.declPath), 'utf8'));
  commitFile(r, 'ci/scope.json', JSON.stringify({ ...decl, generated: ['ci/**'] }));
  const run = await runCli(['--scope', 'ci/scope.json', '--integration-branch', r.branch, '--cmd', `unit=${r.unitCmd}`], { cwd: r.repo });
  assert.strictEqual(run.code, 2, run.stdout);
  assert.match(run.stderr, /"ci\/\*\*" would also cover ci\/scope\.json itself/);
});

test('a --stamp-suite chunk whose HEAD moves mid-run writes no record and says why (#3002)', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  const chunk = await runStampSuiteChunk(r, 'unit=git commit -q --allow-empty -m mid-run && node -e 0');
  assert.strictEqual(chunk.code, 0, chunk.stderr);
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify-suites.json')), 'no per-suite record for a moved tree');
  assert.match(chunk.stdout, /CAVEAT: --stamp-suite recorded no per-suite pass this run — the tree moved during the run/);
});

test('a --stamp-suite chunk whose record write fails says so instead of passing silently (#3002)', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  // A directory where the records file belongs makes the atomic rename fail.
  fs.mkdirSync(path.join(r.gitDir, 'claude-tweaks-verify-suites.json'));
  const chunk = await runStampSuiteChunk(r, `unit=${r.unitCmd}`);
  assert.strictEqual(chunk.code, 0, chunk.stderr);
  assert.match(chunk.stdout, /CAVEAT: --stamp-suite recorded no per-suite pass this run — the record write failed: /);
});

test('--changed-files prints {base, files} = committed-since-anchor ∪ working tree, anchored on the stamp fullSha (#1923 AC2)', async () => {
  const r = tmpGitRepo();
  const branch = r.git('symbolic-ref', '--short', 'HEAD').trim();
  const full = await runCli(['--cmd', 'tests=node -e 0'], { cwd: r.repo });
  assert.strictEqual(full.code, 0, full.stderr);
  const anchor = stampOf(r.gitDir).fullSha;
  commitFile(r, 'src/a.js', '1');
  fs.writeFileSync(path.join(r.repo, 'notes.txt'), 'uncommitted');
  const run = await runCli(['--changed-files', '--integration-branch', branch], { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  const out = JSON.parse(run.stdout.trim());
  assert.strictEqual(out.base, anchor);
  // files is sorted by contract (changed-files.js returns [...set].sort()), so the order is asserted deliberately.
  assert.deepStrictEqual(out.files, ['notes.txt', 'src/a.js']);
});

test('--changed-files includes staged and modified-tracked files alongside committed and untracked ones (#1923 review)', async () => {
  const r = tmpGitRepo();
  const branch = r.git('symbolic-ref', '--short', 'HEAD').trim();
  const full = await runCli(['--cmd', 'tests=node -e 0'], { cwd: r.repo });
  assert.strictEqual(full.code, 0, full.stderr);
  commitFile(r, 'src/a.js', '1');
  fs.writeFileSync(path.join(r.repo, 'staged.js'), 'staged');
  r.git('add', 'staged.js');
  fs.writeFileSync(path.join(r.repo, 'src', 'a.js'), '2');
  fs.writeFileSync(path.join(r.repo, 'notes.txt'), 'uncommitted');
  const run = await runCli(['--changed-files', '--integration-branch', branch], { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  const out = JSON.parse(run.stdout.trim());
  assert.deepStrictEqual(out.files, ['notes.txt', 'src/a.js', 'staged.js']);
});

test('--changed-files with no stamp and no resolvable integration branch exits 1 with a message — never an empty list (#1923 AC2)', async () => {
  const r = tmpGitRepo();
  const run = await runCli(['--changed-files'], { cwd: r.repo });
  assert.strictEqual(run.code, 1);
  assert.match(run.stderr, /could not resolve a base/);
  assert.strictEqual(run.stdout.trim(), '');
});

test('--changed-files honors --base and never writes a stamp or report (#1923)', async () => {
  const r = tmpGitRepo();
  const first = r.git('rev-parse', 'HEAD').trim();
  commitFile(r, 'docs/a.md', 'x');
  const run = await runCli(['--changed-files', '--base', first], { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  assert.deepStrictEqual(JSON.parse(run.stdout.trim()), { base: first, files: ['docs/a.md'] });
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify-pass.json')));
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json')));
});

// #3048: inside a pipeline the stamp is written right after the build's source
// commits, so a stamp-anchored set misses them. Fixture: A (integration tip,
// the merge-base) -> B (build commit) -> full verify stamps B -> C (a later
// bookkeeping commit).
async function stampThenBookkeeping() {
  const r = tmpGitRepo();
  const integration = r.git('symbolic-ref', '--short', 'HEAD').trim();
  const A = r.git('rev-parse', 'HEAD').trim();
  r.git('checkout', '-q', '-b', 'feat');
  commitFile(r, 'src/b.js', '1');
  const B = r.git('rev-parse', 'HEAD').trim();
  const full = await runCli(['--cmd', 'tests=node -e 0'], { cwd: r.repo });
  assert.strictEqual(full.code, 0, full.stderr);
  assert.strictEqual(stampOf(r.gitDir).fullSha, B);
  commitFile(r, 'stories/c.yaml', 'x');
  return { r, integration, A, B };
}

test('AC1.1/AC1.2: stamp-anchored --changed-files still returns only the post-stamp bookkeeping (#3048)', async () => {
  const { r, integration, B } = await stampThenBookkeeping();
  const run = await runCli(['--changed-files', '--integration-branch', integration], { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  const out = JSON.parse(run.stdout.trim());
  assert.strictEqual(out.base, B);
  assert.deepStrictEqual(out.files, ['stories/c.yaml']);
});

test('AC1.1/AC1.2: --ignore-stamp returns the merge-base diff — the build commit and the bookkeeping (#3048)', async () => {
  const { r, integration, A } = await stampThenBookkeeping();
  const run = await runCli(['--changed-files', '--ignore-stamp', '--integration-branch', integration], { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  const out = JSON.parse(run.stdout.trim());
  assert.strictEqual(out.base, A);
  assert.deepStrictEqual(out.files, ['src/b.js', 'stories/c.yaml']);
  assert.ok(!('warning' in out));
});

test('AC2.1: --ignore-stamp with a usable stamp but no --base/--integration-branch exits 1 — never falls back to the stamp, never an empty list', async () => {
  const { r } = await stampThenBookkeeping();
  const run = await runCli(['--changed-files', '--ignore-stamp'], { cwd: r.repo });
  assert.strictEqual(run.code, 1);
  assert.match(run.stderr, /could not resolve a base/);
  // A usable stamp exists here, so the message must not claim there was none.
  assert.match(run.stderr, /or --ignore-stamp/);
  assert.strictEqual(run.stdout.trim(), '');
});

test('#3048: a bare --ignore-stamp (no --changed-files, no --cmd) is a usage error, exit 2', async () => {
  const { r } = await stampThenBookkeeping();
  const run = await runCli(['--ignore-stamp'], { cwd: r.repo });
  assert.strictEqual(run.code, 2);
  assert.match(run.stderr, /--ignore-stamp applies only to --changed-files/);
});

test('--ignore-stamp still honors an explicit --base (#3048)', async () => {
  const { r, B } = await stampThenBookkeeping();
  const run = await runCli(['--changed-files', '--ignore-stamp', '--base', B], { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  const out = JSON.parse(run.stdout.trim());
  assert.strictEqual(out.base, B);
  assert.deepStrictEqual(out.files, ['stories/c.yaml']);
});

// #2486: a full verify pass that stamps fullSha === current HEAD (verify ran
// after this branch's own commits already landed — the common in-pipeline
// case, not a rewritten-history scenario) must not make --changed-files
// silently answer "nothing changed" when the branch is genuinely ahead of
// the named --integration-branch. Before the fix, usableAnchor's own
// "commit is its own ancestor" fact made the self-referential stamp win over
// --integration-branch, producing {base: HEAD, files: []} even though the
// branch has a real, unpushed commit relative to origin/{branch}.
test('--changed-files with a self-referential stamp (fullSha === HEAD) still resolves the real diff against --integration-branch, not an empty result (#2486)', async () => {
  const r = tmpGitRepo();
  const branch = r.git('symbolic-ref', '--short', 'HEAD').trim();
  const origin = tmpDir();
  execFileSync('git', ['init', '--bare', '-q'], { cwd: origin });
  r.git('remote', 'add', 'origin', origin);
  r.git('push', '-q', 'origin', branch);
  // The worktree's branch moves ahead of origin/{branch} — mirrors #2324's
  // worktree checkout being well ahead of main.
  commitFile(r, 'src/feature.js', 'ahead-of-origin');
  const head = r.git('rev-parse', 'HEAD').trim();
  // A full verify pass runs at this exact HEAD, stamping fullSha === head —
  // the self-referential anchor #2486 is about.
  const full = await runCli(['--cmd', 'tests=node -e 0'], { cwd: r.repo });
  assert.strictEqual(full.code, 0, full.stderr);
  assert.strictEqual(stampOf(r.gitDir).fullSha, head);

  const run = await runCli(['--changed-files', '--integration-branch', branch], { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  const out = JSON.parse(run.stdout.trim());
  assert.notStrictEqual(out.base, head, 'base must not silently collapse to HEAD when the branch is ahead of origin/{branch}');
  assert.deepStrictEqual(out.files, ['src/feature.js']);
  assert.ok(!('warning' in out), 'a real, non-degenerate diff must not carry the degenerate-base warning');
});

// The companion guard: when the resolved base genuinely still equals HEAD
// (no --integration-branch given, so there is nothing to fall through to),
// the CLI must surface that plainly rather than let a caller mistake an
// empty result for "nothing changed" without any signal.
test('--changed-files surfaces a warning field when the resolved base equals HEAD and there is no integration branch to fall through to (#2486)', async () => {
  const r = tmpGitRepo();
  const full = await runCli(['--cmd', 'tests=node -e 0'], { cwd: r.repo });
  assert.strictEqual(full.code, 0, full.stderr);
  const head = r.git('rev-parse', 'HEAD').trim();
  assert.strictEqual(stampOf(r.gitDir).fullSha, head);

  const run = await runCli(['--changed-files'], { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  const out = JSON.parse(run.stdout.trim());
  assert.strictEqual(out.base, head);
  assert.deepStrictEqual(out.files, []);
  assert.strictEqual(out.warning, 'resolved base equals HEAD — diff will be empty');
});

test('#1801 shape: a ledger-row commit after a full pass resolves to none — still-verified line, no tests spawned (#1923 AC5)', async () => {
  const r = tmpGitRepo();
  const branch = r.git('symbolic-ref', '--short', 'HEAD').trim();
  const marker = path.join(r.repo, 'tests-ran.marker');
  const decl = {
    checks: { tests: 'placeholder' },
    rules: [
      { match: 'docs/plans/*-ledger.md', suites: [], static: false },
      { match: 'src/**', suites: ['tests'], static: true },
    ],
  };
  fs.mkdirSync(path.join(r.repo, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(r.repo, '.claude-tweaks', 'verify-scope.json'), JSON.stringify(decl));
  r.git('add', '.claude-tweaks/verify-scope.json');
  r.git('commit', '-q', '-m', 'declare verify scope');
  // Built with nodeCmd (see scopedRepo's unitCmd): the marker path rides in
  // argv, so no quoting of it is needed inside the script text.
  const testsCmd = nodeCmd("require('fs').writeFileSync(process.argv[1], 'ran')", marker);
  const args = ['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', branch, '--cmd', `tests=${testsCmd}`];
  const full = await runCli(args, { cwd: r.repo });
  assert.strictEqual(full.code, 0, full.stderr);
  assert.ok(fs.existsSync(marker));
  fs.unlinkSync(marker);
  commitFile(r, 'docs/plans/2026-09-06-spec-1-ledger.md', '| 1 | test | row | open | — |\n');
  const run = await runCli(args, { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  assert.match(run.stdout, /^Scope: none/m);
  assert.ok(run.stdout.includes('still-verified: bookkeeping-only delta (docs/plans/2026-09-06-spec-1-ledger.md)'));
  assert.ok(!fs.existsSync(marker), 'no tests check may spawn on a bookkeeping-only delta');
  assert.strictEqual(stampOf(r.gitDir).scope, 'none');
});
