'use strict';

// The repo-local guard's classifier for a typed Bash command (#5547): which direct `node --test` runs it
// denies, the runner command it names instead, and that every named command is one the guard allows and
// the runner's own operand parser accepts.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { classifyCommand, hasDirectTestRun, SAFEGUARDS_TEXT } = require('../tools/direct-test-run-guard');
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
];

const EXPANSION_LINE = 'The runner takes *.test.js files only and refuses anything else the expansion names, so make it name test files only.';

function reasonFor(replacement, { expansion = false } = {}) {
  return [
    `This repository's guard blocked a direct test run. ${SAFEGUARDS_TEXT}`,
    'Run the same files through the runner, which takes the same files and node test flags:',
    '',
    replacement,
    '',
    ...(expansion ? [EXPANSION_LINE] : []),
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
    assert.equal(classifyCommand(command, opts).decision, 'allow', command);
  }
  for (const [command] of DENY_ROWS) {
    const verdict = classifyCommand(command, opts);
    assert.equal(verdict.decision, 'deny', command);
    assert.equal(verdict.kind, 'typed', command);
  }
});

test('each deny row names its replacement', () => {
  for (const [command, replacement] of DENY_ROWS) {
    assert.equal(classifyCommand(command, opts).replacement, replacement === null ? PLACEHOLDER : replacement, command);
  }
});

test('a trailing slash denies even when the path is not a directory', () => {
  assert.equal(classifyCommand('node --test tests/', { ...opts, isDirectory: () => false }).decision, 'deny');
  // Its counterpart: without the slash, only isDirectory decides.
  assert.equal(classifyCommand('node --test tests', { ...opts, isDirectory: () => false }).decision, 'allow');
});

test('a run whose working directory is under evals/ is allowed with no operand to read', () => {
  // `cd evals && node --test tests/` is also allowed by its operand; this one only by the cwd.
  assert.equal(classifyCommand('cd evals && node --test', opts).decision, 'allow');
  assert.equal(classifyCommand('cd scripts && node --test', opts).decision, 'deny');
});

test('a redirection target is no file operand, and a clustered -c is a wrapper', () => {
  assert.equal(classifyCommand('node --test tests/a.test.js > out.txt 2>&1', opts).decision, 'allow');
  assert.equal(classifyCommand('node --test tests/a.test.js >out.txt', opts).decision, 'allow');
  assert.equal(classifyCommand('bash -lc "node --test tests/a.test.js tests/b.test.js"', opts).decision, 'deny');
});

test('allows everything when no runner is above the working directory', () => {
  assert.deepEqual(classifyCommand(DENY_ROWS[0][0], { ...opts, hasRunner: () => null }), { decision: 'allow' });
});

test('never throws', () => {
  assert.deepEqual(classifyCommand(undefined, opts), { decision: 'allow' });
  assert.deepEqual(classifyCommand('', opts), { decision: 'allow' });
  assert.deepEqual(classifyCommand('('.repeat(200000), opts), { decision: 'allow' });
  const throwing = { ...opts, hasRunner: () => { throw new Error('boom'); } };
  assert.deepEqual(classifyCommand('node --test tests/a.test.js tests/b.test.js', throwing), { decision: 'allow' });
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
    assert.equal(classifyCommand(command, opts).replacement, replacement, command);
  }
});

test('the directory prefix quotes a directory holding a space', () => {
  const spaced = { ...opts, isDirectory: () => false };
  assert.equal(
    classifyCommand('cd "my tests" && node --test a.test.js b.test.js', spaced).replacement,
    'cd "my tests" && node ../tools/run-tests.js a.test.js b.test.js',
  );
});

test('the reason names the four safeguards, the replacement on its own line, --files-from, and the single-file allowance', () => {
  const [command, replacement] = DENY_ROWS[0];
  assert.equal(
    SAFEGUARDS_TEXT,
    'A direct node --test over several files, or in a loop, skips what tools/run-tests.js gives a run: git auto-maintenance off for fixture repos, a per-run TMPDIR removed on exit, the machine-wide suite slot, and bounded file concurrency.',
  );
  assert.equal(classifyCommand(command, opts).reason, reasonFor(replacement, { expansion: true }));
});

test('the unresolved-expansion reason says the runner takes test files only', () => {
  assert.equal(
    classifyCommand('node --test $(git diff --name-only main)', opts).reason,
    reasonFor('node tools/run-tests.js $(git diff --name-only main)', { expansion: true }),
  );
  const plain = classifyCommand('node --test tests/a.test.js tests/b.test.js', opts).reason;
  assert.equal(plain, reasonFor('node tools/run-tests.js tests/a.test.js tests/b.test.js'));
  assert.equal(plain.includes(EXPANSION_LINE), false);
});

test('AC9.1 AC9.2: every replacement line is allowed by the classifier and accepted by the runner\'s parser', () => {
  const rows = DENY_ROWS.filter(([, replacement]) => replacement !== null).map(([command]) => command);
  rows.push('cd tests && node --test a.test.js b.test.js');
  for (const command of rows) {
    const { replacement } = classifyCommand(command, opts);
    assert.equal(classifyCommand(replacement, opts).decision, 'allow', `${command} -> ${replacement}`);
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
  assert.equal(classifyCommand('node --test tests/a.test.js tests/b.test.js', win).decision, 'deny');
  assert.equal(classifyCommand('"C:/nodejs/node.exe" --test tests/a.test.js', win).decision, 'allow');
});

test('hasDirectTestRun finds a single-file run and ignores quoted text', () => {
  const o = { cwd: '/repo', pathImpl: path.posix };
  assert.equal(hasDirectTestRun('node --test tests/a.test.js', o), true);
  assert.equal(hasDirectTestRun('sh -c "node tests/a.test.js"', o), true);
  assert.equal(hasDirectTestRun('for f in x; do node --test "$f"; done', o), true);
  assert.equal(hasDirectTestRun('echo "node --test a.test.js"', o), false);
  assert.equal(hasDirectTestRun('node tools/run-tests.js tests/a.test.js', o), false);
});
