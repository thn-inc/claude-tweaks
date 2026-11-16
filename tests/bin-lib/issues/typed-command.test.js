'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  POINTER_FILE,
  TYPED_DISPATCH_MAX_AGE_MS,
  POINTER_MAX_BYTES,
  isWellFormedId,
  writePointer,
  readPointer,
  readTypedCommand,
  isCandidateRow,
  rowMarkersPass,
  rowCommandNames,
} = require('../../../plugin/bin/lib/issues/typed-command');
const { slugForCwd } = require('../../../plugin/bin/lib/timing/transcript');

const SESSION = 'sess-0001';
const PROMPT = 'prompt-0001';
const AT = '2026-11-16T10:00:00.000Z';

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'typed-command-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function pointerPath(tmpdir, sessionId = SESSION) {
  return path.join(tmpdir, `ct-session-${sessionId}`, POINTER_FILE);
}

function plant(tmpdir, content, sessionId = SESSION) {
  const file = pointerPath(tmpdir, sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

function valid(records = { 12: { promptId: PROMPT, at: AT } }, sessionId = SESSION) {
  return { v: 1, sessionId, records };
}

const read = (tmpdir, number = 12, sessionId = SESSION) => readPointer({ sessionId, number, tmpdir });

test('the constants carry the spec values', () => {
  assert.strictEqual(POINTER_FILE, 'dispatch-prompts.json');
  assert.strictEqual(TYPED_DISPATCH_MAX_AGE_MS, 30 * 60 * 1000);
  assert.strictEqual(POINTER_MAX_BYTES, 65536);
});

test('isWellFormedId accepts 1 to 64 characters of [A-Za-z0-9-] only', () => {
  assert.strictEqual(isWellFormedId('a'), true);
  assert.strictEqual(isWellFormedId('A-z-09'), true);
  assert.strictEqual(isWellFormedId('x'.repeat(64)), true);
  for (const bad of ['..', '../x', 'a/b', 'a/', 'a%2fb', '', 'x'.repeat(65), 'a\n', 'a ', 'a_b', null, undefined, 12]) {
    assert.strictEqual(isWellFormedId(bad), false, JSON.stringify(bad));
  }
});

test('a valid pointer entry is returned', (t) => {
  const dir = tmp(t);
  plant(dir, valid());
  assert.deepStrictEqual(read(dir), { ok: true, promptId: PROMPT, at: AT });
});

test('no file reads no-pointer', (t) => {
  assert.deepStrictEqual(read(tmp(t)), { ok: false, reason: 'no-pointer' });
});

test('an empty records object reads no-pointer', (t) => {
  const dir = tmp(t);
  plant(dir, valid({}));
  assert.deepStrictEqual(read(dir), { ok: false, reason: 'no-pointer' });
});

test('an entry only for another record reads no-pointer', (t) => {
  const dir = tmp(t);
  plant(dir, valid({ 13: { promptId: PROMPT, at: AT } }));
  assert.deepStrictEqual(read(dir, 12), { ok: false, reason: 'no-pointer' });
});

test('a file that is not JSON reads pointer-unreadable', (t) => {
  const dir = tmp(t);
  plant(dir, '{"v":1,');
  assert.deepStrictEqual(read(dir), { ok: false, reason: 'pointer-unreadable' });
});

test('v other than 1 reads pointer-unreadable', (t) => {
  const dir = tmp(t);
  plant(dir, { ...valid(), v: 2 });
  assert.deepStrictEqual(read(dir), { ok: false, reason: 'pointer-unreadable' });
});

test('records that is an array reads pointer-unreadable', (t) => {
  const dir = tmp(t);
  plant(dir, valid([{ promptId: PROMPT, at: AT }]));
  assert.deepStrictEqual(read(dir), { ok: false, reason: 'pointer-unreadable' });
});

test('an entry promptId that is not well formed reads pointer-unreadable', (t) => {
  const dir = tmp(t);
  plant(dir, valid({ 12: { promptId: 'a/b', at: AT } }));
  assert.deepStrictEqual(read(dir), { ok: false, reason: 'pointer-unreadable' });
});

test('an entry at that does not parse reads pointer-unreadable', (t) => {
  const dir = tmp(t);
  plant(dir, valid({ 12: { promptId: PROMPT, at: 'yesterday' } }));
  assert.deepStrictEqual(read(dir), { ok: false, reason: 'pointer-unreadable' });
});

test('a sessionId other than the reader\'s reads pointer-other-session', (t) => {
  const dir = tmp(t);
  plant(dir, valid(undefined, 'sess-other'));
  assert.deepStrictEqual(read(dir), { ok: false, reason: 'pointer-other-session' });
});

// A link at the pointer path is never followed: the inside link points at a
// valid pointer, so an answer other than pointer-unreadable means it was read.
test('a symlink resolving inside the temp dir reads pointer-unreadable, its target unread', (t) => {
  const dir = tmp(t);
  const file = pointerPath(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const target = path.join(path.dirname(file), 'real.json');
  fs.writeFileSync(target, JSON.stringify(valid()));
  fs.symlinkSync(target, file);
  assert.deepStrictEqual(read(dir), { ok: false, reason: 'pointer-unreadable' });
});

test('a symlink resolving outside the temp dir reads pointer-unreadable', (t) => {
  const dir = tmp(t);
  const outside = tmp(t);
  const target = path.join(outside, 'elsewhere.json');
  fs.writeFileSync(target, JSON.stringify(valid()));
  const file = pointerPath(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.symlinkSync(target, file);
  assert.deepStrictEqual(read(dir), { ok: false, reason: 'pointer-unreadable' });
});

test('a dangling symlink reads pointer-unreadable', (t) => {
  const dir = tmp(t);
  const file = pointerPath(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.symlinkSync(path.join(dir, 'no-such-file.json'), file);
  assert.deepStrictEqual(read(dir), { ok: false, reason: 'pointer-unreadable' });
});

test('a 65,537-byte file reads pointer-unreadable', (t) => {
  const dir = tmp(t);
  const body = JSON.stringify(valid());
  plant(dir, body + ' '.repeat(65537 - body.length));
  assert.strictEqual(fs.statSync(pointerPath(dir)).size, 65537);
  assert.deepStrictEqual(read(dir), { ok: false, reason: 'pointer-unreadable' });
});

test('a reader with a malformed session id reads no-session-id without touching the filesystem', () => {
  const touched = [];
  const spy = new Proxy(fs, { get: (target, key) => { touched.push(key); return target[key]; } });
  for (const bad of ['..', '../x', '', undefined]) {
    assert.deepStrictEqual(readPointer({ sessionId: bad, number: 12, tmpdir: os.tmpdir(), fsImpl: spy }),
      { ok: false, reason: 'no-session-id' });
  }
  assert.deepStrictEqual(touched, []);
});

test('writePointer round-trips the spec shape', (t) => {
  const dir = tmp(t);
  const now = new Date(AT);
  assert.strictEqual(writePointer({ sessionId: SESSION, promptId: PROMPT, numbers: [12], now, tmpdir: dir }), true);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(pointerPath(dir), 'utf8')),
    { v: 1, sessionId: SESSION, records: { 12: { promptId: PROMPT, at: AT } } });
  assert.deepStrictEqual(read(dir), { ok: true, promptId: PROMPT, at: AT });
  assert.deepStrictEqual(fs.readdirSync(path.dirname(pointerPath(dir))), [POINTER_FILE]);
});

test('writePointer accepts epoch milliseconds for now', (t) => {
  const dir = tmp(t);
  assert.strictEqual(writePointer({ sessionId: SESSION, promptId: PROMPT, numbers: [12], now: Date.parse(AT), tmpdir: dir }), true);
  assert.deepStrictEqual(read(dir), { ok: true, promptId: PROMPT, at: AT });
});

test('a second write for 12 replaces 12\'s entry and keeps 13\'s', (t) => {
  const dir = tmp(t);
  const later = '2026-11-16T10:05:00.000Z';
  assert.strictEqual(writePointer({ sessionId: SESSION, promptId: PROMPT, numbers: [12, 13], now: new Date(AT), tmpdir: dir }), true);
  assert.strictEqual(writePointer({ sessionId: SESSION, promptId: 'prompt-0002', numbers: [12], now: new Date(later), tmpdir: dir }), true);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(pointerPath(dir), 'utf8')), {
    v: 1,
    sessionId: SESSION,
    records: { 12: { promptId: 'prompt-0002', at: later }, 13: { promptId: PROMPT, at: AT } },
  });
});

test('writePointer starts empty over a pointer of another session', (t) => {
  const dir = tmp(t);
  plant(dir, valid({ 13: { promptId: PROMPT, at: AT } }, 'sess-other'));
  assert.strictEqual(writePointer({ sessionId: SESSION, promptId: PROMPT, numbers: [12], now: new Date(AT), tmpdir: dir }), true);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(pointerPath(dir), 'utf8')),
    { v: 1, sessionId: SESSION, records: { 12: { promptId: PROMPT, at: AT } } });
});

test('writePointer replaces a symlink at the pointer path without writing through it', (t) => {
  const dir = tmp(t);
  const outside = tmp(t);
  const target = path.join(outside, 'victim.json');
  fs.writeFileSync(target, 'untouched');
  const file = pointerPath(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.symlinkSync(target, file);
  assert.strictEqual(writePointer({ sessionId: SESSION, promptId: PROMPT, numbers: [12], now: new Date(AT), tmpdir: dir }), true);
  assert.strictEqual(fs.readFileSync(target, 'utf8'), 'untouched');
  assert.strictEqual(fs.lstatSync(file).isFile(), true);
});

test('writePointer with a malformed session id writes nothing and returns false', (t) => {
  const dir = tmp(t);
  for (const bad of ['..', '../x', 'a/b', 'a/', 'a%2fb', '', 'x'.repeat(65)]) {
    assert.strictEqual(isWellFormedId(bad), false, JSON.stringify(bad));
    assert.strictEqual(writePointer({ sessionId: bad, promptId: PROMPT, numbers: [12], now: new Date(AT), tmpdir: dir }), false, JSON.stringify(bad));
  }
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});

test('writePointer with a malformed prompt id, numbers or now writes nothing and returns false', (t) => {
  const dir = tmp(t);
  const base = { sessionId: SESSION, promptId: PROMPT, numbers: [12], now: new Date(AT), tmpdir: dir };
  const cases = [
    { promptId: 'a/b' }, { promptId: '' }, { promptId: undefined },
    { numbers: [] }, { numbers: [0] }, { numbers: [-1] }, { numbers: [1.5] }, { numbers: ['12'] }, { numbers: 12 },
    { now: 'not a date' }, { now: undefined },
  ];
  for (const c of cases) {
    assert.strictEqual(writePointer({ ...base, ...c }), false, JSON.stringify(c));
  }
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});

test('readPointer answers pointer-unreadable when resolving the session root throws', () => {
  for (const tmpdir of [42, null, {}]) {
    assert.deepStrictEqual(readPointer({ sessionId: SESSION, number: 12, tmpdir }),
      { ok: false, reason: 'pointer-unreadable' }, String(tmpdir));
  }
});

// ---------------------------------------------------------------------------
// The transcript check (readTypedCommand). Fixtures are the captured rows of
// probe cases a, g and h (record #3), each case under its own prompt id.

const REPO = path.resolve(__dirname, '..', '..', '..');
const FIXTURES = path.join(REPO, 'tests', 'fixtures', 'typed-command');
const CAPTURE = path.join(REPO, '.claude-tweaks', 'pipelines', '2026-11-16T015923-record-5584', 'work', '5584-captured-rows.json');
const T_SESSION = 'test-session-0001';
const RECORD = 3;
const NOW = '2026-11-16T02:20:00.000Z';
const BOUND_MS = 30 * 60 * 1000;
const ID = { a: 'test-prompt-000a', g: 'test-prompt-000g', h: 'test-prompt-000h' };
const SLUG = '-launch-dir';
const MARKER_KEYS = ['type', 'turnOrigin', 'origin', 'promptSource', 'isMeta', 'isSidechain',
  'scheduledTaskId', 'scheduledFireId', 'wakeupSource', 'queueSkipSlashCommands', 'queueSkipAttachments', 'queuePriority'];

const fixture = (c) => JSON.parse(fs.readFileSync(path.join(FIXTURES, `captured-${c}.json`), 'utf8'));
const aRow = (over = {}) => ({ ...fixture('a')[0], ...over });
const AT_A = fixture('a')[0].timestamp;
const COMMAND = (name, args) => `<command-message>${name}</command-message>\n<command-name>/${name}</command-name>\n<command-args>${args}</command-args>`;
const toJsonl = (rows) => rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n';

function writeTranscript(configDir, slug, name, rows) {
  const dir = path.join(configDir, 'projects', slug);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, typeof rows === 'string' ? rows : toJsonl(rows));
  return file;
}

// A temp root holding a config dir and the pointer's temp dir; rows, when
// given, become the session's one transcript under SLUG.
function ctxOf(t, rows) {
  const root = tmp(t);
  const ctx = { root, configDir: path.join(root, 'config'), tmpdir: path.join(root, 'tmp') };
  fs.mkdirSync(ctx.tmpdir, { recursive: true });
  fs.mkdirSync(ctx.configDir, { recursive: true });
  if (rows !== undefined) writeTranscript(ctx.configDir, SLUG, `${T_SESSION}.jsonl`, rows);
  return ctx;
}

function point(ctx, promptId = ID.a, at = AT_A) {
  assert.strictEqual(writePointer({ sessionId: T_SESSION, promptId, numbers: [RECORD], now: at, tmpdir: ctx.tmpdir }), true);
}

function check(ctx, over = {}) {
  return readTypedCommand({
    number: RECORD,
    env: { CLAUDE_CODE_SESSION_ID: T_SESSION, CLAUDE_CONFIG_DIR: ctx.configDir },
    now: NOW,
    tmpdir: ctx.tmpdir,
    homeDir: ctx.root,
    ...over,
  });
}

// rows written as the transcript, the pointer naming promptId at `at`.
function scenario(t, rows, { promptId = ID.a, at = AT_A, over } = {}) {
  const ctx = ctxOf(t, rows);
  point(ctx, promptId, at);
  return check(ctx, over);
}

const TYPED_A = { answer: 'typed', promptId: ID.a };
const none = (reason) => ({ answer: 'none', reason });

test('AC1: the fixtures keep the captured rows\' markers byte for byte', { skip: !fs.existsSync(CAPTURE) && 'capture run dir absent in this checkout' }, () => {
  const captured = JSON.parse(fs.readFileSync(CAPTURE, 'utf8'));
  const pick = (r) => Object.fromEntries(MARKER_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(r, k)).map((k) => [k, r[k]]));
  for (const c of ['a', 'g', 'h']) {
    assert.deepStrictEqual(fixture(c).map(pick), captured[c].map(pick), c);
  }
  assert.deepStrictEqual(pick(fixture('a')[0]), pick(captured.a[0]));
});

// --- typed

test('AC18.1: the captured (a) row answers typed', (t) => {
  assert.deepStrictEqual(scenario(t, fixture('a')), TYPED_A);
});

test('AC18.1: (a) beside a task-notification row and tool-result rows of its promptId answers typed', (t) => {
  const base = { type: 'user', promptId: ID.a, sessionId: T_SESSION, timestamp: AT_A, isSidechain: false };
  const toolResult = (id) => ({ ...base, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
  const notification = { ...base, origin: { kind: 'task-notification' }, message: { role: 'user', content: '<task-notification>done</task-notification>' } };
  assert.deepStrictEqual(scenario(t, [notification, toolResult('toolu_1'), ...fixture('a'), toolResult('toolu_2')]), TYPED_A);
});

test('AC18.1: (a) with promptSource "typed" answers typed', (t) => {
  assert.deepStrictEqual(scenario(t, [aRow({ promptSource: 'typed' })]), TYPED_A);
});

test('AC18.1: a projects directory that is a symlink is read', (t) => {
  const ctx = ctxOf(t);
  const store = path.join(ctx.root, 'store');
  fs.mkdirSync(path.join(store, SLUG), { recursive: true });
  fs.writeFileSync(path.join(store, SLUG, `${T_SESSION}.jsonl`), toJsonl(fixture('a')));
  fs.symlinkSync(store, path.join(ctx.configDir, 'projects'), 'dir');
  point(ctx);
  assert.deepStrictEqual(check(ctx), TYPED_A);
});

test('AC18.1: now as epoch milliseconds answers as the Date does', (t) => {
  assert.deepStrictEqual(scenario(t, fixture('a'), { over: { now: Date.parse(NOW) } }), TYPED_A);
});

test('AC18.1: an empty CLAUDE_CONFIG_DIR falls back to <homeDir>/.claude', (t) => {
  const ctx = ctxOf(t);
  writeTranscript(path.join(ctx.root, '.claude'), SLUG, `${T_SESSION}.jsonl`, fixture('a'));
  point(ctx);
  assert.deepStrictEqual(check(ctx, { env: { CLAUDE_CODE_SESSION_ID: T_SESSION, CLAUDE_CONFIG_DIR: '' } }), TYPED_A);
});

test('AC18.1: a row and a pointer exactly at the bound and exactly at now still answer typed', (t) => {
  const edge = new Date(Date.parse(NOW) - BOUND_MS).toISOString();
  assert.deepStrictEqual(scenario(t, [aRow({ timestamp: edge })], { at: edge }), TYPED_A);
  assert.deepStrictEqual(scenario(t, [aRow({ timestamp: NOW })], { at: NOW }), TYPED_A);
});

test('AC18.8: a working directory whose slug is not the transcript\'s directory still finds the file', (t) => {
  const other = tmp(t);
  assert.notStrictEqual(slugForCwd(process.cwd()), SLUG);
  assert.notStrictEqual(slugForCwd(other), SLUG);
  const ctx = ctxOf(t, fixture('a'));
  point(ctx);
  const env = { CLAUDE_CODE_SESSION_ID: T_SESSION, CLAUDE_CONFIG_DIR: ctx.configDir, PWD: other };
  assert.deepStrictEqual(check(ctx, { env, cwd: other }), TYPED_A);
});

// --- not-typed

test('AC18.2: the captured (g) row answers not-typed', (t) => {
  assert.deepStrictEqual(scenario(t, fixture('g'), { promptId: ID.g, at: fixture('g')[0].timestamp }), none('not-typed'));
});

test('AC18.2: the captured (h) row answers not-typed', (t) => {
  assert.deepStrictEqual(scenario(t, fixture('h'), { promptId: ID.h, at: fixture('h')[0].timestamp }), none('not-typed'));
});

const NOT_TYPED_VARIANTS = [
  ['turnOrigin absent', (r) => { delete r.turnOrigin; }],
  ['turnOrigin "scheduled"', (r) => { r.turnOrigin = 'scheduled'; }],
  ['turnOrigin "peer"', (r) => { r.turnOrigin = 'peer'; }],
  ['turnOrigin "Human"', (r) => { r.turnOrigin = 'Human'; }],
  ['turnOrigin "human "', (r) => { r.turnOrigin = 'human '; }],
  ['turnOrigin true', (r) => { r.turnOrigin = true; }],
  ['origin absent', (r) => { delete r.origin; }],
  ['origin a string', (r) => { r.origin = 'human'; }],
  ['origin kind "peer"', (r) => { r.origin = { kind: 'peer' }; }],
  ['origin kind "task-notification"', (r) => { r.origin = { kind: 'task-notification' }; }],
  ['isMeta true', (r) => { r.isMeta = true; }],
  ['promptSource "system"', (r) => { r.promptSource = 'system'; }],
  ['promptSource "queued"', (r) => { r.promptSource = 'queued'; }],
  ['promptSource "sdk"', (r) => { r.promptSource = 'sdk'; }],
  ['promptSource "other"', (r) => { r.promptSource = 'other'; }],
  ['scheduledTaskId added', (r) => { r.scheduledTaskId = 'test-task'; }],
  ['scheduledFireId added', (r) => { r.scheduledFireId = 'test-fire-0001'; }],
  ['wakeupSource added', (r) => { r.wakeupSource = 'loop_wakeup'; }],
  ['queueSkipSlashCommands added', (r) => { r.queueSkipSlashCommands = true; }],
];

for (const [label, mutate] of NOT_TYPED_VARIANTS) {
  test(`AC18.2: (a) with ${label} answers not-typed`, (t) => {
    const row = aRow();
    mutate(row);
    assert.deepStrictEqual(scenario(t, [row]), none('not-typed'));
  });
}

test('AC18.2: a pointer a delivered line overwrote answers not-typed though the earlier (a) row stays', (t) => {
  const ctx = ctxOf(t, [...fixture('a'), ...fixture('h')]);
  point(ctx);
  assert.deepStrictEqual(check(ctx), TYPED_A);
  point(ctx, ID.h, fixture('h')[0].timestamp);
  assert.deepStrictEqual(check(ctx), none('not-typed'));
});

// --- other-command

const OTHER_COMMAND_CONTENT = [
  ['a human command row for /claude-tweaks:flow #3', COMMAND('claude-tweaks:flow', '#3')],
  ['a dispatch command for #13 when the record is 3', COMMAND('claude-tweaks:dispatch', '#13')],
  ['arguments "#3 --budget 2"', COMMAND('claude-tweaks:dispatch', '#3 --budget 2')],
  ['two lines of arguments', COMMAND('claude-tweaks:dispatch', '#3\n#3')],
  ['no <command-args> tag', '<command-message>claude-tweaks:dispatch</command-message>\n<command-name>/claude-tweaks:dispatch</command-name>'],
  ['arguments ending in a carriage return ("#3\\r")', COMMAND('claude-tweaks:dispatch', '#3\r')],
  ['arguments with surrounding whitespace (" #3 ")', COMMAND('claude-tweaks:dispatch', ' #3 ')],
];

for (const [label, content] of OTHER_COMMAND_CONTENT) {
  test(`AC18.3: ${label} answers other-command`, (t) => {
    assert.deepStrictEqual(scenario(t, [aRow({ message: { role: 'user', content } })]), none('other-command'));
  });
}

test('AC18.3: a plain-text human row (promptSource "typed") holding the command line answers other-command', (t) => {
  const row = aRow({ promptSource: 'typed', message: { role: 'user', content: '/claude-tweaks:dispatch #3' } });
  assert.deepStrictEqual(scenario(t, [row]), none('other-command'));
});

// --- expired

const EXPIRED_STAMPS = [
  ['older than the bound', new Date(Date.parse(NOW) - BOUND_MS - 1).toISOString()],
  ['later than now', new Date(Date.parse(NOW) + 1).toISOString()],
  ['unparseable', 'not a time'],
];

for (const [label, timestamp] of EXPIRED_STAMPS) {
  test(`AC18.4: (a) with a timestamp ${label} answers expired`, (t) => {
    assert.deepStrictEqual(scenario(t, [aRow({ timestamp })]), none('expired'));
  });
}

test('AC4: a pointer at later than now answers expired', (t) => {
  assert.deepStrictEqual(scenario(t, fixture('a'), { at: new Date(Date.parse(NOW) + 1).toISOString() }), none('expired'));
});

test('AC4: a pointer at older than the bound answers expired', (t) => {
  assert.deepStrictEqual(scenario(t, fixture('a'), { at: new Date(Date.parse(NOW) - BOUND_MS - 1).toISOString() }), none('expired'));
});

// --- no-prompt-row

const NO_PROMPT_ROW = [
  ['an empty transcript', ''],
  ['no row with the prompt id', toJsonl(fixture('a').map((r) => ({ ...r, promptId: 'test-prompt-0zzz' })))],
  ['only tool-result rows with it', toJsonl([{ type: 'user', promptId: ID.a, sessionId: T_SESSION, timestamp: AT_A, isSidechain: false, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] } }])],
  ['only isSidechain true rows with it', toJsonl(fixture('a').map((r) => ({ ...r, isSidechain: true })))],
  ['only rows of another session', toJsonl(fixture('a').map((r) => ({ ...r, sessionId: 'test-session-0002' })))],
  ['the matching line cut off mid-JSON', JSON.stringify(fixture('a')[0]).slice(0, 120) + '\n'],
];

for (const [label, body] of NO_PROMPT_ROW) {
  test(`AC18.5: ${label} answers no-prompt-row`, (t) => {
    assert.deepStrictEqual(scenario(t, body), none('no-prompt-row'));
  });
}

// --- no-transcript

function noTranscript(t, build) {
  const ctx = ctxOf(t);
  build(ctx);
  point(ctx);
  return check(ctx);
}

test('AC18.6: no file for the session id answers no-transcript', (t) => {
  assert.deepStrictEqual(noTranscript(t, (ctx) => fs.mkdirSync(path.join(ctx.configDir, 'projects', SLUG), { recursive: true })), none('no-transcript'));
});

test('AC18.6: two files under two project directories answer no-transcript', (t) => {
  assert.deepStrictEqual(noTranscript(t, (ctx) => {
    writeTranscript(ctx.configDir, SLUG, `${T_SESSION}.jsonl`, fixture('a'));
    writeTranscript(ctx.configDir, '-other-dir', `${T_SESSION}.jsonl`, fixture('a'));
  }), none('no-transcript'));
});

test('AC18.6: {id}.jsonl as a symlink resolving outside the projects root answers no-transcript', (t) => {
  assert.deepStrictEqual(noTranscript(t, (ctx) => {
    const outside = path.join(ctx.root, `${T_SESSION}.jsonl`);
    fs.writeFileSync(outside, toJsonl(fixture('a')));
    fs.mkdirSync(path.join(ctx.configDir, 'projects', SLUG), { recursive: true });
    fs.symlinkSync(outside, path.join(ctx.configDir, 'projects', SLUG, `${T_SESSION}.jsonl`));
  }), none('no-transcript'));
});

test('AC18.6: {id}.jsonl as a symlink to another session\'s file inside the root answers no-transcript', (t) => {
  assert.deepStrictEqual(noTranscript(t, (ctx) => {
    const other = writeTranscript(ctx.configDir, SLUG, 'test-session-0002.jsonl', fixture('a'));
    fs.symlinkSync(other, path.join(ctx.configDir, 'projects', SLUG, `${T_SESSION}.jsonl`));
  }), none('no-transcript'));
});

test('AC18.6: {id}.jsonl as a dangling symlink answers no-transcript', (t) => {
  assert.deepStrictEqual(noTranscript(t, (ctx) => {
    fs.mkdirSync(path.join(ctx.configDir, 'projects', SLUG), { recursive: true });
    fs.symlinkSync(path.join(ctx.root, 'gone.jsonl'), path.join(ctx.configDir, 'projects', SLUG, `${T_SESSION}.jsonl`));
  }), none('no-transcript'));
});

test('AC18.6: {id}.jsonl as a directory answers no-transcript', (t) => {
  assert.deepStrictEqual(noTranscript(t, (ctx) => {
    fs.mkdirSync(path.join(ctx.configDir, 'projects', SLUG, `${T_SESSION}.jsonl`), { recursive: true });
  }), none('no-transcript'));
});

test('AC18.6: a missing projects directory answers no-transcript', (t) => {
  assert.deepStrictEqual(noTranscript(t, () => {}), none('no-transcript'));
});

test('AC18.6: a file named x-{id}.jsonl answers no-transcript', (t) => {
  assert.deepStrictEqual(noTranscript(t, (ctx) => writeTranscript(ctx.configDir, SLUG, `x-${T_SESSION}.jsonl`, fixture('a'))), none('no-transcript'));
});

test('AC18.6: a project directory named {id}.jsonl answers no-transcript', (t) => {
  assert.deepStrictEqual(noTranscript(t, (ctx) => writeTranscript(ctx.configDir, `${T_SESSION}.jsonl`, 'transcript.jsonl', fixture('a'))), none('no-transcript'));
});

test('AC18.6: a located entry whose path is not a string answers no-transcript, never throws', (t) => {
  for (const found of [[{ path: 42 }], [{}], [null]]) {
    const locate = () => found;
    assert.deepStrictEqual(scenario(t, fixture('a'), { over: { locate } }), none('no-transcript'), JSON.stringify(found));
  }
});

// --- transcript-unreadable

test('AC18.7: a read failure after the file was located answers transcript-unreadable', (t) => {
  const calls = [];
  const readRows = (file, promptId) => {
    calls.push([path.basename(file), promptId]);
    throw Object.assign(new Error('read failed'), { code: 'EIO' });
  };
  assert.deepStrictEqual(scenario(t, fixture('a'), { over: { readRows } }), none('transcript-unreadable'));
  assert.deepStrictEqual(calls, [[`${T_SESSION}.jsonl`, ID.a]]);
});

// --- session id (AC4)

test('AC4: a reader with no session id answers no-session-id', (t) => {
  const ctx = ctxOf(t, fixture('a'));
  point(ctx);
  assert.deepStrictEqual(check(ctx, { env: { CLAUDE_CONFIG_DIR: ctx.configDir } }), none('no-session-id'));
  assert.deepStrictEqual(check(ctx, { env: undefined }), none('no-session-id'));
});

for (const bad of ['..', '../x', 'a/b', 'a/', 'a%2fb', '', 'x'.repeat(65)]) {
  test(`AC4: the session id ${bad.length > 8 ? `of ${bad.length} characters` : JSON.stringify(bad)} answers no-session-id`, (t) => {
    const ctx = ctxOf(t, fixture('a'));
    point(ctx);
    assert.deepStrictEqual(check(ctx, { env: { CLAUDE_CODE_SESSION_ID: bad, CLAUDE_CONFIG_DIR: ctx.configDir } }), none('no-session-id'));
  });
}

test('AC4: the pointer\'s own refusals pass through as the check\'s reason', (t) => {
  assert.deepStrictEqual(check(ctxOf(t, fixture('a'))), none('no-pointer'));
  const other = ctxOf(t, fixture('a'));
  plant(other.tmpdir, valid({ 3: { promptId: ID.a, at: AT_A } }, 'test-session-0002'), T_SESSION);
  assert.deepStrictEqual(check(other), none('pointer-other-session'));
  const broken = ctxOf(t, fixture('a'));
  plant(broken.tmpdir, '{"v":1,', T_SESSION);
  assert.deepStrictEqual(check(broken), none('pointer-unreadable'));
});

test('AC18.4: (a) with a timestamp that is not a string answers expired', (t) => {
  assert.deepStrictEqual(scenario(t, [aRow({ timestamp: [AT_A] })]), none('expired'));
});

// --- the exported row helpers

test('isCandidateRow keeps only a main-thread user row of this prompt and session that is not a tool result', () => {
  const key = { sessionId: T_SESSION, promptId: ID.a };
  assert.strictEqual(isCandidateRow(fixture('a')[0], key), true);
  assert.strictEqual(isCandidateRow(fixture('a')[1], key), true);
  const bad = [
    null, [], 'row',
    aRow({ type: 'assistant' }),
    aRow({ promptId: ID.g }),
    aRow({ sessionId: 'test-session-0002' }),
    aRow({ isSidechain: true }),
    aRow({ message: { role: 'assistant', content: 'x' } }),
    aRow({ message: null }),
    aRow({ message: { role: 'user', content: [{ type: 'text', text: 'x' }, { type: 'tool_result', content: 'ok' }] } }),
  ];
  for (const row of bad) assert.strictEqual(isCandidateRow(row, key), false, JSON.stringify(row));
});

test('rowMarkersPass accepts isMeta false and promptSource typed, and the captured (a) row only among the captures', () => {
  assert.strictEqual(rowMarkersPass(fixture('a')[0]), true);
  assert.strictEqual(rowMarkersPass(aRow({ isMeta: false, promptSource: 'typed' })), true);
  assert.strictEqual(rowMarkersPass(aRow({ isMeta: 'false' })), false);
  assert.strictEqual(rowMarkersPass(aRow({ origin: null })), false);
  assert.strictEqual(rowMarkersPass(aRow({ origin: ['human'] })), false);
  assert.strictEqual(rowMarkersPass(null), false);
  for (const c of ['g', 'h']) for (const row of fixture(c)) assert.strictEqual(rowMarkersPass(row), false, c);
});

test('rowCommandNames reads the whole three-tag form and the record list', () => {
  const row = (args) => aRow({ message: { role: 'user', content: COMMAND('claude-tweaks:dispatch', args) } });
  assert.strictEqual(rowCommandNames(fixture('a')[0], 3), true);
  assert.strictEqual(rowCommandNames(fixture('a')[0], 4), false);
  assert.strictEqual(rowCommandNames(row('resume #3'), 3), true);
  assert.strictEqual(rowCommandNames(row('#12,#3'), 3), true);
  assert.strictEqual(rowCommandNames(row(''), 3), false);
  for (const args of ['#3\r', '#3\r ', '  #3 \r ', '#3 ', ' #3', '#3\t', ' #3']) {
    assert.strictEqual(rowCommandNames(row(args), 3), false, JSON.stringify(args));
  }
  const whole = COMMAND('claude-tweaks:dispatch', '#3');
  // Same-length head and tail changes keep the argument slice at '#3', so only
  // the whole-prefix and whole-suffix checks refuse them.
  const sameLength = [
    whole.replace('<command-message>claude-tweaks:dispatch', '<command-message>claude-tweaks:dispatcx'),
    whole.replace('<command-name>/claude-tweaks:dispatch', '<command-name>/claude-tweaks:flowxxxx'),
    whole.replace('</command-args>', '</command-argz>'),
  ];
  for (const content of [...sameLength, ` ${whole}`, `${whole}\n`, `x${whole}`, `${whole} `, whole.replace(/\n/g, '\r\n')]) {
    assert.strictEqual(rowCommandNames(aRow({ message: { role: 'user', content } }), 3), false, JSON.stringify(content));
  }
  assert.strictEqual(rowCommandNames(aRow({ message: { role: 'user', content: [{ type: 'text', text: whole }] } }), 3), false);
  assert.strictEqual(rowCommandNames(null, 3), false);
});

// The verdicts on huge arguments; their timing is perf/typed-command-linearity.test.js's.
test('rowCommandNames answers on huge argument strings', () => {
  const unterminated = COMMAND('claude-tweaks:dispatch', '#3,'.repeat(200000)).slice(0, -'</command-args>'.length);
  assert.strictEqual(rowCommandNames(aRow({ message: { role: 'user', content: unterminated } }), 3), false);
  const list = COMMAND('claude-tweaks:dispatch', `${'#4,'.repeat(200000)}#3`);
  assert.strictEqual(rowCommandNames(aRow({ message: { role: 'user', content: list } }), 3), true);
});

test('loading typed-command.js loads neither the transcript reader nor the rule', () => {
  const mod = path.join(REPO, 'plugin', 'bin', 'lib', 'issues', 'typed-command.js');
  const probe = 'require(process.argv[1]); const ks = Object.keys(require.cache);'
    + 'process.stdout.write(JSON.stringify(ks.map((k) => require("path").basename(k))))';
  const r = spawnSync(process.execPath, ['-e', probe, mod], { encoding: 'utf8', windowsHide: true });
  assert.strictEqual(r.status, 0, r.stderr);
  const loaded = JSON.parse(r.stdout);
  assert.ok(loaded.includes('typed-command.js'));
  for (const name of ['transcript.js', 'build-authority.js', 'grouping.js']) assert.ok(!loaded.includes(name), name);
});
