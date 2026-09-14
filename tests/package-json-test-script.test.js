// tests/package-json-test-script.test.js
//
// #407's own "fix" for npm test silently skipping tests/ (ledger #1) relied
// on `node --test`'s own glob-argument matching (`node --test 'tests/**/*.test.js'`)
// — verified only against the local dev machine's Node v22, never against
// CI's actual Node 20 runner. That shape silently failed on Node 20 with
// "Could not find 'tests/**/*.test.js'" (Node treats the literal glob string
// as a module path to require(), not a pattern to expand, on that version),
// breaking every CI run of #405-#415's own PR and the follow-up hotfix PR —
// caught only by checking GitHub's actual CI status, not by any local run.
// This pins the fix (an explicit, version-independent file list) so a future
// edit can't silently regress to the version-dependent glob shape.
//
// #2043 replaced the follow-up fix (shell `find ... | sort`, POSIX-only —
// broke `npm test` under Windows `cmd.exe`) with `tools/run-tests.js`, a
// portable Node script that walks the same roots. This file's assertions
// were updated in lockstep: they now pin the `run-tests.js` shape instead
// of the shell `find` shape, but the underlying concern (never regress to
// a raw glob string passed straight to `node --test`) is unchanged.
//
// #2270 carried the identical fix over to `test:perf`, which #2043 left out of
// scope (CLAUDE.md excludes it from `npm test`/CI, so it wasn't touched then) —
// `run-tests.js` grew an optional `roots` override (CLI positional args, or
// `listTestFiles(cwd, roots)`) so `test:perf` can invoke it as
// `node tools/run-tests.js perf` instead of shell `find`.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const { listTestFiles } = require(path.join(ROOT, 'tools', 'run-tests.js'));

test('package.json test/test:perf scripts never pass a raw glob string to `node --test` directly', () => {
  // The exact anti-pattern that broke CI: a quoted glob positional arg,
  // relying on node --test's own (Node-version-gated) glob expansion.
  assert.doesNotMatch(pkg.scripts.test, /node --test ['"][^'"]*\*\*/);
  assert.doesNotMatch(pkg.scripts['test:perf'], /node --test ['"][^'"]*\*\*/);
});

test('package.json test script resolves its file list via the portable tools/run-tests.js script, not shell `find`', () => {
  assert.match(pkg.scripts.test, /\brun-tests\.js\b/);
  assert.doesNotMatch(pkg.scripts.test, /\bfind\b/);
  assert.doesNotMatch(pkg.scripts.test, /\$\(/);
});

test('package.json test:perf script resolves its file list via the portable tools/run-tests.js script, not shell `find` (AC1)', () => {
  assert.match(pkg.scripts['test:perf'], /\brun-tests\.js\b/);
  assert.doesNotMatch(pkg.scripts['test:perf'], /\bfind\b/);
  assert.doesNotMatch(pkg.scripts['test:perf'], /\$\(/);
  // No POSIX env-prefix (e.g. `CT_HOOKS_GIT_TIMEOUT_MS=60000 ...`) either.
  assert.doesNotMatch(pkg.scripts['test:perf'], /^[A-Z_]+=/);
});

test('run-tests.js\'s listTestFiles actually discovers tests/ files when called standalone (proves the mechanism, independent of node --test)', () => {
  // This is the part that must work identically on every Node version and
  // every OS, since it never touches node --test's own argument parsing,
  // a shell, or command substitution at all.
  const files = listTestFiles(ROOT);
  assert.ok(files.length > 50, `expected the recursive tests/ walk to find well over 50 files, got ${files.length}`);
  assert.ok(files.some((f) => f.endsWith('reconcile.test.js')), 'expected this very file\'s own sibling to be discovered');
  assert.ok(files.every((f) => f.endsWith('.test.js')), 'every discovered path must be a .test.js file');
});

test('listTestFiles treats a missing root as empty rather than throwing (ENOENT, not a check-then-act race)', () => {
  // Neither ROOTS entry exists under this cwd — collectTestFiles must read each root
  // directly and swallow ENOENT, never a pre-check that could race a concurrent delete.
  const files = listTestFiles(path.join(ROOT, 'plugin', 'bin'));
  assert.deepStrictEqual(files, []);
});

test('run-tests.js\'s listTestFiles is exactly the set an independent recursive walk finds (AC1 parity, not a loose count)', () => {
  // AC1 requires the resolved file list be identical to the old `find tests
  // tools/upstream-drift/tests -name '*.test.js' | sort` output — not merely "more than
  // some threshold." A threshold like `> 50` would still pass if an entire subtree (e.g.
  // tests/bin-lib/) silently disappeared. This walks the same two roots with a second,
  // independently-implemented traversal (never calling into run-tests.js's own
  // collectTestFiles) and asserts exact set equality against listTestFiles()'s output.
  function independentWalk(dir, results) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        independentWalk(full, results);
      } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
        results.push(full);
      }
    }
  }

  const expected = [];
  independentWalk(path.join(ROOT, 'tests'), expected);
  independentWalk(path.join(ROOT, 'tools', 'upstream-drift', 'tests'), expected);
  expected.sort();

  assert.deepStrictEqual(listTestFiles(ROOT), expected);
});

test('run-tests.js\'s listTestFiles(cwd, ["perf"]) is exactly what an independent recursive walk of perf/ finds (#2270 AC2 parity)', () => {
  // #2270 AC2 requires the resolved perf test file list be identical to the old
  // `find perf -name '*.test.js' | sort` output. Same independent-walk technique as the
  // "test" script's own parity test above, scoped to the `roots` override instead of the
  // default roots.
  function independentWalk(dir, results) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        independentWalk(full, results);
      } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
        results.push(full);
      }
    }
  }

  const expected = [];
  independentWalk(path.join(ROOT, 'perf'), expected);
  expected.sort();

  assert.deepStrictEqual(listTestFiles(ROOT, ['perf']), expected);
});
