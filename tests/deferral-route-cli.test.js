'use strict';
// plugin/bin/deferral-route.js (#5930): the CLI over routeDeferral. The routing
// rules themselves are pinned exhaustively in tests/bin-lib/deferral-route/route.test.js;
// this file pins the flag parsing, the JSON line, the exit codes and the no-write promise.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runCliSync, spawnCli } = require('./helpers/run-cli');
const { scratchDir } = require('./helpers/tmp-dir');
const { chmodDenialSkip } = require('./helpers/root');
const { gitRepo, linkedWorktreeOf } = require('./helpers/git-fixtures');
const { installStub, STUB_SKIP } = require('./helpers/path-stub');
const { DEFER_REASONS } = require('../plugin/bin/lib/issues/record');

const CLI = path.resolve(__dirname, '..', 'plugin', 'bin', 'deferral-route.js');
const { realDeps, USAGE } = require(CLI);

const LOW = ['--size', 'low', '--priority', 'low', '--risk', 'low'];
const SEVERITIES_TEXT = 'critical, high, medium, low, info';

// A cwd with no .claude-tweaks/policy.yml: every call that is not about policy runs against it.
const NO_POLICY = scratchDir('ct-deferral-route-nopolicy-');
const LISTED = 'deferral-digest-reasons: pre-existing-outside-diff, tangential\n';

// A git repository holding policy.yml and/or a run directory under .claude-tweaks/pipelines/ (the only
// place the CLI accepts --run, #5933), removed at process exit.
const RUN_ID = '2026-11-19T000000-test';
function project({ policy, runConfig }) {
  const dir = gitRepo();
  const runDir = path.join(dir, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
  if (policy !== undefined) fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), policy);
  if (runConfig !== undefined) fs.writeFileSync(path.join(runDir, 'config.yml'), runConfig);
  return { dir, runDir };
}

// The resolver starts git, so the injected env carries PATH (and SystemRoot on Windows).
const GIT_ENV = { PATH: process.env.PATH, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) };

function callIn(cwd, ...argv) {
  const res = runCliSync(CLI, argv, { cwd, env: GIT_ENV });
  const lines = res.stdout.split('\n');
  assert.equal(lines.pop(), '', 'stdout ends with a newline');
  assert.equal(lines.length, 1, 'exactly one stdout line');
  return { code: res.code, stderr: res.stderr, json: JSON.parse(lines[0]) };
}

function call(...argv) {
  return callIn(NO_POLICY, ...argv);
}

function verdictOf(...argv) {
  const { code, json } = call(...argv);
  return { code, verdict: json.verdict, rule: json.rule };
}

test('AC1.1 floor digests, and echoes the inputs as given', () => {
  const { code, stderr, json } = call('--defer-reason', 'pre-existing-outside-diff', ...LOW, '--agent-raised');
  assert.equal(code, 0);
  assert.equal(stderr, '');
  assert.deepStrictEqual(json, {
    verdict: 'digest',
    rule: 'floor',
    input: { deferReason: 'pre-existing-outside-diff', severity: null, size: 'low', priority: 'low', risk: 'low', agentRaised: true },
  });
});

test('AC2.1 risk medium files; AC2.2 priority omitted files', () => {
  assert.deepStrictEqual(verdictOf('--defer-reason', 'pre-existing-outside-diff', '--size', 'low', '--priority', 'low', '--risk', 'medium', '--agent-raised'), { code: 0, verdict: 'file', rule: 'not-low' });
  assert.deepStrictEqual(verdictOf('--defer-reason', 'pre-existing-outside-diff', '--size', 'low', '--risk', 'low', '--agent-raised'), { code: 0, verdict: 'file', rule: 'not-low' });
});

test('AC3.1 tangential files', () => {
  assert.deepStrictEqual(verdictOf('--defer-reason', 'tangential', ...LOW, '--agent-raised'), { code: 0, verdict: 'file', rule: 'tangential' });
});

test('AC4.1/4.2 severity high and critical file; AC4.3 medium digests', () => {
  for (const severity of ['high', 'critical']) {
    assert.deepStrictEqual(verdictOf('--defer-reason', 'pre-existing-outside-diff', '--severity', severity, ...LOW, '--agent-raised'), { code: 0, verdict: 'file', rule: 'severity' }, severity);
  }
  assert.deepStrictEqual(verdictOf('--defer-reason', 'pre-existing-outside-diff', '--severity', 'medium', ...LOW, '--agent-raised'), { code: 0, verdict: 'digest', rule: 'floor' });
});

test('AC5.1 human files whatever the flags', () => {
  assert.deepStrictEqual(verdictOf('--defer-reason', 'pre-existing-outside-diff', ...LOW, '--human'), { code: 0, verdict: 'file', rule: 'human' });
  assert.equal(call('--defer-reason', 'pre-existing-outside-diff', ...LOW, '--human').json.input.agentRaised, false);
});

test('AC6.1 unknown reason refused, naming the value and every allowed reason', () => {
  const { code, stderr, json } = call('--defer-reason', 'not-a-reason', '--agent-raised');
  assert.equal(code, 2);
  assert.equal(json.verdict, 'refused');
  assert.ok(json.reason.includes('"not-a-reason"'));
  for (const r of DEFER_REASONS) assert.ok(json.reason.includes(r), r);
  assert.equal(stderr, json.reason + '\n');
});

test('AC9.1 severity typo refused; AC9.2 severity omitted is valid', () => {
  for (const bad of ['High', 'urgent']) {
    const { code, json } = call('--defer-reason', 'tangential', '--severity', bad, '--agent-raised');
    assert.equal(code, 2, bad);
    assert.equal(json.verdict, 'refused');
    assert.equal(json.reason, `--severity "${bad}" is not one of: ${SEVERITIES_TEXT}`);
  }
  assert.equal(call('--defer-reason', 'tangential', '--agent-raised').code, 0);
});

test('AC10 rule order: severity beats tangential; a bad reason refuses, human or not', () => {
  assert.deepStrictEqual(verdictOf('--defer-reason', 'tangential', '--severity', 'high', ...LOW, '--agent-raised'), { code: 0, verdict: 'file', rule: 'severity' });
  assert.deepStrictEqual(verdictOf('--defer-reason', 'not-a-reason', '--severity', 'high', ...LOW, '--agent-raised'), { code: 2, verdict: 'refused', rule: 'refused' });
  assert.deepStrictEqual(verdictOf('--defer-reason', 'not-a-reason', ...LOW, '--human'), { code: 2, verdict: 'refused', rule: 'refused' });
});

test('review focus 1: a value flag as the last token refuses, never throws', () => {
  const { code, json } = call('--defer-reason', 'tangential', '--agent-raised', '--size');
  assert.equal(code, 2);
  assert.equal(json.verdict, 'refused');
  assert.equal(json.reason, '--size needs a value');
});

test('review focus 2: a value that is itself a flag is a missing value', () => {
  const { code, json } = call('--defer-reason', 'tangential', '--agent-raised', '--size', '--risk', 'low');
  assert.equal(code, 2);
  assert.equal(json.reason, '--size needs a value');
  assert.equal(json.input.risk, 'low', 'the flag after the missing value is still read');
});

test('review focus 3: a case-differing axis value files as not-low, never digests', () => {
  assert.deepStrictEqual(verdictOf('--defer-reason', 'pre-existing-outside-diff', '--size', 'low', '--priority', 'low', '--risk', 'Low', '--agent-raised'), { code: 0, verdict: 'file', rule: 'not-low' });
});

test('review focus 4: empty values — reason and severity refuse, size files', () => {
  const emptyReason = call('--defer-reason', '', '--agent-raised');
  assert.equal(emptyReason.code, 2);
  assert.equal(emptyReason.json.verdict, 'refused');
  assert.equal(emptyReason.json.reason, `--defer-reason "" is not one of: ${DEFER_REASONS.join(', ')}`);
  const emptySeverity = call('--defer-reason', 'tangential', '--severity', '', '--agent-raised');
  assert.equal(emptySeverity.code, 2);
  assert.equal(emptySeverity.json.verdict, 'refused');
  assert.equal(emptySeverity.json.reason, `--severity "" is not one of: ${SEVERITIES_TEXT}`);
  const { code, json } = call('--defer-reason', 'pre-existing-outside-diff', '--size', '', '--priority', 'low', '--risk', 'low', '--agent-raised');
  assert.equal(code, 0);
  assert.deepStrictEqual({ verdict: json.verdict, rule: json.rule, size: json.input.size }, { verdict: 'file', rule: 'not-low', size: '' });
});

test('review focus 5: a repeated flag refuses', () => {
  const bare = call('--defer-reason', 'tangential', '--agent-raised', '--agent-raised');
  assert.equal(bare.code, 2);
  assert.equal(bare.json.reason, '--agent-raised given more than once');
  const valued = call('--defer-reason', 'tangential', '--size', 'low', '--size', 'low', '--agent-raised');
  assert.equal(valued.code, 2);
  assert.equal(valued.json.reason, '--size given more than once');
});

test('refusals: both origins, neither origin, unknown flag', () => {
  const both = call('--defer-reason', 'tangential', '--agent-raised', '--human');
  assert.equal(both.code, 2);
  assert.equal(both.json.reason, 'exactly one of --agent-raised or --human is required');
  assert.equal(both.json.input.agentRaised, null);
  const neither = call('--defer-reason', 'tangential');
  assert.equal(neither.code, 2);
  assert.equal(neither.json.reason, 'exactly one of --agent-raised or --human is required');
  const unknown = call('--defer-reason', 'tangential', '--agent-raised', '--bogus');
  assert.equal(unknown.code, 2);
  assert.equal(unknown.json.reason, 'unknown flag --bogus; accepted: --defer-reason, --severity, --size, --priority, --risk, --agent-raised, --human, --evidence, --run, --help');
});

test('the both-origins refusal is raised where the second origin appears, so it beats a later unknown flag', () => {
  const { code, json } = call('--agent-raised', '--human', '--bogus');
  assert.equal(code, 2);
  assert.equal(json.reason, 'exactly one of --agent-raised or --human is required');
});

test('a stray positional is an unknown argument, not an unknown flag', () => {
  const { code, json } = call('tangential');
  assert.equal(code, 2);
  assert.equal(json.reason, 'unknown argument tangential; accepted: --defer-reason, --severity, --size, --priority, --risk, --agent-raised, --human, --evidence, --run, --help');
});

test('a parse refusal still carries every known flag in input; the first refusal decides the reason', () => {
  const { code, json } = call('--bogus', '--defer-reason', 'tangential', '--agent-raised');
  assert.equal(code, 2);
  assert.equal(json.reason.startsWith('unknown flag --bogus'), true);
  assert.equal(json.input.deferReason, 'tangential');
  assert.equal(json.input.agentRaised, true);
});

test('--help prints usage and exits 0', () => {
  for (const flag of ['--help', '-h']) {
    const res = runCliSync(CLI, [flag]);
    assert.equal(res.code, 0);
    assert.equal(res.stdout, USAGE);
    assert.equal(res.stderr, '');
  }
});

test('--help in flag position wins over an earlier parse refusal', () => {
  const res = runCliSync(CLI, ['--bogus', '--help']);
  assert.equal(res.code, 0);
  assert.equal(res.stdout, USAGE);
});

test('--help counts only in flag position: a value flag followed by it refuses', () => {
  const { code, json } = call('--defer-reason', '--help');
  assert.equal(code, 2);
  assert.equal(json.reason, '--defer-reason needs a value');
});

test('-h as a value is an ordinary value, refused by the function as a bad severity', () => {
  const { code, json } = call('--defer-reason', 'tangential', '--severity', '-h', '--agent-raised');
  assert.equal(code, 2);
  assert.equal(json.reason, `--severity "-h" is not one of: ${SEVERITIES_TEXT}`);
});

test('#5932 AC2.1 CLI: listed pre-existing-outside-diff at --size high --risk medium digests by policy-reason', () => {
  const { dir } = project({ policy: LISTED });
  const { code, stderr, json } = callIn(dir, '--defer-reason', 'pre-existing-outside-diff', '--size', 'high', '--risk', 'medium', '--agent-raised');
  assert.equal(code, 0);
  assert.equal(stderr, '');
  assert.deepStrictEqual({ verdict: json.verdict, rule: json.rule }, { verdict: 'digest', rule: 'policy-reason' });
});

test('#5932 AC3.1 CLI: listed tangential digests; AC3.2 the same with --human files', () => {
  const { dir } = project({ policy: LISTED });
  const agent = callIn(dir, '--defer-reason', 'tangential', '--agent-raised');
  assert.deepStrictEqual({ code: agent.code, verdict: agent.json.verdict, rule: agent.json.rule }, { code: 0, verdict: 'digest', rule: 'policy-reason' });
  const human = callIn(dir, '--defer-reason', 'tangential', '--human');
  assert.deepStrictEqual({ code: human.code, verdict: human.json.verdict, rule: human.json.rule }, { code: 0, verdict: 'file', rule: 'human' });
});

test('#5932 AC4.1 CLI: listed reason with --severity high files', () => {
  const { dir } = project({ policy: LISTED });
  const { code, json } = callIn(dir, '--defer-reason', 'pre-existing-outside-diff', '--severity', 'high', '--agent-raised');
  assert.deepStrictEqual({ code, verdict: json.verdict, rule: json.rule }, { code: 0, verdict: 'file', rule: 'severity' });
});

test('#5932 AC5.1 CLI: genuinely-larger at --size high --priority medium --risk high files', () => {
  const { dir } = project({ policy: LISTED });
  const { code, json } = callIn(dir, '--defer-reason', 'genuinely-larger', '--size', 'high', '--priority', 'medium', '--risk', 'high', '--agent-raised');
  assert.deepStrictEqual({ code, verdict: json.verdict, rule: json.rule }, { code: 0, verdict: 'file', rule: 'not-low' });
});

const warning = (bad) => `deferral-route: warning: deferral-digest-reasons has invalid element "${bad}" — using the default (no reasons)\n`;

test('#5932 AC6.1 CLI: an invalid list warns once and still prints a verdict', () => {
  for (const policy of ['deferral-digest-reasons: not-a-reason\n', 'deferral-digest-reasons: pre-existing-outside-diff, not-a-reason\n']) {
    const { dir } = project({ policy });
    const { code, stderr, json } = callIn(dir, '--defer-reason', 'pre-existing-outside-diff', '--size', 'high', '--agent-raised');
    assert.deepStrictEqual({ code, verdict: json.verdict, rule: json.rule }, { code: 0, verdict: 'file', rule: 'not-low' }, policy);
    assert.equal(stderr, warning('not-a-reason'), policy);
  }
});

test('#5932 review focus 4: a near-miss element is named in the warning', () => {
  for (const [value, bad] of [['Tangential', 'Tangential'], ['tangential,', '']]) {
    const { dir } = project({ policy: `deferral-digest-reasons: ${value}\n` });
    const { code, stderr, json } = callIn(dir, '--defer-reason', 'tangential', '--agent-raised');
    assert.deepStrictEqual({ code, verdict: json.verdict, rule: json.rule }, { code: 0, verdict: 'file', rule: 'tangential' }, value);
    assert.equal(stderr, warning(bad), value);
  }
});

test('#5932 AC7.1 CLI: a run config overrides the repository\'s list for a call with --run', () => {
  const { dir, runDir } = project({ policy: 'deferral-digest-reasons: tangential\n', runConfig: 'deferral-digest-reasons: genuinely-larger\n' });
  const withRun = callIn(dir, '--defer-reason', 'genuinely-larger', '--size', 'high', '--agent-raised', '--run', runDir);
  assert.deepStrictEqual({ code: withRun.code, verdict: withRun.json.verdict, rule: withRun.json.rule, stderr: withRun.stderr }, { code: 0, verdict: 'digest', rule: 'policy-reason', stderr: '' });
  const without = callIn(dir, '--defer-reason', 'genuinely-larger', '--size', 'high', '--agent-raised');
  assert.deepStrictEqual({ verdict: without.json.verdict, rule: without.json.rule }, { verdict: 'file', rule: 'not-low' });
  const replaced = callIn(dir, '--defer-reason', 'tangential', '--agent-raised', '--run', runDir);
  assert.deepStrictEqual({ verdict: replaced.json.verdict, rule: replaced.json.rule }, { verdict: 'file', rule: 'tangential' });
});

test('#5932 AC7.2 CLI: a run config [] overrides a non-empty repository list (amendment 3d)', () => {
  const { dir, runDir } = project({ policy: LISTED, runConfig: 'deferral-digest-reasons: []\n' });
  const calls = [
    [['--defer-reason', 'pre-existing-outside-diff', '--size', 'high', '--agent-raised'], { verdict: 'file', rule: 'not-low' }, { verdict: 'digest', rule: 'policy-reason' }],
    [['--defer-reason', 'pre-existing-outside-diff', '--size', 'low', '--priority', 'low', '--risk', 'low', '--agent-raised'], { verdict: 'digest', rule: 'floor' }, { verdict: 'digest', rule: 'policy-reason' }],
    [['--defer-reason', 'tangential', '--agent-raised'], { verdict: 'file', rule: 'tangential' }, { verdict: 'digest', rule: 'policy-reason' }],
  ];
  for (const [argv, overridden, repo] of calls) {
    const withRun = callIn(dir, ...argv, '--run', runDir);
    assert.deepStrictEqual({ code: withRun.code, verdict: withRun.json.verdict, rule: withRun.json.rule, stderr: withRun.stderr }, { code: 0, ...overridden, stderr: '' }, argv.join(' '));
    const without = callIn(dir, ...argv);
    assert.deepStrictEqual({ verdict: without.json.verdict, rule: without.json.rule }, repo, `${argv.join(' ')} without --run`);
  }
});

test('#5932 review focus 3 CLI: an invalid run-config value never falls back to policy.yml\'s list', () => {
  const { dir, runDir } = project({ policy: LISTED, runConfig: 'deferral-digest-reasons: not-a-reason\n' });
  const { code, stderr, json } = callIn(dir, '--defer-reason', 'tangential', '--agent-raised', '--run', runDir);
  assert.deepStrictEqual({ code, verdict: json.verdict, rule: json.rule }, { code: 0, verdict: 'file', rule: 'tangential' });
  assert.equal(stderr, warning('not-a-reason'));
});

test('#5932 review focus 1: a blank --run is refused', () => {
  const base = ['--defer-reason', 'tangential', '--agent-raised'];
  for (const tail of [['--run', ''], ['--run', '   '], ['--run']]) {
    const { code, json } = call(...base, ...tail);
    assert.equal(code, 2, tail.join('|'));
    assert.equal(json.verdict, 'refused');
    assert.equal(json.reason, '--run needs a value');
  }
  const twice = call(...base, '--run', 'a', '--run', 'b');
  assert.equal(twice.code, 2);
  assert.equal(twice.json.reason, '--run given more than once');
});

test('#5932 review focus 1: a missing --run dir is this CLI\'s exit 1, no verdict', () => {
  const { dir } = project({});
  const res = runCliSync(CLI, ['--defer-reason', 'tangential', '--agent-raised', '--run', path.join(dir, 'missing')], { cwd: dir, env: GIT_ENV });
  assert.equal(res.code, 1);
  assert.equal(res.stdout, '');
  assert.ok(res.stderr.startsWith('deferral-route: --run dir does not exist or is not a directory:'), res.stderr);
});

test('#5932 review focus 2: a refusal wins over a missing --run dir (amendment 3c)', () => {
  const { dir } = project({});
  const missing = path.join(dir, 'missing');
  const cases = [
    [['--defer-reason', 'not-a-reason', '--agent-raised'], (r) => assert.ok(r.stderr.startsWith('--defer-reason "not-a-reason" is not one of:'), r.stderr)],
    [['--defer-reason', 'tangential'], (r) => assert.equal(JSON.parse(r.stdout).reason, 'exactly one of --agent-raised or --human is required')],
    [['--defer-reason', 'tangential', '--agent-raised', '--severity', 'bogus'], (r) => assert.ok(JSON.parse(r.stdout).reason.startsWith('--severity "bogus" is not one of:'))],
    [['--defer-reason', 'tangential', '--agent-raised', '--size'], (r) => assert.equal(JSON.parse(r.stdout).reason, '--size needs a value')],
  ];
  for (const [argv, check] of cases) {
    // The flag missing its value is last, so --run sits before it for that case.
    const full = argv[argv.length - 1] === '--size' ? [...argv.slice(0, -1), '--run', missing, '--size'] : [...argv, '--run', missing];
    const res = runCliSync(CLI, full, { cwd: dir, env: GIT_ENV });
    assert.equal(res.code, 2, full.join(' '));
    assert.equal(JSON.parse(res.stdout).verdict, 'refused');
    assert.equal(res.stderr.split('\n').filter(Boolean).length, 1, 'one stderr line');
    assert.ok(!res.stderr.includes('--run dir does not exist'), res.stderr);
    check(res);
  }
  // Go-red: neither policy nor deps.cwd() is touched before a refusal.
  const { run } = require(CLI);
  const out = [];
  const code = run(['--defer-reason', 'not-a-reason', '--agent-raised', '--run', missing], { stdout: (s) => out.push(s), stderr: () => {}, cwd: () => { throw new Error('cwd read'); }, env: {} });
  assert.equal(code, 2);
  assert.equal(JSON.parse(out.join('')).verdict, 'refused');
});

test('#5932 a well-formed call whose working directory cannot be read is exit 1, no verdict', () => {
  const { run } = require(CLI);
  const out = [];
  const err = [];
  const code = run(['--defer-reason', 'tangential', '--agent-raised'], { stdout: (s) => out.push(s), stderr: (s) => err.push(s), cwd: () => { throw new Error('gone'); }, env: {} });
  assert.equal(code, 1);
  assert.deepStrictEqual(out, []);
  assert.equal(err.length, 1);
  assert.ok(err[0].startsWith('deferral-route: '), err[0]);
});

test('#5932 a relative --run resolves against the injected cwd, not the real one', () => {
  const { dir } = project({ policy: 'deferral-digest-reasons: tangential\n', runConfig: 'deferral-digest-reasons: genuinely-larger\n' });
  const { code, stderr, json } = callIn(dir, '--defer-reason', 'genuinely-larger', '--size', 'high', '--agent-raised', '--run', path.join('.claude-tweaks', 'pipelines', RUN_ID));
  assert.deepStrictEqual({ code, verdict: json.verdict, rule: json.rule, stderr }, { code: 0, verdict: 'digest', rule: 'policy-reason', stderr: '' });
});

test('#5932 the policy lookup uses the injected env: a GIT_DIR/GIT_WORK_TREE only in deps.env points it at another repo', () => {
  const repo = gitRepo();
  fs.mkdirSync(path.join(repo, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.claude-tweaks', 'policy.yml'), 'deferral-digest-reasons: genuinely-larger\n');
  const elsewhere = scratchDir('ct-deferral-route-elsewhere-', { realpath: true });
  const argv = ['--defer-reason', 'genuinely-larger', '--size', 'high', '--agent-raised'];
  const plain = runCliSync(CLI, argv, { cwd: elsewhere, env: GIT_ENV });
  assert.equal(JSON.parse(plain.stdout).verdict, 'file', 'with no GIT_* the cwd has no policy');
  const pointed = runCliSync(CLI, argv, { cwd: elsewhere, env: { ...GIT_ENV, GIT_DIR: path.join(repo, '.git'), GIT_WORK_TREE: repo } });
  const json = JSON.parse(pointed.stdout);
  assert.deepStrictEqual({ code: pointed.code, verdict: json.verdict, rule: json.rule }, { code: 0, verdict: 'digest', rule: 'policy-reason' });
});

test('AC8.1 writes nothing and calls no gh', { skip: STUB_SKIP }, () => {
  const cwd = scratchDir('ct-deferral-route-');
  const marker = path.join(cwd, '..', `gh-called-${path.basename(cwd)}`);
  const restore = installStub('gh', `#!/bin/sh\ntouch '${marker}'\n`);
  try {
    const digest = spawnCli(CLI, ['--defer-reason', 'pre-existing-outside-diff', ...LOW, '--agent-raised'], { cwd });
    const refused = spawnCli(CLI, ['--defer-reason', 'not-a-reason', '--agent-raised'], { cwd });
    assert.equal(digest.code, 0);
    assert.equal(JSON.parse(digest.stdout).verdict, 'digest');
    assert.equal(refused.code, 2);
    assert.equal(JSON.parse(refused.stdout).verdict, 'refused');
    assert.deepStrictEqual(fs.readdirSync(cwd), []);
    assert.equal(fs.existsSync(marker), false);
  } finally {
    restore();
    fs.rmSync(marker, { force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('AC8.2 in-process deps are cwd, env, stdout and stderr only', () => {
  assert.deepStrictEqual(Object.keys(realDeps).sort(), ['cwd', 'env', 'stderr', 'stdout']);
});

// AC8.1 can only see the child's cwd; this one catches a write to any path, by
// trapping every fs mutation API while run() handles each verdict in-process.
test('AC8.3 run() calls no fs mutation API on any path, for every verdict', () => {
  const { run } = require(CLI);
  const MUTATORS = ['writeFile', 'appendFile', 'mkdir', 'mkdtemp', 'rm', 'rmdir', 'unlink', 'rename', 'copyFile', 'cp', 'symlink', 'link', 'truncate', 'open', 'createWriteStream'];
  const calls = [];
  const restores = [];
  const trap = (obj, name, label) => {
    if (typeof obj[name] !== 'function') return;
    const original = obj[name];
    obj[name] = () => { calls.push(label); throw new Error(`fs mutation ${label} during run()`); };
    restores.push(() => { obj[name] = original; });
  };
  for (const name of MUTATORS) {
    trap(fs, name, `fs.${name}`);
    trap(fs, `${name}Sync`, `fs.${name}Sync`);
    trap(fs.promises, name, `fs.promises.${name}`);
  }
  const out = [];
  const deps = { stdout: (s) => out.push(s), stderr: () => {}, cwd: () => NO_POLICY, env: {} };
  const codes = [];
  try {
    codes.push(run(['--defer-reason', 'pre-existing-outside-diff', ...LOW, '--agent-raised'], deps));
    codes.push(run(['--defer-reason', 'tangential', ...LOW, '--agent-raised'], deps));
    codes.push(run(['--defer-reason', 'not-a-reason', '--agent-raised'], deps));
    codes.push(run(['--help'], deps));
  } finally {
    for (const restore of restores) restore();
  }
  assert.deepStrictEqual(calls, []);
  assert.deepStrictEqual(codes, [0, 0, 2, 0]);
  assert.equal(out.length, 4);
});

test('#5933 characterization AC1.1: with both keys unset, a call with --run routes as #5932 and writes no file', () => {
  const { dir, runDir } = project({});
  const { code, stderr, json } = callIn(dir, '--defer-reason', 'genuinely-larger', '--size', 'high', '--agent-raised', '--run', runDir);
  assert.deepStrictEqual({ code, verdict: json.verdict, rule: json.rule, stderr }, { code: 0, verdict: 'file', rule: 'not-low', stderr: '' });
  assert.deepStrictEqual(fs.readdirSync(runDir), []);
});

// #5933: the evidence requirement, the per-run filing cap, and the tally behind it.
const REQ = 'filed-record-evidence: required\n';
const CAP1 = 'run-filed-record-cap: 1\n';
const NOT_LOW = ['--size', 'high'];
const TALLY = 'deferral-route-tally.log';
const GL = ['--defer-reason', 'genuinely-larger', '--agent-raised', ...NOT_LOW];

function withTests(dir) {
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tests', 'example.test.js'), '// fixture\n');
}

function tallyLines(runDir) {
  try {
    return fs.readFileSync(path.join(runDir, TALLY), 'utf8').split('\n').filter((line) => line !== '');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function outcome(res) {
  return { code: res.code, verdict: res.json.verdict, rule: res.json.rule };
}

// A second run directory under the same repo's pipelines directory, holding a config.yml.
function runDirIn(dir, id) {
  const runDir = path.join(dir, '.claude-tweaks', 'pipelines', id);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'deferral-digest-reasons: []\n');
  return runDir;
}

test('#5933 AC2.1 CLI: required, genuinely-larger at not-low axes and no --evidence digests by no-evidence', () => {
  const { dir } = project({ policy: REQ });
  const res = callIn(dir, ...GL);
  assert.deepStrictEqual({ ...outcome(res), stderr: res.stderr }, { code: 0, verdict: 'digest', rule: 'no-evidence', stderr: '' });
});

test('#5933 AC2.2 CLI: --evidence test:tests/example.test.js that exists in the fixture tree files', () => {
  const { dir } = project({ policy: REQ });
  withTests(dir);
  const res = callIn(dir, ...GL, '--evidence', 'test:tests/example.test.js');
  assert.deepStrictEqual({ ...outcome(res), stderr: res.stderr }, { code: 0, verdict: 'file', rule: 'not-low', stderr: '' });
});

test('#5933 AC3.1 CLI: test:../outside.js, test:missing.test.js and note:anything digest by no-evidence', () => {
  const parent = scratchDir('ct-deferral-route-parent-', { realpath: true });
  const dir = gitRepo({ parent });
  fs.writeFileSync(path.join(parent, 'outside.js'), '// outside\n');
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), REQ);
  withTests(dir);
  for (const evidence of ['test:../outside.js', 'test:missing.test.js', 'note:anything']) {
    const res = callIn(dir, ...GL, '--evidence', evidence);
    assert.deepStrictEqual(outcome(res), { code: 0, verdict: 'digest', rule: 'no-evidence' }, evidence);
    assert.equal(res.stderr, '', `${evidence}: invalid but resolvable evidence stays silent`);
  }
});

test('#5933 AC3.2 CLI: a/../../outside.js, /etc/passwd, file:///etc/passwd, %2e%2e/outside.js, tests/ and an escaping symlink digest by no-evidence', (t) => {
  const parent = scratchDir('ct-deferral-route-parent-', { realpath: true });
  const dir = gitRepo({ parent });
  const outside = path.join(parent, 'outside.js');
  fs.writeFileSync(outside, '// outside\n');
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), REQ);
  withTests(dir);
  fs.mkdirSync(path.join(dir, 'a'), { recursive: true });
  const values = ['test:a/../../outside.js', 'test:/etc/passwd', 'test:%2e%2e/outside.js', 'test:tests/'];
  if (process.platform !== 'win32') values.push('test:file:///etc/passwd');
  try {
    fs.symlinkSync(outside, path.join(dir, 'link.js'));
    values.push('test:link.js');
  } catch (err) {
    if (err.code !== 'EPERM' && err.code !== 'EACCES') throw err;
    t.diagnostic('symlinks unavailable: the escaping-symlink row was not run');
  }
  for (const evidence of values) {
    const res = callIn(dir, ...GL, '--evidence', evidence);
    assert.deepStrictEqual(outcome(res), { code: 0, verdict: 'digest', rule: 'no-evidence' }, evidence);
    assert.equal(res.stderr, '', `${evidence}: invalid but resolvable evidence stays silent`);
  }
});

test('#5933 AC4.1 CLI: ref:#1234 and ref:IL-85 file', () => {
  const { dir } = project({ policy: REQ });
  for (const evidence of ['ref:#1234', 'ref:IL-85']) {
    const res = callIn(dir, ...GL, '--evidence', evidence);
    assert.deepStrictEqual(outcome(res), { code: 0, verdict: 'file', rule: 'not-low' }, evidence);
  }
});

test('#5933 AC4.2 CLI: ref:soon digests by no-evidence', () => {
  const { dir } = project({ policy: REQ });
  const res = callIn(dir, ...GL, '--evidence', 'ref:soon');
  assert.deepStrictEqual(outcome(res), { code: 0, verdict: 'digest', rule: 'no-evidence' });
});

test('#5933 AC5.1 CLI: required, needs-human-decision with no evidence files', () => {
  const { dir } = project({ policy: REQ });
  const res = callIn(dir, '--defer-reason', 'needs-human-decision', '--agent-raised', ...NOT_LOW);
  assert.deepStrictEqual(outcome(res), { code: 0, verdict: 'file', rule: 'not-low' });
});

test('#5933 AC6.1/AC6.2 CLI: cap 1 in one run dir — file, run-cap, severity high files, run-cap', () => {
  const { dir, runDir } = project({ policy: CAP1 });
  const base = [...GL, '--run', runDir];
  const steps = [
    [base, 'not-low', 1],
    [base, 'run-cap', 1],
    [[...base, '--severity', 'high'], 'severity', 2],
    [base, 'run-cap', 2],
  ];
  for (const [argv, rule, lines] of steps) {
    const res = callIn(dir, ...argv);
    assert.equal(res.code, 0);
    assert.equal(res.json.rule, rule, argv.join(' '));
    assert.equal(tallyLines(runDir).length, lines, `tally after ${rule}`);
  }
  for (const line of tallyLines(runDir)) assert.match(line, /^\d{4}-\d{2}-\d{2}T[^\t]+\tgenuinely-larger\t(not-low|severity)$/);
});

test('#5933 AC7.1 CLI: two run dirs keep separate tallies, and a multi-spec member dir keeps its own', () => {
  const { dir } = project({ policy: CAP1 });
  const r1 = runDirIn(dir, 'run-one');
  const r2 = runDirIn(dir, 'run-two');
  assert.equal(callIn(dir, ...GL, '--run', r1).json.verdict, 'file');
  assert.equal(callIn(dir, ...GL, '--run', r2).json.verdict, 'file');
  assert.equal(callIn(dir, ...GL, '--run', r1).json.rule, 'run-cap');
  assert.equal(tallyLines(r1).length, 1);
  assert.equal(tallyLines(r2).length, 1);
  const member = path.join(r1, 'spec-1');
  fs.mkdirSync(member, { recursive: true });
  fs.writeFileSync(path.join(member, 'config.yml'), 'deferral-digest-reasons: []\n');
  assert.equal(callIn(dir, ...GL, '--run', member).json.verdict, 'file');
  assert.equal(tallyLines(member).length, 1);
  assert.equal(tallyLines(r1).length, 1, 'the parent run keeps its own count');
});

test('#5933 AC8.1 CLI: an unreadable tally exits 1 naming the path, no verdict', () => {
  const { dir, runDir } = project({ policy: CAP1 });
  fs.mkdirSync(path.join(runDir, TALLY));
  const res = runCliSync(CLI, [...GL, '--run', runDir], { cwd: dir, env: GIT_ENV });
  assert.equal(res.code, 1);
  assert.equal(res.stdout, '');
  assert.ok(res.stderr.includes(path.join(runDir, TALLY)), res.stderr);
});

test('#5933 AC8.1 CLI: an unappendable tally exits 1 naming the path, no verdict', chmodDenialSkip('root: mode bits do not deny an append'), () => {
  const { dir, runDir } = project({ policy: CAP1 });
  const tally = path.join(runDir, TALLY);
  fs.writeFileSync(tally, '');
  fs.chmodSync(tally, 0o444);
  const res = runCliSync(CLI, [...GL, '--run', runDir], { cwd: dir, env: GIT_ENV });
  assert.equal(res.code, 1);
  assert.equal(res.stdout, '');
  assert.ok(res.stderr.includes(tally), res.stderr);
});

test('#5933 AC10.1 CLI: cap reached, needs-human-decision digests by run-cap', () => {
  const { dir, runDir } = project({ policy: CAP1 });
  assert.equal(callIn(dir, ...GL, '--run', runDir).json.verdict, 'file');
  const res = callIn(dir, '--defer-reason', 'needs-human-decision', '--agent-raised', ...NOT_LOW, '--run', runDir);
  assert.deepStrictEqual(outcome(res), { code: 0, verdict: 'digest', rule: 'run-cap' });
});

test('#5933 AC10.2 CLI: the same with --human files and adds no tally line', () => {
  const { dir, runDir } = project({ policy: CAP1 });
  assert.equal(callIn(dir, ...GL, '--run', runDir).json.verdict, 'file');
  const res = callIn(dir, '--defer-reason', 'needs-human-decision', '--human', ...NOT_LOW, '--run', runDir);
  assert.deepStrictEqual(outcome(res), { code: 0, verdict: 'file', rule: 'human' });
  assert.equal(tallyLines(runDir).length, 1);
});

test('#5933 AC11.1 CLI: a --run outside the main checkout\'s pipelines directory exits 1 naming the path, no verdict', () => {
  const { dir } = project({ policy: CAP1 });
  const withConfig = (target) => {
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'config.yml'), 'deferral-digest-reasons: []\n');
    return target;
  };
  const outside = withConfig(scratchDir('ct-deferral-route-outside-', { realpath: true }));
  // The gap the guard closes: the resolver alone accepts a run dir outside every checkout.
  const { resolvePolicy, callerDeps } = require('../plugin/bin/resolve-policy');
  assert.equal(resolvePolicy({ keys: ['deferral-digest-reasons'], runDir: outside }, callerDeps({ cwd: dir, env: GIT_ENV })).code, 0);
  const inRepo = withConfig(path.join(dir, 'run'));
  const sibling = withConfig(path.join(dir, '.claude-tweaks', 'pipelines-copy', 'run'));
  // A worktree-local shadow of a real main-checkout run dir.
  withConfig(path.join(dir, '.claude-tweaks', 'pipelines', 'run'));
  const wt = linkedWorktreeOf(dir);
  const shadow = withConfig(path.join(wt, '.claude-tweaks', 'pipelines', 'run'));
  for (const [target, cwd] of [[outside, dir], [inRepo, dir], [sibling, dir], [shadow, wt]]) {
    const res = runCliSync(CLI, [...GL, '--run', target], { cwd, env: GIT_ENV });
    assert.equal(res.code, 1, target);
    assert.equal(res.stdout, '', target);
    assert.ok(res.stderr.includes(target), res.stderr);
  }
  assert.deepStrictEqual(fs.readdirSync(shadow), ['config.yml'], 'the shadow gains no tally file');
});

test('#5933 AC12.1 CLI: --evidence plugin/bin/example.js:10 digests by no-evidence', () => {
  const { dir } = project({ policy: REQ });
  const res = callIn(dir, ...GL, '--evidence', 'plugin/bin/example.js:10');
  assert.deepStrictEqual(outcome(res), { code: 0, verdict: 'digest', rule: 'no-evidence' });
});

test('#5933 review focus 1: --run without a cap writes no tally; a cap without --run is no cap', () => {
  const { dir, runDir } = project({ policy: 'filed-record-evidence: off\n' });
  assert.equal(callIn(dir, ...GL, '--run', runDir).json.verdict, 'file');
  assert.deepStrictEqual(fs.readdirSync(runDir), []);
  // A real cap of 0 digests at count 0, so ignoring it without --run is observable.
  const capped = project({ policy: 'run-filed-record-cap: 0\n' });
  for (let i = 0; i < 2; i++) assert.equal(callIn(capped.dir, ...GL).json.verdict, 'file');
  assert.equal(callIn(capped.dir, ...GL, '--run', capped.runDir).json.rule, 'run-cap');
  assert.deepStrictEqual(fs.readdirSync(capped.runDir), []);
});

test('#5933 an unresolvable git top level warns once and digests a test: value by no-evidence', () => {
  const dir = scratchDir('ct-deferral-route-norepo-', { realpath: true });
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), REQ);
  withTests(dir);
  const res = callIn(dir, ...GL, '--evidence', 'test:tests/example.test.js');
  assert.deepStrictEqual(outcome(res), { code: 0, verdict: 'digest', rule: 'no-evidence' });
  assert.equal(res.stderr, 'deferral-route: warning: could not resolve the git top level for test: evidence — treated as invalid\n');
});

test('#5933 --evidence \'\' is a value and invalid evidence: it digests by no-evidence', () => {
  const { dir } = project({ policy: REQ });
  const res = callIn(dir, ...GL, '--evidence', '');
  assert.deepStrictEqual({ ...outcome(res), stderr: res.stderr }, { code: 0, verdict: 'digest', rule: 'no-evidence', stderr: '' });
});

test('#5933 the evidence git call uses the injected env: a GIT_DIR/GIT_WORK_TREE only in deps.env resolves the top level there', () => {
  const repo = gitRepo();
  fs.mkdirSync(path.join(repo, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.claude-tweaks', 'policy.yml'), REQ);
  withTests(repo);
  const elsewhere = scratchDir('ct-deferral-route-elsewhere-', { realpath: true });
  const argv = [...GL, '--evidence', 'test:tests/example.test.js'];
  const plain = runCliSync(CLI, argv, { cwd: elsewhere, env: GIT_ENV });
  assert.equal(JSON.parse(plain.stdout).verdict, 'file', 'with no GIT_* the elsewhere cwd has no policy, so no evidence is required');
  const pointed = runCliSync(CLI, argv, { cwd: elsewhere, env: { ...GIT_ENV, GIT_DIR: path.join(repo, '.git'), GIT_WORK_TREE: repo } });
  const json = JSON.parse(pointed.stdout);
  assert.deepStrictEqual({ code: pointed.code, verdict: json.verdict, rule: json.rule, stderr: pointed.stderr }, { code: 0, verdict: 'file', rule: 'not-low', stderr: '' });
});

test('#5933 review focus 2: invalid policy values warn once each and route with the default', () => {
  const { dir, runDir } = project({ policy: 'filed-record-evidence: yes\nrun-filed-record-cap: two\n' });
  const res = callIn(dir, ...GL, '--run', runDir);
  assert.deepStrictEqual(outcome(res), { code: 0, verdict: 'file', rule: 'not-low' });
  assert.equal(res.stderr, 'deferral-route: warning: filed-record-evidence has invalid value "yes" — using the default (off)\n'
    + 'deferral-route: warning: run-filed-record-cap has invalid value "two" — using the default (no cap)\n');
  assert.deepStrictEqual(fs.readdirSync(runDir), []);
});

// #6006: an invalid value the factory layer supplied says so in the warning; a policy.yml one stays as it was.
const FACTORY_INVALID = 'deferral-digest-reasons: not-a-reason\nfiled-record-evidence: yes\nrun-filed-record-cap: two\n';

test('#6006 an invalid value from the factory layer names the layer in each of the three warnings', () => {
  const res = runCliSync(CLI, ['--defer-reason', 'genuinely-larger', '--size', 'high', '--priority', 'medium', '--risk', 'high', '--agent-raised'], {
    cwd: NO_POLICY, env: { ...GIT_ENV, CLAUDE_TWEAKS_FACTORY_POLICY: FACTORY_INVALID },
  });
  assert.equal(res.code, 0);
  assert.equal(res.stderr, 'deferral-route: warning: deferral-digest-reasons has invalid element "not-a-reason" in the factory layer — using the default (no reasons)\n'
    + 'deferral-route: warning: filed-record-evidence has invalid value "yes" in the factory layer — using the default (off)\n'
    + 'deferral-route: warning: run-filed-record-cap has invalid value "two" in the factory layer — using the default (no cap)\n');
});

test('#6006 the same invalid values from policy.yml leave the three warnings byte-identical, factory layer set or not', () => {
  const plain = 'deferral-route: warning: deferral-digest-reasons has invalid element "not-a-reason" — using the default (no reasons)\n'
    + 'deferral-route: warning: filed-record-evidence has invalid value "yes" — using the default (off)\n'
    + 'deferral-route: warning: run-filed-record-cap has invalid value "two" — using the default (no cap)\n';
  const { dir } = project({ policy: FACTORY_INVALID });
  const argv = ['--defer-reason', 'genuinely-larger', '--size', 'high', '--priority', 'medium', '--risk', 'high', '--agent-raised'];
  assert.equal(runCliSync(CLI, argv, { cwd: dir, env: GIT_ENV }).stderr, plain);
  // policy.yml outranks the factory layer, so a factory value that is also invalid is never the rejected one.
  assert.equal(runCliSync(CLI, argv, { cwd: dir, env: { ...GIT_ENV, CLAUDE_TWEAKS_FACTORY_POLICY: FACTORY_INVALID } }).stderr, plain);
});

test('#5933 review focus 3: --evidence ignored when off or exempt; refused when last or repeated; never echoed', () => {
  assert.deepStrictEqual(outcome(call(...GL, '--evidence', 'note:x')), { code: 0, verdict: 'file', rule: 'not-low' });
  const { dir } = project({ policy: REQ });
  withTests(dir);
  for (const evidence of ['TEST:tests/example.test.js', 'nothing']) {
    const res = callIn(dir, ...GL, '--evidence', evidence);
    assert.deepStrictEqual({ ...outcome(res), stderr: res.stderr }, { code: 0, verdict: 'digest', rule: 'no-evidence', stderr: '' }, evidence);
  }
  const last = callIn(dir, ...GL, '--evidence');
  assert.equal(last.code, 2);
  assert.equal(last.json.reason, '--evidence needs a value');
  const twice = callIn(dir, ...GL, '--evidence', 'ref:#1', '--evidence', 'ref:#2');
  assert.equal(twice.code, 2);
  assert.equal(twice.json.reason, '--evidence given more than once');
  const ok = callIn(dir, ...GL, '--evidence', 'ref:#1');
  assert.deepStrictEqual(Object.keys(ok.json.input), ['deferReason', 'severity', 'size', 'priority', 'risk', 'agentRaised']);
});

test('#5933 review focus 5: a test: path resolves against the git top level, not the cwd', () => {
  const { dir } = project({ policy: REQ });
  withTests(dir);
  const sub = path.join(dir, 'sub');
  fs.mkdirSync(sub);
  const res = callIn(sub, ...GL, '--evidence', 'test:tests/example.test.js');
  assert.deepStrictEqual(outcome(res), { code: 0, verdict: 'file', rule: 'not-low' });
});

test('#5933 a refusal wins over an outside --run', () => {
  const outside = scratchDir('ct-deferral-route-outside-', { realpath: true });
  const res = runCliSync(CLI, ['--defer-reason', 'not-a-reason', '--agent-raised', '--run', outside], { cwd: NO_POLICY, env: GIT_ENV });
  assert.equal(res.code, 2);
});
