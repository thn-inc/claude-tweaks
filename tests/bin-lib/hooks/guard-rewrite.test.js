'use strict';
// guard-rewrite.js (#4028): semantics-preserving rewrites of Bash shapes the
// harness worktree-isolation guard over-refuses, emitted as PreToolUse
// `updatedInput`. The guard re-checks the rewritten command, so a rewrite can
// only normalize, never bypass — which makes argv identity under BOTH bash and
// zsh (Review Focus 1) the property every positive case below must hold.
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { rewriteForGuard } = require('../../../plugin/bin/lib/hooks/guard-rewrite');
const { gitRepo, linkedWorktreeOf } = require('../../helpers/git-fixtures');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-guard-rewrite-')));
after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });
const CWD = path.join(SANDBOX, 'cwd');
fs.mkdirSync(CWD);
// A plugin root that ships bin/x.js: rule 2 inlines only paths the root really has.
function pluginRootAt(dir) {
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'bin', 'x.js'), '');
  return dir;
}
const ROOT = pluginRootAt(path.join(SANDBOX, 'plugin-root'));
const linked = { isLinkedWorktree: () => true };
const rw = (command, extra = {}) => rewriteForGuard({ command, cwd: CWD, pluginRoot: ROOT, deps: linked, ...extra });

test('inline-literal-assignment: P=/x/y; node $P/z.js → P=/x/y; node /x/y/z.js', () => {
  assert.deepStrictEqual(rw('P=/x/y; node $P/z.js'), { command: 'P=/x/y; node /x/y/z.js', applied: ['inline-literal-assignment'] });
  assert.deepStrictEqual(rw('P="/a b"; node "$P/z.js"'), { command: 'P="/a b"; node "/a b/z.js"', applied: ['inline-literal-assignment'] });
  assert.deepStrictEqual(rw('export P=/x && node ${P}/z.js'), { command: 'export P=/x && node /x/z.js', applied: ['inline-literal-assignment'] });
  assert.deepStrictEqual(rw('A=/a\nB=/b; node $A/x.js "$B"'), { command: 'A=/a\nB=/b; node /a/x.js "/b"', applied: ['inline-literal-assignment'] });
});

test('inline-literal-assignment bails on an unquoted ref to a value with a space', () => {
  assert.strictEqual(rw('P="/a b"; node $P/z.js'), null);
  // The remaining bail conditions, one each.
  assert.strictEqual(rw('P=/x; P=/y; node $P/z.js'), null, 'later reassignment');
  assert.strictEqual(rw('P=/x; for P in a; do node $P; done'), null, 'later reassignment by a loop');
  assert.strictEqual(rw('P=/x; node ${P:-/d}/z.js'), null, 'a non-simple ${P form');
  assert.strictEqual(rw('P=/x; node ${#P}'), null, 'a ${#P} form');
  assert.strictEqual(rw('P=/x; node $P/z.js <<EOF\n$P\nEOF'), null, 'a heredoc');
  assert.strictEqual(rw('P=/x; node $P/z.js `date`'), null, 'a backtick');
  assert.strictEqual(rw('P=/x node $P/z.js'), null, 'a command-prefix assignment is not a leading statement');
  assert.strictEqual(rw('P=/x & node $P/z.js'), null, 'a backgrounded assignment never reaches this shell');
  assert.strictEqual(rw('P=/x | node $P/z.js'), null, 'a piped assignment runs in a subshell');
  assert.strictEqual(rw('P=a; $P'), null, 'a slash-free value in command position could be a keyword or alias');
  assert.strictEqual(rw('P=/a=b; node $P'), null, 'an = in an unquoted substituted value could form an assignment');
  assert.strictEqual(rw('P=B; A$P=1'), null, 'a = after the reference could form an assignment (AB=1)');
  assert.strictEqual(rw('P=/x; node $P:h'), null, 'zsh modifier after an unbraced reference');
  assert.strictEqual(rw('P=/x; node "$P[1]"'), null, 'zsh subscript after an unbraced reference');
  assert.strictEqual(rw('P=/x; node {$P,y}'), null, 'brace expansion runs before parameter expansion');
  assert.strictEqual(rw('P=/x:; Q=$P~/a'), null, 'a tilde next to the substituted text');
  assert.strictEqual(rw('IFS=/; P=/x; node $P'), null, 'IFS changes word splitting');
  assert.strictEqual(rw('PWD=/x; node $PWD/z.js'), null, 'a shell-maintained variable');
  assert.strictEqual(rw('p=/x; node $p/z.js'), null, 'lowercase names are zsh special-parameter territory');
  assert.strictEqual(rw("P=/x; node $P/z.js 'unterminated"), null, 'unbalanced quote');
  assert.strictEqual(rw("P=/x; node $'\\x41' $P/z.js"), null, 'ANSI-C quoting');
});

test('inline-literal-assignment leaves a single-quoted $P alone', () => {
  assert.deepStrictEqual(rw("P=/x; node -e 'console.log(\"$P\")' $P/z.js"), {
    command: "P=/x; node -e 'console.log(\"$P\")' /x/z.js",
    applied: ['inline-literal-assignment'],
  });
  assert.deepStrictEqual(rw('P=/x; node \\$P $P/z.js'), { command: 'P=/x; node \\$P /x/z.js', applied: ['inline-literal-assignment'] }, 'an escaped $ is literal');
  assert.strictEqual(rw("P=/x; echo '$P'"), null, 'nothing to substitute');
});

test('plugin-root-placeholder substitutes the injected root and skips when the command assigns it', () => {
  assert.deepStrictEqual(rw('node "${CLAUDE_PLUGIN_ROOT}/bin/x.js" a'), { command: `node "${ROOT}/bin/x.js" a`, applied: ['plugin-root-placeholder'] });
  assert.deepStrictEqual(rw('node $CLAUDE_PLUGIN_ROOT/bin/x.js'), { command: `node ${ROOT}/bin/x.js`, applied: ['plugin-root-placeholder'] });
  assert.strictEqual(rw("node '${CLAUDE_PLUGIN_ROOT}/bin/x.js'"), null, 'single-quoted stays literal');
  assert.strictEqual(rw('export CLAUDE_PLUGIN_ROOT="$X"; node "$CLAUDE_PLUGIN_ROOT/x.js"'), null, 'assigns it itself');
  assert.strictEqual(rw('unset CLAUDE_PLUGIN_ROOT; node "$CLAUDE_PLUGIN_ROOT/x.js"'), null);
  // A literal self-assignment is rule 1's job, and its own value wins over the root.
  assert.deepStrictEqual(rw('CLAUDE_PLUGIN_ROOT=/elsewhere; node "$CLAUDE_PLUGIN_ROOT/x.js"'), {
    command: 'CLAUDE_PLUGIN_ROOT=/elsewhere; node "/elsewhere/x.js"', applied: ['inline-literal-assignment'],
  });
  const spaced = pluginRootAt(path.join(SANDBOX, 'a b', 'root'));
  assert.strictEqual(rw('node $CLAUDE_PLUGIN_ROOT/bin/x.js', { pluginRoot: spaced }), null, 'unquoted + a root with a space');
  assert.deepStrictEqual(rw('node "$CLAUDE_PLUGIN_ROOT/bin/x.js"', { pluginRoot: spaced }), { command: `node "${spaced}/bin/x.js"`, applied: ['plugin-root-placeholder'] });
  assert.strictEqual(rw('node "$CLAUDE_PLUGIN_ROOT/bin/x.js"', { pluginRoot: 'relative/root' }), null, 'a non-absolute root');
  assert.strictEqual(rw('node "$CLAUDE_PLUGIN_ROOT/bin/x.js"', { pluginRoot: '/opt/$x' }), null, 'a root outside the literal class');
  // Another plugin's prose spells the same placeholder for its own root.
  assert.strictEqual(rw('node "${CLAUDE_PLUGIN_ROOT}/scripts/other.js"'), null, 'a path this root does not ship');
  assert.strictEqual(rw('node "${CLAUDE_PLUGIN_ROOT}/bin/x.js" "$CLAUDE_PLUGIN_ROOT"'), null, 'a bare reference names no shipped path');
  assert.strictEqual(rw('node "${CLAUDE_PLUGIN_ROOT}/../plugin-root/bin/x.js"'), null, 'a parent segment');
});

test("node-eval-separator inserts -- before \"$A\" and leaves an existing -- alone", () => {
  const script = "'console.log(process.argv[1])'";
  assert.deepStrictEqual(rw(`node -e ${script} "$A"`), { command: `node -e ${script} -- "$A"`, applied: ['node-eval-separator'] });
  assert.deepStrictEqual(rw(`cd /tmp; node -p ${script} $HOME x`), { command: `cd /tmp; node -p ${script} -- $HOME x`, applied: ['node-eval-separator'] });
  assert.deepStrictEqual(rw('node --eval "1" "$(echo a)"'), { command: 'node --eval "1" -- "$(echo a)"', applied: ['node-eval-separator'] });
  assert.strictEqual(rw(`node -e ${script} -- "$A"`), null, 'an existing -- is left alone');
  assert.strictEqual(rw(`node -e ${script} "$A" -- b`), null, 'a later -- makes argv parsing ambiguous');
  assert.strictEqual(rw(`node -e ${script} a "$A"`), null, 'only the FIRST argument is considered');
  assert.strictEqual(rw(`echo "node -e ${script} $A"`), null, 'inside a quoted string');
  assert.strictEqual(rw(`node --no-warnings -e ${script} "$A"`), null, 'narrow shape only');
});

test('quote-escaped-space double-quotes ls /a/Code\\ Workspaces/b', () => {
  assert.deepStrictEqual(rw('ls /a/Code\\ Workspaces/b'), { command: 'ls "/a/Code Workspaces/b"', applied: ['quote-escaped-space'] });
  assert.deepStrictEqual(rw('ls /a/Code\\ Workspaces/b /c/d\\ e 2>&1'), { command: 'ls "/a/Code Workspaces/b" "/c/d e" 2>&1', applied: ['quote-escaped-space'] });
  assert.strictEqual(rw("ls '/a/Code\\ Workspaces/b'"), null, 'already quoted');
  assert.strictEqual(rw('ls ~/a\\ b'), null, 'a leading ~ is tilde-expanded only unquoted');
  assert.strictEqual(rw('X=/a\\ b'), null, 'quoting an assignment word turns it into a command');
  assert.strictEqual(rw('ls --dir=~/a\\ b'), null, 'a ~ after = is tilde-expanded by bash');
  assert.strictEqual(rw('ls /a\\ b*'), null, 'a glob character outside the class');
  assert.strictEqual(rw('ls $HOME/a\\ b'), null, 'a $ outside the class');
});

test('drop-redundant-cd drops cd "<cwd>" && only when it resolves to cwd', () => {
  assert.deepStrictEqual(rw(`cd "${CWD}" && ls x`), { command: 'ls x', applied: ['drop-redundant-cd'] });
  assert.deepStrictEqual(rw(`cd ${CWD}/ && ls x`), { command: 'ls x', applied: ['drop-redundant-cd'] });
  assert.strictEqual(rw(`cd "${SANDBOX}" && ls x`), null, 'a different directory');
  assert.strictEqual(rw(`cd "${CWD}"; ls x`), null, 'only && is dropped');
  assert.strictEqual(rw(`ls && cd "${CWD}" && ls x`), null, 'only the first segment');
  assert.strictEqual(rw('cd ~ && ls x', { cwd: os.homedir() }), null, 'never ~');
  assert.strictEqual(rw('cd $HOME && ls x', { cwd: os.homedir() }), null, 'never $');
  assert.strictEqual(rw(`cd "${CWD}" && cd - && ls`), null, 'cd - reads the OLDPWD the dropped cd would set');
  assert.strictEqual(rw(`cd "${CWD}" && echo $OLDPWD`), null);
  assert.strictEqual(rw(`cd "${CWD}" && # note`), null, 'the original is a syntax error, a lone comment is not');
  // A symlink to cwd resolves equal but would change $PWD / `pwd` output.
  const link = path.join(SANDBOX, 'link');
  fs.symlinkSync(CWD, link);
  assert.strictEqual(rw(`cd "${link}" && pwd`), null, 'a symlinked spelling changes PWD');
  const gone = path.join(SANDBOX, 'gone');
  assert.strictEqual(rw(`cd "${gone}" && ls`, { cwd: gone }), null, 'an unresolvable cwd');
});

test('returns null outside a linked worktree', () => {
  // The default detector, no injected deps: a plain dir, a main checkout, a linked worktree.
  const command = 'P=/x/y; node $P/z.js';
  assert.strictEqual(rewriteForGuard({ command, cwd: CWD, pluginRoot: ROOT }), null, 'plain directory');
  const main = gitRepo();
  assert.strictEqual(rewriteForGuard({ command, cwd: main, pluginRoot: ROOT }), null, 'main checkout (.git is a directory)');
  const wt = linkedWorktreeOf(main);
  const sub = path.join(wt, 'sub');
  fs.mkdirSync(sub);
  assert.deepStrictEqual(rewriteForGuard({ command, cwd: sub, pluginRoot: ROOT }), { command: 'P=/x/y; node /x/y/z.js', applied: ['inline-literal-assignment'] }, 'linked worktree, found walking up');
  assert.strictEqual(rewriteForGuard({ command, cwd: 'relative/dir', pluginRoot: ROOT, deps: linked }), null, 'a relative cwd is unprovable');
  assert.strictEqual(rewriteForGuard({ command, cwd: undefined, pluginRoot: ROOT, deps: linked }), null);
});

// The runner's own timeout is the hang bound: a wall-clock budget belongs in perf/
// (tests/wall-clock-budget-conformance.test.js), and catastrophic backtracking on the
// 60 KB inputs below would run for minutes, not milliseconds.
test('returns null and does not throw on a malformed command', { timeout: 60000 }, () => {
  for (const command of [undefined, null, 42, {}, '', '"', "'", '$(', '${', '\\', 'P=', 'cd', 'node -e', `${'$('.repeat(5000)}`, `P=/x; ${'"$P'.repeat(20000)}`, `${'a\\ '.repeat(50000)}`]) {
    assert.doesNotThrow(() => rw(command));
  }
  assert.strictEqual(rw('"'), null);
  assert.strictEqual(rewriteForGuard({ command: 'P=/x; node $P', cwd: CWD, pluginRoot: ROOT, deps: { isLinkedWorktree: () => { throw new Error('boom'); } } }), null);
  assert.strictEqual(rewriteForGuard(undefined), null);
  // Long pathological inputs finish (no catastrophic backtracking) and still rewrite.
  assert.strictEqual(rw(`ls ${'a\\ '.repeat(20000)}x`).command, `ls "${'a '.repeat(20000)}x"`);
  assert.strictEqual(rw(`P=/x; node ${'$P/'.repeat(20000)}`).command, `P=/x; node ${'/x/'.repeat(20000)}`);
  assert.strictEqual(rw(`node -e '1' ${'"$A" '.repeat(20000)}`), null, 'over the 64 KiB ceiling');
});

// ── Bash/zsh equivalence (Review Focus 1) ────────────────────────────────────
// Every positive case runs original and rewrite under each shell against stubs
// that print their argv as JSON; stdout must match. The `node` stub hands
// -e/-p/--eval/--print to the real node, whose process.argv is what
// node-eval-separator must preserve.
const STUB = path.join(SANDBOX, 'stub');
fs.mkdirSync(STUB);
const printArgv = `exec "${process.execPath}" -e 'console.log(JSON.stringify(process.argv.slice(1)))' -- "$@"\n`;
fs.writeFileSync(path.join(STUB, 'ls'), `#!/bin/sh\n${printArgv}`, { mode: 0o755 });
fs.writeFileSync(path.join(STUB, 'node'), `#!/bin/sh\ncase "$1" in -e|-p|--eval|--print) exec "${process.execPath}" "$@";; esac\n${printArgv}`, { mode: 0o755 });
const EVAL = "'console.log(JSON.stringify(process.argv.slice(1)))'";
const POSITIVE = [
  { rule: 'inline-literal-assignment', command: 'P=/x/y; node $P/z.js' },
  { rule: 'inline-literal-assignment', command: 'P="/a b"; node "$P/z.js" "${P}"' },
  { rule: 'inline-literal-assignment', command: 'export P=/x && node ${P}/z.js; node $P' },
  { rule: 'inline-literal-assignment', command: "P=/x; node -e 'console.log(\"$P\")' $P/z.js" },
  { rule: 'inline-literal-assignment', command: 'P=/bin; $P/echo ok' },
  { rule: 'plugin-root-placeholder', command: 'node "${CLAUDE_PLUGIN_ROOT}/bin/x.js" a' },
  { rule: 'plugin-root-placeholder', command: 'node $CLAUDE_PLUGIN_ROOT/bin/x.js "$CLAUDE_PLUGIN_ROOT/bin"' },
  { rule: 'node-eval-separator', command: `node -e ${EVAL} "$A"` },
  { rule: 'node-eval-separator', command: `node -p ${EVAL} $A x` },
  { rule: 'node-eval-separator', command: `node -e ${EVAL} "$HOME"` },
  { rule: 'quote-escaped-space', command: 'ls /a/Code\\ Workspaces/b /c/d\\ e' },
  { rule: 'drop-redundant-cd', command: `cd "${CWD}" && pwd && ls x` },
];
const SHELLS = ['bash', 'zsh'].filter((sh) => spawnSync(sh, ['-c', 'exit 0'], { windowsHide: true }).status === 0);

function runIn(shell, command, extraEnv) {
  // A's first character is not `-`: see the node-eval-separator divergence test below.
  const env = { PATH: `${STUB}${path.delimiter}${process.env.PATH}`, HOME: process.env.HOME || os.homedir(), A: 'a --flag -x', ...extraEnv };
  const args = shell === 'zsh' ? ['-f', '-c', command] : ['-c', command];
  const r = spawnSync(shell, args, { cwd: CWD, env, encoding: 'utf8', windowsHide: true });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

test('every positive case is argv-identical under bash and zsh', { skip: process.platform === 'win32' || !SHELLS.includes('bash') }, (t) => {
  if (!SHELLS.includes('zsh')) t.diagnostic('zsh not present — bash half only');
  for (const { rule, command } of POSITIVE) {
    const out = rw(command);
    assert.ok(out, `${rule}: no rewrite for ${command}`);
    assert.deepStrictEqual(out.applied, [rule], command);
    assert.notStrictEqual(out.command, command);
    for (const shell of SHELLS) {
      const original = runIn(shell, command, { CLAUDE_PLUGIN_ROOT: ROOT });
      const rewritten = runIn(shell, out.command, {});
      assert.strictEqual(original.status, 0, `${shell} original failed: ${command}\n${original.stderr}`);
      assert.ok(original.stdout.length > 0, `${shell} original printed nothing: ${command}`);
      assert.deepStrictEqual(rewritten, original, `${shell}: ${command}\n→ ${out.command}`);
    }
  }
});

// node-eval-separator's one divergence, recorded rather than hidden: node parses a
// dash-leading value after `-e <script>` as a node OPTION, so only the original
// fails. The rewrite hands the value to the script, closing the option injection
// the guard refuses over; every value not starting with `-` is argv-identical.
test('node-eval-separator diverges only for a dash-leading first value: the original treats it as a node option', { skip: process.platform === 'win32' || !SHELLS.includes('bash') }, () => {
  const command = `node -e ${EVAL} "$A"`;
  const out = rw(command);
  const original = runIn('bash', command, { A: '--flag' });
  const rewritten = runIn('bash', out.command, { A: '--flag' });
  assert.strictEqual(original.status, 9);
  assert.match(original.stderr, /bad option: --flag/);
  assert.strictEqual(rewritten.status, 0);
  assert.deepStrictEqual(JSON.parse(rewritten.stdout), ['--flag']);
});

// The harness discriminates: the Review Focus 1 shape really does differ between
// the shells, which is why inline-literal-assignment must refuse it.
test('equivalence harness discriminates: an unquoted spaced value splits in bash and not in zsh', { skip: process.platform === 'win32' || SHELLS.length < 2 }, () => {
  const command = 'P="/a b"; ls $P';
  assert.notDeepStrictEqual(runIn('bash', command, {}).stdout, runIn('zsh', command, {}).stdout);
  assert.strictEqual(rw(command), null);
});
