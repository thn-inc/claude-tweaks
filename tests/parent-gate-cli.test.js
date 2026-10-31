'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { run, USAGE } = require('../plugin/bin/parent-gate');
const { VERDICT_FIELDS, CLOSE_HEADING } = require('../plugin/bin/lib/issues/parent-gate');
const { buildNativeParentQuery, buildNativeSubIssuesQuery } = require('../plugin/bin/lib/issues/record');

// The eight gh call shapes (the plan's Global Constraints), owner/repo o/r.
const SHAPE = {
  parent: (n) => ['api', 'graphql', '-f', `query=${buildNativeParentQuery([n])}`, '-f', 'owner=o', '-f', 'repo=r'],
  probe: () => ['api', 'graphql', '-f', 'query={ __type(name: "Issue") { fields { name } } }'],
  page: (p) => ['api', 'graphql', '-f', `query=${buildNativeSubIssuesQuery([p])}`, '-f', 'owner=o', '-f', 'repo=r'],
  rest: (p) => ['api', '--paginate', `repos/o/r/issues/${p}/sub_issues`, '--jq', '.[].number'],
};

// A fake gh answering by exact argv; anything else throws. `world`:
//   parentOf {sub: parent}, bodies {n: text}, subs {parent: [n]}, hasNextPage {parent: bool},
//   rest {parent: [n]}, issues {n: {state, stateReason, labels}}, parentLabels {parent: [names]},
//   parentLive {parent: {...}}, login, throwWhen(key).
function makeGh(world) {
  const calls = [];
  const same = (args, want) => args.length === want.length && args.every((a, i) => a === want[i]);
  const gh = (args) => {
    calls.push(args);
    const key = args.join(' ');
    if (world.throwWhen && world.throwWhen(key)) throw new Error(`boom: ${key}`);
    if (args[0] === 'api' && args[1] === 'graphql') {
      const q = String(args[3]);
      if (q.startsWith('query={ __type') && same(args, SHAPE.probe())) {
        return JSON.stringify({ data: { __type: { fields: [{ name: 'subIssues' }, { name: 'blockedBy' }] } } });
      }
      const n = Number((/i(\d+):/.exec(q) || [])[1]);
      if (q.includes('subIssues(first:100)') && same(args, SHAPE.page(n))) {
        const subs = (world.subs || {})[n] || [];
        const hasNextPage = Boolean((world.hasNextPage || {})[n]);
        return JSON.stringify({ data: { repository: { [`i${n}`]: { number: n, subIssues: { nodes: subs.map((number) => ({ number })), pageInfo: { hasNextPage } } } } } });
      }
      if (q.includes('parent{') && same(args, SHAPE.parent(n))) {
        const parent = (world.parentOf || {})[n];
        return JSON.stringify({ data: { repository: { [`i${n}`]: { number: n, parent: parent ? { number: parent } : null } } } });
      }
    }
    let m = /^api --paginate repos\/o\/r\/issues\/(\d+)\/sub_issues --jq \.\[\]\.number$/.exec(key);
    if (m) return `${((world.rest || world.subs || {})[m[1]] || []).join('\n')}\n`;
    m = /^issue view (\d+) --json body -q \.body$/.exec(key);
    if (m) return (world.bodies || {})[m[1]] || '';
    m = /^issue view (\d+) --repo o\/r --json state,stateReason,labels,title,closedByPullRequestsReferences$/.exec(key);
    if (m) {
      const i = (world.issues || {})[m[1]] || {};
      return JSON.stringify({
        state: i.state || 'CLOSED', stateReason: 'stateReason' in i ? i.stateReason : 'COMPLETED', title: `Title ${m[1]}`,
        labels: (i.labels || ['risk:low']).map((name) => ({ name })),
        closedByPullRequestsReferences: [],
      });
    }
    m = /^issue view (\d+) --json labels -q \[\.labels\[\]\.name\]$/.exec(key);
    if (m) return JSON.stringify((world.parentLabels || {})[m[1]] || ['parent-issue']);
    m = /^issue view (\d+) --json state,stateReason,comments$/.exec(key);
    if (m) return JSON.stringify((world.parentLive || {})[m[1]] || { state: 'OPEN', stateReason: '', comments: [] });
    if (key === 'api user --jq .login') return `${world.login || 'bot'}\n`;
    throw new Error(`unexpected gh call: ${key}`);
  };
  return { gh, calls };
}

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const OPEN = { state: 'OPEN', stateReason: '' };

// Parent 10 (parent-issue) with sub-issues 11 and 12 and the `native`/`high` policy; `over` replaces deps.
function go(argv, world = {}, over = {}) {
  const { gh, calls } = makeGh({ parentOf: { 11: 10, 12: 10 }, subs: { 10: [11, 12] }, ...world });
  const out = [];
  const err = [];
  const deps = {
    ghAvailable: () => true,
    remoteUrl: () => 'git@github.com:o/r.git',
    runner: gh,
    repoRoot: () => '/repo',
    readPolicyRaw: () => 'work-links: native\nrisk-floor: high\n',
    readWorkBackend: () => 'github-issues',
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    ...over,
  };
  const code = run(argv, deps);
  const stdout = out.join('');
  return {
    code, stdout, stderr: err.join(''), calls, verdict: stdout.startsWith('{') ? JSON.parse(stdout) : null,
  };
}

const subViews = (calls) => calls.filter((a) => a[0] === 'issue' && a[1] === 'view' && a.includes('--repo'));
const seen = (calls, want) => calls.filter((a) => a.length === want.length && a.every((x, i) => x === want[i])).length;
const isShape7 = (a) => a[0] === 'issue' && a[3] === '--json' && a[4] === 'state,stateReason,comments';
const isShape8 = (a) => a[0] === 'api' && a[1] === 'user';

// --- acceptance cases ---

test('AC1.1: a parent with more than 30 sub-issues is enumerated in full', () => {
  const nums = range(100, 134);
  const world = { subs: { 10: nums }, issues: { 130: OPEN } };
  const open = go(['--parent', '10', '--idempotence'], world);
  assert.equal(open.code, 0);
  assert.equal(open.verdict.state, 'incomplete');
  assert.equal(open.verdict.subIssues.length, 35);
  assert.equal(seen(open.calls, SHAPE.probe()), 1);
  assert.equal(seen(open.calls, SHAPE.page(10)), 1);
  assert.equal(seen(open.calls, SHAPE.rest(10)), 0);
  assert.equal(subViews(open.calls).length, 35);

  const closed = go(['--parent', '10', '--idempotence'], { subs: { 10: nums } });
  assert.equal(closed.verdict.state, 'due');
  assert.equal(closed.verdict.exceeds, false);
  assert.equal(closed.verdict.closeReason, 'completed');
  assert.equal(closed.verdict.idempotence, 'comment-and-close');
  assert.equal(closed.verdict.subIssues.length, 35);
});

test("AC1.1: a parent past the fetcher's 100 page size is enumerated through --paginate", () => {
  const r = go(['--parent', '10'], { subs: { 10: range(100, 199) }, hasNextPage: { 10: true }, rest: { 10: range(100, 219) } });
  assert.equal(r.code, 0);
  assert.equal(r.verdict.subIssues.length, 120);
  assert.equal(seen(r.calls, SHAPE.rest(10)), 1);
  assert.deepEqual(SHAPE.rest(10), ['api', '--paginate', 'repos/o/r/issues/10/sub_issues', '--jq', '.[].number']);
});

test('without --idempotence the verdict reads no comments and no login', () => {
  const r = go(['--parent', '10']);
  assert.equal(r.verdict.state, 'due');
  assert.equal(r.verdict.exceeds, false);
  assert.equal(r.verdict.idempotence, null);
  assert.deepEqual(r.verdict.skipped, []);
  assert.equal(r.calls.filter(isShape7).length, 0);
  assert.equal(r.calls.filter(isShape8).length, 0);
});

test('--idempotence reads nothing for a parent that is not due below the floor', () => {
  const above = go(['--parent', '10', '--idempotence'], { issues: { 12: { labels: ['risk:high'] } } });
  assert.equal(above.verdict.state, 'due');
  assert.equal(above.verdict.exceeds, true);
  assert.equal(above.verdict.idempotence, null);
  assert.equal(above.calls.filter(isShape7).length + above.calls.filter(isShape8).length, 0);
});

test('AC1.2: all closed not-planned', () => {
  const notPlanned = { 11: { stateReason: 'NOT_PLANNED' }, 12: { stateReason: 'NOT_PLANNED' } };
  const r = go(['--parent', '10'], { issues: notPlanned });
  assert.equal(r.verdict.state, 'due');
  assert.equal(r.verdict.closeReason, 'not planned');
  const member = go(['--sub-issue', '11', '--closing', '11'], { issues: { 11: OPEN, 12: { stateReason: 'NOT_PLANNED' } } });
  assert.equal(member.verdict.state, 'due');
  assert.equal(member.verdict.closeReason, 'completed');
});

test("AC1.3: a cross-repo closing token does not close this repo's sub-issue", () => {
  const world = { issues: { 11: OPEN } };
  const foreign = go(['--sub-issue', '12', '--closing', 'other/r#11,12'], world);
  assert.equal(foreign.code, 0);
  assert.equal(foreign.verdict.state, 'incomplete');
  const own = go(['--sub-issue', '12', '--closing', 'o/r#11,12'], world);
  assert.equal(own.verdict.state, 'due');
});

test('AC1.4: a human-reopened parent', () => {
  const r = go(['--parent', '10', '--idempotence'], { parentLive: { 10: { state: 'OPEN', stateReason: 'REOPENED', comments: [] } } });
  assert.equal(r.code, 0);
  assert.equal(r.verdict.state, 'due');
  assert.equal(r.verdict.idempotence, 'reopened');
  assert.equal(r.calls.filter(isShape7).length, 1);
  assert.equal(r.calls.filter(isShape8).length, 0);
});

test('--idempotence names an untrusted heading comment in skipped', () => {
  const planted = { body: `x\n${CLOSE_HEADING}\n`, authorAssociation: 'NONE', author: { login: 'stranger' }, url: 'u-planted' };
  const r = go(['--parent', '10', '--idempotence'], { parentLive: { 10: { state: 'OPEN', stateReason: '', comments: [planted] } } });
  assert.equal(r.verdict.idempotence, 'comment-and-close');
  assert.equal(r.verdict.skipped.length, 1);
  assert.ok(r.verdict.skipped[0].includes('u-planted'), r.verdict.skipped[0]);
  const own = { ...planted, author: { login: 'bot' }, url: 'u-own' };
  const counted = go(['--parent', '10', '--idempotence'], { parentLive: { 10: { state: 'OPEN', stateReason: '', comments: [own] } } });
  assert.equal(counted.verdict.idempotence, 'close-only');
  assert.deepEqual(counted.verdict.skipped, []);
});

test('AC1.5: a parent without parent-issue', () => {
  const r = go(['--parent', '10'], { parentLabels: { 10: [] } });
  assert.equal(r.code, 0);
  assert.equal(r.verdict.parentIssue, false);
  assert.equal(r.verdict.state, 'due');
});

// --- resolution and the closing set ---

test("body-text resolves Parent: #N and the parent's task list", () => {
  const r = go(['--sub-issue', '11', '--work-links', 'body-text'], {
    bodies: { 11: 'Intro\n\nParent: #10\n', 10: '- [ ] #11\n- [x] #12\n' },
  });
  assert.equal(r.code, 0);
  assert.equal(r.verdict.parent, 10);
  assert.equal(r.verdict.subIssues.length, 2);
  assert.equal(r.calls.filter((a) => a[0] === 'api' && a[1] === 'graphql').length, 0);
});

test('no resolvable parent prints no-parent', () => {
  const r = go(['--sub-issue', '11'], { parentOf: {} });
  assert.equal(r.code, 0);
  assert.equal(r.verdict.parent, null);
  assert.equal(r.verdict.state, 'no-parent');
  assert.equal(r.calls.length, 1);
});

test('--sub-issue without --closing counts itself closed', () => {
  const r = go(['--sub-issue', '11'], { issues: { 11: OPEN } });
  assert.equal(r.verdict.state, 'due');
  const unrelated = go(['--parent', '10'], { issues: { 11: OPEN } });
  assert.equal(unrelated.verdict.state, 'incomplete');
});

test('--held and --merging-pr reach the verdict', () => {
  const r = go(['--sub-issue', '11', '--held', '12', '--merging-pr', '40']);
  assert.deepEqual(r.verdict.held, [12]);
  assert.equal(r.verdict.subIssues[0].pr, 40);
});

test('the policy file supplies the floor and work-links; flags override', () => {
  const policy = { readPolicyRaw: () => 'work-links: native\nrisk-floor: low\n' };
  const low = go(['--parent', '10'], {}, policy);
  assert.equal(low.verdict.riskFloor, 'low');
  assert.equal(low.verdict.exceeds, true);
  const flag = go(['--parent', '10', '--risk-floor', 'high'], {}, policy);
  assert.equal(flag.verdict.riskFloor, 'high');
  assert.equal(flag.verdict.exceeds, false);
  const bodyText = go(['--sub-issue', '11'], { bodies: { 11: 'Parent: #10', 10: '- [ ] #11\n- [x] #12\n' } }, { readPolicyRaw: () => 'work-links: body-text\n' });
  assert.equal(bodyText.verdict.parent, 10);
  assert.equal(bodyText.calls.filter((a) => a[1] === 'graphql').length, 0);
});

test('an unreadable policy file and repo root fall back to the schema defaults', () => {
  const boom = () => { throw new Error('boom'); };
  const r = go(['--sub-issue', '11'], { bodies: { 11: 'Parent: #10', 10: '- [ ] #11\n- [x] #12\n' } }, { readPolicyRaw: boom, repoRoot: boom });
  assert.equal(r.code, 0);
  assert.equal(r.verdict.parent, 10);
  assert.equal(r.verdict.riskFloor, 'high');
  assert.equal(r.calls.filter((a) => a[1] === 'graphql').length, 0);
});

test('stdout is one JSON line in VERDICT_FIELDS order', () => {
  for (const argv of [['--parent', '10', '--idempotence'], ['--sub-issue', '11']]) {
    const r = go(argv, argv[0] === '--sub-issue' ? { parentOf: {} } : {});
    assert.ok(r.stdout.endsWith('\n'));
    assert.equal(r.stdout.trimEnd().split('\n').length, 1);
    assert.deepEqual(Object.keys(r.verdict), VERDICT_FIELDS);
    assert.equal(r.stderr, '');
  }
});

// --- exit codes ---

test('exit 1 with nothing on stdout: a malformed invocation', () => {
  const bad = [
    [],
    ['--sub-issue', '11', '--parent', '10'],
    ['--sub-issue', '0'],
    ['--sub-issue'],
    ['--sub-issue', '11', '--closing', ''],
    ['--sub-issue', '11', '--closing', 'a/b#x'],
    ['--sub-issue', '11', '--held', 'x'],
    ['--sub-issue', '11', '--merging-pr', '0'],
    ['--sub-issue', '11', '--idempotence', 'yes'],
    ['--sub-issue', '11', '--risk-floor', 'bogus'],
    ['--sub-issue', '11', '--risk-floor'],
    ['--sub-issue', '11', '--work-links', 'bogus'],
    ['--sub-issue', '11', '--backend', 'bogus'],
    ['--sub-issue', '11', '--repo', 'o/r'],
    ['--sub-issue', '11', '--bogus'],
    ['--sub-issue', '11', '--sub-issue', '12'],
    ['--sub-issue', '--closing', '11'],
  ];
  for (const argv of bad) {
    // gh absent too: a malformed invocation is exit 1 whatever the environment (not 2).
    const r = go(argv, { throwWhen: () => true }, { ghAvailable: () => false });
    assert.equal(r.code, 1, JSON.stringify(argv));
    assert.equal(r.stdout, '', JSON.stringify(argv));
    assert.ok(r.stderr.length > 0, JSON.stringify(argv));
    assert.equal(r.calls.length, 0, JSON.stringify(argv));
  }
  // A flag with no value of its own is named, not misread as a value.
  assert.match(go(['--sub-issue', '--closing', '11']).stderr, /missing value for --sub-issue/);
  assert.match(go(['--sub-issue', '11', '--closing', '']).stderr, /missing value for --closing/);
  assert.match(go(['--sub-issue', '11', '--risk-floor']).stderr, /missing value for --risk-floor/);
});

test('exit 1: --facts-json is not implemented yet and local-files is refused', () => {
  const facts = go(['--sub-issue', '11', '--facts-json', 'f.json']);
  assert.equal(facts.code, 1);
  assert.equal(facts.stdout, '');
  const flag = go(['--sub-issue', '11', '--backend', 'local-files']);
  assert.equal(flag.code, 1);
  assert.match(flag.stderr, /--backend local-files is not supported yet/);
  assert.equal(flag.stdout, '');
  const configured = go(['--sub-issue', '11'], {}, { readWorkBackend: () => 'local-files' });
  assert.equal(configured.code, 1);
  assert.match(configured.stderr, /--backend local-files is not supported yet/);
  const other = go(['--sub-issue', '11'], {}, { readWorkBackend: () => null });
  assert.equal(other.code, 0);
});

test('a throwing readWorkBackend reads as github-issues', () => {
  const r = go(['--parent', '10'], {}, { readWorkBackend: () => { throw new Error('boom'); } });
  assert.equal(r.code, 0);
  assert.equal(r.verdict.state, 'due');
});

test('a throwing ghAvailable reads as gh absent', () => {
  const r = go(['--sub-issue', '11'], {}, { ghAvailable: () => { throw new Error('boom'); } });
  assert.equal(r.code, 2);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /--facts-json/);
  assert.equal(r.calls.length, 0);
});

test('exit 2: neither the repo root nor the cwd can be determined', () => {
  const boom = () => { throw new Error('boom'); };
  const r = go(['--sub-issue', '11'], {}, { repoRoot: boom, cwd: boom });
  assert.equal(r.code, 2);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /repository root/);
  assert.equal(r.calls.length, 0);
  // A working cwd still carries the run when only repoRoot fails.
  assert.equal(go(['--parent', '10'], {}, { repoRoot: boom, cwd: () => '/elsewhere' }).code, 0);
});

test('exit 2: gh is absent, naming --facts-json', () => {
  const r = go(['--sub-issue', '11'], {}, { ghAvailable: () => false });
  assert.equal(r.code, 2);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /--facts-json/);
  assert.equal(r.calls.length, 0);
});

test('exit 2: owner/repo cannot be resolved', () => {
  const boom = () => { throw new Error('not a git repo'); };
  for (const remoteUrl of [boom, () => null, () => 'not a remote', () => 'git@github.com:../r.git']) {
    const r = go(['--sub-issue', '11'], {}, { remoteUrl });
    assert.equal(r.code, 2);
    assert.equal(r.stdout, '');
    assert.ok(r.stderr.length > 0);
    assert.equal(r.calls.length, 0);
  }
});

test('exit 3: a failing gh read names the call and prints nothing on stdout', () => {
  const r = go(['--parent', '10'], { throwWhen: (key) => key.startsWith('issue view 12 ') });
  assert.equal(r.code, 3);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /^parent-gate\.js: .*issue view 12/);
});

test('exit 0: --help prints USAGE before any probe', () => {
  const boom = () => { throw new Error('probed'); };
  const r = go(['--help'], {}, { ghAvailable: boom, remoteUrl: boom, repoRoot: boom, readPolicyRaw: boom, readWorkBackend: boom });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, USAGE);
  assert.equal(r.stderr, '');
  assert.equal(go(['-h']).stdout, USAGE);
});
