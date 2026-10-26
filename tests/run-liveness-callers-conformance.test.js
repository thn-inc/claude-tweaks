// tests/run-liveness-callers-conformance.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');
const { readText } = require('./helpers/read-skill');

// #4419-#4421 (under #3979) removed private liveness probes from four plugin/bin
// callers. Each now answers "is this run live?" through a sanctioned path, not a
// probe of its own. This scan fails if a retired probe comes back in any of the four.
//
// Banned, in the four scanned files (SCANNED, in order):
//   - the names isDeadRunDir, lockVerdict, isPidAlive, lockInUse and lastCommitMs;
//   - a `process.kill(` call;
//   - a git commit-recency read: a git argv with `log` plus `-1`, `-n`/`--max-count`,
//     or a `%ct`/`%cI`/`committerdate` format, or a string literal holding the same;
//   - a read of a worktree entry's `.locked` or `.lockReason` field.
//
// Allowlist, named here and never matched: the sanctioned replacements runLiveness,
// blocksResume, the runVerdict hook, and unresumableState (#4419's renamed
// precondition helper).
//
// Matching runs over stripComments(raw) in its default literal-keeping mode, so a
// banned name in a comment does not fail the scan, while a command string such as
// `git log -1` stays visible. A mis-parse by the stripper is an offender, not a clean
// file (stripperVerdict).
//
// Recall limits: a destructured `kill`, a `process['kill']` bracket form, a `{ locked }`
// destructure, and `rev-list`/`for-each-ref` recency reads are not matched. Code
// review is the backstop for those.

const REPO = path.join(__dirname, '..');
const SCANNED = [
  'plugin/bin/lib/hooks/run-dir-resolve.js',
  'plugin/bin/lib/hooks/resume-freshness.js',
  'plugin/bin/lib/flow/consolidated-pass.js',
  'plugin/bin/lib/reconcile/archive-merged.js',
];
const COMMIT_FORM = 'git commit-recency read';
const NAMES = /\b(isDeadRunDir|lockVerdict|isPidAlive|lockInUse|lastCommitMs)\b/g;
const PROCESS_KILL = /\bprocess\s*\.\s*kill\s*\(/g;
const ARGV = /\[[^\[\]]*\]/g;
const LITERAL = /(['"`])((?:\\.|(?!\1).)*)\1/g;
const RECENCY = /^(?:-1|-n|--max-count(?:=\d+)?|.*(?:%ct|%cI|committerdate).*)$/;
const LOG_WORD = /\blog\b/;
const STRING_RECENCY = /(?:^|\s)(?:-1|-n|--max-count)\b|%ct|%cI|committerdate/;
const FIELD = /\.\s*(locked|lockReason)\b/g;

function readEntries() {
  return SCANNED.map((rel) => ({ rel, raw: readText(path.join(REPO, rel)) }));
}

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length;
}

// Matches over already-stripped text. Returns [{ line, form }] sorted by line.
function hitsIn(src) {
  const hits = [];
  for (const m of src.matchAll(NAMES)) hits.push({ line: lineOf(src, m.index), form: m[1] });
  for (const m of src.matchAll(PROCESS_KILL)) hits.push({ line: lineOf(src, m.index), form: 'process.kill(' });
  for (const m of src.matchAll(FIELD)) hits.push({ line: lineOf(src, m.index), form: `.${m[1]}` });
  // A git argv array: `log` as one element, and a recency element among the others.
  const argvSeen = new Set();
  for (const m of src.matchAll(ARGV)) {
    const elems = [...m[0].matchAll(LITERAL)].map((q) => q[2]);
    if (elems.includes('log') && elems.some((e) => RECENCY.test(e))) {
      const line = lineOf(src, m.index);
      argvSeen.add(`${line} ${COMMIT_FORM}`);
      hits.push({ line, form: COMMIT_FORM });
    }
  }
  // A command string such as `git log -1 --format=%cI`, outside an argv array.
  for (const m of src.matchAll(LITERAL)) {
    if (!LOG_WORD.test(m[2]) || !STRING_RECENCY.test(m[2])) continue;
    const line = lineOf(src, m.index);
    if (argvSeen.has(`${line} ${COMMIT_FORM}`)) continue;
    hits.push({ line, form: COMMIT_FORM });
  }
  return hits.sort((a, b) => a.line - b.line);
}

// -> [{ line, form }] for every banned site in `raw`, sorted by line.
function bannedHits(raw) {
  return hitsIn(stripComments(raw));
}

// Offender strings for `entries`: `${rel}:${line} ${form}` per banned site, or
// `${rel}: ${message}` when the stripper mis-parsed the file.
function scan(entries) {
  const offenders = [];
  for (const { rel, raw } of entries) {
    const stripped = stripComments(raw);
    const verdict = stripperVerdict(raw, stripped);
    if (verdict !== 'ok') {
      offenders.push(`${rel}: ${STRIPPER_VERDICT_MESSAGES[verdict]}`);
      continue;
    }
    for (const { line, form } of hitsIn(stripped)) offenders.push(`${rel}:${line} ${form}`);
  }
  return offenders;
}

function assertNoRetiredProbes(entries) {
  assert.deepEqual(scan(entries), []);
}

test('AC1.1: no retired liveness probe in the four migrated callers', () => {
  assertNoRetiredProbes(readEntries());
});

test('floor: all four scanned files are read', () => {
  const entries = readEntries();
  assert.equal(entries.length, 4, `read ${entries.length} scanned files, expected 4`);
  for (const { rel, raw } of entries) {
    assert.ok(raw.length > 0, `${rel} read as empty: the scan would pass over nothing`);
  }
});

test('AC3.1: a banned name only in a comment does not fail the scan', () => {
  assert.deepEqual(bannedHits('// lockVerdict(x) and isPidAlive(p)\n/* process.kill(pid, 0) */\nconst ok = 1;'), []);
});

test('matcher self-test: banned names and primitives are flagged at their lines', () => {
  const planted = [
    'const v = lockVerdict(entry);', // 1
    'isDeadRunDir(dir);', // 2
    'if (isPidAlive(pid)) {}', // 3
    'const l = lockInUse(wt);', // 4
    'const t = lastCommitMs(wt);', // 5
    'process.kill(pid, 0);', // 6
    "runGit(['log', '--max-count=1', '--format=%ct']);", // 7
    'execSync(`git log -1 --format=%cI`);', // 8
    'const busy = entry.locked;', // 9
    'const why = e.lockReason;', // 10
    'const o = { locked: false };', // 11
    "runGit(['rev-parse', 'HEAD']);", // 12
    "const msg = 'log rotated';", // 13
    "runGit(['status', '-1']);", // 14
    "const m = 'lockVerdict failed';", // 15
  ].join('\n');
  assert.deepEqual(
    bannedHits(planted).map((h) => `${h.line}:${h.form}`),
    [
      '1:lockVerdict',
      '2:isDeadRunDir',
      '3:isPidAlive',
      '4:lockInUse',
      '5:lastCommitMs',
      '6:process.kill(',
      `7:${COMMIT_FORM}`,
      `8:${COMMIT_FORM}`,
      '9:.locked',
      '10:.lockReason',
      '15:lockVerdict',
    ],
  );
});

test('AC2.1: a multi-line argv commit-recency read is flagged at its opening line', () => {
  const planted = "x();\nrunGit([\n  'log',\n  '-n', '1',\n  '--format=%ct',\n]);";
  assert.deepEqual(bannedHits(planted).map((h) => `${h.line}:${h.form}`), [`2:${COMMIT_FORM}`]);
});

test('AC2.1: reintroducing a retired probe into a scratch copy names the file and the form', () => {
  const inject = (rel, appended) => readEntries().map((e) => (e.rel === rel ? { ...e, raw: e.raw + appended } : e));
  assert.throws(
    () => assertNoRetiredProbes(inject('plugin/bin/lib/hooks/resume-freshness.js', '\nlockVerdict(entry);\n')),
    /plugin\/bin\/lib\/hooks\/resume-freshness\.js:\d+ lockVerdict/,
  );
  assert.throws(
    () => assertNoRetiredProbes(inject('plugin/bin/lib/flow/consolidated-pass.js', '\nprocess.kill(pid, 0);\n')),
    /plugin\/bin\/lib\/flow\/consolidated-pass\.js:\d+ process\.kill\(/,
  );
  assert.throws(
    () => assertNoRetiredProbes(
      inject('plugin/bin/lib/reconcile/archive-merged.js', "\nrunGit(['log', '--max-count=1', '--format=%ct']);\n"),
    ),
    /plugin\/bin\/lib\/reconcile\/archive-merged\.js:\d+ git commit-recency read/,
  );
});

test('a comment-stripper mis-parse is reported as an offender, not passed as a clean file', () => {
  // The stripper's documented mis-parse: a regex after `)` is read as division.
  const planted = { rel: 'plugin/bin/lib/planted.js', raw: 'if (b) /"/.test(b); const c = "//"; lockVerdict(c);' };
  assert.equal(stripperVerdict(planted.raw, stripComments(planted.raw)), 'misparsed');
  assert.deepEqual(scan([planted]), [`${planted.rel}: ${STRIPPER_VERDICT_MESSAGES.misparsed}`]);
});

test('a live banned call after a fake comment opener in a string is still seen', () => {
  assert.deepEqual(bannedHits("const a = '/*';\nlockVerdict(x);").map((h) => h.line), [2]);
});
