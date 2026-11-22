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
// sibling record of #5373 converts its CLIs and deletes their lines here.
const NOT_YET = [
  'verify.js',
];

// A file that cannot meet the entry rules, by design (#5377). Unlike NOT_YET it is a
// standing decision, so each entry names its reason and a proof file that pins the
// behavior the rules would otherwise have to cover; the walk fails the entry as soon
// as the file conforms, and as soon as it has an offence outside `offences` (so hooks.js
// losing its `run` export still fails). `offences` are the exact checkEntry reports the
// exemption covers: hooks.js's prefilter calls process.exit(0) above the guard line; the
// script entry's own process.exit(code) sits inside the guard, so checkEntry never reports it.
// Each pattern covers exactly one offence, and stays line-number independent (the prefilter moves).
const EXEMPT = {
  'hooks.js': {
    reason: 'require-time bash prefilter (exits before run) and a script entry that calls process.exit(code) so a hook never outlives its event',
    proof: 'tests/hooks-bash-prefilter.test.js',
    offences: [/^process\.exit\( above the guard \(line \d+\)$/],
  },
};

const GUARD = 'require.main === module';

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

// Does the stripped text export `run`: `module.exports = { … }` with `run` as an exported
// property name at the object's top level (shorthand `run`, or the key `run:`),
// `module.exports.run =` or `exports.run =`. A `run` in value position (`main: run`) or
// inside a nested call or literal (`main: (a) => run(a)`) is not an export of `run`.
function exportsRun(stripped) {
  if (/\b(?:module\.)?exports\.run\s*=/.test(stripped)) return true;
  for (const m of stripped.matchAll(/module\.exports\s*=\s*\{/g)) {
    // Keep only the object's own top level: drop everything inside nested ( [ {.
    let depth = 0;
    let top = '';
    for (let i = m.index + m[0].length - 1; i < stripped.length; i++) {
      const c = stripped[i];
      if (c === '{' || c === '(' || c === '[') {
        if (++depth === 1) top += c;
      } else if (c === '}' || c === ')' || c === ']') {
        if (--depth === 0) break;
      } else if (depth === 1) top += c;
    }
    if (/(?:^|[{,])\s*run\s*(?:[,:]|$)/.test(top)) return true;
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

function assertFile(name, rawText, notYet, exempt = EXEMPT) {
  const { offences } = checkEntry(rawText);
  if (Object.prototype.hasOwnProperty.call(exempt, name)) {
    assert.ok(offences.length > 0, `${name} now conforms — delete it from EXEMPT`);
    // Each pattern covers one offence: a second offence of the same kind is uncovered.
    const unused = [...exempt[name].offences];
    for (const offence of offences) {
      const at = unused.findIndex((re) => re.test(offence));
      assert.ok(at !== -1, `${name} has an offence its EXEMPT entry does not cover: ${offence}`);
      unused.splice(at, 1);
    }
  } else if (notYet.includes(name)) {
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

test('AC7.1 AC7.2: every top-level plugin/bin CLI meets the entry rules, except the named EXEMPT entries and the files listed in NOT_YET', () => {
  const files = binFiles();
  assert.ok(files.length >= 120, `the walk saw only ${files.length} files — a lower count than 120 means it stopped seeing plugin/bin/*.js`);
  for (const name of files) assertFile(name, readText(path.join(BIN_DIR, name)), NOT_YET);
});

// The landing size of NOT_YET. A ratchet, not a pin: the list only shrinks, and the
// sibling records of #5373 delete their own lines without ever editing this constant.
const NOT_YET_CEILING = 27;

test('AC9.4: NOT_YET only shrinks, and stays sorted, without duplicates, naming existing files', () => {
  assert.ok(NOT_YET.length <= NOT_YET_CEILING, `NOT_YET grew to ${NOT_YET.length} (ceiling ${NOT_YET_CEILING}) — the list only shrinks`);
  assert.deepStrictEqual(NOT_YET, [...NOT_YET].sort());
  assert.strictEqual(new Set(NOT_YET).size, NOT_YET.length);
  for (const name of NOT_YET) assert.ok(fs.existsSync(path.join(BIN_DIR, name)), `NOT_YET names ${name}, which does not exist in plugin/bin`);
});

test('AC7.1: each EXEMPT entry names a reason and an existing proof file', () => {
  for (const [name, { reason, proof, offences }] of Object.entries(EXEMPT)) {
    assert.ok(typeof reason === 'string' && reason.trim().length > 0, `EXEMPT ${name} has no reason`);
    assert.ok(Array.isArray(offences) && offences.length > 0 && offences.every((re) => re instanceof RegExp), `EXEMPT ${name} names no offence patterns`);
    assert.ok(typeof proof === 'string' && fs.existsSync(path.join(__dirname, '..', '..', proof)), `EXEMPT ${name} names proof ${proof}, which does not exist`);
    assert.ok(fs.existsSync(path.join(BIN_DIR, name)), `EXEMPT names ${name}, which does not exist in plugin/bin`);
  }
});

test('AC7.3: hooks.js is in EXEMPT and not in NOT_YET', () => {
  assert.ok(!NOT_YET.includes('hooks.js'));
  assert.deepStrictEqual(Object.keys(EXEMPT), ['hooks.js']);
  // NOT_YET is not empty (it still holds verify.js), so the list and the code that
  // reads it stay; only hooks.js left it.
  assert.ok(NOT_YET.length > 0);
});

test('AC7.1: a file cannot be both exempt and listed', () => {
  for (const name of Object.keys(EXEMPT)) assert.ok(!NOT_YET.includes(name), `${name} is in both EXEMPT and NOT_YET`);
});

test('AC7.4: an EXEMPT file that now conforms fails the walk', () => {
  assert.throws(() => assertFile('hooks.js', CONFORMING, [], EXEMPT), /hooks\.js now conforms — delete it from EXEMPT/);
});

test('AC7.4: an EXEMPT file with an offence outside its patterns fails the walk, naming the offence', () => {
  // The exempt shape (a prefilter exit above the guard) that also lost its `run` export.
  const noRun = [
    "'use strict';",
    'if (process.argv[2] === "x") process.exit(0);',
    'function main() { return 0; }',
    'module.exports = { main };',
    'if (require.main === module) process.exit(main());',
  ].join('\n');
  assert.deepStrictEqual(checkEntry(noRun).offences, ['exports no run', 'process.exit( above the guard (line 2)']);
  assert.throws(() => assertFile('hooks.js', noRun, [], EXEMPT), /hooks\.js has an offence its EXEMPT entry does not cover: exports no run/);
  // The same shape with its `run` export is covered.
  assert.doesNotThrow(() => assertFile('hooks.js', noRun.replace('{ main }', '{ main, run: main }'), [], EXEMPT));
});

test('AC7.4: a second process.exit( above the guard in an EXEMPT file is uncovered and fails the walk', () => {
  const two = [
    "'use strict';",
    'if (process.argv[2] === "x") process.exit(0);',
    'function bail() { process.exit(3); }',
    'function run() { return 0; }',
    'module.exports = { run };',
    'if (require.main === module) process.exit(run());',
  ].join('\n');
  assert.deepStrictEqual(checkEntry(two).offences, ['process.exit( above the guard (line 2)', 'process.exit( above the guard (line 3)']);
  assert.throws(() => assertFile('hooks.js', two, [], EXEMPT), /hooks\.js has an offence its EXEMPT entry does not cover: process\.exit\( above the guard \(line 3\)/);
  assert.doesNotThrow(() => assertFile('hooks.js', two.replace('function bail() { process.exit(3); }\n', ''), [], EXEMPT));
});

test('AC9.2: a conforming file listed in NOT_YET fails the walk', () => {
  const text = readText(path.join(BIN_DIR, 'resolve-policy.js'));
  assert.throws(() => assertFile('resolve-policy.js', text, ['resolve-policy.js']), /now conforms — delete it from NOT_YET/);
});

test('AC9.3: a non-conforming file missing from NOT_YET fails the walk', () => {
  const neverConforms = ["'use strict';", 'function main() {}', 'module.exports = { main };', 'process.exit(1);'].join('\n');
  assert.throws(() => assertFile('never-conforms.js', neverConforms, []), /never-conforms\.js breaks the CLI entry contract:\nexports no run/);
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
  const valuePosition = ["'use strict';", 'const run = () => 0;', 'module.exports = { main: run };', 'if (require.main === module) run();'].join('\n');
  assert.deepStrictEqual(checkEntry(valuePosition).offences, ['exports no run']);
  const inCall = ["'use strict';", 'const run = () => 0;', 'module.exports = { main: (a) => run(a) };', 'if (require.main === module) run();'].join('\n');
  assert.deepStrictEqual(checkEntry(inCall).offences, ['exports no run']);
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
