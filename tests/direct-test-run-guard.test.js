'use strict';

// The repo-local guard's classifier for a typed Bash command (#5547): which direct `node --test` runs it
// denies, the runner command it names instead, and that every named command is one the guard allows and
// the runner's own operand parser accepts.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// Every verdict below is read through classifyCommandOrThrow, which lets an internal error through, so a
// classifier bug can never pass an allow row by landing in classifyCommand's catch.
const { classifyCommand, classifyCommandOrThrow, hasDirectTestRun, SAFEGUARDS_TEXT } = require('../tools/direct-test-run-guard');
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
