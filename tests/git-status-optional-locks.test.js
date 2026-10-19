'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments } = require('./helpers/strip-comments');

// Every read-only `git status` under plugin/bin/ must pass the top-level
// `--no-optional-locks` option (before `status`, after any `-C <path>`). A plain
// `git status` refreshes the stat cache and rewrites .git/index under
// index.lock, so a sibling session's `git add`/`git commit` in the same worktree
// fails with `index.lock: File exists` for as long as the status runs — and the
// statusline, the hooks and the reconcile passes all poll status on a timer. The
// option makes the probe lock-free; the output is identical. It is a top-level
// option, so it never goes after `status`. #3464 migrated the sites one by one;
// this test makes the rule mechanical instead of a per-site memory.
//
// Two call shapes are counted: an argv array whose subcommand element is
// 'status' (execFileSync / runGit style), and a quoted `git ... status ...`
// command string (execSync style). A match is compliant when the flag precedes
// `status` in it.
const BIN_ROOT = path.join(__dirname, '..', 'plugin', 'bin');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

// Comments blanked in one literal-aware pass — see tests/helpers/strip-comments.js
// — so a comment that mentions a call shape never counts either way.

// 'status' as the subcommand element: first in the array, after an optional
// `'-C', <expr>,` pair and any top-level `'--…'` options. The -C operand is a
// non-greedy run up to the next comma, so `path.join(a, b)` (one comma inside
// parentheses) still reaches `'status'` rather than going unseen.
const ARGV_STATUS = /\[\s*((?:'-C'\s*,\s*(?:[^,[\]()]|\([^()]*\))+?\s*,\s*)?(?:'--[\w-]+'\s*,\s*)*)'status'/g;
// A quoted literal; `status` must be followed by a flag or the end of the
// string, so the message `git status failed: ${…}` is not a command.
const QUOTED = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
const GIT_STATUS_CMD = /^git\s+(?:\S+\s+)*?status(?=\s+-|\s*$)/;

// -> { matched, offenders: [{ line, text }] } for every git status call in `raw`.
function unflaggedStatusCalls(raw) {
  const src = stripComments(raw);
  const lineOf = (index) => src.slice(0, index).split('\n').length;
  const offenders = [];
  let matched = 0;
  for (const m of src.matchAll(ARGV_STATUS)) {
    matched++;
    if (!m[1].includes("'--no-optional-locks'")) {
      offenders.push({ line: lineOf(m.index), text: m[0].replace(/\s+/g, ' ') });
    }
  }
  for (const m of src.matchAll(QUOTED)) {
    const cmd = GIT_STATUS_CMD.exec(m[2]);
    if (!cmd) continue;
    matched++;
    if (!cmd[0].includes('--no-optional-locks')) {
      offenders.push({ line: lineOf(m.index), text: m[0].slice(0, 100) });
    }
  }
  offenders.sort((a, b) => a.line - b.line);
  return { matched, offenders };
}

test('scanner flags an unflagged status call and ignores non-git status (proves it can go red)', () => {
  const flagged = unflaggedStatusCalls([
    "runGit(['status', '--porcelain'], cwd);",
    "execFileSync('git', ['-C', wtPath, 'status'], opts);",
    "execSync('git status --porcelain -b');",
    "x(['status', '--no-optional-locks']);",
    "execFileSync('git', ['-C', path.join(a, b), 'status'], o);",
  ].join('\n'));
  assert.deepEqual(flagged.offenders.map((o) => o.line), [1, 2, 3, 4, 5]);

  // A `/*` inside a // comment or a string literal must not open a fake block
  // comment that blanks the real call after it.
  const afterFakeOpeners = unflaggedStatusCalls([
    '// see staged/** here',
    "runGit(['status']);",
    '// */',
    "const g = '/*';",
    "runGit(['status']);",
    'const t = `${dir}/spec-*/work/*`;',
    "runGit(['status']);",
  ].join('\n'));
  assert.deepEqual(afterFakeOpeners.offenders.map((o) => o.line), [2, 5, 7]);

  // A regex literal ending in an escaped slash is not a `//` comment: the call
  // after it on the same line must still be seen.
  const afterEscapedSlash = unflaggedStatusCalls(
    "const n = ref.replace(/^origin\\//, ''); runGit(['status']);",
  );
  assert.deepEqual(afterEscapedSlash.offenders.map((o) => o.line), [1]);

  const clean = unflaggedStatusCalls([
    "runGit(['--no-optional-locks', 'status', '--porcelain'], cwd);",
    "execFileSync('git', ['-C', p, '--no-optional-locks', 'status'], o);",
    "execFileSync('gh', ['auth', 'status']);",
    "if (cmd === 'status') return 1;",
    'const d = `git status failed: ${e.message}`;',
    "const C = ['allocate', 'status'];",
    '// git status --porcelain in a comment',
  ].join('\n'));
  assert.deepEqual(clean.offenders, []);
  assert.equal(clean.matched, 2);
});

test('AC1.1/AC1.2/AC2.3: every git status under plugin/bin passes --no-optional-locks before the subcommand', () => {
  let total = 0;
  const offenders = [];
  for (const file of walk(BIN_ROOT)) {
    const { matched, offenders: bad } = unflaggedStatusCalls(fs.readFileSync(file, 'utf8'));
    total += matched;
    for (const o of bad) {
      offenders.push(`${path.relative(BIN_ROOT, file).replace(/\\/g, '/')}:${o.line} ${o.text}`);
    }
  }
  // 11 argv sites plus the statusline's command string at the time #3464 landed;
  // fewer means the patterns stopped matching, not that status calls went away.
  assert.ok(total >= 12, `expected at least 12 git status call sites, scanner matched ${total}`);
  assert.deepEqual(offenders, [],
    'add the top-level `--no-optional-locks` (after any -C pair, before `status`) to these calls — a plain status rewrites the index under index.lock');
});
