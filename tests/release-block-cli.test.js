// tests/release-block-cli.test.js — in-process tests for bin/release-block.js `check` (#5882):
// the durable "do not release" signal. A fake gh branches on the argv shape and throws on any
// shape it does not know, so a wrong query fails loudly.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run, parseArgs, EXIT, LIST_LIMIT } = require('../plugin/bin/release-block');
const { resolveAgainst } = require('../plugin/bin/lib/health-core/io');
const { captureGhTimeout } = require('./helpers/gh-timeout-probe');

const ROW7 = { number: 7, title: 'Fix the widget', url: 'https://github.com/acme/widgets/issues/7', state: 'OPEN' };
const ROW12 = { number: 12, title: 'Other', url: 'https://github.com/acme/widgets/issues/12', state: 'OPEN' };
const without = (row, key) => { const { [key]: _drop, ...rest } = row; return rest; };
const manyRows = (n) => Array.from({ length: n }, (_, i) => ({ ...ROW7, number: i + 1 }));
const BLOCKED_7 = '{"blocked":true,"records":[{"number":7,"title":"Fix the widget","url":"https://github.com/acme/widgets/issues/7"}]}\n';
const CLEAR = '{"blocked":false,"records":[]}\n';

function harness(overrides = {}, listText = JSON.stringify([ROW7])) {
  const calls = { gh: [], pin: [], stdout: [], stderr: [], readFile: [] };
  const deps = {
    cwd: () => '/work',
    env: {},
    homeDir: () => '/home',
    ghAvailable: () => true,
    remoteUrl: () => 'https://github.com/acme/widgets.git',
    pinGhHost: (spec) => { calls.pin.push(spec); },
    gh: (args, opts = {}) => {
      calls.gh.push({ args, input: opts.input });
      if (args[0] === 'issue' && args[1] === 'list') {
        if (typeof listText === 'function') return listText();
        return listText;
      }
      throw new Error(`unexpected ${args.join(' ')}`);
    },
    readFile: () => { throw new Error('unexpected readFile'); },
    stdout: (s) => calls.stdout.push(s),
    stderr: (s) => calls.stderr.push(s),
    ...overrides,
  };
  return { deps, calls, out: () => calls.stdout.join(''), err: () => calls.stderr.join('') };
}
const checkWith = (rows, args = ['check']) => {
  const h = harness({}, JSON.stringify(rows));
  const code = run(args, h.deps);
  return { code, ...h };
};

test('AC1.1: one open release-block record -> exit 1 and stdout names #7 and its title', () => {
  const r = checkWith([ROW7]);
  assert.equal(r.code, 1);
  assert.equal(r.out(), BLOCKED_7);
});

test('check: the query argv is exactly the open-state, labelled, limited list', () => {
  const r = checkWith([ROW7]);
  assert.equal(r.calls.gh.length, 1);
  assert.deepEqual(r.calls.gh[0].args, ['issue', 'list', '--repo', 'acme/widgets', '--label', 'release-block', '--state', 'open', '--limit', '100', '--json', 'number,title,url,state']);
});

test('AC3.1: no open record -> exit 0, stdout {"blocked":false,"records":[]}', () => {
  const r = checkWith([]);
  assert.equal(r.code, 0);
  assert.equal(r.out(), CLEAR);
});

test('check: two open records print in ascending number order', () => {
  const r = checkWith([ROW12, ROW7]);
  assert.equal(r.code, 1);
  assert.deepEqual(JSON.parse(r.out()).records.map((x) => x.number), [7, 12]);
});

test('AC6.1: a closed record carrying the label never blocks', () => {
  const r = checkWith([{ ...ROW7, state: 'CLOSED' }]);
  assert.equal(r.code, 0);
  assert.equal(r.out(), CLEAR);
});

test('AC4.1: an auth or network failure -> exit 3, stderr says state unreadable', () => {
  const failures = [
    Object.assign(new Error('gh: HTTP 401'), { stderr: 'HTTP 401: Bad credentials' }),
    new Error('error connecting to api.github.com'),
  ];
  for (const failure of failures) {
    const h = harness({}, () => { throw failure; });
    assert.equal(run(['check'], h.deps), 3);
    assert.match(h.err(), /state unreadable/);
    assert.equal(h.out(), '');
  }
});

test('AC4.3: malformed JSON -> exit 3, never 0', () => {
  const h = harness({}, 'not json');
  assert.equal(run(['check'], h.deps), 3);
  assert.match(h.err(), /state unreadable/);
  assert.equal(h.out(), '');
});

test('AC4.4: a record without url, title or a numeric number, a non-array, or empty stdout -> exit 3', () => {
  const cases = [
    JSON.stringify([without(ROW7, 'url')]),
    JSON.stringify([without(ROW7, 'title')]),
    JSON.stringify([without(ROW7, 'number')]),
    JSON.stringify([{ ...ROW7, number: '7' }]),
    JSON.stringify([{ ...ROW7, url: '' }]),
    JSON.stringify([{ ...ROW7, state: null }]),
    JSON.stringify([{ ...ROW7, state: 42 }]),
    JSON.stringify([{ ...ROW7, state: 'opne' }]),
    JSON.stringify([{ ...ROW7, state: 'MERGED' }]),
    '{}',
    '',
  ];
  for (const text of cases) {
    const h = harness({}, text);
    assert.equal(run(['check'], h.deps), 3, text);
    assert.equal(h.out(), '', text);
    assert.match(h.err(), /state unreadable/, text);
  }
});

test('AC7.1: a list that fills --limit 100 is truncated -> exit 3 (99 rows is a real block)', () => {
  const full = checkWith(manyRows(100));
  assert.equal(full.code, 3);
  assert.match(full.err(), /truncated/);
  assert.equal(full.out(), '');
  assert.equal(checkWith(manyRows(99)).code, 1);
});

test('check: a truncated list is refused before the state filter', () => {
  const rows = manyRows(100).map((row) => ({ ...row, state: 'CLOSED' }));
  assert.equal(checkWith(rows).code, 3);
});

test('check: gh absent and no --records-json -> exit 3, no gh call', () => {
  const h = harness({ ghAvailable: () => false, gh: () => { throw new Error('gh must not be called'); } });
  assert.equal(run(['check'], h.deps), 3);
  assert.match(h.err(), /--records-json/);
  assert.equal(h.out(), '');
});

test('check --records-json: no gh call and the same rules', () => {
  const via = (text) => {
    const h = harness({ gh: () => { throw new Error('gh must not be called'); }, readFile: () => text });
    return { code: run(['check', '--records-json', 'recs.json'], h.deps), h };
  };
  const blocked = via(JSON.stringify([ROW7]));
  assert.equal(blocked.code, 1);
  assert.equal(blocked.h.out(), BLOCKED_7);
  assert.equal(via(JSON.stringify([{ ...ROW7, state: 'closed' }])).code, 0);
  assert.equal(via(JSON.stringify([{ ...ROW7, state: 'open' }])).code, 1);
  assert.equal(via('[]').code, 0);
  assert.equal(via('{').code, 3);
  assert.equal(via(JSON.stringify([without(ROW7, 'url')])).code, 3);
  assert.equal(via(JSON.stringify(manyRows(100))).code, 3);
  const missing = harness({ readFile: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); } });
  assert.equal(run(['check', '--records-json', 'recs.json'], missing.deps), 3);
  assert.match(missing.err(), /state unreadable/);
});

test('check --records-json: a relative path is resolved against deps.cwd()', () => {
  const seen = [];
  const h = harness({ readFile: (p) => { seen.push(p); return '[]'; } });
  assert.equal(run(['check', '--records-json', 'recs.json'], h.deps), 0);
  assert.deepEqual(seen, [resolveAgainst('/work', 'recs.json')]);
});

test('usage -> exit 2 with no gh call', () => {
  const cases = [
    [],
    ['frobnicate'],
    ['check', '--bogus'],
    ['check', '--repo'],
    ['check', '--records-json'],
    ['check', '--records-json', 'r.json', '--repo', 'acme/widgets'],
  ];
  for (const argv of cases) {
    const h = harness();
    assert.equal(run(argv, h.deps), 2, argv.join(' '));
    assert.equal(h.calls.gh.length, 0);
  }
});

test('--help -> exit 0, usage on stdout, gh never probed', () => {
  const h = harness({ ghAvailable: () => { throw new Error('must not be probed'); } });
  assert.equal(run(['--help'], h.deps), 0);
  assert.match(h.out(), /usage: release-block\.js check/);
});

test('repo: --repo bare and host-qualified both reach gh as given, and the host is pinned', () => {
  for (const [repo, host] of [['acme/widgets', 'github.com'], ['ghe.example.com/acme/widgets', 'ghe.example.com']]) {
    const h = harness({}, '[]');
    assert.equal(run(['check', '--repo', repo], h.deps), 0);
    const args = h.calls.gh[0].args;
    assert.equal(args[args.indexOf('--repo') + 1], repo);
    assert.equal(h.calls.pin.length, 1);
    assert.equal(h.calls.pin[0].host, host);
    assert.equal(h.calls.pin[0].owner, 'acme');
    assert.equal(h.calls.pin[0].repo, 'widgets');
  }
  const origin = harness({}, '[]');
  run(['check'], origin.deps);
  assert.equal(origin.calls.pin.length, 0);
});

test('repo: no origin and no --repo -> exit 2', () => {
  const h = harness({ remoteUrl: () => { throw new Error('no origin'); } });
  assert.equal(run(['check'], h.deps), 2);
  assert.match(h.err(), /could not resolve owner\/repo/);
  assert.equal(h.calls.gh.length, 0);
});

test('parseArgs: check verb and unknown verb', () => {
  assert.equal(parseArgs(['check']).verb, 'check');
  assert.equal(parseArgs(['check', '--repo', 'a/b']).repo, 'a/b');
  assert.ok(parseArgs(['nope']).error);
});

test('public contract: EXIT and LIST_LIMIT values', () => {
  assert.deepStrictEqual(EXIT, { OK: 0, BLOCKED: 1, USAGE: 2, FAILURE: 3 });
  assert.equal(LIST_LIMIT, 100);
});

test('realDeps.gh carries the GH_TIMEOUT_MS bound', () => {
  const modulePath = require.resolve('../plugin/bin/release-block');
  const seen = captureGhTimeout({
    envValue: '45000',
    modulePaths: [modulePath],
    exercise: (setEnv) => {
      setEnv();
      const fresh = require('../plugin/bin/release-block');
      fresh.realDeps.gh(['issue', 'list']);
    },
  });
  assert.equal(seen, 45000);
});
