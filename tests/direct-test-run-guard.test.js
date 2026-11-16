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

// Every verdict below is read through classifyCommandOrThrow and judgeOrThrow, which let an internal error
// through, so a bug can never pass an allow row by landing in the catching wrapper.
const {
  classifyCommand, classifyCommandOrThrow, hasDirectTestRun, scanScript, judge, judgeOrThrow, realDeps, SAFEGUARDS_TEXT,
} = require('../tools/direct-test-run-guard');
const { parseRunnerOperands } = require('../tools/run-tests');

const isDirectory = (p) => p === '/repo/tests' || p === '/repo/evals/tests';
const opts = {
  cwd: '/repo',
  hasRunner: (d) => (d === '/repo' || d.startsWith('/repo/') ? '/repo' : null),
  isDirectory,
  pathImpl: path.posix,
};

// Each deny row with the replacement line its reason names. `null` marks the rows whose replacement is
// the fixed placeholder text (the files a `while read` loop, `xargs` or `find` runs cannot be known).
const PLACEHOLDER = 'node tools/run-tests.js <the test files this loop runs>';
const DIR_STACK_PLACEHOLDER = 'node <path to tools/run-tests.js> <the same flags and test files>';
const DENY_ROWS = [
  ['node --test "$TEST_FILE"', 'node tools/run-tests.js "$TEST_FILE"'],
  ['for i in 1 2 3; do node --test tests/a.test.js; done', 'node tools/run-tests.js tests/a.test.js'],
  ['for i in 1 2 3; do sh -c "node --test tests/a.test.js"; done', 'node tools/run-tests.js tests/a.test.js'],
  ["seq 3 | xargs -n1 sh -c 'node --test tests/a.test.js'", 'node tools/run-tests.js tests/a.test.js'],
  ['node --test tests/a.test.js tests/b.test.js', 'node tools/run-tests.js tests/a.test.js tests/b.test.js'],
  ['node --test --test-reporter=tap tests/bin-lib/verify/*.test.js', 'node tools/run-tests.js --test-reporter=tap tests/bin-lib/verify/*.test.js'],
  ['node --test', 'node tools/run-tests.js'],
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
  ['for f in a b; do node --test tests/a.test.js --test-name-pattern "$f"; done', null],
  ['while read f; do node --test tests/a.test.js --test-name-pattern "$f"; done < list.txt', null],
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
  // The scanner does not follow pushd/popd, so the runner path cannot be named from the call's directory.
  ['pushd tests && node --test a.test.js b.test.js', DIR_STACK_PLACEHOLDER],
  ['popd; node --test tests/a.test.js tests/b.test.js', DIR_STACK_PLACEHOLDER],
  // xargs and parallel run their first non-option word, past the options that take a value.
  ['ls tests | xargs -n 1 node --test', null],
  ['ls tests | parallel -j 2 node --test {}', null],
];

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
];

const EXPANSION_LINE = 'The runner takes *.test.js files only and refuses anything else the expansion names, so make it name test files only.';

function reasonFor(replacement, { expansion = false, options = null } = {}) {
  return [
    `This repository's guard blocked a direct test run. ${SAFEGUARDS_TEXT}`,
    'Run the same files through the runner, which takes the same files and node test flags:',
    '',
    replacement,
    '',
    ...(expansion ? [EXPANSION_LINE] : []),
    ...(options ? [`The runner does not take ${options}; if the tests need them, set NODE_OPTIONS.`] : []),
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

test('a prefix command is skipped with its own options, and one it cannot model is not', () => {
  const two = 'node --test tests/a.test.js tests/b.test.js';
  for (const prefix of [
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
  ]) {
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

test('the replacement keeps flags, files, assignments and the rest of the pipeline out', () => {
  const pins = [
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
  ];
  for (const [command, replacement] of pins) {
    assert.equal(classifyCommandOrThrow(command, opts).replacement, replacement, command);
  }
});

test('the directory prefix quotes a directory holding a space', () => {
  const spaced = { ...opts, isDirectory: () => false };
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

test('AC9.1 AC9.2: every replacement line is allowed by the classifier and accepted by the runner\'s parser', () => {
  const rows = DENY_ROWS.filter(([, replacement]) => replacement !== null && replacement !== DIR_STACK_PLACEHOLDER).map(([command]) => command);
  rows.push('cd tests && node --test a.test.js b.test.js');
  for (const command of rows) {
    const { replacement } = classifyCommandOrThrow(command, opts);
    assert.equal(classifyCommandOrThrow(replacement, opts).decision, 'allow', `${command} -> ${replacement}`);
    let cwd = '/repo';
    let line = replacement;
    const prefix = /^cd (\S+) && (.*)$/.exec(replacement);
    if (prefix) {
      cwd = path.posix.resolve('/repo', prefix[1]);
      line = prefix[2];
    }
    const at = line.indexOf('tools/run-tests.js');
    assert.notEqual(at, -1, replacement);
    const tokens = shellWords(expandAsShell(line.slice(at + 'tools/run-tests.js'.length)));
    assert.doesNotThrow(
      () => parseRunnerOperands(tokens, { cwd, repoRoot: '/repo', isFile: (p) => !isDirectory(p), pathImpl: path.posix }),
      `${command} -> ${replacement}`,
    );
  }
});

test('win32 paths', () => {
  const win = {
    cwd: 'C:/repo',
    hasRunner: (d) => (d === 'C:/repo' ? 'C:\\repo' : null),
    isDirectory: () => false,
    pathImpl: path.win32,
  };
  assert.equal(classifyCommandOrThrow('node --test tests/a.test.js tests/b.test.js', win).decision, 'deny');
  assert.equal(classifyCommandOrThrow('"C:/nodejs/node.exe" --test tests/a.test.js', win).decision, 'allow');
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

// `ref` is the node reference as found in a JavaScript script; `runText` the first direct test run of a
// shell script (exactly one of the two).
function scriptReasonFor(word, { ref, runText }) {
  const matched = ref !== undefined
    ? `Matched in the script: the string literal '--test', a child_process reference, and a node program (${ref}).`
    : `Matched in the script: ${runText}`;
  return [
    `This repository's guard blocked a script that starts node --test itself: ${word}. ${SAFEGUARDS_TEXT}`,
    matched,
    'Have the script start the runner instead, from inside the checkout it tests, with the same flags and files:',
    '',
    'node tools/run-tests.js --test-reporter=tap <files>',
    '',
    'In JavaScript: spawnSync(process.execPath, [\'tools/run-tests.js\', ...flags, ...files], { cwd: checkoutRoot }). The exit code and stdout are node\'s own.',
    'In a checkout older than this guard, write the files to a list and use: node tools/run-tests.js --files-from <list>',
  ].join('\n');
}

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'direct-test-run-guard-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const bash = (command, cwd = ROOT) => ({ tool_name: 'Bash', cwd, tool_input: { command } });

// Fake deps over a map of absolute path -> script text; `/repo` holds the runner.
function fakeDeps(files) {
  return {
    hasRunner: (d) => (d === '/repo' || d.startsWith('/repo/') ? '/repo' : null),
    isDirectory: () => false,
    readScript: (p) => (Object.prototype.hasOwnProperty.call(files, p) ? files[p] : null),
    pathImpl: path.posix,
  };
}

test('AC8.1: a scratch script that spawns node --test is denied, and allowed once it spawns the runner', () => {
  withTempDir((dir) => {
    const file = path.join(dir, 'mutant-run.js');
    fs.writeFileSync(file, OFFENDING_JS);
    const verdict = judgeOrThrow(bash(`node ${file}`), realDeps());
    assert.equal(verdict.decision, 'deny');
    assert.equal(verdict.reason, scriptReasonFor(file, { ref: 'process.execPath' }));

    fs.writeFileSync(file, RUNNER_JS);
    assert.deepEqual(judgeOrThrow(bash(`node ${file}`), realDeps()), { decision: 'allow' });
    fs.writeFileSync(file, "spawnSync(process.execPath, ['--test', 'tests/a.test.js']);");
    assert.deepEqual(judgeOrThrow(bash(`node ${file}`), realDeps()), { decision: 'allow' });
    fs.writeFileSync(file, "const cp = require('child_process'); cp.spawnSync('node', ['--test-only']);");
    assert.deepEqual(judgeOrThrow(bash(`node ${file}`), realDeps()), { decision: 'allow' });
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
  ['a shell -- ends the options', 'cd /tmp && bash -- -x', 'deny'],
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
    '/tmp/mutant-run.js': OFFENDING_JS, '/tmp/loop.sh': 'node --test a.test.js', '/tmp/-x': 'node --test a.test.js', '/tmp/-mutant.js': OFFENDING_JS,
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
  ['the first of two node references, code',"require('child_process').spawnSync(process.execPath, ['--test'], { x: 'node' });", 'process.execPath'],
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
      const verdict = judgeOrThrow(bash(`node ${file}`), realDeps());
      assert.deepEqual(verdict, ref === null ? { decision: 'allow' } : { decision: 'deny', reason: scriptReasonFor(file, { ref }) }, what);
    }
  });
});

test('a call that has nothing to do with node loads neither the runner nor the comment stripper', () => {
  // The child requires the guard, judges one payload, and prints the module paths it loaded.
  const loaded = (command) => {
    const code = "const g = require(process.argv[1]); g.judge(JSON.parse(process.argv[2]), g.realDeps()); console.log(JSON.stringify(Object.keys(require.cache)));";
    const res = spawnSync(process.execPath, ['-e', code, GUARD, JSON.stringify(bash(command))], { encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL' });
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
    assert.equal(endsWith(loaded(`node ${file}`), '/plugin/bin/lib/strip-comments.js'), true);
  });
});

test('C: a load-time failure leaves stdout empty and the status 0', () => {
  withTempDir((dir) => {
    const copy = path.join(dir, 'direct-test-run-guard.js');
    fs.copyFileSync(GUARD, copy);
    const res = spawnSync(process.execPath, [copy], { input: JSON.stringify(bash('node --test tests/a.test.js tests/b.test.js')), encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL' });
    assert.equal(res.status, 0);
    assert.equal(res.stdout, '');
  });
});

test('AC8.2: a shell script holding a direct test run is denied', () => {
  withTempDir((dir) => {
    const file = path.join(dir, 'loop.sh');
    fs.writeFileSync(file, 'node --test a.test.js b.test.js\n');
    fs.chmodSync(file, 0o755);
    for (const command of [`bash ${file}`, file]) {
      const verdict = judgeOrThrow(bash(command), realDeps());
      assert.equal(verdict.decision, 'deny', command);
      assert.equal(verdict.reason, scriptReasonFor(file, { runText: 'node --test a.test.js b.test.js' }), command);
    }
    fs.writeFileSync(file, 'echo done\n');
    assert.deepEqual(judgeOrThrow(bash(`bash ${file}`), realDeps()), { decision: 'allow' });
  });
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
    assert.deepEqual(judgeOrThrow(bash(`node ${dir}`), realDeps()), { decision: 'allow' });
    const file = path.join(dir, 'big.js');
    fs.writeFileSync(file, OFFENDING_JS + ' '.repeat(262144));
    assert.deepEqual(judgeOrThrow(bash(`node ${file}`), realDeps()), { decision: 'allow' });
    fs.writeFileSync(file, OFFENDING_JS + ' '.repeat(262144 - OFFENDING_JS.length));
    assert.equal(fs.statSync(file).size, 262144);
    assert.equal(judgeOrThrow(bash(`node ${file}`), realDeps()).decision, 'deny');
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
  const run = (input) => spawnSync(process.execPath, [GUARD], { input, encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL' });
  const denied = run(JSON.stringify(bash('node --test tests/a.test.js tests/b.test.js')));
  assert.equal(denied.status, 0);
  const out = JSON.parse(denied.stdout);
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.ok(out.hookSpecificOutput.permissionDecisionReason.includes('node tools/run-tests.js tests/a.test.js tests/b.test.js'));

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
    const res = spawnSync(process.execPath, [GUARD], { input: JSON.stringify(bash(`node ${file}`)), encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL' });
    assert.equal(res.status, 0);
    assert.equal(JSON.parse(res.stdout).hookSpecificOutput.permissionDecisionReason, scriptReasonFor(file, { ref: 'process.execPath' }));
  });
});

test('AC10.4: the guard requires no child_process', () => {
  const requiresChildProcess = /require\(['"](node:)?child_process['"]\)/;
  assert.equal(requiresChildProcess.test("require('child_process')"), true);
  assert.equal(requiresChildProcess.test(readText(GUARD)), false);
});

test('AC11.1: .claude/settings.json registers the guard for Bash and the file exists', () => {
  const settings = JSON.parse(readText(path.join(ROOT, '.claude', 'settings.json')));
  const entry = settings.hooks.PreToolUse.find((e) => e.matcher === 'Bash');
  assert.ok(entry);
  assert.ok(entry.hooks.some((h) => h.type === 'command' && h.command === 'node "$CLAUDE_PROJECT_DIR/tools/direct-test-run-guard.js"'));
  assert.equal(fs.existsSync(GUARD), true);
  for (const key of ['permissions', 'worktree', 'enabledPlugins', 'extraKnownMarketplaces']) assert.ok(settings[key], key);
});

// The repo's own guidance must not teach the form the guard denies: every documented `node --test` command
// is one the classifier allows, so a doc edit that brings back a multi-file or glob run goes red here.
const NODE_COMMAND_START = /^(?:cd \S+ && )?(?:[A-Za-z_][A-Za-z0-9_]*=\S+ )*(?:node|\S*\/node|npx\s+(?:\S+\s+)*?node@\S+)\s/;
const TEST_WORD = /(?:^|\s)--test(?:\s|$)/;

function normalizePlaceholders(command) {
  return command.replace(/<([A-Za-z0-9_-]+)>/g, 'placeholder').replace(/(?<!\$)\{([A-Za-z0-9_-]+)\}/g, 'placeholder');
}

function documentedTestCommands(text) {
  const found = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    if (fenced) {
      const trimmed = line.trim();
      if (NODE_COMMAND_START.test(`${trimmed} `) && TEST_WORD.test(trimmed)) found.push(normalizePlaceholders(trimmed));
      continue;
    }
    for (const match of line.matchAll(/`([^`\n]+)`/g)) {
      const span = match[1].trim();
      if (!NODE_COMMAND_START.test(`${span} `) || !TEST_WORD.test(span)) continue;
      // Nothing after --test: a mention of the tool, not a command.
      if (/(?:^|\s)--test\s*$/.test(span)) continue;
      found.push(normalizePlaceholders(span));
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
    try { assertCommandAllowed(command, source); } catch (e) { denied.push(`${source}: ${command}`); }
  }
  assert.deepEqual(denied, [], 'documented commands the guard denies');
});

test('the extractor skips a bare mention and keeps a real command', () => {
  assert.deepEqual(documentedTestCommands('a bare `node --test` run'), []);
  assert.deepEqual(documentedTestCommands('run `node --test <file>`'), ['node --test placeholder']);
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

test('AC13.1: CLAUDE.md is 150 lines or fewer', () => {
  assert.ok(readText(path.join(ROOT, 'CLAUDE.md')).split('\n').length - 1 <= 150);
});
