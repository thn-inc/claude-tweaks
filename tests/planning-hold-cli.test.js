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
  assert.equal(call(['--comments-file', '--help']).code, 2);
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

test('real process: prints the JSON line and exits 0', () => {
  const r = spawnCli(BIN, ['--comments-file', jsonFile([])], { cwd: TMP });
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.stdout).verdict, 'not-held');
});
