'use strict';
// #4589: the dispatch-prompt CLI — renders each dispatch Task() prompt from the live
// skills/dispatch/task-prompt.md, writes it (and chunked parts), and records its digest in the run's
// registry. Fake deps drive every branch; the run dir is a real tmp dir outside any checkout.
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readText } = require('../../helpers/read-skill');
const { run, realDeps, formatPolicyValues } = require('../../../plugin/bin/dispatch-prompt');
const { spawnCli } = require('../../helpers/run-cli');
const { POLICY_KEYS: SCHEMA_KEYS } = require('../../../plugin/bin/lib/policy-schema');
const {
  findUnsubstituted, promptDigest, promptSize, REGISTRY_FILE,
} = require('../../../plugin/bin/lib/dispatch/task-prompt');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'dispatch-prompt.js');
const TEMPLATE = path.join(__dirname, '..', '..', '..', 'plugin', 'skills', 'dispatch', 'task-prompt.md');
const LIVE = readText(TEMPLATE);
const RUN_BASE = '2026-11-12T000000-record-4589';

const tmpRoots = [];
after(() => { tmpRoots.forEach((d) => fs.rmSync(d, { recursive: true, force: true })); });

function mkRun(pad = 0) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-'));
  tmpRoots.push(root);
  let dir = root;
  let left = pad;
  while (left > 0) {
    const seg = 'p'.repeat(Math.min(left, 190));
    dir = path.join(dir, seg);
    left -= seg.length + 1;
  }
  dir = path.join(dir, RUN_BASE);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function harness(over = {}) {
  const log = { writes: [], appends: [], out: '', err: '', profileCalls: [], selectedAtCalls: 0 };
  const deps = {
    cwd: () => os.tmpdir(),
    env: {},
    anchoredOrOutsideMessage: () => null,
    removeFile: () => false,
    readFile: (p) => (p === TEMPLATE ? LIVE : readText(p)),
    writeFile: (p, s) => { log.writes.push([p, s]); },
    appendFile: (p, s) => { log.appends.push([p, s]); },
    resolvePolicyValues: () => 'autonomy=unattended, integration-model=pr-first',
    resolveProfile: (name, o) => {
      log.profileCalls.push([name, o]);
      return { model: 'opus', effort: 'high', source: 'default', effortLine: '[Effort: high — apply high-level reasoning depth to this task.]' };
    },
    selectedAt: () => { log.selectedAtCalls += 1; return '2026-11-12T10:00:00.000Z'; },
    defaultOut: () => null,
    now: () => '2026-11-12T10:00:01.000Z',
    stdout: (s) => { log.out += s; },
    stderr: (s) => { log.err += s; },
    ...over,
  };
  return { deps, log };
}

const base = (runDir, extra = []) => ['--run', runDir, '--issues', '4589', '--out', path.join(runDir, 'p.md'), ...extra];
const written = (log, p) => log.writes.find(([w]) => w === p)?.[1];
const envelope = (log) => JSON.parse(log.out.trim());
const registryLine = (log) => JSON.parse(log.appends[0][1]);
const assertNothingWritten = (log) => { assert.deepStrictEqual(log.writes, []); assert.deepStrictEqual(log.appends, []); assert.strictEqual(log.out, ''); };

test('AC1.1: one call renders the first-call prompt to --out, records its digest, and reports the profile', () => {
  const runDir = mkRun();
  const { deps, log } = harness();
  const out = path.join(runDir, 'p.md');
  assert.strictEqual(run(['--call', 'first', ...base(runDir)], deps), 0);
  const prompt = written(log, out);
  assert.deepStrictEqual(findUnsubstituted(prompt), []);
  const line = registryLine(log);
  assert.strictEqual(log.appends[0][0], path.join(runDir, REGISTRY_FILE));
  assert.ok(log.appends[0][1].endsWith('\n'));
  assert.deepStrictEqual({ sha256: line.sha256, call: line.call, out: line.out, issues: line.issues },
    { sha256: promptDigest(prompt), call: 'first', out, issues: [4589] });
  const env = envelope(log);
  assert.strictEqual(env.call, 'first');
  assert.strictEqual(env.continuation, false);
  assert.strictEqual(env.resume, false);
  assert.strictEqual(env.profile.name, 'capable');
  assert.strictEqual(env.sha256, promptDigest(prompt));
  assert.strictEqual(log.profileCalls[0][0], 'capable');
});

test('second call resolves the standard profile', () => {
  const runDir = mkRun();
  const { deps, log } = harness();
  assert.strictEqual(run(['--call', 'second', ...base(runDir)], deps), 0);
  assert.strictEqual(log.profileCalls[0][0], 'standard');
});

test('AC1.1: --next-steps renders a continuation through parseNextSteps', () => {
  const runDir = mkRun();
  const count = (s, t) => s.split(t).length - 1;
  let h = harness();
  assert.strictEqual(run(['--call', 'first', ...base(runDir, ['--next-steps', 'test'])], h.deps), 0);
  assert.strictEqual(envelope(h.log).continuation, true);
  assert.strictEqual(count(written(h.log, path.join(runDir, 'p.md')), 'test auto'), 2);

  h = harness();
  const two = ['--run', runDir, '--issues', '12,34', '--out', path.join(runDir, 'p.md')];
  assert.strictEqual(run(['--call', 'first', ...two, '--next-steps', '#12:none;#34:test'], h.deps), 0);
  assert.strictEqual(count(written(h.log, path.join(runDir, 'p.md')), 'record-steps=#12:none;#34:test auto'), 2);

  h = harness();
  assert.strictEqual(run(['--call', 'second', ...two, '--next-steps', '#12:none; #34:review,polish,wrap-up'], h.deps), 0);
  const p = written(h.log, path.join(runDir, 'p.md'));
  assert.ok(p.includes('record-steps=#12:none;#34:review,polish,wrap-up auto'));
  assert.ok(!p.includes('#12:none; #34'));

  const refusals = [
    ['first', ['--issues', '4589'], 'review'],
    ['first', ['--issues', '4589'], 'test,test'],
    ['first', ['--issues', '12,34'], 'test'],
    ['first', ['--issues', '12,34'], '#12:test'],
  ];
  for (const [call, iss, value] of refusals) {
    h = harness();
    assert.strictEqual(run(['--call', call, '--run', runDir, ...iss, '--out', path.join(runDir, 'p.md'), '--next-steps', value], h.deps), 2, value);
    assertNothingWritten(h.log);
  }
});

test('--headless passes unattended and is refused on the second call', () => {
  const runDir = mkRun();
  let h = harness();
  assert.strictEqual(run(['--call', 'first', ...base(runDir, ['--headless'])], h.deps), 0);
  assert.strictEqual(h.log.profileCalls[0][1].unattended, true);
  assert.ok(written(h.log, path.join(runDir, 'p.md')).includes('DISPATCH_HEADLESS=1'));
  h = harness();
  assert.strictEqual(run(['--call', 'second', ...base(runDir, ['--headless'])], h.deps), 2);
  assertNothingWritten(h.log);
});

test('--resume-verdict renders a resume first call', () => {
  const runDir = mkRun();
  const verdict = { eligible: true, issue: 4589, prUrl: 'https://github.com/o/r/pull/9', priorRunId: 'r0', context: { lastPhase: null, openDefects: [] } };
  const vPath = path.join(runDir, 'verdict.json');
  const withVerdict = (v) => harness({ readFile: (p) => (p === vPath ? v : p === TEMPLATE ? LIVE : readText(p)) });
  let h = withVerdict(JSON.stringify(verdict));
  assert.strictEqual(run(['--call', 'first', ...base(runDir, ['--resume-verdict', vPath])], h.deps), 0);
  assert.strictEqual(envelope(h.log).resume, true);
  const p = written(h.log, path.join(runDir, 'p.md'));
  assert.ok(p.includes('RESUME_PR="https://github.com/o/r/pull/9" /claude-tweaks:flow #4589'));
  assert.ok(p.includes('Resuming stalled run r0'));

  h = withVerdict(JSON.stringify(verdict));
  assert.strictEqual(run(['--call', 'first', ...base(runDir, ['--resume-verdict', vPath, '--next-steps', 'test'])], h.deps), 0);

  const bad = [
    ['second', base(runDir), verdict],
    ['first', ['--run', runDir, '--issues', '4589,4590', '--out', path.join(runDir, 'p.md')], verdict],
    ['first', base(runDir, ['--headless']), verdict],
    ['first', base(runDir), { ...verdict, issue: 4590 }],
    ['first', base(runDir), { ...verdict, eligible: false }],
  ];
  for (const [call, args, v] of bad) {
    h = withVerdict(JSON.stringify(v));
    assert.strictEqual(run(['--call', call, ...args, '--resume-verdict', vPath], h.deps), 2);
    assertNothingWritten(h.log);
  }
  h = withVerdict('not json');
  assert.strictEqual(run(['--call', 'first', ...base(runDir, ['--resume-verdict', vPath])], h.deps), 1);
  assertNothingWritten(h.log);
});

test('malformed invocations exit 2', () => {
  const runDir = mkRun();
  const out = path.join(runDir, 'p.md');
  const cases = [
    ['--run', runDir, '--issues', '4589', '--out', out],
    ['--call', 'third', '--run', runDir, '--issues', '4589', '--out', out],
    ['--call', 'first', '--run', runDir, '--issues', '0', '--out', out],
    ['--call', 'first', '--run', runDir, '--issues', '12,abc', '--out', out],
    ['--call', 'first', '--run', runDir, '--issues', '5,5', '--out', out],
    ['--call', 'first', '--run', runDir, '--issues', '4589', '--out', out, '--bogus'],
    ['--call', 'first', '--run', runDir, '--issues', '4589', '--out', out, '--selected-at'],
    ['--call', 'first', '--run', runDir, '--issues', '4589', '--out', out, '--selected-at', 'nope'],
    ['--call', 'first', '--run', runDir, '--issues', '4589'],
    ['--call', 'first', '--run', runDir, '--issues', '4589', '--out', out, 'constructor', 'x'],
  ];
  for (const argv of cases) {
    const { deps, log } = harness();
    assert.strictEqual(run(argv, deps), 2, argv.join(' '));
    assertNothingWritten(log);
  }
});

test('the default --out is the session temp path', () => {
  const runDir = mkRun();
  const { deps, log } = harness({ defaultOut: (id, call) => `/s/dispatch-prompt-${id}-${call}.md` });
  assert.strictEqual(run(['--call', 'first', '--run', runDir, '--issues', '4589'], deps), 0);
  assert.ok(written(log, `/s/dispatch-prompt-${RUN_BASE}-first.md`));
  assert.strictEqual(envelope(log).out, `/s/dispatch-prompt-${RUN_BASE}-first.md`);
});

test('a refused --run exits 2 and writes nothing', () => {
  let h = harness();
  assert.strictEqual(run(['--call', 'first', ...base(path.join(os.tmpdir(), 'dp-does-not-exist'))], h.deps), 2);
  assertNothingWritten(h.log);
  const runDir = mkRun();
  h = harness({ anchoredOrOutsideMessage: () => 'worktree-local shadow' });
  assert.strictEqual(run(['--call', 'first', ...base(runDir)], h.deps), 2);
  assert.ok(h.log.err.includes('worktree-local shadow'));
  assertNothingWritten(h.log);
});

test('AC5 dispatch-prompt: a failing resolver or unreadable template exits 1 and writes nothing', () => {
  const runDir = mkRun();
  const boom = () => { throw new Error('boom'); };
  for (const over of [
    { resolvePolicyValues: boom },
    { resolveProfile: boom },
    { readFile: boom },
  ]) {
    const { deps, log } = harness(over);
    assert.strictEqual(run(['--call', 'first', ...base(runDir)], deps), 1);
    assertNothingWritten(log);
  }
  const { deps, log } = harness({ writeFile: boom });
  assert.strictEqual(run(['--call', 'first', ...base(runDir)], deps), 1);
  assert.ok(log.err.includes(path.join(runDir, 'p.md')));
  assert.deepStrictEqual(log.appends, []);
  assert.strictEqual(log.out, '');
});

test('the real resolveProfile\'s failure shape exits 1', () => {
  const runDir = mkRun();
  assert.throws(() => realDeps.resolveProfile('nonsense', { unattended: false, cwd: os.tmpdir() }));
  const swapped = LIVE.replace('[Use: Capable]', '[Use: Nonsense]');
  const { deps, log } = harness({
    resolveProfile: realDeps.resolveProfile,
    readFile: (p) => (p === TEMPLATE ? swapped : readText(p)),
  });
  assert.strictEqual(run(['--call', 'first', ...base(runDir)], deps), 1);
  assertNothingWritten(log);
});

test('a failed registry append exits 1', () => {
  const runDir = mkRun();
  const { deps, log } = harness({ appendFile: () => { throw new Error('disk'); } });
  assert.strictEqual(run(['--call', 'first', ...base(runDir)], deps), 1);
  assert.ok(log.err.includes(path.join(runDir, REGISTRY_FILE)));
  assert.ok(written(log, path.join(runDir, 'p.md')));
  assert.ok(written(log, `${path.join(runDir, 'p.md')}.part1`));
  assert.strictEqual(log.out, '');
});

test('a stale part from an earlier larger render is removed, stopping at the first absent index', () => {
  const runDir = mkRun();
  const out = path.join(runDir, 'p.md');
  const h = harness({ writeFile: (p, s) => fs.writeFileSync(p, s), appendFile: (p, s) => fs.appendFileSync(p, s), removeFile: realDeps.removeFile });
  assert.strictEqual(run(['--call', 'first', '--run', runDir, '--issues', '4589', '--out', out], h.deps), 0, h.log.err);
  const N = envelope(h.log).chunks.length;
  for (const k of [N + 1, N + 2, N + 4]) fs.writeFileSync(`${out}.part${k}`, 'stale');
  const h2 = harness({ writeFile: (p, s) => fs.writeFileSync(p, s), appendFile: (p, s) => fs.appendFileSync(p, s), removeFile: realDeps.removeFile });
  assert.strictEqual(run(['--call', 'first', '--run', runDir, '--issues', '4589', '--out', out], h2.deps), 0, h2.log.err);
  assert.ok(fs.existsSync(`${out}.part${N}`));
  assert.ok(!fs.existsSync(`${out}.part${N + 1}`));
  assert.ok(!fs.existsSync(`${out}.part${N + 2}`));
  assert.ok(fs.existsSync(`${out}.part${N + 4}`));
});

test('a stale part that cannot be removed exits 1 before the registry append', () => {
  const runDir = mkRun();
  const { deps, log } = harness({ removeFile: () => { throw new Error('busy'); } });
  assert.strictEqual(run(['--call', 'first', ...base(runDir)], deps), 1);
  assert.deepStrictEqual(log.appends, []);
  assert.strictEqual(log.out, '');
  assert.ok(log.err.startsWith('dispatch-prompt.js: cannot remove a stale part of'), log.err);
});

test('formatPolicyValues: unset and error entries print (unset)', () => {
  const text = formatPolicyValues({
    autonomy: { value: 'unattended' },
    'integration-model': { value: null },
    'merge-verification': { error: 'unknown-key' },
    'risk-floor': { value: 'high' },
    'size-floor': { value: 'low' },
  });
  assert.strictEqual(text,
    'autonomy=unattended, integration-model=(unset), merge-verification=(unset), risk-floor=high, size-floor=low');
});

const POLICY_KEYS = ['autonomy', 'integration-model', 'merge-verification', 'risk-floor', 'size-floor'];
const RESOLVE_POLICY = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'resolve-policy.js');
const POLICY_ENV = {
  PATH: process.env.PATH, HOME: os.tmpdir(), USERPROFILE: os.tmpdir(), TMPDIR: os.tmpdir(),
  ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
};

function policyFixture(lines) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-policy-'));
  tmpRoots.push(root);
  fs.mkdirSync(path.join(root, '.claude-tweaks'));
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), `${lines.join('\n')}\n`);
  return root;
}

test('AC4/AC7 dispatch-prompt: real resolvePolicyValues reads the fixture policy.yml at the given cwd', () => {
  const fixture = policyFixture([
    'autonomy: trusted', 'integration-model: pr-first', 'merge-verification: wait', 'risk-floor: low', 'size-floor: medium',
  ]);
  const err = [];
  const got = realDeps.resolvePolicyValues(fixture, { env: POLICY_ENV, stderr: (s) => err.push(s) });
  // The subprocess is the oracle: the script entry still prints what the CLI used to parse.
  const child = spawnCli(RESOLVE_POLICY, ['--values', POLICY_KEYS.join(',')], { env: POLICY_ENV, cwd: fixture });
  assert.strictEqual(child.code, 0, child.stderr);
  const expected = POLICY_KEYS.map((k, i) => `${k}=${child.stdout.split('\n')[i].trim() || '(unset)'}`).join(', ');
  assert.strictEqual(got, expected);
  assert.strictEqual(got, 'autonomy=trusted, integration-model=pr-first, merge-verification=wait, risk-floor=low, size-floor=medium');
  assert.deepStrictEqual(err, []);
});

test('AC5/AC7 dispatch-prompt: an invalid autonomy value still writes the resolve-policy warning line to stderr', () => {
  const fixture = policyFixture(['autonomy: bogus', 'integration-model: pr-first']);
  const err = [];
  const got = realDeps.resolvePolicyValues(fixture, { env: POLICY_ENV, stderr: (s) => err.push(s) });
  const dflt = SCHEMA_KEYS.find((e) => e.key === 'autonomy').default;
  assert.ok(got.startsWith(`autonomy=${dflt}, `), got);
  assert.ok(err.join('').includes('resolve-policy: warning: autonomy has invalid value "bogus"'), err.join(''));
});

// POSIX-only: a gh stub is an sh script. Proves env (PATH, the gh timeout) reaches the forge probe and
// that the degraded-forge line is written through stderr at this call site.
test('AC7 dispatch-prompt: an unpinned integration-model sees the injected PATH gh stub and writes the degraded line', { skip: process.platform === 'win32' }, () => {
  const fixture = policyFixture(['autonomy: trusted']);
  const git = (args) => execFileSync('git', args, { cwd: fixture, stdio: 'ignore', windowsHide: true });
  git(['init', '-q']);
  git(['remote', 'add', 'origin', 'https://example.invalid/o/r.git']);
  const gitDir = path.dirname(execFileSync(process.platform === 'win32' ? 'where' : 'which', ['git'], { encoding: 'utf8', windowsHide: true }).split('\n')[0].trim());
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-stub-'));
  tmpRoots.push(stubDir);
  const marker = path.join(stubDir, 'gh-calls.txt');
  fs.writeFileSync(path.join(stubDir, 'gh'), `#!/bin/sh\necho call >> "${marker}"\nexec /bin/sleep 30\n`, { mode: 0o755 });
  const env = { ...POLICY_ENV, PATH: `${stubDir}${path.delimiter}${gitDir}`, CLAUDE_TWEAKS_GH_TIMEOUT_MS: '1000' };
  const err = [];
  const got = realDeps.resolvePolicyValues(fixture, { env, stderr: (x) => err.push(x) });
  assert.ok(got.includes('integration-model=local-merge'), got);
  assert.ok(fs.existsSync(marker), 'the gh stub on the injected PATH never ran');
  assert.match(err.join(''), /resolve-policy: degraded — integration-model: .* resolved local-merge /);
});

test('a throwing stdout after the append still exits 0 and says so on stderr', () => {
  const runDir = mkRun();
  const { deps, log } = harness({ stdout: () => { throw new Error('EPIPE'); } });
  assert.strictEqual(run(['--call', 'first', ...base(runDir)], deps), 0);
  assert.strictEqual(log.appends.length, 1);
  assert.ok(log.err.includes('prompt recorded'));
});

test('the size and chunk errors carry one prefix, and deps.env reaches selectedAt and defaultOut', () => {
  const runDir = mkRun();
  const big = LIVE.replace('[Use: Capable]', `[Use: Capable]\n${'x'.repeat(140000)}`);
  const h = harness({ readFile: (p) => (p === TEMPLATE ? big : readText(p)) });
  assert.strictEqual(run(['--call', 'first', ...base(runDir)], h.deps), 1);
  assert.ok(h.log.err.startsWith('dispatch-prompt.js: rendered prompt is'));
  const seen = {};
  const h2 = harness({ env: { CLAUDE_CODE_SESSION_ID: 'sid' }, selectedAt: (e) => { seen.selectedAt = e; return 'unknown'; }, defaultOut: (a, b, e) => { seen.defaultOut = e; return '/s/x.md'; } });
  assert.strictEqual(run(['--call', 'first', '--run', runDir, '--issues', '4589'], h2.deps), 0);
  assert.deepStrictEqual(seen, { selectedAt: { CLAUDE_CODE_SESSION_ID: 'sid' }, defaultOut: { CLAUDE_CODE_SESSION_ID: 'sid' } });
});

test('--help short-circuits before the rest of argv is validated', () => {
  for (const argv of [['--help', '--bogus'], ['--bogus', '-h'], ['--call', 'first', '--help']]) {
    const { deps, log } = harness();
    assert.strictEqual(run(argv, deps), 0, argv.join(' '));
    assert.ok(log.out.startsWith('usage: dispatch-prompt.js'), argv.join(' '));
  }
});

test('-h or --help as the value of a value flag is that value, not a help request', () => {
  const runDir = mkRun();
  const { deps, log } = harness({ cwd: () => runDir });
  assert.strictEqual(run(['--call', 'first', '--run', runDir, '--issues', '4589', '--out', '-h'], deps), 0, log.err);
  assert.ok(written(log, path.join(runDir, '-h')));
  assert.strictEqual(envelope(log).out, path.join(runDir, '-h'));
  assert.ok(!log.out.includes('usage:'));
  const h2 = harness();
  assert.strictEqual(run(['--call', 'first', '--run', runDir, '--issues', '4589', '--out', '--help'], h2.deps), 2);
  assert.ok(h2.log.err.includes('--out needs a value'), h2.log.err);
  assertNothingWritten(h2.log);
});

test('AC1.1: a multi-chunk prompt is written as parts that rejoin to the registry digest', () => {
  const runDir = mkRun(600);
  const out = path.join(runDir, 'p.md');
  const h = harness({ writeFile: (p, s) => fs.writeFileSync(p, s), appendFile: (p, s) => fs.appendFileSync(p, s) });
  assert.strictEqual(run(['--call', 'second', '--run', runDir, '--issues', '4589', '--out', out], h.deps), 0, h.log.err);
  const env = envelope(h.log);
  const N = env.chunks.length;
  assert.ok(N >= 2);
  assert.deepStrictEqual(env.chunks.map((c) => c.path), Array.from({ length: N }, (_, i) => `${out}.part${i + 1}`));
  const parts = env.chunks.map((c) => readText(c.path));
  const full = readText(out);
  assert.strictEqual(parts.join(env.join), full);
  assert.strictEqual(promptDigest(parts.join(env.join)), env.sha256);
  const line = JSON.parse(readText(path.join(runDir, REGISTRY_FILE)).trim());
  assert.strictEqual(line.sha256, env.sha256);
  assert.strictEqual(line.chunks, N);
  parts.forEach((p) => assert.strictEqual(p, p.trim()));
});

const insertInSecondFence = (lines) => {
  const at = LIVE.indexOf('## Second call');
  const open = LIVE.indexOf('\n```', at);
  const eol = LIVE.indexOf('\n', open + 1);
  return LIVE.slice(0, eol + 1) + lines + '\n' + LIVE.slice(eol + 1);
};

test('a prompt over the sanity bound exits 1 and writes nothing', () => {
  const runDir = mkRun();
  const control = harness();
  assert.strictEqual(run(['--call', 'second', ...base(runDir)], control.deps), 0);
  const big = insertInSecondFence(Array.from({ length: 1400 }, () => 'x'.repeat(99)).join('\n'));
  const { deps, log } = harness({ readFile: (p) => (p === TEMPLATE ? big : readText(p)) });
  assert.strictEqual(run(['--call', 'second', ...base(runDir)], deps), 1);
  assert.ok(log.err.includes('over the 131072-byte sanity bound'));
  assertNothingWritten(log);
});

test('an unsplittable prompt exits 1 and writes nothing', () => {
  const runDir = mkRun();
  const long = insertInSecondFence('x'.repeat(20001));
  assert.ok(promptSize(long).ok);
  const { deps, log } = harness({ readFile: (p) => (p === TEMPLATE ? long : readText(p)) });
  assert.strictEqual(run(['--call', 'second', ...base(runDir)], deps), 1);
  assert.ok(log.err.startsWith('dispatch-prompt.js: no chunk split'), log.err);
  assertNothingWritten(log);
});

test('the written file is exactly the rendered prompt', () => {
  const runDir = mkRun();
  const { deps, log } = harness();
  assert.strictEqual(run(['--call', 'first', ...base(runDir)], deps), 0);
  const prompt = written(log, path.join(runDir, 'p.md'));
  assert.strictEqual(prompt, prompt.replace(/\s+$/, ''));
  assert.strictEqual(promptDigest(prompt), envelope(log).sha256);
  assert.strictEqual(promptDigest(prompt), registryLine(log).sha256);
});

test('AC3.1 at the CLI: an injected template edit reaches the output', () => {
  const runDir = mkRun();
  const edited = LIVE.replace('[Use: Capable]', '[Use: Capable] CLI-EDIT-SENTINEL');
  assert.notStrictEqual(edited, LIVE);
  const { deps, log } = harness({ readFile: (p) => (p === TEMPLATE ? edited : readText(p)) });
  assert.strictEqual(run(['--call', 'first', ...base(runDir)], deps), 0);
  assert.ok(written(log, path.join(runDir, 'p.md')).includes('CLI-EDIT-SENTINEL'));
});

test('--selected-at overrides the session file', () => {
  const runDir = mkRun();
  const { deps, log } = harness();
  assert.strictEqual(run(['--call', 'first', ...base(runDir, ['--selected-at', 'unknown'])], deps), 0);
  assert.ok(written(log, path.join(runDir, 'p.md')).includes('Selected at: unknown'));
  assert.strictEqual(log.selectedAtCalls, 0);
});

test('--help exits 0 before any probe; the real binary prints usage', () => {
  const { deps, log } = harness({ isDirectory: () => { throw new Error('probed'); }, cwd: () => { throw new Error('probed'); } });
  assert.strictEqual(run(['--help'], deps), 0);
  assert.ok(log.out.startsWith('usage: dispatch-prompt.js'));
  const real = execFileSync(process.execPath, [CLI, '--help'], { encoding: 'utf8', windowsHide: true });
  assert.ok(real.startsWith('usage: dispatch-prompt.js'));
});
