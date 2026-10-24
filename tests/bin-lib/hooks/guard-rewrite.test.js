'use strict';
// guard-rewrite.js (#4028): rewrites of Bash shapes the harness
// worktree-isolation guard over-refuses, emitted as PreToolUse `updatedInput`.
// The guard re-checks the rewritten command, so a rewrite can only normalize,
// never bypass — which makes identical output under BOTH bash and zsh (Review
// Focus 1) the property every positive case below must hold. Two rules hold it
// only under a stated condition, which the equivalence test encodes:
// plugin-root-placeholder is a resolution (the Bash tool leaves
// CLAUDE_PLUGIN_ROOT unset, so the original runs with it set here), and
// node-eval-separator diverges for a runtime value starting with `-` (pinned
// below; accepted by ruling).
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
// It also carries the layout every plugin shares (.claude-plugin/plugin.json,
// hooks/hooks.json) and one skill directory.
function pluginRootAt(dir) {
  for (const sub of ['bin', '.claude-plugin', 'hooks', 'skills/demo']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  fs.writeFileSync(path.join(dir, 'bin', 'x.js'), '');
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), '{}');
  fs.writeFileSync(path.join(dir, 'hooks', 'hooks.json'), '{}');
  fs.writeFileSync(path.join(dir, 'skills', 'demo', 'SKILL.md'), '');
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

// Review fix: a sourced file or an eval'd string can reassign the variable at
// runtime, so the assigned literal is no longer what the reference expands to.
test('inline-literal-assignment bails when source runs in command position', () => {
  assert.strictEqual(rw('NODE_ENV=development; source .env; echo "$NODE_ENV"'), null);
  assert.strictEqual(rw('P=/x; ( source ./env ); node $P/z.js'), null, 'inside a subshell');
  assert.strictEqual(rw('P=/x; "source" ./env; node $P/z.js'), null, 'quoted');
});

test('inline-literal-assignment bails when . runs in command position', () => {
  assert.strictEqual(rw('NODE_ENV=development; set -a; . ./.env; set +a; echo "$NODE_ENV"'), null);
  assert.strictEqual(rw('P=/x; echo "$(. ./env)" && node $P/z.js'), null, 'inside a substitution');
  assert.strictEqual(rw('P=/x; >/dev/null . ./env; node $P/z.js'), null, 'behind a redirection');
  assert.strictEqual(rw('P=/x; 2>/dev/null command . ./env; node $P/z.js'), null, 'behind an fd redirection and a prefix');
  assert.strictEqual(rw('P=/x; X=1 \\. ./env; node $P/z.js'), null, 'escaped, behind an assignment prefix');
  // `.` as an argument is not sourcing.
  assert.deepStrictEqual(rw('P=/x; ls $P/z .'), { command: 'P=/x; ls /x/z .', applied: ['inline-literal-assignment'] });
});

test('inline-literal-assignment bails when eval runs anywhere', () => {
  assert.strictEqual(rw('P=/x; eval "$(cat setp)"; echo "$P/z"'), null);
  assert.strictEqual(rw('P=/x; if true; then eval "$X"; fi; node $P/z.js'), null, 'after a keyword');
});

test('plugin-root-placeholder bails when source, . or eval runs', () => {
  for (const command of [
    'source ./env; node "${CLAUDE_PLUGIN_ROOT}/bin/x.js"',
    '. ./env && node "${CLAUDE_PLUGIN_ROOT}/bin/x.js"',
    'eval "$X"; node "${CLAUDE_PLUGIN_ROOT}/bin/x.js"',
  ]) assert.strictEqual(rw(command), null, command);
});

test('an unbraced reference followed by a backslash declines (line continuation joins the name)', () => {
  assert.strictEqual(rw('P=/x; echo $P\\\nQ'), null);
  assert.strictEqual(rw('P=/x; echo "$P\\\nQ"'), null);
  assert.deepStrictEqual(rw('P=/x; echo ${P}\\\nQ'), { command: 'P=/x; echo /x\\\nQ', applied: ['inline-literal-assignment'] }, 'a braced name is already closed');
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

// Review fix: every plugin ships .claude-plugin/plugin.json, hooks/hooks.json,
// bin/ and skills/, so existing under this root is not evidence the path is ours.
// Fix wave 2: skills/ is out too, since generic skill names (review, build)
// collide across plugins; only a file under bin/ is specific enough.
test('plugin-root-placeholder inlines only a file under its own bin/', () => {
  assert.strictEqual(rw('cat ${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json'), null);
  assert.strictEqual(rw('cat "${CLAUDE_PLUGIN_ROOT}/hooks/hooks.json"'), null);
  assert.strictEqual(rw('ls "${CLAUDE_PLUGIN_ROOT}/bin"'), null, 'the bin directory itself');
  assert.strictEqual(rw('ls "${CLAUDE_PLUGIN_ROOT}/skills"'), null);
  assert.strictEqual(rw('ls "${CLAUDE_PLUGIN_ROOT}/skills/demo"'), null);
  assert.strictEqual(rw('cat "${CLAUDE_PLUGIN_ROOT}/skills/demo/SKILL.md"'), null, 'a generic skill name collides across plugins');
  assert.strictEqual(rw('cat "${CLAUDE_PLUGIN_ROOT}/skills/./demo/SKILL.md"'), null);
  assert.strictEqual(rw('node "${CLAUDE_PLUGIN_ROOT}/bin/./x.js"'), null, 'a . segment declines, like skills/./build');
  assert.strictEqual(rw('node "${CLAUDE_PLUGIN_ROOT}/./bin/x.js"'), null);
  assert.deepStrictEqual(rw('node "${CLAUDE_PLUGIN_ROOT}/bin/x.js"'), { command: `node "${ROOT}/bin/x.js"`, applied: ['plugin-root-placeholder'] });
});

// Fix wave 2: rules 1 and 2 rewrite only when every command-position word is a
// plain literal outside the runner set — an allowlist, since the runner
// denylist leaked (an expansion as the command word, trap, `>|`, a redirection
// target computed by $( … )).
test('inline-literal-assignment declines when a command word is an expansion', () => {
  assert.strictEqual(rw('P=/x; $(echo .) ./f; echo $P/z'), null);
  assert.strictEqual(rw('P=/x; "$(echo .)" ./f; echo $P/z'), null);
  assert.strictEqual(rw('P=/x; $SRC ./f; echo $P/z'), null);
  assert.strictEqual(rw('node "${CLAUDE_PLUGIN_ROOT}/bin/x.js"; $SRC ./f'), null, 'rule 2 too');
});

test('inline-literal-assignment declines on trap and the other runner builtins', () => {
  assert.strictEqual(rw('P=/x; trap "$(cat setp)" DEBUG; echo $P/z'), null);
  for (const runner of ['builtin source f', 'command . ./f', 'printf -v "$N" %s /y', 'read -r "$N" < f', 'set -a', 'export "$N=/y"', 'declare -n R="$N"', 'function f { : }']) {
    // A quoted reference, so the unquoted-brace bail cannot stand in for the runner check.
    assert.strictEqual(rw(`P=/x; ${runner}; echo "$P/z"`), null, runner);
  }
});

test('inline-literal-assignment declines on >| and on a redirection target computed by $( … )', () => {
  assert.strictEqual(rw('P=/x; >| out . ./f; echo $P/z'), null);
  assert.strictEqual(rw('P=/x; echo a >| out; echo $P/z'), null, '>| alone is not placed with certainty');
  assert.strictEqual(rw('P=/x; >"$(echo o)" . ./f; echo $P/z'), null);
  assert.strictEqual(rw('P=/x; echo a >"$(echo o)"; echo $P/z'), null, 'a computed target alone declines too');
  assert.strictEqual(rw('P=/x; echo a > >(cat); echo $P/z'), null, 'process substitution after a redirection');
  assert.strictEqual(rw('P=/x; echo a >(cat); echo $P/z'), null, 'process substitution');
  assert.strictEqual(rw('P=/x; >! out . ./f; echo $P/z'), null, "zsh's >! clobber would hand `out` the command position");
});

// Fix wave 3: zsh grammar positions the walk read as arguments. Every bash/zsh
// reserved word and zsh precommand modifier in command position declines; only
// if/then/else/elif (and fi) stay, since the next word is checked as a command.
test('rules 1 and 2 decline on reserved words in command position (zsh repeat, short forms, loops)', () => {
  assert.strictEqual(rw('P=/x; repeat 1 . ./f; echo $P/z'), null);
  assert.strictEqual(rw('P=/x; repeat 1 do . ./f; done; echo $P/z'), null);
  assert.strictEqual(rw('P=/x; if [[ -n x ]] . ./f; echo $P/z'), null, 'zsh SHORT_LOOPS if');
  assert.strictEqual(rw('P=/x; foreach x (a) . ./f; end; echo $P/z'), null);
  assert.strictEqual(rw('P=/x; for x (a) . ./f; echo $P/z'), null);
  for (const word of ['case', 'esac', 'do', 'done', 'for', 'foreach', 'end', 'in', 'select', 'until', 'while', 'repeat', 'time', 'nocorrect', 'noglob', '[[', ']]', '{', '}', '!', '-']) {
    // Quoted reference: no other bail can stand in for the reserved-word check.
    assert.strictEqual(rw(`P=/x; ${word} true; echo "$P/z"`), null, word);
  }
  assert.strictEqual(rw('node "${CLAUDE_PLUGIN_ROOT}/bin/x.js"; repeat 1 true'), null, 'rule 2 too');
  // Kept as safe: the word after if/then/else/elif is itself checked.
  assert.deepStrictEqual(rw('P=/x; if true; then node $P/z.js; else node $P/y.js; fi'), {
    command: 'P=/x; if true; then node /x/z.js; else node /x/y.js; fi', applied: ['inline-literal-assignment'],
  });
  assert.strictEqual(rw('P=/x; if true; then . ./f; fi; echo $P/z'), null);
});

// Fix wave 3: arithmetic evaluates a variable's value recursively, and an
// expression can assign (`[[ $N -eq 5 ]]` with N=P=5 sets P).
test('rules 1 and 2 decline on any arithmetic context', () => {
  for (const ctx of ['echo $(( N ))', 'echo "$(( N ))"', 'echo $[N]', 'echo "$[N]"', '(( N ))', 'echo $a[$N]', '[[ $N -eq 5 ]]',
    'let N', 'shift $N', 'break $N', 'continue $N', 'return $N']) {
    assert.strictEqual(rw(`P=/x; ${ctx}; echo "$P/z"`), null, ctx);
  }
  assert.strictEqual(rw('node "${CLAUDE_PLUGIN_ROOT}/bin/x.js" $(( N ))'), null, 'rule 2 too');
  // `[` and `test` never evaluate arithmetic (probed under both shells): kept.
  assert.deepStrictEqual(rw('P=/x; [ $N -eq 5 ] && node $P/z.js'), { command: 'P=/x; [ $N -eq 5 ] && node /x/z.js', applied: ['inline-literal-assignment'] });
  assert.deepStrictEqual(rw('P=/x; test $N -gt 1; node $P/z.js'), { command: 'P=/x; test $N -gt 1; node /x/z.js', applied: ['inline-literal-assignment'] });
  assert.strictEqual(rw("P=/x; awk '{print a[1]}' f; echo \"$P/z\"").command, "P=/x; awk '{print a[1]}' f; echo \"/x/z\"", 'a subscript inside single quotes is text');
});

// Fix wave 4: builtins that assign a parameter NAMED by an operand reassign a
// variable the text never spells once the name is computed at runtime, so the
// bare-use check (which needs the name written out) cannot see them.
const COMPUTED_NAME = 'V=$(echo p | tr a-z A-Z)';
const NAME_ASSIGNERS = [
  'zstyle', 'zformat', 'zregexparse', 'getln', 'sysread', 'syswrite', 'sysopen', 'zsystem', 'syserror', 'zstat', 'stat',
  'zselect', 'zpty', 'zcurses', 'ztie', 'zuntie', 'zgetattr', 'zlistattr', 'pcre_match', 'nameref', 'compadd', 'compset',
  'compquote', 'comparguments', 'compvalues', 'compdescribe', 'comptags', 'comptry', 'compfiles', 'compgroups', 'compgen',
];
test('rules 1 and 2 decline on module builtins that assign a computed name', () => {
  for (const word of NAME_ASSIGNERS) {
    assert.strictEqual(rw(`P=/x; ${COMPUTED_NAME}; ${word} "$V"; echo "$P/z"`), null, word);
  }
  // The runner words that already decline, now with a computed name.
  for (const runner of ['print -v "$V" /pv', 'printf -v "$V" %s /pf', 'read -r "$V" < f', 'typeset "$V"=/ty', 'declare "$V"=/de',
    'export "$V"=/ex', 'readonly "$V"=/ro', 'local "$V"=/lo', 'zparseopts -A "$V" a', 'vared "$V"', 'mapfile -t "$V" < f', 'wait -p "$V"',
    'strftime -s "$V" %Y 0']) {
    assert.strictEqual(rw(`P=/x; ${COMPUTED_NAME}; ${runner}; echo "$P/z"`), null, runner);
  }
  assert.strictEqual(rw(`node "\${CLAUDE_PLUGIN_ROOT}/bin/x.js"; ${COMPUTED_NAME}; zstyle -s :x y "$V"`), null, 'rule 2 too');
  // The leading assignment run is not a later command word: `export P=…` still rewrites.
  assert.deepStrictEqual(rw('export P=/x; node $P/z.js'), { command: 'export P=/x; node /x/z.js', applied: ['inline-literal-assignment'] });
});

test('the allowlist keeps plain command words rewriting: cd ., ls ., cp a ., find ., git -C ., >.', () => {
  for (const [command, expected] of [
    ['P=/x; cd . && node $P/z.js', 'P=/x; cd . && node /x/z.js'],
    ['P=/x; ls $P/z .', 'P=/x; ls /x/z .'],
    ['P=/x; cp a . && node $P/z.js', 'P=/x; cp a . && node /x/z.js'],
    ['P=/x; find . -name a; node $P/z.js', 'P=/x; find . -name a; node /x/z.js'],
    ['P=/x; git -C . status; node $P/z.js', 'P=/x; git -C . status; node /x/z.js'],
    ['P=/x; echo a >. ; node $P/z.js', 'P=/x; echo a >. ; node /x/z.js'],
    ['P=/x; node $P/z.js 2>&1 | cat', 'P=/x; node /x/z.js 2>&1 | cat'],
    ['P=/x; X=1 env -i node "$(echo $P)/z.js"', 'P=/x; X=1 env -i node "$(echo /x)/z.js"'],
  ]) assert.deepStrictEqual(rw(command), { command: expected, applied: ['inline-literal-assignment'] }, command);
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
  { rule: 'plugin-root-placeholder', command: 'node $CLAUDE_PLUGIN_ROOT/bin/x.js "$CLAUDE_PLUGIN_ROOT/bin/x.js"' },
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

// Must-decline cases: the naive inline (what rule 1 produced before the review
// fix) prints something different from the original under each shell, because
// the sourced file or eval'd string reassigns the variable at runtime.
fs.writeFileSync(path.join(CWD, 'setp'), 'P=/evald\n');
fs.writeFileSync(path.join(CWD, '.env'), 'export NODE_ENV=production\n');
fs.writeFileSync(path.join(CWD, 'f'), 'P=/sourced\n');
const MUST_DECLINE = [
  { command: 'NODE_ENV=development; source .env; echo "$NODE_ENV"', naive: 'NODE_ENV=development; source .env; echo "development"' },
  { command: 'NODE_ENV=development; set -a; . ./.env; set +a; echo "$NODE_ENV"', naive: 'NODE_ENV=development; set -a; . ./.env; set +a; echo "development"' },
  { command: 'P=/x; eval "$(cat setp)"; echo "$P/z"', naive: 'P=/x; eval "$(cat setp)"; echo "/x/z"' },
  // Fix wave 2: the forms the runner denylist missed.
  { command: 'P=/x; $(echo .) ./f; echo $P/z', naive: 'P=/x; $(echo .) ./f; echo /x/z' },
  { command: 'P=/x; "$(echo .)" ./f; echo $P/z', naive: 'P=/x; "$(echo .)" ./f; echo /x/z' },
  { command: 'P=/x; $SRC ./f; echo $P/z', naive: 'P=/x; $SRC ./f; echo /x/z', env: { SRC: '.' } },
  { command: 'P=/x; trap "$(cat setp)" DEBUG; echo $P/z', naive: 'P=/x; trap "$(cat setp)" DEBUG; echo /x/z' },
  { command: 'P=/x; >| out . ./f; echo $P/z', naive: 'P=/x; >| out . ./f; echo /x/z' },
  { command: 'P=/x; >"$(echo o)" . ./f; echo $P/z', naive: 'P=/x; >"$(echo o)" . ./f; echo /x/z' },
  // Fix wave 3: zsh grammar positions (each a syntax error in bash, so zsh only)…
  { command: 'P=/x; repeat 1 . ./f; echo $P/z', naive: 'P=/x; repeat 1 . ./f; echo /x/z', shells: ['zsh'] },
  { command: 'P=/x; repeat 1 do . ./f; done; echo $P/z', naive: 'P=/x; repeat 1 do . ./f; done; echo /x/z', shells: ['zsh'] },
  { command: 'P=/x; if [[ -n x ]] . ./f; echo $P/z', naive: 'P=/x; if [[ -n x ]] . ./f; echo /x/z', shells: ['zsh'] },
  // …and arithmetic evaluation of a runtime string (both shells).
  { command: 'P=/x; [[ $(echo XP=5 | cut -c2-) -eq 5 ]]; echo $P/z', naive: 'P=/x; [[ $(echo XP=5 | cut -c2-) -eq 5 ]]; echo /x/z' },
  { command: 'P=/x; [[ $N -eq 5 ]]; echo $P/z', naive: 'P=/x; [[ $N -eq 5 ]]; echo /x/z', env: { N: 'P=5' } },
  { command: 'P=/x; echo $[$(echo XP=5 | cut -c2-)]; echo $P/z', naive: 'P=/x; echo $[$(echo XP=5 | cut -c2-)]; echo /x/z' },
];
// Fix wave 4: a computed name (never spelled P) handed to a name-assigning
// builtin. `preamble` stands in for a shell snapshot that already loaded the
// module; an entry whose module this zsh lacks is skipped, not passed.
const nameCase = (stmt, extra = {}) => ({
  command: `P=/x; ${COMPUTED_NAME}; ${stmt}; echo $P/z`, naive: `P=/x; ${COMPUTED_NAME}; ${stmt}; echo /x/z`, ...extra,
});
MUST_DECLINE.push(
  nameCase('zstyle :x y /zs; zstyle -s :x y "$V"', { shells: ['zsh'] }),
  nameCase('zformat -f "$V" /zf', { shells: ['zsh'] }),
  nameCase('print -z /gl; getln "$V"', { shells: ['zsh'] }),
  nameCase('zregexparse "$V" x x', { shells: ['zsh'] }),
  nameCase('zparseopts -A "$V" a', { shells: ['zsh'] }),
  nameCase('print -v "$V" /pv', { shells: ['zsh'] }),
  nameCase('sysread "$V" < setp', { shells: ['zsh'], preamble: 'zmodload zsh/system' }),
  nameCase('syswrite -c "$V" ab >/dev/null', { shells: ['zsh'], preamble: 'zmodload zsh/system' }),
  nameCase('syserror -e "$V" 2', { shells: ['zsh'], preamble: 'zmodload zsh/system' }),
  nameCase('zstat -A "$V" +size setp', { shells: ['zsh'], preamble: 'zmodload zsh/stat' }),
  nameCase('stat -A "$V" +size setp', { shells: ['zsh'], preamble: 'zmodload zsh/stat' }),
  nameCase('strftime -s "$V" %Y 0', { shells: ['zsh'], preamble: 'zmodload zsh/datetime' }),
  nameCase('printf -v "$V" %s /pf'),
  nameCase('read -r "$V" < setp'),
  nameCase('declare "$V"=/de'),
  nameCase('export "$V"=/ex'),
);

test('must-decline cases: code run from the command text reassigns at runtime, so the naive inline differs under bash and zsh', { skip: process.platform === 'win32' || !SHELLS.includes('bash') }, (t) => {
  for (const { command, naive, env = {}, shells = SHELLS, preamble } of MUST_DECLINE) {
    assert.strictEqual(rw(command), null, command);
    for (const shell of SHELLS.filter((sh) => shells.includes(sh))) {
      if (preamble && runIn(shell, preamble, env).status !== 0) {
        t.diagnostic(`${shell}: skipped (${preamble} unavailable): ${command}`);
        continue;
      }
      const pre = preamble ? `${preamble}; ` : '';
      const original = runIn(shell, pre + command, env);
      assert.strictEqual(original.status, 0, `${shell}: ${command}\n${original.stderr}`);
      assert.notStrictEqual(runIn(shell, pre + naive, env).stdout, original.stdout, `${shell}: the naive inline must differ for ${command}`);
    }
  }
});

// Fix wave 2, property-style: a deterministic PRNG draws short commands from a
// small grammar mixing safe statements with runners (`.`, source, eval, trap,
// an expansion as the command word), redirections, the four list operators and
// subshells. Every command the normalizer rewrites must print the same stdout
// and stderr, with the same status, under bash and zsh. Only builtins and
// /bin/echo run, so a few hundred cases stay quick; the runner's timeout is the
// hang bound (no wall-clock budget in tests/).
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const GRAMMAR = {
  lead: ['P=/x; ', 'P=/x && ', 'export P=/x\n', 'P=/x; Q=/q; ', 'P="/a b"; '],
  safe: [
    'echo $P/z', 'echo "$P/z"', 'echo ${P}/b', '/bin/echo $P/e', 'true', 'false', 'cd . && echo $P/c', 'echo "$Q"', '[ -n "$P" ] && echo $P/t',
    '[ $N -eq 5 ] 2>/dev/null || echo $P/q', 'if true; then echo $P/i; fi',
  ],
  risky: [
    '. ./f', 'source ./f', 'eval "$(cat setp)"', 'trap "$(cat setp)" DEBUG', '$(echo .) ./f', '"$(echo .)" ./f', '$SRC ./f',
    '>| out . ./f', '>"$(echo o)" . ./f', 'x=1 . ./f', '2>/dev/null . ./f', 'command . ./f', 'builtin source ./f', '( . ./f; echo $P/s )',
    'echo "$(. ./f; echo $P/i)"', 'set -a', 'read -r P < setp',
    // Fix wave 3: reserved-word grammar positions and arithmetic contexts.
    'repeat 1 . ./f', 'repeat 1 do . ./f; done', 'if [[ -n x ]] . ./f', '[[ $(echo XP=5 | cut -c2-) -eq 5 ]]', '[[ $N -eq 5 ]]',
    'echo $[$(echo XP=5 | cut -c2-)]', '(( N ))', 'let N', 'echo $(( $N ))', 'case a in a) . ./f;; esac', '{ . ./f; }',
    'for i in a; do . ./f; done', 'while false; do :; done', 'g() { . ./f; }; g', 'shift $N',
  ],
  redirect: ['', '', '', ' 2>/dev/null', ' 2>&1', ' >/dev/null'],
  join: ['; ', ' && ', ' || ', ' | ', '\n'],
};
function drawCommand(rand) {
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const statement = () => {
    const body = (rand() < 0.35 ? pick(GRAMMAR.risky) : pick(GRAMMAR.safe)) + pick(GRAMMAR.redirect);
    return rand() < 0.15 ? `( ${body} )` : body;
  };
  let command = pick(GRAMMAR.lead) + statement();
  const extra = Math.floor(rand() * 3);
  for (let k = 0; k < extra; k += 1) command += pick(GRAMMAR.join) + statement();
  return `${command}; echo "$P/end"`;
}

test('property: every rewrite of a randomly drawn command keeps stdout, stderr and status under bash and zsh', { skip: process.platform === 'win32' || !SHELLS.includes('bash'), timeout: 300000 }, (t) => {
  const rand = mulberry32(4028);
  let rewritten = 0;
  let declined = 0;
  // N=P=5: any arithmetic evaluation of $N assigns P (fix wave 3).
  const env = { PATH: process.env.PATH, HOME: process.env.HOME || os.homedir(), SRC: '.', N: 'P=5' };
  for (let n = 0; n < 300; n += 1) {
    const command = drawCommand(rand);
    const out = rw(command);
    if (!out) {
      declined += 1;
      continue;
    }
    rewritten += 1;
    for (const shell of SHELLS) {
      const args = (c) => (shell === 'zsh' ? ['-f', '-c', c] : ['-c', c]);
      const run = (c) => {
        const r = spawnSync(shell, args(c), { cwd: CWD, env, encoding: 'utf8', windowsHide: true });
        return { stdout: r.stdout, stderr: r.stderr, status: r.status };
      };
      assert.deepStrictEqual(run(out.command), run(command), `${shell}: ${JSON.stringify(command)}\n→ ${JSON.stringify(out.command)}`);
    }
  }
  t.diagnostic(`rewritten=${rewritten} declined=${declined} shells=${SHELLS.join(',')}`);
  // Not vacuous: the grammar both rewrites and declines in volume.
  assert.ok(rewritten >= 50, `only ${rewritten} rewrites`);
  assert.ok(declined >= 50, `only ${declined} declines`);
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
