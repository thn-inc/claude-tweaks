'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { run } = require('../../tools/guard-refusals');
const { scanStore } = require('../../tools/guard-refusals/transcripts');
const { copyStore, WINDOW } = require('../helpers/guard-refusals-store');

const CLI = path.join(__dirname, '..', '..', 'tools', 'guard-refusals.js');
const UNTIL = '2026-10-25T00:00:00Z'; // the fixture files are stamped 2026-10-20T12:00Z; its runs started 10-16 to 10-24

function capture() {
  const out = [];
  const err = [];
  return { out, err, deps: { log: (s) => out.push(s), err: (s) => err.push(s) } };
}

// A skills root whose one fence holds the first line of a refused fixture command, so byFence has
// a real trace to count.
function skillsRootFor(command) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-refusals-cli-skills-'));
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'F.md'), `# F\n\n\`\`\`bash\n${command.split('\n')[0]}\n\`\`\`\n`);
  return dir;
}

test('CLI exits 2 on a missing --projects-dir and prints JSON with --json', () => {
  const missing = capture();
  assert.equal(run({ argv: ['--projects-dir', path.join(os.tmpdir(), 'guard-refusals-no-such-dir')], deps: missing.deps }), 2);
  assert.match(missing.err.join('\n'), /--projects-dir .* is not a directory/);
  assert.equal(missing.out.length, 0);

  const store = copyStore();
  const forkCommand = scanStore({ projectsDir: store, ...WINDOW }).refusals.find((r) => r.toolUseId === 'toolu_01XkSC9UVprFoENL2rvy1y3K').command;
  const skills = skillsRootFor(forkCommand);
  const ok = capture();
  assert.equal(run({ argv: ['--projects-dir', store, '--until', UNTIL, '--skills-root', skills, '--json'], deps: ok.deps }), 0);
  assert.equal(ok.out.length, 1);
  const out = JSON.parse(ok.out[0]);

  assert.deepEqual(Object.keys(out), ['window', 'files', 'unreadable', 'calls', 'refusals', 'perPipeline', 'byReason', 'byShape', 'byFence', 'top']);
  assert.deepEqual(out.window, { since: '2026-10-11T00:00:00.000Z', until: '2026-10-25T00:00:00.000Z' }, 'the window defaults to 14 days');
  assert.equal(out.files, 11);
  assert.equal(out.unreadable, 1);
  assert.equal(out.calls, 12);
  assert.equal(out.refusals.length, 8);
  // Six runs in the window: the five a refusal was attributed to and record-3457, which only the parent
  // session of a subagent names. Its zero keeps the mean under 1 and the median is over all six.
  assert.deepEqual(out.perPipeline, { runs: 6, attributedRefusals: 5, unattributedRefusals: 3, mean: 0.83, median: 1 });

  assert.equal(Object.values(out.byReason).reduce((a, b) => a + b, 0), 8, 'every refusal has exactly one reason');
  assert.equal(out.byReason['names-git'], 3);
  assert.equal(out.byReason['too-complex'], 3);
  assert.equal(out.byReason['cd-shared'], 1);
  assert.equal(out.byReason['node-runtime-operand'], 1);
  for (const r of out.refusals) {
    assert.ok(Array.isArray(r.shapes) && Array.isArray(r.fences));
    assert.ok(r.command.length <= 300);
  }
  const shaped = out.refusals.filter((r) => r.shapes.length).length;
  assert.equal((out.byShape.unclassified || 0) + shaped, 8, 'each refusal lands in a detector bucket or in unclassified');
  // A transcript holds what the guard saw: a literal ${CLAUDE_PLUGIN_ROOT} was refused as a runtime
  // variable, so it is not treated as the placeholder a skill fence spells.
  const nodeVar = out.refusals.find((r) => r.reason === 'node-runtime-operand');
  assert.match(nodeVar.command, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\//);
  assert.deepEqual(nodeVar.shapes, ['node-var-script']);
  assert.equal(out.byShape['node-var-script'], 1);
  assert.deepEqual(out.byFence, { 'F.md:3': 1 });
  assert.deepEqual(out.refusals.find((r) => r.toolUseId === 'toolu_01XkSC9UVprFoENL2rvy1y3K').fences, ['F.md:3']);
  assert.ok(Object.values(out.top).every((list) => list.length <= 20 && list.every((c) => c.length <= 300)));
  assert.equal(out.top['names-git'].length, 3);
});

test('CLI prints a short text table without --json', () => {
  const store = copyStore();
  const text = capture();
  assert.equal(run({ argv: ['--projects-dir', store, '--until', UNTIL, '--skills-root', skillsRootFor('echo placeholder-command-line')], deps: text.deps }), 0);
  const table = text.out.join('\n');
  assert.match(table, /files 11 \(unreadable 1\)  calls 12  refusals 8/);
  assert.match(table, /per pipeline: 5 attributed over 6 run\(s\), mean 0\.83, median 1; 3 unattributed/);
  assert.match(table, /by reason\n(?:.*\n)*?\s+3  names-git/);
  assert.match(table, /by shape/);
  assert.match(table, /by fence/);
});

test('CLI honors --since-days, --match and --until, and rejects malformed arguments with exit 2', () => {
  const store = copyStore();
  const skills = skillsRootFor('echo placeholder-command-line');
  const json = (extra) => {
    const c = capture();
    assert.equal(run({ argv: ['--projects-dir', store, '--skills-root', skills, '--json', ...extra], deps: c.deps }), 0);
    return JSON.parse(c.out[0]);
  };
  assert.equal(json(['--until', UNTIL, '--match', 'adhoc']).refusals.length, 1);
  assert.equal(json(['--until', '2026-10-20T11:00:00Z']).files, 0, 'until bounds the window');
  assert.equal(json(['--until', UNTIL, '--since-days', '0.4']).files, 0, 'since-days bounds it from below');

  for (const argv of [['--bogus'], ['--since-days', 'x'], ['--since-days', '0'], ['--until', 'yesterday'], ['--match'], ['--projects-dir', store, '--skills-root', path.join(store, 'nope')]]) {
    const c = capture();
    assert.equal(run({ argv, deps: c.deps }), 2, argv.join(' '));
    assert.ok(c.err.length > 0);
  }
  const help = capture();
  assert.equal(run({ argv: ['--help'], deps: help.deps }), 0);
  assert.match(help.out[0], /^usage: node tools\/guard-refusals\.js/);
});

test('CLI defaults --projects-dir to $CLAUDE_CONFIG_DIR/projects, else ~/.claude/projects', () => {
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-refusals-config-'));
  process.on('exit', () => fs.rmSync(config, { recursive: true, force: true }));
  const projects = path.join(config, 'projects');
  fs.cpSync(copyStore(), projects, { recursive: true, preserveTimestamps: true });
  const viaEnv = capture();
  assert.equal(run({ argv: ['--until', UNTIL, '--json'], deps: { ...viaEnv.deps, env: { CLAUDE_CONFIG_DIR: config } } }), 0);
  assert.equal(JSON.parse(viaEnv.out[0]).refusals.length, 8);

  const viaHome = capture();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-refusals-home-'));
  process.on('exit', () => fs.rmSync(home, { recursive: true, force: true }));
  assert.equal(run({ argv: ['--until', UNTIL, '--json'], deps: { ...viaHome.deps, env: {}, homedir: () => home } }), 2, 'no <home>/.claude/projects here');
  assert.match(viaHome.err.join('\n'), /\.claude[\\/]projects is not a directory/);
});

test('the script itself exits 2 on a missing --projects-dir and 0 with JSON on stdout', () => {
  const missing = spawnSync(process.execPath, [CLI, '--projects-dir', path.join(os.tmpdir(), 'guard-refusals-no-such-dir')], { encoding: 'utf8' });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /is not a directory/);

  const ok = spawnSync(process.execPath, [CLI, '--projects-dir', copyStore(), '--until', UNTIL, '--json'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  const out = JSON.parse(ok.stdout);
  assert.equal(out.refusals.length, 8);
  assert.equal(out.calls, 12);
});

test('CLI exits 2 with a message when --projects-dir exists but cannot be listed (EACCES), instead of crashing', () => {
  const store = copyStore();
  const denied = { ...fs, readdirSync: (p, ...rest) => {
    if (path.resolve(String(p)) === path.resolve(store)) throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    return fs.readdirSync(p, ...rest);
  } };
  const c = capture();
  assert.equal(run({ argv: ['--projects-dir', store, '--until', UNTIL, '--json'], deps: { ...c.deps, fs: denied } }), 2);
  assert.match(c.err.join('\n'), /--projects-dir .* cannot be read \(EACCES\)/);
  assert.equal(c.out.length, 0);
});

test('CLI exits 2 with a message when the store passes the pre-check but fails to read mid-scan, instead of crashing', () => {
  const store = copyStore();
  let calls = 0;
  const flaky = { ...fs, readdirSync: (p, ...rest) => {
    if (path.resolve(String(p)) === path.resolve(store) && (calls += 1) > 1) {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    }
    return fs.readdirSync(p, ...rest);
  } };
  const c = capture();
  assert.equal(run({ argv: ['--projects-dir', store, '--until', UNTIL, '--json'], deps: { ...c.deps, fs: flaky } }), 2);
  assert.ok(calls > 1, 'the scan reached the store root after the pre-check listed it');
  assert.match(c.err.join('\n'), /the scan could not read its input \(EACCES\)/);
  assert.equal(c.out.length, 0);
});

test('CLI perPipeline counts a clean run as zero, so the mean can fall below 1 and the median is over every run', () => {
  const store = copyStore();
  const c = capture();
  assert.equal(run({ argv: ['--projects-dir', store, '--until', UNTIL, '--json', '--skills-root', skillsRootFor('echo placeholder-command-line')], deps: c.deps }), 0);
  const { perPipeline } = JSON.parse(c.out[0]);
  assert.ok(perPipeline.mean < 1, 'a run with no refusal lowers the mean under 1');
  assert.equal(perPipeline.runs, 6);

  // A run whose id timestamp lies outside [since, until) leaves the denominator, and its refusals count as unattributed.
  const narrow = capture();
  assert.equal(run({ argv: ['--projects-dir', store, '--until', '2026-10-20T13:00:00Z', '--since-days', '1', '--json', '--skills-root', skillsRootFor('echo placeholder-command-line')], deps: narrow.deps }), 0);
  assert.deepEqual(JSON.parse(narrow.out[0]).perPipeline, { runs: 4, attributedRefusals: 3, unattributedRefusals: 5, mean: 0.75, median: 1 });
});
