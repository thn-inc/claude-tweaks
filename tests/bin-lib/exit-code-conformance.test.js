// tests/bin-lib/exit-code-conformance.test.js
//
// #1903: mechanical backstop for the `require.main === module` guard
// contract (`gh-api-module-pattern` SKILL.md's CLI wrapper contract section)
// -- the guard must assign `process.exitCode = ...`, never call
// `process.exit(...)` directly, because the latter can truncate a pending
// stdout write for a piped consumer. Three prior records (#1176, #1313,
// #1535) each closed this same violation in a different `plugin/bin/*.js`
// file, found only by a manual grep sweep that missed at least one file each
// time. This test replaces the sweep with a mechanical scan of every
// `plugin/bin/**/*.js` file's own guard.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { stripComments } = require('../helpers/strip-comments');

const ROOT = path.join(__dirname, '..', '..');

// The two exceptions #1535's final whole-branch review verified safe:
// hooks.js's own stdout goes through a synchronous fs.writeSync(1, ...) with
// nothing pending to flush, and statusline-wrapper-source.js deliberately
// hard-stops on a child process's own exit code.
const ALLOWLIST = new Set([
  path.join('plugin', 'bin', 'hooks.js'),
  path.join('plugin', 'bin', 'lib', 'statusline-wrapper-source.js'),
]);

// Manual recursive walk -- same rationale (and shape) as
// pipeline-run-dir-arg-literal-conformance.test.js's walkFilesRelative:
// fs.readdirSync's `{ recursive: true }` needs a newer Node than this
// project's declared floor.
function walkFilesRelative(root, relBase = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, relBase), { withFileTypes: true })) {
    const rel = relBase ? path.join(relBase, entry.name) : entry.name;
    if (entry.isDirectory()) out.push(...walkFilesRelative(root, rel));
    else out.push(rel);
  }
  return out;
}

function getAllBinFiles() {
  const binDir = path.join(ROOT, 'plugin', 'bin');
  return walkFilesRelative(binDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join('plugin', 'bin', f));
}

// Extracts the text governed by a `require.main === module` guard: either a
// balanced `{ ... }` block, or (the dominant single-line form in this repo)
// the bare statement up to its terminating semicolon. A file may hold more
// than one guard (hooks.js's #3074 prefilter guard precedes its real entry
// point); the LAST one is the entry point, since a guard that short-circuits
// before the entry point must appear before it.
function extractGuard(src) {
  const re = /if\s*\(\s*require\.main\s*===\s*module\s*\)\s*/g;
  const m = [...src.matchAll(re)].at(-1);
  if (!m) return null;
  let i = m.index + m[0].length;
  if (src[i] === '{') {
    let depth = 0;
    const start = i;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
    return src.slice(start, i);
  }
  const semi = src.indexOf(';', i);
  return semi === -1 ? src.slice(i) : src.slice(i, semi + 1);
}

// A file with no `require.main === module` guard AND no `module.exports` is
// never imported for its exports -- its whole top-level body IS the entry
// point (statusline-wrapper-source.js's shape: a template script, always run
// standalone, never required as a library). A guard-less file that DOES
// export something is a pure library -- any process.exit() inside it lives
// inside a function invoked by some caller elsewhere, not an entry-point
// guard, so there is nothing here to check.
function guardRegionFor(content) {
  const guard = extractGuard(content);
  if (guard !== null) return guard;
  if (/module\.exports\b/.test(content)) return null;
  return content;
}

function findDirectProcessExit(guardText) {
  return guardText.match(/process\.exit\(/g) || [];
}

// The shared stripper reads a regex right after `)` or `}` as division
// (tests/helpers/strip-comments.js's header), so a mis-parse can still blank
// a guard. A file that also exports would then read as a guard-less library
// and be skipped silently; the scan reports it instead.
const GUARD_RE = /if\s*\(\s*require\.main\s*===\s*module\s*\)/;
function guardBlankedByStripper(raw, stripped) {
  return GUARD_RE.test(raw) && !GUARD_RE.test(stripped);
}

test('a guard after a string holding /* is still scanned (proves the literal-aware stripper)', () => {
  const fixture = ["const pattern = 'work/*-spec.md';", 'if (require.main === module) process.exit(main());', '/* trailing note */'].join('\n');
  assert.strictEqual(findDirectProcessExit(guardRegionFor(stripComments(fixture))).length, 1);
});

test('a guard the stripper blanks is reported, not skipped as a guard-less library', () => {
  // The regex sits right after `)`, which the stripper reads as division (its
  // documented ambiguity), so the /* in the class opens a comment that runs to
  // the trailing */ and blanks the guard; the module.exports line would then
  // make guardRegionFor read the file as a pure library and skip it.
  const blanked = ['if (x) /[/*]/.test(x);', 'if (require.main === module) process.exit(main());', 'module.exports = {};', '/* x */'].join('\n');
  assert.strictEqual(guardBlankedByStripper(blanked, stripComments(blanked)), true);
  const intact = ['if (require.main === module) process.exitCode = main();', 'module.exports = {};'].join('\n');
  assert.strictEqual(guardBlankedByStripper(intact, stripComments(intact)), false);
});

test('every require.main guard (or equivalent whole-file entry point) under plugin/bin/**/*.js sets process.exitCode, never process.exit() directly', () => {
  const files = getAllBinFiles();
  assert.ok(files.length > 50, 'sanity check: expected plugin/bin/**/*.js to contain many files');
  const violations = [];
  for (const rel of files) {
    if (ALLOWLIST.has(rel)) continue;
    const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const content = stripComments(raw);
    if (guardBlankedByStripper(raw, content)) {
      violations.push(`${rel}: its require.main guard is blanked by the comment stripper, so the scan cannot see it`);
      continue;
    }
    const guard = guardRegionFor(content);
    if (guard === null) continue;
    const hits = findDirectProcessExit(guard);
    if (hits.length > 0) {
      violations.push(`${rel}: ${hits.length} direct process.exit() call(s) in its entry-point guard`);
    }
  }
  assert.deepStrictEqual(
    violations,
    [],
    `plugin/bin files calling process.exit() directly instead of assigning process.exitCode (see gh-api-module-pattern SKILL.md's CLI wrapper contract):\n${violations.join('\n')}`,
  );
});

test('the allowlist names exactly the two reviewed exceptions, and each still actually needs it', () => {
  const expected = [
    path.join('plugin', 'bin', 'hooks.js'),
    path.join('plugin', 'bin', 'lib', 'statusline-wrapper-source.js'),
  ].sort();
  assert.deepStrictEqual([...ALLOWLIST].sort(), expected);
  for (const rel of ALLOWLIST) {
    const content = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    const guard = guardRegionFor(content);
    assert.ok(guard !== null, `${rel} is allowlisted but no longer has a detectable entry-point guard -- remove it from the allowlist`);
    assert.ok(
      findDirectProcessExit(guard).length > 0,
      `${rel} is allowlisted but no longer calls process.exit() directly -- remove it from the allowlist`,
    );
  }
});

test('extractGuard selects the entry-point (last) require.main guard in hooks.js, not the prefilter (first) one', () => {
  const content = stripComments(fs.readFileSync(path.join(ROOT, 'plugin', 'bin', 'hooks.js'), 'utf8'));
  const guard = extractGuard(content);
  assert.ok(guard !== null, 'hooks.js should still have a detectable require.main guard');
  // The prefilter guard at the top of the file only ever calls the early-exit
  // skip path; the real entry-point guard at the bottom drives main(...).
  assert.ok(
    /main\s*\(/.test(guard),
    `extractGuard should select the entry-point guard (the one invoking main(...)), not the prefilter guard -- got: ${guard.slice(0, 120)}`,
  );
  assert.ok(
    findDirectProcessExit(guard).length > 0,
    'the shipped entry-point guard still calls process.exit() directly -- this assertion documents the pre-fix-staleness baseline',
  );
});

// #2053: a narrower, unconditional rule -- no file under
// `plugin/bin/lib/health-core/**` may call `process.exit()` anywhere, not
// just inside an entry-point guard. These files are library functions
// invoked from deep inside one of the four health-suite CLIs' own
// (correctly-guarded) `main()`, outside any guard the test above can see --
// #1903's guard-scoped scan by design never follows a guard's call graph
// into a library function it invokes. A flat per-file text scan (same
// mechanism style as `findDirectProcessExit` above), not a call-graph walk:
// disproportionate for a bug class with three known instances (churn-report.js,
// mark.js, retry-cli.js, all fixed by this same record). Never widen this
// scope to all of `plugin/bin/lib/**` -- `statusline-wrapper-source.js`'s own
// `process.exit()` calls are a different case (a guard-less whole-script
// file, not a library function invoked from another file's guard) already
// covered by the test above's own ALLOWLIST.
function getHealthCoreFiles() {
  const dir = path.join(ROOT, 'plugin', 'bin', 'lib', 'health-core');
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.js'))
    .map((e) => path.join('plugin', 'bin', 'lib', 'health-core', e.name));
}

test('no plugin/bin/lib/health-core/*.js file calls process.exit() directly', () => {
  const files = getHealthCoreFiles();
  assert.ok(files.length > 5, 'sanity check: expected plugin/bin/lib/health-core/*.js to contain several files');
  const violations = [];
  for (const rel of files) {
    const content = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    const hits = findDirectProcessExit(content);
    if (hits.length > 0) {
      violations.push(`${rel}: ${hits.length} direct process.exit() call(s)`);
    }
  }
  assert.deepStrictEqual(
    violations,
    [],
    'plugin/bin/lib/health-core files call process.exit() directly instead of returning a value for ' +
    `their CLI caller's own main() to set process.exitCode from (see gh-api-module-pattern SKILL.md):\n${violations.join('\n')}`,
  );
});

test('the health-core scoped rule actually detects a synthetic violation (discrimination check, #2053 AC3)', () => {
  const tmpFile = path.join(ROOT, 'plugin', 'bin', 'lib', 'health-core', '__synthetic-violation.tmp.js');
  const dirty = "'use strict';\nfunction cmdSomething() {\n  process.exit(1);\n}\nmodule.exports = { cmdSomething };\n";
  fs.writeFileSync(tmpFile, dirty);
  try {
    const files = getHealthCoreFiles();
    const rel = path.join('plugin', 'bin', 'lib', 'health-core', '__synthetic-violation.tmp.js');
    assert.ok(files.includes(rel), 'synthetic file should be picked up by the directory sweep');
    const hits = findDirectProcessExit(stripComments(fs.readFileSync(tmpFile, 'utf8')));
    assert.strictEqual(hits.length, 1, 'the synthetic health-core file must fail the check');
  } finally {
    fs.unlinkSync(tmpFile);
  }
  // The real (post-fix) directory, with the synthetic file removed, passes clean.
  for (const rel of getHealthCoreFiles()) {
    const content = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    assert.strictEqual(findDirectProcessExit(content).length, 0, `${rel} should have no direct process.exit() calls`);
  }
});

test('the scanner actually detects a deliberately reintroduced violation (discrimination check)', () => {
  const clean = 'if (require.main === module) process.exitCode = run(process.argv.slice(2));';
  const dirtyBlock = 'if (require.main === module) { main(process.argv).then((code) => process.exit(code)); }';
  const dirtyOneLine = 'if (require.main === module) process.exit(run(process.argv.slice(2)));';
  const commentedOutOnly = stripComments(
    '// if (require.main === module) process.exit(1);\nif (require.main === module) process.exitCode = run();',
  );
  const libraryNoGuard = 'function run(argv) { process.exit(2); }\nmodule.exports = { run };';
  const wholeScriptNoGuard = 'try { process.exit(0); } catch { process.exit(1); }';

  assert.strictEqual(findDirectProcessExit(guardRegionFor(clean) || '').length, 0);
  assert.strictEqual(findDirectProcessExit(guardRegionFor(dirtyBlock) || '').length, 1);
  assert.strictEqual(findDirectProcessExit(guardRegionFor(dirtyOneLine) || '').length, 1);
  assert.strictEqual(findDirectProcessExit(guardRegionFor(commentedOutOnly) || '').length, 0);
  assert.strictEqual(guardRegionFor(libraryNoGuard), null);
  assert.strictEqual(findDirectProcessExit(guardRegionFor(wholeScriptNoGuard) || '').length, 2);
});
