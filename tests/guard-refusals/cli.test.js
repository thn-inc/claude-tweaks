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

// One exit listener removes every scratch directory the helpers below make.
const SCRATCH_DIRS = [];
process.on('exit', () => { for (const d of SCRATCH_DIRS) fs.rmSync(d, { recursive: true, force: true }); });

function capture() {
  const out = [];
  const err = [];
  return { out, err, deps: { log: (s) => out.push(s), err: (s) => err.push(s) } };
}

// A skills root whose one fence holds the first line of a refused fixture command, so byFence has
// a real trace to count.
function skillsRootFor(command) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-refusals-cli-skills-'));
  SCRATCH_DIRS.push(dir);
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

  assert.deepEqual(Object.keys(out), ['window', 'files', 'unreadable', 'calls', 'refusals', 'perPipeline', 'byReason', 'byShape', 'byFence', 'top', 'guards', 'byEffect', 'byReadClass', 'byRewrite', 'rows']);
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
  SCRATCH_DIRS.push(config);
  const projects = path.join(config, 'projects');
  fs.cpSync(copyStore(), projects, { recursive: true, preserveTimestamps: true });
  const viaEnv = capture();
  assert.equal(run({ argv: ['--until', UNTIL, '--json'], deps: { ...viaEnv.deps, env: { CLAUDE_CONFIG_DIR: config } } }), 0);
  assert.equal(JSON.parse(viaEnv.out[0]).refusals.length, 8);

  const viaHome = capture();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-refusals-home-'));
  SCRATCH_DIRS.push(home);
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

// ---- #5587: effect, read class and rewrite per row. Hand-written fixtures, never transcript content. ----

const { HARNESS_BASH, HARNESS_FILE, WORKTREE_ALWAYS, writeStore, use, result } = require('../helpers/guard-refusals-store');
const { ISOLATION_CLAUSE } = require('../../plugin/bin/lib/hooks/harness-refusal');

function scanJson(entries) {
  const c = capture();
  assert.equal(run({ argv: ['--projects-dir', writeStore(entries), '--until', UNTIL, '--skills-root', skillsRootFor('echo x'), '--json'], deps: c.deps }), 0);
  return JSON.parse(c.out[0]);
}

const ROW_ENTRIES = [
  use('t_a', 'Bash', { command: 'ls /a\\ b/c' }), result('t_a', HARNESS_BASH),
  use('t_b', 'Bash', { command: 'ls /a\\ b/c' }, null), result('t_b', HARNESS_BASH),
  use('t_c', 'Bash', { command: 'ls /a/b' }), result('t_c', HARNESS_BASH),
];

test('AC5: rewrite is the rule ids at HEAD for a row with a cwd, null without one, [] when nothing changes', () => {
  const out = scanJson(ROW_ENTRIES);
  const byId = Object.fromEntries(out.rows.map((r) => [r.toolUseId, r]));
  assert.deepEqual(byId.t_a.rewrite, ['quote-escaped-space']);
  assert.equal(byId.t_b.rewrite, null);
  assert.deepEqual(byId.t_c.rewrite, []);
  assert.deepEqual(out.byRewrite, { 'no-cwd': 1, 'quote-escaped-space': 1, unchanged: 1 });
  assert.deepEqual(out.refusals.map((r) => r.rewrite), [['quote-escaped-space'], null, []]);
});

test('every row carries a guard and an effect, and the new blocks count them', () => {
  const entries = [
    ...ROW_ENTRIES,
    use('t_w', 'Write', { file_path: '/main/x.md' }), result('t_w', HARNESS_FILE),
    use('t_p', 'Bash', { command: 'git commit -m x' }), result('t_p', WORKTREE_ALWAYS),
  ];
  const c = capture();
  assert.equal(run({ argv: ['--projects-dir', writeStore(entries), '--until', UNTIL, '--skills-root', skillsRootFor('echo x')], deps: c.deps }), 0);
  const table = c.out.join('\n');
  assert.match(table, /by guard\n/);
  assert.match(table, /by effect\n/);

  const out = scanJson(entries);
  assert.equal(out.rows.length, 5);
  for (const r of out.rows) {
    assert.ok(typeof r.guard === 'string' && r.guard.length > 0);
    assert.ok(['read', 'write', 'unknown'].includes(r.effect), r.effect);
  }
  const sum = (m) => Object.values(m).reduce((a, b) => a + b, 0);
  assert.equal(sum(out.guards), out.rows.length);
  assert.equal(sum(out.byEffect), out.rows.length);
  assert.deepEqual(out.guards, { 'harness-command': 3, 'harness-file': 1, 'plugin:worktree-always': 1 });
  const write = out.rows.find((r) => r.toolUseId === 't_w');
  assert.deepEqual([write.effect, write.why, write.readClass, write.rewrite], ['write', 'file tool', null, null]);
  const plugin = out.rows.find((r) => r.toolUseId === 't_p');
  assert.equal(plugin.rewrite, null, 'a plugin row is never a rewrite candidate');
  assert.equal(plugin.readClass, null);
  assert.deepEqual(out.byReadClass, { shape: 3, 'other-checkout': 0 });
  for (const r of out.rows.filter((x) => x.guard === 'harness-command')) assert.equal(r.readClass, 'shape');
  assert.deepEqual(Object.keys(out.rows[0]), ['toolUseId', 'file', 'line', 'tool', 'guard', 'command', 'truncated', 'reason', 'effect', 'why', 'readClass', 'rewrite', 'runId', 'ts']);
});

test('a truncated Bash row is unknown with why truncated, never read', () => {
  const out = scanJson([
    use('t_long', 'Bash', { command: `ls ${'a'.repeat(20000)}; rm x` }), result('t_long', HARNESS_BASH),
  ]);
  const row = out.rows.find((r) => r.toolUseId === 't_long');
  assert.equal(row.truncated, true);
  assert.equal(row.command.length, 20000, 'rows keep the whole stored command');
  assert.equal(row.effect, 'unknown');
  assert.equal(row.why, 'truncated');
  assert.equal(row.readClass, null);
  assert.equal(out.refusals[0].effect, 'unknown');
});

test('a truncated row or one with a non-absolute cwd is not counted as unchanged', () => {
  const out = scanJson([
    use('t_long', 'Bash', { command: `ls /a\\ b/c ${'a'.repeat(20000)}` }), result('t_long', HARNESS_BASH),
    use('t_rel', 'Bash', { command: 'ls /a\\ b/c' }, 'wt/relative'), result('t_rel', HARNESS_BASH),
    use('t_ok', 'Bash', { command: 'ls /a/b' }), result('t_ok', HARNESS_BASH),
  ]);
  const byId = Object.fromEntries(out.rows.map((r) => [r.toolUseId, r]));
  assert.equal(byId.t_long.rewrite, null);
  assert.equal(byId.t_rel.rewrite, null);
  assert.deepEqual(byId.t_ok.rewrite, []);
  assert.deepEqual(out.byRewrite, { 'no-cwd': 1, truncated: 1, unchanged: 1 });
});

test('readClass is other-checkout for a read refused for reaching another checkout, shape otherwise', () => {
  const out = scanJson([
    use('t_cd', 'Bash', { command: 'cd /main && ls' }), result('t_cd', `This session${ISOLATION_CLAUSE}/wt, but this command changes directory to /main. Refusing to run it.`),
    use('t_ls', 'Bash', { command: 'ls /a/b' }), result('t_ls', HARNESS_BASH),
    use('t_rm', 'Bash', { command: 'rm /a/b' }), result('t_rm', HARNESS_BASH),
    use('t_mon', 'Monitor', { command: 'tail -f x' }), result('t_mon', HARNESS_BASH),
  ]);
  const byId = Object.fromEntries(out.rows.map((r) => [r.toolUseId, r]));
  assert.equal(byId.t_rm.effect, 'write');
  assert.equal(byId.t_rm.readClass, null);
  assert.equal(byId.t_mon.effect, 'unknown');
  assert.equal(byId.t_mon.why, 'Monitor tool');
  assert.equal(byId.t_mon.rewrite, null, 'only Bash rows are rewrite candidates');
  assert.equal(byId.t_ls.readClass, 'shape');
  assert.equal(byId.t_cd.reason, 'cd-shared');
  assert.equal(byId.t_cd.effect, 'read');
  assert.equal(byId.t_cd.readClass, 'other-checkout');
  assert.deepEqual(out.byReadClass, { 'other-checkout': 1, shape: 1 });
});

// ---- #5590: --replay and --shape-patterns. Hand-written fixtures. ----

const PATTERNS_FILE = path.join(__dirname, '..', '..', 'tools', 'guard-refusals', 'caller-shape-patterns.json');
const REPLAY_ENTRIES = [
  use('t_a', 'Bash', { command: 'ls /a\\ b/c' }), result('t_a', HARNESS_BASH),
  use('t_c', 'Bash', { command: 'ls /a/b' }), result('t_c', HARNESS_BASH),
];

function scratchFile(name, text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-refusals-patterns-'));
  SCRATCH_DIRS.push(dir);
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  return file;
}

function replayRun(extra, entries = REPLAY_ENTRIES) {
  const c = capture();
  const code = run({ argv: ['--projects-dir', writeStore(entries), '--until', UNTIL, '--skills-root', skillsRootFor('echo x'), ...extra], deps: c.deps });
  return { code, c };
}

test('--replay --json adds a final replay key and leaves the default keys alone', () => {
  const { code, c } = replayRun(['--replay', '--json']);
  assert.equal(code, 0);
  const out = JSON.parse(c.out[0]);
  const keys = Object.keys(out);
  assert.equal(keys[keys.length - 1], 'replay');
  const plain = scanJson(REPLAY_ENTRIES);
  assert.deepEqual(keys.slice(0, -1), Object.keys(plain));
  assert.deepEqual(Object.keys(out.rows[0]), Object.keys(plain.rows[0]), 'row keys are unchanged');
  for (const k of ['dispositions', 'writeTargetsMoved', 'writeTargetsRespelled', 'writeTargetsLost', 'writeTargetsChecked', 'writeTargetsSkipped', 'notReplayed', 'ruleNotApplied', 'byClass', 'byPattern']) assert.ok(k in out.replay, k);
  assert.equal(out.replay.byPattern, null);
  assert.deepEqual(Object.keys(out.replay.byClass).sort(), ['collision-fence', 'exit-status', 'git-C-own']);
  assert.equal(out.replay.dispositions.harness.rewritten, 1, 'the escaped-space row has a rule that fixes it');
  assert.equal(out.replay.writeTargetsChecked, 1);
});

test('without --replay the output has no replay key', () => {
  assert.equal('replay' in scanJson(REPLAY_ENTRIES), false);
});

test('AC11: a one-entry --shape-patterns file prints byPattern.{id}.count', () => {
  const file = scratchFile('p.json', JSON.stringify([{ id: 'ls-abc', pattern: '^ls /a' }]));
  const { code, c } = replayRun(['--replay', '--shape-patterns', file, '--json']);
  assert.equal(code, 0);
  assert.equal(JSON.parse(c.out[0]).replay.byPattern['ls-abc'].count, 2);
});

test('--shape-patterns without --replay, a missing file, bad JSON, a non-array and a bad regex exit 2', () => {
  const good = scratchFile('good.json', '[]');
  const cases = [
    [['--shape-patterns', good], /--shape-patterns requires --replay/],
    [['--replay', '--shape-patterns', path.join(os.tmpdir(), 'guard-refusals-no-such-patterns.json')], /--shape-patterns .* cannot be read/],
    [['--replay', '--shape-patterns', scratchFile('bad.json', '{nope')], /not valid JSON/],
    [['--replay', '--shape-patterns', scratchFile('obj.json', '{"id":"x"}')], /must be a JSON array/],
    [['--replay', '--shape-patterns', scratchFile('re.json', JSON.stringify([{ id: 'x', pattern: '(' }]))], /pattern for "x" is not a valid regular expression/],
    [['--replay', '--shape-patterns', scratchFile('shape.json', JSON.stringify([{ id: 'x' }]))], /needs a string id and pattern/],
    [['--replay', '--shape-patterns', scratchFile('dup.json', JSON.stringify([{ id: 'dup-id', pattern: 'a' }, { id: 'dup-id', pattern: 'b' }]))], /duplicate id "dup-id"/],
  ];
  for (const [extra, message] of cases) {
    const { code, c } = replayRun(extra);
    assert.equal(code, 2, extra.join(' '));
    assert.match(c.err.join('\n'), message);
    assert.equal(c.out.length, 0);
  }
});

test('the text output has a replay section', () => {
  const { code, c } = replayRun(['--replay', '--shape-patterns', PATTERNS_FILE]);
  assert.equal(code, 0);
  const table = c.out.join('\n');
  assert.match(table, /^replay$/m);
  assert.match(table, /rule-not-applied/);
  assert.match(table, /writeTargetsMoved 0 of 1 \(respelled 0, lost 0, skipped 0\)/);
  assert.match(table, /by class/);
  for (const id of ['git-C-own', 'exit-status', 'collision-fence']) assert.match(table, new RegExp(`^ {4}${id} {2}total 0 {2}unknown-version 0$`, 'm'));
  assert.match(table, /by pattern/);
  assert.match(table, /^ {4}\S+ {2}count 0 {2}rewritten 0$/m);
});

test('the text output prints lost targets, unexplained reasons and a per-rule total', () => {
  const late = (e) => ({ ...e, timestamp: '2026-11-05T00:00:00.000Z' });
  const entries = [late(use('t_a', 'Bash', { command: 'ls /a\\ b/c' })), result('t_a', HARNESS_BASH),
    use('t_c', 'Bash', { command: 'ls /a/b' }), result('t_c', HARNESS_BASH)];
  const { code, c } = replayRun(['--replay'], entries);
  assert.equal(code, 0);
  const table = c.out.join('\n');
  assert.match(table, /writeTargetsMoved 0 of 1 \(respelled 0, lost 0, skipped 0\)/);
  assert.match(table, /unexplained by reason/);
  assert.match(table, /^ {4}quote-escaped-space {2}total 1$/m);
  assert.match(table, /^ {4}quote-escaped-space {2}\S+ {2}main 1 {2}subagent 0$/m);
});

test('caller-shape-patterns.json: every pattern compiles and matches one hand-written positive', () => {
  const positives = {
    'mkdir-chain-playwright': 'mkdir -p out && playwright-cli open x',
    'cd-worktree-prefix': 'cd "/tmp/wt" && ls',
    'heredoc-python-node': 'python3 - <<EOF\nprint(1)\nEOF',
    'shell-function-wrapper': 'f() { ls; }; f',
    'playwright-var-filename': 'playwright-cli screenshot --filename=$OUT',
    'playwright-pwd-filename': 'playwright-cli screenshot --filename "$PWD/a.png"',
    'playwright-for-loop': 'for u in a b; do playwright-cli open $u; done',
    'playwright-pipe-head': 'playwright-cli snapshot | head -5',
  };
  const list = JSON.parse(fs.readFileSync(PATTERNS_FILE, 'utf8'));
  assert.deepEqual(list.map((e) => e.id).sort(), Object.keys(positives).sort());
  const records = {
    'mkdir-chain-playwright': [4990, 4931], 'cd-worktree-prefix': [4990, 4931], 'shell-function-wrapper': [4990, 4931],
    'heredoc-python-node': 4990,
    'playwright-var-filename': 4931, 'playwright-pwd-filename': 4931, 'playwright-for-loop': 4931, 'playwright-pipe-head': 4931,
  };
  const negatives = {
    'cd-worktree-prefix': ['cd "/abs/dir"'],
    'shell-function-wrapper': ['ls -la', 'echo "a()"'],
  };
  for (const { id, issue, pattern } of list) {
    assert.deepEqual(issue, records[id], `${id} cites its records`);
    assert.match(positives[id], new RegExp(pattern), id);
    for (const neg of negatives[id] || []) assert.doesNotMatch(neg, new RegExp(pattern), `${id} must not match ${neg}`);
  }
});
