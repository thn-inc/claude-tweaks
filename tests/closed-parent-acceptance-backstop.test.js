// tests/closed-parent-acceptance-backstop.test.js
//
// Conformance for #4600 (GitHub driver): the `parent-gate` scope reports a decomposition parent
// that was closed by hand above the oversight floor as an `[acceptance-gap]` row. The prose in
// plugin/skills/ is the contract (an agent runs these fences), so the live fences are executed
// against fixtures. The classification rules live in `closedParentGap` (acceptance.js); these
// tests prove the scan wires it in, not the rules themselves.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const PLUGIN_ROOT = path.join(ROOT, 'plugin');
const SKILLS_DIR = path.join(PLUGIN_ROOT, 'skills');

function read(rel) {
  return readText(path.join(SKILLS_DIR, rel));
}

// The text from `startHeading` up to (not including) `endHeading`, or to the end of the text when
// `endHeading` is null. Throws when either anchor is missing so a renamed heading is a loud
// failure rather than an empty slice that every assertion silently runs over.
function section(text, startHeading, endHeading) {
  const start = text.indexOf(startHeading);
  assert.ok(start !== -1, `heading not found: ${startHeading}`);
  if (endHeading === null) return text.slice(start);
  const end = text.indexOf(endHeading, start + startHeading.length);
  assert.ok(end !== -1, `end heading not found after "${startHeading}": ${endHeading}`);
  return text.slice(start, end);
}

// Same shape as tests/below-floor-parent-close-conformance.test.js: `node -e "` ... closing `"` at a line start.
function extractNodeScripts(text) {
  const scripts = [];
  const re = /node -e "\n([\s\S]*?)\n\s*"/g;
  let m;
  while ((m = re.exec(text)) !== null) scripts.push(m[1].replace(/\\"/g, '"').replace(/\\\$/g, '$'));
  return scripts;
}

function scanScript(text, needle) {
  const found = extractNodeScripts(text).filter((s) => s.includes(needle));
  assert.equal(found.length, 1, `exactly one node -e block carries ${needle}`);
  return found[0].split('${CLAUDE_PLUGIN_ROOT}').join(PLUGIN_ROOT.replace(/\\/g, '/'));
}

const tmpRoots = [];
after(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true });
});
function mkTmp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

const GAP_TAIL = ' — closed with no acceptance disposition — recommend /claude-tweaks:demo ';
const ABOVE_ROW_TAIL = ' — parent complete, no acceptance disposition — Open parent gate, then /claude-tweaks:demo ';
const PG = section(read('_shared/github-pr-scan-acceptance.md'), '## Scope: `parent-gate`', null);

const sub = (number, risk, state = 'CLOSED', unread = false) => ({
  number, state, labels: risk ? [{ name: 'risk:' + risk }] : [], unread,
});
const closed = (number, title, subIssues, extra = {}) => ({
  number, title, parentLabels: [], state: 'CLOSED', stateReason: 'COMPLETED', belowFloorClose: false, subIssues, ...extra,
});
const gapRow = (n, title) => '[acceptance-gap] #' + n + ': ' + title + GAP_TAIL + '#' + n;

function runPrefilter(gates, floor = 'high') {
  const script = scanScript(PG, "'[parent-gate] #'");
  const gatesFile = path.join(mkTmp('cp-gates-'), 'gates.json');
  fs.writeFileSync(gatesFile, JSON.stringify(gates));
  return spawnSync('node', ['-e', script.split('$GATES').join(gatesFile.replace(/\\/g, '/')), '--', floor], {
    encoding: 'utf8',
  });
}
const lines = (s) => s.trim().split('\n').filter(Boolean);

test('AC1.1: the GitHub parent-gate scan prints an acceptance-gap row for a hand-closed above-floor parent', () => {
  const gates = [
    { number: 1, title: 'Open high parent', parentLabels: [], subIssues: [sub(11, 'high')] },
    closed(2, 'Closed high parent', [sub(21, 'high'), sub(22, 'low')]),
    closed(3, 'Closed unscored parent', [sub(31, null)]),
    closed(4, 'Closed high parent, open sub', [sub(41, 'high'), sub(42, 'low', 'OPEN')]),
    closed(5, 'Closed high not planned', [sub(51, 'high')], { stateReason: 'NOT_PLANNED' }),
    closed(6, 'Closed high approved', [sub(61, 'high')], { parentLabels: ['demo:approved'] }),
  ];
  const r = runPrefilter(gates);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(lines(r.stdout), [
    '[parent-gate] #1: Open high parent' + ABOVE_ROW_TAIL + '#1',
    gapRow(2, 'Closed high parent'),
    gapRow(3, 'Closed unscored parent'),
    gapRow(4, 'Closed high parent, open sub'),
  ]);
});

test('AC2.1: the GitHub scan prints no row for a #4466-closed or below-floor parent', () => {
  const gates = [
    closed(7, 'Closed below floor, relabelled', [sub(71, 'high')], { belowFloorClose: true }),
    closed(8, 'Hand-closed below floor', [sub(81, 'medium')]),
    closed(9, 'Closed above floor', [sub(91, 'high')], { belowFloorClose: false }),
  ];
  const r = runPrefilter(gates);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(lines(r.stdout), [gapRow(9, 'Closed above floor')]);
});

test('Q2: an unreadable closed parent prints no row and one warning line per cause', () => {
  const gates = [
    closed(10, 'No subs A', []),
    closed(11, 'No subs B', []),
    closed(12, 'Low plus unread', [sub(121, 'low'), sub(122, null, 'OPEN', true)]),
    closed(16, 'High plus unread', [sub(161, 'high'), sub(162, null, 'OPEN', true)]),
    closed(14, 'Control high', [sub(141, 'high')]),
  ];
  const r = runPrefilter(gates);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(lines(r.stdout), [gapRow(16, 'High plus unread'), gapRow(14, 'Control high')]);
  const warn = lines(r.stderr);
  assert.equal(warn.filter((l) => l.includes('2 closed parent') && l.includes('no-sub-issues')).length, 1, r.stderr);
  assert.equal(warn.filter((l) => l.includes('1 closed parent') && l.includes('unread-sub-issue')).length, 1, r.stderr);
  const quiet = runPrefilter([{ number: 1, title: 'Open', parentLabels: [], subIssues: [sub(11, 'high')] }]);
  assert.equal(quiet.stderr, '');
});

// ---- the fetch block ----

const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();
const MARKER = '## Closed below the oversight floor\n\nEvery sub-issue …';
const closedRow = (number, ageDays, comments) => ({
  number, title: 'Parent ' + number, body: '', state: 'CLOSED', stateReason: 'COMPLETED',
  closedAt: daysAgo(ageDays), labels: [{ name: 'parent-issue' }], comments,
});
const comment = (body, authorAssociation, login) => ({ author: { login }, authorAssociation, body });

function runFetchBlock(login) {
  const dir = mkTmp('cp-fetch-');
  const p = (name) => path.join(dir, name).replace(/\\/g, '/');
  const open10 = { number: 10, title: 'Parent 10', body: '', labels: [{ name: 'parent-issue' }] };
  const files = {
    $PI_NEW: [open10],
    $PI_LEG: [open10],
    $PC_NEW: [
      closedRow(11, 5, [comment(MARKER, 'MEMBER', 'x')]),
      closedRow(12, 40, []),
      closedRow(13, 5, [comment(MARKER, 'NONE', 'stranger')]),
      closedRow(15, 5, [comment('see ## Closed below the oversight floor', 'MEMBER', 'x')]),
      closedRow(17, 5, [comment(MARKER, 'NONE', 'bot-self')]),
    ],
    $PC_LEG: [closedRow(11, 5, [comment(MARKER, 'MEMBER', 'x')])],
    $ALL_STATES: [],
    $PARENTS: null,
  };
  // The fence redirects `gh api user --jq .login` into `$PARENTS.login` (a `$(gh ...)` assignment
  // is a refused fence shape), so the test writes what that command would have printed.
  fs.writeFileSync(p('PARENTS.json.login'), login + '\n');
  let script = scanScript(PG, 'process.env.STATE_SEARCH');
  // Longer names first, so a name that prefixes another is never clipped.
  for (const token of Object.keys(files).sort((a, b) => b.length - a.length)) {
    const file = p(token.slice(1) + '.json');
    if (files[token] !== null) fs.writeFileSync(file, JSON.stringify(files[token]));
    script = script.split(token).join(file);
  }
  const res = spawnSync('node', ['-e', script], {
    encoding: 'utf8', env: { ...process.env, FETCH_LIMIT: '500', STATE_SEARCH: '' },
  });
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(fs.readFileSync(p('PARENTS.json'), 'utf8'));
}

test('AC1.1: the parent-gate fetch block merges open and closed parents inside the 30-day window and marks the #4466 close', () => {
  const parents = runFetchBlock('bot-self');
  assert.deepEqual(parents.map((x) => x.number).sort((a, b) => a - b), [10, 11, 13, 15, 17]);
  const marked = parents.filter((x) => x.belowFloorClose === true).map((x) => x.number).sort((a, b) => a - b);
  assert.deepEqual(marked, [11, 17]);
  assert.equal(parents.find((x) => x.number === 11).state, 'CLOSED');
  for (const x of parents) assert.ok(!('comments' in x), '#' + x.number + ' carries no comments key');
  const noLogin = runFetchBlock('');
  assert.equal(noLogin.find((x) => x.number === 17).belowFloorClose, false);
  assert.equal(noLogin.find((x) => x.number === 11).belowFloorClose, true);
});

test('AC1.1: the closed-parent fetches are bounded to the window and carry what the gate reads', () => {
  const fetches = PG.split('\n').filter((l) => /gh issue list --label (parent-issue|family:parent) --state closed/.test(l));
  assert.equal(fetches.length, 2);
  for (const line of fetches) {
    // Computed inline: a `SINCE="$(node …)"` variable handed to `gh` is a refused fence shape.
    assert.ok(line.includes('--search "closed:>=$(node -p "new Date(Date.now() - 31 * 864e5).toISOString().slice(0, 10)")"'), line);
    const json = /--json (\S+)/.exec(line);
    assert.ok(json, line);
    const fields = json[1].split(',');
    for (const f of ['state', 'stateReason', 'closedAt', 'comments', 'body', 'labels']) {
      assert.ok(fields.includes(f), `${f} in ${json[1]}`);
    }
  }
});

// ---- the composers ----

test('AC1.1: every gate composer carries the parent\'s closed state and the unread flag', () => {
  const dir = mkTmp('cp-compose-');
  const p = (name) => path.join(dir, name).replace(/\\/g, '/');
  const parents = [
    { number: 1, title: 'Closed parent', body: '- [x] #101\n- [x] #102', labels: [{ name: 'parent-issue' }], state: 'CLOSED', stateReason: 'COMPLETED', belowFloorClose: true },
    { number: 2, title: 'Open parent', body: '- [x] #101', labels: [{ name: 'parent-issue' }] },
  ];
  fs.writeFileSync(p('parents.json'), JSON.stringify(parents));
  fs.writeFileSync(p('states.json'), JSON.stringify([{ number: 101, state: 'CLOSED', labels: [{ name: 'risk:low' }] }]));
  fs.writeFileSync(p('batch.json'), JSON.stringify({ byParent: { 1: [101, 102], 2: [101] } }));
  const run = (needle, out) => {
    const gatesFile = p(out);
    const script = scanScript(PG, needle)
      .split('$PARENTS').join(p('parents.json'))
      .split('$ALL_STATES').join(p('states.json'))
      .split('$PG_BATCH').join(p('batch.json'))
      .split('$GATES').join(gatesFile);
    execFileSync('node', ['-e', script], { encoding: 'utf8' });
    return JSON.parse(fs.readFileSync(gatesFile, 'utf8'));
  };
  for (const gates of [run('parseSubIssues(p.body)', 'gates-body.json'), run('batch.byParent', 'gates-native.json')]) {
    assert.equal(gates[0].state, 'CLOSED');
    assert.equal(gates[0].stateReason, 'COMPLETED');
    assert.equal(gates[0].belowFloorClose, true);
    assert.deepEqual(gates[0].subIssues.map((s) => s.unread), [false, true]);
    assert.equal(gates[1].state, 'OPEN');
    assert.equal(gates[1].stateReason, null);
    assert.equal(gates[1].belowFloorClose, false);
  }
  const fallback = scanScript(PG, 'sub-issue REST fallback failed');
  for (const text of ["state: p.state || 'OPEN'", 'stateReason: p.stateReason || null', 'belowFloorClose: p.belowFloorClose === true', 'unread: !info']) {
    assert.ok(fallback.includes(text), text);
  }
});
