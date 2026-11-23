'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runCliSync, spawnCli } = require('./helpers/run-cli');
const { readText } = require('./helpers/read-skill');

// #6059: bin/planning-hold.js — in-process over tmp files, plus one real-process smoke.
const BIN = path.join(__dirname, '..', 'plugin', 'bin', 'planning-hold.js');
const PLANNING_MD = path.join(__dirname, '..', 'plugin', 'skills', 'specify', 'planning.md');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'planning-hold-cli-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

let seq = 0;
function jsonFile(value) {
  const file = path.join(TMP, `c${seq++}.json`);
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
}

// The `## Hold` template fence of planning.md, placeholders replaced.
function realTemplate() {
  const text = readText(PLANNING_MD);
  const hold = text.slice(text.indexOf('\n## Hold'));
  const fence = hold.match(/```\n(<!-- needs-decision: specify -->[\s\S]*?)\n```/);
  assert.ok(fence, 'the Hold template fence is present');
  return fence[1]
    .replace('{Q1: recommended reading; Q2: recommended reading; …}', 'the recommended readings')
    .replace('{k}', '1')
    .replace('{n}', '7')
    .replace('{question text}', 'Which store?')
    .replaceAll('{recommended reading}', 'Use the ref')
    .replace('{other reading}', 'Use a file');
}

const comment = { id: 'IC_a', url: 'https://x/1', authorAssociation: 'OWNER', createdAt: '2026-11-22T10:00:00Z', body: '' };
const call = (argv, opts = {}) => runCliSync(BIN, argv, { cwd: TMP, ...opts });

test('gh shape and MCP-array shape give the same JSON line', () => {
  const body = realTemplate();
  const gh = call(['--comments-file', jsonFile({ comments: [{ ...comment, body }] })]);
  const mcp = call(['--comments-file', jsonFile([{ ...comment, body }])]);
  assert.equal(gh.code, 0);
  assert.equal(mcp.code, 0);
  assert.equal(gh.stdout, mcp.stdout);
  assert.equal(gh.stdout.split('\n').filter(Boolean).length, 1);
});

test('the real planning.md hold template parses as held with one question', () => {
  const r = call(['--comments-file', jsonFile({ comments: [{ ...comment, body: realTemplate() }] })]);
  const out = JSON.parse(r.stdout);
  assert.equal(out.verdict, 'held');
  assert.equal(out.questions.length, 1);
  assert.deepEqual(out.questions[0], { question: 'Which store?', options: ['Use the ref', 'Use a file'], recommended: 'Use the ref' });
  assert.equal(out.comment.id, 'IC_a');
  assert.deepEqual(out.supersededHolds, []);
});

test('a not-held verdict still exits 0', () => {
  const r = call(['--comments-file', jsonFile({ comments: [] })]);
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.stdout).reason, 'no-decision-comment');
});

test('a relative path resolves against the injected cwd', () => {
  const file = jsonFile([]);
  const r = call(['--comments-file', path.basename(file)]);
  assert.equal(r.code, 0);
});

test('an unreadable file exits 1 naming the argument spelling', () => {
  const r = call(['--comments-file', 'no-such-file.json']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /--comments-file: no-such-file\.json/);
});

test('not JSON, or not a comments list, exits 1', () => {
  assert.equal(call(['--comments-file', jsonFile('{not json')]).code, 1);
  assert.equal(call(['--comments-file', jsonFile({ nope: true })]).code, 1);
  assert.equal(call(['--comments-file', jsonFile('null')]).code, 1);
});

test('--comments-file with no value exits 2', () => {
  assert.equal(call(['--comments-file']).code, 2);
  assert.equal(call(['--comments-file', '--other']).code, 2);
});

test('an unknown flag or a missing flag exits 2', () => {
  assert.equal(call(['--bogus']).code, 2);
  assert.equal(call([]).code, 2);
});

test('--help exits 0 and prints usage', () => {
  const r = call(['--help']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /usage: planning-hold\.js/);
});

test('L3: --help or -h anywhere in argv short-circuits to usage and exit 0', () => {
  for (const argv of [['--bogus', '--help'], ['--help', '--bogus'], ['--comments-file', '--help'], ['--comments-file', 'x.json', '--comments-file', 'y.json', '-h'], ['-h', '--comments-file']]) {
    const r = call(argv);
    assert.equal(r.code, 0, argv.join(' '));
    assert.match(r.stdout, /usage: planning-hold\.js/, argv.join(' '));
    assert.equal(r.stderr, '', argv.join(' '));
  }
});

test('real process: prints the JSON line and exits 0', () => {
  const r = spawnCli(BIN, ['--comments-file', jsonFile([])], { cwd: TMP });
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.stdout).verdict, 'not-held');
});

// #6100: the readback verb.
function textFile(s) {
  const file = path.join(TMP, `t${seq++}.txt`);
  fs.writeFileSync(file, s);
  return file;
}
const PLAN = 'Plan: refs/claude-tweaks/plans/7 ' + 'a'.repeat(40) + ' spec-sha256:' + 'b'.repeat(64);
const resolvedHold = {
  id: 'IC_h',
  body: '**Resolved:** answered via /claude-tweaks:specify — 2026-11-23\n<!-- needs-decision: specify -->\nold',
  authorAssociation: 'OWNER',
  createdAt: '2026-11-23T10:00:00Z',
};
const recBody = `Overview text\n${PLAN}\n\n## Overview\nx\n`;

// A passing answered-branch fixture; each key overrides the matching file or flag.
function rbArgs(o = {}) {
  const readback = o.readback ?? { labels: [{ name: 'ready' }], body: recBody, comments: [resolvedHold] };
  const a = ['readback', '--record', '7', '--branch', o.branch ?? 'answered'];
  a.push('--readback-file', jsonFile(readback));
  a.push('--body-file', textFile(recBody));
  if (o.labels !== undefined) a.push('--labels-file', jsonFile(o.labels));
  a.push('--plan-line-file', textFile(`${PLAN}\n`));
  a.push('--plan-check-file', o.planCheck !== undefined ? (typeof o.planCheck === 'string' ? textFile(o.planCheck) : jsonFile(o.planCheck)) : jsonFile({ valid: true, failed: null }));
  a.push('--resolved-ids', 'IC_h', '--answered', '2');
  if ((o.branch ?? 'answered') === 'answered') a.push('--other-unresolved', '0');
  if (o.branch === 're-held') a.push('--reheld-file', jsonFile(['Retry?']));
  return a;
}
const without = (argv, flag) => { const i = argv.indexOf(flag); return argv.filter((_, j) => j !== i && j !== i + 1); };

test('readback: gh-shape readback file, answered -> ready verdict, exit 0', () => {
  const r = call(rbArgs());
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.split('\n').filter(Boolean).length, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.next, 'ready');
  assert.equal(out.ok, true);
});

test('readback: a failed assertion still exits 0', () => {
  const r = call(rbArgs({ planCheck: { valid: false, failed: 'hash' } }));
  assert.equal(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.deepEqual(out.failed, ['plan-check']);
});

test('readback: labels file as strings and readback object labels as {name}', () => {
  const kept = rbArgs({ branch: 'kept', readback: [resolvedHold], labels: ['needs:decision'] });
  const r = call(kept);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).ok, true);
  const named = call(rbArgs({ branch: 'kept', readback: { labels: [{ name: 'needs:decision' }], body: recBody, comments: [resolvedHold] } }));
  assert.equal(named.code, 0, named.stderr);
  assert.equal(JSON.parse(named.stdout).ok, true);
  const none = call(rbArgs({ branch: 'kept', readback: { comments: [resolvedHold] } }));
  assert.equal(none.code, 1);
  assert.match(none.stderr, /no labels/);
});

test('readback: --labels-file wins over the readback object labels', () => {
  const readback = { labels: [{ name: 'needs:decision' }], body: recBody, comments: [resolvedHold] };
  const r = call(rbArgs({ readback, labels: ['ready'] }));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).ok, true);
});

test('readback: every --resolved-ids element is checked', () => {
  const argv = rbArgs();
  argv[argv.indexOf('--resolved-ids') + 1] = 'IC_h,IC_missing';
  const r = call(argv);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).failed, ['resolved']);
});

test('readback: plan-check file empty or not JSON -> failed assertion, exit 0', () => {
  for (const planCheck of ['', '{oops']) {
    const r = call(rbArgs({ planCheck }));
    assert.equal(r.code, 0, planCheck);
    assert.ok(JSON.parse(r.stdout).failed.includes('plan-check'), planCheck);
  }
});

test('readback: relative paths resolve against the injected cwd', () => {
  const argv = rbArgs({ labels: ['ready'] });
  const files = new Set(['--readback-file', '--body-file', '--labels-file', '--plan-line-file', '--plan-check-file']);
  const rel = argv.map((a, i) => (files.has(argv[i - 1]) ? path.basename(a) : a));
  const r = call(rel);
  assert.equal(r.code, 0, r.stderr);
});

test('readback: re-held relative paths, --reheld-file included, resolve against the injected cwd', () => {
  const argv = rbArgs({ branch: 're-held', readback: { labels: ['needs:decision'], body: recBody, comments: [resolvedHold, { ...comment, id: 'IC_f', createdAt: '2026-11-23T11:00:00Z', body: realTemplate() }] } });
  argv[argv.indexOf('--reheld-file') + 1] = jsonFile(['Which store?']);
  const files = new Set(['--readback-file', '--body-file', '--plan-line-file', '--plan-check-file', '--reheld-file']);
  const rel = argv.map((a, i) => (files.has(argv[i - 1]) ? path.basename(a) : a));
  assert.ok(rel.includes(path.basename(argv[argv.indexOf('--reheld-file') + 1])));
  const r = call(rel);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).ok, true);
});

test('readback: a nonexistent --plan-check-file is a failed plan-check assertion, exit 0', () => {
  const argv = rbArgs();
  argv[argv.indexOf('--plan-check-file') + 1] = 'no-such-file.json';
  const r = call(argv);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(JSON.parse(r.stdout).failed.includes('plan-check'));
});

test('readback: a non-JSON --readback-file exits 1 naming --readback-file', () => {
  const argv = rbArgs();
  argv[argv.indexOf('--readback-file') + 1] = jsonFile('{oops');
  const r = call(argv);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /--readback-file: /);
});

test('readback: unreadable payload files exit 1 naming the argument spelling', () => {
  const flags = ['--readback-file', '--body-file', '--plan-line-file', '--labels-file'];
  for (const flag of flags) {
    const argv = rbArgs({ labels: ['ready'] });
    argv[argv.indexOf(flag) + 1] = 'no-such-file.json';
    const r = call(argv);
    assert.equal(r.code, 1, flag);
    assert.match(r.stderr, new RegExp(`${flag}: no-such-file\\.json`), flag);
  }
  const argv = rbArgs({ branch: 're-held', readback: [resolvedHold], labels: ['needs:decision'] });
  argv[argv.indexOf('--reheld-file') + 1] = 'no-such-file.json';
  const r = call(argv);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /--reheld-file: no-such-file\.json/);
});

test('readback: malformed payloads exit 1', () => {
  assert.equal(call(rbArgs({ readback: { nope: 1 } })).code, 1);
  assert.equal(call(rbArgs({ labels: { a: 1 } })).code, 1);
  assert.equal(call(rbArgs({ labels: [3] })).code, 1);
  const emptyLine = rbArgs();
  emptyLine[emptyLine.indexOf('--plan-line-file') + 1] = textFile('\n');
  assert.equal(call(emptyLine).code, 1);
  const badReheld = rbArgs({ branch: 're-held', readback: [resolvedHold], labels: ['needs:decision'] });
  badReheld[badReheld.indexOf('--reheld-file') + 1] = jsonFile({ a: 1 });
  assert.equal(call(badReheld).code, 1);
  const nonString = rbArgs({ branch: 're-held', readback: [resolvedHold], labels: ['needs:decision'] });
  nonString[nonString.indexOf('--reheld-file') + 1] = jsonFile(['Retry?', 3]);
  assert.equal(call(nonString).code, 1);
});

test('readback: argv errors exit 2', () => {
  const set = (argv, flag, v) => { const a = argv.slice(); a[a.indexOf(flag) + 1] = v; return a; };
  const cases = {
    'missing --record': [without(rbArgs(), '--record'), /^planning-hold\.js: --record is required$/m],
    '--branch bogus': [set(rbArgs(), '--branch', 'bogus'), /^planning-hold\.js: --branch must be one of answered, kept, re-held$/m],
    '--record 0': [set(rbArgs(), '--record', '0'), /^planning-hold\.js: --record must be a positive integer$/m],
    '--record abc': [set(rbArgs(), '--record', 'abc'), /^planning-hold\.js: --record must be a positive integer$/m],
    '--other-unresolved x': [set(rbArgs(), '--other-unresolved', 'x'), /^planning-hold\.js: --other-unresolved must be a non-negative integer$/m],
    '--answered -1': [set(rbArgs(), '--answered', '-1'), /^planning-hold\.js: --answered must be a non-negative integer$/m],
    '--resolved-ids a,,b': [set(rbArgs(), '--resolved-ids', 'a,,b'), /^planning-hold\.js: --resolved-ids has an empty element$/m],
    '--other-unresolved with kept': [[...rbArgs({ branch: 'kept' }), '--other-unresolved', '1'], /^planning-hold\.js: --other-unresolved is allowed only with --branch answered$/m],
    'answered without --other-unresolved': [without(rbArgs(), '--other-unresolved'), /^planning-hold\.js: --other-unresolved is required with --branch answered$/m],
    're-held without --reheld-file': [without(rbArgs({ branch: 're-held' }), '--reheld-file'), /^planning-hold\.js: --reheld-file is required with --branch re-held$/m],
    '--reheld-file with answered': [[...rbArgs(), '--reheld-file', jsonFile([])], /^planning-hold\.js: --reheld-file is allowed only with --branch re-held$/m],
    'repeated --body-file': [[...rbArgs(), '--body-file', 'x'], /^planning-hold\.js: --body-file given more than once$/m],
    'unknown --bogus': [[...rbArgs(), '--bogus', 'x'], /^planning-hold\.js: unknown argument: --bogus$/m],
  };
  for (const [name, [argv, message]] of Object.entries(cases)) {
    const r = call(argv);
    assert.equal(r.code, 2, name);
    assert.match(r.stderr, message, name);
  }
});

test('readback: --help anywhere prints both usage lines', () => {
  for (const argv of [['readback', '--help'], ['readback', '--record', '-h']]) {
    const r = call(argv);
    assert.equal(r.code, 0, argv.join(' '));
    assert.match(r.stdout, /planning-hold\.js readback --record/);
    assert.match(r.stdout, /--comments-file <file>/);
  }
});

test('real process: readback prints the JSON line', () => {
  const r = spawnCli(BIN, rbArgs(), { cwd: TMP });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).branch, 'answered');
});
