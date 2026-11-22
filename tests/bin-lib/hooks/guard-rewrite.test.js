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
const { toPosix } = require('../../../plugin/bin/lib/shared-primitives');
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
const POSIX_ROOT = toPosix(ROOT);
// A win32 session on any host: the fs answers come from the injected deps.
function win32(extra = {}) {
  const lstats = [];
  const shipped = extra.shipped || 'D:\\p\\root\\bin\\x.js';
  return {
    lstats,
    opts: {
      pathImpl: path.win32,
      cwd: 'D:\\w\\cwd',
      pluginRoot: 'D:\\p\\root',
      deps: {
        isLinkedWorktree: () => true,
        lstatType: (p) => { lstats.push(p); return { type: p === shipped ? 'file' : 'missing' }; },
        canonicalRealpath: (p) => path.win32.resolve(p),
      },
      ...extra.opts,
    },
  };
}
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
  assert.deepStrictEqual(rw('node "${CLAUDE_PLUGIN_ROOT}/bin/x.js" a'), { command: `node "${POSIX_ROOT}/bin/x.js" a`, applied: ['plugin-root-placeholder'] });
  assert.deepStrictEqual(rw('node $CLAUDE_PLUGIN_ROOT/bin/x.js'), { command: `node ${POSIX_ROOT}/bin/x.js`, applied: ['plugin-root-placeholder'] });
  assert.strictEqual(rw("node '${CLAUDE_PLUGIN_ROOT}/bin/x.js'"), null, 'single-quoted stays literal');
  assert.strictEqual(rw('export CLAUDE_PLUGIN_ROOT="$X"; node "$CLAUDE_PLUGIN_ROOT/x.js"'), null, 'assigns it itself');
  assert.strictEqual(rw('unset CLAUDE_PLUGIN_ROOT; node "$CLAUDE_PLUGIN_ROOT/x.js"'), null);
  // A literal self-assignment is rule 1's job, and its own value wins over the root.
  assert.deepStrictEqual(rw('CLAUDE_PLUGIN_ROOT=/elsewhere; node "$CLAUDE_PLUGIN_ROOT/x.js"'), {
    command: 'CLAUDE_PLUGIN_ROOT=/elsewhere; node "/elsewhere/x.js"', applied: ['inline-literal-assignment'],
  });
  const spaced = pluginRootAt(path.join(SANDBOX, 'a b', 'root'));
  assert.strictEqual(rw('node $CLAUDE_PLUGIN_ROOT/bin/x.js', { pluginRoot: spaced }), null, 'unquoted + a root with a space');
  assert.deepStrictEqual(rw('node "$CLAUDE_PLUGIN_ROOT/bin/x.js"', { pluginRoot: spaced }), { command: `node "${toPosix(spaced)}/bin/x.js"`, applied: ['plugin-root-placeholder'] });
  assert.strictEqual(rw('node "$CLAUDE_PLUGIN_ROOT/bin/x.js"', { pluginRoot: 'relative/root' }), null, 'a non-absolute root');
  assert.strictEqual(rw('node "$CLAUDE_PLUGIN_ROOT/bin/x.js"', { pluginRoot: '/opt/$x' }), null, 'a root outside the literal class');
  // Another plugin's prose spells the same placeholder for its own root.
  assert.strictEqual(rw('node "${CLAUDE_PLUGIN_ROOT}/scripts/other.js"'), null, 'a path this root does not ship');
  assert.strictEqual(rw('node "${CLAUDE_PLUGIN_ROOT}/bin/x.js" "$CLAUDE_PLUGIN_ROOT"'), null, 'a bare reference names no shipped path');
  assert.strictEqual(rw('node "${CLAUDE_PLUGIN_ROOT}/../plugin-root/bin/x.js"'), null, 'a parent segment');
});

// The two declines above end on `/x.js`, which is not under bin/, so shippedUnder alone
// would earn them. These end on a shipped bin/ file. The export/unset forms are also
// caught by the runner allowlist (inlineContextSafe), so they pin the two layers
// together; the plain assignments are plain command words that only hasBareUse declines.
test('plugin-root-placeholder declines a command that binds the name itself, on a shipped bin/ path', () => {
  for (const command of [
    'export CLAUDE_PLUGIN_ROOT="$X"; node "$CLAUDE_PLUGIN_ROOT/bin/x.js"',
    'unset CLAUDE_PLUGIN_ROOT; node "$CLAUDE_PLUGIN_ROOT/bin/x.js"',
    'CLAUDE_PLUGIN_ROOT=$X; node "$CLAUDE_PLUGIN_ROOT/bin/x.js"',
    'CLAUDE_PLUGIN_ROOT="$X"; node "$CLAUDE_PLUGIN_ROOT/bin/x.js"',
    'CLAUDE_PLUGIN_ROOT=$(pwd); node "$CLAUDE_PLUGIN_ROOT/bin/x.js"',
    'true && CLAUDE_PLUGIN_ROOT=$X; node "$CLAUDE_PLUGIN_ROOT/bin/x.js"',
  ]) assert.strictEqual(rw(command), null, command);
});

// A `${NAME:=word}` / `${NAME:-word}` form is one scan() cannot read as a plain reference
// (complexParam). `:=` assigns the name when unset, so the later bare reference does not
// hold the injected root; an unrelated `${X:-y}` pins the flag on its own, with the
// root name appearing only in the plain bare use that would otherwise inline.
test('plugin-root-placeholder declines a complex ${...} parameter expansion: complexParam', () => {
  for (const command of [
    'node "${CLAUDE_PLUGIN_ROOT:=/a}" "$CLAUDE_PLUGIN_ROOT/bin/x.js"',
    'echo "${CLAUDE_PLUGIN_ROOT:-/a}"; node "$CLAUDE_PLUGIN_ROOT/bin/x.js"',
    'echo "${X:-y}"; node "$CLAUDE_PLUGIN_ROOT/bin/x.js"',
  ]) assert.strictEqual(rw(command), null, `complexParam: ${command}`);
});

test('plugin-root-placeholder declines a backtick or an ANSI-C quote: inDoubt', () => {
  assert.strictEqual(rw('node "$CLAUDE_PLUGIN_ROOT/bin/x.js" `id`'), null, 'a backtick');
  assert.strictEqual(rw('node "$CLAUDE_PLUGIN_ROOT/bin/x.js" $\'a\''), null, 'ANSI-C quoting');
});

test('AC2.1, AC2.2: plugin-root-placeholder inlines a win32 root forward-slashed and lstats the native join', () => {
  const w = win32();
  assert.deepStrictEqual(rewriteForGuard({ command: 'node "${CLAUDE_PLUGIN_ROOT}/bin/x.js" a', ...w.opts }),
    { command: 'node "D:/p/root/bin/x.js" a', applied: ['plugin-root-placeholder'] });
  assert.deepStrictEqual(w.lstats, ['D:\\p\\root\\bin\\x.js']);
});

test('plugin-root-placeholder under path.win32: bare, spaced, tilde and UNC roots', () => {
  const run = (command, pluginRoot, shipped) => rewriteForGuard({ command, ...win32({ shipped, opts: { pluginRoot } }).opts });
  assert.strictEqual(run('node $CLAUDE_PLUGIN_ROOT/bin/x.js', 'D:\\p\\root').command, 'node D:/p/root/bin/x.js');
  assert.strictEqual(run('node "$CLAUDE_PLUGIN_ROOT/bin/x.js"', 'D:\\a b\\root', 'D:\\a b\\root\\bin\\x.js').command, 'node "D:/a b/root/bin/x.js"');
  assert.strictEqual(run('node $CLAUDE_PLUGIN_ROOT/bin/x.js', 'D:\\a b\\root', 'D:\\a b\\root\\bin\\x.js'), null, 'unquoted + a space');
  assert.strictEqual(run('node "$CLAUDE_PLUGIN_ROOT/bin/x.js"', 'C:\\RUNNER~1\\root', 'C:\\RUNNER~1\\root\\bin\\x.js'), null, 'a ~ is outside LITERAL_VALUE');
  assert.strictEqual(run('node "$CLAUDE_PLUGIN_ROOT/bin/x.js"', '\\\\srv\\share\\root', '\\\\srv\\share\\root\\bin\\x.js').command, 'node "//srv/share/root/bin/x.js"');
  assert.strictEqual(run('node "$CLAUDE_PLUGIN_ROOT/bin/x.js"', 'relative\\root'), null, 'not absolute under path.win32');
  assert.strictEqual(run('node "$CLAUDE_PLUGIN_ROOT/bin/x.js"', '\\p\\root', '\\p\\root\\bin\\x.js'), null, 'drive-relative: /p/root would be the P: mount under Git Bash');
  assert.strictEqual(run('$CLAUDE_PLUGIN_ROOT/bin/x.js', 'D:\\p\\root'), null, 'a drive colon is outside PLAIN_COMMAND_WORD');
});

test('under path.posix a backslash in the root still declines: toPosix converts only pathImpl.sep', () => {
  assert.strictEqual(rw('node "${CLAUDE_PLUGIN_ROOT}/bin/x.js"', { pluginRoot: '/opt/a\\b', pathImpl: path.posix }), null);
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
  assert.deepStrictEqual(rw('node "${CLAUDE_PLUGIN_ROOT}/bin/x.js"'), { command: `node "${POSIX_ROOT}/bin/x.js"`, applied: ['plugin-root-placeholder'] });
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
    ['P=/x; echo a >. ; node $P/z.js', 'P=/x; echo a >. ; node /x/z.js'],
    ['P=/x; node $P/z.js 2>&1 | cat', 'P=/x; node /x/z.js 2>&1 | cat'],
    ['P=/x; X=1 env -i node "$(echo $P)/z.js"', 'P=/x; X=1 env -i node "$(echo /x)/z.js"'],
  ]) assert.deepStrictEqual(rw(command), { command: expected, applied: ['inline-literal-assignment'] }, command);
  assert.deepStrictEqual(rw('P=/x; git -C . status; node $P/z.js'), { command: 'P=/x; git status; node /x/z.js', applied: ['inline-literal-assignment', 'drop-git-C-cwd'] });
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

test('node-eval-separator reads node after a separator', () => {
  for (const sep of ['&', '&&', '|', '|&', '||']) {
    assert.deepStrictEqual(rw(`ls ${sep} node -e '1' "$A"`), { command: `ls ${sep} node -e '1' -- "$A"`, applied: ['node-eval-separator'] }, sep);
  }
});

test('node-eval-separator never reads node as a >& redirection target', () => {
  assert.strictEqual(rw(`echo x >& node -e '1' "$A"`), null, 'writes to a file named node');
});

test('node-eval-separator never reads node as a <& redirection target', () => {
  assert.strictEqual(rw(`echo x <& node -e '1' "$A"`), null);
});

test('node-eval-separator never reads node as an array element: the ( of a=( starts no command', () => {
  assert.strictEqual(rw(`a=(node -e '1' "$A")`), null);
  assert.strictEqual(rw(`a+=(node -e '1' "$A")`), null);
  assert.deepStrictEqual(rw(`(node -e '1' "$A")`), { command: `(node -e '1' -- "$A")`, applied: ['node-eval-separator'] }, 'a subshell ( at a command start still starts one');
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
  assert.deepStrictEqual(rw(`cd '${CWD}/' && ls x`), { command: 'ls x', applied: ['drop-redundant-cd'] });
  assert.deepStrictEqual(rw(`cd "${CWD}/" && ls x`), { command: 'ls x', applied: ['drop-redundant-cd'] });
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

test('AC2.3, AC2.4: drop-redundant-cd under path.win32', () => {
  const run = (command, extra) => rewriteForGuard({ command, ...win32({ opts: extra }).opts });
  assert.deepStrictEqual(run('cd "D:\\w\\cwd" && ls x'), { command: 'ls x', applied: ['drop-redundant-cd'] });
  assert.deepStrictEqual(run('cd "D:\\w\\cwd/" && ls x'), { command: 'ls x', applied: ['drop-redundant-cd'] }, 'a trailing / after an exact spelling is tolerated');
  assert.strictEqual(run('cd D:\\w\\cwd && ls x'), null, 'bash strips an unquoted backslash');
  assert.strictEqual(run('cd "D:\\w\\$X" && ls x'), null, 'a backslash before $');
  assert.strictEqual(run('cd "D:\\w\\cwd\\" && ls x'), null, 'a trailing backslash escapes the quote');
  assert.strictEqual(run('cd "D:\\w\\other" && ls x'), null, 'a different directory');
  assert.strictEqual(run('cd "E:\\w\\cwd" && ls x'), null, 'another drive');
  assert.deepStrictEqual(rewriteForGuard({ command: 'cd /w/cwd/ && ls x', cwd: '/w/cwd', pluginRoot: ROOT, pathImpl: path.posix, deps: { isLinkedWorktree: () => true, canonicalRealpath: (p) => path.posix.resolve(p) } }), { command: 'ls x', applied: ['drop-redundant-cd'] }, 'an unquoted target with no backslash');
});

test('drop-redundant-cd under path.win32 keeps comparing exact spellings: the three residual declines', () => {
  const run = (command) => rewriteForGuard({ command, ...win32().opts });
  assert.strictEqual(run('cd "D:/w/cwd" && ls x'), null, 'residual: a forward-slashed spelling of the cwd');
  assert.strictEqual(run('cd "/d/w/cwd" && ls x'), null, 'residual: a Git Bash /d/ spelling of the cwd');
  // The fixture's realpath leaves `/d/w/cwd` a different path than the cwd, which would decline
  // the /d/ spelling on its own; a realpath that resolves it to the cwd's directory (what Git Bash
  // does) leaves the exact-spelling compare as the only thing that can decline it.
  const fixture = win32().opts;
  const msys = { ...fixture, deps: { ...fixture.deps, canonicalRealpath: (p) => path.win32.resolve(p.replace(/^\/([a-z])\//i, (m, d) => `${d.toUpperCase()}:\\`)) } };
  assert.strictEqual(rewriteForGuard({ command: 'cd "/d/w/cwd" && ls x', ...msys }), null, 'residual: a /d/ spelling that resolves to the cwd');
  // The same for the re-cased drive: the fixture's realpath keeps the drive letter's case, which
  // would decline it on its own; a case-folding realpath (the on-disk answer on a real Windows
  // volume) leaves the exact-spelling compare as the only thing that can decline it.
  const folding = { ...fixture, deps: { ...fixture.deps, canonicalRealpath: (p) => path.win32.resolve(p).toLowerCase() } };
  assert.strictEqual(rewriteForGuard({ command: 'cd "d:\\w\\cwd" && ls x', ...folding }), null, 'residual: a re-cased drive');
  assert.deepStrictEqual(rewriteForGuard({ command: 'cd "D:\\w\\cwd" && ls x', ...folding }), { command: 'ls x', applied: ['drop-redundant-cd'] }, 'the exact spelling still drops under the folding realpath');
});

// drop-git-C-cwd. Each decline pin hands the rule an input every other check accepts: the operand
// spells the cwd and the realpath stub resolves it there, except for the property under test.
const posix = (command, cwd = '/w/wt', realpath = (p) => path.posix.resolve(p)) => rewriteForGuard({ command, cwd, pluginRoot: ROOT, pathImpl: path.posix, deps: { isLinkedWorktree: () => true, canonicalRealpath: realpath } });
// A realpath that resolves `spelling` to the cwd, so only the spelling compare can decline it.
const resolvesToCwd = (spelling) => (p) => (p === spelling ? '/w/wt' : path.posix.resolve(p));

test('AC1.1: drop-git-C-cwd turns git -C . log into git log, and runs after drop-redundant-cd', () => {
  assert.deepStrictEqual(rw('git -C . log --oneline -3'), { command: 'git log --oneline -3', applied: ['drop-git-C-cwd'] });
  assert.deepStrictEqual(rw(`cd "${CWD}" && git -C . status --short`), { command: 'git status --short', applied: ['drop-redundant-cd', 'drop-git-C-cwd'] });
  assert.deepStrictEqual(rw("git -C '.' diff"), { command: 'git diff', applied: ['drop-git-C-cwd'] });
  assert.deepStrictEqual(rw('git -C "." show'), { command: 'git show', applied: ['drop-git-C-cwd'] });
  assert.deepStrictEqual(rw('ls | git -C . log'), { command: 'ls | git log', applied: ['drop-git-C-cwd'] }, 'Review Focus 1: after a pipe');
  assert.deepStrictEqual(rw('git  -C \t .   rev-parse HEAD; git -C . status'), { command: 'git rev-parse HEAD; git status', applied: ['drop-git-C-cwd'] }, 'every qualifying call, one blank left');
});

test('AC2.1: drop-git-C-cwd drops a literal spelling of the cwd', () => {
  assert.deepStrictEqual(posix('git -C "/w/wt" grep -n x -- a/*.js'), { command: 'git grep -n x -- a/*.js', applied: ['drop-git-C-cwd'] });
  assert.deepStrictEqual(posix("git -C '/w/wt' ls-files"), { command: 'git ls-files', applied: ['drop-git-C-cwd'] });
  assert.deepStrictEqual(posix('git -C /w/wt status'), { command: 'git status', applied: ['drop-git-C-cwd'] });
});

test('AC2.1: /w/wt/ is rewritten', () => {
  assert.deepStrictEqual(posix('git -C "/w/wt/" log'), { command: 'git log', applied: ['drop-git-C-cwd'] });
});

test('AC2.2: drop-git-C-cwd declines git -C "/w/other": not the cwd', () => {
  assert.strictEqual(posix('git -C "/w/other" log'), null);
});

test('AC2.2: drop-git-C-cwd declines cd sub && git -C "/w/wt" log', () => {
  assert.strictEqual(posix('cd sub && git -C "/w/wt" log'), null);
});

test('AC2.2: drop-git-C-cwd declines a cd word anywhere in the text', () => {
  assert.strictEqual(posix('git -C "/w/wt" log && cd sub'), null);
  assert.strictEqual(posix('git -C "/w/wt" log; echo "cd"'), null, 'quoted or not');
});

test('AC2.2: drop-git-C-cwd declines a pushd word', () => {
  assert.strictEqual(posix('git -C "/w/wt" log; pushd sub'), null);
});

test('AC2.2: drop-git-C-cwd declines a popd word', () => {
  assert.strictEqual(posix('git -C "/w/wt" log; popd'), null);
});

test('AC2.2: drop-git-C-cwd declines a second -C', () => {
  // git reads -C only before the subcommand, so a second -C sits where the subcommand word does:
  // the read allowlist is the check that earns this decline.
  assert.strictEqual(posix('git -C "/w/wt" -C sub log'), null);
});

test('drop-git-C-cwd keeps a -C that is the subcommand\'s own option', () => {
  assert.deepStrictEqual(rw('git -C . grep -C 3 foo'), { command: 'git grep -C 3 foo', applied: ['drop-git-C-cwd'] });
  assert.deepStrictEqual(posix('git -C "/w/wt" log -C sub'), { command: 'git log -C sub', applied: ['drop-git-C-cwd'] });
});

test('drop-git-C-cwd leaves a git that is the target of a >& or <& redirection', () => {
  assert.strictEqual(rw('echo x >& git -C . log'), null);
  assert.strictEqual(rw('echo x 2>&git -C . log'), null);
  assert.strictEqual(rw('echo x <& git -C . log'), null);
  assert.deepStrictEqual(rw('echo x >& git -C . log; git -C . log'), { command: 'echo x >& git -C . log; git log', applied: ['drop-git-C-cwd'] }, 'only the target is skipped; a later git call still rewrites');
  assert.deepStrictEqual(rw('ls |& git -C . log'), { command: 'ls |& git log', applied: ['drop-git-C-cwd'] }, '|& is a pipe, not a redirection');
});

test('drop-git-C-cwd leaves a git inside an array literal or a zsh glob group: only a subshell ( starts a command', () => {
  assert.strictEqual(rw('a=(git -C . log)'), null);
  assert.strictEqual(rw('a+=(git -C . log)'), null);
  assert.strictEqual(rw('echo x*(git -C . log)'), null, 'zsh glob group text');
  assert.deepStrictEqual(rw('(git -C . log)'), { command: '(git log)', applied: ['drop-git-C-cwd'] });
  assert.deepStrictEqual(rw('ls; ( (git -C . log) )'), { command: 'ls; ( (git log) )', applied: ['drop-git-C-cwd'] }, 'nested subshells at a command start');
});

test('AC2.2: drop-git-C-cwd declines a -C that is not the first option', () => {
  assert.strictEqual(posix('git --no-pager -C "/w/wt" log'), null);
  assert.strictEqual(rw('git -C . log; git --no-pager -C . log'), null, 'the whole command declines, not just that call');
  assert.deepStrictEqual(rw('git -C . log; git --no-pager a-C -C50 log'), { command: 'git log; git --no-pager a-C -C50 log', applied: ['drop-git-C-cwd'] }, 'a-C and -C50 are not -C words');
});

test('AC2.2: drop-git-C-cwd declines an operand holding $', () => {
  assert.strictEqual(posix('git -C "$W" log'), null);
});

test('AC2.3: drop-git-C-cwd declines /w/wt/.', () => {
  assert.strictEqual(posix('git -C "/w/wt/." log'), null);
});

test('AC2.3: drop-git-C-cwd declines /w/wt/sub/..', () => {
  assert.strictEqual(posix('git -C "/w/wt/sub/.." log'), null);
});

test('AC2.3: drop-git-C-cwd declines /W/WT', () => {
  assert.strictEqual(posix('git -C "/W/WT" log', '/w/wt', (p) => path.posix.resolve(p).toLowerCase()), null);
});

test('AC2.3: drop-git-C-cwd declines /w/wt-evil', () => {
  assert.strictEqual(posix('git -C "/w/wt-evil" log', '/w/wt', resolvesToCwd('/w/wt-evil')), null);
});

test('AC2.3: drop-git-C-cwd declines a symlink spelling that resolves to the cwd', () => {
  assert.strictEqual(posix('git -C "/w/link" log', '/w/wt', resolvesToCwd('/w/link')), null);
});

test('AC2.3: drop-git-C-cwd leaves the glued -C/w/wt alone', () => {
  assert.strictEqual(posix('git -C/w/wt log'), null);
});

test('drop-git-C-cwd declines when the cwd spelling does not resolve', () => {
  assert.strictEqual(posix('git -C "/w/wt" log', '/w/wt', () => null), null);
});

test('AC2.4: drop-git-C-cwd declines a write subcommand: git -C "/w/wt" commit -m x', () => {
  assert.strictEqual(posix('git -C "/w/wt" commit -m x'), null);
  assert.strictEqual(rw('git -C . commit -m x'), null);
  assert.strictEqual(rw('git -C . logx'), null, 'the subcommand word must end at a word break');
});

test('AC2.4: drop-git-C-cwd declines GIT_DIR=x git -C "/w/wt" log', () => {
  assert.strictEqual(posix('GIT_DIR=x git -C "/w/wt" log'), null);
  assert.strictEqual(posix('GIT_DIR=x; git -C "/w/wt" log'), null, 'GIT_ anywhere, also where git is the first command');
  assert.strictEqual(rw('GIT_DIR=x; git -C . log'), null);
});

test('drop-git-C-cwd declines a literal operand on a command that is not the first: z foo && git -C …', () => {
  assert.strictEqual(posix('z foo && git -C "/w/wt" log'), null);
});

test('drop-git-C-cwd declines a literal operand after a word zsh AUTO_CD could run: sub && git -C …', () => {
  assert.strictEqual(posix('sub && git -C "/w/wt" log'), null);
});

test('drop-git-C-cwd declines a literal operand after an earlier function call', () => {
  assert.strictEqual(posix('f() { :; }; f; git -C "/w/wt" log'), null);
  assert.strictEqual(posix('f() (true); f; git -C "/w/wt" log'), null, 'a function the command-word allowlist accepts');
});

test('drop-git-C-cwd needs no first-command test for git -C .', () => {
  assert.deepStrictEqual(rw('ls && git -C . log'), { command: 'ls && git log', applied: ['drop-git-C-cwd'] });
  assert.deepStrictEqual(rw('cd sub && git -C . log'), { command: 'cd sub && git log', applied: ['drop-git-C-cwd'] });
});

test('drop-git-C-cwd declines on a glob, ~ or backtick operand and on doubt', () => {
  assert.strictEqual(posix('git -C "/w/w*" log', '/w/w*'), null, 'a quoted glob character');
  assert.strictEqual(posix('git -C "/w/w?t" log', '/w/w?t'), null);
  assert.strictEqual(posix('git -C "/w/[w]t" log', '/w/[w]t'), null);
  assert.strictEqual(posix("git -C '/w/w`t' log", '/w/w`t'), null, 'a single-quoted backtick');
  assert.strictEqual(rw('git -C ~ log', { cwd: os.homedir() }), null, 'never ~');
  assert.strictEqual(rw('git -C . log `id`'), null, 'inDoubt: a backtick');
  assert.strictEqual(rw('git -C . log <<EOF\nx\nEOF'), null, 'inDoubt: a heredoc');
});

test('drop-git-C-cwd declines when one of two git -C calls does not qualify', () => {
  assert.strictEqual(rw('git -C . log; git -C "$W" log'), null); // Review Focus 2
});

test('drop-git-C-cwd declines when a command word is not plain (source, eval, a computed word)', () => {
  assert.strictEqual(rw('. ./f; git -C . log'), null);
  assert.strictEqual(rw('eval x; git -C . log'), null);
  assert.strictEqual(rw('$G -C . log'), null);
  assert.strictEqual(rw('$G x; git -C . log'), null);
});

test('drop-git-C-cwd leaves git reached through env, command, xargs or an assignment prefix', () => {
  assert.strictEqual(rw('env git -C . log'), null);
  assert.strictEqual(rw('command git -C . log'), null);
  assert.strictEqual(rw('xargs git -C . log'), null);
  assert.strictEqual(rw('X=1 git -C . log'), null);
  assert.strictEqual(rw('echo "$(git -C . log)"'), null, 'inside a substitution');
  assert.strictEqual(rw('echo $(git -C . log)'), null, 'inside an unquoted substitution');
});

test('drop-git-C-cwd skips a longer command word that starts with git', () => {
  assert.deepStrictEqual(rw('gitk -C . log; git -C . log'), { command: 'gitk -C . log; git log', applied: ['drop-git-C-cwd'] });
});

test('drop-git-C-cwd runs after the inlining and quoting rules', () => {
  assert.deepStrictEqual(posix('W=/w/wt; git -C "$W" log'), { command: 'W=/w/wt; git log', applied: ['inline-literal-assignment', 'drop-git-C-cwd'] });
  assert.deepStrictEqual(posix('git -C /w/my\\ wt log', '/w/my wt'), { command: 'git log', applied: ['quote-escaped-space', 'drop-git-C-cwd'] });
});

test('drop-git-C-cwd under path.win32 shares drop-redundant-cd residuals', () => {
  const fixture = win32().opts;
  const run = (command, opts = fixture) => rewriteForGuard({ command, ...opts });
  assert.deepStrictEqual(run('git -C "D:\\w\\cwd" log'), { command: 'git log', applied: ['drop-git-C-cwd'] });
  assert.deepStrictEqual(run('git -C "D:\\w\\cwd/" log'), { command: 'git log', applied: ['drop-git-C-cwd'] }, 'Review Focus 5: a trailing / is tolerated');
  assert.strictEqual(run('git -C "D:/w/cwd" log'), null, 'residual: a forward-slashed spelling');
  const msys = { ...fixture, deps: { ...fixture.deps, canonicalRealpath: (p) => path.win32.resolve(p.replace(/^\/([a-z])\//i, (m, d) => `${d.toUpperCase()}:\\`)) } };
  assert.strictEqual(run('git -C "/d/w/cwd" log', msys), null, 'residual: a /d/ spelling that resolves to the cwd');
  const folding = { ...fixture, deps: { ...fixture.deps, canonicalRealpath: (p) => path.win32.resolve(p).toLowerCase() } };
  assert.strictEqual(run('git -C "d:\\w\\cwd" log', folding), null, 'residual: a re-cased drive');
  assert.deepStrictEqual(run('git -C "D:\\w\\cwd" log', folding), { command: 'git log', applied: ['drop-git-C-cwd'] }, 'the exact spelling still drops under the folding realpath');
});

// quote-exit-status. Each decline pin names git and holds a `$?` word, and every check but the one
// its title names accepts it.
const quoted = (command, expected) => assert.deepStrictEqual(rw(command), { command: expected, applied: ['quote-exit-status'] });

test('AC3.1: quote-exit-status double-quotes exit=$? after a git command', () => {
  quoted('git merge-base --is-ancestor A B; echo exit=$?', 'git merge-base --is-ancestor A B; echo "exit=$?"');
  quoted('gh pr view 1 --json n > f; echo rc:$?', 'gh pr view 1 --json n > f; echo "rc:$?"');
});

test('quote-exit-status quotes every qualifying word, in any simple command', () => {
  quoted('git status 2>&1; echo a/b:c=$? && echo x.y-$? | cat', 'git status 2>&1; echo "a/b:c=$?" && echo "x.y-$?" | cat');
  quoted('git log; (echo r=$?)', 'git log; (echo "r=$?")');
  quoted("git log; echo 'a; b' r=$?", "git log; echo 'a; b' \"r=$?\"");
  quoted('git log; echo $(true) r=$?', 'git log; echo $(true) "r=$?"'); // the ( of $( starts no command
  quoted('git log; echo a=$?; X=$?', 'git log; echo "a=$?"; X=$?');
  assert.deepStrictEqual(rw('git -C . log; echo r=$?'), { command: 'git log; echo "r=$?"', applied: ['drop-git-C-cwd', 'quote-exit-status'] });
});

test('AC3.2: quote-exit-status leaves a bare $? alone', () => {
  assert.strictEqual(rw('git log -1; echo $?'), null);
});

test('AC3.2: quote-exit-status leaves an assignment X=$? alone', () => {
  assert.strictEqual(rw('git log -1; X=$?'), null);
});

for (const word of ['export', 'declare', 'local', 'readonly', 'typeset', 'env']) {
  test(`AC3.2: quote-exit-status leaves rc=$? after ${word} alone`, () => {
    assert.strictEqual(rw(`git log -1; ${word} rc=$?`), null);
  });
}

test('quote-exit-status leaves rc=$? after coproc alone: its command takes assignment prefixes', () => {
  assert.strictEqual(rw('git log -1; coproc rc=$? cat'), null);
});

test('AC3.2: quote-exit-status leaves a double-quoted "exit=$?" alone', () => {
  assert.strictEqual(rw('git log -1; echo "exit=$?"'), null);
});

test("AC3.2: quote-exit-status leaves a single-quoted 'exit=$?' alone", () => {
  assert.strictEqual(rw("git log -1; echo 'exit=$?'"), null);
});

test('AC3.2: quote-exit-status leaves a command that names no git or gh alone', () => {
  assert.strictEqual(rw('ls f; echo exit=$?'), null);
});

test('quote-exit-status leaves digit and .github text alone (whole-word git/gh only)', () => {
  assert.strictEqual(rw('echo digit; echo exit=$?'), null);
  assert.strictEqual(rw('ls .github; echo exit=$?'), null);
  assert.strictEqual(rw('ls gh-pages; echo exit=$?'), null);
});

test('AC3.2: quote-exit-status declines a command holding IFS', () => {
  assert.strictEqual(rw('IFS=: ; git log -1; echo exit=$?'), null);
});

test('quote-exit-status leaves a word starting with = alone (zsh =cmd)', () => {
  assert.strictEqual(rw('git log -1; echo =$?'), null);
});

test('quote-exit-status leaves a word inside $( … ) alone', () => {
  assert.strictEqual(rw('x=$(git log -1; echo r=$?)'), null);
  assert.strictEqual(rw('echo $(git log -1; echo r=$?)'), null);
});

test('quote-exit-status declines on doubt (a backtick)', () => {
  assert.strictEqual(rw('git log -1; echo exit=$? `id`'), null);
});

test('quote-exit-status leaves rc=$? after a keyword prefix alone: then "rc=$?" would be a command', () => {
  assert.strictEqual(rw('if git log; then rc=$?; fi'), null);
});

test('quote-exit-status leaves rc=$? after a reserved word alone', () => {
  assert.strictEqual(rw('git log; while false; do rc=$?; done'), null);
  assert.strictEqual(rw('git log; time rc=$?'), null);
});

test('quote-exit-status leaves rc=$? after { alone (not a plain command word)', () => {
  assert.strictEqual(rw('git log; { rc=$?; }'), null);
});

test('quote-exit-status leaves rc=$? after a { anywhere in its command alone: function g { rc=$?; }', () => {
  assert.strictEqual(rw('git log; function g { rc=$?; }'), null);
});

test('quote-exit-status leaves rc=$? after a redirection alone', () => {
  assert.strictEqual(rw('git log; 2>/dev/null rc=$?'), null);
});

test('quote-exit-status leaves rc=$? after a 2>&1 alone: the & of >& does not start a command', () => {
  assert.strictEqual(rw('git log; 2>&1 rc=$?'), null);
});

test('quote-exit-status leaves rc=$? after an array assignment alone: a ) ends the scan', () => {
  assert.strictEqual(rw('git log; arr=(x) rc=$?'), null);
});

test('quote-exit-status: a top-level ) ends the simple command, so the command word after an array assignment judges its arguments', () => {
  assert.deepStrictEqual(rw('git log; arr=(x) echo rc=$?'), { command: 'git log; arr=(x) echo "rc=$?"', applied: ['quote-exit-status'] });
});

test('quote-exit-status leaves rc=$? after X=$( … ) alone: an assignment prefix, not a command word', () => {
  assert.strictEqual(rw('X=$(git log) rc=$?'), null);
});

test('quote-exit-status leaves a word that does not start at a word break alone', () => {
  assert.strictEqual(rw('git log; echo $HOME/r=$?'), null);
});

test('quote-exit-status leaves a word that continues past $? alone', () => {
  assert.strictEqual(rw('git log; echo r=$?x'), null);
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
  for (const command of [undefined, null, 42, {}, '', '"', "'", '$(', '${', '\\', 'P=', 'cd', 'node -e', `${'$('.repeat(5000)}`, `P=/x; ${'"$P'.repeat(20000)}`, `${'a\\ '.repeat(50000)}`, `cd "${'\\a'.repeat(30000)}`, `cd "${'\\a'.repeat(30000)}" && ls`]) {
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
// The stubs print their arguments as JSON with shell builtins only: no node or other child per call.
// ct_print writes JSON.stringify of its arguments, one byte at a time (C-locale bytes; non-ASCII
// bytes pass through unchanged, as JSON.stringify leaves them). Every character is handled by a
// builtin: printf, case, parameter expansion, for and while.
const CT_CTRL = [...Array(32).keys()].filter((i) => i > 0 && ![8, 9, 10, 12, 13].includes(i)).map((i) => `'${String.fromCharCode(i)}'`).join('|');
const CT_PRINT = `ct_print() {
  printf '['
  ct_sep=
  for ct_a; do
    printf '%s"' "$ct_sep"
    ct_rest=$ct_a
    while [ -n "$ct_rest" ]; do
      ct_c=\${ct_rest%"\${ct_rest#?}"}
      ct_rest=\${ct_rest#?}
      case $ct_c in
        '\\') printf '%s' '\\\\' ;;
        '"') printf '%s' '\\"' ;;
        '
') printf '%s' '\\n' ;;
        '	') printf '%s' '\\t' ;;
        '\r') printf '%s' '\\r' ;;
        '\b') printf '%s' '\\b' ;;
        '\f') printf '%s' '\\f' ;;
        ${CT_CTRL}) printf '\\\\u%04x' "'$ct_c" ;;
        *) printf '%s' "$ct_c" ;;
      esac
    done
    printf '"'
    ct_sep=,
  done
  printf ']\\n'
}
`;
fs.writeFileSync(path.join(STUB, 'ls'), `#!/bin/sh\n${CT_PRINT}ct_print "$@"\n`, { mode: 0o755 });
fs.writeFileSync(path.join(STUB, 'node'), `#!/bin/sh\ncase "$1" in -e|-p|--eval|--print) exec "${process.execPath}" "$@";; esac\n${CT_PRINT}ct_print "$@"\n`, { mode: 0o755 });
// git stub: honours leading -C <dir> by cd-ing there, then prints [$PWD, ...argv] as JSON, so a
// dropped -C that changes the directory shows up in stdout.
fs.writeFileSync(path.join(STUB, 'git'), `#!/bin/sh\n${CT_PRINT}while [ "$1" = "-C" ]; do cd "$2" || exit 1; shift 2; done\nct_print "$PWD" "$@"\n`, { mode: 0o755 });
// AC2: each stub prints exactly JSON.stringify of its argument list (git: of [$PWD, ...args]),
// byte for byte, under the shebang's /bin/sh and under bash and dash by name when present.
const PRINT_ARGS = ['a b', 'q"q', 'back\\slash', 'line\nbreak', 'é ☃ 🙂', 'tab\there', 'ctl\x01x', '50%s%d', '', '\r\b\f', '\x01\x1f'];
test('each stub prints JSON.stringify of its argument list, byte for byte, under each interpreter', { skip: process.platform === 'win32' }, (t) => {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME || os.homedir() };
  for (const name of ['ls', 'node', 'git']) {
    const expected = `${JSON.stringify(name === 'git' ? [CWD, ...PRINT_ARGS] : PRINT_ARGS)}\n`;
    for (const interp of [null, 'bash', 'dash']) {
      if (interp && spawnSync(interp, ['-c', 'exit 0'], { windowsHide: true }).status !== 0) {
        t.diagnostic(`${interp} not present — skipped for ${name}`);
        continue;
      }
      const script = path.join(STUB, name);
      const r = interp ? spawnSync(interp, [script, ...PRINT_ARGS], { cwd: CWD, env, encoding: 'utf8', windowsHide: true })
        : spawnSync(script, PRINT_ARGS, { cwd: CWD, env, encoding: 'utf8', windowsHide: true });
      assert.strictEqual(r.status, 0, `${name} under ${interp || 'shebang'}: ${r.stderr}`);
      assert.strictEqual(r.stdout, expected, `${name} under ${interp || 'shebang'}`);
    }
  }
});

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
  { rule: 'drop-git-C-cwd', command: 'git -C . log --oneline -3' },
  // a/x.js exists, so zsh's nomatch error does not fail the original.
  { rule: 'drop-git-C-cwd', command: `git -C "${CWD}" grep -n x -- a/*.js` },
  { rule: 'drop-git-C-cwd', command: `git -C '${CWD}/' status --short` },
  { rule: 'quote-exit-status', command: 'git merge-base --is-ancestor A B; echo exit=$?' },
  { rule: 'quote-exit-status', command: 'git status; echo a/b:c=$?' },
];
const SHELLS = ['bash', 'zsh'].filter((sh) => spawnSync(sh, ['-c', 'exit 0'], { windowsHide: true }).status === 0);

// Every shell child in this file builds its argv here, so the precondition test's fixture-HOME pin covers all of them.
// --norc/--noprofile: bash sources ~/.bashrc under -c when stdin is a socket (see the precondition test).
function shellArgs(shell, command) {
  return shell === 'zsh' ? ['-f', '-c', command] : ['--norc', '--noprofile', '-c', command];
}

function runIn(shell, command, extraEnv, cwd = CWD) {
  // A's first character is not `-`: see the node-eval-separator divergence test below.
  const env = { PATH: `${STUB}${path.delimiter}${process.env.PATH}`, HOME: process.env.HOME || os.homedir(), A: 'a --flag -x', ...extraEnv };
  const r = spawnSync(shell, shellArgs(shell, command), { cwd, env, encoding: 'utf8', windowsHide: true });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

test('the node stub shadows the real node in every tested shell', { skip: process.platform === 'win32' || SHELLS.length === 0 }, () => {
  // Cause pin (#5881): Node's piped stdio is a socket, which bash takes for rshd and so sources ~/.bashrc
  // even under -c; on the macOS runner image that file prepends Homebrew dirs ahead of the stub. A fixture
  // HOME whose startup files prepend a marker dir makes the pin red on any host if runIn reads them.
  const rcHome = path.join(SANDBOX, 'rc-home');
  const marker = path.join(rcHome, 'marker-bin');
  fs.mkdirSync(marker, { recursive: true });
  for (const rc of ['.bashrc', '.bash_profile', '.profile', '.zshenv', '.zshrc']) {
    fs.writeFileSync(path.join(rcHome, rc), `PATH="${marker}${path.delimiter}$PATH"; export PATH\n`);
  }
  for (const shell of SHELLS) {
    const { stdout, status } = runIn(shell, 'command -v node', {});
    assert.strictEqual(status, 0, `${shell} could not resolve node`);
    assert.strictEqual(stdout.trim(), path.join(STUB, 'node'), `${shell} resolved node to ${stdout.trim()}, not the stub`);
    const seen = runIn(shell, 'echo "$PATH"', { HOME: rcHome }).stdout.trim();
    assert.ok(seen.startsWith(`${STUB}${path.delimiter}`), `${shell} rebuilt PATH ahead of the stub: ${seen}`);
    assert.ok(!seen.split(path.delimiter).includes(marker), `${shell} sourced a startup file from HOME: ${seen}`);
  }
});

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
fs.mkdirSync(path.join(CWD, 'a'));
fs.writeFileSync(path.join(CWD, 'a', 'x.js'), '');
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

// drop-git-C-cwd (AC4): a drop that changes where git runs prints a different $PWD, under both shells.
test('drop-git-C-cwd must-decline cases: the naive drop prints a different directory under bash and zsh', { skip: process.platform === 'win32' || !SHELLS.includes('bash') }, () => {
  fs.mkdirSync(path.join(CWD, 'sub'), { recursive: true });
  for (const { command, naive } of [
    { command: 'git -C sub log', naive: 'git log' },
    { command: `git -C "${CWD}/sub" log`, naive: 'git log' },
    { command: `cd sub && git -C "${CWD}" log`, naive: 'cd sub && git log' },
    // An array literal, not a git call: the naive drop changes the element count (4 → 2).
    { command: 'a=(git -C . log); echo ${#a[@]}', naive: 'a=(git log); echo ${#a[@]}' },
  ]) {
    assert.strictEqual(rw(command), null, command);
    for (const shell of SHELLS) {
      const original = runIn(shell, command, {});
      assert.strictEqual(original.status, 0, `${shell}: ${command}\n${original.stderr}`);
      assert.notStrictEqual(runIn(shell, naive, {}).stdout, original.stdout, `${shell}: the naive drop must differ for ${command}`);
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
    // The git rules: a stubbed git prints its directory and argv.
    'git -C . log', 'git -C . status; echo st=$?', `git -C "${CWD}" log`, 'git log; echo exit=$?',
  ],
  risky: [
    '. ./f', 'source ./f', 'eval "$(cat setp)"', 'trap "$(cat setp)" DEBUG', '$(echo .) ./f', '"$(echo .)" ./f', '$SRC ./f',
    '>| out . ./f', '>"$(echo o)" . ./f', 'x=1 . ./f', '2>/dev/null . ./f', 'command . ./f', 'builtin source ./f', '( . ./f; echo $P/s )',
    'echo "$(. ./f; echo $P/i)"', 'set -a', 'read -r P < setp',
    // Fix wave 3: reserved-word grammar positions and arithmetic contexts.
    'repeat 1 . ./f', 'repeat 1 do . ./f; done', 'if [[ -n x ]] . ./f', '[[ $(echo XP=5 | cut -c2-) -eq 5 ]]', '[[ $N -eq 5 ]]',
    'echo $[$(echo XP=5 | cut -c2-)]', '(( N ))', 'let N', 'echo $(( $N ))', 'case a in a) . ./f;; esac', '{ . ./f; }',
    'for i in a; do . ./f; done', 'while false; do :; done', 'g() { . ./f; }; g', 'shift $N',
    // The git rules' bail shapes.
    'git -C . -C sub log', 'cd sub && git -C . log', 'git -C "$P" log', 'export rc=$?', 'echo =$?', 'git log; rc=$?', 'if true; then rc=$?; fi', '{ rc=$?; }',
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
  const env = { PATH: `${STUB}${path.delimiter}${process.env.PATH}`, HOME: process.env.HOME || os.homedir(), SRC: '.', N: 'P=5' };
  for (let n = 0; n < 300; n += 1) {
    const command = drawCommand(rand);
    const out = rw(command);
    if (!out) {
      declined += 1;
      continue;
    }
    rewritten += 1;
    for (const shell of SHELLS) {
      const run = (c) => {
        const r = spawnSync(shell, shellArgs(shell, c), { cwd: CWD, env, encoding: 'utf8', windowsHide: true });
        // bash echoes the offending source line after a syntax error: that echo is the command text itself,
        // so it differs for any rewrite (the diagnostic above it, and the status, still must match).
        return { stdout: r.stdout, stderr: r.stderr.replace(/^(bash: -c: line \d+: )`.*'$/gm, '$1<source echo>'), status: r.status };
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

// ── drop-redundant-cd and a backslash in the cwd (#4292) ─────────────────────
// Inside "…" the shell keeps a backslash literal unless it precedes $, `, ", \ or a
// newline, so LEADING_CD admits exactly the other backslashes. A literal backslash
// is a POSIX-legal directory name character, which makes these checkable on this host.
const BACKSLASH_SKIP = { skip: process.platform === 'win32' || !SHELLS.includes('bash') };
const literalDir = (...parts) => {
  const dir = path.join(SANDBOX, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

test('drop-redundant-cd with a literal backslash in the cwd is argv-identical under bash and zsh', BACKSLASH_SKIP, () => {
  const dir = literalDir('bs', 'back\\slash');
  const command = `cd "${dir}" && pwd && ls x`;
  const out = rw(command, { cwd: dir });
  assert.deepStrictEqual(out && out.applied, ['drop-redundant-cd']);
  for (const shell of SHELLS) {
    const original = runIn(shell, command, {}, dir);
    assert.strictEqual(original.status, 0, `${shell}: ${original.stderr}`);
    assert.deepStrictEqual(runIn(shell, out.command, {}, dir), original, shell);
  }
});

test('drop-redundant-cd declines each backslash the shell would consume', BACKSLASH_SKIP, () => {
  const cases = [
    ['a\\$X', 'a$X'],
    ['a\\`X', 'a`X'],
    ['a\\"X', 'a"X'],
    ['a\\\\X', 'a\\X'],
    ['a\\\nX', 'aX'],
  ];
  cases.forEach(([tail, resolved], n) => {
    const dir = literalDir(`consumed${n}`, tail);
    const target = literalDir(`consumed${n}`, resolved);
    assert.strictEqual(rw(`cd "${dir}" && pwd`, { cwd: dir }), null, JSON.stringify(tail));
    for (const shell of SHELLS) {
      // Earned: the shell lands in the other directory, so the naive rewrite (a bare pwd) differs.
      const original = runIn(shell, `cd "${dir}" && pwd`, {}, dir);
      assert.strictEqual(original.stdout, `${target}\n`, `${shell}: ${JSON.stringify(tail)}`);
      assert.notStrictEqual(runIn(shell, 'pwd', {}, dir).stdout, original.stdout, `${shell}: ${JSON.stringify(tail)}`);
    }
  });
});

test('drop-redundant-cd declines an unquoted backslash target', BACKSLASH_SKIP, () => {
  const dir = literalDir('unq', 'ba\\c');
  const target = literalDir('unq', 'bac');
  // rw never runs a shell, so it gets the fully unquoted word, which reaches LEADING_CD's unquoted
  // branch; the shell half quotes the host prefix so a TMPDIR with a space or glob character
  // cannot break it, leaving the backslash tail an unquoted word part. The rw half uses a fixed
  // fs-free path (an injected realpath), so the host's TMPDIR cannot be what declines it: the
  // backslash-free twin drops, so the backslash is the only difference.
  const posixOpts = { cwd: '/w/ba\\c', pathImpl: path.posix, deps: { isLinkedWorktree: () => true, canonicalRealpath: (p) => path.posix.resolve(p) } };
  assert.strictEqual(rewriteForGuard({ command: 'cd /w/ba\\c && pwd', ...posixOpts }), null);
  assert.deepStrictEqual(rewriteForGuard({ command: 'cd /w/bac && pwd', ...posixOpts, cwd: '/w/bac' }), { command: 'pwd', applied: ['drop-redundant-cd'] }, 'the backslash-free twin drops');
  const shellCommand = `cd "${path.dirname(dir)}"/ba\\c && pwd`;
  for (const shell of SHELLS) {
    assert.strictEqual(runIn(shell, shellCommand, {}, dir).stdout, `${target}\n`, shell);
  }
});

test('property: a backslash-spelled double-quoted cd drops only when the shell lands in the same directory', { ...BACKSLASH_SKIP, timeout: 300000 }, (t) => {
  const rand = mulberry32(4292);
  const SEGMENTS = ['a', '\\b', '\\c', '\\$x', '\\`x', '\\\\y', '\\"q', '$x', ' s'];
  let rewritten = 0;
  let declined = 0;
  for (let n = 0; n < 150; n += 1) {
    const count = 1 + Math.floor(rand() * 3);
    let name = '';
    for (let k = 0; k < count; k += 1) name += SEGMENTS[Math.floor(rand() * SEGMENTS.length)];
    const dir = literalDir('prop', String(n), name);
    const command = `cd "${dir}" && pwd`;
    const out = rw(command, { cwd: dir });
    if (!out) {
      declined += 1;
      continue;
    }
    rewritten += 1;
    for (const shell of SHELLS) {
      assert.deepStrictEqual(runIn(shell, out.command, {}, dir), runIn(shell, command, {}, dir), `${shell}: ${JSON.stringify(command)}`);
    }
  }
  t.diagnostic(`rewritten=${rewritten} declined=${declined} shells=${SHELLS.join(',')}`);
  assert.ok(rewritten >= 30, `only ${rewritten} rewrites`);
  assert.ok(declined >= 30, `only ${declined} declines`);
});

// ── Write-target invariance (AC5) ────────────────────────────────────────────
// The write gate reads the command text, so a rewrite must leave gitTargets,
// fileWriteTargets and mkdirTargets exactly as they were.
const { gitTargets, fileWriteTargets, mkdirTargets } = require('../../../plugin/bin/lib/hooks/git-command');
const WRITE_CASES = [ // one writing command per rule that can write; families: the target lists it must fill
  { rule: 'drop-redundant-cd', families: ['git', 'write', 'mkdir'], command: `cd "${CWD}" && git commit -m x && mkdir d && echo a > f` },
  { rule: 'inline-literal-assignment', families: ['write'], command: 'P=/x; echo a > $P/f' },
  { rule: 'plugin-root-placeholder', families: ['write'], command: 'node "${CLAUDE_PLUGIN_ROOT}/bin/x.js" > out.txt' },
  { rule: 'node-eval-separator', families: ['write'], command: `node -e ${EVAL} "$A" > out.txt` },
  { rule: 'quote-escaped-space', families: ['write'], command: 'echo a > /a/b\\ c' },
  { rule: 'quote-exit-status', families: ['git', 'write'], command: 'git commit -m x; echo exit=$? > log.txt' },
];
function targetsOf(command) { return { git: gitTargets(command, CWD), write: fileWriteTargets(command, CWD), mkdir: mkdirTargets(command, CWD) }; }
function assertSameTargets(rewrite, cases = [...POSITIVE, ...WRITE_CASES]) {
  for (const { command } of cases) {
    const out = rewrite(command);
    assert.ok(out, command);
    assert.deepStrictEqual(targetsOf(out.command), targetsOf(command), command);
  }
}
test('AC5.1, AC5.2: every rewrite keeps gitTargets, fileWriteTargets and mkdirTargets equal', () => {
  for (const { rule, command, families } of WRITE_CASES) {
    assert.deepStrictEqual(rw(command).applied, [rule], command);
    const t = targetsOf(command);
    for (const family of families) assert.ok(t[family].length > 0, `vacuous: no ${family} targets for ${command}`);
  }
  assertSameTargets(rw);
});
test('AC5.3: assertSameTargets goes red for a stub rule that drops a real cd sub &&', () => {
  fs.mkdirSync(path.join(CWD, 'sub'), { recursive: true });
  const dropCase = 'cd sub && git commit -m x';
  const stub = (c) => (c === dropCase ? { command: c.replace('cd sub && ', ''), applied: ['stub'] } : rw(c));
  assert.throws(() => assertSameTargets(stub, [{ command: dropCase }, ...WRITE_CASES]),
    (e) => e instanceof assert.AssertionError && e.message.includes(dropCase));
});

// ── AC8: a rewrite carries no permission decision ────────────────────────────
const { guardRewriteOutput } = require('../../../plugin/bin/lib/hooks/guard-rewrite');
test('AC8.1: guardRewriteOutput carries no permissionDecision for either new rule', () => {
  for (const command of ['git -C . log', 'git status; echo exit=$?']) {
    const out = guardRewriteOutput({ tool_name: 'Bash', cwd: CWD, tool_input: { command, description: 'd' } }, (o) => rewriteForGuard({ ...o, deps: linked }));
    assert.ok(out, command);
    assert.deepStrictEqual(Object.keys(out).sort(), ['hookEventName', 'updatedInput']);
    assert.strictEqual(out.updatedInput.description, 'd');
    assert.notStrictEqual(out.updatedInput.command, command);
  }
});
test('AC8.2: guardRewriteOutput returns null outside a linked worktree for either new rule', () => {
  for (const command of ['git -C . log', 'git status; echo exit=$?']) {
    assert.strictEqual(guardRewriteOutput({ tool_name: 'Bash', cwd: CWD, tool_input: { command } }, (o) => rewriteForGuard(o)), null, command);
  }
});
