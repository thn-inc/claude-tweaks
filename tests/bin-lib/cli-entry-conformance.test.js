// tests/bin-lib/cli-entry-conformance.test.js
//
// #5374: the CLI entry contract (`gh-api-module-pattern`'s cli-wrapper-contract.md)
// makes a `plugin/bin` CLI callable in-process from a test: it exports `run`, ends
// with a `require.main === module` guard, and touches `process.exitCode` /
// `process.exit(` only from that guard line down. This scan reads every top-level
// `plugin/bin/*.js` as text (never requires it) and pins those three rules.
//
// Recall limits: the scan reads the file's last guard line, not what `run` calls, so a
// `process.exit(` inside a function body below the guard line is not seen; and `run`
// exported through a computed key or a spread is not seen either.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('../helpers/strip-comments');
const { readText } = require('../helpers/read-skill');

const BIN_DIR = path.join(__dirname, '..', '..', 'plugin', 'bin');

// The files that do not meet the entry rules yet. This list only shrinks: each
// sibling record of #5373 converts its CLIs and deletes their lines here. `hooks.js`
// leaves it through #5377, which replaces its entry with a named exemption in this
// test, with its reason, kept apart from this list.
const NOT_YET = [
  'blast-radius.js',
  'calibration-report.js',
  'claude-tweaks-statusline.js',
  'code-health.js',
  'compose-subject.js',
  'declined-learning.js',
  'design-detect.js',
  'docs-health.js',
  'harness-health.js',
  'hooks.js',
  'init-verify-scope.js',
  'install-statusline-wrapper.js',
  'journey-health.js',
  'phase-timing.js',
  'plan-audit.js',
  'reachability-audit.js',
  'record-graph.js',
  'release-bootstrap.js',
  'release-notes-publish.js',
  'residue.js',
  'resolve-profile.js',
  'session-tmp-resolve.js',
  'sweep-stray-run-dirs.js',
  'verify.js',
  'visual-decide.js',
  'wrap-up-engine.js',
  'wrap-up-state.js',
];

const GUARD = 'require.main === module';

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

// Does the stripped text export `run`: `module.exports = { … run … }` with `run` as a
// whole word (shorthand or `run:`), `module.exports.run =` or `exports.run =`.
function exportsRun(stripped) {
  if (/\b(?:module\.)?exports\.run\s*=/.test(stripped)) return true;
  for (const m of stripped.matchAll(/module\.exports\s*=\s*\{/g)) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    const start = i;
    for (; i < stripped.length; i++) {
      if (stripped[i] === '{') depth++;
      else if (stripped[i] === '}' && --depth === 0) break;
    }
    if (/\brun\b/.test(stripped.slice(start, i))) return true;
  }
  return false;
}

function checkEntry(rawText) {
  const raw = rawText.replace(/\r\n/g, '\n');
  const stripped = stripComments(raw);
  const offences = [];

  const verdict = stripperVerdict(raw, stripped);
  if (verdict !== 'ok') offences.push(STRIPPER_VERDICT_MESSAGES[verdict]);
  if (raw.includes(GUARD) && !stripped.includes(GUARD)) offences.push('guard blanked by the stripper');

  if (!exportsRun(stripped)) offences.push('exports no run');

  const guardAt = stripped.lastIndexOf(GUARD);
  if (guardAt === -1) offences.push('no require.main === module guard');
  const guardLine = guardAt === -1 ? Infinity : lineOf(stripped, guardAt);
  for (const [token, re] of [['process.exitCode', /process\.exitCode/g], ['process.exit(', /process\.exit\(/g]]) {
    for (const m of stripped.matchAll(re)) {
      const line = lineOf(stripped, m.index);
      if (line < guardLine) offences.push(`${token} above the guard (line ${line})`);
    }
  }
  return { offences };
}

function assertFile(name, rawText, notYet) {
  const { offences } = checkEntry(rawText);
  if (notYet.includes(name)) {
    assert.ok(offences.length > 0, `${name} now conforms — delete it from NOT_YET`);
  } else {
    assert.deepStrictEqual(offences, [], `${name} breaks the CLI entry contract:\n${offences.join('\n')}`);
  }
}

const CONFORMING = [
  '#!/usr/bin/env node',
  "'use strict';",
  'function run(argv, deps) { return 0; }',
  'const realDeps = {};',
  'module.exports = { run, realDeps };',
  'if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);',
].join('\n');

function binFiles() {
  return fs.readdirSync(BIN_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.js'))
    .map((e) => e.name)
    .sort();
}

test('AC9.1: every top-level plugin/bin CLI meets the entry rules, except the files listed in NOT_YET', () => {
  const files = binFiles();
  assert.ok(files.length >= 120, `the walk saw only ${files.length} files — a lower count than 120 means it stopped seeing plugin/bin/*.js`);
  for (const name of files) assertFile(name, readText(path.join(BIN_DIR, name)), NOT_YET);
});

test('AC9.4: NOT_YET holds 27 existing files, sorted, without duplicates', () => {
  assert.strictEqual(NOT_YET.length, 27);
  assert.deepStrictEqual(NOT_YET, [...NOT_YET].sort());
  assert.strictEqual(new Set(NOT_YET).size, NOT_YET.length);
  for (const name of NOT_YET) assert.ok(fs.existsSync(path.join(BIN_DIR, name)), `NOT_YET names ${name}, which does not exist in plugin/bin`);
});

test('AC9.2: a conforming file listed in NOT_YET fails the walk', () => {
  const text = readText(path.join(BIN_DIR, 'resolve-policy.js'));
  assert.throws(() => assertFile('resolve-policy.js', text, ['resolve-policy.js']), /now conforms — delete it from NOT_YET/);
});

test('AC9.3: a non-conforming file missing from NOT_YET fails the walk', () => {
  assert.throws(() => assertFile('verify.js', readText(path.join(BIN_DIR, 'verify.js')), []));
});

test('checkEntry: a conforming text has no offences', () => {
  assert.deepStrictEqual(checkEntry(CONFORMING), { offences: [] });
});

test('checkEntry flags each rule on the exact line', () => {
  const noRun = ["'use strict';", 'function main() {}', 'module.exports = { main };', 'if (require.main === module) main();'].join('\n');
  assert.deepStrictEqual(checkEntry(noRun).offences, ['exports no run']);

  // With no guard every occurrence is above it: the token on the last line is still reported.
  const noGuard = ["'use strict';", 'function run() { return 0; }', 'module.exports = { run };', 'process.exitCode = 1;'].join('\n');
  assert.deepStrictEqual(checkEntry(noGuard).offences, ['no require.main === module guard', 'process.exitCode above the guard (line 4)']);

  // The entry is the last guard: an exit between an earlier guard and it is above the entry.
  const twoGuards = [
    "'use strict';",
    'function run() { return 0; }',
    'module.exports = { run };',
    'if (require.main === module) run();',
    'process.exit(1);',
    'if (require.main === module) process.exitCode = run();',
  ].join('\n');
  assert.deepStrictEqual(checkEntry(twoGuards).offences, ['process.exit( above the guard (line 5)']);

  const exitCode = ["'use strict';", 'function run() { return 0; }', 'module.exports = { run };', 'process.exitCode = 1;', '', '', '', '', 'if (require.main === module) run();'].join('\n');
  assert.deepStrictEqual(checkEntry(exitCode).offences, ['process.exitCode above the guard (line 4)']);

  const exitCall = exitCode.replace('process.exitCode = 1;', 'process.exit(1);');
  assert.deepStrictEqual(checkEntry(exitCall).offences, ['process.exit( above the guard (line 4)']);

  const keyed = ["'use strict';", 'const run = () => 0;', 'module.exports = { run: run };', 'if (require.main === module) run();'].join('\n');
  assert.deepStrictEqual(checkEntry(keyed).offences, []);
  const assigned = ["'use strict';", 'exports.run = () => 0;', 'if (require.main === module) exports.run();'].join('\n');
  assert.deepStrictEqual(checkEntry(assigned).offences, []);
  const lookalike = ["'use strict';", 'module.exports = { runner, rerun };', 'if (require.main === module) runner();'].join('\n');
  assert.deepStrictEqual(checkEntry(lookalike).offences, ['exports no run']);
});

test('checkEntry ignores the tokens in comments, and allows them from the guard line down', () => {
  const text = [
    "'use strict';",
    '// process.exit(1) would truncate piped output',
    'function run() { return 0; }',
    'module.exports = { run };',
    'if (require.main === module) process.exitCode = run(process.argv.slice(2));',
  ].join('\n');
  assert.deepStrictEqual(checkEntry(text), { offences: [] });
});

test('checkEntry reports a stripper mis-parse as an offence', () => {
  const planted = [
    "'use strict';",
    'function run() { return 0; }',
    'module.exports = { run };',
    "if (run) /'/.test(run); const b = 'p//q'; process.exitCode = 1;",
    'if (require.main === module) run();',
  ].join('\n');
  const verdict = stripperVerdict(planted, stripComments(planted));
  assert.notStrictEqual(verdict, 'ok', 'the planted text must be one the stripper misreads');
  assert.ok(checkEntry(planted).offences.includes(STRIPPER_VERDICT_MESSAGES[verdict]));
});

test('a guard the stripper blanks is reported', () => {
  const blanked = ['if (x) /[/*]/.test(x);', 'module.exports = { run };', 'if (require.main === module) run();', '/* x */'].join('\n');
  assert.ok(checkEntry(blanked).offences.includes('guard blanked by the stripper'));
});

test('Review Focus 5: a CRLF checkout gets the same verdict', () => {
  const text = readText(path.join(BIN_DIR, 'resolve-policy.js'));
  const crlf = text.replace(/\n/g, '\r\n');
  assert.ok(crlf.includes('\r\n'));
  assert.deepStrictEqual(checkEntry(crlf), checkEntry(text));

  const exitCode = ["'use strict';", 'function run() { return 0; }', 'module.exports = { run };', 'process.exitCode = 1;', '', '', '', '', 'if (require.main === module) run();'].join('\n');
  const crlfExit = exitCode.replace(/\n/g, '\r\n');
  assert.deepStrictEqual(checkEntry(crlfExit).offences, ['process.exitCode above the guard (line 4)']);
  assert.deepStrictEqual(checkEntry(crlfExit), checkEntry(exitCode));
});
