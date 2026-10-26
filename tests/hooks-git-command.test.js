// tests/hooks-git-command.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const {
  gitTargets, gitTargetsFrom, resolvedGitSegments, resolveGitCommand, fileWriteTargets, mkdirTargets, powershellOpaqueCommand, skipGlobalFlags, tokenize, redirectWriteTargets,
} = require('../plugin/bin/lib/hooks/git-command');

test('plain commit resolves to cwd', () => {
  assert.deepStrictEqual(gitTargets('git commit -m "x"', '/repo'), [{ action: 'commit', dir: '/repo' }]);
});

test('git -C targets the given dir, resolved against cwd', () => {
  assert.deepStrictEqual(gitTargets('git -C /wt/spec-1 commit -m "x"', '/repo'), [{ action: 'commit', dir: path.resolve('/wt/spec-1') }]);
  assert.deepStrictEqual(gitTargets('git -C ../other commit -m "x"', '/repo/sub'), [{ action: 'commit', dir: path.resolve('/repo/other') }]);
});

test('cd chains update the effective cwd', () => {
  assert.deepStrictEqual(gitTargets('cd /wt/spec-1 && git add f.js && git commit -m "x"', '/repo'), [
    { action: 'commit', dir: path.resolve('/wt/spec-1') },
  ]);
});

test('a cd on its own line, preceded by an unrelated statement joined only by a newline, still updates the effective cwd', () => {
  assert.deepStrictEqual(
    gitTargets('VAR="unrelated"\ncd /wt/spec-1 && git add f.js && git commit -m "x"', '/repo'),
    [{ action: 'commit', dir: path.resolve('/wt/spec-1') }],
  );
});

test('a shell-variable cd on its own line, preceded by an unrelated statement, resolves via the same-command assignment (no fallback to the stale cwd — the assignment IS the proof)', () => {
  assert.deepStrictEqual(
    gitTargets('MKT="/wt/spec-1"\ncd "$MKT" && git commit -m "x"', '/repo'),
    [{ action: 'commit', dir: path.resolve('/wt/spec-1') }],
  );
});

test('a cd referencing a variable with no same-command assignment stays unresolvable', () => {
  assert.deepStrictEqual(
    gitTargets('cd "$SOME_VAR" && git commit -m "x"', '/repo'),
    [],
  );
});

test('fileWriteTargets resolves a same-command literal assignment substituted into a write target', () => {
  assert.deepStrictEqual(
    fileWriteTargets('SP=/private/tmp/foo; sed -i "" -e "s/x/y/" "$SP/file.md" && grep -c x "$SP/file.md"', '/repo'),
    [{ action: 'edit', file: path.resolve('/private/tmp/foo/file.md') }],
  );
});

test('a dynamic/unresolvable assignment value is never chained — target stays unresolvable', () => {
  assert.deepStrictEqual(
    fileWriteTargets('SP=$(pwd); sed -i "" -e "s/x/y/" "$SP/file.md"', '/repo'),
    [],
  );
});

test('a later re-assignment of the same name overrides the earlier one', () => {
  assert.deepStrictEqual(
    fileWriteTargets('SP=/a; SP=/b; sed -i "" -e "s/x/y/" "$SP/file.md"', '/repo'),
    [{ action: 'edit', file: path.resolve('/b/file.md') }],
  );
});

test('a later re-assignment to an unresolvable value drops the earlier mapping — no stale substitution', () => {
  assert.deepStrictEqual(
    fileWriteTargets('SP=/a; SP=$(pwd); sed -i "" -e "s/x/y/" "$SP/file.md"', '/repo'),
    [],
  );
});

test('a single-quoted $NAME reference is never substituted — real bash does not expand inside single quotes', () => {
  assert.deepStrictEqual(
    fileWriteTargets("SP=/private/tmp/foo; sed -i '' -e 's/x/y/' '$SP/file.md'", '/repo'),
    [],
  );
});

test('a single-quoted $NAME cd target is never substituted, mirroring the write-target case', () => {
  assert.deepStrictEqual(
    gitTargets('MKT="/wt/spec-1"\ncd \'$MKT\' && git commit -m "x"', '/repo'),
    [],
  );
});

test('a newline inside a quoted commit message does not fabricate a segment boundary', () => {
  assert.deepStrictEqual(
    gitTargets('git commit -m "line one\nline two" && git push', '/repo'),
    [
      { action: 'commit', dir: '/repo' },
      { action: 'push', dir: '/repo' },
    ],
  );
});

test('push is reported; other subcommands are not', () => {
  assert.deepStrictEqual(gitTargets('git push origin main', '/repo'), [{ action: 'push', dir: '/repo' }]);
  assert.deepStrictEqual(gitTargets('git status && git log --oneline -3', '/repo'), []);
});

test('multiple targets across separators', () => {
  assert.deepStrictEqual(gitTargets('git commit -m "a"; git push', '/repo'), [
    { action: 'commit', dir: '/repo' },
    { action: 'push', dir: '/repo' },
  ]);
});

test('value-taking global flags do not swallow the subcommand', () => {
  assert.deepStrictEqual(gitTargets('git -c user.name=x commit -m "y"', '/repo'), [{ action: 'commit', dir: '/repo' }]);
  assert.deepStrictEqual(gitTargets('git --git-dir /g --work-tree /w commit -m "y"', '/repo'), []); // explicit git-dir: cannot prove target — no claim
});

test('quoted paths are unquoted', () => {
  assert.deepStrictEqual(gitTargets('git -C "/wt/my spec" commit -m "x"', '/repo'), [{ action: 'commit', dir: path.resolve('/wt/my spec') }]);
});

test('non-git and empty commands yield nothing, never throw', () => {
  assert.deepStrictEqual(gitTargets('npm test', '/repo'), []);
  assert.deepStrictEqual(gitTargets('', '/repo'), []);
  assert.deepStrictEqual(gitTargets(undefined, '/repo'), []);
});

test('separators inside quotes do not fabricate targets (double quotes)', () => {
  assert.deepStrictEqual(
    gitTargets('git commit -m "text && git -C /malicious push && more text"', '/repo'),
    [{ action: 'commit', dir: '/repo' }],
  );
});

test('separators inside quotes do not fabricate targets (single quotes, ; and |)', () => {
  assert.deepStrictEqual(
    gitTargets("git commit -m 'text ; git -C /malicious push | more text'", '/repo'),
    [{ action: 'commit', dir: '/repo' }],
  );
});

test('unresolvable cd forms poison the effective cwd — a following git commit yields no target', () => {
  assert.deepStrictEqual(gitTargets('cd && git commit -m "x"', '/repo'), []);
  assert.deepStrictEqual(gitTargets('cd - && git commit -m "x"', '/repo'), []);
  assert.deepStrictEqual(gitTargets('cd ~ && git commit -m "x"', '/repo'), []);
  assert.deepStrictEqual(gitTargets('cd "$HOME/x" && git commit -m "x"', '/repo'), []);
});

test('poisoned cwd + git -C <absolute plain path> is still provable', () => {
  assert.deepStrictEqual(
    gitTargets('cd && git -C /abs/path commit -m "x"', '/repo'),
    [{ action: 'commit', dir: path.resolve('/abs/path') }],
  );
});

test('poisoned cwd then cd to an absolute plain path restores provability', () => {
  assert.deepStrictEqual(
    gitTargets('cd && cd /abs/known && git commit -m "x"', '/repo'),
    [{ action: 'commit', dir: path.resolve('/abs/known') }],
  );
});

test('repeated -C flags stack cumulatively like real git', () => {
  assert.deepStrictEqual(gitTargets('git -C /a -C b commit -m "x"', '/repo'), [{ action: 'commit', dir: path.resolve('/a', 'b') }]);
  assert.deepStrictEqual(gitTargets('git -C /a -C /c commit -m "x"', '/repo'), [{ action: 'commit', dir: path.resolve('/c') }]);
});

test('-C value containing $ or ~ yields no target regardless of cwd state', () => {
  assert.deepStrictEqual(gitTargets('git -C "$HOME/x" commit -m "x"', '/repo'), []);
  assert.deepStrictEqual(gitTargets('git -C ~/x commit -m "x"', '/repo'), []);
});

test('while cwd is unknown, a relative cd keeps it unknown', () => {
  assert.deepStrictEqual(gitTargets('cd && cd sub && git commit -m "x"', '/repo'), []);
});

test('a cd argument with a backtick poisons the cwd', () => {
  assert.deepStrictEqual(gitTargets('cd `pwd` && git commit -m "x"', '/repo'), []);
});

test('a relative -C value while cwd is unknown yields no target', () => {
  assert.deepStrictEqual(gitTargets('cd && git -C sub commit -m "x"', '/repo'), []);
});

test('an escaped quote inside a double-quoted string does not close it (with -C)', () => {
  assert.deepStrictEqual(
    gitTargets('git commit -m "abc\\" && git -C /evil push "', '/repo'),
    [{ action: 'commit', dir: '/repo' }],
  );
});

test('an escaped quote inside a double-quoted string does not close it (no -C, cwd not fabricated)', () => {
  assert.deepStrictEqual(
    gitTargets('git commit -m "abc\\" && git push "', '/repo'),
    [{ action: 'commit', dir: '/repo' }],
  );
});

test('a doubled backslash before the closing quote is a literal backslash — the quote DOES close, so a following separator is a real command', () => {
  assert.deepStrictEqual(
    gitTargets('git commit -m "a\\\\" && git push', '/repo'),
    [
      { action: 'commit', dir: '/repo' },
      { action: 'push', dir: '/repo' },
    ],
  );
});

test('a cd argument containing an escaped quote is unresolvable and poisons cwd', () => {
  assert.deepStrictEqual(gitTargets('cd "pa\\"th" && git commit', '/repo'), []);
});

test('a -C value containing an escaped quote is unresolvable — no target', () => {
  assert.deepStrictEqual(gitTargets('git -C "we\\"ird" commit', '/repo'), []);
});

test('positive control: an unquoted separator after a simple quoted string still yields both targets', () => {
  assert.deepStrictEqual(gitTargets('git commit -m "x" && git push', '/repo'), [
    { action: 'commit', dir: '/repo' },
    { action: 'push', dir: '/repo' },
  ]);
});

test('fileWriteTargets: /dev/null and friends are never a write target', () => {
  assert.deepStrictEqual(fileWriteTargets('tee /dev/null', '/repo'), []);
  assert.deepStrictEqual(fileWriteTargets('cp a.txt /dev/null', '/repo'), []);
});

test('fileWriteTargets: tee resolves its first non-flag argument', () => {
  assert.deepStrictEqual(fileWriteTargets('echo hi | tee out.txt', '/repo'), [{ action: 'write', file: path.resolve('/repo', 'out.txt') }]);
  assert.deepStrictEqual(fileWriteTargets('echo hi | tee -a out.txt', '/repo'), [{ action: 'write', file: path.resolve('/repo', 'out.txt') }]);
});

test('fileWriteTargets: cp/mv resolve the last non-flag argument as the destination', () => {
  assert.deepStrictEqual(fileWriteTargets('cp a.txt b.txt', '/repo'), [{ action: 'copy', file: path.resolve('/repo', 'b.txt') }]);
  assert.deepStrictEqual(fileWriteTargets('mv a.txt b.txt', '/repo'), [{ action: 'move', file: path.resolve('/repo', 'b.txt') }]);
  assert.deepStrictEqual(fileWriteTargets('cp -r a b c/dest', '/repo'), [{ action: 'copy', file: path.resolve('/repo', 'c/dest') }]);
});

test('fileWriteTargets: cd chains update the effective cwd before a write', () => {
  assert.deepStrictEqual(fileWriteTargets('cd /wt/spec-1 && tee out.txt', '/repo'), [
    { action: 'write', file: path.resolve('/wt/spec-1', 'out.txt') },
  ]);
});

test('fileWriteTargets: an unresolvable target (variable, backtick, tilde) yields no target', () => {
  assert.deepStrictEqual(fileWriteTargets('tee "$FILE"', '/repo'), []);
  assert.deepStrictEqual(fileWriteTargets('tee `pwd`/out.txt', '/repo'), []);
  assert.deepStrictEqual(fileWriteTargets('tee ~/out.txt', '/repo'), []);
});

test('fileWriteTargets: a plain read-only command yields no target', () => {
  assert.deepStrictEqual(fileWriteTargets('cat a.txt | grep foo', '/repo'), []);
  assert.deepStrictEqual(fileWriteTargets('npm test', '/repo'), []);
  assert.deepStrictEqual(fileWriteTargets('', '/repo'), []);
});

test('AC1.1: an empty -C value ("git -C \'\' commit") behaves like omitting -C entirely — identical target, not like an unparseable command', () => {
  // A truthy check on t[i+1] treats a genuinely-present-but-empty value as
  // "no value follows", mis-consuming only the -C flag and leaving the
  // leftover '' to be misread as the subcommand — silently producing zero
  // targets for a command real git treats as fully valid.
  assert.deepStrictEqual(gitTargets('git -C "" commit -m "msg"', '/repo'), gitTargets('git commit -m "msg"', '/repo'));
  assert.deepStrictEqual(gitTargets('git -C "" commit -m "msg"', '/repo'), [{ action: 'commit', dir: '/repo' }]);
});

test('AC1.2: empty -C and omitted -C resolve to the identical dir under both path.posix and path.win32 (#3314)', () => {
  for (const impl of [path.posix, path.win32]) {
    const empty = skipGlobalFlags(['git', '-C', '', 'commit'], 1, '/repo', impl);
    const omitted = skipGlobalFlags(['git', 'commit'], 1, '/repo', impl);
    assert.strictEqual(empty.dir, omitted.dir);
    assert.strictEqual(empty.dir, '/repo');
    assert.strictEqual(empty.index, 3);
    assert.strictEqual(empty.unprovable, false);
  }
});

test('the injected pathImpl governs the non-empty -C branches too, so AC1.2 is not satisfied by a host-bound path (#3314)', () => {
  assert.strictEqual(skipGlobalFlags(['git', '-C', '/abs', 'commit'], 1, '/repo', path.win32).dir, path.win32.resolve('/abs'));
  assert.strictEqual(skipGlobalFlags(['git', '-C', 'sub', 'commit'], 1, '/repo', path.win32).dir, path.win32.resolve('/repo', 'sub'));
});

test('an empty -C value leaves an UNKNOWN cwd unprovable, and a following relative -C resolves against the unchanged cwd', () => {
  assert.strictEqual(resolveGitCommand(['git', '-C', '', 'commit'], null), null);
  assert.deepStrictEqual(gitTargets('git -C "" -C b commit -m "x"', '/repo'), [{ action: 'commit', dir: path.resolve('/repo', 'b') }]);
});

test('an empty value for a global VALUE_FLAG (-c) does not swallow the subcommand either', () => {
  assert.deepStrictEqual(gitTargets('git -c "" commit -m "msg"', '/repo'), [{ action: 'commit', dir: '/repo' }]);
});

test('a trailing # comment is inert — no fabricated segments from && / ; / | inside it', () => {
  assert.deepStrictEqual(
    gitTargets('git commit -m "wip: refactor" # note && git -C /evil commit --amend', '/repo'),
    [{ action: 'commit', dir: '/repo' }],
  );
});

test('a # comment ends at the newline, not swallowing a real command that follows on the next line', () => {
  assert.deepStrictEqual(
    gitTargets('git commit -m "a" # comment\ngit push', '/repo'),
    [{ action: 'commit', dir: '/repo' }, { action: 'push', dir: '/repo' }],
  );
});

test('a # not at the start of a word (glued to preceding text) is NOT a comment — a real separator right after it still splits normally', () => {
  assert.deepStrictEqual(
    gitTargets('echo hi#comment && git commit -m "x"', '/repo'),
    [{ action: 'commit', dir: '/repo' }],
  );
});

test('a cd argument formed by a quoted prefix glued (no whitespace) to an unresolvable unquoted suffix poisons cwd instead of resolving just the quoted part', () => {
  assert.deepStrictEqual(gitTargets('cd "/tmp/safe/"$SUFFIX && git commit -m "x"', '/repo'), []);
});

test("cd's own flags (-P, -L, --) are not mistaken for a path argument — poisons cwd instead of resolving a bogus child directory", () => {
  assert.deepStrictEqual(gitTargets('cd -P /abs/other-repo && git commit -m "x"', '/repo'), []);
  assert.deepStrictEqual(gitTargets('cd -L /abs/other-repo && git commit -m "x"', '/repo'), []);
  assert.deepStrictEqual(gitTargets('cd -- /abs/other-repo && git commit -m "x"', '/repo'), []);
});

test('fileWriteTargets: tee with multiple destination files reports every one of them, not just the first', () => {
  assert.deepStrictEqual(fileWriteTargets('tee /worktree/notes.txt /etc/important-file', '/repo'), [
    { action: 'write', file: path.resolve('/worktree/notes.txt') },
    { action: 'write', file: path.resolve('/etc/important-file') },
  ]);
});

test('fileWriteTargets: cp/mv -t DIR names the real destination directory, not the last source', () => {
  assert.deepStrictEqual(fileWriteTargets('cp -t /main/checkout secret.txt', '/repo'), [{ action: 'copy', file: path.resolve('/main/checkout') }]);
  assert.deepStrictEqual(fileWriteTargets('mv -t /main/checkout a.txt b.txt', '/repo'), [{ action: 'move', file: path.resolve('/main/checkout') }]);
});

test('fileWriteTargets: cp/mv --target-directory=DIR and --target-directory DIR are both recognized', () => {
  assert.deepStrictEqual(fileWriteTargets('cp --target-directory=/main/checkout secret.txt', '/repo'), [{ action: 'copy', file: path.resolve('/main/checkout') }]);
  assert.deepStrictEqual(fileWriteTargets('cp --target-directory /main/checkout secret.txt', '/repo'), [{ action: 'copy', file: path.resolve('/main/checkout') }]);
});

test('fileWriteTargets: a tee argument formed by a quoted prefix glued to an unresolvable unquoted suffix yields no target', () => {
  assert.deepStrictEqual(fileWriteTargets('tee "/safe/"$X', '/repo'), []);
});

// mkdirTargets — deliberately NOT part of WRITE_SHAPES/fileWriteTargets (#692):
// widening WRITE_SHAPES would also widen the worktree-always Bash-write gate's
// coverage, which tests/hooks-gate-coverage.test.js pins against
// skills/_shared/policy-schema-coverage.md's prose. The pipeline-shadow guard needs its
// own, separate mkdir target parser instead.
test('mkdirTargets: resolves a plain absolute target', () => {
  assert.deepStrictEqual(mkdirTargets('mkdir /worktree/.claude-tweaks/pipelines/x', '/repo'), [
    { action: 'mkdir', file: path.resolve('/worktree/.claude-tweaks/pipelines/x') },
  ]);
});

test('mkdirTargets: -p and other bare flags are skipped, not mistaken for a target', () => {
  assert.deepStrictEqual(mkdirTargets('mkdir -p /worktree/.claude-tweaks/pipelines/x', '/repo'), [
    { action: 'mkdir', file: path.resolve('/worktree/.claude-tweaks/pipelines/x') },
  ]);
});

test('mkdirTargets: every positional is a target — mkdir can create multiple directories at once', () => {
  assert.deepStrictEqual(mkdirTargets('mkdir -p a b', '/repo'), [
    { action: 'mkdir', file: path.resolve('/repo', 'a') },
    { action: 'mkdir', file: path.resolve('/repo', 'b') },
  ]);
});

test('mkdirTargets: -m MODE consumes its value, not a positional', () => {
  assert.deepStrictEqual(mkdirTargets('mkdir -m 0755 /worktree/x', '/repo'), [
    { action: 'mkdir', file: path.resolve('/worktree/x') },
  ]);
});

test('mkdirTargets: a relative path resolves against cwd, cd chains update it', () => {
  assert.deepStrictEqual(mkdirTargets('cd /worktree && mkdir sub', '/repo'), [
    { action: 'mkdir', file: path.resolve('/worktree', 'sub') },
  ]);
});

test('mkdirTargets: an unresolvable target (variable, backtick, tilde) yields no target', () => {
  assert.deepStrictEqual(mkdirTargets('mkdir "$DIR"', '/repo'), []);
});

test('mkdirTargets: a non-mkdir command yields no target', () => {
  assert.deepStrictEqual(mkdirTargets('cp a b', '/repo'), []);
});

// #590: env-prefixed and path-qualified git invocations bypass the
// `t[0] !== 'git'` check the same way a bare `git commit`/`git push` proves a
// target — a real shell treats these shapes identically.
test('an env-var-prefixed git commit still resolves a target', () => {
  assert.deepStrictEqual(gitTargets('FOO=1 git commit -m "x"', '/repo'), [{ action: 'commit', dir: '/repo' }]);
});

test('a path-qualified git commit still resolves a target', () => {
  assert.deepStrictEqual(gitTargets('/usr/bin/git commit -m "x"', '/repo'), [{ action: 'commit', dir: '/repo' }]);
});

test('env-wrapped git (with and without env\'s own flags/assignments) still resolves a target', () => {
  assert.deepStrictEqual(gitTargets('env git commit -m "x"', '/repo'), [{ action: 'commit', dir: '/repo' }]);
  assert.deepStrictEqual(gitTargets('env -i git commit -m "x"', '/repo'), [{ action: 'commit', dir: '/repo' }]);
  assert.deepStrictEqual(gitTargets('env FOO=1 git commit -m "x"', '/repo'), [{ action: 'commit', dir: '/repo' }]);
});

test('env-prefixed/path-qualified git push resolves too, not just commit', () => {
  assert.deepStrictEqual(gitTargets('FOO=1 git push origin main', '/repo'), [{ action: 'push', dir: '/repo' }]);
  assert.deepStrictEqual(gitTargets('/usr/bin/git push origin main', '/repo'), [{ action: 'push', dir: '/repo' }]);
});

test('env-var-prefix and path-qualification compose: both together still resolve a target', () => {
  assert.deepStrictEqual(gitTargets('FOO=1 /usr/bin/git commit -m "x"', '/repo'), [{ action: 'commit', dir: '/repo' }]);
  assert.deepStrictEqual(gitTargets('env FOO=1 /usr/bin/git commit -m "x"', '/repo'), [{ action: 'commit', dir: '/repo' }]);
});

test('an executable merely ending in "git"-like text but not the literal git basename is not mistaken for git', () => {
  assert.deepStrictEqual(gitTargets('/usr/bin/mygit commit -m "x"', '/repo'), []);
});

test('a bare unrelated NAME=value prefix on a non-git command still yields nothing', () => {
  assert.deepStrictEqual(gitTargets('FOO=bar npm test', '/repo'), []);
});

test('an env-var-prefixed cd changes the effective cwd, matching real bash — a following bare commit targets the new dir', () => {
  // Verified empirically: `FOO=1 cd /x` really does change the shell's cwd
  // (cd is a regular, not a POSIX "special", builtin — it has no subprocess
  // to scope the assignment to, so cd still runs against the current shell).
  assert.deepStrictEqual(gitTargets('FOO=1 cd /var && git commit -m "x"', '/repo'), [{ action: 'commit', dir: path.resolve('/var') }]);
});

test('an env-WRAPPED cd (as opposed to env-var-PREFIXED) does not change cwd, matching real bash — env execs a nonexistent "cd" binary and errors, so a following bare commit still targets the stale cwd', () => {
  assert.deepStrictEqual(gitTargets('env cd /var; git commit -m "x"', '/repo'), [{ action: 'commit', dir: '/repo' }]);
});

// env's arg-taking flags: skipping `-C`/`--chdir` without consuming the value
// made the dir token the presumed command word ("not git" → silent allow),
// while GNU env really runs git with that dir as its cwd — the exact bypass
// shape for a worktree session mutating the protected main checkout.
test("env -C <dir> git commit resolves the target to env's chdir dir, not the caller cwd", () => {
  assert.deepStrictEqual(gitTargets('env -C /main-checkout git commit -m "x"', '/repo'), [{ action: 'commit', dir: path.resolve('/main-checkout') }]);
});

test('env --chdir=<dir> and env --chdir <dir> both resolve the target to the chdir dir', () => {
  assert.deepStrictEqual(gitTargets('env --chdir=/main-checkout git push', '/repo'), [{ action: 'push', dir: path.resolve('/main-checkout') }]);
  assert.deepStrictEqual(gitTargets('env --chdir /main-checkout git push', '/repo'), [{ action: 'push', dir: path.resolve('/main-checkout') }]);
});

test('a relative env -C value resolves against the effective cwd, and stacks with git\'s own -C', () => {
  assert.deepStrictEqual(gitTargets('env -C sub git commit -m "x"', '/repo'), [{ action: 'commit', dir: path.resolve('/repo', 'sub') }]);
  assert.deepStrictEqual(gitTargets('env -C /a git -C b commit -m "x"', '/repo'), [{ action: 'commit', dir: path.resolve('/a', 'b') }]);
});

test('an unresolvable env -C value ($VAR, ~) yields no target — never a fabricated one', () => {
  assert.deepStrictEqual(gitTargets('env -C "$DIR" git commit -m "x"', '/repo'), []);
  assert.deepStrictEqual(gitTargets('env -C ~/x git commit -m "x"', '/repo'), []);
});

test('env -u NAME consumes its value — the unset name is not mistaken for the command word', () => {
  assert.deepStrictEqual(gitTargets('env -u GIT_DIR git commit -m "x"', '/repo'), [{ action: 'commit', dir: '/repo' }]);
  assert.deepStrictEqual(gitTargets('env -u FOO npm test', '/repo'), []);
});

test('the ATTACHED-value env -C<dir> form resolves the target like the separate form — not skipped as a generic flag', () => {
  // Real env (macOS and GNU alike) honors `-C/dir` with the value attached;
  // treating it as a valueless flag left the resolved dir at the caller's
  // cwd while git was still detected as lead — a silent-allow bypass.
  assert.deepStrictEqual(gitTargets('env -C/main-checkout git commit -m "x"', '/repo'), [{ action: 'commit', dir: path.resolve('/main-checkout') }]);
  assert.deepStrictEqual(gitTargets('env -Csub git push', '/repo'), [{ action: 'push', dir: path.resolve('/repo', 'sub') }]);
  assert.deepStrictEqual(gitTargets('env -C"$DIR" git commit -m "x"', '/repo'), []);
});

test('an attached env -uNAME form is consumed whole — git is still found as lead', () => {
  assert.deepStrictEqual(gitTargets('env -uFOO git commit -m "x"', '/repo'), [{ action: 'commit', dir: '/repo' }]);
});

// #2065: resolvedGitSegments is now the one shared traversal gitTargets and
// checkGitStashWarn (pre-tool-use.js) both consume — gitTargetsFrom is a
// pure classification over its output. Every existing fixture in this file,
// plus the #976 exclusion set (tests/hooks-gate-coverage.test.js), must
// still resolve byte-identically through the new two-step path as through
// the old single-function one.
const { forEachCommandSegment } = require('../plugin/bin/lib/hooks/git-command');

const RESOLVED_SEGMENTS_FIXTURES = [
  ['git commit -m "x"', '/repo'],
  ['git -C /wt/spec-1 commit -m "x"', '/repo'],
  ['git -C ../other commit -m "x"', '/repo/sub'],
  ['cd /wt/spec-1 && git add f.js && git commit -m "x"', '/repo'],
  ['VAR="unrelated"\ncd /wt/spec-1 && git add f.js && git commit -m "x"', '/repo'],
  ['MKT="/wt/spec-1"\ncd "$MKT" && git commit -m "x"', '/repo'],
  ['cd "$SOME_VAR" && git commit -m "x"', '/repo'],
  ['git commit -m "line one\nline two" && git push', '/repo'],
  ['git push origin main', '/repo'],
  ['git status && git log --oneline -3', '/repo'],
  ['git commit -m "a"; git push', '/repo'],
  ['git -c user.name=x commit -m "y"', '/repo'],
  ['git --git-dir /g --work-tree /w commit -m "y"', '/repo'],
  ['git -C "/wt/my spec" commit -m "x"', '/repo'],
  ['npm test', '/repo'],
  ['', '/repo'],
  [undefined, '/repo'],
  ['git commit -m "text && git -C /malicious push && more text"', '/repo'],
  ["git commit -m 'text ; git -C /malicious push | more text'", '/repo'],
  ['cd && git commit -m "x"', '/repo'],
  ['cd - && git commit -m "x"', '/repo'],
  ['cd ~ && git commit -m "x"', '/repo'],
  ['cd "$HOME/x" && git commit -m "x"', '/repo'],
  ['git -C /a -C b commit -m "x"', '/repo'],
  ['git -C /a -C /c commit -m "x"', '/repo'],
  ['git -C "$HOME/x" commit -m "x"', '/repo'],
  ['git -C ~/x commit -m "x"', '/repo'],
  ['cd `pwd` && git commit -m "x"', '/repo'],
  ['cd && git -C sub commit -m "x"', '/repo'],
  ['git commit -m "abc\\" && git -C /evil push "', '/repo'],
  ['git commit -m "abc\\" && git push "', '/repo'],
  ['git commit -m "a\\\\" && git push', '/repo'],
  ['cd "pa\\"th" && git commit', '/repo'],
  ['git -C "we\\"ird" commit', '/repo'],
  ['git commit -m "x" && git push', '/repo'],
  ['git -C "" commit -m "msg"', '/repo'],
  ['git -c "" commit -m "msg"', '/repo'],
  ['git commit -m "wip: refactor" # note && git -C /evil commit --amend', '/repo'],
  ['git commit -m "a" # comment\ngit push', '/repo'],
  ['echo hi#comment && git commit -m "x"', '/repo'],
  ['cd "/tmp/safe/"$SUFFIX && git commit -m "x"', '/repo'],
  ['cd -P /abs/other-repo && git commit -m "x"', '/repo'],
  ['FOO=1 git commit -m "x"', '/repo'],
  ['/usr/bin/git commit -m "x"', '/repo'],
  ['env git commit -m "x"', '/repo'],
  ['env -i git commit -m "x"', '/repo'],
  ['env FOO=1 git commit -m "x"', '/repo'],
  ['FOO=1 git push origin main', '/repo'],
  ['/usr/bin/mygit commit -m "x"', '/repo'],
  ['FOO=bar npm test', '/repo'],
  ['FOO=1 cd /var && git commit -m "x"', '/repo'],
  ['env cd /var; git commit -m "x"', '/repo'],
  ['env -C /main-checkout git commit -m "x"', '/repo'],
  ['env --chdir=/main-checkout git push', '/repo'],
  ['env -C sub git commit -m "x"', '/repo'],
  ['env -C "$DIR" git commit -m "x"', '/repo'],
  ['env -u GIT_DIR git commit -m "x"', '/repo'],
  ['env -uFOO git commit -m "x"', '/repo'],
  // #976 exclusion set — stash/reset/checkout/merge resolve no gitTargets
  // classification, but DO resolve as git segments (stash is the sole
  // one checkGitStashWarn's own classification reads).
  ['git stash list', '/repo'],
  ['git reset', '/repo'],
  ['git checkout main', '/repo'],
  ['git merge origin/main', '/repo'],
];

test('#2065: gitTargetsFrom(resolvedGitSegments(cmd, cwd)) deep-equals gitTargets(cmd, cwd) for every fixture', () => {
  for (const [cmd, cwd] of RESOLVED_SEGMENTS_FIXTURES) {
    assert.deepStrictEqual(
      gitTargetsFrom(resolvedGitSegments(cmd, cwd)),
      gitTargets(cmd, cwd),
      `mismatch for ${JSON.stringify(cmd)} in ${cwd}`,
    );
  }
});

test('#2065: resolvedGitSegments reports the same index/dir per segment that resolveGitCommand resolves directly', () => {
  for (const [cmd, cwd] of RESOLVED_SEGMENTS_FIXTURES) {
    const expected = [];
    forEachCommandSegment(cmd, cwd, (t, effCwd) => {
      const resolved = resolveGitCommand(t, effCwd);
      if (!resolved) return;
      expected.push({ tokens: t, index: resolved.index, dir: resolved.dir });
    });
    assert.deepStrictEqual(
      resolvedGitSegments(cmd, cwd),
      expected,
      `mismatch for ${JSON.stringify(cmd)} in ${cwd}`,
    );
  }
});

// ─── powershellOpaqueCommand (#3061) ───────────────────────────────────────

test('a plain `powershell -File <path>` is not flagged — no -Command, no -EncodedCommand, no inline text', () => {
  assert.strictEqual(powershellOpaqueCommand('powershell -NoProfile -File C:/x/probe.ps1', '/repo'), false);
  assert.strictEqual(powershellOpaqueCommand('pwsh -NoProfile -File /x/probe.ps1', '/repo'), false);
});

test('`powershell -Command "..."` is flagged, content-agnostic', () => {
  assert.strictEqual(powershellOpaqueCommand('powershell -Command "git push"', '/repo'), true);
  assert.strictEqual(powershellOpaqueCommand('powershell -Command "echo hi"', '/repo'), true);
});

test('`-EncodedCommand ...` is flagged the same way', () => {
  assert.strictEqual(powershellOpaqueCommand('powershell -EncodedCommand QQBCAEMA', '/repo'), true);
  assert.strictEqual(powershellOpaqueCommand('pwsh -EncodedCommand QQBCAEMA', '/repo'), true);
});

test('matching is case-insensitive on both the lead and the flag', () => {
  assert.strictEqual(powershellOpaqueCommand('PowerShell -COMMAND "git push"', '/repo'), true);
  assert.strictEqual(powershellOpaqueCommand('PWSH -EncodedCommand QQBCAEMA', '/repo'), true);
});

test('a `.exe` suffix and a path-qualified lead are both recognized', () => {
  assert.strictEqual(powershellOpaqueCommand('powershell.exe -Command "git push"', '/repo'), true);
  assert.strictEqual(powershellOpaqueCommand('C:\\Windows\\System32\\powershell.exe -Command "git push"', '/repo'), true);
});

test('an unrelated command, and a bare powershell invocation with no opaque flag, are not flagged', () => {
  assert.strictEqual(powershellOpaqueCommand('bash script.sh', '/repo'), false);
  assert.strictEqual(powershellOpaqueCommand('powershell -NoProfile -NoLogo', '/repo'), false);
});

test('an abbreviated flag form (-Com) is a deliberate, documented miss — not matched', () => {
  assert.strictEqual(powershellOpaqueCommand('powershell -Com "git push"', '/repo'), false);
});

// #4149: gitTargets and mkdirTargets read a `cd` behind `(` or `{` the way the write walk does.
// A subshell's cwd ends at its `)`; after a brace group's `}` both cwds stand (its `cd` persists
// unless the group is piped). A lone `&` ends a command and backgrounds it, so its `cd` does not move
// the cwd. Each case was checked against real git and mkdir under bash 3.2 and 5.
for (const [label, cmd, expected] of [
  ['(cd … && git commit)', '(cd /main && git commit -m x)', [{ action: 'commit', dir: path.resolve('/main') }]],
  ['{ cd … && git commit; }', '{ cd /main && git commit -m x; }', [{ action: 'commit', dir: path.resolve('/main') }]],
  ['a commit after a subshell cd closes', '(cd /main && true); git commit -m x', [{ action: 'commit', dir: '/wt' }]],
  ['a commit after a brace group cd closes (both cwds)', '{ cd /main; }; git commit -m x', [{ action: 'commit', dir: '/wt' }, { action: 'commit', dir: path.resolve('/main') }]],
  ['a commit after a backgrounded cd', 'cd /main & git commit -m x', [{ action: 'commit', dir: '/wt' }]],
  ['a commit after a backgrounded command', 'cd /main; true & git commit -m x', [{ action: 'commit', dir: path.resolve('/main') }]],
]) {
  test(`#4149: gitTargets reads ${label} as bash runs it`, () => {
    assert.deepStrictEqual(gitTargets(cmd, '/wt'), expected);
  });
}

test('#4149: an absolute -C after a brace group is reported once', () => {
  assert.deepStrictEqual(gitTargets('{ cd /main; }; git -C /x commit -m x', '/wt'), [{ action: 'commit', dir: path.resolve('/x') }]);
});

// #4149: a quoted body inside "$( )" nests, so an & in its prose is no background; and
// group depth skips a heredoc body (data, or a kept body walked as its own chunk), so a body line
// like `1) a` closes no outer `(`. Checked against bash 3.2 and 5 with a logging git stub.
for (const [label, cmd, expected] of [
  ['a push after an & inside a quoted "$( )" body', "cd /main && gh issue comment 1 --body \"$(cat <<'EOF'\nThe \"Q&A\" page\nEOF\n)\" && git push", [{ action: 'push', dir: path.resolve('/main') }]],
  ['a commit message with an & inside "$( )", then a push', "cd /main && git commit -m \"$(cat <<'EOF'\nUse \"R&D\" term\nEOF\n)\" && git push", [{ action: 'commit', dir: path.resolve('/main') }, { action: 'push', dir: path.resolve('/main') }]],
  ['a push after a commit body line `1) a`, inside a subshell', "(cd /main && git commit -F - <<'EOF'\n1) a\nEOF\ngit push)", [{ action: 'commit', dir: path.resolve('/main') }, { action: 'push', dir: path.resolve('/main') }]],
  ['a push after a commit body line `fix: a)`, inside a subshell', "(cd /main && git commit -F - <<'EOF'\nfix: a)\nEOF\ngit push)", [{ action: 'commit', dir: path.resolve('/main') }, { action: 'push', dir: path.resolve('/main') }]],
  ['a push inside a kept shell body, walked as its own chunk', "bash <<'EOF'\ncd /main && git push\nEOF", [{ action: 'push', dir: path.resolve('/main') }]],
]) {
  test(`#4149: gitTargets reads ${label} as bash runs it`, () => {
    assert.deepStrictEqual(gitTargets(cmd, '/wt'), expected);
  });
}

// #4149: a ${ } honours its quotes (`'}'` closes nothing), `$'…'` inside "$( )" honours
// `\'`, and a cd inside a backtick or $( ) runs in a subshell, so the push stays at the earlier cd.
// Checked against bash 3.2 and 5 with a logging git stub.
for (const [label, cmd] of [
  ['a quoted } inside an unquoted ${ }', "x=; cd /main && echo ${x:-'}'} && git push"],
  ['an ANSI-C \\\' inside a quoted "$( )"', "cd /main && echo \"$(echo $'a\\'b')\" && git push; echo ')\"'"],
  ['a cd inside a top-level backtick', 'cd /main && echo `true; cd /tmp`; git push'],
  ['a cd inside an unquoted $( )', 'cd /main && echo $(true; cd /tmp); git push'],
]) {
  test(`#4149: gitTargets keeps the push after ${label} at the earlier cd`, () => {
    assert.deepStrictEqual(gitTargets(cmd, '/wt'), [{ action: 'push', dir: path.resolve('/main') }]);
  });
}

// #4149: a group inside a substitution is scoped within it, so a cd before the group holds
// for the push after it there; the rest of a command after a substitution's closer runs out there.
// Checked against bash 3.2 and 5 with a logging git stub.
for (const [label, cmd] of [
  ['a brace group inside a $( ), between its cd and the push', 'x=$(true; cd /main; { true; }; git push )'],
  ['a push in a brace group inside a $( ), after its cd', 'x=$(true; cd /main; { git push; } )'],
  ['a push in a brace group after a nest left open inside a backtick', 'echo `true; echo $(`; cd /main; { git push; }'],
  ['a push after a $( ) holding a cd, in the same command', 'cd /main && x=$(true; cd /tmp; true) git push'],
]) {
  test(`#4149: gitTargets reads ${label} at the cd`, () => {
    assert.deepStrictEqual(gitTargets(cmd, '/wt'), [{ action: 'push', dir: path.resolve('/main') }]);
  });
}

// #4149: a lone `&` in a group inside a substitution backgrounds that subshell's list
// only, so the outer cd before the substitution still holds. Checked against bash 3.2 and 5.
for (const [label, cmd, expected] of [
  ['a push after a & in a brace group inside a $( )', 'cd /main && x=$( { true & } ) && git push', [{ action: 'push', dir: path.resolve('/main') }]],
  ['a commit after a & in a subshell inside a $( )', 'cd /main && pid=$( (sleep 0 & echo $!) ) && git commit -am x', [{ action: 'commit', dir: path.resolve('/main') }]],
]) {
  test(`#4149: gitTargets reads ${label} at the outer cd`, () => {
    assert.deepStrictEqual(gitTargets(cmd, '/wt'), expected);
  });
}
test('#4149: mkdirTargets reads a mkdir after a & in a subshell inside a $( ) at the outer cd', () => {
  assert.deepStrictEqual(mkdirTargets('cd /main && pid=$( (sleep 0 & echo $!) ) && mkdir d', '/wt'), [{ action: 'mkdir', file: path.resolve('/main/d') }]);
});

test('#4149: mkdirTargets skips a heredoc body when tracking group depth', () => {
  assert.deepStrictEqual(mkdirTargets("(cd /main && cat <<'EOF'\n1) a\nEOF\nmkdir d)", '/wt'), [{ action: 'mkdir', file: path.resolve('/main/d') }]);
});

test('#4149: mkdirTargets reads a cd behind ( or {', () => {
  assert.deepStrictEqual(mkdirTargets('(cd /main && mkdir d)', '/wt'), [{ action: 'mkdir', file: path.resolve('/main/d') }]);
  assert.deepStrictEqual(mkdirTargets('(cd /main && true); mkdir d', '/wt'), [{ action: 'mkdir', file: path.resolve('/wt/d') }]);
  assert.deepStrictEqual(mkdirTargets('{ cd /main; }; mkdir /x', '/wt'), [{ action: 'mkdir', file: path.resolve('/x') }]);
});

// #4281: each word's value as bash passes it to the program. The cases below, as tokenize sees them.
const VALUE_CASES = [
  // bash 3.2 and 5: "D:\a\_temp\x" and 'D:\a\_temp\x' are both the value D:\a\_temp\x.
  ['tee "D:\\a\\_temp\\x"', ['tee', 'D:\\a\\_temp\\x']],
  ["tee 'D:\\a\\_temp\\x'", ['tee', 'D:\\a\\_temp\\x']],
  // bash 3.2 and 5: an unquoted D:\a\_temp\x is the value D:a_tempx.
  ['tee D:\\a\\_temp\\x', ['tee', 'D:a_tempx']],
  // bash 3.2 and 5: "a\$b" "a\`b" "a\"b" "a\\b" "a\xb" are a$b, a`b, a"b, a\b, a\xb.
  ['p "a\\$b" "a\\`b" "a\\"b" "a\\\\b" "a\\xb"', ['p', 'a$b', 'a`b', 'a"b', 'a\\b', 'a\\xb']],
  // bash 3.2 and 5: an unquoted a\ b is the one word a b.
  ['p a\\ b', ['p', 'a b']],
  // bash 3.2 and 5: a backslash-newline, bare or inside "…", is removed: ab.
  ['p a\\\nb', ['p', 'ab']],
  ['p "a\\\nb"', ['p', 'ab']],
];

test('#4281: tokenize returns each word\'s bash value', () => {
  for (const [seg, expected] of VALUE_CASES) assert.deepStrictEqual(tokenize(seg).tokens, expected, seg);
});

test('#4281: spanKinds stays aligned with the value, and an escaped character is kind e', () => {
  for (const [seg] of VALUE_CASES) {
    const { tokens, spanKinds } = tokenize(seg);
    tokens.forEach((tok, i) => assert.strictEqual(spanKinds[i].length, tok.length, `${seg} word ${i}`));
  }
  // bash 3.2 and 5: "a\$b" is a$b, its $ literal; an unquoted a\ b is a b, its space literal.
  assert.strictEqual(tokenize('p "a\\$b"').spanKinds[1], 'ded');
  assert.strictEqual(tokenize('p a\\ b').spanKinds[1], 'beb');
});

test('#4281: typed keeps the word as typed', () => {
  assert.strictEqual(tokenize('tee D:\\a\\x').typed[1], 'D:\\a\\x');
});

test('#4281: a quoted backslash path is a provable cd target', () => {
  // bash 3.2 and 5: '/tmp/a\b' is the value /tmp/a\b, a literal path.
  assert.deepStrictEqual(gitTargets("cd '/tmp/a\\b' && git commit -m x", '/repo'), [{ action: 'commit', dir: path.resolve('/tmp/a\\b') }]);
});

test('#4281: a trailing stray backslash stays unresolvable (bash 3.2 drops it, bash 5 keeps it)', () => {
  // bash 3.2: a\ at the end of the command is the value a; bash 5: a\. The versions disagree.
  // POSIX paths; under path.win32 a and a\ are one path (the win32 test below).
  const posix = { pathImpl: path.posix };
  assert.deepStrictEqual(gitTargets('git commit -m x; cd /tmp/a\\', '/repo', posix), [{ action: 'commit', dir: '/repo' }]);
  assert.deepStrictEqual(gitTargets('cd /tmp/a\\', '/repo', posix), []);
  assert.deepStrictEqual(fileWriteTargets('tee /tmp/a\\', '/r', posix), []);
});

test('#4281: the walk drops a NUL in the command, as bash drops one from its input', () => {
  // bash 3.2 and 5, fed through stdin: `echo x > b<NUL>junk` writes bjunk, and `git -C sub<NUL> commit -m x`
  // runs git with `-C sub commit -m x`.
  const posix = { pathImpl: path.posix };
  assert.deepStrictEqual(fileWriteTargets('echo x > /main/b\0junk', '/wt', posix), [{ action: 'write', file: '/main/bjunk' }]);
  assert.deepStrictEqual(gitTargets('git -C /main\0 commit -m x', '/wt', posix), [{ action: 'commit', dir: '/main' }]);
});

test('#4281: redirectWriteTargets with a null quoting resolves through the default path module', () => {
  assert.deepStrictEqual(redirectWriteTargets(['echo', 'x', '>', '/main/f'], '/wt', null), [path.resolve('/main/f')]);
});

test('#4281: an escaped = is a command word, not an assignment', () => {
  // bash 3.2 and 5: A\=/evil runs the command A=/evil (exit 127), so A stays unset.
  assert.deepStrictEqual(gitTargets('A\\=/evil; cd $A && git commit -m x', '/repo'), []);
});

test('#4281: a quoted assignment name is a command word, not an assignment', () => {
  // bash 3.2 and 5: "A"=/evil runs the command A=/evil (exit 127), so A stays unset.
  assert.deepStrictEqual(gitTargets('"A"=/evil; cd $A && git commit -m x', '/repo'), []);
});

test('#4281: an assignment is read from the word before expansion', () => {
  // bash 3.2 and 5: after `N=A` or `X=1`, `$N=/x cd /tmp` and `A$X=v cd /tmp` run the commands
  // A=/x and A1=v (not found), so the cd never runs; `A=$X cd /tmp` is an assignment and does cd.
  assert.deepStrictEqual(gitTargets('N=A; $N=/x cd /main; git commit -m x', '/wt'), [{ action: 'commit', dir: '/wt' }]);
  assert.deepStrictEqual(gitTargets('X=1; A$X=v cd /main; git commit -m x', '/wt'), [{ action: 'commit', dir: '/wt' }]);
  assert.deepStrictEqual(gitTargets('A=$X cd /main; git commit -m x', '/wt'), [{ action: 'commit', dir: path.resolve('/main') }]);
});

test('#4281: a word of backslash-newlines alone is no word', () => {
  // bash 3.2 and 5: `a \` + newline + ` "" b` passes a, the empty word, b; `cd \` + newline + ` /tmp` changes to /tmp.
  assert.deepStrictEqual(tokenize('p a \\\n "" b').tokens, ['p', 'a', '', 'b']);
  assert.deepStrictEqual(gitTargets('cd \\\n /main && git commit -m x', '/wt'), [{ action: 'commit', dir: path.resolve('/main') }]);
});

test('#4281: an escaped or quoted [[, (( or keyword is a plain word, so its redirect runs', () => {
  // bash 3.2 and 5: each line below creates its file (a quoted keyword is no reserved word, and the
  // redirect runs before "command not found"); a bare `[[ x > f ]]` creates nothing.
  for (const [cmd, file] of [
    ['\\[\\[ x > /main/f1 \\]\\]', '/main/f1'],
    ['\\(\\( 1 > /main/f2 \\)\\)', '/main/f2'],
    ['\\if [[ x > /main/f4 ]]', '/main/f4'],
    ['[\\[ x > /main/f5 ]]', '/main/f5'],
    ['"[[" x > /main/f6 ]]', '/main/f6'],
  ]) assert.deepStrictEqual(fileWriteTargets(cmd, '/wt'), [{ action: 'write', file: path.resolve(file) }], cmd);
  assert.deepStrictEqual(fileWriteTargets('[[ x > /main/f3 ]]', '/wt'), []);
});

test('#4281: an escaped quote in a word is a literal character, never stripped as a delimiter', () => {
  // bash 3.2 and 5: \'/tmp is the value '/tmp, and A=\"/main sets A to "/main (each a relative path).
  assert.deepStrictEqual(gitTargets("cd \\'/tmp && git commit -m x", '/main'), [{ action: 'commit', dir: path.resolve('/main', "'/tmp") }]);
  assert.deepStrictEqual(fileWriteTargets("tee \\'/main/x", '/wt'), [{ action: 'write', file: path.resolve('/wt', "'/main/x") }]);
  assert.deepStrictEqual(gitTargets("A=\\'/main; cd $A && git commit -m x", '/wt'), [{ action: 'commit', dir: path.resolve('/wt', "'/main") }]);
  assert.deepStrictEqual(gitTargets('A=\\"/main; cd $A && git commit -m x', '/wt'), []);
});

test('#4281: a leading-escaped redirect word is a file argument', () => {
  // bash 3.2 and 5: \>x is the word >x, not a redirection.
  assert.deepStrictEqual(fileWriteTargets('cp a \\>x', '/r'), [{ action: 'copy', file: path.resolve('/r', '>x') }]);
});

test('#4281: an escaped character anywhere in a redirect operator makes the word a file argument', () => {
  // bash 3.2 and 5 write 2> and f1 for `tee 2\> f1`, f0, 2> and f1 for `tee f0 2\> f1`, 2> and f1 for
  // `truncate -s 1 2\> f1`, 1> and f1 for `tee 1\> f1`, and 2>> and f1 for `tee 2\>\> f1`: no
  // redirect runs, so the word after the escaped operator is a file operand. `cp a 2\> f1` names f1
  // as cp's destination (bash 3.2 and 5 write f1/a when f1 is a directory). A bare `2>` stays a
  // redirect: bash 3.2 and 5 write f0 and f1 for `tee f0 2> f1`.
  const at = (action, f) => ({ action, file: path.resolve('/r', f) });
  for (const [cmd, expected] of [
    ['tee 2\\> f1', [at('write', '2>'), at('write', 'f1')]],
    ['tee f0 2\\> f1', [at('write', 'f0'), at('write', '2>'), at('write', 'f1')]],
    ['truncate -s 1 2\\> f1', [at('truncate', '2>'), at('truncate', 'f1')]],
    ['cp a 2\\> f1', [at('copy', 'f1')]],
    ['tee 1\\> f1', [at('write', '1>'), at('write', 'f1')]],
    ['tee 2\\>\\> f1', [at('write', '2>>'), at('write', 'f1')]],
    ['tee f0 2> f1', [at('write', 'f1'), at('write', 'f0')]],
  ]) assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), expected, cmd);
});

test('#4281: a cd line\'s redirect writes in the cwd before the cd, and the cd still moves the later segments', () => {
  // bash 3.2 and 5 write f1 in the starting cwd for `\cd sub > f1`, `c\d sub > f1` and `cd sub > f1`
  // (bash applies the redirect before the builtin runs), and sub/f2 for `cd sub && echo x > f2`.
  // `cd sub > f1; echo y > f2`, `A=1 cd sub > f1; echo y > f2` and `cd > f1 sub; echo y > f2` each
  // write f1 and sub/f2: the redirect is no argument of cd.
  const at = (f) => ({ action: 'write', file: path.resolve('/r', f) });
  for (const cmd of ['\\cd sub > f1', 'c\\d sub > f1', 'cd sub > f1']) {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), [at('f1')], cmd);
  }
  assert.deepStrictEqual(fileWriteTargets('cd sub && echo x > f2', '/r'), [at('sub/f2')]);
  for (const cmd of ['cd sub > f1; echo y > f2', 'A=1 cd sub > f1; echo y > f2', 'cd > f1 sub; echo y > f2']) {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), [at('f1'), at('sub/f2')], cmd);
  }
  // A cd segment reaches every walk consumer now, and none of them reads it as its own shape.
  assert.deepStrictEqual(gitTargets('cd sub > f1 && git commit -m x', '/r'), [{ action: 'commit', dir: path.resolve('/r/sub') }]);
  assert.deepStrictEqual(gitTargets('cd git > f1', '/r'), []);
  assert.deepStrictEqual(mkdirTargets('cd mkdir > f1', '/r'), []);
  assert.strictEqual(powershellOpaqueCommand('cd pwsh -Command > f1', '/r'), false);
});

test('#4281: a bare > glued to an assignment word is a redirect, and the assignment keeps the value before it', () => {
  // bash 3.2 and 5 write f1 for `A=x>f1`, `\`+newline+`A=x>f1`, `A=x\`+newline+`>f1` and `A=x >f1`,
  // and nothing for `A="x>f1"` or `A=x\>f1` (each assigns the literal x>f1). After `A=x>f1`, $A is x,
  // so `A=sub>f1; cd $A && echo y > f2` writes f1 and sub/f2. The assignment comes before the
  // redirect expands: `A=f0; A=x>$A` writes x.
  const at = (f) => ({ action: 'write', file: path.resolve('/r', f) });
  for (const cmd of ['A=x>f1', '\\\nA=x>f1', 'A=x\\\n>f1', 'A=x >f1']) {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), [at('f1')], JSON.stringify(cmd));
  }
  for (const cmd of ['A="x>f1"', 'A=x\\>f1']) assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), [], cmd);
  assert.deepStrictEqual(fileWriteTargets('A=sub>f1; cd $A && echo y > f2', '/r'), [at('f1'), at('sub/f2')]);
  assert.deepStrictEqual(fileWriteTargets('A=f0; A=x>$A', '/r'), [at('x')]);
});

// #4281: the Windows shapes, proven on any host through an injected path.win32 (#3314's pattern).
// bash 3.2 and 5: "D:\repo\a.js", "D:\repo\x", "D:\repo\wt" and "D:\repo" are those exact values;
// unquoted, D:\repo\a.js and D:\repo are D:repoa.js and D:repo.
const os = require('node:os');
const fs = require('node:fs');
const { after } = require('node:test');
const realPreToolUse = require('../plugin/bin/lib/hooks/pre-tool-use');
const TEARDOWN_CMD = 'cd "D:\\repo" && git worktree remove wt';
const QUOTED_NATIVE_PINS = {
  tee: (mod) => assert.deepStrictEqual(
    mod.fileWriteTargets('tee "D:\\repo\\a.js"', 'D:\\repo', { pathImpl: path.win32 }).map((t) => t.file),
    ['D:\\repo\\a.js'],
  ),
  mkdir: (mod) => assert.deepStrictEqual(
    mod.mkdirTargets('mkdir -p "D:\\repo\\x"', 'D:\\repo', { pathImpl: path.win32 }),
    [{ action: 'mkdir', file: 'D:\\repo\\x' }],
  ),
  gitC: (mod) => assert.deepStrictEqual(
    mod.gitTargets('git -C "D:\\repo\\wt" push', 'D:\\repo', { pathImpl: path.win32 }),
    [{ action: 'push', dir: 'D:\\repo\\wt' }],
  ),
  teardown: (_mod, preToolUse) => assert.deepStrictEqual(
    preToolUse.teardownTargets({ input: { tool_name: 'Bash', tool_input: { command: TEARDOWN_CMD } }, cwd: 'D:\\x' }, { pathImpl: path.win32 }),
    [{ path: 'D:\\repo\\wt', source: 'bash' }],
  ),
};
function assertQuotedNativePins(mod, preToolUse, names = Object.keys(QUOTED_NATIVE_PINS)) {
  for (const name of names) QUOTED_NATIVE_PINS[name](mod, preToolUse);
}
const realGitCommand = require('../plugin/bin/lib/hooks/git-command');

test('AC2.1 AC2.2 #4281: a quoted native tee target resolves through path.win32, pinned as an exact string', () => {
  assertQuotedNativePins(realGitCommand, realPreToolUse, ['tee']);
});

test('AC2.3 #4281: mkdir, git -C and a cd before worktree remove resolve through path.win32', () => {
  assertQuotedNativePins(realGitCommand, realPreToolUse, ['mkdir', 'gitC', 'teardown']);
});

test('AC2.4 #4281: an unquoted native path is never its typed target (bash reads D:repoa.js, a drive-relative path)', () => {
  // Windows resolves a drive-relative value against the cwd when the cwd is on that drive (letters
  // compared case-insensitively), so the same-drive value is a provable literal, never D:\repo\a.js.
  const win = { pathImpl: path.win32 };
  assert.deepStrictEqual(fileWriteTargets('tee D:\\repo\\a.js', 'D:\\repo', win), [{ action: 'write', file: 'D:\\repo\\repoa.js' }]);
  assert.deepStrictEqual(fileWriteTargets('tee d:a.js', 'D:\\repo', win), [{ action: 'write', file: 'd:\\repo\\a.js' }]);
  assert.deepStrictEqual(gitTargets('cd D:\\repo && git commit -m x', 'D:\\x', win), [{ action: 'commit', dir: 'D:\\x\\repo' }]);
  assert.deepStrictEqual(gitTargets('git -C D:\\repo commit -m x', 'D:\\x', win), [{ action: 'commit', dir: 'D:\\x\\repo' }]);
  // Against another drive, or a cwd with no drive, that drive's own cwd is unknown: no target.
  assert.deepStrictEqual(fileWriteTargets('tee D:a.js', 'C:\\x', win), []);
  assert.deepStrictEqual(fileWriteTargets('tee D:a.js', '/x', win), []);
  assert.deepStrictEqual(fileWriteTargets('tee D:a.js', 'D:', win), []);
  assert.deepStrictEqual(gitTargets('cd D:repo && git commit -m x', 'C:\\x', win), []);
  assert.deepStrictEqual(gitTargets('git -C D:\\repo commit -m x', 'C:\\x', win), []);
});

test('#4281: a quoted or escaped final backslash is a literal character, and a stray one resolves under path.win32', () => {
  // bash 3.2 and 5: 'D:\repo\wt\' and "D:\repo\wt\\" are D:\repo\wt\, '/r/a\' is /r/a\, and 'D:\' is D:\.
  // A stray final `\` splits them: wt\ is wt (3.2) or wt\ (5), the same Windows path; D:\ is D: (3.2,
  // the drive's cwd) or D:\ (5, its root), two paths, so it stays unprovable.
  const remove = (command) => realPreToolUse.teardownTargets(
    { input: { tool_name: 'Bash', tool_input: { command } }, cwd: 'D:\\repo' }, { pathImpl: path.win32 },
  );
  assert.deepStrictEqual(remove("git worktree remove 'D:\\repo\\wt\\'"), [{ path: 'D:\\repo\\wt', source: 'bash' }]);
  assert.deepStrictEqual(remove('git worktree remove "D:\\repo\\wt\\\\"'), [{ path: 'D:\\repo\\wt', source: 'bash' }]);
  assert.deepStrictEqual(remove('git worktree remove wt\\'), [{ path: 'D:\\repo\\wt', source: 'bash' }]);
  assert.deepStrictEqual(remove('git worktree remove D:\\'), []);
  assert.deepStrictEqual(gitTargets("cd 'D:\\' && git commit -m x", 'C:\\x', { pathImpl: path.win32 }), [{ action: 'commit', dir: 'D:\\' }]);
  assert.deepStrictEqual(fileWriteTargets("tee '/r/a\\'", '/r'), [{ action: 'write', file: path.resolve('/r/a\\') }]);
});

test('#4281: a single-positional ln names its link with the injected path module\'s basename', () => {
  // bash 3.2 and 5: "D:\src\a.js" is the value D:\src\a.js; ln -s creates a.js in the cwd.
  assert.deepStrictEqual(fileWriteTargets('ln -s "D:\\src\\a.js"', 'D:\\repo', { pathImpl: path.win32 }), [{ action: 'link', file: 'D:\\repo\\a.js' }]);
});

const MUTANT_DIR = path.join(os.tmpdir(), 'ct-4281-mutant-' + process.pid);
after(() => fs.rmSync(MUTANT_DIR, { recursive: true, force: true }));

test('AC3.1 AC3.2 #4281: go-red — putting the backslash rule back into isUnresolvable fails every quoted AC2 case', () => {
  const src = fs.readFileSync(require.resolve('../plugin/bin/lib/hooks/git-command'), 'utf8');
  // Anchored on the declaration, not a clause, so reordering the clauses or renaming the parameter
  // keeps the control working. `isUnresolvable(undefined)` is a real call (a bare `cd`), hence the guard.
  const decls = [...src.matchAll(/function isUnresolvable\s*\(\s*(\w+)\s*\)\s*\{/g)];
  assert.strictEqual(decls.length, 1, 'the isUnresolvable declaration matches exactly once');
  const [decl, param] = decls[0];
  // A function replacement: a `$` in the replacement would otherwise be a special pattern.
  const mutantSrc = src.replace(decl, () => `${decl}\n  if (${param} !== undefined && ${param}.includes('\\\\')) return true;`);
  fs.mkdirSync(MUTANT_DIR, { recursive: true });
  const mutantFile = path.join(MUTANT_DIR, 'git-command.js');
  fs.writeFileSync(mutantFile, mutantSrc); // git-command.js requires only `path`
  const mutant = require(mutantFile);
  assert.throws(() => assertQuotedNativePins(mutant, realPreToolUse, ['tee']), { code: 'ERR_ASSERTION' });
  assert.throws(() => assertQuotedNativePins(mutant, realPreToolUse, ['mkdir']), { code: 'ERR_ASSERTION' });
  assert.throws(() => assertQuotedNativePins(mutant, realPreToolUse, ['gitC']), { code: 'ERR_ASSERTION' });
  // Teardown, fallback form: pre-tool-use.js requires a dozen sibling modules, so binding its
  // teardownTargets to the mutant would mean copying that tree. teardownTargets resolves its dir
  // through resolveGitCommand, which resolvedGitSegments reports for every git segment (gitTargets
  // never classifies `worktree remove`, so it would hold no D:\repo dir on either module): the real
  // module walks into D:\repo, the mutant reads the cd as unprovable and reports no D:\repo dir.
  const dirs = (mod) => mod.resolvedGitSegments(TEARDOWN_CMD, 'D:\\x', { pathImpl: path.win32 }).map((s) => s.dir);
  assert.deepStrictEqual(dirs(realGitCommand), ['D:\\repo']);
  assert.ok(!dirs(mutant).includes('D:\\repo'));
});
