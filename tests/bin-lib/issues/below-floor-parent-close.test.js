'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { readText } = require('../../helpers/read-skill');
const {
  CLOSE_HEADING, composeCloseComment, closeBelowFloorParents, isCloseMarkerComment,
} = require('../../../plugin/bin/lib/issues/below-floor-parent-close');

const GATE_PROSE = path.join(__dirname, '..', '..', '..', 'plugin', 'skills', 'wrap-up', 'verification-brief-parent-gate.md');

// The template step 2 of the prose renders: the first fenced markdown block
// after "Compose the closing comment" — heading line, blank line, first paragraph.
function proseTemplate() {
  const text = readText(GATE_PROSE);
  const after = text.slice(text.indexOf('**2. Compose the closing comment:**'));
  const block = /```markdown\n([\s\S]*?)\n```/.exec(after)[1];
  const [heading, intro, listing] = block.split('\n\n');
  return { heading, intro, listing };
}

// The listing line for a sub-issue left with no PR: "is listed as `- #{n} {title}`".
function proseBareListingLine() {
  const text = readText(GATE_PROSE);
  return /is listed as `(- #\{n\} \{title\})`/.exec(text)[1];
}

function proseNotPlannedLine() {
  const text = readText(GATE_PROSE);
  return /`(No sub-issue closed as completed[^`]*)`/.exec(text)[1];
}

test('composeCloseComment equals the prose template, substituted (prose-code twin)', () => {
  const { heading, intro } = proseTemplate();
  assert.equal(heading, CLOSE_HEADING);
  const expectedIntro = intro.replace('{maxTier}', 'low').replace('{riskFloor}', 'high');
  const out = composeCloseComment({ maxTier: 'low', riskFloor: 'high', notPlanned: false, lines: ['- #11 Alpha — closed by PR #7', '- #12 Beta'] });
  assert.equal(out, `${heading}\n\n${expectedIntro}\n\n- #11 Alpha — closed by PR #7\n- #12 Beta\n`);
});

test('the listing-line template in the prose is what the module writes (prose-code twin)', () => {
  const { listing } = proseTemplate();
  // `- #{n} {title} — closed by PR #{pr}`: the module renders this line for a sub-issue with a PR.
  const render = (n, title, pr) => listing.replace('{n}', n).replace('{title}', title).replace('{pr}', pr);
  const { gh, calls } = makeGh(happyWorld());
  closeBelowFloorParents(base({ gh }));
  const lines = writes(calls)[0].input.split('\n').filter((l) => l.startsWith('- #'));
  assert.deepEqual(lines, [render(11, 'Eleven', 77), render(12, 'Twelve', 9)]);
});

test('the bare listing line in the prose is what the module writes for a sub-issue with no PR (prose-code twin)', () => {
  const bare = proseBareListingLine();
  const world = happyWorld();
  world.issues[12].refs = [];
  const { gh, calls } = makeGh(world);
  closeBelowFloorParents(base({ mergingPr: null, gh }));
  const lines = writes(calls)[0].input.split('\n').filter((l) => l.startsWith('- #'));
  assert.equal(lines[1], bare.replace('{n}', 12).replace('{title}', 'Twelve'));
});

test('the risk-floor values the module accepts are the policy schema risk-floor enum', () => {
  const { POLICY_KEYS } = require('../../../plugin/bin/lib/policy-schema');
  const values = POLICY_KEYS.find((k) => k.key === 'risk-floor').values;
  for (const riskFloor of values) {
    const { gh } = makeGh(happyWorld());
    const out = closeBelowFloorParents(base({ riskFloor, gh }));
    assert.ok(!out.skipped.some((s) => s.reason === 'invalid-risk-floor'), riskFloor);
  }
});

test('composeCloseComment with no listing lines is well-formed (no stray blank lines)', () => {
  const { heading, intro } = proseTemplate();
  const expectedIntro = intro.replace('{maxTier}', 'low').replace('{riskFloor}', 'high');
  assert.equal(composeCloseComment({ maxTier: 'low', riskFloor: 'high', notPlanned: false, lines: [] }), `${heading}\n\n${expectedIntro}\n`);
  assert.equal(composeCloseComment({ maxTier: 'low', riskFloor: 'high', notPlanned: true }), `${heading}\n\n${expectedIntro}\n\n${proseNotPlannedLine()}\n`);
});

test('composeCloseComment adds the not-planned line after the first paragraph', () => {
  const { heading, intro } = proseTemplate();
  const expectedIntro = intro.replace('{maxTier}', 'medium').replace('{riskFloor}', 'high');
  const out = composeCloseComment({ maxTier: 'medium', riskFloor: 'high', notPlanned: true, lines: ['- #1 One'] });
  assert.equal(out, `${heading}\n\n${expectedIntro}\n\n${proseNotPlannedLine()}\n\n- #1 One\n`);
});

// A fake gh answering by exact argv shape; anything else throws (a default-branch read
// included: after a PR merge Step 4.0b has no default-branch check, #4549). `world`:
//   parentOf {sub: parent}, subs {parent: [n]} (native list) or
//   bodies {n: text} (body-text), issues {n: {state, stateReason, labels, title, refs}},
//   parentLabels {parent: [names]}, parentLive {parent: {state, stateReason, comments}},
//   login, throwWhen(key) -> boolean.
function makeGh(world) {
  const calls = [];
  const gh = (args, input) => {
    calls.push({ args, input });
    const key = args.join(' ');
    if (world.throwWhen && world.throwWhen(key)) throw new Error(`boom: ${key}`);
    if (args[0] === 'api' && args[1] === 'graphql') {
      if (args[3].startsWith('query={ __type')) return JSON.stringify({ data: { __type: { fields: [{ name: 'subIssues' }] } } });
      if (args[3].includes('subIssues(first:100)')) {
        const p = Number(/i(\d+):/.exec(args[3])[1]);
        return JSON.stringify({ data: { repository: { [`i${p}`]: { number: p, subIssues: { nodes: (world.subs[p] || []).map((number) => ({ number })), pageInfo: { hasNextPage: false } } } } } });
      }
      const n = Number(/i(\d+):/.exec(args[3])[1]);
      const parent = (world.parentOf || {})[n];
      return JSON.stringify({ data: { repository: { [`i${n}`]: { number: n, parent: parent ? { number: parent } : null } } } });
    }
    let m = /^api --paginate repos\/o\/r\/issues\/(\d+)\/sub_issues --jq \.\[\]\.number$/.exec(key);
    if (m) return (world.subs[m[1]] || []).join('\n') + '\n';
    m = /^issue view (\d+) --repo o\/r --json body -q \.body$/.exec(key);
    if (m) return (world.bodies || {})[m[1]] || '';
    m = /^issue view (\d+) --repo o\/r --json state,stateReason,labels,title,closedByPullRequestsReferences$/.exec(key);
    if (m) {
      const i = world.issues[m[1]];
      return JSON.stringify({
        state: i.state, stateReason: i.stateReason || '', title: 'title' in i ? i.title : `Title ${m[1]}`,
        labels: (i.labels || ['risk:low']).map((name) => ({ name })),
        closedByPullRequestsReferences: (i.refs || []).map((number) => ({ number })),
      });
    }
    m = /^issue view (\d+) --repo o\/r --json labels -q \[\.labels\[\]\.name\]$/.exec(key);
    if (m) return JSON.stringify((world.parentLabels || {})[m[1]] || ['parent-issue']);
    m = /^issue view (\d+) --repo o\/r --json state,stateReason,comments$/.exec(key);
    if (m) return JSON.stringify((world.parentLive || {})[m[1]] || { state: 'OPEN', stateReason: '', comments: [] });
    if (key === 'api user --jq .login') return `${world.login || 'plugin-bot'}\n`;
    if (/^issue comment \d+ --repo o\/r --body-file -$/.test(key)) return '';
    if (/^issue close \d+ --repo o\/r --reason /.test(key)) return '';
    throw new Error(`unexpected gh call: ${key}`);
  };
  return { gh, calls };
}

const base = (over) => ({
  closingSet: [11], unsettled: [], mergingPr: 77, owner: 'o', repo: 'r', workLinks: 'native', riskFloor: 'high', ...over,
});

const happyWorld = (over = {}) => ({
  parentOf: { 11: 10, 12: 10 },
  subs: { 10: [11, 12] },
  issues: {
    11: { state: 'OPEN', title: 'Eleven' },
    12: { state: 'CLOSED', stateReason: 'COMPLETED', title: 'Twelve', refs: [5, 9] },
  },
  ...over,
});

const writes = (calls) => calls.filter((c) => c.args[0] === 'issue' && (c.args[1] === 'comment' || c.args[1] === 'close'));

test('#4549: after a PR merge there is no default-branch check — a non-default base\'s closingSet closes its parent, and no call reads the default branch', () => {
  // A PR merged into `develop`: Step 4.0 closed #11 itself and lists it in closingSet. The
  // caller passes no integration branch, and the fake answers no `repo view` call.
  const { gh, calls } = makeGh(happyWorld({ issues: { 11: { state: 'CLOSED', stateReason: 'COMPLETED', title: 'Eleven' }, 12: { state: 'CLOSED', stateReason: 'COMPLETED', title: 'Twelve' } } }));
  const out = closeBelowFloorParents(base({ gh, selfInclude: false }));
  assert.deepEqual(out, { closed: [{ parent: 10, maxTier: 'low' }], skipped: [] });
  assert.ok(!calls.some((c) => c.args[0] === 'repo'), `no default-branch read: ${calls.map((c) => c.args.join(' ')).join(' | ')}`);
});

test('happy path, native: comments through stdin, then closes the parent completed', () => {
  const { gh, calls } = makeGh(happyWorld());
  const out = closeBelowFloorParents(base({ gh }));
  assert.deepEqual(out, { closed: [{ parent: 10, maxTier: 'low' }], skipped: [] });
  const w = writes(calls);
  assert.deepEqual(w.map((c) => c.args.join(' ')), ['issue comment 10 --repo o/r --body-file -', 'issue close 10 --repo o/r --reason completed']);
  assert.ok(w[0].input.startsWith(CLOSE_HEADING));
  const listing = w[0].input.split('\n').filter((l) => l.startsWith('- #'));
  assert.deepEqual(listing, ['- #11 Eleven — closed by PR #77', '- #12 Twelve — closed by PR #9']);
  assert.ok(!w[0].input.includes('closes as not planned'));
});

// A GitHub Enterprise world: every argv is recorded as sent, then answered by makeGh with the
// host-qualified `--repo` and the `--hostname` pair taken back out.
const TASK_LIST_BODIES = { 11: 'Intro\n\nParent: #10\n', 10: '## Tasks\n- [ ] #11 Eleven\n- [x] #12 Twelve\n' };
function makeHostGh(world, host) {
  const inner = makeGh(world);
  const sent = [];
  const gh = (args, input) => {
    sent.push(args);
    const plain = [];
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === '--hostname' && args[i + 1] === host) { i += 1; continue; }
      plain.push(args[i]);
      if (args[i] === '--repo') { plain.push(args[i + 1].replace(`${host}/`, '')); i += 1; }
    }
    return inner.gh(plain, input);
  };
  return { gh, sent };
}

test('a GitHub Enterprise host: both writes carry the host-qualified --repo and every gh api read carries --hostname', () => {
  const host = 'ghe.example.com';
  for (const workLinks of ['native', 'body-text']) {
    const world = happyWorld({ bodies: TASK_LIST_BODIES });
    const { gh, sent } = makeHostGh(world, host);
    const out = closeBelowFloorParents(base({ gh, host, workLinks }));
    assert.deepEqual(out, { closed: [{ parent: 10, maxTier: 'low' }], skipped: [] }, workLinks);
    const lines = sent.map((a) => a.join(' '));
    assert.deepEqual(lines.filter((l) => /^issue (comment|close) /.test(l)), [
      `issue comment 10 --repo ${host}/o/r --body-file -`, `issue close 10 --repo ${host}/o/r --reason completed`,
    ], workLinks);
    const issueCalls = sent.filter((a) => a[0] === 'issue');
    assert.ok(issueCalls.length > 2, workLinks);
    for (const a of issueCalls) assert.equal(a[a.indexOf('--repo') + 1], `${host}/o/r`, a.join(' '));
    const apiCalls = sent.filter((a) => a[0] === 'api');
    if (workLinks === 'native') assert.ok(apiCalls.length > 0, 'the native world reads through gh api');
    for (const a of apiCalls) assert.equal(a[a.indexOf('--hostname') + 1], host, a.join(' '));
    assert.ok(lines.includes(`api user --jq .login --hostname ${host}`), workLinks);
  }
});

test('host github.com, or no host, leaves every gh argv byte-identical', () => {
  for (const workLinks of ['native', 'body-text']) {
    const world = () => happyWorld({ bodies: TASK_LIST_BODIES });
    const bare = makeGh(world());
    closeBelowFloorParents(base({ gh: bare.gh, workLinks }));
    const dotCom = makeGh(world());
    closeBelowFloorParents(base({ gh: dotCom.gh, workLinks, host: 'github.com' }));
    assert.deepEqual(dotCom.calls.map((c) => c.args), bare.calls.map((c) => c.args), workLinks);
    assert.ok(bare.calls.every((c) => !c.args.includes('--hostname') && !c.args.includes('github.com/o/r')), workLinks);
    assert.equal(writes(bare.calls).length, 2, workLinks);
  }
});

test('a closing-set member with no merging PR falls back to its closing PR reference, else no suffix', () => {
  const world = happyWorld();
  world.issues[11].refs = [3];
  world.issues[12].refs = [];
  const { gh, calls } = makeGh(world);
  closeBelowFloorParents(base({ mergingPr: null, gh }));
  const listing = writes(calls)[0].input.split('\n').filter((l) => l.startsWith('- #'));
  assert.deepEqual(listing, ['- #11 Eleven — closed by PR #3', '- #12 Twelve']);
});

test('body-text: the parent comes from the sub-issue body, the sub-issues from the parent task list', () => {
  const world = happyWorld({
    bodies: { 11: 'Intro\n\nParent: #10\n', 10: '## Tasks\n- [ ] #11 Eleven\n- [x] #12 Twelve\n' },
  });
  const { gh, calls } = makeGh(world);
  const out = closeBelowFloorParents(base({ workLinks: 'body-text', gh }));
  assert.deepEqual(out.closed, [{ parent: 10, maxTier: 'low' }]);
  assert.ok(calls.every((c) => !(c.args[0] === 'api' && c.args[1] === 'graphql')));
  assert.ok(calls.some((c) => c.args.join(' ') === 'issue view 11 --repo o/r --json body -q .body'));
});

test('body-text: a sub-issue body with no Parent line has no resolvable parent (silent no-op)', () => {
  const { gh, calls } = makeGh(happyWorld({ bodies: { 11: 'No parent here' } }));
  const out = closeBelowFloorParents(base({ workLinks: 'body-text', gh }));
  assert.deepEqual(out, { closed: [], skipped: [] });
  assert.equal(writes(calls).length, 0);
});

test('native: no resolvable parent is a silent no-op', () => {
  const { gh, calls } = makeGh(happyWorld({ parentOf: {} }));
  const out = closeBelowFloorParents(base({ gh }));
  assert.deepEqual(out, { closed: [], skipped: [] });
  assert.equal(writes(calls).length, 0);
});

test('idempotence: an already-closed parent gets no comment and no close', () => {
  const { gh, calls } = makeGh(happyWorld({ parentLive: { 10: { state: 'CLOSED', stateReason: 'COMPLETED', comments: [] } } }));
  const out = closeBelowFloorParents(base({ gh }));
  assert.deepEqual(out, { closed: [], skipped: [{ parent: 10, reason: 'already-closed' }] });
  assert.equal(writes(calls).length, 0);
});

test('idempotence: a trusted comment carrying the heading means close only', () => {
  const comments = [{ body: `${CLOSE_HEADING}\n\nEvery sub-issue...`, authorAssociation: 'MEMBER', author: { login: 'someone' } }];
  const { gh, calls } = makeGh(happyWorld({ parentLive: { 10: { state: 'OPEN', stateReason: '', comments } } }));
  const out = closeBelowFloorParents(base({ gh }));
  assert.deepEqual(out.closed, [{ parent: 10, maxTier: 'low' }]);
  assert.deepEqual(writes(calls).map((c) => c.args.join(' ')), ['issue close 10 --repo o/r --reason completed']);
});

test('idempotence: a comment from the current gh identity counts even with an untrusted association', () => {
  const comments = [{ body: `${CLOSE_HEADING}\n\nx`, authorAssociation: 'NONE', author: { login: 'plugin-bot' } }];
  const { gh, calls } = makeGh(happyWorld({ login: 'plugin-bot', parentLive: { 10: { state: 'OPEN', stateReason: '', comments } } }));
  closeBelowFloorParents(base({ gh }));
  assert.deepEqual(writes(calls).map((c) => c.args.join(' ')), ['issue close 10 --repo o/r --reason completed']);
});

test('idempotence: a CONTRIBUTOR comment carrying the heading reads as absent, and is named in notes', () => {
  const comments = [{ body: `${CLOSE_HEADING}\n\nplanted`, authorAssociation: 'CONTRIBUTOR', author: { login: 'stranger' }, url: 'https://example.test/c/1' }];
  const { gh, calls } = makeGh(happyWorld({ parentLive: { 10: { state: 'OPEN', stateReason: '', comments } } }));
  const out = closeBelowFloorParents(base({ gh }));
  assert.deepEqual(writes(calls).map((c) => c.args.join(' ')), ['issue comment 10 --repo o/r --body-file -', 'issue close 10 --repo o/r --reason completed']);
  assert.equal(out.closed.length, 1);
  assert.equal(out.closed[0].notes.length, 1);
  assert.match(out.closed[0].notes[0], /stranger \(CONTRIBUTOR\)/);
});

test('a reopened parent is never re-closed', () => {
  const { gh, calls } = makeGh(happyWorld({ parentLive: { 10: { state: 'OPEN', stateReason: 'REOPENED', comments: [] } } }));
  const out = closeBelowFloorParents(base({ gh }));
  assert.deepEqual(out, { closed: [], skipped: [{ parent: 10, reason: 'reopened-by-human' }] });
  assert.equal(writes(calls).length, 0);
});

test('a sibling with no risk label is unscored: above-floor, no write', () => {
  const world = happyWorld();
  world.issues[12].labels = ['bug'];
  const { gh, calls } = makeGh(world);
  const out = closeBelowFloorParents(base({ gh }));
  assert.deepEqual(out, { closed: [], skipped: [{ parent: 10, reason: 'above-floor' }] });
  assert.equal(writes(calls).length, 0);
});

test('max tier at or above the risk floor is above-floor', () => {
  const world = happyWorld();
  world.issues[12].labels = ['risk:high'];
  const { gh, calls } = makeGh(world);
  const out = closeBelowFloorParents(base({ gh }));
  assert.deepEqual(out.skipped, [{ parent: 10, reason: 'above-floor' }]);
  assert.equal(writes(calls).length, 0);
});

test('a parent without the parent-issue label is skipped, a needs:* label is skipped', () => {
  let world = happyWorld({ parentLabels: { 10: ['enhancement'] } });
  let { gh, calls } = makeGh(world);
  assert.deepEqual(closeBelowFloorParents(base({ gh })).skipped, [{ parent: 10, reason: 'not-parent-issue-labeled' }]);
  assert.equal(writes(calls).length, 0);

  world = happyWorld({ parentLabels: { 10: ['parent-issue', 'needs:decision'] } });
  ({ gh, calls } = makeGh(world));
  assert.deepEqual(closeBelowFloorParents(base({ gh })).skipped, [{ parent: 10, reason: 'needs-label' }]);
  assert.equal(writes(calls).length, 0);
});

// #4799: a parent the gate skips before enumeration costs no per-sibling read, and a parent
// skipped on its labels costs no enumeration either.
const SIBLING_VIEW = /^issue view \d+ --repo o\/r --json state,stateReason,labels,title,closedByPullRequestsReferences$/;
function assertNoSiblingReads(calls) {
  const argv = calls.map((c) => c.args.join(' '));
  assert.ok(!argv.some((a) => SIBLING_VIEW.test(a)), `no per-sibling read: ${argv.join(' | ')}`);
}
function assertNoEnumeration(calls) {
  const argv = calls.map((c) => c.args.join(' '));
  assert.ok(!calls.some((c) => c.args[0] === 'api' && c.args[1] === 'graphql' && (String(c.args[3]).startsWith('query={ __type') || String(c.args[3]).includes('subIssues(first:100)'))), `no GraphQL enumeration: ${argv.join(' | ')}`);
  assert.ok(!argv.some((a) => a.includes('sub_issues')), `no REST enumeration: ${argv.join(' | ')}`);
}

test('#4799: a parent without the parent-issue label is gated before any sub-issue is enumerated or read', () => {
  const { gh, calls } = makeGh(happyWorld({ parentLabels: { 10: ['enhancement'] } }));
  const out = closeBelowFloorParents(base({ gh }));
  assert.deepEqual(out, { closed: [], skipped: [{ parent: 10, reason: 'not-parent-issue-labeled' }] });
  assert.equal(calls.length, 2, calls.map((c) => c.args.join(' ')).join(' | '));
  assertNoSiblingReads(calls);
  assertNoEnumeration(calls);
});

test('#4799: a parent carrying needs:* is gated before any sub-issue is enumerated or read', () => {
  const { gh, calls } = makeGh(happyWorld({ parentLabels: { 10: ['parent-issue', 'needs:decision'] } }));
  const out = closeBelowFloorParents(base({ gh }));
  assert.deepEqual(out, { closed: [], skipped: [{ parent: 10, reason: 'needs-label' }] });
  assertNoSiblingReads(calls);
  assertNoEnumeration(calls);
});

test('#4799: a sibling in unsettled is gated before any sub-issue is read (the numbers are enumerated first)', () => {
  const { gh, calls } = makeGh(happyWorld());
  const out = closeBelowFloorParents(base({ unsettled: [12], gh }));
  assert.deepEqual(out, { closed: [], skipped: [{ parent: 10, reason: 'sibling-unsettled' }] });
  assert.ok(calls.some((c) => c.args[0] === 'api' && c.args[1] === 'graphql' && String(c.args[3]).includes('subIssues(first:100)')), 'the sub-issue list was enumerated before the screen ran');
  assertNoSiblingReads(calls);
});

test('a sibling still open and outside the closing set is incomplete', () => {
  const world = happyWorld();
  world.issues[12] = { state: 'OPEN', title: 'Twelve' };
  const { gh, calls } = makeGh(world);
  const out = closeBelowFloorParents(base({ gh }));
  assert.deepEqual(out, { closed: [], skipped: [{ parent: 10, reason: 'incomplete' }] });
  assert.equal(writes(calls).length, 0);
});

test('a sibling in unsettled skips the parent even when its live state reads closed', () => {
  const { gh, calls } = makeGh(happyWorld());
  const out = closeBelowFloorParents(base({ unsettled: [12], gh }));
  assert.deepEqual(out, { closed: [], skipped: [{ parent: 10, reason: 'sibling-unsettled' }] });
  assert.equal(writes(calls).length, 0);
});

test('a parent that already carries an acceptance disposition is gated, not closed', () => {
  const { gh } = makeGh(happyWorld({ parentLabels: { 10: ['parent-issue', 'accept:pending'] } }));
  const out = closeBelowFloorParents(base({ gh }));
  assert.deepEqual(out.skipped, [{ parent: 10, reason: 'gated' }]);
});

test('two closing records sharing a parent evaluate that parent once', () => {
  const world = happyWorld({ parentOf: { 11: 10, 12: 10 } });
  world.issues[12] = { state: 'OPEN', title: 'Twelve' };
  const { gh, calls } = makeGh(world);
  const out = closeBelowFloorParents(base({ closingSet: [12, 11], gh }));
  assert.deepEqual(out.closed, [{ parent: 10, maxTier: 'low' }]);
  assert.equal(calls.filter((c) => c.args.join(' ') === 'issue close 10 --repo o/r --reason completed').length, 1);
  assert.equal(calls.filter((c) => c.args.join(' ') === 'issue comment 10 --repo o/r --body-file -').length, 1);
  assert.equal(calls.filter((c) => c.args[0] === 'api' && c.args[1] === 'graphql' && c.args[3].includes('parent{')).length, 2);
});

test('a failing gh call skips that parent as gh-failed and the next closing record still runs', () => {
  const world = {
    parentOf: { 11: 10, 21: 20 },
    subs: { 10: [11], 20: [21] },
    issues: { 11: { state: 'OPEN' }, 21: { state: 'OPEN' } },
    throwWhen: (k) => k.startsWith('issue view 11 --repo'),
  };
  const { gh } = makeGh(world);
  const out = closeBelowFloorParents(base({ closingSet: [11, 21], gh }));
  assert.deepEqual(out.closed, [{ parent: 20, maxTier: 'low' }]);
  assert.equal(out.skipped.length, 1);
  assert.equal(out.skipped[0].parent, 10);
  assert.equal(out.skipped[0].reason, 'gh-failed');
});

test('a failing close after a posted comment is reported gh-failed (the rerun closes without a second comment)', () => {
  const { gh, calls } = makeGh(happyWorld({ throwWhen: (k) => k.startsWith('issue close') }));
  const out = closeBelowFloorParents(base({ gh }));
  assert.deepEqual(out.closed, []);
  assert.equal(out.skipped[0].reason, 'gh-failed');
  assert.equal(calls.filter((c) => c.args[1] === 'comment').length, 1);
});

test('a gh read that returns non-JSON fails closed as gh-failed, never internal-error', () => {
  const { gh, calls } = makeGh(happyWorld());
  const garbled = (args, input) => (args.join(' ').startsWith('issue view 11 --repo') ? '<html>502 Bad Gateway</html>' : gh(args, input));
  const out = closeBelowFloorParents(base({ gh: garbled }));
  assert.deepEqual(out.closed, []);
  assert.equal(out.skipped.length, 1);
  assert.equal(out.skipped[0].reason, 'gh-failed');
  assert.match(out.skipped[0].detail, /unparseable output/);
  assert.equal(calls.filter((c) => c.args[0] === 'issue' && (c.args[1] === 'comment' || c.args[1] === 'close')).length, 0, 'nothing is written on a read it could not parse');
});

test('a failing parent resolution is named by the closing record', () => {
  const { gh } = makeGh(happyWorld({ throwWhen: (k) => k.startsWith('api graphql') }));
  const out = closeBelowFloorParents(base({ gh }));
  assert.equal(out.skipped.length, 1);
  assert.equal(out.skipped[0].issue, 11);
  assert.equal(out.skipped[0].reason, 'gh-failed');
});

test('a missing gh runner never throws', () => {
  const out = closeBelowFloorParents(base({ gh: undefined }));
  assert.deepEqual(out.closed, []);
  assert.equal(out.skipped[0].reason, 'gh-failed');
});

test('a closing-set member counts COMPLETED, so it forces --reason completed over a NOT_PLANNED sibling', () => {
  const world = happyWorld();
  world.issues[12] = { state: 'CLOSED', stateReason: 'NOT_PLANNED', title: 'Twelve' };
  const { gh, calls } = makeGh(world);
  closeBelowFloorParents(base({ gh }));
  assert.deepEqual(writes(calls).map((c) => c.args.join(' ')), ['issue comment 10 --repo o/r --body-file -', 'issue close 10 --repo o/r --reason completed']);
});

test('selfInclude: false judges a closing-set member a human reopened by its live state: the gate keeps the parent open', () => {
  const world = happyWorld();
  world.issues[11] = { state: 'OPEN', stateReason: 'REOPENED', title: 'Eleven' };
  const { gh, calls } = makeGh(world);
  const out = closeBelowFloorParents(base({ selfInclude: false, gh }));
  assert.deepEqual(out, { closed: [], skipped: [{ parent: 10, reason: 'incomplete' }] });
  assert.equal(writes(calls).length, 0);
});

test('selfInclude: false still closes when the live states are closed, judging each by its own stateReason and keeping mergingPr on the listing', () => {
  const world = happyWorld();
  world.issues[11] = { state: 'CLOSED', stateReason: 'NOT_PLANNED', title: 'Eleven' };
  world.issues[12] = { state: 'CLOSED', stateReason: 'NOT_PLANNED', title: 'Twelve' };
  const { gh, calls } = makeGh(world);
  const out = closeBelowFloorParents(base({ selfInclude: false, gh }));
  assert.deepEqual(out.closed, [{ parent: 10, maxTier: 'low' }]);
  const w = writes(calls);
  // Self-included, #11 would count COMPLETED and force --reason completed (the test above).
  assert.deepEqual(w.map((c) => c.args.join(' ')), ['issue comment 10 --repo o/r --body-file -', 'issue close 10 --repo o/r --reason not planned']);
  assert.ok(w[0].input.includes('- #11 Eleven — closed by PR #77'));
});

test('the default (selfInclude omitted) is the in-session mirror: a closing-set member reading OPEN still counts CLOSED', () => {
  const world = happyWorld();
  world.issues[11] = { state: 'OPEN', stateReason: 'REOPENED', title: 'Eleven' };
  const { gh, calls } = makeGh(world);
  const out = closeBelowFloorParents(base({ gh }));
  assert.deepEqual(out, { closed: [{ parent: 10, maxTier: 'low' }], skipped: [] });
  assert.deepEqual(writes(calls).map((c) => c.args.join(' ')), ['issue comment 10 --repo o/r --body-file -', 'issue close 10 --repo o/r --reason completed']);
});

test('nothing completed: the comment carries the not-planned line and the close reason is "not planned"', () => {
  // Closing record 99 resolves to parent 10 but is not itself one of parent 10's sub-issues, so
  // the self-inclusion override (which never adds sub-issues) leaves every sub-issue as live.
  const world = {
    parentOf: { 99: 10 },
    subs: { 10: [11, 12] },
    issues: {
      11: { state: 'CLOSED', stateReason: 'NOT_PLANNED', title: 'Eleven' },
      12: { state: 'CLOSED', stateReason: 'NOT_PLANNED', title: 'Twelve' },
    },
  };
  const { gh, calls } = makeGh(world);
  const out = closeBelowFloorParents(base({ closingSet: [99], gh }));
  assert.deepEqual(out.closed, [{ parent: 10, maxTier: 'low' }]);
  const w = writes(calls);
  assert.deepEqual(w.map((c) => c.args), [['issue', 'comment', '10', '--repo', 'o/r', '--body-file', '-'], ['issue', 'close', '10', '--repo', 'o/r', '--reason', 'not planned']]);
  assert.ok(w[0].input.includes(proseNotPlannedLine()));
});

test('an invalid risk floor skips the whole call fail-closed with no gh call', () => {
  for (const riskFloor of [null, undefined, '', 'critical']) {
    const { gh, calls } = makeGh(happyWorld());
    const out = closeBelowFloorParents(base({ riskFloor, gh }));
    assert.deepEqual(out, { closed: [], skipped: [{ reason: 'invalid-risk-floor' }] }, String(riskFloor));
    assert.equal(calls.length, 0);
  }
});

test('a sub-issue with no title renders without "undefined" or a trailing space', () => {
  const world = happyWorld();
  world.issues[11].title = null;
  const { gh, calls } = makeGh(world);
  closeBelowFloorParents(base({ gh }));
  const lines = writes(calls)[0].input.split('\n').filter((l) => l.startsWith('- #'));
  assert.equal(lines[0], '- #11 — closed by PR #77');
  assert.ok(!writes(calls)[0].input.includes('undefined'));
});

test('a whitespace-only or missing title renders as no title', () => {
  for (const title of ['   ', undefined]) {
    const world = happyWorld();
    world.issues[11].title = title;
    const { gh, calls } = makeGh(world);
    closeBelowFloorParents(base({ gh }));
    const lines = writes(calls)[0].input.split('\n').filter((l) => l.startsWith('- #'));
    assert.equal(lines[0], '- #11 — closed by PR #77', JSON.stringify(title));
  }
});

test('isCloseMarkerComment: heading line from a trusted author or the current login only', () => {
  const body = '## Closed below the oversight floor\n\nEvery sub-issue …';
  const by = (login, authorAssociation) => ({ body, authorAssociation, author: { login } });
  assert.equal(isCloseMarkerComment(by('x', 'MEMBER'), ''), true, 'trusted author');
  assert.equal(isCloseMarkerComment(by('bot-self', 'NONE'), 'bot-self'), true, 'own login');
  assert.equal(isCloseMarkerComment(by('', 'NONE'), ''), false, 'empty login never matches an empty author login');
  assert.equal(isCloseMarkerComment(by('stranger', 'NONE'), 'bot-self'), false, 'untrusted other login');
  assert.equal(isCloseMarkerComment({ body: 'see ## Closed below the oversight floor', authorAssociation: 'MEMBER' }, ''), false, 'mid-line heading');
  assert.equal(isCloseMarkerComment(null, 'bot-self'), false, 'null comment');
});
