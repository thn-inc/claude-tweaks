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

function runFetchBlock(login, { raw = false } = {}) {
  const dir = mkTmp('cp-fetch-');
  const p = (name) => path.join(dir, name).replace(/\\/g, '/');
  const open10 = { number: 10, title: 'Parent 10', body: '', labels: [{ name: 'parent-issue' }] };
  // Numbers 18 and 19 appear only in the legacy (`family:parent`) fetches, so dropping either
  // legacy file from the block's `fetched` array changes the result.
  const legacyOpen = { number: 18, title: 'Parent 18', body: '', labels: [{ name: 'family:parent' }] };
  const files = {
    $PI_NEW: [open10],
    $PI_LEG: [open10, legacyOpen],
    $PC_NEW: [
      closedRow(11, 5, [comment(MARKER, 'MEMBER', 'x')]),
      closedRow(12, 40, []),
      closedRow(13, 5, [comment(MARKER, 'NONE', 'stranger')]),
      closedRow(15, 5, [comment('see ## Closed below the oversight floor', 'MEMBER', 'x')]),
      closedRow(17, 5, [comment(MARKER, 'NONE', 'bot-self')]),
      closedRow(20, 29, []),
      closedRow(21, 31, []),
    ],
    $PC_LEG: [closedRow(11, 5, [comment(MARKER, 'MEMBER', 'x')]), closedRow(19, 5, [])],
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
  if (raw) return { res, parentsFile: p('PARENTS.json') };
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(fs.readFileSync(p('PARENTS.json'), 'utf8'));
}

test('AC1.1: the parent-gate fetch block merges open and closed parents inside the 30-day window and marks the #4466 close', () => {
  const parents = runFetchBlock('bot-self');
  assert.deepEqual(parents.map((x) => x.number).sort((a, b) => a - b), [10, 11, 13, 15, 17, 18, 19, 20]);
  const marked = parents.filter((x) => x.belowFloorClose === true).map((x) => x.number).sort((a, b) => a - b);
  assert.deepEqual(marked, [11, 17]);
  assert.equal(parents.find((x) => x.number === 11).state, 'CLOSED');
  for (const x of parents) assert.ok(!('comments' in x), '#' + x.number + ' carries no comments key');
});

test('AC2.1: the parent-gate fetch block degrades an empty gh login to trusted-author marker matching, keeps every row, and warns', () => {
  // A failed `gh api user` leaves the login file empty. The block does not stop: with no login only
  // trusted-author close markers match, so #11's MEMBER marker still counts and #17's NONE-association
  // marker (posted by the current identity) reads as absent, and one WARNING names the cause.
  const { IDENTITY_PROBE_FAILED_NOTE } = require(path.join(PLUGIN_ROOT, 'bin', 'lib', 'issues', 'parent-gate.js'));
  const { res, parentsFile } = runFetchBlock('', { raw: true });
  assert.equal(res.status, 0, res.stderr);
  const parents = JSON.parse(fs.readFileSync(parentsFile, 'utf8'));
  assert.deepEqual(parents.map((x) => x.number).sort((a, b) => a - b), [10, 11, 13, 15, 17, 18, 19, 20]);
  assert.deepEqual(parents.filter((x) => x.belowFloorClose === true).map((x) => x.number), [11]);
  const warnings = lines(res.stderr).filter((l) => l.startsWith('WARNING: '));
  assert.equal(warnings.length, 1, res.stderr);
  assert.ok(warnings[0].includes(IDENTITY_PROBE_FAILED_NOTE), warnings[0]);
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
  // The REST fallback's inputs: its jsonl is what the per-parent `gh api --paginate` loop appends, one row per parent.
  fs.writeFileSync(p('sub-issues.jsonl'), '{"number":1,"subIssueNumbers":[101,102]}\n{"number":2,"subIssueNumbers":[101]}\n');
  fs.writeFileSync(p('pg-fail.txt'), '');
  const run = (needle, out) => {
    const gatesFile = p(out);
    const script = scanScript(PG, needle)
      .split('$PARENTS').join(p('parents.json'))
      .split('$ALL_STATES').join(p('states.json'))
      .split('$PG_BATCH').join(p('batch.json'))
      .split('$SUB_ISSUES').join(p('sub-issues.jsonl'))
      .split('$PG_FAIL').join(p('pg-fail.txt'))
      .split('$GATES').join(gatesFile);
    execFileSync('node', ['-e', script], { encoding: 'utf8' });
    return JSON.parse(fs.readFileSync(gatesFile, 'utf8'));
  };
  for (const gates of [run('parseSubIssues(p.body)', 'gates-body.json'), run('batch.byParent', 'gates-native.json'), run('sub-issue REST fallback failed', 'gates-fallback.json')]) {
    assert.equal(gates[0].state, 'CLOSED');
    assert.equal(gates[0].stateReason, 'COMPLETED');
    assert.equal(gates[0].belowFloorClose, true);
    assert.deepEqual(gates[0].subIssues.map((s) => s.unread), [false, true]);
    // The state map's state and label names reach the prefilter's input; an id absent from it reads OPEN, unlabelled.
    assert.deepEqual(gates[0].subIssues.map((s) => s.state), ['CLOSED', 'OPEN']);
    assert.deepEqual(gates[0].subIssues.map((s) => s.labels), [['risk:low'], []]);
    assert.equal(gates[1].state, 'OPEN');
    assert.equal(gates[1].stateReason, null);
    assert.equal(gates[1].belowFloorClose, false);
  }
});

// ---- local-files Shape 7 ----

const LOCAL = section(read('tidy/step-1-records.md'), '### Shape 7 — decomposition parent gate due', '### Shape 8 —');

// A temp cwd holding `specs/`, with helpers that write parents and sub-issues through the real
// local store (the same driver the fence reads).
function localFixture() {
  const { writeRecord, closeRecord, defaultFacets } = require(path.join(PLUGIN_ROOT, 'bin', 'lib', 'issues', 'local-store.js'));
  const cwd = mkTmp('cp-local-');
  const file = (n, slug) => path.join(cwd, 'specs', `${String(n).padStart(2, '0')}-${slug}.md`);
  const parent = (n, title, { closed: isClosed = false, notPlanned = false, acceptance = null, closedAt, noClosedAt = false, body = 'Parent body.' } = {}) => {
    const facets = { ...defaultFacets(), isParentIssue: true, ...(notPlanned ? { notPlanned: true } : {}), ...(acceptance ? { acceptance } : {}) };
    const f = file(n, 'parent');
    if (closedAt || noClosedAt) writeRecord(f, { title, body, facets: { ...facets, closed: true, ...(closedAt ? { closedAt } : {}) } });
    else {
      writeRecord(f, { title, body, facets });
      if (isClosed) closeRecord(f);
    }
    return f;
  };
  const subIssue = (n, parentId, risk, { closed: isClosed = true } = {}) => {
    const f = file(n, 'sub');
    writeRecord(f, { title: 'sub ' + n, body: 'Sub body.', facets: { ...defaultFacets(), parent: parentId, ...(risk ? { risk } : {}) } });
    if (isClosed) closeRecord(f);
  };
  const run = () => spawnSync('node', ['-e', scanScript(LOCAL, "'\\t[parent-gate] '"), '--', 'high'], { cwd, encoding: 'utf8' });
  return { cwd, file, parent, subIssue, run };
}
const localRow = (id, title) => '[acceptance-gap] ' + id + ': ' + title + GAP_TAIL + id;
const localCols = (stdout) => lines(stdout).map((l) => l.split('\t'));

test('AC1.1: Shape 7 prints an acceptance-gap row for a hand-closed above-floor local parent', () => {
  const t = localFixture();
  const p1 = t.parent(1, 'Closed high parent', { closed: true });
  t.subIssue(11, 1, 'high');
  t.parent(2, 'Closed high, open sub', { closed: true });
  t.subIssue(21, 2, 'high');
  t.subIssue(22, 2, 'low', { closed: false });
  t.parent(3, 'Closed high not planned', { closed: true, notPlanned: true });
  t.subIssue(31, 3, 'high');
  t.parent(4, 'Closed high approved', { closed: true, acceptance: 'approved' });
  t.subIssue(41, 4, 'high');
  t.parent(5, 'Closed high long ago', { closedAt: daysAgo(40) });
  t.subIssue(51, 5, 'high');
  t.parent(6, 'Open high parent');
  t.subIssue(61, 6, 'high');
  const r = t.run();
  assert.equal(r.status, 0, r.stderr);
  const cols = localCols(r.stdout);
  assert.deepEqual(cols.map((c) => c[1]), [
    localRow(1, 'Closed high parent'),
    localRow(2, 'Closed high, open sub'),
    '[parent-gate] 6: Open high parent' + ABOVE_ROW_TAIL + '6',
  ]);
  assert.ok(cols[0][0].endsWith(path.basename(p1)), cols[0][0]);
});

test('AC2.1: Shape 7 prints no row for a #4466-closed or below-floor local parent', () => {
  const t = localFixture();
  t.parent(7, 'Closed below floor, relabelled', { closed: true, body: 'Parent body.\n\n' + MARKER });
  t.subIssue(71, 7, 'high');
  t.parent(8, 'Hand-closed below floor', { closed: true });
  t.subIssue(81, 8, 'medium');
  t.parent(9, 'Closed above floor', { closed: true });
  t.subIssue(91, 9, 'high');
  const r = t.run();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(localCols(r.stdout).map((c) => c[1]), [localRow(9, 'Closed above floor')]);
});

test('Q2: Shape 7 counts a closed local parent with no sub-issues in one warning line', () => {
  const t = localFixture();
  t.parent(10, 'No subs A', { closed: true });
  t.parent(11, 'No subs B', { closed: true });
  t.parent(12, 'Control high', { closed: true });
  t.subIssue(121, 12, 'high');
  const r = t.run();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(localCols(r.stdout).map((c) => c[1]), [localRow(12, 'Control high')]);
  const warn = lines(r.stderr);
  assert.equal(warn.length, 1, r.stderr);
  assert.ok(warn[0].includes('2 closed parent') && warn[0].includes('no-sub-issues'), warn[0]);
  const quiet = localFixture();
  quiet.parent(1, 'Open', {});
  quiet.subIssue(11, 1, 'high');
  assert.equal(quiet.run().stderr, '');
});

test('Q3: Shape 7 keeps a closed local parent whose closedAt is missing or unparseable', () => {
  const t = localFixture();
  const missing = t.parent(1, 'Closed, no closedAt', { noClosedAt: true });
  t.subIssue(11, 1, 'high');
  t.parent(2, 'Closed, unparseable closedAt', { closedAt: 'not-a-date' });
  t.subIssue(21, 2, 'high');
  t.parent(3, 'Closed long ago', { closedAt: daysAgo(40) });
  t.subIssue(31, 3, 'high');
  assert.ok(!fs.readFileSync(missing, 'utf8').includes('closed-at:'), 'fixture 1 carries no closed-at line');
  const r = t.run();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(localCols(r.stdout).map((c) => c[1]), [localRow(1, 'Closed, no closedAt'), localRow(2, 'Closed, unparseable closedAt')]);
});
