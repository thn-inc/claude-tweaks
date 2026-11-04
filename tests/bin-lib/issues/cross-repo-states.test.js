'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  fetchCrossRepoStates, resolveForeignStates, bodyForeignBlockers, suppliedStates,
} = require('../../../plugin/bin/lib/issues/cross-repo-states');
const { run } = require('../../../plugin/bin/resolve-foreign-blockers');

const recorder = (answer) => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    return typeof answer === 'function' ? answer(args) : answer;
  };
  return { calls, runner };
};

const thrown = (stdout) => Object.assign(new Error('gh exited 1'), stdout === undefined ? {} : { stdout });

test('fetchCrossRepoStates reads each alias\'s state and a missing, null or stateless alias as null', () => {
  const { calls, runner } = recorder(JSON.stringify({ data: { c0: { issue: { state: 'OPEN' } }, c1: null, c2: { issue: null } } }));
  const states = fetchCrossRepoStates({
    refs: ['other/repo#5', 'other/repo#6', 'acme/x#7', 'acme/x#8'], host: 'github.com', runner,
  });
  assert.deepStrictEqual(states, new Map([
    ['other/repo#5', 'OPEN'], ['other/repo#6', null], ['acme/x#7', null], ['acme/x#8', null],
  ]));
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0].slice(0, 2), ['api', 'graphql']);
  assert.ok(calls[0].join(' ').includes('-f o0=other -f n0=repo'), calls[0].join(' '));
  assert.ok(!calls[0].includes('--hostname'));
});

test('fetchCrossRepoStates reads exactly OPEN or CLOSED; any other string, a lowercase one and a non-string read null', () => {
  const { runner } = recorder(JSON.stringify({ data: {
    c0: { issue: { state: 'CLOSED' } }, c1: { issue: { state: 7 } }, c2: { issue: { state: 'MERGED' } }, c3: { issue: { state: 'open' } },
  } }));
  const states = fetchCrossRepoStates({ refs: ['a/b#1', 'a/b#2', 'a/b#3', 'a/b#4'], runner });
  assert.deepStrictEqual([...states.values()], ['CLOSED', null, null, null]);
});

test('fetchCrossRepoStates recovers the data of a thrown NOT_FOUND or FORBIDDEN response, and rethrows a whole-call failure', () => {
  const partial = JSON.stringify({
    data: { c0: { issue: { state: 'CLOSED' } }, c1: null },
    errors: [{ type: 'FORBIDDEN', path: ['c1'] }],
  });
  const states = fetchCrossRepoStates({
    refs: ['other/repo#5', 'acme/x#7'], runner: () => { throw thrown(partial); },
  });
  assert.strictEqual(states.get('other/repo#5'), 'CLOSED');
  assert.strictEqual(states.get('acme/x#7'), null);

  assert.throws(() => fetchCrossRepoStates({ refs: ['other/repo#5'], runner: () => { throw thrown(undefined); } }), /gh exited 1/);
  assert.throws(() => fetchCrossRepoStates({ refs: ['other/repo#5'], runner: () => { throw thrown('not json'); } }), /gh exited 1/);
  assert.throws(() => fetchCrossRepoStates({ refs: ['other/repo#5'], runner: () => { throw thrown(JSON.stringify({ data: null, errors: [{ message: 'bad' }] })); } }), /gh exited 1/);
  assert.throws(() => fetchCrossRepoStates({ refs: ['other/repo#5'], runner: () => '{"errors":[{"message":"rate limited"}]}' }), /rate limited/);
  assert.throws(() => fetchCrossRepoStates({ refs: ['other/repo#5'], runner: () => 'not json' }), SyntaxError);
});

test('fetchCrossRepoStates sends no ref above 2147483647, makes no call for none, and adds --hostname off github.com', () => {
  const none = recorder('{}');
  assert.deepStrictEqual(fetchCrossRepoStates({ refs: [], runner: none.runner }), new Map());
  assert.deepStrictEqual(
    fetchCrossRepoStates({ refs: ['a/b#2147483648'], runner: none.runner }),
    new Map([['a/b#2147483648', null]]),
  );
  assert.strictEqual(none.calls.length, 0);

  const mixed = recorder(JSON.stringify({ data: { c0: { issue: { state: 'OPEN' } } } }));
  const states = fetchCrossRepoStates({
    refs: ['a/b#99999999999', 'Other/Repo#5', 'other/repo#5'], host: 'ghe.example.com', runner: mixed.runner,
  });
  assert.deepStrictEqual(states, new Map([['a/b#99999999999', null], ['other/repo#5', 'OPEN']]));
  assert.strictEqual(mixed.calls.length, 1);
  const argv = mixed.calls[0];
  assert.deepStrictEqual(argv.slice(-2), ['--hostname', 'ghe.example.com']);
  assert.ok(!argv.some((a) => a.includes('99999999999')), 'the oversized ref is never sent');
  assert.ok(argv.includes('o0=other'));
});

test('fetchCrossRepoStates rejects misuse: a non-array refs and an unparseable ref', () => {
  assert.throws(() => fetchCrossRepoStates({ refs: 'a/b#1', runner: () => '{}' }), TypeError);
  assert.throws(() => fetchCrossRepoStates({ refs: ['a/b#1', 'nope'], runner: () => '{}' }), { name: 'TypeError', message: 'fetchCrossRepoStates: not an owner/name#N ref: nope' });
  assert.throws(() => resolveForeignStates(['a/b#1', 'worse'], { spawn: () => ({}) }), { name: 'TypeError', message: 'resolveForeignStates: not an owner/name#N ref: worse' });
});

test('resolveForeignStates fails closed: a non-zero CLI exit reads every ref null and prints one Warning line', () => {
  const stderr = [];
  const spawn = () => ({ status: 3, stdout: '', stderr: 'resolve-foreign-blockers.js: boom\nsecond line' });
  const states = resolveForeignStates(['other/repo#5', 'acme/x#7'], { spawn, stderr: (s) => stderr.push(s) });
  assert.deepStrictEqual(states, new Map([['other/repo#5', null], ['acme/x#7', null]]));
  assert.strictEqual(stderr.length, 1);
  assert.match(stderr[0], /^Warning: foreign blocker state lookup failed \(.*boom.*\) — every body-declared foreign blocker reads state unreadable \(fail closed\)\n$/);
  assert.strictEqual(stderr[0].split('\n').length, 2, 'one line');
});

test('resolveForeignStates fails closed on a spawn error, a signal and unparseable stdout', () => {
  for (const res of [
    { error: new Error('spawn ETIMEDOUT'), status: null, stdout: '' },
    { status: null, signal: 'SIGTERM', stdout: '' },
    { status: 0, stdout: 'not json\n' },
    { status: 0, stdout: '[1,2]\n' },
    { status: 0, stdout: '' },
  ]) {
    const stderr = [];
    const states = resolveForeignStates(['other/repo#5'], { spawn: () => res, stderr: (s) => stderr.push(s) });
    assert.deepStrictEqual(states, new Map([['other/repo#5', null]]), JSON.stringify(res));
    assert.strictEqual(stderr.length, 1, JSON.stringify(res));
    assert.match(stderr[0], /^Warning: foreign blocker state lookup failed/);
  }
});

test('resolveForeignStates asks the CLI only for sendable refs; an oversized ref (22 digits too) stays null and spawns nothing alone', () => {
  const spawned = [];
  const spawn = (argv) => { spawned.push(argv); return { status: 0, stdout: '{"other/repo#5":"CLOSED","huge/repo#1000000000000000000000":"OPEN","mid/repo#3000000000":"OPEN"}\n' }; };
  const stderr = [];
  const states = resolveForeignStates(
    ['huge/repo#1000000000000000000000', 'other/repo#5', 'mid/repo#3000000000'],
    { spawn, stderr: (s) => stderr.push(s) },
  );
  assert.deepStrictEqual(states, new Map([['huge/repo#1000000000000000000000', null], ['other/repo#5', 'CLOSED'], ['mid/repo#3000000000', null]]));
  assert.deepStrictEqual(stderr, []);
  assert.strictEqual(spawned.length, 1);
  assert.deepStrictEqual(spawned[0].slice(1), ['other/repo#5']);

  const none = [];
  const alone = resolveForeignStates(['huge/repo#1000000000000000000000'], { spawn: (a) => { none.push(a); return {}; } });
  assert.deepStrictEqual(alone, new Map([['huge/repo#1000000000000000000000', null]]));
  assert.deepStrictEqual(none, []);
});

test('resolveForeignStates reads only OPEN or CLOSED from the CLI answer', () => {
  const spawn = () => ({ status: 0, stdout: '{"a/b#1":"MERGED","a/b#2":"closed","a/b#3":"OPEN"}\n' });
  const states = resolveForeignStates(['a/b#1', 'a/b#2', 'a/b#3'], { spawn, stderr: () => {} });
  assert.deepStrictEqual([...states.values()], [null, null, 'OPEN']);
});

test('resolveForeignStates maps the CLI\'s JSON line, reads an absent or non-string key as null, and spawns nothing for no refs', () => {
  const spawned = [];
  const spawn = (argv) => { spawned.push(argv); return { status: 0, stdout: '{"other/repo#5":"OPEN","acme/x#7":3}\n' }; };
  const stderr = [];
  const states = resolveForeignStates(['other/repo#5', 'Other/Repo#5', 'acme/x#7', 'acme/x#8'], { spawn, stderr: (s) => stderr.push(s) });
  assert.deepStrictEqual(states, new Map([['other/repo#5', 'OPEN'], ['acme/x#7', null], ['acme/x#8', null]]));
  assert.deepStrictEqual(stderr, []);
  assert.strictEqual(spawned.length, 1);
  assert.ok(spawned[0].includes('other/repo#5,acme/x#7,acme/x#8'), JSON.stringify(spawned[0]));

  const none = [];
  assert.deepStrictEqual(resolveForeignStates([], { spawn: (a) => { none.push(a); return {}; } }), new Map());
  assert.deepStrictEqual(none, []);
});

test('one oversized ref reads null while the other refs keep their real state', () => {
  const calls = [];
  const runner = (args) => { calls.push(args); return JSON.stringify({ data: { c0: { issue: { state: 'CLOSED' } } } }); };
  // The CLI end to end through run(): the oversized ref must not turn the whole call into exit 1 or 3.
  const out = [];
  const code = run(['huge/repo#99999999999,other/repo#5'], {
    ghAvailable: () => true,
    remoteUrl: () => 'https://github.com/acme/widgets.git',
    runner,
    stdout: (s) => out.push(s),
    stderr: () => {},
  });
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(JSON.parse(out.join('')), { 'huge/repo#99999999999': null, 'other/repo#5': 'CLOSED' });
  assert.strictEqual(calls.length, 1);

  // A 22-digit number (formatted '1e+21' by Number) must key, parse and answer the same way.
  calls.length = 0;
  out.length = 0;
  const code22 = run(['huge/repo#1000000000000000000000,other/repo#5'], {
    ghAvailable: () => true,
    remoteUrl: () => 'https://github.com/acme/widgets.git',
    runner,
    stdout: (s) => out.push(s),
    stderr: () => {},
  });
  assert.strictEqual(code22, 0);
  assert.deepStrictEqual(JSON.parse(out.join('')), { 'huge/repo#1000000000000000000000': null, 'other/repo#5': 'CLOSED' });
  assert.strictEqual(calls.length, 1);
});

test('bodyForeignBlockers turns each record\'s Blocked by owner/name#N lines into crossRepoBlockers-shaped entries from one lookup', () => {
  const spawned = [];
  const spawn = (argv) => { spawned.push(argv); return { status: 0, stdout: '{"other/repo#5":"OPEN","acme/x#7":"CLOSED"}\n' }; };
  const records = [
    { number: 11, body: 'Blocked by other/repo#5' },
    { number: 12, body: 'Blocked by #4' },
    { number: 13, body: 'Blocked by other/repo#5\nBlocked by acme/x#7' },
  ];
  const out = bodyForeignBlockers(records, { spawn, stderr: () => {} });
  assert.deepStrictEqual([...out.keys()], [11, 13]);
  assert.deepStrictEqual(out.get(11), [{ number: 5, repository: 'other/repo', state: 'OPEN' }]);
  assert.deepStrictEqual(out.get(13), [
    { number: 5, repository: 'other/repo', state: 'OPEN' },
    { number: 7, repository: 'acme/x', state: 'CLOSED' },
  ]);
  assert.strictEqual(spawned.length, 1);
});

test('bodyForeignBlockers keys by id when a record has no number, reads an oversized ref null, and spawns nothing without foreign refs', () => {
  const spawn = () => ({ status: 0, stdout: '{"other/repo#5":"OPEN","big/repo#99999999999":null}\n' });
  const out = bodyForeignBlockers([{ id: 'local-1', body: 'Blocked by other/repo#5\nBlocked by big/repo#99999999999' }], { spawn, stderr: () => {} });
  assert.deepStrictEqual(out.get('local-1'), [
    { number: 5, repository: 'other/repo', state: 'OPEN' },
    { number: '99999999999', repository: 'big/repo', state: null },
  ]);

  const noSpawn = () => { throw new Error('must not spawn'); };
  assert.deepStrictEqual(bodyForeignBlockers([{ number: 1, body: 'Blocked by #4' }, { number: 2, body: null }], { spawn: noSpawn }), new Map());
  assert.deepStrictEqual(bodyForeignBlockers([], { spawn: noSpawn }), new Map());
});

// --- a pre-resolved states input (gh-absent transports, #4793) ---------------

const noSpawn = () => { throw new Error('must not spawn'); };

test('suppliedStates keys canonically and reads only exact OPEN or CLOSED, a string or a {state} object; anything else reads null', () => {
  const m = suppliedStates({
    'Other/Repo#5': 'OPEN', 'acme/x#007': { state: 'CLOSED' }, 'a/b#1': 'closed', 'a/b#2': null, 'a/b#3': 7, 'a/b#4': { state: 'merged' },
    '12': { state: 'OPEN' }, 'not a ref': 'OPEN',
  });
  assert.deepStrictEqual([...m], [['other/repo#5', 'OPEN'], ['acme/x#7', 'CLOSED'], ['a/b#1', null], ['a/b#2', null], ['a/b#3', null], ['a/b#4', null]]);
  assert.deepStrictEqual(suppliedStates(null), new Map());
  assert.deepStrictEqual(suppliedStates(['other/repo#5']), new Map());
  assert.deepStrictEqual([...suppliedStates(new Map([['Other/Repo#5', 'CLOSED']]))], [['other/repo#5', 'CLOSED']]);
});

test('resolveForeignStates answers a supplied ref without spawning, and asks the CLI only for the rest', () => {
  const err = [];
  const states = resolveForeignStates(['Other/Repo#5', 'acme/x#7'], { spawn: noSpawn, stderr: (s) => err.push(s), states: { 'other/repo#5': 'CLOSED', 'acme/x#7': 'OPEN' } });
  assert.deepStrictEqual([...states], [['other/repo#5', 'CLOSED'], ['acme/x#7', 'OPEN']]);
  assert.deepStrictEqual(err, [], 'a fully supplied call prints no Warning');

  const spawned = [];
  const spawn = (argv) => { spawned.push(argv); return { status: 0, stdout: '{"acme/x#7":"OPEN"}\n' }; };
  const mixed = resolveForeignStates(['other/repo#5', 'acme/x#7', 'big/repo#9'], { spawn, stderr: () => {}, states: new Map([['other/repo#5', 'CLOSED'], ['big/repo#9', null]]) });
  assert.deepStrictEqual([...mixed], [['other/repo#5', 'CLOSED'], ['acme/x#7', 'OPEN'], ['big/repo#9', null]]);
  assert.strictEqual(spawned.length, 1);
  assert.match(spawned[0][1], /^acme\/x#7$/, 'only the unsupplied ref reaches the CLI');
});

test('a supplied null or unreadable value fails closed and a ref left out still follows the gh-absent path', () => {
  const err = [];
  const failing = () => ({ status: 2, stdout: '', stderr: 'resolve-foreign-blockers.js: `gh` is required' });
  const states = resolveForeignStates(['other/repo#5', 'acme/x#7', 'c/d#1'], { spawn: failing, stderr: (s) => err.push(s), states: { 'other/repo#5': 'OPEN', 'acme/x#7': 'bogus' } });
  assert.deepStrictEqual([...states], [['other/repo#5', 'OPEN'], ['acme/x#7', null], ['c/d#1', null]]);
  assert.strictEqual(err.length, 1, 'only the left-out ref triggers the lookup failure Warning');
  assert.match(err[0], /^Warning: foreign blocker state lookup failed/);
});

function withStatesFile(content, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foreign-states-'));
  const file = path.join(dir, 'states.json');
  if (content !== null) fs.writeFileSync(file, content);
  try { return fn(file); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('deps.statesFile reads the supplied states; a missing, unparseable or non-object file is no states, with one Warning line', () => {
  withStatesFile('{"other/repo#5":"CLOSED"}', (file) => {
    const err = [];
    const s = resolveForeignStates(['other/repo#5'], { spawn: noSpawn, stderr: (m) => err.push(m), statesFile: file });
    assert.deepStrictEqual([...s], [['other/repo#5', 'CLOSED']]);
    assert.deepStrictEqual(err, []);
  });
  const failing = () => ({ status: 2, stdout: '', stderr: 'no gh' });
  const bad = [['a missing file', null], ['unparseable JSON', '{'], ['a JSON array', '["other/repo#5"]'], ['a JSON string', '"OPEN"'], ['JSON null', 'null']];
  for (const [label, content] of bad) {
    withStatesFile(content, (file) => {
      const err = [];
      const s = resolveForeignStates(['other/repo#5'], { spawn: failing, stderr: (m) => err.push(m), statesFile: file });
      assert.deepStrictEqual([...s], [['other/repo#5', null]], label);
      assert.strictEqual(err.length, 2, `${label}: one Warning for the states file, one for the lookup`);
      assert.match(err[0], /^Warning: foreign blocker states file .* ignored \(/, label);
      assert.ok(err[0].endsWith('\n') && err[0].split('\n').length === 2, `${label}: one line`);
    });
  }
});

test('deps.statesFile unset or empty changes nothing (no Warning, no read)', () => {
  const spawn = () => ({ status: 0, stdout: '{"other/repo#5":"OPEN"}\n' });
  for (const statesFile of [undefined, '']) {
    const err = [];
    const s = resolveForeignStates(['other/repo#5'], { spawn, stderr: (m) => err.push(m), statesFile });
    assert.deepStrictEqual([...s], [['other/repo#5', 'OPEN']]);
    assert.deepStrictEqual(err, []);
  }
});

test('bodyForeignBlockers builds its entries from supplied states and spawns nothing when they answer every ref', () => {
  const records = [{ number: 11, body: 'Blocked by other/repo#5' }, { number: 13, body: 'Blocked by other/repo#5\nBlocked by acme/x#7' }];
  const out = bodyForeignBlockers(records, { spawn: noSpawn, stderr: () => {}, states: { 'Other/Repo#5': 'CLOSED', 'acme/x#7': 'OPEN' } });
  assert.deepStrictEqual(out.get(11), [{ number: 5, repository: 'other/repo', state: 'CLOSED' }]);
  assert.deepStrictEqual(out.get(13), [
    { number: 5, repository: 'other/repo', state: 'CLOSED' },
    { number: 7, repository: 'acme/x', state: 'OPEN' },
  ]);
});

// --- resolve-foreign-blockers.js through run(argv, deps) ---------------------

function fakeDeps(overrides = {}) {
  const calls = { runner: [], stdout: [], stderr: [] };
  return {
    calls,
    ghAvailable: () => true,
    remoteUrl: () => 'https://github.com/acme/widgets.git',
    runner: (args) => {
      calls.runner.push(args);
      return JSON.stringify({ data: { c0: { issue: { state: 'OPEN' } } } });
    },
    stdout: (s) => calls.stdout.push(s),
    stderr: (s) => calls.stderr.push(s),
    ...overrides,
  };
}

test('the CLI prints one JSON line keyed by the distinct lowercased refs', () => {
  const deps = fakeDeps();
  assert.strictEqual(run(['other/repo#5,Other/Repo#5'], deps), 0);
  assert.strictEqual(deps.calls.stdout.join(''), '{"other/repo#5":"OPEN"}\n');
  assert.strictEqual(deps.calls.runner.length, 1);
});

test('the CLI exits 1 on a malformed ref, naming refs rather than numbers', () => {
  for (const argv of [['other/repo#x'], ['other/repo#5,'], ['#5'], ['5']]) {
    const deps = fakeDeps();
    assert.strictEqual(run(argv, deps), 1, JSON.stringify(argv));
    assert.match(deps.calls.stderr.join(''), /malformed <owner\/name#N>/);
    assert.match(deps.calls.stderr.join(''), /usage: resolve-foreign-blockers\.js/);
    assert.strictEqual(deps.calls.runner.length, 0);
  }
});

test('the CLI names refs, not numbers, when the argument is missing', () => {
  const deps = fakeDeps();
  assert.strictEqual(run([], deps), 1);
  assert.match(deps.calls.stderr.join(''), /missing <owner\/name#N> argument/);
  assert.doesNotMatch(deps.calls.stderr.join(''), /<n>/);
});

test('the CLI exits 3 on a throwing runner', () => {
  const deps = fakeDeps({ runner: () => { throw new Error('network down'); } });
  assert.strictEqual(run(['other/repo#5'], deps), 3);
  assert.match(deps.calls.stderr.join(''), /network down/);
  assert.deepStrictEqual(deps.calls.stdout, []);
});

test('the CLI exits 2 when gh is absent', () => {
  const deps = fakeDeps({ ghAvailable: () => false });
  assert.strictEqual(run(['other/repo#5'], deps), 2);
});

test('--repo ghe.example.com/acme/w reaches the fetch with host ghe.example.com', () => {
  const deps = fakeDeps();
  assert.strictEqual(run(['other/repo#5', '--repo', 'ghe.example.com/acme/w'], deps), 0);
  const argv = deps.calls.runner[0];
  assert.deepStrictEqual(argv.slice(-2), ['--hostname', 'ghe.example.com']);
});
