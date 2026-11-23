'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { scratchDir } = require('../../helpers/tmp-dir');
const { initRepo, cleanGitEnv, originWithTwoClones } = require('../../helpers/git-fixtures');
const { classifyMirror } = require('../../../plugin/bin/lib/reconcile/classify');
const { appendGitConfigEnv } = require('../../../tools/run-tests');
const {
  appendStationEvent, buildLine, eventKey, toRepoName, stationEventPath, EXCLUDE_ENTRIES, ensureLocalExclude,
} = require('../../../plugin/bin/lib/station-events/emit');

const FIXED_NOW = () => new Date('2026-11-19T08:00:00.000Z');

function event(overrides = {}) {
  return {
    repoName: 'o/n',
    recordNumber: 42,
    kind: 'entered',
    station: 'build',
    runId: 'run-1',
    sessionId: 'sess-1',
    discriminator: 'claimedAt-1',
    ...overrides,
  };
}

function fakeStderr() {
  const calls = [];
  return { calls, write: (s) => { calls.push(String(s)); return true; } };
}

function deps(mainRoot, extra = {}) {
  const stderr = fakeStderr();
  return { stderr, d: { mainRoot, now: FIXED_NOW, stderr: stderr.write, ...extra } };
}

function readLines(mainRoot) {
  const raw = fs.readFileSync(stationEventPath(mainRoot), 'utf8');
  return { raw, lines: raw.split('\n').filter(Boolean).map((l) => JSON.parse(l)) };
}

test('v1 line has exactly the spec fields', () => {
  const line = buildLine(event(), { now: FIXED_NOW });
  assert.deepEqual(Object.keys(line).sort(), [
    'at', 'eventKey', 'kind', 'lane', 'outcome', 'payload', 'recordNumber',
    'repoName', 'runId', 'sessionId', 'station', 'v',
  ]);
  assert.equal(line.v, 1);
  assert.ok(line.at.endsWith('Z'));
  assert.equal(line.outcome, null);
  assert.deepEqual(line.payload, {});
  assert.equal(line.lane, 'unknown');
  const exited = buildLine(event({ kind: 'exited', outcome: 'passed', lane: 'driver' }), { now: FIXED_NOW });
  assert.equal(exited.outcome, 'passed');
  assert.equal(exited.lane, 'driver');
  // an outcome on a non-exited kind is not carried
  assert.equal(buildLine(event({ kind: 'started', outcome: 'passed' }), { now: FIXED_NOW }).outcome, null);
});

test('eventKey is deterministic', () => {
  const fields = { repoName: 'o/n', recordNumber: 42, kind: 'entered', station: 'build', runId: 'r', discriminator: 'd1' };
  assert.equal(eventKey(fields), eventKey({ ...fields }));
  assert.match(eventKey(fields), /^[0-9a-f]{32}$/);
  assert.notEqual(eventKey(fields), eventKey({ ...fields, discriminator: 'd2' }));
  const a = buildLine(event(), { now: () => new Date('2026-01-01T00:00:00Z') });
  const b = buildLine(event(), { now: () => new Date('2026-06-01T00:00:00Z') });
  assert.notEqual(a.at, b.at);
  assert.equal(a.eventKey, b.eventKey);
});

test('each append runs inside withLock on the sibling .lock path', () => {
  const root = scratchDir('ct-station-events-');
  const file = stationEventPath(root);
  let appended = 0;
  const countingFs = { ...fs, appendFileSync: (...args) => { appended += 1; return fs.appendFileSync(...args); } };
  const calls = [];
  const recordingLock = (lockPath, fn, opts) => {
    const call = { lockPath, opts, before: appended };
    calls.push(call);
    const result = fn();
    call.after = appended;
    return result;
  };
  const { d } = deps(root, { fs: countingFs, withLock: recordingLock });
  appendStationEvent(event(), d);
  appendStationEvent(event({ kind: 'exited', outcome: 'passed' }), d);
  assert.equal(calls.length, 2);
  for (const [i, call] of calls.entries()) {
    assert.equal(call.lockPath, `${file}.lock`);
    assert.deepEqual(call.opts, { createParent: true });
    assert.equal(call.before, i);
    assert.equal(call.after, i + 1);
  }
  // a lock whose callback never runs appends nothing
  const heldRoot = scratchDir('ct-station-events-');
  const { d: held } = deps(heldRoot, { fs: countingFs, withLock: () => undefined });
  const before = appended;
  appendStationEvent(event(), held);
  assert.equal(appended, before);
  assert.equal(fs.existsSync(stationEventPath(heldRoot)), false);
});

test('a throw while resolving deps still writes one stderr line', () => {
  const stderr = fakeStderr();
  const throwing = { now: FIXED_NOW, stderr: stderr.write };
  Object.defineProperty(throwing, 'mainRoot', { enumerable: true, get() { throw new Error('cwd gone'); } });
  let result;
  assert.doesNotThrow(() => { result = appendStationEvent(event(), throwing); });
  assert.equal(result.written, false);
  assert.equal(stderr.calls.length, 1);
});

test('appends whole lines under the real lock', () => {
  const root = scratchDir('ct-station-events-');
  const { stderr, d } = deps(root);
  assert.deepEqual(appendStationEvent(event(), d), { written: true });
  assert.deepEqual(appendStationEvent(event({ kind: 'exited', outcome: 'passed' }), d), { written: true });
  const { raw, lines } = readLines(root);
  assert.equal(lines.length, 2);
  assert.ok(raw.endsWith('\n'));
  assert.equal(stationEventPath(root), path.join(root, '.claude-tweaks', 'station-events.jsonl'));
  assert.equal(fs.existsSync(stationEventPath(root) + '.lock'), false);
  assert.equal(stderr.calls.length, 0);
});

test('resolves to the main checkout from a linked worktree', () => {
  const base = scratchDir('ct-station-events-wt-', { realpath: true });
  const main = path.join(base, 'main');
  const wt = path.join(base, 'wt');
  fs.mkdirSync(path.join(main, '.git', 'worktrees', 'x'), { recursive: true });
  fs.mkdirSync(wt, { recursive: true });
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'x')}\n`);
  const prev = process.cwd();
  process.chdir(wt);
  let result;
  try {
    result = appendStationEvent(event(), { now: FIXED_NOW, stderr: () => true });
  } finally {
    process.chdir(prev);
  }
  assert.deepEqual(result, { written: true });
  assert.equal(readLines(main).lines.length, 1);
  assert.equal(fs.existsSync(path.join(wt, '.claude-tweaks')), false);
});

test('a write failure is swallowed', () => {
  const root = scratchDir('ct-station-events-');
  const throwingFs = { ...fs, appendFileSync: () => { throw new Error('disk full'); } };
  const { stderr, d } = deps(root, { fs: throwingFs });
  let result;
  assert.doesNotThrow(() => { result = appendStationEvent(event(), d); });
  assert.equal(result.written, false);
  assert.equal(typeof result.reason, 'string');
  assert.equal(stderr.calls.length, 1);
});

test('an unresolvable identity is dropped', () => {
  for (const bad of [{ repoName: 'unknown' }, { recordNumber: 0 }]) {
    const root = scratchDir('ct-station-events-');
    assert.equal(buildLine(event(bad), { now: FIXED_NOW }), null);
    const { stderr, d } = deps(root);
    const result = appendStationEvent(event(bad), d);
    assert.equal(result.written, false);
    assert.equal(stderr.calls.length, 1);
    assert.equal(fs.existsSync(stationEventPath(root)), false);
  }
});

test('kind and outcome outside the closed sets are refused', () => {
  for (const bad of [{ kind: 'teleported' }, { kind: 'exited', outcome: 'released' }, { kind: 'exited' }, { lane: 'fast' }]) {
    const root = scratchDir('ct-station-events-');
    assert.equal(buildLine(event(bad), { now: FIXED_NOW }), null);
    const { stderr, d } = deps(root);
    assert.equal(appendStationEvent(event(bad), d).written, false);
    assert.equal(stderr.calls.length, 1);
    assert.equal(fs.existsSync(stationEventPath(root)), false);
  }
});

test('toRepoName maps a host-prefixed or bare slug to owner/name', () => {
  assert.equal(toRepoName('github.com/o/n'), 'o/n');
  assert.equal(toRepoName('o/n'), 'o/n');
  assert.equal(toRepoName(''), null);
});

// #5957: the log and its lock are excluded locally at append time. Git children run
// hermetic so a developer's global core.excludesFile cannot hide the log.
function hermeticEnv() {
  // The literal '/dev/null' (not os.devNull, which is '\\.\nul' on Windows) is the value
  // git accepts on every platform (tests/git-config-null-device-conformance.test.js).
  // GIT_CONFIG_GLOBAL does not stop git reading its default excludes file
  // ($XDG_CONFIG_HOME/git/ignore, ~/.config/git/ignore); core.excludesFile does. It is
  // appended after the runner's own GIT_CONFIG_* pairs so they survive (#5768).
  return appendGitConfigEnv({ ...cleanGitEnv(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    [['core.excludesFile', '/dev/null']]);
}

function porcelain(dir) {
  return execFileSync('git', ['-C', dir, 'status', '--porcelain'], { env: hermeticEnv(), encoding: 'utf8', windowsHide: true });
}

function excludeLines(root) {
  return fs.readFileSync(path.join(root, '.git', 'info', 'exclude'), 'utf8').split(/\r?\n/).filter(Boolean);
}

test('an append in a repo with no station-events ignore rule leaves git status clean', () => {
  // Control: in a fresh repo a hand-written log reads dirty, so a hiding environment fails loudly.
  const control = scratchDir('ct-station-events-');
  initRepo(control);
  fs.mkdirSync(path.dirname(stationEventPath(control)), { recursive: true });
  fs.writeFileSync(stationEventPath(control), '{}\n');
  assert.notEqual(porcelain(control), '');
  const root = scratchDir('ct-station-events-');
  initRepo(root);
  const { stderr, d } = deps(root);
  assert.deepEqual(appendStationEvent(event(), d), { written: true });
  assert.equal(porcelain(root), '');
  assert.equal(stderr.calls.length, 0);
  assert.equal(readLines(root).lines.length, 1);
});

test('reconcile mirror reads the checkout clean after an append', () => {
  const { work } = originWithTwoClones('ct-station-events-mirror-');
  const file = stationEventPath(work);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{}\n');
  assert.deepEqual(classifyMirror(work, 'main', { env: hermeticEnv() }), { state: 'dirty', failure: null });
  fs.rmSync(file);
  const { d } = deps(work);
  assert.deepEqual(appendStationEvent(event(), d), { written: true });
  assert.deepEqual(classifyMirror(work, 'main', { env: hermeticEnv() }), { state: 'current', failure: null });
});

test('the exclude lists the log and its lock directory', () => {
  // Literal paths, so dropping either entry from EXCLUDE_ENTRIES fails here: a lock
  // directory left by a killed append would otherwise dirty the checkout.
  assert.deepEqual([...EXCLUDE_ENTRIES], [
    '/.claude-tweaks/station-events.jsonl',
    '/.claude-tweaks/station-events.jsonl.lock',
  ]);
});

test('the exclude entries are appended once, on their own lines', () => {
  const root = scratchDir('ct-station-events-');
  initRepo(root);
  fs.mkdirSync(path.join(root, '.git', 'info'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git', 'info', 'exclude'), '# mine\n*.swp');
  const { d } = deps(root);
  appendStationEvent(event(), d);
  appendStationEvent(event(), d);
  assert.deepEqual(excludeLines(root), ['# mine', '*.swp', ...EXCLUDE_ENTRIES]);
});

test('existing CRLF entries are not appended again', () => {
  const root = scratchDir('ct-station-events-');
  initRepo(root);
  const file = path.join(root, '.git', 'info', 'exclude');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, EXCLUDE_ENTRIES.join('\r\n') + '\r\n');
  const before = fs.readFileSync(file);
  assert.equal(ensureLocalExclude(root), true);
  assert.deepEqual(fs.readFileSync(file), before);
});

test('a missing info directory is created', () => {
  const root = scratchDir('ct-station-events-');
  initRepo(root);
  fs.rmSync(path.join(root, '.git', 'info'), { recursive: true, force: true });
  const { d } = deps(root);
  assert.deepEqual(appendStationEvent(event(), d), { written: true });
  assert.deepEqual(excludeLines(root), [...EXCLUDE_ENTRIES]);
  assert.equal(porcelain(root), '');
});

test('entries git would not match are appended exactly: leading space, trailing tab', () => {
  const root = scratchDir('ct-station-events-');
  initRepo(root);
  const file = path.join(root, '.git', 'info', 'exclude');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const seeded = [` ${EXCLUDE_ENTRIES[0]}`, `${EXCLUDE_ENTRIES[1]}\t`];
  fs.writeFileSync(file, seeded.join('\n') + '\n');
  const { d } = deps(root);
  assert.deepEqual(appendStationEvent(event(), d), { written: true });
  assert.deepEqual(excludeLines(root), [...seeded, ...EXCLUDE_ENTRIES]);
  assert.equal(porcelain(root), '');
});

test('entries with trailing spaces are present to git and not appended again', () => {
  const root = scratchDir('ct-station-events-');
  initRepo(root);
  const file = path.join(root, '.git', 'info', 'exclude');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, EXCLUDE_ENTRIES.map((e) => `${e}  \n`).join(''));
  const before = fs.readFileSync(file);
  assert.equal(ensureLocalExclude(root), true);
  assert.deepEqual(fs.readFileSync(file), before);
  const { d } = deps(root);
  appendStationEvent(event(), d);
  assert.equal(porcelain(root), '');
});

test('no .git directory is a silent no-op', () => {
  const root = scratchDir('ct-station-events-');
  assert.equal(ensureLocalExclude(root), false);
  const { stderr, d } = deps(root);
  assert.deepEqual(appendStationEvent(event(), d), { written: true });
  assert.equal(fs.existsSync(path.join(root, '.git')), false);
  assert.equal(stderr.calls.length, 0);
});

test('an unwritable exclude never drops the event', () => {
  const root = scratchDir('ct-station-events-');
  initRepo(root);
  let excludeHits = 0;
  const failingFs = {
    ...fs,
    appendFileSync: (p, ...a) => {
      if (String(p).endsWith(path.join('info', 'exclude'))) { excludeHits += 1; throw new Error('EACCES'); }
      return fs.appendFileSync(p, ...a);
    },
  };
  const { stderr, d } = deps(root, { fs: failingFs });
  assert.deepEqual(appendStationEvent(event(), d), { written: true });
  assert.equal(excludeHits, 1);
  assert.equal(stderr.calls.length, 0);
  assert.equal(readLines(root).lines.length, 1);
});

// --- station-event vocabulary: contract validation (#6146) ---

function writtenLine(overrides) {
  const root = scratchDir('ct-station-events-');
  const { stderr, d } = deps(root);
  const result = appendStationEvent(event(overrides), d);
  assert.equal(result.written, true, `expected written: ${JSON.stringify(result)}`);
  const { lines } = readLines(root);
  assert.equal(lines.length, 1);
  return { line: lines[0], stderr };
}

function dropped(overrides, fieldRe) {
  const root = scratchDir('ct-station-events-');
  const { stderr, d } = deps(root);
  const result = appendStationEvent(event(overrides), d);
  assert.equal(result.written, false);
  assert.match(result.reason, fieldRe);
  assert.equal(stderr.calls.length, 1);
  assert.match(stderr.calls[0], /station event dropped/);
  assert.equal(fs.existsSync(stationEventPath(root)), false);
}

const exitedEvent = (outcome, payload) => ({ kind: 'exited', outcome, payload });

test('AC1.1 AC3.1: exited sent-back without next is dropped with a reason', () => {
  dropped(exitedEvent('sent-back', { actor: 'agent', reasonCode: 'test-failed' }), /next/);
  dropped(exitedEvent('sent-back', { actor: 'agent', reasonCode: 'test-failed', next: 'nowhere' }), /next/);
  const { line } = writtenLine(exitedEvent('sent-back', { actor: 'agent', reasonCode: 'test-failed', next: 'build' }));
  assert.equal(line.payload.next, 'build');
});

test('exited failed carrying an actor but no reasonCode is written with reasonCode unspecified', () => {
  for (const outcome of ['failed', 'stopped']) {
    const payload = { actor: 'agent' };
    const { line, stderr } = writtenLine(exitedEvent(outcome, payload));
    assert.equal(line.payload.reasonCode, 'unspecified');
    assert.equal('reasonText' in line.payload, false);
    assert.equal(stderr.calls.length, 0);
    assert.equal('reasonCode' in payload, false);
  }
});

test('an unknown reasonCode is rewritten to unspecified and the original kept in reasonText', () => {
  let { line } = writtenLine(exitedEvent('failed', { actor: 'agent', reasonCode: 'made-up' }));
  assert.equal(line.payload.reasonCode, 'unspecified');
  assert.equal(line.payload.reasonText, 'made-up');
  ({ line } = writtenLine(exitedEvent('failed', { actor: 'agent', reasonCode: 'made-up', reasonText: 'flaky ci' })));
  assert.equal(line.payload.reasonText, 'made-up: flaky ci');
  ({ line } = writtenLine(exitedEvent('stopped', { actor: 'person', reasonCode: 'withdrawn' })));
  assert.deepEqual(line.payload, { actor: 'person', reasonCode: 'withdrawn' });
});

test('exited passed with actor script is written', () => {
  let { line } = writtenLine(exitedEvent('passed', { actor: 'script' }));
  assert.equal(line.payload.actor, 'script');
  assert.equal('reasonCode' in line.payload, false);
  ({ line } = writtenLine(exitedEvent('passed', { actor: 'rule:auto-merge' })));
  assert.equal(line.payload.actor, 'rule:auto-merge');
  dropped(exitedEvent('passed', { actor: 'robot' }), /actor/);
  dropped(exitedEvent('stopped', {}), /actor/);
});

test('a planned or replanned line with an unknown or missing reasonCode is written with reasonCode unspecified', () => {
  let { line } = writtenLine({
    kind: 'planned',
    payload: { process: 'build-a-record', processVersion: 1, list: 'default', stations: ['build', 'test'], reasonCode: 'made-up' },
  });
  assert.equal(line.payload.reasonCode, 'unspecified');
  assert.equal(line.payload.reasonText, 'made-up');
  ({ line } = writtenLine({ kind: 'replanned', payload: { stations: ['test'], cause: { kind: 'config' } } }));
  assert.equal(line.payload.reasonCode, 'unspecified');
  assert.equal('reasonText' in line.payload, false);
});

test('a decided line with an unknown actor is dropped', () => {
  const payload = { decision: 'accept', actor: 'robot', via: 'panel', outcomeRef: 'abc' };
  dropped({ kind: 'decided', payload }, /actor/);
  const { line } = writtenLine({ kind: 'decided', payload: { ...payload, actor: 'person' } });
  assert.equal(line.payload.actor, 'person');
});

test('a retired outcome carrying an actor is written unchanged', () => {
  const { line } = writtenLine(exitedEvent('returned', { actor: 'robot' }));
  assert.deepEqual(line.payload, { actor: 'robot' });
});

test('a passed line with no actor is written unchanged', () => {
  const { line } = writtenLine(exitedEvent('passed', { step: 'worker' }));
  assert.deepEqual(line.payload, { step: 'worker' });
});

test('a failed line with no actor and no reasonCode is written unchanged', () => {
  const payload = { reason: 'failed: test', link: null };
  const { line } = writtenLine(exitedEvent('failed', payload));
  assert.deepEqual(line.payload, payload);
});

test('a sent-back with no actor is dropped', () => {
  dropped(exitedEvent('sent-back', { reasonCode: 'test-failed', next: 'build' }), /actor/);
});

test('held with an unknown why is dropped', () => {
  dropped({ kind: 'held', payload: { why: 'tired' } }, /why/);
  dropped({ kind: 'released', payload: {} }, /why/);
  const { line } = writtenLine({ kind: 'held', payload: { why: 'parked', ref: '#1' } });
  assert.equal(line.payload.why, 'parked');
});

test('planned with an unknown station is dropped', () => {
  dropped({ kind: 'planned', payload: { stations: ['build', 'nowhere'] } }, /stations/);
  dropped({ kind: 'planned', payload: { stations: 'build' } }, /stations/);
  dropped({ kind: 'replanned' }, /stations/);
  writtenLine({ kind: 'planned', payload: { stations: ['build', 'test'], reasonCode: 'default-list' } });
});

test('AC1.6: a legacy returned outcome is still written', () => {
  for (const outcome of ['returned', 'skipped', 'abandoned']) {
    const { line } = writtenLine(exitedEvent(outcome, {}));
    assert.equal(line.outcome, outcome);
    assert.deepEqual(line.payload, {});
  }
});

test('AC3.2: a dropped line never throws and writes a reason to stderr', () => {
  for (const bad of [exitedEvent('stopped', null), { kind: 'held', payload: 'x' }]) {
    const root = scratchDir('ct-station-events-');
    const { stderr, d } = deps(root);
    let result;
    assert.doesNotThrow(() => { result = appendStationEvent(event(bad), d); });
    assert.equal(result.written, false);
    assert.equal(stderr.calls.length, 1);
  }
});

test('AC2.1: concurrent appends of a planned and an exited line both land intact', async () => {
  const { execFile } = require('child_process');
  const root = scratchDir('ct-station-events-');
  const emitPath = path.join(__dirname, '../../../plugin/bin/lib/station-events/emit.js');
  const script = (ev) => `require(${JSON.stringify(emitPath)}).appendStationEvent(${JSON.stringify(event(ev))}, { mainRoot: ${JSON.stringify(root)} });`;
  const run = (ev) => new Promise((resolve, reject) => {
    execFile(process.execPath, ['-e', script(ev)], { windowsHide: true }, (err) => (err ? reject(err) : resolve()));
  });
  await Promise.all([
    run({ kind: 'planned', payload: { stations: ['build', 'test'], reasonCode: 'default-list' } }),
    run(exitedEvent('passed', { actor: 'agent' })),
  ]);
  const { lines } = readLines(root);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((l) => l.kind).sort(), ['exited', 'planned']);
  assert.equal(fs.existsSync(`${stationEventPath(root)}.lock`), false);
});

test('AC2.2: every new kind appends inside withLock', () => {
  const root = scratchDir('ct-station-events-');
  const file = stationEventPath(root);
  let appended = 0;
  const countingFs = { ...fs, appendFileSync: (...args) => { appended += 1; return fs.appendFileSync(...args); } };
  const calls = [];
  const recordingLock = (lockPath, fn, opts) => {
    const call = { lockPath, opts, before: appended };
    calls.push(call);
    const result = fn();
    call.after = appended;
    return result;
  };
  const { d } = deps(root, { fs: countingFs, withLock: recordingLock });
  const valid = [
    { kind: 'planned', payload: { stations: ['build'], reasonCode: 'default-list' } },
    { kind: 'replanned', payload: { stations: ['test'], reasonCode: 'scope-too-big' } },
    { kind: 'held', payload: { why: 'blocked' } },
    { kind: 'released', payload: { why: 'blocked' } },
    { kind: 'decided', payload: { actor: 'person' } },
    exitedEvent('sent-back', { actor: 'agent', reasonCode: 'test-failed', next: 'build' }),
  ];
  for (const ev of valid) assert.equal(appendStationEvent(event(ev), d).written, true);
  assert.equal(calls.length, valid.length);
  for (const [i, call] of calls.entries()) {
    assert.equal(call.lockPath, `${file}.lock`);
    assert.equal(call.before, i);
    assert.equal(call.after, i + 1);
  }
});
