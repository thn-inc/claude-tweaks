'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { run, TARGETS } = require('../../tools/wait-polls');

const UNTIL = '2026-11-16T00:00:00Z';
const STAMP = new Date('2026-11-10T12:00:00Z');

const BASE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wait-polls-')));
process.on('exit', () => fs.rmSync(BASE, { recursive: true, force: true }));

function tmp() {
  return fs.mkdtempSync(path.join(BASE, 'd-'));
}

function capture() {
  const out = [];
  const err = [];
  return { out, err, deps: { log: (s) => out.push(s), err: (s) => err.push(s) } };
}

const use = (id, name, input) => ({ id, name, input });
const bash = (id, command) => use(id, 'Bash', { command });

function line(block) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: '2026-11-10T12:00:00Z',
    message: { role: 'assistant', content: [{ type: 'tool_use', ...block }] },
  });
}

function writeFile(file, blocks, stamp = STAMP) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${blocks.map(line).join('\n')}\n`);
  fs.utimesSync(file, stamp, stamp);
}

function scenario(blocks) {
  const root = tmp();
  writeFile(path.join(root, '-Users-me-proj', 's1.jsonl'), blocks);
  const c = capture();
  assert.equal(run({ argv: ['--projects-dir', root, '--until', UNTIL], deps: c.deps }), 0);
  assert.equal(c.out.length, 1);
  return JSON.parse(c.out[0]);
}

test('classifies each target', () => {
  let out = scenario([use('a', 'Agent', { prompt: 'x' }), bash('1', 'sleep 20'), bash('2', 'sleep 20'), bash('3', 'sleep 20')]);
  assert.equal(out.targets['agent-notification'].calls, 3);

  out = scenario([bash('1', 'sleep 20; gh pr checks 12')]);
  assert.equal(out.targets.ci.calls, 1);

  out = scenario([bash('1', 'sleep 20'), use('2', 'Read', { file_path: '/x/tasks/abc.output' }), bash('3', 'sleep 20')]);
  assert.equal(out.targets['output-file'].calls, 2);

  out = scenario([bash('1', 'sleep 20'), bash('2', 'git -C "/w" rev-parse HEAD'), bash('3', 'sleep 20')]);
  assert.equal(out.targets['worktree-git'].calls, 2);

  out = scenario([bash('1', 'sleep 30 && node plugin/bin/verify.js --stamp-status')]);
  assert.equal(out.targets.verify.calls, 1);

  out = scenario([bash('1', 'sleep 5; curl -s http://localhost:3000')]);
  assert.equal(out.targets['dev-server'].calls, 1);

  out = scenario([bash('1', 'sleep 10; tail -5 /tmp/build.log')]);
  assert.equal(out.targets['background-process'].calls, 1);

  out = scenario([bash('1', 'sleep 20; ls /tmp/ct-suite-slot')]);
  assert.equal(out.targets['suite-slot'].calls, 1);

  out = scenario([bash('1', 'sleep 20')]);
  assert.equal(out.targets.other.calls, 1);

  out = scenario([bash('1', 'echo sleep 20')]);
  assert.equal(out.bashCalls.main, 1);
  assert.equal(out.sleepLed.main, 0);
  assert.equal(out.targets.other.share, 0);

  out = scenario([use('a', 'Agent', { prompt: 'x' }), bash('1', 'sleep 20'), bash('2', 'sleep 20; gh run watch 9'), bash('3', 'sleep 5')]);
  assert.equal(out.sleepLed.main, Object.values(out.targets).reduce((n, t) => n + t.calls, 0));
  assert.deepEqual(Object.keys(out), ['window', 'transcripts', 'bashCalls', 'sleepLed', 'targets']);
  assert.deepEqual(Object.keys(out.targets), TARGETS);
  assert.equal(out.targets.ci.share, 33.3);
});

test('counts a replayed call once, under main', () => {
  const root = tmp();
  const a = bash('toolu_A', 'sleep 20');
  const b = bash('toolu_B', 'echo hi');
  writeFile(path.join(root, '-Users-me-proj', 's1.jsonl'), [a, b]);
  writeFile(path.join(root, '-Users-me-proj', 's1', 'subagents', 'agent-x.jsonl'), [a, b, bash('toolu_C', 'sleep 20')]);
  const c = capture();
  assert.equal(run({ argv: ['--projects-dir', root, '--until', UNTIL], deps: c.deps }), 0);
  const out = JSON.parse(c.out[0]);
  assert.deepEqual(out.bashCalls, { main: 2, subagent: 1 });
  assert.deepEqual(out.sleepLed, { main: 1, subagent: 1 });
  assert.deepEqual(out.transcripts, { main: 1, subagent: 1 });
});

test('skips a line that is not JSON', () => {
  const root = tmp();
  const file = path.join(root, '-Users-me-proj', 's1.jsonl');
  writeFile(file, [bash('1', 'sleep 20')]);
  fs.appendFileSync(file, '{"type":"assistant","message":{"content":[{"type":"tool_use"\n');
  fs.appendFileSync(file, `${line(bash('2', 'sleep 30'))}\n`);
  fs.utimesSync(file, STAMP, STAMP);
  const c = capture();
  assert.equal(run({ argv: ['--projects-dir', root, '--until', UNTIL], deps: c.deps }), 0);
  assert.equal(JSON.parse(c.out[0]).sleepLed.main, 2);
});

test('reads only files inside the window', () => {
  const root = tmp();
  writeFile(path.join(root, '-Users-me-proj', 'new.jsonl'), [bash('1', 'sleep 20')]);
  writeFile(path.join(root, '-Users-me-proj', 'old.jsonl'), [bash('2', 'sleep 21')], new Date('2026-09-01T12:00:00Z'));
  let c = capture();
  assert.equal(run({ argv: ['--projects-dir', root, '--until', UNTIL], deps: c.deps }), 0);
  const out = JSON.parse(c.out[0]);
  assert.equal(out.sleepLed.main, 1);
  assert.deepEqual(out.window, { since: '2026-10-17T00:00:00.000Z', until: '2026-11-16T00:00:00.000Z' });
  c = capture();
  assert.equal(run({ argv: ['--projects-dir', root, '--until', UNTIL, '--since-days', '90'], deps: c.deps }), 0);
  assert.equal(JSON.parse(c.out[0]).sleepLed.main, 2);
});

function aliasedStore() {
  const root = tmp();
  const realSlug = path.join(root, '-Users-me-proj');
  writeFile(path.join(realSlug, 's1.jsonl'), [bash('1', 'sleep 20'), bash('2', 'echo hi')]);
  return { root, realSlug };
}

test('AC11.1: a slug directory reached through a symlink is read once', () => {
  const { root, realSlug } = aliasedStore();
  fs.symlinkSync(realSlug, path.join(root, '-Users-me-alias'), 'junction');
  const c = capture();
  assert.equal(run({ argv: ['--projects-dir', root, '--until', UNTIL], deps: c.deps }), 0);
  const out = JSON.parse(c.out[0]);
  assert.equal(out.transcripts.main, 1);
  assert.equal(out.bashCalls.main, 2);
  assert.equal(out.sleepLed.main, 1);
});

test('AC11.2: the test fails when the script walks both names', () => {
  const { root } = aliasedStore();
  const rootAlias = path.join(tmp(), 'projects-alias');
  fs.symlinkSync(root, rootAlias, 'junction');
  const reads = [];
  const counting = {
    ...fs,
    readdirSync(p, ...rest) {
      reads.push(path.resolve(String(p)));
      return fs.readdirSync(p, ...rest);
    },
  };
  const c = capture();
  assert.equal(run({ argv: ['--projects-dir', root, '--projects-dir', rootAlias, '--until', UNTIL], deps: { ...c.deps, fs: counting } }), 0);
  // The slug real-path dedup alone already keeps every count at the single-root value, so the
  // transcripts count cannot pin the root dedup; reading each real directory once does.
  assert.equal(JSON.parse(c.out[0]).transcripts.main, 1);
  assert.equal(reads.filter((p) => p === root).length, 1);
});

test('a projects dir that cannot be resolved exits 2', () => {
  const { root } = aliasedStore();
  const failing = {
    ...fs,
    realpathSync(p, ...rest) {
      if (path.resolve(String(p)) === root) throw Object.assign(new Error('gone'), { code: 'ENOENT' });
      return fs.realpathSync(p, ...rest);
    },
  };
  const c = capture();
  assert.equal(run({ argv: ['--projects-dir', root, '--until', UNTIL], deps: { ...c.deps, fs: failing } }), 2);
  assert.match(c.err.join('\n'), /cannot be resolved \(ENOENT\)[\s\S]*usage: node tools\/wait-polls\.js/);
  assert.equal(c.out.length, 0);
});

test('tool_use blocks without a string id are skipped, never merged under one key', () => {
  const out = scenario([{ name: 'Bash', input: { command: 'sleep 20' } }, { name: 'Bash', input: { command: 'sleep 30' } }]);
  assert.equal(out.bashCalls.main, 0);
  assert.equal(out.sleepLed.main, 0);
});

test('--match reads only the slugs it matches', () => {
  const root = tmp();
  writeFile(path.join(root, '-Users-me-alpha', 's1.jsonl'), [bash('1', 'sleep 20')]);
  writeFile(path.join(root, '-Users-me-beta', 's1.jsonl'), [bash('2', 'sleep 21')]);
  const c = capture();
  assert.equal(run({ argv: ['--projects-dir', root, '--match', 'alpha', '--until', UNTIL], deps: c.deps }), 0);
  const out = JSON.parse(c.out[0]);
  assert.equal(out.transcripts.main, 1);
  assert.equal(out.sleepLed.main, 1);
});

test('the next segment is tried before the previous one', () => {
  const out = scenario([
    bash('1', 'sleep 20'), use('2', 'Read', { file_path: '/x/tasks/a.output' }),
    bash('3', 'sleep 20'), bash('4', 'gh pr checks 3'),
    bash('5', 'sleep 20'),
  ]);
  // sleep 3 sees the ci probe (next) before the output-file probe (previous).
  assert.equal(out.targets.ci.calls, 2);
  assert.equal(out.targets['output-file'].calls, 1);
});

test('a segment longer than PROBE_GAP_MAX is not read for probes', () => {
  const out = scenario([
    bash('1', 'sleep 20'),
    bash('2', 'echo a'), bash('3', 'echo b'), bash('4', 'gh pr checks 3'), bash('5', 'echo c'),
    bash('6', 'sleep 20'),
  ]);
  assert.equal(out.targets.ci.calls, 0);
  assert.equal(out.targets.other.calls, 2);
});

test('a dangling non-transcript entry inside a slug is skipped', () => {
  const { root, realSlug } = aliasedStore();
  fs.symlinkSync(path.join(tmp(), 'gone'), path.join(realSlug, 'dangling-note'), 'junction');
  const c = capture();
  assert.equal(run({ argv: ['--projects-dir', root, '--until', UNTIL], deps: c.deps }), 0);
  const out = JSON.parse(c.out[0]);
  assert.deepEqual(out.transcripts, { main: 1, subagent: 0 });
  assert.equal(out.bashCalls.main, 2);
});

test('a vanished entry is skipped, any other read error exits 2', () => {
  const { root, realSlug } = aliasedStore();
  fs.symlinkSync(path.join(tmp(), 'gone'), path.join(root, '-Users-me-dangling'), 'junction');
  let c = capture();
  assert.equal(run({ argv: ['--projects-dir', root, '--until', UNTIL], deps: c.deps }), 0);
  const out = JSON.parse(c.out[0]);
  assert.deepEqual(out.transcripts, { main: 1, subagent: 0 });
  assert.equal(out.bashCalls.main, 2);

  const denying = {
    ...fs,
    readdirSync(p, ...rest) {
      if (path.resolve(String(p)) === realSlug) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return fs.readdirSync(p, ...rest);
    },
  };
  c = capture();
  assert.equal(run({ argv: ['--projects-dir', root, '--until', UNTIL], deps: { ...c.deps, fs: denying } }), 2);
  assert.match(c.err.join('\n'), /cannot read .*EACCES/);
  assert.equal(c.out.length, 0);
});

test('a non-ENOENT error resolving a slug or reading a transcript exits 2', () => {
  const { root, realSlug } = aliasedStore();
  const denied = (code) => Object.assign(new Error('denied'), { code });
  const slugDenied = {
    ...fs,
    realpathSync(p, ...rest) {
      if (path.resolve(String(p)) === realSlug) throw denied('EACCES');
      return fs.realpathSync(p, ...rest);
    },
  };
  let c = capture();
  assert.equal(run({ argv: ['--projects-dir', root, '--until', UNTIL], deps: { ...c.deps, fs: slugDenied } }), 2);
  assert.match(c.err.join('\n'), /cannot read .*EACCES/);
  assert.equal(c.out.length, 0);

  const readDenied = {
    ...fs,
    openSync(p, ...rest) {
      if (String(p).endsWith('s1.jsonl')) throw denied('EACCES');
      return fs.openSync(p, ...rest);
    },
  };
  c = capture();
  assert.equal(run({ argv: ['--projects-dir', root, '--until', UNTIL], deps: { ...c.deps, fs: readDenied } }), 2);
  assert.match(c.err.join('\n'), /cannot read .*s1\.jsonl.*EACCES/);
  assert.equal(c.out.length, 0);
});

test('a root that vanishes after the up-front listing exits 2, not complete-looking totals', () => {
  const { root } = aliasedStore();
  let gone = false;
  const isGone = (p) => gone && path.resolve(String(p)).startsWith(root);
  const enoent = () => Object.assign(new Error('gone'), { code: 'ENOENT' });
  const vanishing = {
    ...fs,
    readdirSync(p, ...rest) {
      if (isGone(p)) throw enoent();
      const r = fs.readdirSync(p, ...rest);
      if (path.resolve(String(p)) === root) gone = true;
      return r;
    },
    realpathSync(p, ...rest) {
      if (isGone(p)) throw enoent();
      return fs.realpathSync(p, ...rest);
    },
    statSync(p, ...rest) {
      if (isGone(p)) throw enoent();
      return fs.statSync(p, ...rest);
    },
  };
  const c = capture();
  assert.equal(run({ argv: ['--projects-dir', root, '--until', UNTIL], deps: { ...c.deps, fs: vanishing } }), 2);
  assert.match(c.err.join('\n'), new RegExp(`cannot read ${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(ENOENT\\)`));
  assert.equal(c.out.length, 0);
});

test('usage errors exit 2 and --help exits 0', () => {
  const root = tmp();
  const missing = path.join(root, 'no-such-dir');
  for (const argv of [['--bogus'], ['--since-days'], ['--since-days', '0'], ['--until', 'nope'], ['--projects-dir', missing]]) {
    const c = capture();
    assert.equal(run({ argv, deps: c.deps }), 2, argv.join(' '));
    assert.match(c.err.join('\n'), /usage: node tools\/wait-polls\.js/);
    assert.equal(c.out.length, 0);
  }
  const h = capture();
  assert.equal(run({ argv: ['--help'], deps: h.deps }), 0);
  assert.match(h.out.join('\n'), /usage: node tools\/wait-polls\.js/);
});
