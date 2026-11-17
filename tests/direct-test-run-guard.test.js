'use strict';

// The repo-local guard's classifier for a typed Bash command (#5547): which direct `node --test` runs it
// denies, the runner command it names instead, and that every named command is one the guard allows and
// the runner's own operand parser accepts.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { readText } = require('./helpers/read-skill');
const { shellQuote } = require('./helpers/shell-quote');
const { findOnPath } = require('./helpers/path-stub');

// Every verdict below is read through classifyCommandOrThrow and judgeOrThrow, which let an internal error
// through, so a bug can never pass an allow row by landing in the catching wrapper.
const guard = require('../tools/direct-test-run-guard');
const { classifyCommand, hasDirectTestRun, scanScript, judge, realDeps, SAFEGUARDS_TEXT, PROGRAM_WORDS } = guard;
// Every command a test in this file sees denied, by either throwing entry point, under any options: the
// last test in the file runs each one through the sh prefilter.
const DENIED_COMMANDS = new Set();
function recordDeny(command, verdict) {
  if (typeof command === 'string' && verdict.decision === 'deny') DENIED_COMMANDS.add(command);
  return verdict;
}
const classifyCommandOrThrow = (command, options) => recordDeny(command, guard.classifyCommandOrThrow(command, options));
const judgeOrThrow = (payload, deps) => recordDeny(payload && payload.tool_input && payload.tool_input.command, guard.judgeOrThrow(payload, deps));
const { parseRunnerOperands } = require('../tools/run-tests');

// Every deny table in this file registers its commands here, with the options they are judged under, as
// the module loads: AC9 round-trips each pasted replacement through the classifier and the runner's parser,
// on its own as well as after the other tests. `rows` holds commands or [command, ...] rows; returned as is.
const ROUND_TRIP = [];
function roundTrip(options, rows) {
  for (const row of rows) ROUND_TRIP.push([Array.isArray(row) ? row[0] : row, options]);
  return rows;
}

const isDirectory = (p) => p === '/repo/tests' || p === '/repo/evals/tests';
// Every `.js`/`.mjs` path that is no directory exists, so the runner's parser decides on shape alone.
const isFile = (p) => /\.(?:c|m)?js$/.test(p) && !isDirectory(p);
const opts = {
  cwd: '/repo',
  hasRunner: (d) => (d === '/repo' || d.startsWith('/repo/') ? '/repo' : null),
  isDirectory,
  isFile,
  pathImpl: path.posix,
};

// Each deny row with the replacement line its reason names. `null` marks the rows whose replacement is
// the fixed placeholder text (the files a `while read` loop, `xargs` or `find` runs cannot be known).
const PLACEHOLDER = 'node tools/run-tests.js <the test files this loop runs>';
const REFUSED_PLACEHOLDER = 'node <path to tools/run-tests.js> <the test files, as *.test.js paths inside that checkout>';
const DENY_ROWS = roundTrip(opts, [
  ['node --test "$TEST_FILE"', 'node tools/run-tests.js "$TEST_FILE"'],
  ['for i in 1 2 3; do node --test tests/a.test.js; done', 'node tools/run-tests.js tests/a.test.js'],
  ['for i in 1 2 3; do sh -c "node --test tests/a.test.js"; done', 'node tools/run-tests.js tests/a.test.js'],
  ["seq 3 | xargs -n1 sh -c 'node --test tests/a.test.js'", 'node tools/run-tests.js tests/a.test.js'],
  ['node --test tests/a.test.js tests/b.test.js', 'node tools/run-tests.js tests/a.test.js tests/b.test.js'],
  ['node --test --test-reporter=tap tests/bin-lib/verify/*.test.js', 'node tools/run-tests.js --test-reporter=tap tests/bin-lib/verify/*.test.js'],
  ['node --test', 'node tools/run-tests.js --full'],
  ['node --test tests/', 'node tools/run-tests.js tests/'],
  ['node --test tests', 'node tools/run-tests.js tests'],
  ['node --test $(git diff --name-only main)', 'node tools/run-tests.js $(git diff --name-only main)'],
  ['FOO=1 /opt/homebrew/bin/node --test tests/a.test.js tests/b.test.js | tail -5', 'FOO=1 node tools/run-tests.js tests/a.test.js tests/b.test.js'],
  ['npx -y node@20 --test tests/a.test.js tests/b.test.js', 'npx -y node@20 tools/run-tests.js tests/a.test.js tests/b.test.js'],
  ['for f in tests/a.test.js tests/b.test.js; do node --test "$f"; done', 'node tools/run-tests.js tests/a.test.js tests/b.test.js'],
  ['for f in tests/*.test.js; do node "$f"; done', 'node tools/run-tests.js tests/*.test.js'],
  ['while read f; do node --test "$f"; done < list.txt', null],
  ['ls tests/*.test.js | xargs -n1 node --test', null],
  ['find tests -name "*.test.js" -exec node --test {} \\;', null],
  ['sh -c "node --test tests/a.test.js tests/b.test.js"', 'node tools/run-tests.js tests/a.test.js tests/b.test.js'],
  // A transparent prefix, a condition keyword, a grouping or a wrapper option keeps a run a direct run.
  ['timeout 600 node --test tests/a.test.js tests/b.test.js', 'timeout 600 node tools/run-tests.js tests/a.test.js tests/b.test.js'],
  ['time node --test tests/a.test.js tests/b.test.js', 'time node tools/run-tests.js tests/a.test.js tests/b.test.js'],
  ['env FOO=1 node --test tests/a.test.js tests/b.test.js', 'env FOO=1 node tools/run-tests.js tests/a.test.js tests/b.test.js'],
  ['nice -n 10 node --test tests/a.test.js tests/b.test.js', 'nice -n 10 node tools/run-tests.js tests/a.test.js tests/b.test.js'],
  ['command node --test tests/a.test.js tests/b.test.js', 'command node tools/run-tests.js tests/a.test.js tests/b.test.js'],
  ['exec node --test tests/a.test.js tests/b.test.js', 'exec node tools/run-tests.js tests/a.test.js tests/b.test.js'],
  ['! node --test tests/a.test.js tests/b.test.js', '! node tools/run-tests.js tests/a.test.js tests/b.test.js'],
  ['while node --test tests/a.test.js; do sleep 1; done', 'node tools/run-tests.js tests/a.test.js'],
  ['until node --test tests/a.test.js; do sleep 1; done', 'node tools/run-tests.js tests/a.test.js'],
  ['if node --test tests/a.test.js tests/b.test.js; then echo ok; fi', 'node tools/run-tests.js tests/a.test.js tests/b.test.js'],
  ['if false; then :; elif node --test tests/a.test.js tests/b.test.js; then :; fi', 'node tools/run-tests.js tests/a.test.js tests/b.test.js'],
  ['bash -o pipefail -c "node --test tests/a.test.js tests/b.test.js"', 'node tools/run-tests.js tests/a.test.js tests/b.test.js'],
  ['(node --test tests/a.test.js tests/b.test.js)', 'node tools/run-tests.js tests/a.test.js tests/b.test.js'],
  ['{ node --test tests/a.test.js tests/b.test.js; }', 'node tools/run-tests.js tests/a.test.js tests/b.test.js'],
  // An `o`-ending option cluster takes the next word, like `-o`.
  ['bash -euo pipefail -c "node --test tests/a.test.js tests/b.test.js"', 'node tools/run-tests.js tests/a.test.js tests/b.test.js'],
  // A wrapper inside a loop sees the loop's variable; no replacement line holds a loop variable.
  ['for f in tests/a.test.js tests/b.test.js; do sh -c "node --test $f"; done', 'node tools/run-tests.js tests/a.test.js tests/b.test.js'],
  ['for f in $(ls tests); do sh -c "node --test $f"; done', null],
  ['while read f; do sh -c "node --test $f"; done < list.txt', null],
  // A test flag naming the loop variable is left out: the files are still known.
  ['for f in a b; do node --test tests/a.test.js --test-name-pattern "$f"; done', 'node tools/run-tests.js tests/a.test.js'],
  ['while read f; do node --test tests/a.test.js --test-name-pattern "$f"; done < list.txt', 'node tools/run-tests.js tests/a.test.js'],
  // Node options the runner does not take are left out of the replacement (and named in the reason).
  ['node --env-file .env --test tests/a.test.js tests/b.test.js', 'node tools/run-tests.js tests/a.test.js tests/b.test.js'],
  ['node --test --trace-warnings tests/a.test.js tests/b.test.js', 'node tools/run-tests.js tests/a.test.js tests/b.test.js'],
  ['for i in 1 2; do node --test -e "x" tests/a.test.js; done', 'node tools/run-tests.js tests/a.test.js'],
  // `--` ends the options: it is dropped, and what follows is files.
  ['node --test -- tests/a.test.js tests/b.test.js', 'node tools/run-tests.js tests/a.test.js tests/b.test.js'],
  ['npx -p node@20 node --test tests/a.test.js tests/b.test.js', 'npx -p node@20 node tools/run-tests.js tests/a.test.js tests/b.test.js'],
  ['npx --package node@20 node --test tests/a.test.js tests/b.test.js', 'npx --package node@20 node tools/run-tests.js tests/a.test.js tests/b.test.js'],
  ['sudo node --test tests/a.test.js tests/b.test.js', 'sudo node tools/run-tests.js tests/a.test.js tests/b.test.js'],
  ['eval "node --test tests/a.test.js tests/b.test.js"', 'node tools/run-tests.js tests/a.test.js tests/b.test.js'],
  ['eval node --test tests/a.test.js tests/b.test.js', 'node tools/run-tests.js tests/a.test.js tests/b.test.js'],
  // An unquoted substituted value holding blanks is word-split into that many files.
  ['F="tests/a.test.js tests/b.test.js"; node --test $F', 'node tools/run-tests.js tests/a.test.js tests/b.test.js'],
  // xargs and parallel run their first non-option word, past the options that take a value.
  ['ls tests | xargs -n 1 node --test', null],
  ['ls tests | parallel -j 2 node --test {}', null],
]);

const ALLOW_ROWS = [
  'node --test tests/a.test.js',
  'node tests/a.test.js',
  'node --test --test-name-pattern foo tests/a.test.js',
  'node --test --test-reporter tap tests/a.test.js',
  'F=tests/a.test.js; node --test "$F"',
  'node tools/run-tests.js tests/a.test.js tests/b.test.js',
  'node scripts/x.js --test',
  'cd evals && node --test tests/',
  'node --test evals/tests/a.test.js evals/tests/b.test.js',
  'git commit -m "run node --test a.test.js b.test.js"',
  'echo "node --test a.test.js b.test.js"',
  'git grep -n "node --test" -- docs',
  'for f in a b; do :; done && node --test tests/a.test.js',
  'for f in scripts/a.js scripts/b.js; do node "$f"; done',
  'while read f; do node "$f"; done < list.txt',
  'timeout 600 node --test tests/a.test.js',
  'time node tools/run-tests.js tests/a.test.js tests/b.test.js',
  'env NODE_OPTIONS=--trace-warnings node scripts/x.js --test',
  'if node --test tests/a.test.js; then echo ok; fi',
  'timeout 600 git log --grep "node --test a b"',
  'git ls-files tests | xargs grep -n node tests/a.test.js',
  'find tests -exec grep -n node tests/a.test.js tests/b.test.js \\;',
  'node --test --env-file .env tests/a.test.js',
  'node --test --conditions dev tests/a.test.js',
  'for i in 1 2; do node -e "x" tests/a.test.js; done',
  'for i in 1 2; do node -p "x" tests/a.test.js; done',
  'F="tests/a.test.js tests/b.test.js"; node --test "$F"',
  // After pushd or popd the working directory is unknown, so the run is allowed (a known miss for the second).
  'pushd evals && node --test tests/',
  'pushd tests && node --test a.test.js b.test.js',
  'popd; node --test tests/a.test.js tests/b.test.js',
];

const EXPANSION_LINE = 'The runner takes *.test.js files only and refuses anything else the expansion names, so make it name test files only.';

const RELATIVE_VALUE_LINE = 'The runner starts node from the checkout root, so a relative path inside a flag value is read from there.';

// `note` is the line printed directly below a placeholder replacement (why no command can be pasted).
function reasonFor(replacement, { expansion = false, options = null, note = null, relative = false, leftOut = null } = {}) {
  return [
    `This repository's guard blocked a direct test run. ${SAFEGUARDS_TEXT}`,
    'Run the same files through the runner, which takes the same files and node test flags:',
    '',
    replacement,
    ...(note ? [note] : []),
    '',
    ...(expansion ? [EXPANSION_LINE] : []),
    ...(options ? [`The runner does not take ${options}; if the tests need them, set NODE_OPTIONS.`] : []),
    ...(relative ? [RELATIVE_VALUE_LINE] : []),
    ...(leftOut ? [`Left out because they depend on the loop: ${leftOut}.`] : []),
    'In a checkout older than this guard, write the files to a list and use: node tools/run-tests.js --files-from <list>',
    'A single test file outside a loop can still be run directly.',
  ].join('\n');
}

// Splits a command line into words the way the shell would for the plain shapes these replacements use:
// whitespace-separated, a double-quoted span kept as one word without its quotes.
function shellWords(line) {
  const words = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(line)) !== null) words.push(m[1] !== undefined ? m[1] : m[2]);
  return words;
}

// What the shell hands the runner for a replacement's argument text: a `$(...)` substitution, a `"$NAME"`
// expansion and a glob word each become two literal test file names.
function expandAsShell(argText) {
  return argText
    .replace(/\$\([^)]*\)/g, 'tests/x1.test.js tests/x2.test.js')
    .replace(/"\$[A-Za-z_][A-Za-z0-9_]*"/g, 'tests/x1.test.js tests/x2.test.js')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (/[*?[{]/.test(w) ? 'tests/x1.test.js tests/x2.test.js' : w))
    .join(' ');
}

test('AC7.1 AC7.2: the classifier is pure and pins these verdicts', () => {
  for (const command of ALLOW_ROWS) {
    assert.equal(classifyCommandOrThrow(command, opts).decision, 'allow', command);
  }
  for (const [command] of DENY_ROWS) {
    const verdict = classifyCommandOrThrow(command, opts);
    assert.equal(verdict.decision, 'deny', command);
    assert.equal(verdict.kind, 'typed', command);
  }
});

test('each deny row names its replacement', () => {
  for (const [command, replacement] of DENY_ROWS) {
    assert.equal(classifyCommandOrThrow(command, opts).replacement, replacement === null ? PLACEHOLDER : replacement, command);
  }
});

test('a trailing slash denies even when the path is not a directory', () => {
  assert.equal(classifyCommandOrThrow('node --test tests/', { ...opts, isDirectory: () => false }).decision, 'deny');
  // Its counterpart: without the slash, only isDirectory decides.
  assert.equal(classifyCommandOrThrow('node --test tests', { ...opts, isDirectory: () => false }).decision, 'allow');
});

roundTrip(opts, [
  'cd scripts && node --test',
  'bash -lc "node --test tests/a.test.js tests/b.test.js"',
]);

test('a run whose working directory is under evals/ is allowed with no operand to read', () => {
  // `cd evals && node --test tests/` is also allowed by its operand; this one only by the cwd.
  assert.equal(classifyCommandOrThrow('cd evals && node --test', opts).decision, 'allow');
  assert.equal(classifyCommandOrThrow('cd scripts && node --test', opts).decision, 'deny');
});

test('a redirection target is no file operand, and a clustered -c is a wrapper', () => {
  assert.equal(classifyCommandOrThrow('node --test tests/a.test.js > out.txt 2>&1', opts).decision, 'allow');
  assert.equal(classifyCommandOrThrow('node --test tests/a.test.js >out.txt', opts).decision, 'allow');
  assert.equal(classifyCommandOrThrow('bash -lc "node --test tests/a.test.js tests/b.test.js"', opts).decision, 'deny');
});

const PREFIX_TWO = 'node --test tests/a.test.js tests/b.test.js';
const DENIED_PREFIXES = [
  'env -i -u HOME --unset=PATH FOO=1 --',
  '/usr/bin/env',
  'time -p',
  'nice -5',
  'nice --adjustment=3',
  'nohup',
  'command -p',
  'exec -a name -c -l',
  'timeout -k 5 -s KILL --preserve-status 600',
  'gtimeout --signal=TERM 10m',
  'timeout 600 env FOO=1 nice',
  'sudo -u root -E -n -H',
  'sudo --',
];
roundTrip(opts, [
  ...DENIED_PREFIXES.map((prefix) => `${prefix} ${PREFIX_TWO}`),
  'timeout 600 bash -c "node --test tests/a.test.js tests/b.test.js"',
  'bash +o posix -e -c "node --test tests/a.test.js tests/b.test.js"',
]);

test('a prefix command is skipped with its own options, and one it cannot model is not', () => {
  const two = PREFIX_TWO;
  for (const prefix of DENIED_PREFIXES) {
    assert.equal(classifyCommandOrThrow(`${prefix} ${two}`, opts).decision, 'deny', prefix);
  }
  // An option a prefix does not model ends its options: the program is then that option word, never node.
  for (const prefix of ['env -S', 'env --split-string', 'command -v', 'time -o out.txt', 'nice -x', 'timeout --bogus 600', 'timeout --bogus', 'sudo -s']) {
    assert.equal(classifyCommandOrThrow(`${prefix} ${two}`, opts).decision, 'allow', prefix);
  }
  // A prefix may stand in front of a wrapper too, and `+o` pairs are skipped like `-o` ones.
  assert.equal(classifyCommandOrThrow('timeout 600 bash -c "node --test tests/a.test.js tests/b.test.js"', opts).decision, 'deny');
  assert.equal(classifyCommandOrThrow('bash +o posix -e -c "node --test tests/a.test.js tests/b.test.js"', opts).decision, 'deny');
  // A wrapper's `-c` must come before its first non-option word: here `script.sh` is the script.
  assert.equal(classifyCommandOrThrow('bash script.sh -c "node --test tests/a.test.js tests/b.test.js"', opts).decision, 'allow');
});

test('allows everything when no runner is above the working directory', () => {
  assert.deepEqual(classifyCommandOrThrow(DENY_ROWS[0][0], { ...opts, hasRunner: () => null }), { decision: 'allow' });
});

test('never throws', () => {
  assert.deepEqual(classifyCommand(undefined, opts), { decision: 'allow' });
  assert.deepEqual(classifyCommand('', opts), { decision: 'allow' });
  assert.deepEqual(classifyCommand('('.repeat(200000), opts), { decision: 'allow' });
  const throwing = { ...opts, hasRunner: () => { throw new Error('boom'); } };
  assert.deepEqual(classifyCommand('node --test tests/a.test.js tests/b.test.js', throwing), { decision: 'allow' });
  // The inner function lets the same error through, so a throw can never read as a correct allow.
  assert.throws(() => classifyCommandOrThrow('node --test tests/a.test.js tests/b.test.js', throwing), /boom/);
});

const REPLACEMENT_PINS = roundTrip(opts, [
    ['node --test tests/a.test.js tests/b.test.js', 'node tools/run-tests.js tests/a.test.js tests/b.test.js'],
    ['node --test --test-reporter=tap tests/bin-lib/verify/*.test.js', 'node tools/run-tests.js --test-reporter=tap tests/bin-lib/verify/*.test.js'],
    ['FOO=1 /opt/homebrew/bin/node --test tests/a.test.js tests/b.test.js | tail -5', 'FOO=1 node tools/run-tests.js tests/a.test.js tests/b.test.js'],
    ['cd tests && node --test a.test.js b.test.js', 'cd tests && node ../tools/run-tests.js a.test.js b.test.js'],
    ['node --test $(git diff --name-only main)', 'node tools/run-tests.js $(git diff --name-only main)'],
    ['for f in tests/*.test.js; do node "$f"; done', 'node tools/run-tests.js tests/*.test.js'],
    ['for i in 1 2 3; do node --test tests/a.test.js; done', 'node tools/run-tests.js tests/a.test.js'],
    ['npx -y node@20 --test tests/a.test.js tests/b.test.js', 'npx -y node@20 tools/run-tests.js tests/a.test.js tests/b.test.js'],
    ['for f in tests/a.test.js tests/b.test.js; do node --test "$f"; done', 'node tools/run-tests.js tests/a.test.js tests/b.test.js'],
    ['node --test "tests/my file.test.js" tests/b.test.js', 'node tools/run-tests.js "tests/my file.test.js" tests/b.test.js'],
]);

test('the replacement keeps flags, files, assignments and the rest of the pipeline out', () => {
  for (const [command, replacement] of REPLACEMENT_PINS) {
    assert.equal(classifyCommandOrThrow(command, opts).replacement, replacement, command);
  }
});

const SPACED = { ...opts, isDirectory: () => false };
roundTrip(SPACED, ['cd "my tests" && node --test a.test.js b.test.js']);

test('the directory prefix quotes a directory holding a space', () => {
  const spaced = SPACED;
  assert.equal(
    classifyCommandOrThrow('cd "my tests" && node --test a.test.js b.test.js', spaced).replacement,
    'cd "my tests" && node ../tools/run-tests.js a.test.js b.test.js',
  );
});

test('the reason names the four safeguards, the replacement on its own line, --files-from, and the single-file allowance', () => {
  const [command, replacement] = DENY_ROWS[0];
  assert.equal(
    SAFEGUARDS_TEXT,
    'A direct node --test over several files, or in a loop, skips what tools/run-tests.js gives a run: git auto-maintenance off for fixture repos, a per-run TMPDIR removed on exit, the machine-wide suite slot, and bounded file concurrency.',
  );
  assert.equal(classifyCommandOrThrow(command, opts).reason, reasonFor(replacement, { expansion: true }));
});

test('the unresolved-expansion reason says the runner takes test files only', () => {
  assert.equal(
    classifyCommandOrThrow('node --test $(git diff --name-only main)', opts).reason,
    reasonFor('node tools/run-tests.js $(git diff --name-only main)', { expansion: true }),
  );
  const plain = classifyCommandOrThrow('node --test tests/a.test.js tests/b.test.js', opts).reason;
  assert.equal(plain, reasonFor('node tools/run-tests.js tests/a.test.js tests/b.test.js'));
  assert.equal(plain.includes(EXPANSION_LINE), false);
});

roundTrip(opts, [
  'node --env-file .env --test tests/a.test.js tests/b.test.js',
  'node --test -r ./setup.js --trace-warnings tests/a.test.js tests/b.test.js',
  'node --test --test-reporter tap tests/a.test.js tests/b.test.js',
  ...['-e', '--eval', '-p', '--print'].map((flag) => `node --test ${flag} "x" tests/a.test.js tests/b.test.js`),
]);

test('the reason names the node options the runner does not take, as typed', () => {
  assert.equal(
    classifyCommandOrThrow('node --env-file .env --test tests/a.test.js tests/b.test.js', opts).reason,
    reasonFor('node tools/run-tests.js tests/a.test.js tests/b.test.js', { options: '--env-file .env' }),
  );
  assert.equal(
    classifyCommandOrThrow('node --test -r ./setup.js --trace-warnings tests/a.test.js tests/b.test.js', opts).reason,
    reasonFor('node tools/run-tests.js tests/a.test.js tests/b.test.js', { options: '-r ./setup.js --trace-warnings' }),
  );
  // A test flag stays in the line and is no such option.
  assert.equal(
    classifyCommandOrThrow('node --test --test-reporter tap tests/a.test.js tests/b.test.js', opts).reason,
    reasonFor('node tools/run-tests.js --test-reporter tap tests/a.test.js tests/b.test.js'),
  );
});

test('an inline-code option takes its code as a value, and after -- a dash word is a file', () => {
  for (const flag of ['-e', '--eval', '-p', '--print']) {
    assert.equal(
      classifyCommandOrThrow(`node --test ${flag} "x" tests/a.test.js tests/b.test.js`, opts).replacement,
      'node tools/run-tests.js tests/a.test.js tests/b.test.js',
      flag,
    );
  }
  assert.equal(classifyCommandOrThrow('node --test -- tests/a.test.js -x.test.js', opts).decision, 'deny');
});

test('every general node option that takes a value word is read with its value', () => {
  // `node --help` (Node 26.13.1) lists these as `--name=...`; each value here would otherwise be a second file.
  for (const flag of [
    '-r', '--require', '--import', '--loader', '--experimental-loader', '--env-file', '--env-file-if-exists', '-C',
    '--conditions', '--input-type', '--title', '--watch-path', '--inspect-port', '--disable-warning',
    '--redirect-warnings', '--diagnostic-dir', '--max-http-header-size', '--secure-heap', '--secure-heap-min',
    '--debug-port', '--localstorage-file', '--watch-kill-signal', '--unhandled-rejections', '--allow-fs-read',
  ]) {
    assert.equal(classifyCommandOrThrow(`node --test ${flag} v tests/a.test.js`, opts).decision, 'allow', flag);
  }
});

test('win32 paths', () => {
  const win = {
    cwd: 'C:/repo',
    hasRunner: (d) => (/^C:[\\/]repo(?:[\\/]|$)/.test(d) ? 'C:\\repo' : null),
    isDirectory: () => false,
    pathImpl: path.win32,
  };
  assert.equal(classifyCommandOrThrow('node --test tests/a.test.js tests/b.test.js', win).decision, 'deny');
  assert.equal(classifyCommandOrThrow('"C:/nodejs/node.exe" --test tests/a.test.js', win).decision, 'allow');
});

const WIN = {
  cwd: 'C:\\repo',
  hasRunner: (d) => {
    const r = path.win32.resolve(d);
    if (/^C:\\repo(?:\\|$)/i.test(r)) return 'C:\\repo';
    return /^D:\\other(?:\\|$)/i.test(r) ? 'D:\\other' : null;
  },
  isDirectory: (p) => /^C:\\repo\\(?:tests|evals\\tests)$/i.test(p),
  isFile: (p) => /\.js$/.test(p),
  pathImpl: path.win32,
};
const D5_ROWS = roundTrip(WIN, [
  ['cd tests && node --test a.test.js b.test.js', 'cd tests && node ../tools/run-tests.js a.test.js b.test.js'],
  ['cd C:/repo/tests && node --test a.test.js b.test.js', 'cd C:/repo/tests && node ../tools/run-tests.js a.test.js b.test.js'],
  ['node --test D:/other/tests/a.test.js D:/other/tests/b.test.js', 'node D:/other/tools/run-tests.js D:/other/tests/a.test.js D:/other/tests/b.test.js'],
  // The directory was reached by a relative cd, so the prefix is recomputed: across drives, an absolute path.
  ['cd D:/other/tests && cd .. && node --test tests/a.test.js tests/b.test.js', 'cd D:/other && node tools/run-tests.js tests/a.test.js tests/b.test.js'],
]);

test('D5: win32 — the cd prefix, the evals exemption, another drive\'s checkout and a directory across drives', () => {
  const win = WIN;
  for (const [command, replacement] of D5_ROWS) assert.equal(classifyCommandOrThrow(command, win).replacement, replacement, command);
  for (const command of ['cd evals && node --test tests/', 'node --test evals/a.test.js evals/b.test.js', 'cd evals && node --test']) {
    assert.deepEqual(classifyCommandOrThrow(command, win), { decision: 'allow' }, command);
  }
});

// ---- fix wave (#5547 whole-branch review and the 14-day probe) ----

// Checkouts holding the runner: /repo, /other and `/my repo`; /scratch holds none.
const MULTI = {
  ...opts,
  hasRunner: (d) => ['/repo', '/other', '/my repo'].find((r) => d === r || d.startsWith(`${r}/`)) || null,
};

roundTrip(opts, ['node --test $(echo x y) tests/a.test.js']);

test('B1: a backtick or $( that is quoted, escaped or a flag value opens no substitution', () => {
  for (const command of [
    "node --test --test-name-pattern='uses `x' tests/a.test.js",
    "node --test --test-name-pattern='$(foo' tests/a.test.js",
    'node --test --test-name-pattern="\\$(foo" tests/a.test.js',
    'node --test --test-name-pattern $(echo x y) tests/a.test.js',
  ]) {
    assert.deepEqual(classifyCommandOrThrow(command, opts), { decision: 'allow' }, command);
  }
  // A bare substitution still spans its words: here two files remain outside it.
  assert.equal(classifyCommandOrThrow('node --test $(echo x y) tests/a.test.js', opts).decision, 'deny');
});

const B2_ROWS = roundTrip(opts, [
  ['bash -oc pipefail "node --test tests/a.test.js tests/b.test.js"', 'node tools/run-tests.js tests/a.test.js tests/b.test.js'],
  ['bash -O extglob -c "node --test tests/a.test.js tests/b.test.js"', 'node tools/run-tests.js tests/a.test.js tests/b.test.js'],
]);

test('B2: every o or O in a shell option cluster takes one following word', () => {
  for (const [command, replacement] of B2_ROWS) assert.equal(classifyCommandOrThrow(command, opts).replacement, replacement, command);
  const deps = fakeDeps({ '/tmp/loop.sh': 'node --test a.test.js\n' });
  assert.equal(judgeOrThrow(bash('bash -O extglob /tmp/loop.sh', '/repo'), deps).decision, 'deny');
});

const [B3_GLOB] = roundTrip(opts, ['node --test tests/*.test.js']);

test('B3: a replacement the runner would refuse is printed as a placeholder with the runner\'s message', () => {
  const refused = (message) => `The runner refuses the command as typed: ${message}.`;
  const rows = [
    ['node --test tests/x.test.js tests/', refused('tests/x.test.js cannot be combined with the directory root tests/')],
    ['node --test tests/x.test.js tests/helpers/read-skill.js', refused('tests/helpers/read-skill.js is not a *.test.js file')],
    ['node --test tests/a.test.mjs tests/b.test.mjs', refused('tests/a.test.mjs is not a *.test.js file')],
    ['node --test "tests/*.test.js"', refused('tests/*.test.js holds a glob character (one of [ ] { } ( ) ! + @ * ?), which node --test would expand')],
    ['node --test -- tests/a.test.js -x.test.js', refused('unknown option -x.test.js')],
  ];
  for (const [command, note] of rows) {
    const verdict = classifyCommandOrThrow(command, opts);
    assert.equal(verdict.replacement, REFUSED_PLACEHOLDER, command);
    assert.equal(verdict.reason, reasonFor(REFUSED_PLACEHOLDER, { note }), command);
  }
  // An unquoted glob or an expansion is the shell's to expand, so it is left out of the check.
  assert.equal(classifyCommandOrThrow(B3_GLOB, opts).replacement, 'node tools/run-tests.js tests/*.test.js');
  // Without an isFile answer the check is skipped.
  const { isFile: _, ...noIsFile } = opts;
  assert.equal(classifyCommandOrThrow('node --test tests/x.test.js tests/', noIsFile).replacement, 'node tools/run-tests.js tests/x.test.js tests/');
});

test('B3: a named test file that does not exist is printed as a placeholder with the runner\'s message', () => {
  const missing = { ...opts, isFile: (p) => p !== '/repo/tests/missing.test.js' && opts.isFile(p) };
  const verdict = classifyCommandOrThrow('node --test tests/a.test.js tests/missing.test.js', missing);
  assert.equal(verdict.replacement, REFUSED_PLACEHOLDER);
  assert.equal(
    verdict.reason,
    reasonFor(REFUSED_PLACEHOLDER, { note: 'The runner refuses the command as typed: tests/missing.test.js does not exist or is not a file.' }),
  );
});

test('B3: a checkout reached through a symlink still gets a runnable replacement', () => {
  const linked = {
    ...opts,
    cwd: '/link',
    hasRunner: (d) => (d === '/link' || d.startsWith('/link/') ? '/link' : null),
    isFile: (p) => opts.isFile(p.replace(/^\/link(?=\/|$)/, '/repo')),
    realpath: (p) => p.replace(/^\/link(?=\/|$)/, '/repo'),
  };
  assert.equal(
    classifyCommandOrThrow('node --test tests/a.test.js tests/b.test.js', linked).replacement,
    'node tools/run-tests.js tests/a.test.js tests/b.test.js',
  );
});

const QUOTED_DIRS = roundTrip(SPACED, [
  ["cd 'x;y' && node --test a.test.js b.test.js", 'cd "x;y" && node ../tools/run-tests.js a.test.js b.test.js'],
  ["cd \"it's\" && node --test a.test.js b.test.js", "cd \"it's\" && node ../tools/run-tests.js a.test.js b.test.js"],
]);

test('the directory prefix quotes a directory holding a shell metacharacter', () => {
  for (const [command, replacement] of QUOTED_DIRS) {
    assert.equal(classifyCommandOrThrow(command, SPACED).replacement, replacement, command);
  }
});

const B4_ROWS = roundTrip(MULTI, [
  ['NODE_PATH="/repo/node_modules" node --test "/other/tests/a.test.js" "/other/tests/b.test.js"', 'NODE_PATH="/repo/node_modules" node /other/tools/run-tests.js "/other/tests/a.test.js" "/other/tests/b.test.js"'],
  ['node --test "/my repo/tests/a.test.js" "/my repo/tests/b.test.js"', 'node "/my repo/tools/run-tests.js" "/my repo/tests/a.test.js" "/my repo/tests/b.test.js"'],
  ['node --test $(ls /other/tests)', 'node tools/run-tests.js $(ls /other/tests)'],
]);

test('B4: the operands decide the checkout', () => {
  // All files in another checkout: that checkout's runner, quoted when its path holds a space.
  assert.equal(classifyCommandOrThrow(B4_ROWS[0][0], MULTI).reason, reasonFor(B4_ROWS[0][1]));
  assert.equal(classifyCommandOrThrow(B4_ROWS[1][0], MULTI).replacement, B4_ROWS[1][1]);
  // No runner above any file: outside the runner's reach, even from inside a checkout.
  assert.deepEqual(classifyCommandOrThrow('node --test /scratch/tests/a.test.js /scratch/tests/b.test.js', MULTI), { decision: 'allow' });
  // Files spread over two checkouts, or over a checkout and none.
  const many = "The files sit in more than one checkout; run each checkout's files through its own tools/run-tests.js.";
  for (const command of ['node --test tests/a.test.js /other/tests/b.test.js', 'node --test tests/a.test.js /scratch/tests/b.test.js']) {
    assert.equal(classifyCommandOrThrow(command, MULTI).reason, reasonFor(REFUSED_PLACEHOLDER, { note: many }), command);
  }
  // An expansion is placed by the working directory, as before.
  assert.equal(classifyCommandOrThrow(B4_ROWS[2][0], MULTI).replacement, B4_ROWS[2][1]);
});

roundTrip(opts, ['node --test evals/x.test.js tests/a.test.js tests/b.test.js']);

test('B5: the evals/ exemption needs every file under evals/', () => {
  assert.equal(classifyCommandOrThrow('node --test evals/x.test.js tests/a.test.js tests/b.test.js', opts).decision, 'deny');
  assert.equal(classifyCommandOrThrow('node --test evals/x.test.js evals/y.test.js', opts).decision, 'allow');
});

const B6_ROWS = roundTrip(opts, [
  ['node --test --test-reporter=tap', 'node tools/run-tests.js --full --test-reporter=tap'],
  ['cd scripts && node --test --test-name-pattern x', 'cd scripts && node ../tools/run-tests.js --full --test-name-pattern x'],
]);

test('B6: a run with no file operand gets --full and keeps its test flags', () => {
  for (const [command, replacement] of B6_ROWS) assert.equal(classifyCommandOrThrow(command, opts).replacement, replacement, command);
});

// The relative-value line is printed when the replacement runs anywhere but the root of the checkout whose
// runner it names: a cd prefix, another checkout's runner, or a subdirectory the call was typed from.
const IN_TESTS = { ...opts, cwd: '/repo/tests' };
const B7_ROWS = [
  ...roundTrip(opts, [['cd tests && node --test --test-reporter-destination=out.tap a.test.js b.test.js', 'cd tests && node ../tools/run-tests.js --test-reporter-destination=out.tap a.test.js b.test.js', opts]]),
  ...roundTrip(MULTI, [['node --test --test-reporter-destination out.tap /other/tests/a.test.js /other/tests/b.test.js', 'node /other/tools/run-tests.js --test-reporter-destination out.tap /other/tests/a.test.js /other/tests/b.test.js', MULTI]]),
  ...roundTrip(IN_TESTS, [['node --test --test-reporter-destination=out.tap a.test.js b.test.js', 'node ../tools/run-tests.js --test-reporter-destination=out.tap a.test.js b.test.js', IN_TESTS]]),
];
const B7_QUIET = [
  ...roundTrip(opts, [
    ['cd tests && node --test --test-reporter-destination=/tmp/out.tap a.test.js b.test.js', opts],
    ['cd tests && node --test --test-reporter-destination=stdout a.test.js b.test.js', opts],
    ['node --test --test-reporter-destination=out.tap tests/a.test.js tests/b.test.js', opts],
  ]),
  // A cd into the checkout root itself runs the replacement where the runner reads the value.
  ...roundTrip(IN_TESTS, [['cd /repo && node --test --test-reporter-destination=out.tap tests/a.test.js tests/b.test.js', IN_TESTS]]),
];

test('B7 R5: a relative path in a flag value is named when the replacement runs anywhere but the runner\'s checkout root', () => {
  for (const [command, replacement, o] of B7_ROWS) {
    assert.equal(classifyCommandOrThrow(command, o).reason, reasonFor(replacement, { relative: true }), command);
  }
  // An absolute value, stdout, or the root itself needs no line.
  for (const [command, o] of B7_QUIET) {
    const verdict = classifyCommandOrThrow(command, o);
    assert.equal(verdict.decision, 'deny', command);
    assert.equal(verdict.reason.includes(RELATIVE_VALUE_LINE), false, command);
  }
});

const B8_ROWS = roundTrip(opts, [
  ['cd /repo/tests && node --test a.test.js b.test.js', 'cd /repo/tests && node ../tools/run-tests.js a.test.js b.test.js'],
  ['cd "/repo/tests" && node --test a.test.js b.test.js', 'cd "/repo/tests" && node ../tools/run-tests.js a.test.js b.test.js'],
  // A relative one is recomputed from the call's directory.
  ['cd tests && cd .. && cd tests && node --test a.test.js b.test.js', 'cd tests && node ../tools/run-tests.js a.test.js b.test.js'],
]);

test('B8: a cd prefix keeps a directory typed as an absolute path', () => {
  for (const [command, replacement] of B8_ROWS) assert.equal(classifyCommandOrThrow(command, opts).replacement, replacement, command);
});

// Shortened from the three probe commands; the body is kept by the scanner in each (its reader is not the
// segment's lead, or the heredoc follows a pipeline).
const G1_BODIES = [
  "cp a.js /repo/s/mutb/tests/ && cat >> /repo/s/mutb/tests/q.test.js <<'EOF'\n  test('x', (t) => {\n    for (const f of FAULTS) {\n      t.diagnostic(f);\n    }\n  });\nEOF\ncd /repo/s/mutb && node --test --test-name-pattern=ZZPROBE tests/q.test.js 2>&1 | grep -E \"CARVE\"",
  "sed -n 1,30p tests/x.test.js | grep -n \"require\" && python3 - <<'EOF'\npairs=[]\nfor old,new in pairs:\n    s=s.replace(old,new)\nEOF\nnode --test tests/x.test.js > out.txt 2>&1",
  "sed -n 14,24p tests/run.test.js && cat >> tests/run.test.js <<'EOF'\nfor (const c of calls) {\n  check(c);\n}\nEOF\nnode --test --test-name-pattern=\"#5232\" tests/run.test.js > t1.txt 2>&1",
];
const G1_LOOPED = roundTrip(opts, G1_BODIES.map((c) => `${c}\ncd /repo && for f in tests/a.test.js tests/b.test.js; do node --test "$f"; done`));

test('G1: a loop keyword inside a heredoc body opens no loop', () => {
  for (const command of G1_BODIES) assert.deepEqual(classifyCommandOrThrow(command, opts), { decision: 'allow' }, command);
  for (const looped of G1_LOOPED) {
    assert.equal(classifyCommandOrThrow(looped, opts).replacement, 'node tools/run-tests.js tests/a.test.js tests/b.test.js', looped);
  }
  // A while header needs its do too.
  assert.deepEqual(classifyCommandOrThrow("sed -n 1p x | grep y && python3 - <<'EOF'\nwhile True:\n    break\nEOF\nnode --test tests/a.test.js", opts), { decision: 'allow' });
  // R3: a JavaScript `for (const x of y) {` body line, then a later single-file run.
  assert.deepEqual(classifyCommandOrThrow("sed -n 1p x | grep y && cat >> t.js <<'EOF'\nfor (const x of y) {\n  go(x);\n}\nEOF\nnode --test tests/a.test.js", opts), { decision: 'allow' });
});

test('G2: a substitution the scanner cut at a pipe is named, not pasted', () => {
  const note = 'The command substitution could not be read whole; put the same substitution after the runner path.';
  for (const command of [
    'node --test $(ls tests/*.test.js | head -1)',
    "node --test $(grep -rl 'plugin-structure' tests | grep '\\.test\\.js$') > out.txt",
  ]) {
    assert.equal(classifyCommandOrThrow(command, opts).reason, reasonFor(REFUSED_PLACEHOLDER, { note }), command);
  }
});

const G3_ROWS = roundTrip(opts, [
    ['for f in delete-ledger-verb resolve-ledger-verb; do echo "== $f"; node --test tests/$f.test.js 2>&1 | grep -E "^# (tests|pass)"; done', 'node tools/run-tests.js tests/delete-ledger-verb.test.js tests/resolve-ledger-verb.test.js 2>&1'],
    ['for s in 1 2 3; do node --test --test-randomize --test-random-seed=$s tests/hooks-js-flag-strict.test.js 2>&1 | grep -E "^ℹ (pass|fail)"; done', 'node tools/run-tests.js --test-randomize tests/hooks-js-flag-strict.test.js 2>&1'],
    ['cd tests && for f in policy-schema declare-opt-out; do echo $f; node --test $f.test.js 2>&1 | grep x; done', 'cd tests && node ../tools/run-tests.js policy-schema.test.js declare-opt-out.test.js 2>&1'],
    ['for i in 1 2; do node --test tests/a.test.js tests/a.test.js; done', 'node tools/run-tests.js tests/a.test.js'],
    // A redirection naming the loop variable is left out with its operator.
    ['for i in 1 2 3; do node --test tests/a.test.js tests/b.test.js > "out/f$i.txt" 2>&1; grep -c x "out/f$i.txt"; done', 'node tools/run-tests.js tests/a.test.js tests/b.test.js 2>&1'],
]);

test('G3: a looped run whose files are knowable gets them, each once', () => {
  for (const [command, replacement] of G3_ROWS) assert.equal(classifyCommandOrThrow(command, opts).replacement, replacement, command);
  // Files read from stdin or from an expanded word list stay unknown.
  assert.equal(classifyCommandOrThrow('xargs node --test < list.txt', opts).replacement, PLACEHOLDER);
  assert.equal(classifyCommandOrThrow('for f in $(grep -l x tests); do node --test tests/$f; done', opts).replacement, PLACEHOLDER);
});

// ---- targeted fix after the fix wave's re-review ----

// R1: a symlinked spelling of a checkout's directory is placed in that checkout. `/scratch/lnk` stands for
// a link to /repo/tests: hasRunner and realpath answer as realDeps does for one.
const LINKED = {
  ...opts,
  hasRunner: (d) => (d === '/scratch/lnk' || d.startsWith('/scratch/lnk/') ? '/repo' : opts.hasRunner(d)),
  realpath: (p) => (p.startsWith('/scratch/lnk/') ? `/repo/tests/${p.slice('/scratch/lnk/'.length)}` : p),
};
const R1_ROWS = roundTrip(LINKED, [
  ['node --test /scratch/lnk/a.test.js /scratch/lnk/b.test.js', 'node tools/run-tests.js /scratch/lnk/a.test.js /scratch/lnk/b.test.js'],
]);

test('R1: a symlinked spelling of a checkout directory does not escape the checkout', () => {
  for (const [command, replacement] of R1_ROWS) assert.equal(classifyCommandOrThrow(command, LINKED).replacement, replacement, command);
});

test('R1: realDeps places a temp symlink into this checkout\'s tests/ in this checkout', {
  skip: process.platform === 'win32' && 'creating a symlink on Windows needs a privilege the CI user lacks',
}, () => {
  withTempDir((dir) => {
    fs.symlinkSync(path.join(ROOT, 'tests'), path.join(dir, 'lnk'));
    const a = path.join(dir, 'lnk', 'direct-test-run-guard.test.js');
    const b = path.join(dir, 'lnk', 'run-tests-isolation.test.js');
    const verdict = classifyCommandOrThrow(`node --test ${a} ${b}`, { ...realDeps(), cwd: ROOT });
    const real = fs.realpathSync(ROOT);
    const runner = real === ROOT ? 'tools/run-tests.js' : `"${real}/tools/run-tests.js"`;
    assert.equal(verdict.replacement, `node ${runner} ${a} ${b}`);
    assert.equal(realDeps().realpath(path.join(dir, 'lnk', 'missing', 'x.test.js')), path.join(real, 'tests', 'missing', 'x.test.js'));
  });
});

test('R2: a looped replacement names the words it left out', () => {
  assert.equal(
    classifyCommandOrThrow('for s in 1 2 3; do node --test --test-random-seed=$s tests/a.test.js; done', opts).reason,
    reasonFor('node tools/run-tests.js tests/a.test.js', { leftOut: '--test-random-seed=$s' }),
  );
  assert.equal(
    classifyCommandOrThrow('for i in 1 2; do node --test --test-name-pattern "$i" tests/a.test.js tests/b.test.js > "out/f$i.txt"; done', opts).reason,
    reasonFor('node tools/run-tests.js tests/a.test.js tests/b.test.js', { leftOut: '--test-name-pattern "$i" > "out/f$i.txt"' }),
  );
});

// R6: an unquoted leading `~` is the home directory the `homedir` option names.
const HOME_OUT = { ...opts, homedir: '/home/u' };
const HOME_IN = { ...opts, homedir: '/repo/h' };
const R6_DENY_ROWS = [
  ...roundTrip(HOME_IN, [['node --test ~/x/a.test.js ~/x/b.test.js', 'node tools/run-tests.js ~/x/a.test.js ~/x/b.test.js', HOME_IN]]),
  // A quoted `~` is a literal directory name, and `~user` stays unknown: both are placed under the cwd.
  ...roundTrip(HOME_OUT, [
    ['node --test "~/x/a.test.js" "~/x/b.test.js"', 'node tools/run-tests.js "~/x/a.test.js" "~/x/b.test.js"', HOME_OUT],
    ['node --test ~user/x/a.test.js ~user/x/b.test.js', 'node tools/run-tests.js ~user/x/a.test.js ~user/x/b.test.js', HOME_OUT],
  ]),
  // Without the option the word is read as before.
  ...roundTrip(opts, [['node --test ~/x/a.test.js ~/x/b.test.js', 'node tools/run-tests.js ~/x/a.test.js ~/x/b.test.js', opts]]),
];

test('R6: a ~ operand is placed in the home directory', () => {
  assert.deepEqual(classifyCommandOrThrow('node --test ~/x/a.test.js ~/x/b.test.js', HOME_OUT), { decision: 'allow' });
  for (const [command, replacement, o] of R6_DENY_ROWS) assert.equal(classifyCommandOrThrow(command, o).replacement, replacement, command);
  assert.equal(typeof realDeps().homedir, 'string');
});

// R8: a `for` list word's unquoted leading `~` is the home directory too. HOME_FILES' test files exist only
// under the home directory, so a `~` the guard left unexpanded reads as a missing file there.
const HOME_FILES = { ...HOME_IN, isFile: (p) => p.startsWith('/repo/h/') && opts.isFile(p) };
const R8_FOR = 'for f in ~/x/a.test.js ~/x/b.test.js; do node --test "$f"; done';
const R8_QUOTED = 'for f in "~/x/a.test.js" "~/x/b.test.js"; do node --test "$f"; done';
const R8_DENY_ROWS = [
  ...roundTrip(HOME_FILES, [[R8_FOR, 'node tools/run-tests.js ~/x/a.test.js ~/x/b.test.js', HOME_FILES]]),
  // A quoted `~` is a literal directory name: placed under the cwd, as typed.
  ...roundTrip(HOME_OUT, [[R8_QUOTED, 'node tools/run-tests.js "~/x/a.test.js" "~/x/b.test.js"', HOME_OUT]]),
];

test('R8: a for loop over ~ words outside every checkout is allowed', () => {
  assert.deepEqual(classifyCommandOrThrow(R8_FOR, HOME_OUT), { decision: 'allow' });
});

test('R8: a ~ word in a for list is the home directory, and a quoted one is not', () => {
  for (const [command, replacement, o] of R8_DENY_ROWS) assert.equal(classifyCommandOrThrow(command, o).replacement, replacement, command);
  // Under HOME_FILES the quoted word names the cwd's `~` directory, where no test file exists.
  assert.equal(
    classifyCommandOrThrow(R8_QUOTED, HOME_FILES).reason,
    reasonFor(REFUSED_PLACEHOLDER, { note: 'The runner refuses the command as typed: ~/x/a.test.js does not exist or is not a file.' }),
  );
});

test('R7: a direct test run\'s operand is a test file, not a script to scan', () => {
  const text = "const { spawnSync } = require('child_process'); const cmd = 'node --test tests/a.test.js tests/b.test.js';";
  const deps = fakeDeps({ '/tmp/copies/direct-test-run-guard.test.js': text, '/tmp/mutant-run.js': text });
  assert.deepEqual(judgeOrThrow(bash('node --test /tmp/copies/direct-test-run-guard.test.js', '/repo'), deps), { decision: 'allow' });
  assert.deepEqual(judgeOrThrow(bash('node /tmp/copies/direct-test-run-guard.test.js', '/repo'), deps), { decision: 'allow' });
  assert.equal(judgeOrThrow(bash('node /tmp/mutant-run.js', '/repo'), deps).decision, 'deny');
});

test('hasDirectTestRun finds a single-file run and ignores quoted text', () => {
  const o = { cwd: '/repo', pathImpl: path.posix };
  assert.equal(hasDirectTestRun('node --test tests/a.test.js', o), true);
  assert.equal(hasDirectTestRun('sh -c "node tests/a.test.js"', o), true);
  assert.equal(hasDirectTestRun('for f in x; do node --test "$f"; done', o), true);
  assert.equal(hasDirectTestRun('echo "node --test a.test.js"', o), false);
  assert.equal(hasDirectTestRun('node tools/run-tests.js tests/a.test.js', o), false);
});

// ---- the script scan, the hook entry and the registration ----

const ROOT = path.resolve(__dirname, '..');
const GUARD = path.join(ROOT, 'tools', 'direct-test-run-guard.js');
const OFFENDING_JS = "const { spawnSync } = require('child_process'); spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'tests/a.test.js']);";
const RUNNER_JS = "const { spawnSync } = require('child_process'); spawnSync(process.execPath, ['tools/run-tests.js', '--test-reporter=tap', 'tests/a.test.js']);";

// `ref` is the node reference as found in a JavaScript script; `literal` the string literal of a JavaScript
// script that holds a direct test run as a command; `runText` the first direct test run of a shell script
// (exactly one of the three).
function scriptReasonFor(word, { ref, literal, runText }) {
  let matched;
  if (ref !== undefined) matched = `Matched in the script: the string literal '--test', a child_process reference, and a node program (${ref}).`;
  else if (literal !== undefined) matched = `Matched in the script: a string literal that runs node --test as a command, and a child_process reference (${literal}).`;
  else matched = `Matched in the script: ${runText}`;
  return [
    `This repository's guard blocked a script that starts node --test itself: ${word}. ${SAFEGUARDS_TEXT}`,
    matched,
    'Have the script start the runner instead, from inside the checkout it tests, with the same flags and files:',
    '',
    'node tools/run-tests.js --test-reporter=tap <files>',
    '',
    'In JavaScript: spawnSync(process.execPath, [\'tools/run-tests.js\', ...flags, ...files], { cwd: checkoutRoot }). The exit code and stdout are node\'s own.',
    'In a checkout older than this guard, write the files to a list and use: node tools/run-tests.js --files-from <list>',
    'If the script does not start a test run, the match is on its text: see the Matched line above.',
  ].join('\n');
}

// A command fixture names a path under this directory through shellQuote: an unquoted Windows path loses
// its backslashes as a bash word, so the guard would look for a file that is not there and allow.
function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'direct-test-run-guard-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const bash = (command, cwd = ROOT) => ({ tool_name: 'Bash', cwd, tool_input: { command } });

// ---- the sh prefilter (#5794) ----

// win32 skips dash even when one is on PATH: the windows-latest runner has a dash that cannot exec a
// Windows-form path (C:\...\node.exe), measured in windows-regression run 43647466952 (tests/hooks-launcher.test.js).
const WIN32_DASH_SKIP = 'win32: dash cannot exec a Windows-form path (C:\\...\\node.exe), measured in windows-regression run 43647466952; Claude Code runs Windows hooks under Git Bash sh, covered by [sh]';
const PREFILTER_SHELLS = [
  { name: 'sh', file: findOnPath('sh') },
  process.platform === 'win32'
    ? { name: 'dash', file: null, skipReason: WIN32_DASH_SKIP }
    : { name: 'dash', file: findOnPath('dash') },
  { name: 'bash', file: findOnPath('bash') },
];
// One test per shell; sh is required, dash and bash skip by name when missing.
function perPrefilterShell(title, fn) {
  for (const sh of PREFILTER_SHELLS) {
    const missing = !sh.file;
    if (missing && sh.name === 'sh') {
      test(`${title} [sh]`, () => assert.fail('sh not found on PATH'));
      continue;
    }
    test(`${title} [${sh.name}]`, { skip: missing && (sh.skipReason || `${sh.name} not on PATH`) }, () => fn(sh));
  }
}

const PREFILTER = path.join(ROOT, 'tools', 'direct-test-run-guard.sh');
// One PreToolUse payload as Claude Code 2.1.325 writes it (captured 2026-11-16): one compact JSON line.
const hookPayload = (command, extra = {}) => JSON.stringify({
  session_id: '1c62e9ba-c9f3-4896-a17e-e1f7fa768871',
  transcript_path: '/home/u/.claude/projects/-repo/1c62e9ba-c9f3-4896-a17e-e1f7fa768871.jsonl',
  cwd: ROOT,
  prompt_id: '6ee4cc1c-2e11-418f-960f-ba371fab8215',
  permission_mode: 'default',
  effort: { level: 'medium' },
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command, description: 'Run it', ...extra },
  tool_use_id: 'toolu_014brzUtdmTepXVxeaXhFJAj',
});
// Sources the prefilter once (its test seam) and asks it about each line of stdin.
const PREFILTER_DRIVER = 'DIRECT_TEST_RUN_GUARD_LIB=1; . "$1"; while IFS= read -r l || [ -n "$l" ]; do if direct_test_run_guard_needs_node "$l"; then echo node; else echo skip; fi; done';
function prefilterVerdicts(shellFile, payloadLines, { env = process.env, cwd } = {}) {
  const res = spawnSync(shellFile, ['-c', PREFILTER_DRIVER, 'sh', PREFILTER], {
    input: payloadLines.join('\n') + '\n', encoding: 'utf8', env, cwd, timeout: 30000, killSignal: 'SIGKILL', windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stderr, '');
  const verdicts = res.stdout.split('\n').filter(Boolean);
  assert.equal(verdicts.length, payloadLines.length);
  return verdicts;
}

// Fake deps over a map of absolute path -> script text; `/repo` holds the runner.
function fakeDeps(files) {
  const has = (p) => Object.prototype.hasOwnProperty.call(files, p);
  return {
    hasRunner: (d) => (d === '/repo' || d.startsWith('/repo/') ? '/repo' : null),
    isDirectory: () => false,
    readScript: (p) => (has(p) ? files[p] : null),
    readHead: (p, bytes) => (has(p) ? files[p].slice(0, bytes) : null),
    pathImpl: path.posix,
  };
}

test('AC8.1: a scratch script that spawns node --test is denied, and allowed once it spawns the runner', () => {
  withTempDir((dir) => {
    const file = path.join(dir, 'mutant-run.js');
    fs.writeFileSync(file, OFFENDING_JS);
    const verdict = judgeOrThrow(bash(`node ${shellQuote(file)}`), realDeps());
    assert.equal(verdict.decision, 'deny');
    assert.equal(verdict.reason, scriptReasonFor(file, { ref: 'process.execPath' }));

    fs.writeFileSync(file, RUNNER_JS);
    assert.deepEqual(judgeOrThrow(bash(`node ${shellQuote(file)}`), realDeps()), { decision: 'allow' });
    fs.writeFileSync(file, "spawnSync(process.execPath, ['--test', 'tests/a.test.js']);");
    assert.deepEqual(judgeOrThrow(bash(`node ${shellQuote(file)}`), realDeps()), { decision: 'allow' });
    fs.writeFileSync(file, "const cp = require('child_process'); cp.spawnSync('node', ['--test-only']);");
    assert.deepEqual(judgeOrThrow(bash(`node ${shellQuote(file)}`), realDeps()), { decision: 'allow' });
  });
});

test('AC8.1: a script is found behind a prefix command, a cd, and a program path', () => {
  const files = { '/tmp/mutant-run.js': OFFENDING_JS, '/tmp/loop.sh': 'node --test a.test.js' };
  const deps = fakeDeps(files);
  const js = { ref: 'process.execPath' };
  const sh = { runText: 'node --test a.test.js' };
  const rows = [
    ['node /tmp/mutant-run.js', '/tmp/mutant-run.js', js],
    ['timeout 600 node /tmp/mutant-run.js', '/tmp/mutant-run.js', js],
    ['env X=1 node --no-warnings /tmp/mutant-run.js', '/tmp/mutant-run.js', js],
    ['cd /tmp && node mutant-run.js', 'mutant-run.js', js],
    ['bash /tmp/loop.sh', '/tmp/loop.sh', sh],
    ['/tmp/loop.sh', '/tmp/loop.sh', sh],
    ['/tmp/mutant-run.js', '/tmp/mutant-run.js', js],
    ['sh -c "node /tmp/mutant-run.js"', '/tmp/mutant-run.js', js],
  ];
  for (const [command, word, matched] of rows) {
    const verdict = judgeOrThrow(bash(command, '/repo'), deps);
    assert.equal(verdict.decision, 'deny', command);
    assert.equal(verdict.reason, scriptReasonFor(word, matched), command);
  }
  // The same rows over a harmless script allow, so each deny above is decided by the script's text.
  const harmless = fakeDeps({ '/tmp/mutant-run.js': 'console.log(1)', '/tmp/loop.sh': 'echo done' });
  for (const [command] of rows) assert.deepEqual(judgeOrThrow(bash(command, '/repo'), harmless), { decision: 'allow' }, command);
});

test('a script operand is the first non-option word, and inline code and -c forms run no file', () => {
  const deps = fakeDeps({ '/tmp/mutant-run.js': OFFENDING_JS });
  assert.equal(judgeOrThrow(bash('node -r ./hook.js /tmp/mutant-run.js', '/repo'), deps).decision, 'deny');
  assert.equal(judgeOrThrow(bash('node --no-warnings /tmp/mutant-run.js arg', '/repo'), deps).decision, 'deny');
  assert.equal(judgeOrThrow(bash('bash -c "echo /tmp/mutant-run.js"', '/repo'), deps).decision, 'allow');
  assert.equal(judgeOrThrow(bash('echo /tmp/mutant-run.js', '/repo'), deps).decision, 'allow');
  assert.equal(judgeOrThrow(bash('cat /tmp/mutant-run.js', '/repo'), deps).decision, 'allow');
});

// Each row is decided by the one scan rule it names: with that rule deleted, its verdict flips.
const SCAN_RULE_ROWS = [
  ['the -o value skip of a shell', 'bash -o pipefail /tmp/loop.sh', 'deny'],
  ['a shell short-option cluster', 'bash -x /tmp/loop.sh', 'deny'],
  ['a shell long option', 'bash --norc /tmp/loop.sh', 'deny'],
  ['a shell -- ends the options', 'cd /repo/sub && bash -- -x', 'deny'],
  ['a redirect operator and its target', 'node > out.txt /tmp/mutant-run.js', 'deny'],
  ['a glued redirect', 'node >out.txt /tmp/mutant-run.js', 'deny'],
  ['a node -- ends the options', 'cd /tmp && node -- -mutant.js', 'deny'],
  ['a node -- before a path', 'node -- /tmp/mutant-run.js', 'deny'],
  ['inline code is no script', 'node -e /tmp/mutant-run.js', 'allow'],
  ['inline code with = is no script', 'node --eval=/tmp/mutant-run.js', 'allow'],
  ['a node value option takes its value', 'node -r /tmp/hook.js /tmp/mutant-run.js', 'deny'],
  ['a node test value option takes its value', 'node --test-reporter spec /tmp/mutant-run.js', 'deny'],
  ['a program with no words after the prefix', 'timeout 600', 'allow'],
  ['node reads a script from stdin', 'node < /tmp/mutant-run.js', 'deny'],
  ['source skips a redirect operator', 'source > out /tmp/loop.sh', 'deny'],
  ['source skips a glued redirect', 'source >out /tmp/loop.sh', 'deny'],
  ['a program word without a slash is no path', 'runner', 'allow'],
  ['node runs a .sh file as JavaScript', 'node /tmp/script.sh', 'deny'],
  ['a shell runs a .js file as JavaScript', 'bash /tmp/shellrun.js', 'deny'],
  ['inline code reads its stdin as data', 'node -e "1" < /tmp/mutant-run.js', 'allow'],
  ['inline print reads its stdin as data', 'node -p "1" < /tmp/mutant-run.js', 'allow'],
  ['inline eval= reads its stdin as data', 'node --eval=1 < /tmp/mutant-run.js', 'allow'],
  ['a -c wrapper reads its stdin as data', 'bash -c "cat" < /tmp/loop.sh', 'allow'],
  ['a shell with no operand runs its stdin', 'bash < /tmp/loop.sh', 'deny'],
];

test('each scan rule is decided by its own input', () => {
  const deps = fakeDeps({
    '/tmp/mutant-run.js': OFFENDING_JS, '/tmp/loop.sh': 'node --test a.test.js', '/repo/sub/-x': 'node --test a.test.js', '/tmp/-mutant.js': OFFENDING_JS,
    '/repo/runner': '#!/bin/bash\nnode --test a.test.js b.test.js\n', '/tmp/script.sh': OFFENDING_JS, '/tmp/shellrun.js': OFFENDING_JS,
  });
  for (const [rule, command, decision] of SCAN_RULE_ROWS) {
    assert.equal(judgeOrThrow(bash(command, '/repo'), deps).decision, decision, `${rule}: ${command}`);
  }
});

test('a program run by path is a script whatever its extension, decided by its first line', () => {
  const two = 'node --test a.test.js b.test.js\n';
  const run = (text, command = '/tmp/runner') => judgeOrThrow(bash(command, '/repo'), fakeDeps({ '/tmp/runner': text, '/tmp/other.py': text }));
  const denied = run(`#!/usr/bin/env bash\n${two}`);
  assert.equal(denied.decision, 'deny');
  assert.equal(denied.reason, scriptReasonFor('/tmp/runner', { runText: 'node --test a.test.js b.test.js' }));
  assert.equal(run(`#!/bin/sh\n${two}`).decision, 'deny');
  assert.equal(run(`#!/bin/zsh -e\n${two}`).decision, 'deny');
  assert.equal(run(`#!/usr/bin/env node\n${OFFENDING_JS}`).decision, 'deny');
  assert.equal(run(`#!/usr/bin/node\n${OFFENDING_JS}`).decision, 'deny');
  // env's own options and assignments are skipped to reach the interpreter.
  assert.equal(run(`#!/usr/bin/env -S node --no-warnings\n${OFFENDING_JS}`).decision, 'deny');
  assert.equal(run(`#!/usr/bin/env -S bash -x\n${two}`).decision, 'deny');
  assert.equal(run(`#!/usr/bin/env -i bash\n${two}`).decision, 'deny');
  assert.equal(run(`#!/usr/bin/env -u HOME bash\n${two}`).decision, 'deny');
  assert.equal(run(`#!/usr/bin/env FOO=1 bash\n${two}`).decision, 'deny');
  assert.equal(run(`#!/usr/bin/env -- bash\n${two}`).decision, 'deny');
  assert.deepEqual(run(`#!/usr/bin/env -S python3 -u\n${two}`), { decision: 'allow' });
  assert.deepEqual(run(`#!/usr/bin/env -S\n${two}`), { decision: 'allow' });
  assert.equal(run(`#!/usr/bin/env bash\n${two}`, '/tmp/other.py').decision, 'deny');
  assert.deepEqual(run(`#!/usr/bin/env python3\n${two}`), { decision: 'allow' });
  assert.deepEqual(run(`#!/usr/bin/env bash\necho done\n`), { decision: 'allow' });
  assert.deepEqual(run(`${two}`), { decision: 'allow' });
  assert.deepEqual(run(`#!/usr/bin/env\n${two}`), { decision: 'allow' });
  // The size check and the skipped directories come before any read.
  const unreadable = { ...fakeDeps({}), readScript: () => { throw new Error('read must not happen'); } };
  assert.deepEqual(judgeOrThrow(bash('./tools/runner', '/repo'), unreadable), { decision: 'allow' });
  assert.deepEqual(judgeOrThrow(bash('/usr/bin/true'), realDeps()), { decision: 'allow' });
  assert.deepEqual(judgeOrThrow(bash('/no/such/runner'), realDeps()), { decision: 'allow' });
});

test('source and . scan their file as shell, and so does a shell fed a file on stdin', () => {
  const deps = fakeDeps({ '/tmp/loop.sh': 'node --test a.test.js b.test.js\n' });
  const harmless = fakeDeps({ '/tmp/loop.sh': 'echo done\n' });
  const reason = scriptReasonFor('/tmp/loop.sh', { runText: 'node --test a.test.js b.test.js' });
  for (const command of ['source /tmp/loop.sh', '. /tmp/loop.sh', 'sh < /tmp/loop.sh', 'bash < /tmp/loop.sh', 'zsh < /tmp/loop.sh', 'bash </tmp/loop.sh']) {
    const verdict = judgeOrThrow(bash(command, '/repo'), deps);
    assert.equal(verdict.decision, 'deny', command);
    assert.equal(verdict.reason, reason, command);
    assert.deepEqual(judgeOrThrow(bash(command, '/repo'), harmless), { decision: 'allow' }, command);
  }
  // A here-string or here-document is no file.
  assert.deepEqual(judgeOrThrow(bash('bash <<< /tmp/loop.sh', '/repo'), deps), { decision: 'allow' });
  assert.deepEqual(judgeOrThrow(bash('bash << /tmp/loop.sh', '/repo'), deps), { decision: 'allow' });
  // Glued forms: a file named like the redirect text exists, so only the rule that excludes `<<` decides.
  const odd = fakeDeps({ '/repo/<EOF': 'node --test a.test.js b.test.js\n', '/repo/<<x': 'node --test a.test.js b.test.js\n' });
  assert.deepEqual(judgeOrThrow(bash('bash <<EOF', '/repo'), odd), { decision: 'allow' });
  assert.deepEqual(judgeOrThrow(bash('bash <<<x', '/repo'), odd), { decision: 'allow' });
});

test('C1: a string that runs node --test as a command is matched, under the child_process condition', () => {
  const rows = [
    ["const { execSync } = require('child_process'); for (const f of files) execSync('node --test ' + f);", { literal: "'node --test '" }],
    ["const cp = require('child_process'); cp.execSync(`node --test --test-reporter=tap ${files.join(' ')}`);", { literal: "`node --test --test-reporter=tap ${files.join(' ')}`" }],
    ["require('child_process').spawnSync('node --test a.test.js b.test.js', { shell: true });", { literal: "'node --test a.test.js b.test.js'" }],
    ["require('child_process').spawnSync('bash', ['-c', 'node --test a b']);", { literal: "'node --test a b'" }],
    // A node@<version> string is a node program for the argument-array rule.
    ["require('child_process').spawnSync('npx', ['-y', 'node@20', '--test', ...files]);", { ref: "'node@20'" }],
  ];
  for (const [text, matched] of rows) {
    const verdict = judgeOrThrow(bash('node /tmp/s.js', '/repo'), fakeDeps({ '/tmp/s.js': text }));
    assert.equal(verdict.reason, scriptReasonFor('/tmp/s.js', matched), text);
  }
  // The literal is quoted trimmed to 120 characters.
  const long = `require('child_process').execSync('node --test ${'abcdefgh.test.js '.repeat(10)}');`;
  const literal = `'node --test ${'abcdefgh.test.js '.repeat(10)}'`.slice(0, 120);
  assert.equal(judgeOrThrow(bash('node /tmp/s.js', '/repo'), fakeDeps({ '/tmp/s.js': long })).reason, scriptReasonFor('/tmp/s.js', { literal }));
  for (const text of [
    "require('child_process'); console.log('the --test flag');",
    "require('child_process'); console.log(\"run tests with npm test\");",
    "require('child_process'); // execSync('node --test a.test.js b.test.js')",
    "execSync('node --test a.test.js b.test.js');",
    "require('child_process').execSync('node tools/run-tests.js a.test.js b.test.js');",
  ]) {
    assert.equal(scanScript(text, 'js'), false, text);
  }
});

test('C2: a shell script\'s run outside the runner\'s reach is no match, its cds read from the call\'s directory', () => {
  const run = (text, cwd = '/repo') => judgeOrThrow(bash('bash /scratch/s.sh', cwd), fakeDeps({ '/scratch/s.sh': text })).decision;
  assert.equal(run('cd evals && node --test tests/a.test.js\n'), 'allow');
  assert.equal(run('cd /scratch && node --test a.test.js\n'), 'allow');
  assert.equal(run('node --test evals/a.test.js\n'), 'allow');
  assert.equal(run('node --test /scratch/a.test.js /scratch/b.test.js\n'), 'allow');
  // The script sits where no runner is, but it runs from /repo: its run is in reach.
  assert.equal(run('node --test tests/a.test.js\n'), 'deny');
  assert.equal(run('cd tests && node --test a.test.js\n'), 'deny');
});

test('C3: a by-path program of unknown kind is read past its first line only when that line names node or a shell', () => {
  const headOnly = (head) => ({
    ...fakeDeps({}),
    readHead: (p, bytes) => (p === '/tmp/runner' ? head.slice(0, bytes) : null),
    readScript: () => { throw new Error('read past the head'); },
  });
  assert.deepEqual(judgeOrThrow(bash('/tmp/runner', '/repo'), headOnly('#!/usr/bin/env python3\nnode --test a b\n')), { decision: 'allow' });
  assert.deepEqual(judgeOrThrow(bash('/tmp/runner', '/repo'), headOnly('\u007fELF\u0002\u0001\u0001\u0000node --test a b')), { decision: 'allow' });
  assert.throws(() => judgeOrThrow(bash('/tmp/runner', '/repo'), headOnly('#!/bin/bash\nnode --test a b\n')), /read past the head/);
  // The head is at most 256 bytes.
  let asked = null;
  const deps = { ...fakeDeps({}), readHead: (p, bytes) => { asked = bytes; return '#!/usr/bin/env python3\n'; } };
  judgeOrThrow(bash('/tmp/runner', '/repo'), deps);
  assert.equal(asked, 256);
  // realDeps: the regular-file check, the byte bound, and no throw.
  withTempDir((dir) => {
    const file = path.join(dir, 'runner');
    fs.writeFileSync(file, `#!/usr/bin/env bash\n${'x'.repeat(1000)}`);
    assert.equal(realDeps().readHead(file, 256), `#!/usr/bin/env bash\n${'x'.repeat(256 - 20)}`);
    assert.equal(realDeps().readHead(dir, 256), null);
    assert.equal(realDeps().readHead(path.join(dir, 'missing'), 256), null);
    assert.equal(realDeps().readHead(undefined, 256), null);
  });
});

test('C5: env -P takes a value, and -S may be glued to the program or quote it', () => {
  const run = (line) => judgeOrThrow(bash('/tmp/runner', '/repo'), fakeDeps({ '/tmp/runner': `${line}\n${OFFENDING_JS}` })).decision;
  assert.equal(run('#!/usr/bin/env -P /usr/local/bin node'), 'deny');
  assert.equal(run('#!/usr/bin/env -Snode --no-warnings'), 'deny');
  assert.equal(run('#!/usr/bin/env -S "node --no-warnings"'), 'deny');
});

test('C6 C7: a -c shell has no script operand, and node -- with no operand reads its script from stdin', () => {
  const offending = 'node --test a.test.js b.test.js\n';
  assert.deepEqual(judgeOrThrow(bash('bash -c "cat" < /tmp/loop.sh', '/repo'), fakeDeps({ '/repo/cat': offending, '/tmp/loop.sh': 'echo hi\n' })), { decision: 'allow' });
  assert.equal(judgeOrThrow(bash('node -- < /tmp/mutant-run.js', '/repo'), fakeDeps({ '/tmp/mutant-run.js': OFFENDING_JS })).decision, 'deny');
  assert.deepEqual(judgeOrThrow(bash('node -- < /tmp/mutant-run.js', '/repo'), fakeDeps({ '/tmp/mutant-run.js': RUNNER_JS })), { decision: 'allow' });
});

// Each JavaScript row: [what it shows, script text, the node reference the deny names or null for allow].
const JS_ROWS = [
  ['it only writes fixture files that hold --test inside a longer string', "const fs = require('fs'); const g = require('./tools/direct-test-run-guard'); fs.writeFileSync('f.js', \"const a = ['--test']; require('child_process'); node\"); g.classifyCommand('x', {}); spawnSync(process.execPath, ['-e', \"x = ['--test']\"]);", null],
  ['git with an unrelated --test list', "const cp = require('child_process'); cp.execFileSync('git', ['log','--oneline']); const f = ['--test'].filter(Boolean);", null],
  ['process.execPath', "const { spawnSync } = require('child_process'); spawnSync(process.execPath, ['--test', 'a.test.js']);", 'process.execPath'],
  ['a node string', "const { spawn } = require(\"node:child_process\"); spawn('node', ['--test', 'a.test.js']);", "'node'"],
  ['an absolute node path', "const { execFileSync } = require('child_process'); execFileSync('/opt/homebrew/bin/node', [\"--test\"]);", "'/opt/homebrew/bin/node'"],
  ['the corrected script', "const { spawnSync } = require('child_process'); spawnSync(process.execPath, ['tools/run-tests.js', '--test-reporter=tap', 'a.test.js']);", null],
  ['--test only in a line comment', "// '--test'\nconst cp = require('child_process'); cp.spawnSync(process.execPath, ['x']);", null],
  ['--test only in a block comment', "/* '--test' */ const cp = require('child_process'); cp.spawnSync(process.execPath, ['x']);", null],
  ['child_process only in a comment', "// child_process\nspawnSync(process.execPath, ['--test']);", null],
  ['child_process only in a longer string', "console.log('see child_process docs'); spawnSync(process.execPath, ['--test']);", null],
  ['no node reference', "require('child_process').execFileSync('git', ['--test']);", null],
  ['node only inside a longer string', "require('child_process'); run('start node now', ['--test']);", null],
  ['node only in a comment', "// node\nrequire('child_process'); run('git', ['--test']);", null],
  ['--test only inside a longer string', "require('child_process'); spawnSync(process.execPath, ['a --test b']);", null],
  ['process.argv0', "require('child_process').spawnSync(process.argv0, ['--test']);", 'process.argv0'],
  ['process.argv[0]', "require('child_process').spawnSync(process.argv[0], ['--test']);", 'process.argv[0]'],
  ['a backtick --test', 'require(`child_process`).spawnSync(process.execPath, [`--test`]);', 'process.execPath'],
  ['a node.exe path', "require('child_process').spawnSync('C:/n/node.exe', ['--test']);", "'C:/n/node.exe'"],
  ['no child_process', "spawnSync(process.execPath, ['--test']);", null],
  ['child_process as code only', "const child_process = require('cp-shim'); child_process.spawnSync(process.execPath, ['--test']);", 'process.execPath'],
  ['a node.exe literal', "require('child_process').spawnSync('node.exe', ['--test']);", "'node.exe'"],
  ['the first of two node references, a literal', "require('child_process').spawnSync('node', ['--test'], { x: process.execPath });", "'node'"],
  ['process.env.npm_node_execpath', "require('child_process').spawnSync(process.env.npm_node_execpath, ['--test']);", 'process.env.npm_node_execpath'],
  ['the first of two node references, code', "require('child_process').spawnSync(process.execPath, ['--test'], { x: 'node' });", 'process.execPath'],
];

test('a shell script names its first direct test run, cut at 120 characters', () => {
  const run = `node --test ${Array(20).fill('abcdefgh.test.js').join(' ')}`;
  const verdict = judgeOrThrow(bash('bash /tmp/long.sh', '/repo'), fakeDeps({ '/tmp/long.sh': `${run}\n` }));
  assert.equal(verdict.decision, 'deny');
  assert.equal(verdict.reason, scriptReasonFor('/tmp/long.sh', { runText: run.slice(0, 120) }));
  assert.equal(run.length > 120, true);
});

test('realDeps: a tools/run-tests.js that is a directory is no runner, and a relative directory resolves', () => {
  withTempDir((dir) => {
    fs.mkdirSync(path.join(dir, 'tools', 'run-tests.js'), { recursive: true });
    assert.equal(realDeps().hasRunner(dir), null);
  });
  assert.equal(realDeps().hasRunner(path.relative(process.cwd(), path.join(ROOT, 'tests'))), ROOT);
});

test('scanScript reads comments and literals as such, one condition at a time', () => {
  for (const [what, text, ref] of JS_ROWS) assert.equal(scanScript(text, 'js'), ref !== null, what);
});

test('a JavaScript script is denied or allowed by the same rows through judgeOrThrow, naming what matched', () => {
  withTempDir((dir) => {
    const file = path.join(dir, 'scratch.js');
    for (const [what, text, ref] of JS_ROWS) {
      fs.writeFileSync(file, text);
      const verdict = judgeOrThrow(bash(`node ${shellQuote(file)}`), realDeps());
      assert.deepEqual(verdict, ref === null ? { decision: 'allow' } : { decision: 'deny', reason: scriptReasonFor(file, { ref }) }, what);
    }
  });
});

test('a call that has nothing to do with node loads neither the runner nor the comment stripper', () => {
  // The child requires the guard, judges one payload, and prints the module paths it loaded.
  const loaded = (command) => {
    const code = "const g = require(process.argv[1]); g.judge(JSON.parse(process.argv[2]), g.realDeps()); console.log(JSON.stringify(Object.keys(require.cache)));";
    const res = spawnSync(process.execPath, ['-e', code, GUARD, JSON.stringify(bash(command))], { encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL', windowsHide: true });
    assert.equal(res.status, 0, res.stderr);
    return JSON.parse(res.stdout).map((p) => p.split(path.sep).join('/'));
  };
  const endsWith = (paths, suffix) => paths.some((p) => p.endsWith(suffix));
  const plain = loaded('git status --short');
  assert.equal(endsWith(plain, '/tools/direct-test-run-guard.js'), true);
  assert.equal(endsWith(plain, '/tools/run-tests.js'), false);
  assert.equal(endsWith(plain, '/plugin/bin/lib/strip-comments.js'), false);
  assert.equal(endsWith(loaded('bash -x /no/such/loop.sh'), '/tools/run-tests.js'), false);
  const node = loaded('node --test tests/a.test.js');
  assert.equal(endsWith(node, '/tools/run-tests.js'), true);
  assert.equal(endsWith(node, '/plugin/bin/lib/strip-comments.js'), false);
  withTempDir((dir) => {
    const file = path.join(dir, 'scratch.js');
    fs.writeFileSync(file, RUNNER_JS);
    assert.equal(endsWith(loaded(`node ${shellQuote(file)}`), '/plugin/bin/lib/strip-comments.js'), true);
  });
});

test('C: a load-time failure leaves stdout empty and the status 0', () => {
  withTempDir((dir) => {
    const copy = path.join(dir, 'direct-test-run-guard.js');
    fs.copyFileSync(GUARD, copy);
    const res = spawnSync(process.execPath, [copy], { input: JSON.stringify(bash('node --test tests/a.test.js tests/b.test.js')), encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL', windowsHide: true });
    assert.equal(res.status, 0);
    assert.equal(res.stdout, '');
  });
});

test('AC8.2: a shell script holding a direct test run is denied', () => {
  withTempDir((dir) => {
    const file = path.join(dir, 'loop.sh');
    fs.writeFileSync(file, 'node --test a.test.js b.test.js\n');
    for (const command of [`bash ${shellQuote(file)}`, shellQuote(file)]) {
      const verdict = judgeOrThrow(bash(command), realDeps());
      assert.equal(verdict.decision, 'deny', command);
      assert.equal(verdict.reason, scriptReasonFor(file, { runText: 'node --test a.test.js b.test.js' }), command);
    }
    fs.writeFileSync(file, 'echo done\n');
    assert.deepEqual(judgeOrThrow(bash(`bash ${shellQuote(file)}`), realDeps()), { decision: 'allow' });
  });
});

test('AC8.2: under win32 path rules a script run by its backslash path is read, as its forward-slash twin is', () => {
  const script = 'C:\\work\\loop.sh';
  const files = { [script]: 'node --test a.test.js b.test.js\n' };
  const deps = {
    hasRunner: (d) => (d === 'C:\\repo' || d.startsWith('C:\\repo\\') ? 'C:\\repo' : null),
    isDirectory: () => false,
    readScript: (p) => (Object.prototype.hasOwnProperty.call(files, p) ? files[p] : null),
    readHead: (p, bytes) => (Object.prototype.hasOwnProperty.call(files, p) ? files[p].slice(0, bytes) : null),
    pathImpl: path.win32,
  };
  for (const command of [shellQuote(script), 'C:/work/loop.sh', `bash ${shellQuote(script)}`]) {
    assert.equal(judgeOrThrow(bash(command, 'C:\\repo'), deps).decision, 'deny', command);
  }
  // A bare name is found through PATH, never read as a script, whatever the path rules.
  assert.deepEqual(judgeOrThrow(bash('loop.sh', 'C:\\repo'), deps), { decision: 'allow' });
  // Under POSIX rules a backslash is a file-name character, so the word is one bare name.
  assert.deepEqual(judgeOrThrow(bash(shellQuote('work\\loop.sh'), '/repo'), fakeDeps({ '/repo/work\\loop.sh': files[script] })), { decision: 'allow' });
});

test('AC8.3 AC8.4: repo tooling is allowed unread, and an unreadable or missing script is allowed', () => {
  const unreadable = fakeDeps({});
  unreadable.readScript = () => { throw new Error('read must not happen'); };
  const real = { ...realDeps(), readScript: unreadable.readScript };
  assert.deepEqual(judgeOrThrow(bash('node tools/test-impact.js trace'), real), { decision: 'allow' });
  assert.deepEqual(judgeOrThrow(bash('node plugin/bin/verify.js'), real), { decision: 'allow' });
  // Each of the six skipped directories decides alone: the same script outside them is read.
  for (const dir of ['tools', 'plugin', 'tests', 'perf', 'evals', 'scripts']) {
    assert.deepEqual(judgeOrThrow(bash(`node ${dir}/x.js`, '/repo'), unreadable), { decision: 'allow' }, dir);
  }
  for (const rel of ['x.js', 'docs/x.js', 'tools2/x.js']) {
    assert.throws(() => judgeOrThrow(bash(`node ${rel}`, '/repo'), unreadable), /read must not happen/, rel);
  }
  const readable = fakeDeps({ '/repo/x.js': OFFENDING_JS, '/repo/docs/x.js': OFFENDING_JS });
  assert.equal(judgeOrThrow(bash('node x.js', '/repo'), readable).decision, 'deny');
  assert.equal(judgeOrThrow(bash('node docs/x.js', '/repo'), readable).decision, 'deny');

  assert.deepEqual(judgeOrThrow(bash('node /no/such/script.js'), realDeps()), { decision: 'allow' });
  withTempDir((dir) => {
    assert.deepEqual(judgeOrThrow(bash(`node ${shellQuote(dir)}`), realDeps()), { decision: 'allow' });
    const file = path.join(dir, 'big.js');
    fs.writeFileSync(file, OFFENDING_JS + ' '.repeat(262144));
    assert.deepEqual(judgeOrThrow(bash(`node ${shellQuote(file)}`), realDeps()), { decision: 'allow' });
    fs.writeFileSync(file, OFFENDING_JS + ' '.repeat(262144 - OFFENDING_JS.length));
    assert.equal(fs.statSync(file).size, 262144);
    assert.equal(judgeOrThrow(bash(`node ${shellQuote(file)}`), realDeps()).decision, 'deny');
  });
});

test('the scan runs only inside a checkout, only for Bash, and a typed deny wins', () => {
  const deps = fakeDeps({ '/tmp/mutant-run.js': OFFENDING_JS });
  assert.deepEqual(judgeOrThrow(bash('node /tmp/mutant-run.js', '/elsewhere'), deps), { decision: 'allow' });
  assert.deepEqual(judgeOrThrow({ tool_name: 'Edit', cwd: '/repo', tool_input: { command: 'node /tmp/mutant-run.js' } }, deps), { decision: 'allow' });
  assert.deepEqual(judgeOrThrow({ tool_name: 'Bash', cwd: '/repo', tool_input: {} }, deps), { decision: 'allow' });
  assert.deepEqual(judgeOrThrow(null, deps), { decision: 'allow' });
  const typed = judgeOrThrow(bash('node --test tests/a.test.js tests/b.test.js', '/repo'), deps);
  assert.equal(typed.decision, 'deny');
  assert.match(typed.reason, /node tools\/run-tests\.js tests\/a\.test\.js tests\/b\.test\.js/);
});

test('judge swallows an error that judgeOrThrow lets through', () => {
  const deps = fakeDeps({});
  deps.readScript = () => { throw new Error('boom'); };
  const payload = bash('node /tmp/mutant-run.js', '/repo');
  assert.throws(() => judgeOrThrow(payload, deps), /boom/);
  assert.deepEqual(judge(payload, deps), { decision: 'allow' });
});

test('realDeps: hasRunner finds the checkout root and none of the three throws', () => {
  const deps = realDeps();
  assert.equal(deps.hasRunner(path.join(ROOT, 'tests')), ROOT);
  assert.equal(deps.hasRunner(ROOT), ROOT);
  withTempDir((dir) => assert.equal(deps.hasRunner(dir), null));
  assert.equal(deps.hasRunner(undefined), null);
  assert.equal(deps.isDirectory(path.join(ROOT, 'tests')), true);
  assert.equal(deps.isDirectory(path.join(ROOT, 'package.json')), false);
  assert.equal(deps.isDirectory(undefined), false);
  assert.equal(deps.readScript(path.join(ROOT, 'no-such-file')), null);
  assert.equal(deps.readScript(path.join(ROOT, 'tests')), null);
  assert.equal(deps.readScript(undefined), null);
});

test('scanScript discriminates each condition', () => {
  assert.equal(scanScript(OFFENDING_JS, 'js'), true);
  assert.equal(scanScript("spawn('node', [\"--test\"]); require(\"child_process\")", 'js'), true);
  assert.equal(scanScript('exec(`node`, [`--test`]); require("child_process")', 'js'), true);
  assert.equal(scanScript('exec(`x`, [`--test`]); require("child_process")', 'js'), false);
  assert.equal(scanScript(RUNNER_JS, 'js'), false);
  assert.equal(scanScript("spawnSync('node', ['--test', 'a'])", 'js'), false);
  assert.equal(scanScript("require('child_process'); spawnSync('node', ['--test-only'])", 'js'), false);
  assert.equal(scanScript('node --test a.test.js', 'shell'), true);
  assert.equal(scanScript('echo done', 'shell'), false);
});

test('AC10.1 AC10.2 AC10.3: the guard as a real process denies, allows and tolerates garbage', () => {
  const run = (input) => spawnSync(process.execPath, [GUARD], { input, encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL', windowsHide: true });
  // Two files that exist: the replacement is checked against the real checkout before it is printed.
  const denied = run(JSON.stringify(bash('node --test tests/direct-test-run-guard.test.js tests/run-tests-isolation.test.js')));
  assert.equal(denied.status, 0);
  const out = JSON.parse(denied.stdout);
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.ok(out.hookSpecificOutput.permissionDecisionReason.includes('\nnode tools/run-tests.js tests/direct-test-run-guard.test.js tests/run-tests-isolation.test.js\n'));

  const allowed = run(JSON.stringify(bash('node --test tests/a.test.js')));
  assert.equal(allowed.status, 0);
  assert.equal(allowed.stdout, '');

  const garbage = run('not json');
  assert.equal(garbage.status, 0);
  assert.equal(garbage.stdout, '');
});

test('the guard as a real process denies a scratch script that spawns node --test', () => {
  withTempDir((dir) => {
    const file = path.join(dir, 'mutant-run.js');
    fs.writeFileSync(file, OFFENDING_JS);
    const res = spawnSync(process.execPath, [GUARD], { input: JSON.stringify(bash(`node ${shellQuote(file)}`)), encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL', windowsHide: true });
    assert.equal(res.status, 0);
    assert.equal(JSON.parse(res.stdout).hookSpecificOutput.permissionDecisionReason, scriptReasonFor(file, { ref: 'process.execPath' }));
  });
});

test('AC10.4: the guard requires no child_process', () => {
  const requiresChildProcess = /require\(['"](node:)?child_process['"]\)/;
  assert.equal(requiresChildProcess.test("require('child_process')"), true);
  assert.equal(requiresChildProcess.test(readText(GUARD)), false);
});

const HOOK_COMMAND_TEXT = 'd="$CLAUDE_PROJECT_DIR/tools/direct-test-run-guard"; [ -r "$d.sh" ] && command . "$d.sh"; node "$d.js"; exit 0';

test('AC11.1: .claude/settings.json registers the guard for Bash and the file exists', () => {
  const settings = JSON.parse(readText(path.join(ROOT, '.claude', 'settings.json')));
  const entry = settings.hooks.PreToolUse.find((e) => e.matcher === 'Bash');
  assert.ok(entry);
  assert.ok(entry.hooks.some((h) => h.type === 'command' && h.command === HOOK_COMMAND_TEXT && h.timeout === 10));
  assert.equal(fs.existsSync(GUARD), true);
  assert.equal(fs.existsSync(PREFILTER), true);
  for (const key of ['permissions', 'worktree', 'enabledPlugins', 'extraKnownMarketplaces']) assert.ok(settings[key], key);
});

// The repo's own guidance must not teach the form the guard denies: every documented line or code span
// that holds a direct `node --test` run anywhere in it (hasDirectTestRun) is one the classifier allows, so a
// doc edit that brings back a multi-file or glob run goes red here.
const BARE_MENTION = /^(?:node|\S*\/node|npx\s+(?:\S+\s+)*?node@\S+)\s+--test\s*$/;

function normalizePlaceholders(command) {
  return command.replace(/<([A-Za-z0-9_-]+)>/g, 'placeholder').replace(/(?<!\$)\{([A-Za-z0-9_-]+)\}/g, 'placeholder');
}

const holdsRun = (command) => hasDirectTestRun(command, { cwd: ROOT, pathImpl: path });

function documentedTestCommands(text) {
  const found = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    if (fenced) {
      const command = normalizePlaceholders(line.trim());
      if (holdsRun(command)) found.push(command);
      continue;
    }
    for (const match of line.matchAll(/`([^`\n]+)`/g)) {
      const span = match[1].trim();
      // A node program and --test with nothing after it: a mention of the tool, not a command.
      if (BARE_MENTION.test(span)) continue;
      const command = normalizePlaceholders(span);
      if (holdsRun(command)) found.push(command);
    }
  }
  return found;
}

const DOC_OPTS = (() => {
  const deps = realDeps();
  return { cwd: ROOT, hasRunner: deps.hasRunner, isDirectory: deps.isDirectory, pathImpl: path };
})();

function assertCommandAllowed(command, source) {
  const verdict = classifyCommandOrThrow(command, DOC_OPTS);
  assert.equal(verdict.decision, 'allow', `${source}: ${command}\n${verdict.reason || ''}`);
}

function skillFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...skillFiles(p));
    else if (entry.name === 'SKILL.md') out.push(p);
  }
  return out;
}

test('AC12.1: every documented node --test command is one the guard allows', () => {
  const journeysDir = path.join(ROOT, 'docs', 'journeys');
  const files = [
    ...skillFiles(path.join(ROOT, '.claude', 'skills')),
    path.join(ROOT, 'docs', 'plugin-structure.md'),
    ...fs.readdirSync(journeysDir).filter((f) => f.endsWith('.md')).map((f) => path.join(journeysDir, f)),
    path.join(ROOT, 'docs', 'donts.md'),
    path.join(ROOT, 'CLAUDE.md'),
  ];
  const commands = [];
  for (const file of files) {
    for (const command of documentedTestCommands(readText(file))) commands.push({ source: path.relative(ROOT, file), command });
  }
  const scope = JSON.parse(readText(path.join(ROOT, '.claude-tweaks', 'verify-scope.json')));
  const scopeCommands = [...Object.values(scope.checks.tests), ...Object.values(scope.retry), scope.impact.command];
  for (const command of scopeCommands) commands.push({ source: '.claude-tweaks/verify-scope.json', command: normalizePlaceholders(command) });
  assert.ok(commands.length >= 10, `only ${commands.length} documented commands found`);
  const denied = [];
  for (const { source, command } of commands) {
    // The caught message is kept, so a classifier throw reads differently from a deny.
    try { assertCommandAllowed(command, source); } catch (e) { denied.push(`${source}: ${command}\n${e.message}`); }
  }
  assert.deepEqual(denied, [], 'documented commands the guard denies');
});

test('the extractor skips a bare mention and keeps a real command, wherever in the line the run is', () => {
  assert.deepEqual(documentedTestCommands('a bare `node --test` run'), []);
  assert.deepEqual(documentedTestCommands('run `node --test <file>`'), ['node --test placeholder']);
  // A run after other commands is a command too.
  assert.deepEqual(documentedTestCommands('```\ncd evals && npm install && node --test tests/\n```'), ['cd evals && npm install && node --test tests/']);
  assert.deepEqual(documentedTestCommands('`for f in a b; do node --test tests/$f.test.js; done`'), ['for f in a b; do node --test tests/$f.test.js; done']);
  assert.deepEqual(documentedTestCommands('`echo "node --test a b"`'), []);
  const bare = documentedTestCommands('```\nnode --test\n```');
  assert.deepEqual(bare, ['node --test']);
  assert.throws(() => assertCommandAllowed(bare[0], 'fixture'));
});

const PRE_CHANGE_MUTANT_LINE = '- mutant: edit a copy in a scratch worktree and run `node --test tests/hooks-gate-coverage.test.js tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js tests/teardown-gate.test.js` there.';

test('AC12.2: the conformance check fails on the pre-change mutant instruction', () => {
  const found = documentedTestCommands(PRE_CHANGE_MUTANT_LINE);
  assert.equal(found.length, 1);
  assert.throws(() => assertCommandAllowed(found[0], 'fixture'));
});

// A text ending in a newline has one line per newline; one that does not has one more.
const lineCount = (text) => (text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length);

// The words the runner's parser receives from a replacement's argument text, after the shell: expansions
// and globs expanded (expandAsShell) and redirections, with their target, gone. `--full` is the runner's
// own flag, taken out before the parser runs.
function runnerArgs(argText) {
  const words = shellWords(expandAsShell(argText));
  const out = [];
  for (let i = 0; i < words.length; i += 1) {
    if (/^(?:[0-9]*|&)(?:>>?|<|>&)$/.test(words[i])) i += 1;
    else if (!/^(?:[0-9]*|&)[<>]/.test(words[i]) && words[i] !== '--full') out.push(words[i]);
  }
  return out;
}

// Every command the deny tables registered (ROUND_TRIP), judged here, under options with an isFile answer
// (the guard checks a replacement only then), whose reason pastes a command. Independent of run order.
test('AC9.1 AC9.2: every pasted replacement line is allowed by the classifier and accepted by the runner\'s parser', () => {
  const rows = [];
  for (const [command, options] of ROUND_TRIP) {
    if (typeof options.isFile !== 'function') continue;
    const verdict = classifyCommandOrThrow(command, options);
    if (verdict.decision === 'deny' && !/<[a-z][^>]*>/.test(verdict.replacement)) rows.push({ command, options, replacement: verdict.replacement });
  }
  assert.ok(rows.length >= 80, `only ${rows.length} pasted replacements`);
  for (const { command, options, replacement } of rows) {
    const P = options.pathImpl;
    const label = `${command} -> ${replacement}`;
    assert.equal(classifyCommandOrThrow(replacement, options).decision, 'allow', label);
    let cwd = options.cwd;
    let line = replacement;
    const prefix = /^cd ("[^"]*"|\S+) && (.*)$/.exec(line);
    if (prefix) {
      cwd = P.resolve(cwd, prefix[1].replace(/^"|"$/g, ''));
      line = prefix[2];
    }
    // The runner named as the reason states it: relative to the run's directory, or another checkout's.
    const runner = /(?:^|\s)("[^"]*run-tests\.js"|\S*run-tests\.js)(?=\s|$)/.exec(line);
    assert.ok(runner, label);
    const repoRoot = P.dirname(P.dirname(P.resolve(cwd, runner[1].replace(/^"|"$/g, ''))));
    const args = runnerArgs(line.slice(runner.index + runner[0].length));
    const realpath = options.realpath || ((p) => p);
    assert.doesNotThrow(() => parseRunnerOperands(args, { cwd, repoRoot, isFile: (p) => /\.js$/.test(p), realpath, pathImpl: P }), label);
  }
});

test('AC13.1: CLAUDE.md is 150 lines or fewer', () => {
  assert.deepEqual([lineCount('a\nb\n'), lineCount('a\nb')], [2, 2]);
  const lines = lineCount(readText(path.join(ROOT, 'CLAUDE.md')));
  assert.ok(lines <= 150, `${lines} lines`);
});

// ---- the sh prefilter's decisions (#5794) ----

const UTF8_ENV = { ...process.env, LC_ALL: 'en_US.UTF-8' };
const isPayloadLine = (c) => typeof c === 'object';
// Each row is a command (wrapped in a hook payload) or { line } (a raw stdin line); every row's verdict is
// compared with the expected one, naming the row on a mismatch.
function assertVerdicts(sh, rows, expected, options) {
  const lines = rows.map((r) => (isPayloadLine(r) ? r.line : hookPayload(r)));
  const verdicts = prefilterVerdicts(sh.file, lines, options);
  rows.forEach((r, i) => {
    assert.equal(verdicts[i], typeof expected === 'function' ? expected(r, i) : expected, `[${sh.name}] ${JSON.stringify(isPayloadLine(r) ? r.line : r)}`);
  });
}

test('#5794 AC6.1: the sh word list is the guard\'s PROGRAM_WORDS', () => {
  const lines = readText(PREFILTER).split('\n');
  const at = lines.findIndex((l) => l.trimStart().startsWith('# program-words:'));
  assert.ok(at >= 0, 'the "# program-words:" marker is missing from tools/direct-test-run-guard.sh');
  assert.match(lines[at + 1] || '', /\) return 0 ;;$/, 'the word list must stay on the single line after the "# program-words:" marker, ending in ") return 0 ;;"');
  const list = lines[at + 1].replace(/^\s+/, '').replace(/\) return 0 ;;$/, '').split('|');
  const sameWords = (words) => assert.deepEqual([...words].sort(), [...PROGRAM_WORDS].sort());
  sameWords(list);
  for (const w of ['node', 'find', '.', 'until']) assert.ok(PROGRAM_WORDS.includes(w), w);
  assert.equal(new Set(PROGRAM_WORDS).size, PROGRAM_WORDS.length);
  assert.ok(Object.isFrozen(PROGRAM_WORDS));
  assert.throws(() => sameWords(list.filter((w) => w !== 'find')));
  assert.throws(() => sameWords([...list, 'coproc']));
});

test('#5794 AC6.1: every program word the guard compares inline is in PROGRAM_WORDS', () => {
  const source = readText(GUARD).split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
  const re = /(?:seg\.name\([^)]*\)|leadName|program|t\[prog\.at\])\s*===\s*'([^']*)'/g;
  const found = new Set();
  for (const m of source.matchAll(re)) found.add(m[1]);
  // `cd` only records the directory later fragments resolve against; a later fragment still needs
  // a program word to be denied, so the prefilter may skip a call whose only command is `cd`.
  const STATE_ONLY = new Set(['cd']);
  const missing = [...found].filter((w) => !PROGRAM_WORDS.includes(w) && !STATE_ONLY.has(w));
  assert.deepEqual(missing, [], `program words compared inline in tools/direct-test-run-guard.js but missing from PROGRAM_WORDS: ${missing.join(', ')}`);
  for (const w of ['npx', 'find', 'source', '.', 'eval']) assert.ok(found.has(w), `the inline-comparison matcher did not find "${w}"`);
});

const ALLOWED_BY_PREFILTER = [
  'git status --short && ls', 'ls -la', 'git -C "/a b/c" log --oneline | head -5', 'gh pr view 12 --json title',
  'cd "/a b" && git status', 'npm test', 'echo "node --test a.test.js b.test.js"', 'git add a.js\ngit status',
  'git status\t--short', 'loop.sh', 'a-b_c.d+e 1', 'grep -n "x" f.js', 'ls \u00a0node x', '',
];
perPrefilterShell('#5794 AC6.2: the prefilter skips a call whose fragments all start with a plain command name', (sh) => {
  for (const command of ALLOWED_BY_PREFILTER) assert.equal(guard.judgeOrThrow(bash(command), realDeps()).decision, 'allow', `oracle drift: ${command}`);
  assertVerdicts(sh, ALLOWED_BY_PREFILTER, 'skip');
});

perPrefilterShell('#5794 AC6.2: the prefilter sends every program word to node', (sh) => {
  const rows = PROGRAM_WORDS.flatMap((w) => [`${w} x`, `ls && ${w} x`, `${w}\tx`, `ls &&\t${w}\tx`]);
  assertVerdicts(sh, rows, 'node');
});

perPrefilterShell('#5794 AC6.2: the prefilter cuts at every separator', (sh) => {
  const T = 'node --test tests/a.test.js tests/b.test.js';
  const rows = [
    `ls; ${T}`, `ls && ${T}`, `ls || ${T}`, `ls | ${T}`, `ls & ${T}`, `(${T})`, `{ ${T}; }`, 'echo `' + T + '`',
    `echo $(${T})`, `ls\n${T}`, `\t${T}`, `git commit -m "a; ${T}"`, 'ls\t&&\tnode\tx',
    ...[';', '&', '|', '(', ')', '{', '}', '`', '\n'].map((sep) => `ls ${sep} node x`),
  ];
  assertVerdicts(sh, rows, 'node');
});

perPrefilterShell('#5794 AC6.2: the prefilter sends a first word it cannot read plainly to node', (sh) => {
  const rows = [...'/="\'$<>!~:@%*?[]#,^\\'].map((c) => `x${c}y z`);
  rows.push('xéy z', 'ls;\u00a0node x', 'env\u00a0node x', './x.sh', '/usr/bin/time ls', 'FOO=1 ls', '"ls"',
    'X=de; no$X --test a.test.js b.test.js', "'C:\\work\\loop.sh'", 'C:/work/loop.sh');
  assertVerdicts(sh, rows, 'node', { env: UTF8_ENV });
});

perPrefilterShell('#5794 AC6.2: the prefilter sends what it cannot read to node', (sh) => {
  const raw = [
    'grep "a\\|b" f', 'ls \\', 'ls\rx', 'ls\fx', 'ls\bx', 'ls\u0007x',
  ].map((c) => hookPayload(c)).concat([
    '{"tool_name":"Bash","tool_input":{}}',
    '{"tool_name":"Bash","tool_input":{"command":null}}',
    '{"tool_name":"Bash","tool_input":{"command": "ls"}}',
    '{"tool_name":"Bash","tool_input":{"description":"command","other":"ls"}}',
    'not json',
    '',
    hookPayload('ls', { description: 'command' }),
    hookPayload('ls ' + 'é'.repeat(4000)),
  ]);
  assertVerdicts(sh, raw.map((line) => ({ line })), 'node', { env: UTF8_ENV });
});

perPrefilterShell('#5794 AC6.2: the prefilter reads the size and piece caps exactly', (sh) => {
  const base = Buffer.byteLength(hookPayload('ls '));
  const p0 = hookPayload('ls', { description: '' }).split('"').length;
  const pairs = [
    [hookPayload('ls ' + 'a'.repeat(8192 - base)), hookPayload('ls ' + 'a'.repeat(8193 - base))],
    [hookPayload('ls', { description: '"'.repeat(256 - p0) }), hookPayload('ls', { description: '"'.repeat(257 - p0) })],
    [hookPayload('ls' + '\ta'.repeat(255)), hookPayload('ls' + '\ta'.repeat(256))],
    [hookPayload('ls;'.repeat(256)), hookPayload('ls;'.repeat(257))],
  ];
  const rows = pairs.flat().map((line) => ({ line }));
  assertVerdicts(sh, rows, (r, i) => (i % 2 === 0 ? 'skip' : 'node'), { env: UTF8_ENV });
});

perPrefilterShell('#5794 AC6.2: the prefilter does not expand a glob', (sh) => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, 'plainfile'), '');
    assertVerdicts(sh, ['* x'], 'node', { env: UTF8_ENV, cwd: dir });
  });
});

test('#5794 AC6.2: under a shell that does not split words every call goes to node', { skip: !findOnPath('zsh') && 'zsh not on PATH' }, () => {
  assert.deepEqual(prefilterVerdicts(findOnPath('zsh'), [hookPayload('git status --short && ls')]), ['node']);
});

// ---- the registered hook command, run the way Claude Code runs it (#5794) ----

// Runs the registered command the way Claude Code does: `<sh> -c <command>` with the payload on stdin.
function runHook(shellFile, input, env) {
  return spawnSync(shellFile, ['-c', HOOK_COMMAND_TEXT], { input, env, timeout: 30000, killSignal: 'SIGKILL', windowsHide: true });
}

const ORIGINAL_PATH = process.env[Object.keys(process.env).find((k) => /^path$/i.test(k))] || '';
function envWithoutPath() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^path$/i.test(key)) delete env[key];
  return env;
}
// node in the hook is the node running the test.
function nodeEnv(projectDir, extra) {
  return { ...envWithoutPath(), PATH: path.dirname(process.execPath) + path.delimiter + ORIGINAL_PATH, CLAUDE_PROJECT_DIR: projectDir, ...extra };
}
// PATH is an empty directory inside the project directory, so withTempDir removes it.
function emptyPathEnv(projectDir, extra) {
  const empty = path.join(projectDir, 'empty-path');
  fs.mkdirSync(empty, { recursive: true });
  return { ...envWithoutPath(), PATH: empty, CLAUDE_PROJECT_DIR: projectDir, ...extra };
}

const RECORDER = "const fs = require('fs'); const c = []; process.stdin.on('data', (d) => c.push(d)); process.stdin.on('end', () => fs.writeFileSync(process.env.DTRG_SEEN, Buffer.concat(c)));";
const REAL_GUARD = "require('child_process').spawnSync(process.execPath, [process.env.DTRG_REAL], { stdio: 'inherit' });";
// A temp project holding tools/direct-test-run-guard.js (guardSource) and, unless prefilter is null, the .sh with those bytes.
function withHookProject(prefilter, guardSource, fn) {
  return withTempDir((dir) => {
    fs.mkdirSync(path.join(dir, 'tools'));
    fs.writeFileSync(path.join(dir, 'tools', 'direct-test-run-guard.js'), guardSource);
    if (prefilter !== null) fs.writeFileSync(path.join(dir, 'tools', 'direct-test-run-guard.sh'), prefilter);
    return fn({ dir, seen: path.join(dir, 'seen.bin') });
  });
}

const GOOD_PREFILTER = fs.readFileSync(PREFILTER);
const CRLF_PREFILTER = readText(PREFILTER).replace(/\n/g, '\r\n');
function insertAfterLine(text, startsWith, inserted) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.startsWith(startsWith));
  assert.ok(at >= 0, startsWith);
  lines.splice(at + 1, 0, inserted);
  return lines.join('\n');
}
const FAULTY_PREFILTERS = [
  ['missing', null],
  ['CRLF', CRLF_PREFILTER],
  ['conflict marker inside the scan', insertAfterLine(readText(PREFILTER), 'dtrg_scan() {', '<<<<<<< HEAD')],
  ['conflict marker after the last call line', insertAfterLine(readText(PREFILTER), '[ -n "${DIRECT_TEST_RUN_GUARD_LIB-}" ]', '<<<<<<< HEAD')],
];

const D = hookPayload('node --test tests/a.test.js tests/b.test.js');
const DENIED = hookPayload('node --test tests/direct-test-run-guard.test.js tests/run-tests-isolation.test.js');
const parsesAsDeny = (stdout) => assert.equal(JSON.parse(stdout.toString()).hookSpecificOutput.permissionDecision, 'deny');

test('#5794 AC10.3: the prefilter is checked out with LF line endings', () => {
  assert.ok(readText(path.join(ROOT, '.gitattributes')).split('\n').includes('tools/direct-test-run-guard.sh text eol=lf'));
  assert.equal(fs.readFileSync(PREFILTER).includes(0x0d), false);
});

perPrefilterShell('#5794 AC1.1 AC1.2 AC1.3 AC1.4: the registered command prints what the node guard prints', (sh) => {
  const env = nodeEnv(ROOT);
  for (const input of [DENIED + '\n', hookPayload('for f in tests/*.test.js; do node --test $f; done') + '\n']) {
    const hook = runHook(sh.file, input, env);
    const direct = spawnSync(process.execPath, [GUARD], { input, env, timeout: 30000, killSignal: 'SIGKILL', windowsHide: true });
    assert.equal(hook.status, 0, `[${sh.name}] ${hook.stderr}`);
    assert.deepEqual(hook.stdout, direct.stdout, `[${sh.name}]`);
    parsesAsDeny(hook.stdout);
  }
  for (const command of ['node --test tests/direct-test-run-guard.test.js', 'node tools/run-tests.js tests/direct-test-run-guard.test.js', 'git status --short && ls']) {
    const hook = runHook(sh.file, hookPayload(command) + '\n', env);
    assert.equal(hook.status, 0, `[${sh.name}] ${command}`);
    assert.equal(hook.stdout.toString(), '', `[${sh.name}] ${command}`);
  }
});

perPrefilterShell('#5794 AC3.1 AC3.2: node reads the bytes the hook received', (sh) => {
  const inputs = [
    D + '\n', D, JSON.stringify(JSON.parse(D), null, 2) + '\n', JSON.stringify(JSON.parse(D), null, 2),
    D + '\nextra', D + '\nextra\n', hookPayload('git status') + '\n\n', '', '\n', 'not json\n',
    hookPayload('node "a b.js" c.js # æøå \u2028 \\ $HOME `id`') + '\n',
  ];
  withHookProject(GOOD_PREFILTER, RECORDER, ({ dir, seen }) => {
    const env = nodeEnv(dir, { DTRG_SEEN: seen });
    for (const input of inputs) {
      fs.rmSync(seen, { force: true });
      const res = runHook(sh.file, input, env);
      const label = `[${sh.name}] ${JSON.stringify(input)}`;
      assert.equal(res.status, 0, label);
      assert.equal(res.stdout.toString(), '', label);
      assert.equal(fs.existsSync(seen), true, `${label}: node did not run`);
      assert.deepEqual(fs.readFileSync(seen), Buffer.from(input), label);
    }
  });
});

perPrefilterShell('#5794 AC4.1 AC4.2: the skip path starts nothing', (sh) => {
  const input = hookPayload('git status --short && ls') + '\n';
  withHookProject(GOOD_PREFILTER, RECORDER, ({ dir, seen }) => {
    for (const env of [nodeEnv(dir, { DTRG_SEEN: seen }), emptyPathEnv(dir, { DTRG_SEEN: seen })]) {
      const res = runHook(sh.file, input, env);
      assert.equal(res.status, 0, `[${sh.name}]`);
      assert.equal(res.stdout.toString(), '', `[${sh.name}]`);
      assert.equal(res.stderr.toString(), '', `[${sh.name}]`);
      assert.equal(fs.existsSync(seen), false, `[${sh.name}]: node ran`);
    }
  });
});

perPrefilterShell('#5794 AC5.1 AC5.2 AC5.3: a missing, CRLF or broken prefilter still reaches the guard', (sh) => {
  assert.ok(CRLF_PREFILTER.includes('\r\n'));
  assert.equal(CRLF_PREFILTER.includes('\r\r\n'), false);
  for (const [state, prefilter] of FAULTY_PREFILTERS) {
    withHookProject(prefilter, RECORDER, ({ dir, seen }) => {
      const env = nodeEnv(dir, { DTRG_SEEN: seen });
      for (const input of [D + '\n', hookPayload('git status --short && ls') + '\n']) {
        fs.rmSync(seen, { force: true });
        const res = runHook(sh.file, input, env);
        const label = `[${sh.name}] ${state} ${JSON.stringify(input)}`;
        assert.equal(res.status, 0, label);
        assert.equal(res.stdout.toString(), '', label);
        // Git Bash (the sh and bash on a Windows runner) reads CRLF line endings as LF, so a CRLF copy
        // works there as the prefilter and skips node for the harmless call (windows-regression run
        // 43980547211). Under dash and bash on macOS and Linux it is a syntax fault and node runs.
        const nodeRuns = !(state === 'CRLF' && process.platform === 'win32' && input !== D + '\n');
        assert.equal(fs.existsSync(seen), nodeRuns, `${label}: node ${nodeRuns ? 'did not run' : 'ran'}`);
        if (nodeRuns) assert.deepEqual(fs.readFileSync(seen), Buffer.from(input), label);
      }
    });
    withHookProject(prefilter, REAL_GUARD, ({ dir }) => {
      const res = runHook(sh.file, DENIED + '\n', nodeEnv(dir, { DTRG_REAL: GUARD }));
      assert.equal(res.status, 0, `[${sh.name}] ${state}`);
      parsesAsDeny(res.stdout);
    });
  }
});

perPrefilterShell('#5794 AC5.2: a guard that cannot load or exits non-zero still ends in status 0', (sh) => {
  const guards = [
    ['cannot load', 'this is ( not js\n', ''],
    ['exits 3 after printing', "process.stdin.resume(); process.stdin.on('end', () => { process.stdout.write('{}'); process.exit(3); });\n", '{}'],
  ];
  for (const [state, guardSource, stdout] of guards) {
    withHookProject(GOOD_PREFILTER, guardSource, ({ dir }) => {
      for (const input of [D + '\n', D, D + '\n' + D + '\n']) {
        const res = runHook(sh.file, input, nodeEnv(dir));
        const label = `[${sh.name}] ${state} ${JSON.stringify(input).slice(0, 40)}`;
        assert.equal(res.status, 0, label);
        assert.equal(res.stdout.toString(), stdout, label);
      }
    });
  }
});

perPrefilterShell('#5794 AC5.2: with no node on PATH the hook exits 0 and prints nothing', (sh) => {
  for (const prefilter of [GOOD_PREFILTER, null]) {
    withHookProject(prefilter, RECORDER, ({ dir, seen }) => {
      const res = runHook(sh.file, D + '\n', emptyPathEnv(dir, { DTRG_SEEN: seen }));
      assert.equal(res.status, 0, `[${sh.name}] prefilter ${prefilter === null ? 'missing' : 'present'}`);
      assert.equal(res.stdout.toString(), '', `[${sh.name}]`);
    });
  }
});

perPrefilterShell('#5794 AC5.2: garbage and empty stdin print nothing', (sh) => {
  for (const input of ['not json\n', '', '{"tool_name":"Bash"}\n']) {
    const res = runHook(sh.file, input, nodeEnv(ROOT));
    assert.equal(res.status, 0, `[${sh.name}] ${JSON.stringify(input)}`);
    assert.equal(res.stdout.toString(), '', `[${sh.name}] ${JSON.stringify(input)}`);
  }
});

// Must stay the last test in the file: DENIED_COMMANDS holds every deny the earlier tests saw.
perPrefilterShell('#5794 AC2.1 AC2.2 AC2.3: every command a test saw denied reaches node', (sh) => {
  const commands = [...new Set([...ROUND_TRIP.map(([c]) => c), ...DENIED_COMMANDS])];
  assert.ok(commands.length >= 50, `only ${commands.length} denied commands`);
  assertVerdicts(sh, commands, 'node');
});
