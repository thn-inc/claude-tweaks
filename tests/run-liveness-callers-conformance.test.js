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

// Scoped rule: the two liveness tokens may appear in archive-merged.js only inside
// classifyRunDir, lastOwnEventMs, the import and export lists, and the constant's own
// declaration. Neither token may appear in the other three scanned files.
const ARCHIVE = 'plugin/bin/lib/reconcile/archive-merged.js';
const SCOPED = /\b(ownEventRecency|STALE_INTERRUPTED_TTL_MS)\b/g;
const SCOPED_DECL = /\bconst\s+STALE_INTERRUPTED_TTL_MS\s*=/g;
const REQUIRE_DESTRUCTURE = /\bconst\s*\{[^}]*\}\s*=\s*require\s*\([^)]*\)/g;
const MODULE_EXPORTS = /\bmodule\s*\.\s*exports\s*=\s*\{/g;
// Allowed scoped-token sites located in archive-merged.js at the commit that landed the
// scoped rule. Fewer means the matcher stopped matching: never lower this floor.
const SCOPED_SITE_FLOOR = 8;

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

// Index of the bracket closing the one at `openIdx`, or -1.
function matchClose(text, openIdx, open, close) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === open) depth += 1;
    else if (text[i] === close && --depth === 0) return i;
  }
  return -1;
}

// `function NAME(` through its body's matching `}`, over blank-mode text (so braces in
// literals do not count). Parens are matched first, so a default-param `{}` stays inside
// the signature. `name` is a plain identifier. Returns null when the name or a balanced
// close is missing.
function functionSpan(blankText, name) {
  const head = new RegExp(`\\bfunction\\s+${name}\\s*\\(`).exec(blankText);
  if (!head) return null;
  const paramsClose = matchClose(blankText, head.index + head[0].length - 1, '(', ')');
  if (paramsClose < 0) return null;
  const open = blankText.indexOf('{', paramsClose);
  if (open < 0) return null;
  const end = matchClose(blankText, open, '{', '}');
  return end < 0 ? null : { start: head.index, end };
}

// The index ranges [start, end) of archive-merged.js where a scoped token is allowed.
function allowedRegions(blank) {
  const regions = [];
  for (const name of ['classifyRunDir', 'lastOwnEventMs']) {
    const span = functionSpan(blank, name);
    if (span) regions.push([span.start, span.end + 1]);
  }
  for (const m of blank.matchAll(REQUIRE_DESTRUCTURE)) regions.push([m.index, m.index + m[0].length]);
  for (const m of blank.matchAll(SCOPED_DECL)) regions.push([m.index, m.index + m[0].length]);
  for (const m of blank.matchAll(MODULE_EXPORTS)) {
    const open = m.index + m[0].length - 1;
    const close = matchClose(blank, open, '{', '}');
    if (close >= 0) regions.push([open, close + 1]);
  }
  return regions;
}

// -> { allowed, hits }: `allowed` counts the scoped-token sites the rule permits (only
// archive-merged.js has any); `hits` lists the offending ones as [{ line, form }].
function scopedSites(rel, raw) {
  const blank = stripComments(raw, { literals: 'blank' });
  const isArchive = rel === ARCHIVE;
  const regions = isArchive ? allowedRegions(blank) : [];
  let allowed = 0;
  const hits = [];
  for (const m of blank.matchAll(SCOPED)) {
    const line = lineOf(blank, m.index);
    if (!isArchive) {
      hits.push({ line, form: `${m[1]} outside archive-merged.js` });
    } else if (regions.some(([s, e]) => m.index >= s && m.index < e)) {
      allowed += 1;
    } else {
      hits.push({ line, form: `${m[1]} outside classifyRunDir/lastOwnEventMs` });
    }
  }
  return { allowed, hits };
}

// -> [{ line, form }] for every scoped-token site in `raw` that the rule forbids.
function scopedHits(rel, raw) {
  return scopedSites(rel, raw).hits;
}

// The scoped rule passes vacuously when its allowed regions cannot be found, so both
// function spans must exist in archive-merged.js and the located sites must meet the floor.
function assertSiteFloor(entries) {
  const entry = entries.find((e) => e.rel === ARCHIVE);
  assert.ok(entry, `${ARCHIVE} is not among the scanned entries`);
  const blank = stripComments(entry.raw, { literals: 'blank' });
  for (const name of ['classifyRunDir', 'lastOwnEventMs']) {
    assert.ok(
      functionSpan(blank, name),
      `function ${name} not found in archive-merged.js: the scoped rule would pass vacuously without its allowed region`,
    );
  }
  const { allowed } = scopedSites(ARCHIVE, entry.raw);
  assert.ok(
    allowed >= SCOPED_SITE_FLOOR,
    `found ${allowed} allowed scoped-token sites in archive-merged.js, floor is ${SCOPED_SITE_FLOOR}: fewer means the matcher stopped matching`,
  );
}

// Offender strings for `entries`: `${rel}:${line} ${form}` per banned or scoped site, or
// `${rel}: ${message}` when the stripper mis-parsed the file (one per file).
function scan(entries) {
  const offenders = [];
  for (const { rel, raw } of entries) {
    const stripped = stripComments(raw);
    const verdict = stripperVerdict(raw, stripped);
    if (verdict !== 'ok') {
      offenders.push(`${rel}: ${STRIPPER_VERDICT_MESSAGES[verdict]}`);
      continue;
    }
    const blankVerdict = stripperVerdict(raw, stripComments(raw, { literals: 'blank' }));
    if (blankVerdict !== 'ok') {
      offenders.push(`${rel}: ${STRIPPER_VERDICT_MESSAGES[blankVerdict]}`);
      continue;
    }
    for (const { line, form } of hitsIn(stripped)) offenders.push(`${rel}:${line} ${form}`);
    for (const { line, form } of scopedHits(rel, raw)) offenders.push(`${rel}:${line} ${form}`);
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

test('AC4.1: renaming classifyRunDir in a scratch copy fails the site floor, not a vacuous pass', () => {
  const renamed = (from, to) => readEntries().map((e) => {
    if (e.rel !== ARCHIVE) return e;
    const raw = e.raw.replace(`function ${from}(`, `function ${to}(`);
    assert.notEqual(raw, e.raw, `the rename of ${from} did not apply to the scratch copy`);
    return { ...e, raw };
  });
  assert.throws(() => assertSiteFloor(renamed('classifyRunDir', 'classifyRunDirRenamed')), /classifyRunDir/);
  assert.throws(() => assertSiteFloor(renamed('lastOwnEventMs', 'lastOwnEventMsRenamed')), /lastOwnEventMs/);
});

test('floor: the scoped-token sites are located', () => {
  assertSiteFloor(readEntries());
});

test('scoped rule self-test: allowed sites pass, a sibling helper and the other files fail', () => {
  const archive = "const { ownEventRecency } = require('../run-liveness/probes');\nconst STALE_INTERRUPTED_TTL_MS = ORPHAN_MINT_TTL_MS;\nfunction lastOwnEventMs(d) {\n  return ownEventRecency(d).lastOwnMs;\n}\nfunction classifyRunDir(ctx) {\n  const s = '}';\n  return ownEventRecency(ctx.dir) && STALE_INTERRUPTED_TTL_MS;\n}\nfunction newHelper(d) {\n  return ownEventRecency(d);\n}\nmodule.exports = {\n  ownEventRecency, STALE_INTERRUPTED_TTL_MS,\n};";
  const fmt = (hits) => hits.map((h) => `${h.line}:${h.form}`);
  assert.deepEqual(fmt(scopedHits(ARCHIVE, archive)), ['11:ownEventRecency outside classifyRunDir/lastOwnEventMs']);
  const others = SCANNED.filter((rel) => rel !== ARCHIVE);
  for (const rel of others) {
    assert.deepEqual(
      fmt(scopedHits(rel, 'const x = ownEventRecency(d);\nconst y = STALE_INTERRUPTED_TTL_MS;')),
      ['1:ownEventRecency outside archive-merged.js', '2:STALE_INTERRUPTED_TTL_MS outside archive-merged.js'],
    );
  }
  for (const rel of SCANNED) {
    assert.deepEqual(scopedHits(rel, '// ownEventRecency is the reader\nconst ok = 1;'), []);
  }
});

test('boundary finder ignores braces inside string literals', () => {
  const blank = stripComments("function f() { const a = '{'; return 1; }\nconst after = 2;", { literals: 'blank' });
  assert.equal(lineOf(blank, functionSpan(blank, 'f').end), 1);
  assert.equal(functionSpan(blank, 'missing'), null);
});
