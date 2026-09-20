// tests/hooks-git-command.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  gitTargets, gitTargetsFrom, resolvedGitSegments, resolveGitCommand, fileWriteTargets, mkdirTargets,
} = require('../plugin/bin/lib/hooks/git-command');

test('plain commit resolves to cwd', () => {
  assert.deepStrictEqual(gitTargets('git commit -m "x"', '/repo'), [{ action: 'commit', dir: '/repo' }]);
});

test('git -C targets the given dir, resolved against cwd', () => {
  assert.deepStrictEqual(gitTargets('git -C /wt/spec-1 commit -m "x"', '/repo'), [{ action: 'commit', dir: '/wt/spec-1' }]);
  assert.deepStrictEqual(gitTargets('git -C ../other commit -m "x"', '/repo/sub'), [{ action: 'commit', dir: '/repo/other' }]);
});

test('cd chains update the effective cwd', () => {
  assert.deepStrictEqual(gitTargets('cd /wt/spec-1 && git add f.js && git commit -m "x"', '/repo'), [
    { action: 'commit', dir: '/wt/spec-1' },
  ]);
});

test('a cd on its own line, preceded by an unrelated statement joined only by a newline, still updates the effective cwd', () => {
  assert.deepStrictEqual(
    gitTargets('VAR="unrelated"\ncd /wt/spec-1 && git add f.js && git commit -m "x"', '/repo'),
    [{ action: 'commit', dir: '/wt/spec-1' }],
  );
});

test('a shell-variable cd on its own line, preceded by an unrelated statement, resolves via the same-command assignment (no fallback to the stale cwd — the assignment IS the proof)', () => {
  assert.deepStrictEqual(
    gitTargets('MKT="/wt/spec-1"\ncd "$MKT" && git commit -m "x"', '/repo'),
    [{ action: 'commit', dir: '/wt/spec-1' }],
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
    [{ action: 'edit', file: '/private/tmp/foo/file.md' }],
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
    [{ action: 'edit', file: '/b/file.md' }],
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
  assert.deepStrictEqual(gitTargets('git -C "/wt/my spec" commit -m "x"', '/repo'), [{ action: 'commit', dir: '/wt/my spec' }]);
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
    [{ action: 'commit', dir: '/abs/path' }],
  );
});

test('poisoned cwd then cd to an absolute plain path restores provability', () => {
  assert.deepStrictEqual(
    gitTargets('cd && cd /abs/known && git commit -m "x"', '/repo'),
    [{ action: 'commit', dir: '/abs/known' }],
  );
});

test('repeated -C flags stack cumulatively like real git', () => {
  assert.deepStrictEqual(gitTargets('git -C /a -C b commit -m "x"', '/repo'), [{ action: 'commit', dir: '/a/b' }]);
  assert.deepStrictEqual(gitTargets('git -C /a -C /c commit -m "x"', '/repo'), [{ action: 'commit', dir: '/c' }]);
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
  assert.deepStrictEqual(fileWriteTargets('echo hi | tee out.txt', '/repo'), [{ action: 'write', file: '/repo/out.txt' }]);
  assert.deepStrictEqual(fileWriteTargets('echo hi | tee -a out.txt', '/repo'), [{ action: 'write', file: '/repo/out.txt' }]);
});

test('fileWriteTargets: cp/mv resolve the last non-flag argument as the destination', () => {
  assert.deepStrictEqual(fileWriteTargets('cp a.txt b.txt', '/repo'), [{ action: 'copy', file: '/repo/b.txt' }]);
  assert.deepStrictEqual(fileWriteTargets('mv a.txt b.txt', '/repo'), [{ action: 'move', file: '/repo/b.txt' }]);
  assert.deepStrictEqual(fileWriteTargets('cp -r a b c/dest', '/repo'), [{ action: 'copy', file: '/repo/c/dest' }]);
});

test('fileWriteTargets: cd chains update the effective cwd before a write', () => {
  assert.deepStrictEqual(fileWriteTargets('cd /wt/spec-1 && tee out.txt', '/repo'), [
    { action: 'write', file: '/wt/spec-1/out.txt' },
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

test('an empty -C value ("git -C \'\' commit") behaves like omitting -C entirely, not like an unparseable command', () => {
  // A truthy check on t[i+1] treats a genuinely-present-but-empty value as
  // "no value follows", mis-consuming only the -C flag and leaving the
  // leftover '' to be misread as the subcommand — silently producing zero
  // targets for a command real git treats as fully valid.
  assert.deepStrictEqual(gitTargets('git -C "" commit -m "msg"', '/repo'), [{ action: 'commit', dir: '/repo' }]);
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
    { action: 'write', file: '/worktree/notes.txt' },
    { action: 'write', file: '/etc/important-file' },
  ]);
});

test('fileWriteTargets: cp/mv -t DIR names the real destination directory, not the last source', () => {
  assert.deepStrictEqual(fileWriteTargets('cp -t /main/checkout secret.txt', '/repo'), [{ action: 'copy', file: '/main/checkout' }]);
  assert.deepStrictEqual(fileWriteTargets('mv -t /main/checkout a.txt b.txt', '/repo'), [{ action: 'move', file: '/main/checkout' }]);
});

test('fileWriteTargets: cp/mv --target-directory=DIR and --target-directory DIR are both recognized', () => {
  assert.deepStrictEqual(fileWriteTargets('cp --target-directory=/main/checkout secret.txt', '/repo'), [{ action: 'copy', file: '/main/checkout' }]);
  assert.deepStrictEqual(fileWriteTargets('cp --target-directory /main/checkout secret.txt', '/repo'), [{ action: 'copy', file: '/main/checkout' }]);
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
    { action: 'mkdir', file: '/worktree/.claude-tweaks/pipelines/x' },
  ]);
});

test('mkdirTargets: -p and other bare flags are skipped, not mistaken for a target', () => {
  assert.deepStrictEqual(mkdirTargets('mkdir -p /worktree/.claude-tweaks/pipelines/x', '/repo'), [
    { action: 'mkdir', file: '/worktree/.claude-tweaks/pipelines/x' },
  ]);
});

test('mkdirTargets: every positional is a target — mkdir can create multiple directories at once', () => {
  assert.deepStrictEqual(mkdirTargets('mkdir -p a b', '/repo'), [
    { action: 'mkdir', file: '/repo/a' },
    { action: 'mkdir', file: '/repo/b' },
  ]);
});

test('mkdirTargets: -m MODE consumes its value, not a positional', () => {
  assert.deepStrictEqual(mkdirTargets('mkdir -m 0755 /worktree/x', '/repo'), [
    { action: 'mkdir', file: '/worktree/x' },
  ]);
});

test('mkdirTargets: a relative path resolves against cwd, cd chains update it', () => {
  assert.deepStrictEqual(mkdirTargets('cd /worktree && mkdir sub', '/repo'), [
    { action: 'mkdir', file: '/worktree/sub' },
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
  assert.deepStrictEqual(gitTargets('FOO=1 cd /var && git commit -m "x"', '/repo'), [{ action: 'commit', dir: '/var' }]);
});

test('an env-WRAPPED cd (as opposed to env-var-PREFIXED) does not change cwd, matching real bash — env execs a nonexistent "cd" binary and errors, so a following bare commit still targets the stale cwd', () => {
  assert.deepStrictEqual(gitTargets('env cd /var; git commit -m "x"', '/repo'), [{ action: 'commit', dir: '/repo' }]);
});

// env's arg-taking flags: skipping `-C`/`--chdir` without consuming the value
// made the dir token the presumed command word ("not git" → silent allow),
// while GNU env really runs git with that dir as its cwd — the exact bypass
// shape for a worktree session mutating the protected main checkout.
test("env -C <dir> git commit resolves the target to env's chdir dir, not the caller cwd", () => {
  assert.deepStrictEqual(gitTargets('env -C /main-checkout git commit -m "x"', '/repo'), [{ action: 'commit', dir: '/main-checkout' }]);
});

test('env --chdir=<dir> and env --chdir <dir> both resolve the target to the chdir dir', () => {
  assert.deepStrictEqual(gitTargets('env --chdir=/main-checkout git push', '/repo'), [{ action: 'push', dir: '/main-checkout' }]);
  assert.deepStrictEqual(gitTargets('env --chdir /main-checkout git push', '/repo'), [{ action: 'push', dir: '/main-checkout' }]);
});

test('a relative env -C value resolves against the effective cwd, and stacks with git\'s own -C', () => {
  assert.deepStrictEqual(gitTargets('env -C sub git commit -m "x"', '/repo'), [{ action: 'commit', dir: '/repo/sub' }]);
  assert.deepStrictEqual(gitTargets('env -C /a git -C b commit -m "x"', '/repo'), [{ action: 'commit', dir: '/a/b' }]);
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
  assert.deepStrictEqual(gitTargets('env -C/main-checkout git commit -m "x"', '/repo'), [{ action: 'commit', dir: '/main-checkout' }]);
  assert.deepStrictEqual(gitTargets('env -Csub git push', '/repo'), [{ action: 'push', dir: '/repo/sub' }]);
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
