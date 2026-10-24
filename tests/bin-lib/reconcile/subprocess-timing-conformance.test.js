// tests/bin-lib/reconcile/subprocess-timing-conformance.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('../../helpers/strip-comments');
const { readText } = require('../../helpers/read-skill');

// #4032: every subprocess under plugin/bin/lib/reconcile/ is timed, so the
// per-phase `timings` a reconcile pass reports can say where its time went. The
// timing wrappers (timing.js's execFileSyncTimed / execFileAsyncTimed) are the
// one place that touches child_process directly; a module that calls
// child_process on its own would be an unmeasured spawn, and the report would
// quietly under-count. runGit/runGitAsync (git-exec.js) already route through
// the wrappers, so only direct exec call tokens (bare, `cp.`-qualified or
// destructured) and a direct `require('child_process')` are offenders here.
const RECONCILE_DIR = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'reconcile');
// background-spawn.js starts the detached, unref'd `reconcile-background` child
// and never waits on it — there is no duration to attribute to a phase, so it
// has no timed-wrapper equivalent.
const EXEMPT = new Set(['timing.js', 'background-spawn.js']);

const DIRECT_CALL = /\b(execFileSync|execFileAsync|execFile|execSync|spawnSync|spawn)\s*\(/g;
const CP_REQUIRE = /require\(\s*['"](?:node:)?child_process['"]\s*\)/g;
const TIMED_CALL = /\bexecFile(?:Sync|Async)Timed\s*\(/g;

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length;
}

// -> [{ line, token }] for every direct exec call / child_process require in `raw`.
function directSpawns(raw) {
  const src = stripComments(raw);
  const hits = [];
  for (const m of src.matchAll(DIRECT_CALL)) hits.push({ line: lineOf(src, m.index), token: m[0] });
  for (const m of src.matchAll(CP_REQUIRE)) hits.push({ line: lineOf(src, m.index), token: m[0] });
  return hits.sort((a, b) => a.line - b.line);
}

function reconcileFiles() {
  return fs.readdirSync(RECONCILE_DIR)
    .filter((f) => f.endsWith('.js') && !EXEMPT.has(f))
    .sort()
    .map((f) => ({ rel: `plugin/bin/lib/reconcile/${f}`, raw: readText(path.join(RECONCILE_DIR, f)) }));
}

// Offender strings for `entries`: a direct spawn, or a file the stripper mis-parsed.
function scan(entries) {
  const offenders = [];
  for (const { rel, raw } of entries) {
    const verdict = stripperVerdict(raw, stripComments(raw));
    if (verdict !== 'ok') {
      offenders.push(`${rel}: ${STRIPPER_VERDICT_MESSAGES[verdict]}`);
      continue;
    }
    for (const { line, token } of directSpawns(raw)) offenders.push(`${rel}:${line} ${token}`);
  }
  return offenders;
}

test('every reconcile subprocess goes through timing.js', () => {
  assert.deepEqual(scan(reconcileFiles()), []);
});

test('floor: the scan sees the timed call sites', () => {
  const files = reconcileFiles();
  assert.ok(files.length >= 20, `walked ${files.length} reconcile files — the walk stopped finding the directory's modules`);
  const total = files.reduce((n, { raw }) => n + [...stripComments(raw).matchAll(TIMED_CALL)].length, 0);
  assert.ok(total >= 15, `only ${total} execFileSyncTimed(/execFileAsyncTimed( call sites seen (≥ 15 expected) — the migration regressed or the matcher stopped matching`);
});

test('matcher self-test: a direct call is flagged at its line, a timed call and comment/message text are not', () => {
  const planted = [
    "const { execFileSync } = require('child_process'); // line 1",
    "execFileSync('gh', []);",
    "cp.execFile('git', []);",
    "// execFileSync('gh', []) in a comment",
    "const msg = 'spawn failed';",
    "execFileSyncTimed('gh', []);",
    "await execFileAsyncTimed('gh', []);",
  ].join('\n');
  assert.deepEqual(
    directSpawns(planted).map((h) => `${h.line}:${h.token}`),
    ["1:require('child_process')", '2:execFileSync(', '3:execFile('],
  );
  assert.deepEqual(directSpawns("execFileSyncTimed('gh', []);"), []);
});

test('a comment-stripper mis-parse is reported as an offender, not passed as a clean file', () => {
  // The stripper's documented mis-parse: a regex after `)` is read as division.
  const planted = { rel: 'plugin/bin/lib/reconcile/planted.js', raw: 'if (b) /"/.test(b); const c = "//"; execFileSync("gh", []);' };
  assert.equal(stripperVerdict(planted.raw, stripComments(planted.raw)), 'misparsed');
  assert.deepEqual(scan([planted]), [`${planted.rel}: ${STRIPPER_VERDICT_MESSAGES.misparsed}`]);
});

test('a live call after a fake comment opener in a string is still seen', () => {
  const planted = "const a = '/*';\nexecFileSync('gh', []);";
  assert.deepEqual(directSpawns(planted).map((h) => h.line), [2]);
});
