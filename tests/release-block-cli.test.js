// tests/release-block-cli.test.js — in-process tests for bin/release-block.js `check` (#5882):
// the durable "do not release" signal. A fake gh branches on the argv shape and throws on any
// shape it does not know, so a wrong query fails loudly.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readText } = require('./helpers/read-skill');
const path = require('path');
const { run, parseArgs, EXIT, LIST_LIMIT, LABEL, isValidFinding, stampCommentBody } = require('../plugin/bin/release-block');
const { ensureLabelPayload } = require('../plugin/bin/lib/issues/labels');
const { LABELS } = require('../plugin/bin/lib/issues/record');
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
  assert.equal(via(JSON.stringify([{ ...ROW7, state: 'opne' }])).code, 3);
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

// ---- stamp (#5882) ----
const F = 'security at plugin/skills/_shared/skill-load-gate.md:8';
const VIEW7 = { number: 7, state: 'OPEN', labels: [{ name: 'ready' }], url: 'https://github.com/acme/widgets/issues/7' };

// A fake gh scripting issue view / label list / label create / issue edit / issue comment.
function stampHarness({ view = VIEW7, labelList = '', handlers = {}, overrides = {} } = {}) {
  const order = [];
  const invalidated = [];
  const h = harness({
    env: { CLAUDE_CODE_SESSION_ID: 's1' },
    invalidateSnapshot: (id) => { order.push('invalidate'); invalidated.push(id); },
    ...overrides,
    gh: (args, opts = {}) => {
      h.calls.gh.push({ args, input: opts.input });
      const key = `${args[0]} ${args[1]}`;
      order.push(key);
      if (handlers[key]) return handlers[key](args, opts);
      if (key === 'issue view') return typeof view === 'string' ? view : JSON.stringify(view);
      if (key === 'label list') return typeof labelList === 'function' ? labelList() : labelList;
      if (key === 'label create' || key === 'issue edit' || key === 'issue comment') return '';
      throw new Error(`unexpected ${args.join(' ')}`);
    },
  });
  return Object.assign(h, { order, invalidated, keys: () => h.calls.gh.map((c) => `${c.args[0]} ${c.args[1]}`) });
}
const stampArgs = (extra = []) => ['stamp', '--record', '7', '--finding', F, ...extra];
const stampOut = (record, outcome) => `${JSON.stringify({ record, outcome })}\n`;

test('AC5.1: stamping an unlabelled record adds the label, then posts one comment naming the finding', () => {
  const h = stampHarness();
  assert.equal(run(stampArgs(), h.deps), 0);
  assert.deepEqual(h.keys(), ['issue view', 'label list', 'label create', 'issue edit', 'issue comment']);
  assert.deepEqual(h.calls.gh[3].args, ['issue', 'edit', '7', '--repo', 'acme/widgets', '--add-label', 'release-block']);
  assert.deepEqual(h.calls.gh[4].args, ['issue', 'comment', '7', '--repo', 'acme/widgets', '--body-file', '-']);
  assert.equal(h.calls.gh[4].input, stampCommentBody(F));
  assert.equal(h.out(), stampOut(7, 'stamped'));
});

test('stampCommentBody: the fixed copy', () => {
  assert.equal(stampCommentBody(F), `**Release block:** ${F}\n\nReleases stop while this record is open and carries the \`release-block\` label. To clear the block, close this record or remove the label.\n`);
});

test('stamp: the issue view argv', () => {
  const h = stampHarness();
  run(stampArgs(), h.deps);
  assert.deepEqual(h.calls.gh[0].args, ['issue', 'view', '7', '--repo', 'acme/widgets', '--json', 'number,state,labels,url']);
});

test('stamp: label bootstrap when missing — exact-name match over a fuzzy search', () => {
  const fuzzy = stampHarness({ labelList: 'fix-on-worktree-release-install-commands\nfix-on-worktree-design-release-skill\nrelease-block-old\n' });
  assert.equal(run(stampArgs(), fuzzy.deps), 0);
  const creates = fuzzy.calls.gh.filter((c) => c.args[1] === 'create');
  assert.equal(creates.length, 1);
  assert.deepEqual(creates[0].args, ['label', 'create', 'release-block', '--repo', 'acme/widgets', '--color', 'B4006E', '--description', LABEL.description]);
  const present = stampHarness({ labelList: 'release-block\n' });
  assert.equal(run(stampArgs(), present.deps), 0);
  assert.equal(present.calls.gh.filter((c) => c.args[1] === 'create').length, 0);
});

test('stamp: a label create that loses a race proceeds; one that fails outright is a write failure', () => {
  let lists = 0;
  const raced = stampHarness({
    labelList: () => (++lists === 1 ? '' : 'release-block\n'),
    handlers: { 'label create': () => { throw new Error('already exists'); } },
  });
  assert.equal(run(stampArgs(), raced.deps), 0);
  assert.ok(raced.keys().includes('issue edit') && raced.keys().includes('issue comment'));
  const failed = stampHarness({ handlers: { 'label create': () => { throw new Error('HTTP 500'); } } });
  assert.equal(run(stampArgs(), failed.deps), 3);
  assert.ok(!failed.keys().includes('issue edit'));
  assert.ok(!failed.keys().includes('issue comment'));
});

test('stamp: label before comment — a failed comment leaves the label', () => {
  const h = stampHarness({ labelList: 'release-block\n', handlers: { 'issue comment': () => { throw new Error('HTTP 502'); } } });
  assert.equal(run(stampArgs(), h.deps), 3);
  assert.ok(h.keys().indexOf('issue edit') > -1 && h.keys().indexOf('issue edit') < h.keys().indexOf('issue comment'));
  assert.ok(!h.calls.gh.some((c) => c.args.includes('--remove-label')));
  assert.match(h.err(), /label stays/);
  assert.match(h.err(), /the comment failed \(HTTP 502\)/, 'the cause is quoted for disposition\'s FAILED line');
});

test('stamp: a failed label edit posts no comment', () => {
  const h = stampHarness({ labelList: 'release-block\n', handlers: { 'issue edit': () => { throw new Error('HTTP 403'); } } });
  assert.equal(run(stampArgs(), h.deps), 3);
  assert.ok(!h.keys().includes('issue comment'));
  assert.deepEqual(h.invalidated, []);
});

test('stamp: re-stamping an already-labelled record is a no-op', () => {
  const h = stampHarness({ view: { ...VIEW7, labels: [{ name: 'release-block' }] } });
  assert.equal(run(stampArgs(), h.deps), 0);
  assert.equal(h.out(), stampOut(7, 'already-stamped'));
  assert.deepEqual(h.keys(), ['issue view']);
  assert.deepEqual(h.invalidated, []);
});

test('stamp: no such record -> exit 2', () => {
  const h = stampHarness({ handlers: { 'issue view': () => { throw Object.assign(new Error('x'), { stderr: 'GraphQL: Could not resolve to an issue or pull request with the number of 999999. (repository.issue)' }); } } });
  assert.equal(run(['stamp', '--record', '999999', '--finding', F], h.deps), 2);
  assert.match(h.err(), /no such record #999999/);
});

test('stamp: a PR number -> exit 2, nothing labelled', () => {
  const h = stampHarness({ view: { ...VIEW7, url: 'https://github.com/acme/widgets/pull/7' } });
  assert.equal(run(stampArgs(), h.deps), 2);
  assert.deepEqual(h.keys(), ['issue view']);
  assert.match(h.err(), /pull request, not a record/);
});

test('stamp: an unreadable view -> exit 3', () => {
  const net = stampHarness({ handlers: { 'issue view': () => { throw new Error('error connecting to api.github.com'); } } });
  assert.equal(run(stampArgs(), net.deps), 3);
  const junk = stampHarness({ view: 'not json' });
  assert.equal(run(stampArgs(), junk.deps), 3);
  assert.deepEqual(junk.keys(), ['issue view']);
});

test('stamp: a closed record is stamped, with a stderr note that it never blocks', () => {
  const h = stampHarness({ view: { ...VIEW7, state: 'CLOSED' }, labelList: 'release-block\n' });
  assert.equal(run(stampArgs(), h.deps), 0);
  assert.match(h.err(), /closed record never blocks/);
  assert.equal(h.out(), stampOut(7, 'stamped'));
});

test('stamp: the label write invalidates the session record snapshot once, after issue edit', () => {
  const h = stampHarness({ labelList: 'release-block\n' });
  assert.equal(run(stampArgs(), h.deps), 0);
  assert.deepEqual(h.invalidated, ['s1']);
  assert.equal(h.order.indexOf('invalidate'), h.order.indexOf('issue edit') + 1);
});

test('stamp usage -> exit 2, zero gh calls; two findings are accepted', () => {
  const bad = [
    ['stamp', '--finding', F],
    ['stamp', '--record', '0', '--finding', F],
    ['stamp', '--record', 'abc', '--finding', F],
    ['stamp', '--record', '7x', '--finding', F],
    ['stamp', '--finding', F, '--record'],
    ['stamp', '--record', '7'],
    ['stamp', '--record', '7', '--finding', 'no location'],
    ['stamp', '--record', '7', '--finding', 'security at a.js:8\nmore'],
    ['stamp', '--record', '7', '--finding', F, '--records-json', 'r.json'],
  ];
  for (const argv of bad) {
    const h = stampHarness();
    assert.equal(run(argv, h.deps), 2, argv.join(' '));
    assert.equal(h.calls.gh.length, 0, argv.join(' '));
  }
  for (const finding of ['security at general', F]) {
    assert.ok(isValidFinding(finding));
    const h = stampHarness({ labelList: 'release-block\n' });
    assert.equal(run(['stamp', '--record', '7', '--finding', finding], h.deps), 0);
  }
});

test('stamp: gh absent -> exit 3 with zero gh calls', () => {
  const h = stampHarness({ overrides: { ghAvailable: () => false } });
  assert.equal(run(stampArgs(), h.deps), 3);
  assert.equal(h.calls.gh.length, 0);
});

test('label twin: LABEL equals the canonical LABELS_JSON row and LABELS.RELEASE_BLOCK', () => {
  const md = readText(path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'label-bootstrap.md'));
  const fence = md.match(/## Canonical LABELS_JSON[\s\S]*?```js\n([\s\S]*?)\n```/);
  assert.ok(fence);
  const row = JSON.parse(fence[1]).find(([name]) => name === 'release-block');
  assert.deepEqual(row, [LABEL.name, LABEL.description, LABEL.color]);
  assert.doesNotThrow(() => ensureLabelPayload(...row));
  assert.equal(LABELS.RELEASE_BLOCK, 'release-block');
  assert.equal(LABEL.name, LABELS.RELEASE_BLOCK);
  const current = md.match(/current value: `(\d+)`/);
  assert.ok(Number(current[1]) >= 11);
});

test('stamp: an invalidateSnapshot that throws still stamps — exit 0, comment posted, stderr note', () => {
  const h = stampHarness({ labelList: 'release-block\n', overrides: { invalidateSnapshot: () => { throw new Error('EACCES'); } } });
  assert.equal(run(stampArgs(), h.deps), 0);
  assert.ok(h.keys().includes('issue comment'));
  assert.equal(h.out(), stampOut(7, 'stamped'));
  assert.match(h.err(), /could not invalidate the session record snapshot/);
});

test('stamp: a view without url or labels, or not an object -> exit 3 before any write', () => {
  for (const view of ['{}', '[]', JSON.stringify({ number: 7, state: 'OPEN', labels: [] }), JSON.stringify({ number: 7, url: 'https://github.com/acme/widgets/issues/7' })]) {
    const h = stampHarness({ view });
    assert.equal(run(stampArgs(), h.deps), 3, view);
    assert.deepEqual(h.keys(), ['issue view'], view);
  }
});

test('stamp: --repo pins the host before the first gh call and reaches gh as given', () => {
  const h = stampHarness({ labelList: 'release-block\n' });
  const order = [];
  const gh = h.deps.gh;
  h.deps.gh = (args, opts) => { order.push('gh'); return gh(args, opts); };
  const pin = h.deps.pinGhHost;
  h.deps.pinGhHost = (spec, o) => { order.push('pin'); return pin(spec, o); };
  assert.equal(run(stampArgs(['--repo', 'ghe.example.com/acme/widgets']), h.deps), 0);
  assert.equal(order[0], 'pin');
  assert.equal(h.calls.pin.length, 1);
  assert.equal(h.calls.pin[0].host, 'ghe.example.com');
  for (const c of h.calls.gh) assert.equal(c.args[c.args.indexOf('--repo') + 1], 'ghe.example.com/acme/widgets');
});

test('stamp: a throwing label list, or a throwing re-list after a failed create -> exit 3, no edit or comment', () => {
  const first = stampHarness({ labelList: () => { throw new Error('HTTP 500'); } });
  assert.equal(run(stampArgs(), first.deps), 3);
  assert.deepEqual(first.keys(), ['issue view', 'label list']);
  let lists = 0;
  const relist = stampHarness({
    labelList: () => { if (++lists === 2) throw new Error('HTTP 500'); return ''; },
    handlers: { 'label create': () => { throw new Error('boom'); } },
  });
  assert.equal(run(stampArgs(), relist.deps), 3);
  assert.ok(!relist.keys().includes('issue edit') && !relist.keys().includes('issue comment'));
});

test('isValidFinding: accepts real locations, rejects malformed ones', () => {
  for (const ok of [F, 'security at general', 'security at docs/my file.md:3', 'security at plugin/x.md:8:12', 'security at C:/x.js:3', 'x at y at file:1', 'x at y at general', 'security at a.js:12-15', 'security at C:/x.js:3-4', 'x at a.js:8:12-15']) {
    assert.ok(isValidFinding(ok), ok);
  }
  for (const bad of ['no location', 'security at a.js:8\nmore', ' at a.js:8', 'security at ', 'security at a.js:', 'security at a.js:x', 'x at y at nowhere', 'security \tat general\r', 'security\tat general', 'security \tat a.js:3', 'security\t at general', 'security\t at a.js:3', 'security at a.js:12-', 'security at a.js:-5', 'security at a.js:1-2-3', 'security at a.js:12-x', 'security at a.js:12--15']) {
    assert.ok(!isValidFinding(bad), JSON.stringify(bad));
  }
  const h = stampHarness({ labelList: 'release-block\n' });
  assert.equal(run(['stamp', '--record', '7', '--finding', 'security at docs/my file.md:3'], h.deps), 0);
  const ranged = stampHarness({ labelList: 'release-block\n' });
  assert.equal(run(['stamp', '--record', '7', '--finding', 'security at a.js:12-15'], ranged.deps), 0);
  assert.equal(ranged.calls.gh.find((c) => c.args[1] === 'comment').input, stampCommentBody('security at a.js:12-15'));
});

test('stamp: a 200 KB finding of repeated " at " is rejected as usage (correctness only)', () => {
  const h = stampHarness();
  assert.equal(run(['stamp', '--record', '7', '--finding', 'x at '.repeat(40000) + 'z'], h.deps), 2);
  assert.equal(h.calls.gh.length, 0);
});

test('stamp --finding-file: the finding is read from the file, so shell metacharacters reach the comment verbatim', () => {
  const finding = 'security at app/routes/posts.$(touch x)`id`".tsx:8';
  const seen = [];
  const h = stampHarness({ labelList: 'release-block\n', overrides: { readFile: (p) => { seen.push(p); return `${finding}\n`; } } });
  assert.equal(run(['stamp', '--record', '7', '--finding-file', 'finding.txt'], h.deps), 0);
  assert.deepEqual(seen, [resolveAgainst('/work', 'finding.txt')]);
  const comment = h.calls.gh.find((c) => c.args[0] === 'issue' && c.args[1] === 'comment');
  assert.equal(comment.input, stampCommentBody(finding));
});

test('stamp --finding-file: unreadable, malformed, or combined with --finding -> exit 2, zero gh calls', () => {
  const cases = [
    { argv: ['stamp', '--record', '7', '--finding-file', 'f.txt'], readFile: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); } },
    { argv: ['stamp', '--record', '7', '--finding-file', 'f.txt'], readFile: () => 'no location\n' },
    { argv: ['stamp', '--record', '7', '--finding-file', 'f.txt'], readFile: () => 'security at a.js:8\nmore\n' },
    { argv: ['stamp', '--record', '7', '--finding-file', 'f.txt', '--finding', F], readFile: () => `${F}\n` },
    { argv: ['stamp', '--record', '7', '--finding-file', '--repo'], readFile: () => `${F}\n` },
  ];
  for (const { argv, readFile } of cases) {
    const h = stampHarness({ overrides: { readFile } });
    assert.equal(run(argv, h.deps), 2, argv.join(' '));
    assert.equal(h.calls.gh.length, 0, argv.join(' '));
  }
});

test('a working directory that throws -> exit 3 state unreadable, never 1, for both verbs', () => {
  for (const argv of [['check'], stampArgs()]) {
    const h = stampHarness({ overrides: { cwd: () => { throw new Error('ENOENT: uv_cwd'); } } });
    assert.equal(run(argv, h.deps), 3, argv.join(' '));
    assert.match(h.err(), /state unreadable — working directory unavailable/);
    assert.equal(h.calls.gh.length, 0);
  }
});

test('repo: an origin host that is not a known GitHub host is refused -> exit 2 for both verbs, no gh call', () => {
  for (const argv of [['check'], stampArgs()]) {
    const h = stampHarness({ overrides: { remoteUrl: () => 'https://gitlab.example.com/acme/widgets.git' } });
    assert.equal(run(argv, h.deps), 2, argv.join(' '));
    assert.match(h.err(), /not a known GitHub host/);
    assert.equal(h.calls.gh.length, 0);
  }
});

test('check: a null row, and a row whose number is 0 or negative -> exit 3, never 1', () => {
  for (const rows of [[null], [{ ...ROW7, number: 0 }], [{ ...ROW7, number: -7 }]]) {
    const r = checkWith(rows);
    assert.equal(r.code, 3, JSON.stringify(rows));
    assert.match(r.err(), /state unreadable/);
    assert.equal(r.out(), '');
  }
});

test('check: a --records-json row with no state is treated as open — it blocks', () => {
  const h = harness({ gh: () => { throw new Error('gh must not be called'); }, readFile: () => JSON.stringify([without(ROW7, 'state')]) });
  assert.equal(run(['check', '--records-json', 'recs.json'], h.deps), 1);
  assert.equal(h.out(), BLOCKED_7);
});

test('--help names both verbs\' exit contracts', () => {
  const h = stampHarness();
  assert.equal(run(['--help'], h.deps), 0);
  assert.match(h.out(), /stamp: exit 0 stamped or already stamped; 2 usage/);
  assert.match(h.out(), /check: exit 0 none open; 1 blocked; 2 usage, or an unresolvable or refused repo; 3/);
  assert.match(h.out(), /stamp: [^\n]*2 usage, an unresolvable or refused repo, no such record/);
});
