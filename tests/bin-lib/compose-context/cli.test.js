'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('node:child_process');
const { run } = require('../../../plugin/bin/compose-context');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'compose-context.js');

// Fixture mirrors tests/bin-lib/log-decision/cli.test.js: a fake main checkout
// with a `.git` DIRECTORY, an anchored run dir under it, and a worktree-local
// shadow of that run dir (a `.git` FILE) for the anchoring rejection.
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-cli-'));
  const main = path.join(root, 'main');
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', '2026-09-06T000000-spec-1');
  const shadow = path.join(main, '.claude', 'worktrees', 'flow-spec-1', '.claude-tweaks', 'pipelines', '2026-09-06T000000-spec-1');
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(shadow, { recursive: true });
  fs.mkdirSync(path.join(main, '.git'), { recursive: true });
  fs.writeFileSync(path.join(main, '.claude', 'worktrees', 'flow-spec-1', '.git'), 'gitdir: ../../../.git/worktrees/flow-spec-1\n');
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'mode: auto\nintegration-model: pr-first\n');
  fs.writeFileSync(path.join(main, '.claude-tweaks', 'policy.yml'), 'autonomy: unattended\nworktree-always: true\n');
  fs.writeFileSync(path.join(main, 'CLAUDE.md'), 'work-backend: github-issues\n');
  const src = path.join(main, 'plugin', 'skills', '_shared');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'a.md'), '# A\n<!-- when: integration-model=pr-first -->\npr-first only\n<!-- /when -->\n<!-- when: integration-model=local-merge -->\nlocal only\n<!-- /when -->\n');
  fs.writeFileSync(path.join(src, 'b.md'), '# B\nalways\n');
  fs.writeFileSync(path.join(src, 'bad.md'), '# bad\n<!-- when: mode=auto -->\nnever closed\n');
  return { main, runDir, shadow, a: path.join(src, 'a.md'), b: path.join(src, 'b.md'), bad: path.join(src, 'bad.md') };
}

function deps(main, out, extra = {}) {
  return {
    cwd: () => main,
    mainRoot: () => main,
    execFileSync: () => 'gh version 2\n',
    stdout: (s) => out.push(['out', s]),
    stderr: (s) => out.push(['err', s]),
    ...extra,
  };
}
const streamOf = (out, kind) => out.filter((o) => o[0] === kind).map((o) => o[1]).join('');

test('success: exit 0, one JSON line {path, bytes, sources, unresolved}, bundle written with resolved header and untaken block removed', () => {
  const f = fixture();
  const out = [];
  const code = run(['--run', f.runDir, '--step', 'merge', f.a, 'plugin/skills/_shared/b.md'], deps(f.main, out));
  assert.equal(code, 0);
  const lines = streamOf(out, 'out').split('\n');
  assert.equal(lines.length, 2, 'exactly one line plus trailing newline');
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.path, path.join(f.runDir, 'context', 'merge.md'));
  assert.deepEqual(parsed.sources, [f.a, 'plugin/skills/_shared/b.md']);
  assert.deepEqual(parsed.unresolved, []);
  const text = fs.readFileSync(parsed.path, 'utf8');
  assert.equal(parsed.bytes, Buffer.byteLength(text, 'utf8'));
  assert.equal(text, '<!-- resolved: integration-model=pr-first mode=auto attendance=headless transport=gh worktree-policy=always work-backend=github-issues -->\n# A\npr-first only\n# B\nalways\n');
  assert.equal(streamOf(out, 'err'), '');
});

test('unresolved keys are listed in the JSON line and the header, and both branches are kept', () => {
  const f = fixture();
  fs.unlinkSync(path.join(f.runDir, 'config.yml'));
  const out = [];
  const code = run(['--run', f.runDir, '--step', 'x', f.a], deps(f.main, out));
  assert.equal(code, 0);
  const parsed = JSON.parse(streamOf(out, 'out'));
  assert.deepEqual(parsed.unresolved, ['integration-model', 'mode']);
  assert.match(fs.readFileSync(parsed.path, 'utf8'), /integration-model=unresolved mode=unresolved/);
});

test('the bundle is regenerated on every call (a second call with changed conditions overwrites, never reuses)', () => {
  const f = fixture();
  assert.equal(run(['--run', f.runDir, '--step', 'x', f.a], deps(f.main, [])), 0);
  fs.writeFileSync(path.join(f.runDir, 'config.yml'), 'mode: auto\nintegration-model: local-merge\n');
  assert.equal(run(['--run', f.runDir, '--step', 'x', f.a], deps(f.main, [])), 0);
  assert.match(fs.readFileSync(path.join(f.runDir, 'context', 'x.md'), 'utf8'), /^<!-- resolved: integration-model=local-merge/);
  assert.doesNotMatch(fs.readFileSync(path.join(f.runDir, 'context', 'x.md'), 'utf8'), /pr-first only/);
});

test('exit 2 on a malformed marker: file:line on stderr, nothing written, a prior bundle byte-unchanged', () => {
  const f = fixture();
  assert.equal(run(['--run', f.runDir, '--step', 'x', f.b], deps(f.main, [])), 0);
  const before = fs.readFileSync(path.join(f.runDir, 'context', 'x.md'), 'utf8');
  const out = [];
  const code = run(['--run', f.runDir, '--step', 'x', f.b, f.bad], deps(f.main, out));
  assert.equal(code, 2);
  assert.match(streamOf(out, 'err'), new RegExp(`${f.bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:2: .*unclosed`));
  assert.equal(streamOf(out, 'out'), '');
  assert.equal(fs.readFileSync(path.join(f.runDir, 'context', 'x.md'), 'utf8'), before);
  assert.deepEqual(fs.readdirSync(path.join(f.runDir, 'context')), ['x.md'], 'no tmp file left behind');
});

test('exit 2 on malformed invocation: usage on stderr, nothing written', () => {
  const f = fixture();
  for (const argv of [[], ['--run', f.runDir], ['--run', f.runDir, '--step', 'x'], ['--step', 'x', f.a], ['--run', f.runDir, '--step', '../evil', f.a], ['--run', f.runDir, '--step', 'x', '--bogus', f.a]]) {
    const out = [];
    assert.equal(run(argv, deps(f.main, out)), 2, JSON.stringify(argv));
    assert.match(streamOf(out, 'err'), /usage: compose-context\.js/);
    assert.equal(streamOf(out, 'out'), '');
  }
  assert.ok(!fs.existsSync(path.join(f.runDir, 'context')));
});

test('exit 2 on a --run dir that is missing or a worktree-local shadow (not anchored under the main checkout)', () => {
  const f = fixture();
  const missing = [];
  assert.equal(run(['--run', path.join(f.main, 'nope'), '--step', 'x', f.a], deps(f.main, missing)), 2);
  assert.match(streamOf(missing, 'err'), /not a directory/);
  const shadow = [];
  assert.equal(run(['--run', f.shadow, '--step', 'x', f.a], deps(f.main, shadow)), 2);
  assert.match(streamOf(shadow, 'err'), /main checkout/);
  assert.ok(!fs.existsSync(path.join(f.shadow, 'context')), 'shadow untouched');
});

test('exit 1 on an unreadable source and on an unwritable output path; no JSON on stdout', () => {
  const f = fixture();
  const unreadable = [];
  assert.equal(run(['--run', f.runDir, '--step', 'x', path.join(f.main, 'missing.md')], deps(f.main, unreadable)), 1);
  assert.match(streamOf(unreadable, 'err'), /cannot read source/);
  assert.equal(streamOf(unreadable, 'out'), '');
  const unwritable = [];
  const code = run(['--run', f.runDir, '--step', 'x', f.a], deps(f.main, unwritable, {
    composeContext: (args, d) => require('../../../plugin/bin/lib/compose-context').composeContext(args, { ...d, writeFileAtomic: () => { const e = new Error('EACCES: permission denied'); e.code = 'EACCES'; throw e; } }),
  }));
  assert.equal(code, 1);
  assert.match(streamOf(unwritable, 'err'), /EACCES/);
  assert.equal(streamOf(unwritable, 'out'), '');
});

test('exit 1 when isDirectory throws (a filesystem failure, not a missing run dir): message on stderr, nothing on stdout', () => {
  const f = fixture();
  const out = [];
  const code = run(['--run', f.runDir, '--step', 'x', f.a], deps(f.main, out, {
    isDirectory: () => { throw new Error('EIO: input/output error'); },
  }));
  assert.equal(code, 1);
  assert.match(streamOf(out, 'err'), /EIO: input\/output error/);
  assert.equal(streamOf(out, 'out'), '');
});

test('exit 1 when cwd throws: message on stderr, nothing on stdout', () => {
  const f = fixture();
  const out = [];
  const code = run(['--run', f.runDir, '--step', 'x', f.a], deps(f.main, out, {
    cwd: () => { throw new Error('cwd unavailable'); },
  }));
  assert.equal(code, 1);
  assert.match(streamOf(out, 'err'), /cwd unavailable/);
  assert.equal(streamOf(out, 'out'), '');
});

test('--help exits 0 with usage and probes nothing (real binary)', () => {
  const result = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /usage: compose-context\.js --run <run-dir> --step <name> <source-file>\.\.\./);
});

test('real binary: a --run dir outside any checkout is accepted (anchored-or-outside), exit 0 and a JSON line', () => {
  const f = fixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-outside-'));
  fs.writeFileSync(path.join(outside, 'config.yml'), 'mode: interactive\nintegration-model: local-merge\n');
  const result = spawnSync(process.execPath, [CLI, '--run', outside, '--step', 'step-1', f.b], { encoding: 'utf8', cwd: outside });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout.trim());
  assert.equal(parsed.path, path.join(outside, 'context', 'step-1.md'));
  assert.ok(Array.isArray(parsed.unresolved));
});
