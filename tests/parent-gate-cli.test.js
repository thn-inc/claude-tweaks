'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run, USAGE } = require('../plugin/bin/parent-gate');
const { VERDICT_FIELDS, CLOSE_HEADING, IDENTITY_PROBE_FAILED_NOTE } = require('../plugin/bin/lib/issues/parent-gate');
const { buildNativeParentQuery, buildNativeSubIssuesQuery } = require('../plugin/bin/lib/issues/record');
const {
  createRecord, closeRecord, readRecord, writeRecord, queryRecords,
} = require('../plugin/bin/lib/issues/local-store');

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
    m = /^issue view (\d+) --repo o\/r --json body -q \.body$/.exec(key);
    if (m) return (world.bodies || {})[m[1]] || '';
    m = /^issue view (\d+) --repo o\/r --json state,stateReason,labels,title,closedByPullRequestsReferences$/.exec(key);
    if (m) {
      const i = (world.issues || {})[m[1]] || {};
      return JSON.stringify({
        state: i.state || 'CLOSED', stateReason: 'stateReason' in i ? i.stateReason : 'COMPLETED', title: `Title ${m[1]}`,
        labels: (i.labels || ['risk:low']).map((name) => ({ name })),
        closedByPullRequestsReferences: (i.closedBy || []).map((number) => ({ number })),
      });
    }
    m = /^issue view (\d+) --repo o\/r --json labels -q \[\.labels\[\]\.name\]$/.exec(key);
    if (m) return JSON.stringify((world.parentLabels || {})[m[1]] || ['parent-issue']);
    m = /^issue view (\d+) --repo o\/r --json state,stateReason,comments$/.exec(key);
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
    readFile: (file) => fs.readFileSync(file, 'utf8'),
    probeRecordsDir: (dir) => { fs.readdirSync(dir); },
    queryRecords,
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

const subViews = (calls) => calls.filter((a) => a[0] === 'issue' && a[1] === 'view' && a.includes('state,stateReason,labels,title,closedByPullRequestsReferences'));
const seen = (calls, want) => calls.filter((a) => a.length === want.length && a.every((x, i) => x === want[i])).length;
const isShape7 = (a) => a[0] === 'issue' && a[5] === '--json' && a[6] === 'state,stateReason,comments';
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

test('every gh issue view read names the origin owner/repo, so one gate never splits its reads across remotes', () => {
  const bodies = { 11: 'Intro\n\nParent: #10\n', 10: '- [ ] #11\n- [x] #12\n' };
  const runs = [go(['--sub-issue', '11', '--idempotence']), go(['--sub-issue', '11', '--work-links', 'body-text', '--idempotence'], { bodies })];
  for (const r of runs) {
    assert.equal(r.code, 0, r.stderr);
    const views = r.calls.filter((a) => a[0] === 'issue' && a[1] === 'view');
    for (const a of views) assert.deepEqual(a.slice(3, 5), ['--repo', 'o/r'], a.join(' '));
  }
  // Shapes 5, 6 and 7 natively; 1, 3, 5, 5, 6 and 7 under body-text.
  assert.deepEqual(runs.map((r) => r.calls.filter((a) => a[0] === 'issue' && a[1] === 'view').length), [4, 6]);
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

test('--closing and --held tokens are trimmed, so a space after a comma is not a malformed call', () => {
  const world = { issues: { 11: OPEN } };
  const spaced = go(['--sub-issue', '12', '--closing', '11, 12', '--held', '11, 12'], world);
  assert.equal(spaced.code, 0, spaced.stderr);
  const tight = go(['--sub-issue', '12', '--closing', '11,12', '--held', '11,12'], world);
  assert.deepEqual(spaced.verdict, tight.verdict);
  assert.equal(spaced.verdict.state, 'due');
  assert.deepEqual(spaced.verdict.held, [11, 12]);
  assert.equal(go(['--sub-issue', '12', '--closing', ' o/r#11 , 12'], world).verdict.state, 'due');
  for (const argv of [['--closing', '11, '], ['--closing', '11,,12'], ['--held', '11, ']]) {
    const r = go(['--sub-issue', '12', ...argv], world);
    assert.equal(r.code, 1, JSON.stringify(argv));
    assert.equal(r.stdout, '', JSON.stringify(argv));
  }
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

test('exit 2: an unreadable policy file fails closed, never the schema default', () => {
  const denied = () => { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }); };
  for (const argv of [['--sub-issue', '11'], ['--sub-issue', '11', '--work-links', 'native'], ['--sub-issue', '11', '--risk-floor', 'high']]) {
    const r = go(argv, {}, { readPolicyRaw: denied });
    assert.equal(r.code, 2, JSON.stringify(argv));
    assert.equal(r.stdout, '', JSON.stringify(argv));
    assert.equal(r.stderr, 'parent-gate.js: cannot read .claude-tweaks/policy.yml: EACCES: permission denied\n');
    assert.equal(r.calls.length, 0);
  }
  // With both keys given as flags the policy is never read.
  const flagged = go(['--parent', '10', '--work-links', 'native', '--risk-floor', 'medium'], {}, { readPolicyRaw: () => { throw new Error('read'); } });
  assert.equal(flagged.code, 0, flagged.stderr);
  assert.equal(flagged.verdict.riskFloor, 'medium');
  // An absent policy file (readPolicyRaw's null) is the schema defaults, as before.
  const absent = go(['--parent', '10'], {}, { readPolicyRaw: () => null });
  assert.equal(absent.code, 0, absent.stderr);
  assert.equal(absent.verdict.riskFloor, 'high');
});

test('exit 2: an invalid configured value for a key the run draws from the policy', () => {
  const r = go(['--parent', '10'], {}, { readPolicyRaw: () => 'work-links: native\nrisk-floor: meduim\n' });
  assert.equal(r.code, 2);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /^parent-gate\.js: \.claude-tweaks\/policy\.yml: invalid risk-floor "meduim" \(must be one of /);
  assert.equal(r.calls.length, 0);
  const links = go(['--parent', '10'], {}, { readPolicyRaw: () => 'work-links: bodytext\nrisk-floor: high\n' });
  assert.equal(links.code, 2);
  assert.equal(links.stdout, '');
  assert.match(links.stderr, /invalid work-links "bodytext"/);
});

test('a flag override skips the policy check for its own key only', () => {
  const badFloor = { readPolicyRaw: () => 'work-links: native\nrisk-floor: meduim\n' };
  const floor = go(['--parent', '10', '--risk-floor', 'high'], {}, badFloor);
  assert.equal(floor.code, 0, floor.stderr);
  assert.equal(floor.verdict.riskFloor, 'high');
  // The flag names the floor, not work-links: an invalid work-links still fails.
  const badLinks = { readPolicyRaw: () => 'work-links: bodytext\nrisk-floor: high\n' };
  assert.equal(go(['--parent', '10', '--risk-floor', 'high'], {}, badLinks).code, 2);
  assert.equal(go(['--parent', '10', '--work-links', 'native'], {}, badLinks).code, 0);
});

test('an Enterprise origin puts the host on every gh read; the verdict is the github.com one', () => {
  const GHE = 'ghe.example.com';
  const bodies = { 11: 'Intro\n\nParent: #10\n', 10: '- [ ] #11\n- [x] #12\n' };
  for (const [argv, world] of [[['--sub-issue', '11', '--idempotence'], {}], [['--sub-issue', '11', '--work-links', 'body-text', '--idempotence'], { bodies }]]) {
    const { gh } = makeGh({ parentOf: { 11: 10, 12: 10 }, subs: { 10: [11, 12] }, ...world });
    const sent = [];
    // Takes the host back off before the github.com fake answers, so a read missing it shows in `sent`.
    const runner = (args) => {
      sent.push(args);
      const n = args.length;
      const plain = args[0] === 'api' && args[n - 2] === '--hostname' && args[n - 1] === GHE
        ? args.slice(0, -2)
        : args.map((a) => (a === `${GHE}/o/r` ? 'o/r' : a));
      return gh(plain);
    };
    const r = go(argv, world, { remoteUrl: () => `git@${GHE}:o/r.git`, runner });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.verdict, go(argv, world).verdict);
    assert.ok(sent.some(isShape8), 'the login read is reached');
    for (const a of sent) {
      if (a[0] === 'api') assert.deepEqual([a.filter((x) => x === '--hostname').length, a.slice(-2)], [1, ['--hostname', GHE]], a.join(' '));
      else assert.deepEqual(a.slice(3, 5), ['--repo', `${GHE}/o/r`], a.join(' '));
    }
  }
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

// --- --facts-json: the gh-absent MCP fact source ---

// Writes `content` (an object, or a raw string) to a temp file that t.after removes -> its path.
function writeFacts(t, content, name = 'facts.json') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parent-gate-facts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, name);
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

const boom = () => { throw new Error('gh was reached'); };
const NO_GH = { ghAvailable: boom, runner: boom };

// One MCP issue_read `get` result, unreshaped: lowercase enums, label objects, snake_case.
const mcpIssue = (n, {
  state = 'CLOSED', stateReason = 'COMPLETED', labels = ['risk:low'], closedBy = [],
} = {}) => ({
  number: n,
  title: `Title ${n}`,
  state: state.toLowerCase(),
  state_reason: stateReason ? stateReason.toLowerCase() : null,
  labels: labels.map((name) => ({ name, id: 1 })),
  closed_by_pull_requests: { references: closedBy.map((number) => ({ number })) },
});

// A fake-gh `world` rendered as the file the agent would write for the record in hand.
// `workLinks: 'body-text'` writes the bodies the world holds instead of the native reads.
function worldAsMcp(world, subIssue, workLinks = 'native') {
  const w = { parentOf: { 11: 10, 12: 10 }, subs: { 10: [11, 12] }, ...world };
  const bodyText = workLinks === 'body-text';
  const bodyOf = (n) => (w.bodies || {})[n] || '';
  let parent = 10;
  if (subIssue) parent = bodyText ? Number((/^Parent: #(\d+)/m.exec(bodyOf(subIssue)) || [])[1]) || null : w.parentOf[subIssue];
  if (!parent) return bodyText ? { subIssueGet: { ...mcpIssue(subIssue), body: bodyOf(subIssue) } } : { parentLink: null };
  const live = (w.parentLive || {})[parent] || { state: 'OPEN', stateReason: '', comments: [] };
  const parentGet = mcpIssue(parent, { state: live.state, stateReason: live.stateReason, labels: (w.parentLabels || {})[parent] || ['parent-issue'] });
  const facts = {
    subIssueGets: Object.fromEntries(w.subs[parent].map((n) => [n, mcpIssue(n, (w.issues || {})[n] || {})])),
    parentComments: live.comments.map((c) => ({
      body: c.body, user: { login: c.author.login }, author_association: c.authorAssociation, html_url: c.url,
    })),
    me: { login: w.login || 'bot' },
  };
  if (bodyText) {
    return {
      ...facts,
      subIssueGet: { ...mcpIssue(subIssue, (w.issues || {})[subIssue] || {}), body: bodyOf(subIssue) },
      parentGet: { ...parentGet, body: bodyOf(parent) },
    };
  }
  return {
    ...facts, parentLink: { number: parent }, parentGet, subIssueList: w.subs[parent].map((number) => ({ number })),
  };
}

test('AC1.1 (facts-json): 35 sub-issues through the MCP shape', (t) => {
  const nums = range(100, 134);
  const facts = {
    parentGet: mcpIssue(10, { state: 'OPEN', stateReason: null, labels: ['parent-issue'] }),
    subIssueList: nums.map((number) => ({ number })),
    subIssueGets: Object.fromEntries(nums.map((n) => [n, mcpIssue(n, n === 130 ? { state: 'OPEN', stateReason: null } : {})])),
  };
  const r = go(['--parent', '10', '--facts-json', writeFacts(t, facts)], {}, NO_GH);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.verdict.state, 'incomplete');
  assert.equal(r.verdict.subIssues.length, 35);
  assert.deepEqual(r.verdict.subIssues[0], {
    number: 100, title: 'Title 100', state: 'CLOSED', stateReason: 'COMPLETED', pr: null,
  });
  const allClosed = { ...facts, subIssueGets: Object.fromEntries(nums.map((n) => [n, mcpIssue(n)])) };
  const closed = go(['--parent', '10', '--facts-json', writeFacts(t, allClosed)], {}, NO_GH);
  assert.equal(closed.verdict.state, 'due');
  assert.equal(closed.verdict.closeReason, 'completed');
});

test('AC1.6: the gh path and the facts-json path give the same verdict', (t) => {
  const planted = { body: `x\n${CLOSE_HEADING}\n`, authorAssociation: 'NONE', author: { login: 'stranger' }, url: 'u-planted' };
  const live = (state, stateReason, comments) => ({ parentLive: { 10: { state, stateReason, comments } } });
  const worlds = [
    [['--parent', '10'], { issues: { 11: { stateReason: 'NOT_PLANNED' }, 12: { stateReason: 'NOT_PLANNED' } } }],
    [['--sub-issue', '11', '--closing', '11'], { issues: { 11: OPEN, 12: { stateReason: 'NOT_PLANNED' } } }],
    [['--sub-issue', '12', '--closing', 'other/r#11,12'], { issues: { 11: OPEN } }],
    [['--sub-issue', '12', '--closing', 'o/r#11,12'], { issues: { 11: OPEN } }],
    [['--parent', '10'], live('OPEN', 'REOPENED', [])],
    [['--parent', '10'], live('CLOSED', 'COMPLETED', [])],
    [['--parent', '10'], live('OPEN', '', [planted])],
    [['--parent', '10'], live('OPEN', '', [{ ...planted, author: { login: 'bot' }, url: 'u-own' }])],
    [['--parent', '10'], { parentLabels: { 10: [] } }],
    [['--parent', '10'], { issues: { 12: { labels: ['risk:high'] } } }],
    [['--sub-issue', '11'], { parentOf: {} }],
    // A closing PR: the last reference is the sub-issue's pr, and --merging-pr overrides it for a closing-set member.
    [['--parent', '10'], { issues: { 11: { closedBy: [40] }, 12: { closedBy: [41, 42] } } }],
    [['--sub-issue', '11', '--closing', '11', '--merging-pr', '50'], { issues: { 11: { ...OPEN, closedBy: [40] } } }],
    // work-links: body-text, with a #0 in the task list that both paths skip.
    [['--sub-issue', '11', '--work-links', 'body-text'], { bodies: { 11: 'Intro\n\nParent: #10\n', 10: '- [ ] #0\n- [x] #11\n- [ ] #12\n' } }],
    [['--sub-issue', '11', '--work-links', 'body-text'], { bodies: { 11: 'no parent line' } }],
  ];
  const seenIdempotence = new Set();
  const seenPr = new Set();
  for (const [argv, world] of worlds) {
    const label = JSON.stringify([argv, world]);
    const viaGh = go([...argv, '--idempotence'], world);
    const subIssue = argv[0] === '--sub-issue' ? Number(argv[1]) : null;
    const workLinks = argv.includes('body-text') ? 'body-text' : 'native';
    const file = writeFacts(t, worldAsMcp(world, subIssue, workLinks));
    const viaFacts = go([...argv, '--idempotence', '--facts-json', file], world, NO_GH);
    assert.equal(viaGh.code, 0, `${label}: ${viaGh.stderr}`);
    assert.equal(viaFacts.code, 0, `${label}: ${viaFacts.stderr}`);
    assert.deepEqual(viaFacts.verdict, viaGh.verdict, label);
    seenIdempotence.add(viaGh.verdict.idempotence);
    for (const s of viaGh.verdict.subIssues) seenPr.add(s.pr);
  }
  // The worlds reach every idempotence value and several pr values, so the equality above is not vacuous.
  assert.deepEqual([...seenIdempotence].map(String).sort(), ['already-closed', 'close-only', 'comment-and-close', 'null', 'reopened']);
  assert.deepEqual([...seenPr].map(String).sort(), ['40', '42', '50', 'null']);
});

test('--facts-json makes no gh call and never probes gh', (t) => {
  const r = go(['--parent', '10', '--facts-json', writeFacts(t, worldAsMcp({}, null))], {}, NO_GH);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.verdict.state, 'due');
  assert.equal(r.calls.length, 0);
});

test('--facts-json reads no remote without a qualified closing token', (t) => {
  const file = writeFacts(t, worldAsMcp({}, 11));
  const unqualified = go(['--sub-issue', '11', '--closing', '11,12', '--facts-json', file], {}, { ...NO_GH, remoteUrl: boom });
  assert.equal(unqualified.code, 0, unqualified.stderr);
  assert.equal(unqualified.verdict.state, 'due');
  const qualified = go(['--sub-issue', '11', '--closing', 'other/r#11,12', '--facts-json', file], {}, { ...NO_GH, remoteUrl: boom });
  assert.equal(qualified.code, 2);
  assert.equal(qualified.stdout, '');
  assert.match(qualified.stderr, /owner\/repo/);
});

test('a parent that reads closed needs no comments or me', (t) => {
  const facts = worldAsMcp({ parentLive: { 10: { state: 'CLOSED', stateReason: 'COMPLETED', comments: [] } } }, null);
  delete facts.parentComments;
  delete facts.me;
  const r = go(['--parent', '10', '--idempotence', '--facts-json', writeFacts(t, facts)], {}, NO_GH);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.verdict.idempotence, 'already-closed');
});

test('an open below-floor parent without comments or me is exit 1 under --idempotence', (t) => {
  const facts = worldAsMcp({}, null);
  delete facts.parentComments;
  const noComments = go(['--parent', '10', '--idempotence', '--facts-json', writeFacts(t, facts)], {}, NO_GH);
  assert.equal(noComments.code, 1);
  assert.equal(noComments.stdout, '');
  assert.match(noComments.stderr, /facts file parentComments: /);
  const noMe = worldAsMcp({}, null);
  delete noMe.me;
  const meless = go(['--parent', '10', '--idempotence', '--facts-json', writeFacts(t, noMe)], {}, NO_GH);
  assert.equal(meless.code, 1);
  assert.equal(meless.stdout, '');
  assert.match(meless.stderr, /facts file me: /);
});

test('--idempotence guards parentComments and requires me only where the verdict reads them', (t) => {
  const errored = { parentComments: { message: 'Not Found' }, me: { message: 'Bad credentials' } };
  const argv = (file) => ['--parent', '10', '--idempotence', '--facts-json', file];
  // An incomplete parent never reaches the idempotence check: the gh verdict, exit 0.
  const incomplete = { ...worldAsMcp({ issues: { 12: OPEN } }, null), ...errored };
  const viaGh = go(['--parent', '10', '--idempotence'], { issues: { 12: OPEN } });
  const r = go(argv(writeFacts(t, incomplete)), {}, NO_GH);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.verdict.state, 'incomplete');
  assert.deepEqual(r.verdict, viaGh.verdict);
  // So do a gated parent, one above the floor, and an already-closed parent.
  const above = go(argv(writeFacts(t, { ...worldAsMcp({ issues: { 12: { labels: ['risk:high'] } } }, null), ...errored })), {}, NO_GH);
  assert.equal(above.code, 0, above.stderr);
  assert.equal(above.verdict.exceeds, true);
  const closedParent = { parentLive: { 10: { state: 'CLOSED', stateReason: 'COMPLETED', comments: [] } } };
  const closed = go(argv(writeFacts(t, { ...worldAsMcp(closedParent, null), ...errored })), {}, NO_GH);
  assert.equal(closed.code, 0, closed.stderr);
  assert.equal(closed.verdict.idempotence, 'already-closed');
  const reopened = { parentLive: { 10: { state: 'OPEN', stateReason: 'REOPENED', comments: [] } } };
  assert.equal(go(argv(writeFacts(t, { ...worldAsMcp(reopened, null), ...errored })), {}, NO_GH).verdict.idempotence, 'reopened');
  // Where the verdict does read them, an error object is exit 3, named.
  const due = go(argv(writeFacts(t, { ...worldAsMcp({}, null), ...errored })), {}, NO_GH);
  assert.equal(due.code, 3);
  assert.equal(due.stdout, '');
  assert.match(due.stderr, /^parent-gate\.js: facts file parentComments: /);
  // A present me without a login is no identity, not a fact error (AC1.3).
  const noLogin = go(argv(writeFacts(t, { ...worldAsMcp({}, null), me: { message: 'Bad credentials' } })), {}, NO_GH);
  assert.equal(noLogin.code, 0, noLogin.stderr);
  assert.equal(noLogin.verdict.idempotence, 'comment-and-close');
});

test('#4770 AC1.3 (gh path): --idempotence with a failing gh login read exits 0 with the degrade note', () => {
  const r = go(['--parent', '10', '--idempotence'], { throwWhen: (k) => k.startsWith('api user') });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.verdict.state, 'due');
  assert.equal(r.verdict.idempotence, 'comment-and-close');
  assert.ok(r.verdict.skipped.includes(IDENTITY_PROBE_FAILED_NOTE), JSON.stringify(r.verdict.skipped));
});

test('#4770 AC1.3 (facts-json me: null): --idempotence with me: null exits 0 with the degrade note', (t) => {
  const facts = { ...worldAsMcp({}, null), me: null };
  const r = go(['--parent', '10', '--idempotence', '--facts-json', writeFacts(t, facts)], {}, NO_GH);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.verdict.idempotence, 'comment-and-close');
  assert.ok(r.verdict.skipped.includes(IDENTITY_PROBE_FAILED_NOTE), JSON.stringify(r.verdict.skipped));
});

test('without --idempotence the facts file needs no comments or me', (t) => {
  const facts = worldAsMcp({}, null);
  delete facts.parentComments;
  delete facts.me;
  const r = go(['--parent', '10', '--facts-json', writeFacts(t, facts)], {}, NO_GH);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.verdict.state, 'due');
  assert.equal(r.verdict.exceeds, false);
  assert.equal(r.verdict.idempotence, null);
  assert.deepEqual(r.verdict.skipped, []);
  // Present but unused without the flag: even an error object there is ignored.
  const junk = { ...worldAsMcp({}, null), parentComments: { message: 'Not Found' }, me: { message: 'x' } };
  const ignored = go(['--parent', '10', '--facts-json', writeFacts(t, junk)], {}, NO_GH);
  assert.equal(ignored.code, 0, ignored.stderr);
  assert.equal(ignored.verdict.idempotence, null);
});

test('an unreadable or non-JSON facts file is exit 1; an error-object entry is exit 3', (t) => {
  const bad = go(['--parent', '10', '--facts-json', path.join(os.tmpdir(), 'parent-gate-no-such-dir', 'nope.json')], {}, NO_GH);
  assert.equal(bad.code, 1);
  assert.equal(bad.stdout, '');
  assert.match(bad.stderr, /^parent-gate\.js: facts file .*nope\.json: unreadable/);

  const notJson = go(['--parent', '10', '--facts-json', writeFacts(t, '{not json')], {}, NO_GH);
  assert.equal(notJson.code, 1);
  assert.equal(notJson.stdout, '');
  assert.match(notJson.stderr, /facts file .*: not valid JSON/);

  for (const top of ['null', '[]', '"text"']) {
    const r = go(['--parent', '10', '--facts-json', writeFacts(t, top)], {}, NO_GH);
    assert.equal(r.code, 1, top);
    assert.equal(r.stdout, '', top);
    assert.match(r.stderr, /JSON object/, top);
  }

  const missing = worldAsMcp({}, null);
  delete missing.parentGet;
  const noKey = go(['--parent', '10', '--facts-json', writeFacts(t, missing)], {}, NO_GH);
  assert.equal(noKey.code, 1);
  assert.equal(noKey.stdout, '');
  assert.match(noKey.stderr, /^parent-gate\.js: facts file parentGet: /);

  const errored = worldAsMcp({}, null);
  errored.subIssueGets[12] = { message: 'Not Found' };
  const err = go(['--parent', '10', '--facts-json', writeFacts(t, errored)], {}, NO_GH);
  assert.equal(err.code, 3);
  assert.equal(err.stdout, '');
  assert.match(err.stderr, /^parent-gate\.js: facts file subIssueGets\.12: /);
});

test('--facts-json with --backend local-files is exit 1', (t) => {
  const file = writeFacts(t, worldAsMcp({}, null));
  const flag = go(['--parent', '10', '--facts-json', file, '--backend', 'local-files'], {}, NO_GH);
  assert.equal(flag.code, 1);
  assert.equal(flag.stdout, '');
  assert.match(flag.stderr, /--facts-json cannot be combined with --backend local-files/);
  const configured = go(['--parent', '10', '--facts-json', file], {}, { ...NO_GH, readWorkBackend: () => 'local-files' });
  assert.equal(configured.code, 1);
  assert.match(configured.stderr, /--facts-json cannot be combined with --backend local-files/);
});

test('--facts-json takes exactly one non-empty value, and USAGE names it', () => {
  for (const argv of [['--sub-issue', '11', '--facts-json'], ['--sub-issue', '11', '--facts-json', '']]) {
    const r = go(argv);
    assert.equal(r.code, 1, JSON.stringify(argv));
    assert.equal(r.stdout, '', JSON.stringify(argv));
    assert.match(r.stderr, /missing value for --facts-json/, JSON.stringify(argv));
  }
  const twice = go(['--sub-issue', '11', '--facts-json', 'a.json', '--facts-json', 'b.json']);
  assert.equal(twice.code, 1);
  assert.match(twice.stderr, /--facts-json given more than once/);
  assert.match(USAGE, /\[--facts-json <file>\]/);
});

// --- --backend local-files: the record store as the fact source ---

// Writes one record with the real writers -> the read-back record. `closed` closes it through
// closeRecord; `notPlanned` then sets the facet through writeRecord on the read-back record.
function addRecord(dir, title, {
  facets = {}, body = '', closed = false, notPlanned = false,
} = {}) {
  const created = createRecord(dir, { slug: 'rec', title, body, facets });
  if (closed) closeRecord(created.path);
  if (notPlanned) {
    const read = readRecord(created.path);
    writeRecord(read.path, { title: read.title, body: read.body, facets: { ...read.facets, notPlanned: true } });
  }
  return readRecord(created.path);
}

// A parent (is-parent-issue) with sub-issues at `risk: 'low'`, in a fresh temp root (records under
// `<root>/<under>`, or the root itself) -> { root, dir, parent, subs }. Each `subs` entry is the
// options addRecord takes (default: two closed ones).
function family(t, { parent = {}, subs = [{ closed: true }, { closed: true }], under = '' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parent-gate-records-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, under);
  const parentRecord = addRecord(dir, 'Parent', { ...parent, facets: { isParentIssue: true, ...parent.facets } });
  const subRecords = subs.map((sub, i) => addRecord(dir, `Sub ${i + 1}`, {
    ...sub, facets: { parent: parentRecord.id, risk: 'low', ...sub.facets },
  }));
  return {
    root, dir, parent: parentRecord, subs: subRecords,
  };
}

// go() over the local-files backend: gh, its probe and the remote all throw if reached.
function goLocal(argv, dir, over = {}) {
  return go([...argv, '--backend', 'local-files', '--records-dir', dir], {}, { ...NO_GH, remoteUrl: boom, ...over });
}

test('local-files: all sub-issues not planned closes not planned', (t) => {
  const { dir, parent } = family(t, { subs: [{ closed: true, notPlanned: true }, { closed: true, notPlanned: true }] });
  const r = goLocal(['--parent', String(parent.id)], dir);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.verdict.state, 'due');
  assert.equal(r.verdict.closeReason, 'not planned');
  assert.deepEqual(r.verdict.subIssues.map((s) => [s.state, s.stateReason]), [['CLOSED', 'NOT_PLANNED'], ['CLOSED', 'NOT_PLANNED']]);
});

test('local-files: due below the floor closes completed', (t) => {
  const { dir, parent } = family(t);
  const r = goLocal(['--parent', String(parent.id), '--idempotence'], dir);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout.trimEnd().split('\n').length, 1);
  assert.deepEqual(Object.keys(r.verdict), VERDICT_FIELDS);
  assert.deepEqual(
    { ...r.verdict, subIssues: undefined },
    {
      parent: parent.id, state: 'due', exceeds: false, closeReason: 'completed', idempotence: 'comment-and-close', maxTier: 'low', riskFloor: 'high', parentIssue: true, needs: [], held: [], subIssues: undefined, skipped: [],
    },
  );
  assert.equal(goLocal(['--parent', String(parent.id)], dir).verdict.idempotence, null);
});

test('local-files: a sub-issue above the floor exceeds; the risk facet is the label', (t) => {
  const { dir, parent } = family(t, { subs: [{ closed: true }, { closed: true, facets: { risk: 'high' } }] });
  const r = goLocal(['--parent', String(parent.id), '--idempotence'], dir);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.verdict.state, 'due');
  assert.equal(r.verdict.maxTier, 'high');
  assert.equal(r.verdict.exceeds, true);
  assert.equal(r.verdict.idempotence, null);
});

test('local-files: the sub-issues are the store entries naming the parent, open and closed, in id order', (t) => {
  const { dir, parent, subs } = family(t, { subs: [{ closed: true }, {}] });
  addRecord(dir, 'Unrelated', { facets: { parent: parent.id + 50 } });
  const r = goLocal(['--parent', String(parent.id), '--held', String(subs[1].id)], dir);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.verdict.state, 'incomplete');
  assert.deepEqual(r.verdict.held, [subs[1].id]);
  assert.deepEqual(r.verdict.subIssues, [
    { number: subs[0].id, title: 'Sub 1', state: 'CLOSED', stateReason: 'COMPLETED', pr: null },
    { number: subs[1].id, title: 'Sub 2', state: 'OPEN', stateReason: '', pr: null },
  ]);
});

test('local-files: closing set counts the sub-issue in hand', (t) => {
  const { dir, parent, subs } = family(t, { subs: [{ closed: true }, {}] });
  const r = goLocal(['--sub-issue', String(subs[1].id)], dir);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.verdict.parent, parent.id);
  assert.equal(r.verdict.state, 'due');
  assert.equal(goLocal(['--parent', String(parent.id)], dir).verdict.state, 'incomplete');
});

test('local-files: an explicit --closing id counts', (t) => {
  const { dir, subs } = family(t, { subs: [{}, { closed: true }] });
  const [a, b] = subs.map((s) => s.id);
  const r = goLocal(['--sub-issue', String(b), '--closing', `${a},${b}`], dir);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.verdict.state, 'due');
  // Without the token, only the sub-issue in hand counts, and a stays open.
  assert.equal(goLocal(['--sub-issue', String(b)], dir).verdict.state, 'incomplete');
});

test('local-files: a body heading means close only; a closed parent is a no-op', (t) => {
  const marked = family(t, { parent: { body: `Overview\n\n${CLOSE_HEADING}\n` } });
  const r = goLocal(['--sub-issue', String(marked.subs[0].id), '--idempotence'], marked.dir);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.verdict.state, 'due');
  assert.equal(r.verdict.idempotence, 'close-only');
  assert.deepEqual(r.verdict.skipped, []);
  const done = family(t, { parent: { closed: true } });
  const noop = goLocal(['--sub-issue', String(done.subs[0].id), '--idempotence'], done.dir);
  assert.equal(noop.code, 0, noop.stderr);
  assert.equal(noop.verdict.idempotence, 'already-closed');
  // Without the flag nothing is read.
  assert.equal(goLocal(['--sub-issue', String(done.subs[0].id)], done.dir).verdict.idempotence, null);
});

test('local-files: --parent', (t) => {
  const closedParent = family(t, { parent: { closed: true } });
  const closed = goLocal(['--parent', String(closedParent.parent.id), '--idempotence'], closedParent.dir);
  assert.equal(closed.code, 0, closed.stderr);
  assert.equal(closed.verdict.state, 'due');
  assert.equal(closed.verdict.idempotence, 'already-closed');

  const openParent = family(t);
  const open = goLocal(['--parent', String(openParent.parent.id), '--idempotence'], openParent.dir);
  assert.equal(open.code, 0, open.stderr);
  assert.equal(open.verdict.state, 'due');
  assert.equal(open.verdict.exceeds, false);
  assert.equal(open.verdict.idempotence, 'comment-and-close');
  assert.equal(open.verdict.parentIssue, true);

  // A record without is-parent-issue still gets a verdict, with parentIssue: false.
  const plain = family(t, { parent: { facets: { isParentIssue: false } } });
  const unmarked = goLocal(['--parent', String(plain.parent.id)], plain.dir);
  assert.equal(unmarked.code, 0, unmarked.stderr);
  assert.equal(unmarked.verdict.parentIssue, false);
  assert.equal(unmarked.verdict.state, 'due');

  const missing = goLocal(['--parent', String(openParent.parent.id + 90)], openParent.dir);
  assert.equal(missing.code, 1);
  assert.equal(missing.stdout, '');
  assert.match(missing.stderr, /^parent-gate\.js: parent #\d+ is not a record in /);
});

test('local-files: the acceptance facet gates', (t) => {
  const pending = family(t, { parent: { facets: { acceptance: 'pending' } } });
  const gated = goLocal(['--parent', String(pending.parent.id)], pending.dir);
  assert.equal(gated.code, 0, gated.stderr);
  assert.equal(gated.verdict.state, 'gated');
  const approved = family(t, { parent: { facets: { acceptance: 'approved' } } });
  assert.equal(goLocal(['--parent', String(approved.parent.id)], approved.dir).verdict.state, 'resolved');
  const changes = family(t, { parent: { facets: { acceptance: 'changes-requested' } } });
  assert.equal(goLocal(['--parent', String(changes.parent.id)], changes.dir).verdict.state, 'resolved');
});

test('local-files: a sub-issue with no parent facet is no-parent', (t) => {
  const { dir } = family(t);
  const loner = addRecord(dir, 'Loner');
  const r = goLocal(['--sub-issue', String(loner.id)], dir);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.verdict.parent, null);
  assert.equal(r.verdict.state, 'no-parent');
});

test('local-files: never calls gh, ghAvailable or remoteUrl', (t) => {
  const { dir, parent, subs } = family(t);
  const dead = { ghAvailable: boom, remoteUrl: boom, runner: boom };
  for (const argv of [['--parent', String(parent.id), '--idempotence'], ['--sub-issue', String(subs[0].id)]]) {
    const r = go([...argv, '--backend', 'local-files', '--records-dir', dir], {}, dead);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.calls.length, 0);
  }
});

test('local-files: a qualified closing token or an unknown id is exit 1', (t) => {
  const { dir, parent, subs } = family(t);
  const qualified = goLocal(['--sub-issue', String(subs[0].id), '--closing', `o/r#${subs[0].id}`], dir);
  assert.equal(qualified.code, 1);
  assert.equal(qualified.stdout, '');
  assert.match(qualified.stderr, /names a repository.*--backend local-files takes plain ids/);

  const unknown = goLocal(['--sub-issue', String(parent.id + 90)], dir);
  assert.equal(unknown.code, 1);
  assert.equal(unknown.stdout, '');
  assert.match(unknown.stderr, /^parent-gate\.js: sub-issue #\d+ is not a record in /);

  const orphan = addRecord(dir, 'Orphan', { facets: { parent: parent.id + 90 } });
  const dangling = goLocal(['--sub-issue', String(orphan.id)], dir);
  assert.equal(dangling.code, 1);
  assert.equal(dangling.stdout, '');
  assert.match(dangling.stderr, /^parent-gate\.js: parent #\d+ is not a record in /);

  // A records dir that does not exist holds no record.
  const absent = goLocal(['--sub-issue', '1'], path.join(dir, 'no-such-dir'));
  assert.equal(absent.code, 1);
  assert.match(absent.stderr, /sub-issue #1 is not a record in /);
});

test('local-files: a failing store read is exit 3 with nothing on stdout', (t) => {
  const { dir, parent } = family(t);
  const r = goLocal(['--parent', String(parent.id)], dir, { queryRecords: () => { throw new Error('EACCES: permission denied'); } });
  assert.equal(r.code, 3);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /^parent-gate\.js: could not read the records in .*EACCES/);
});

test('local-files: an unreadable records dir is exit 3, not an empty store', (t) => {
  const { dir, parent } = family(t);
  const denied = goLocal(['--parent', String(parent.id)], dir, {
    probeRecordsDir: () => { throw Object.assign(new Error('EACCES: permission denied, scandir'), { code: 'EACCES' }); },
  });
  assert.equal(denied.code, 3);
  assert.equal(denied.stdout, '');
  assert.match(denied.stderr, /^parent-gate\.js: could not read the records in .*EACCES/);
  // A records dir that is a file is unreadable too (ENOTDIR through the real probe).
  const notDir = goLocal(['--parent', String(parent.id)], parent.path);
  assert.equal(notDir.code, 3);
  assert.match(notDir.stderr, /^parent-gate\.js: could not read the records in .*ENOTDIR/);
});

test('local-files: a record both scans return is one sub-issue, in its closed state', (t) => {
  const { dir, parent, subs } = family(t);
  // A sibling closed between the open scan and the closed scan: the open scan still saw it open.
  const racing = (d, filter) => {
    const found = queryRecords(d, filter);
    return filter.closed ? found : [...found, { ...subs[0], facets: { ...subs[0].facets, closed: false } }];
  };
  const r = goLocal(['--parent', String(parent.id)], dir, { queryRecords: racing });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.verdict.subIssues.map((s) => [s.number, s.state]), [[subs[0].id, 'CLOSED'], [subs[1].id, 'CLOSED']]);
  assert.equal(r.verdict.state, 'due');
});

test('local-files: the records dir defaults to specs under the repo root; --records-dir resolves against it', (t) => {
  const { root, parent } = family(t, { under: 'specs' });
  const deps = { ...NO_GH, remoteUrl: boom, repoRoot: () => root };
  // The sub-issue titles tell the temp store from a `specs/` of the cwd, whose low ids may collide.
  const titles = (r) => (r.verdict ? r.verdict.subIssues.map((s) => s.title) : r.stderr);
  const byDefault = go(['--parent', String(parent.id), '--backend', 'local-files'], {}, deps);
  assert.equal(byDefault.code, 0, byDefault.stderr);
  assert.deepEqual(titles(byDefault), ['Sub 1', 'Sub 2']);
  const relative = go(['--parent', String(parent.id), '--backend', 'local-files', '--records-dir', 'specs'], {}, deps);
  assert.equal(relative.code, 0, relative.stderr);
  assert.deepEqual(titles(relative), ['Sub 1', 'Sub 2']);
  const elsewhere = go(['--parent', String(parent.id), '--backend', 'local-files', '--records-dir', 'other'], {}, deps);
  assert.equal(elsewhere.code, 1);
  assert.match(elsewhere.stderr, /parent #\d+ is not a record in /);
});

test('the configured work-backend selects local-files; a null one reads as github-issues', (t) => {
  const { dir, parent } = family(t);
  const configured = go(['--parent', String(parent.id), '--records-dir', dir], {}, { ...NO_GH, remoteUrl: boom, readWorkBackend: () => 'local-files' });
  assert.equal(configured.code, 0, configured.stderr);
  assert.equal(configured.verdict.parent, parent.id);
  assert.equal(go(['--sub-issue', '11'], {}, { readWorkBackend: () => null }).code, 0);
});

test('--records-dir without local-files is exit 1; USAGE names both new flags', (t) => {
  const { dir } = family(t);
  const r = go(['--parent', '10', '--records-dir', dir]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /--records-dir only applies to --backend local-files/);
  assert.equal(r.calls.length, 0);
  assert.match(go(['--parent', '10', '--records-dir']).stderr, /missing value for --records-dir/);
  assert.match(USAGE, /\[--backend github-issues\|local-files\] \[--records-dir <dir>\]/);
});

test('local-files never draws work-links, so an invalid one there is no failure', (t) => {
  const { dir, parent } = family(t);
  const r = goLocal(['--parent', String(parent.id)], dir, { readPolicyRaw: () => 'work-links: bodytext\nrisk-floor: medium\n' });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.verdict.riskFloor, 'medium');
  const badFloor = goLocal(['--parent', String(parent.id)], dir, { readPolicyRaw: () => 'risk-floor: meduim\n' });
  assert.equal(badFloor.code, 2);
  assert.equal(badFloor.stdout, '');
  assert.match(badFloor.stderr, /invalid risk-floor "meduim"/);
});
