'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readText } = require('../helpers/read-skill');
const { DETECTORS, UNDETECTED_ROWS, detectShapes } = require('../../tools/guard-refusals/shapes');
const { shellFences, malformedFences } = require('../../tools/guard-refusals/fences');

// #4028: tools/guard-refusals/shapes.js holds one static detector per refused
// row of scratch-worktree.md section 7. Each detector names the row it covers by
// that row's exact Example cell, so a §7 edit that changes, adds or drops a
// refused row breaks this suite until the detector list follows it.

const ROOT = path.join(__dirname, '..', '..');
const DOC = readText(path.join(ROOT, 'plugin', 'skills', '_shared', 'scratch-worktree.md'));
const FIXTURE = readText(path.join(ROOT, 'tests', 'fixtures', 'guard-refusals', 'banned-shapes.md'));

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
}

function section7Rows() {
  const start = DOC.indexOf('## 7. Shell constraint');
  assert.notStrictEqual(start, -1, '## 7. Shell constraint heading missing');
  const lines = DOC.slice(start).split('\n');
  const head = lines.findIndex((l) => l.trim().startsWith('| Shape'));
  assert.notStrictEqual(head, -1, 'no table header in section 7');
  const rows = [];
  for (let i = head + 2; i < lines.length && lines[i].startsWith('|'); i++) {
    const cells = splitRow(lines[i]);
    rows.push({ example: cells[1], verdict: cells[2] });
  }
  return rows;
}

// Each backtick span of an Example cell, with the table's `\|` escape undone,
// plus all spans joined by newlines (a multi-call shape such as "heredoc then
// gh --body-file" only shows up across spans).
function candidates(example) {
  const spans = [...example.matchAll(/`([^`]+)`/g)].map((m) => m[1].replace(/\\\|/g, '|'));
  return spans.length > 1 ? [...spans, spans.join('\n')] : spans;
}

// The refused rows no bound detector flags, and the refused rows bound to
// nothing and not excused by UNDETECTED_ROWS. Parameterised on the detector list
// so the go-red control below can run it against a broken copy.
function unflaggedRows(detectors, undetected) {
  const out = [];
  for (const row of section7Rows().filter((r) => r.verdict === 'refused')) {
    const bound = detectors.filter((d) => d.row === row.example);
    if (bound.length === 0) {
      if (!Object.hasOwn(undetected, row.example)) out.push(`unbound: ${row.example}`);
      continue;
    }
    const fired = bound.some((d) => candidates(row.example).some((c) => d.test(c)));
    if (!fired) out.push(`not flagged by ${bound.map((d) => d.id).join('/')}: ${row.example}`);
  }
  return out;
}

test('section 7 yields the refused and passes rows this suite sweeps', () => {
  const rows = section7Rows();
  assert.ok(rows.filter((r) => r.verdict === 'refused').length >= 17, 'refused rows went missing from the parse');
  assert.ok(rows.filter((r) => r.verdict === 'passes').length >= 18, 'passes rows went missing from the parse');
  for (const r of rows) assert.ok(candidates(r.example).length > 0, `no backtick span in Example: ${r.example}`);
});

test('every refused §7 row is flagged by its bound detector or listed in UNDETECTED_ROWS', () => {
  assert.deepStrictEqual(unflaggedRows(DETECTORS, UNDETECTED_ROWS), []);
});

test('the bound-row check goes red when one detector stops firing (go-red control)', () => {
  const victim = DETECTORS.find((d) => d.id === 'sed-var-path');
  assert.ok(victim, 'sed-var-path detector missing');
  const broken = DETECTORS.map((d) => (d === victim ? { ...d, test: () => false } : d));
  assert.deepStrictEqual(unflaggedRows(broken, UNDETECTED_ROWS), [`not flagged by sed-var-path: ${victim.row}`]);
});

test('no detector fires on any passes-row example', () => {
  const hits = [];
  for (const row of section7Rows().filter((r) => r.verdict === 'passes')) {
    for (const c of candidates(row.example)) {
      const ids = detectShapes(c, { placeholders: false });
      if (ids.length) hits.push(`${ids.join(',')} on ${c}`);
    }
  }
  assert.deepStrictEqual(hits, []);
});

test('every DETECTORS[].row and UNDETECTED_ROWS key still names a live refused row (shrink the list when it goes stale)', () => {
  const live = new Set(section7Rows().filter((r) => r.verdict === 'refused').map((r) => r.example));
  const stale = [...DETECTORS.map((d) => d.row), ...Object.keys(UNDETECTED_ROWS)].filter((ex) => !live.has(ex));
  assert.deepStrictEqual(stale, []);
});

test('normalizePlaceholders makes a ${CLAUDE_PLUGIN_ROOT} script operand clean and leaves $B flagged', () => {
  assert.deepStrictEqual(detectShapes('node "${CLAUDE_PLUGIN_ROOT}/bin/x.js"'), []);
  assert.deepStrictEqual(detectShapes('node "$CLAUDE_PLUGIN_ROOT/bin/x.js"'), []);
  assert.ok(detectShapes('node "${CLAUDE_PLUGIN_ROOT}/bin/x.js"', { placeholders: false }).includes('node-var-script'));
  assert.ok(detectShapes('B=$(pwd)\nnode "$B/x.js"').includes('node-var-script'));
});

test('AC2.1: a fixture holding each banned shape fails the scan', () => {
  // An unclosed fence would swallow every fence after it.
  assert.deepStrictEqual(malformedFences(FIXTURE), []);
  const lines = FIXTURE.split('\n');
  const fences = shellFences(FIXTURE);
  const seen = new Set();
  for (const f of fences) {
    // The id is the nearest `## ` heading above the fence.
    let id = null;
    for (let i = f.line - 2; i >= 0 && id === null; i--) {
      if (lines[i].startsWith('## ')) id = lines[i].slice(3).trim();
    }
    assert.ok(id, `fence at line ${f.line} has no id heading`);
    assert.deepStrictEqual(detectShapes(f.body), [id], `fence at line ${f.line}`);
    seen.add(id);
  }
  assert.deepStrictEqual([...seen].sort(), [...new Set(DETECTORS.map((d) => d.id))].sort());
});

test('node-eval-computed-arg: -- separator clears it', () => {
  assert.deepStrictEqual(detectShapes(`node -e 'x' "$A"`), ['node-eval-computed-arg']);
  assert.deepStrictEqual(detectShapes(`node -e 'x' -- "$A"`), []);
});

test('keyword detectors ignore a single-quoted span', () => {
  assert.deepStrictEqual(detectShapes(`echo 'eval complete'`), []);
  assert.deepStrictEqual(detectShapes(`echo 'evaluate'`), []);
  assert.deepStrictEqual(detectShapes('echo evaluate completed'), []);
});

// An apostrophe in a `#` comment or inside "…" is not a quote. Pairing quotes
// with a regex let it pair with a later quote and hide the commands between.
const DONT = "# Don't run this from main\n";

test('an apostrophe in a # comment does not hide an eval', () => {
  assert.deepStrictEqual(detectShapes(`${DONT}eval "$(node /abs/env.js)"\necho 'done'`), ['eval-token']);
});

test('an apostrophe inside double quotes does not hide a complete token', () => {
  assert.deepStrictEqual(detectShapes(`gh pr comment 1 --body "don't"; echo complete; echo 'x'`), ['complete-token']);
});

test('an apostrophe in a # comment does not hide a sed variable path', () => {
  assert.deepStrictEqual(detectShapes(`${DONT}sed -n '1,2p' "$P/README.md"\necho 'x'`), ['sed-var-path']);
});

test('an apostrophe in a # comment does not hide a chained heredoc write', () => {
  assert.deepStrictEqual(detectShapes(`${DONT}cd /wt && cat > f <<'EOF'\nx\nEOF`), ['chained-heredoc-write']);
});

test('an apostrophe in a # comment does not hide a redirect to a variable path', () => {
  // The live-corpus shape (init/bootstrap/step-14-cloud-routine-parity.md):
  // a comment apostrophe above a quoted git mention and a "$VAR" redirect.
  const text = `# isn't a repo root\nREPO=$(find "$R" -name .git)\nclaude plugin list --json > "$OUT" || echo '[]'`;
  assert.deepStrictEqual(detectShapes(text), ['git-text-redirect-var']);
});

test('a # comment that mentions a banned shape is not flagged', () => {
  assert.deepStrictEqual(detectShapes('# never use eval here\necho done'), []);
  assert.deepStrictEqual(detectShapes("echo done # don't eval, it is complete"), []);
  assert.deepStrictEqual(detectShapes('# cd /wt && cat > f <<EOF'), []);
});

test('chained-heredoc-write: &> and &>> count as a file redirect', () => {
  assert.deepStrictEqual(detectShapes('cd /wt && cat <<EOF &>f\nx\nEOF'), ['chained-heredoc-write']);
  assert.deepStrictEqual(detectShapes('cd /wt && cat <<EOF &>>f\nx\nEOF'), ['chained-heredoc-write']);
});

// A heredoc body is data, never shell text: an apostrophe in it must not open a
// quote that hides the commands after the delimiter, and a banned word in it is
// not a command.
test('an apostrophe in a quoted-delimiter heredoc body does not hide a later eval', () => {
  assert.deepStrictEqual(detectShapes(`cat > /abs/f <<'EOF'\nDon't\nEOF\neval "$x"`), ['eval-token']);
});

test('an apostrophe in an unquoted-delimiter heredoc body does not hide a later complete token', () => {
  assert.deepStrictEqual(detectShapes(`cat <<EOF\nit's\nEOF\necho complete`), ['complete-token']);
});

test('a banned word inside a heredoc body is not flagged', () => {
  assert.deepStrictEqual(detectShapes(`node <<'EOF'\n// eval is banned\nEOF`), []);
  assert.deepStrictEqual(detectShapes(`cat > /abs/f <<"EOF"\necho complete\nEOF`), []);
});

test('a <<- heredoc ends at a tab-indented delimiter line, and shell text resumes after it', () => {
  assert.deepStrictEqual(detectShapes(`cat <<-EOF\n\tit's\n\tEOF\necho complete`), ['complete-token']);
  assert.deepStrictEqual(detectShapes(`cat <<-EOF\n\techo complete\n\tEOF`), []);
});

test('an arithmetic shift is not a heredoc operator', () => {
  assert.deepStrictEqual(detectShapes('X=$(( 1 << n ))\neval "$x"'), ['eval-token']);
  assert.deepStrictEqual(detectShapes('(( y = 1 << n ))\neval "$x"'), ['eval-token']);
  // A later line equal to the "delimiter" would otherwise close a fake body
  // that hides the eval; this case needs the arithmetic rule on its own.
  assert.deepStrictEqual(detectShapes('X=$(( 1 << n ))\neval "$x"\nn'), ['eval-token']);
  assert.deepStrictEqual(detectShapes('(( y = 1 << n ))\neval "$x"\nn'), ['eval-token']);
});

test('a heredoc whose delimiter line never appears is lexed as shell, not a body to end of text', () => {
  assert.deepStrictEqual(detectShapes('cat <<EOF\necho complete'), ['complete-token']);
});

test('a heredoc operator inside quotes or a comment opens no body', () => {
  assert.deepStrictEqual(detectShapes(`echo "a <<EOF b"\necho complete`), ['complete-token']);
  assert.deepStrictEqual(detectShapes(`# cat <<EOF\necho complete`), ['complete-token']);
});

// The guard refuses a shell word whose value after quote removal is exactly
// `complete` (live: `echo complete` and `grep -n "complete" f` refused; `echo
// "task complete"` and `node -e "console.log('complete probe')"` passed).
test('complete-token: a whole shell word, bare or quoted, is flagged', () => {
  assert.deepStrictEqual(detectShapes('grep -n "complete" README.md'), ['complete-token']);
  assert.deepStrictEqual(detectShapes(`grep -n 'complete' README.md`), ['complete-token']);
  assert.deepStrictEqual(detectShapes('echo co"mplete"'), ['complete-token']);
});

test('complete-token: a word that merely contains complete is not flagged', () => {
  assert.deepStrictEqual(detectShapes('echo "task complete"'), []);
  assert.deepStrictEqual(detectShapes(`node -e "console.log('complete probe')"`), []);
  assert.deepStrictEqual(detectShapes(`node -e "if (s === 'complete') process.exit(0)"`), []);
});

// Live-probed 2026-10-24 (#4028, guard-isolated worktree session): a github.com
// mention in a # comment, in a single-quoted node -e script, or in a heredoc body
// fed to node, beside a runtime variable, each ran. Only a github.com outside
// those spans is the refused shape.
test('github-url-with-var: a github.com in a comment, a single-quoted span or a heredoc body is not flagged', () => {
  assert.deepStrictEqual(detectShapes('# see github.com/o/r\necho "$HOME"'), []);
  assert.deepStrictEqual(detectShapes(`node -e 'const u = "https://github.com/o/r"' -- "$HOME"`), []);
  assert.deepStrictEqual(detectShapes(`node - "$HOME" <<'EOF'\nconsole.log("https://github.com/o/r")\nEOF`), []);
  // The "git" in github.com plus the "$OUT" redirect is the git-text row's shape too.
  assert.deepStrictEqual(detectShapes('gh pr view 1 --repo "github.com/o/r" --json url > "$OUT"'), ['github-url-with-var', 'git-text-redirect-var']);
});

test('a heredoc on its own line after a command-substitution line passes; chained with && it is refused', () => {
  assert.deepStrictEqual(detectShapes(`A=$(pwd)\ncat > /abs/f <<'EOF'\nx\nEOF`), []);
  assert.deepStrictEqual(detectShapes(`A=$(pwd) && cat > /abs/f <<'EOF'\nx\nEOF`), ['chained-heredoc-write']);
});

// #4028 Task 6b: shapes live-verified 2026-10-24 (Claude Code 2.1.302, a
// guard-isolated worktree session). Each positive case is a probed command;
// RES stands for the probes' literal session-tmp-resolve.js assignment line.
const RES = 'A="$(node "/lit/bin/session-tmp-resolve.js" --value probe-a.txt)"';

test('gh-computed-input: gh given a runtime variable as an argument or as stdin, in a multi-command call', () => {
  assert.deepStrictEqual(detectShapes(`${RES}\ngh issue view "$A" --repo o/r --json number`), ['gh-computed-input']);
  assert.deepStrictEqual(detectShapes(`${RES}\ngh issue view 4028 --repo o/r --json number < "$A"`), ['gh-computed-input']);
});

test('gh-computed-input: gh output redirected to the variable, a single gh call, and gh text in a comment or heredoc body are not flagged', () => {
  // Live: `gh … > "$A"` after the assignment passes (§7), and a single `gh … "$HOME/x"` call ran.
  assert.deepStrictEqual(detectShapes(`${RES}\ngh issue list --repo o/r --json number > "$A"\necho done`), []);
  assert.deepStrictEqual(detectShapes('gh pr comment 1 --body-file "$HOME/x.md"'), []);
  // Detector choice (lexer): a comment and a heredoc body are data, not a gh command.
  assert.deepStrictEqual(detectShapes(`# gh issue view "$A"\n${RES}`), []);
  assert.deepStrictEqual(detectShapes(`cat > /abs/f.md <<'EOF'\ngh issue view "$A"\nEOF\necho "$HOME"`), []);
});

test('git-text-redirect-var: the text git anywhere, any case, in a comment or heredoc body too, plus a redirect to a variable path', () => {
  assert.deepStrictEqual(detectShapes(`${RES}\necho digit > "$A"`), ['git-text-redirect-var']);
  assert.deepStrictEqual(detectShapes('echo DIGIT > "$TMPDIR/x"'), ['git-text-redirect-var']);
  assert.deepStrictEqual(detectShapes('# digit\necho x > "$TMPDIR/x"'), ['git-text-redirect-var']);
  assert.deepStrictEqual(detectShapes(`cat > "$TMPDIR/x" <<'EOF'\nthe git index\nEOF`), ['git-text-redirect-var']);
  assert.deepStrictEqual(detectShapes('ls -d .git > "$TMPDIR/x"'), ['git-text-redirect-var']);
});

test('git-text-redirect-var: no git text, a literal redirect target, or a > inside quotes is not flagged', () => {
  assert.deepStrictEqual(detectShapes('echo x > "$TMPDIR/x"'), []);
  assert.deepStrictEqual(detectShapes('echo digit "$HOME" > /literal/x'), []);
  // Detector choice (lexer): a > inside double quotes is not a redirect.
  assert.deepStrictEqual(detectShapes('echo "digit > $HOME"'), []);
});

test('git-var-operand: git given a runtime-variable operand, computed in the call or not', () => {
  assert.deepStrictEqual(detectShapes(`W="$(node -e 'console.log(process.cwd())')"\ngit -C "$W" status --short`), ['git-var-operand']);
  assert.deepStrictEqual(detectShapes('git -C "$PWD" status --short'), ['git-var-operand']);
  assert.deepStrictEqual(detectShapes('R=$(pwd); git -C "$R" rev-parse --show-toplevel'), ['git-var-operand']);
});

test('git-var-operand: a literal operand, git in a comment, and a git output redirect are not flagged by it', () => {
  assert.deepStrictEqual(detectShapes('git status --short'), []);
  assert.deepStrictEqual(detectShapes('# git -C "$W" status\necho ok'), []);
  // The redirect target is the git-text row's shape, not an operand.
  assert.deepStrictEqual(detectShapes('git log -1 > "$TMPDIR/x"'), ['git-text-redirect-var']);
});

test('node-git-text: node script text naming the whole word git, as -e or a heredoc body', () => {
  assert.deepStrictEqual(detectShapes(`node -e 'console.log("git log is a word here")'`), ['node-git-text']);
  assert.deepStrictEqual(detectShapes(`node -e "console.log('the git index')"`), ['node-git-text']);
  assert.deepStrictEqual(detectShapes(`node - <<'EOF'\n// the git index\nEOF`), ['node-git-text']);
  assert.deepStrictEqual(detectShapes(`node /abs/bin/node-eval-file.js a <<NODE_EVAL_EOF\nconst a = ['git'];\nNODE_EVAL_EOF`), ['node-git-text']);
});

test('node-git-text: digit, a git-z.js path, and git outside the node script are not flagged', () => {
  assert.deepStrictEqual(detectShapes(`node -e 'console.log("digit")'`), []);
  assert.deepStrictEqual(detectShapes(`node -e "require('/lit/bin/lib/git-z.js')"`), []);
  // §7: piping git output into node -e passes.
  assert.deepStrictEqual(detectShapes(`git log -1 | node -e 'process.stdin.pipe(process.stdout)'`), []);
});

// Live 2026-10-24 (#4028): the guard resolves a literally assigned variable and
// a literal-list loop variable statically. `L=1; gh … --limit "$L"`, `for n in
// 4028; do gh issue view "$n" …; done`, `W="/abs/wt"; git -C "$W" status
// --short` and `A=/abs/p.txt; echo digit > "$A"` all ran.
test('a literally assigned or literal-loop variable is not runtime-computed', () => {
  assert.deepStrictEqual(detectShapes('L=1; gh issue list --repo o/r --limit "$L" --json number'), []);
  assert.deepStrictEqual(detectShapes('for n in 4028; do gh issue view "$n" --repo o/r --json number; done'), []);
  assert.deepStrictEqual(detectShapes('W="/abs/wt"; git -C "$W" status --short'), []);
  assert.deepStrictEqual(detectShapes('A=/abs/p.txt; echo digit > "$A"'), []);
});

test('a variable assigned from $(…), read, a loop over $(…), or a later computed reassignment stays runtime-computed', () => {
  assert.deepStrictEqual(detectShapes('L=1; L=$(cat /abs/n); gh issue list --limit "$L"'), ['gh-computed-input']);
  assert.deepStrictEqual(detectShapes('gh label list | while read -r OLD; do gh label delete "$OLD" --yes; done'), ['gh-computed-input']);
  assert.deepStrictEqual(detectShapes('for n in $(cat /abs/ns); do gh issue view "$n"; done'), ['gh-computed-input']);
  assert.deepStrictEqual(detectShapes('W="$HOME/wt"; git -C "$W" status'), ['git-var-operand']);
});

// Live 2026-10-25 (#4028 review): `git -C "$(pwd)" status --short` was refused;
// a single `gh issue view "$(echo 4028)" …` call, and an unquoted `$L` after
// `L=1`, ran; a glob-loop variable fed to gh was refused ("runs gh with a value
// computed at runtime (the variable f)").
test('git-var-operand: a $(…), backtick or positional operand is computed', () => {
  assert.deepStrictEqual(detectShapes('git -C "$(pwd)" status --short'), ['git-var-operand']);
  assert.deepStrictEqual(detectShapes('git -C "`pwd`" status --short'), ['git-var-operand']);
  assert.deepStrictEqual(detectShapes('git -C "$1" status --short'), ['git-var-operand']);
  assert.deepStrictEqual(detectShapes('git -C "/abs/wt" status --short'), []);
});

test('a glob-loop variable is computed; a literal-list loop and an unquoted literal name are not', () => {
  assert.deepStrictEqual(
    detectShapes('for f in *.json; do gh issue view 4028 --repo thn-inc/claude-tweaks --json number --jq "\\"$f\\""; done'),
    ['gh-computed-input'],
  );
  assert.deepStrictEqual(detectShapes('for f in a?.json; do gh issue view "$f"; done'), ['gh-computed-input']);
  assert.deepStrictEqual(detectShapes('for n in 4028; do gh issue view "$n" --repo o/r --json number; done'), []);
  assert.deepStrictEqual(detectShapes('L=1\ngh issue list --repo o/r --limit $L --json number'), []);
  assert.deepStrictEqual(detectShapes('gh issue view "$(echo 4028)" --repo o/r --json number'), []);
});

// #4028 final review: a command word with an absolute or relative path prefix
// runs the same program, so the detectors keyed on it still fire.
test('a path-prefixed command word is still the command (absolute and relative node, git, gh, sed)', () => {
  assert.deepStrictEqual(detectShapes('/usr/local/bin/node "$X/y.js"'), ['node-var-script']);
  assert.deepStrictEqual(detectShapes('./bin/node "$X/y.js"'), ['node-var-script']);
  assert.deepStrictEqual(detectShapes(`/usr/local/bin/node -e 'x' "$A"`), ['node-eval-computed-arg']);
  assert.deepStrictEqual(detectShapes('/usr/bin/git -C "$W" status --short'), ['git-var-operand']);
  assert.deepStrictEqual(detectShapes('echo "$(/usr/bin/git rev-parse HEAD)"'), ['git-in-substitution']);
  assert.deepStrictEqual(detectShapes('X=$(pwd)\n/opt/homebrew/bin/gh issue view "$X"'), ['gh-computed-input']);
  assert.deepStrictEqual(detectShapes(`/usr/bin/sed -n '1,2p' "$P/README.md"`), ['sed-var-path']);
  // A longer name ending in the word is not the word.
  assert.deepStrictEqual(detectShapes('/abs/bin/node-eval-file.js "$X"'), []);
  // Env assignments before a prefixed command word keep it in command position.
  assert.deepStrictEqual(detectShapes('FOO=1 /usr/local/bin/node "$X/y.js"'), ['node-var-script']);
});

test('a path ending in a command word is not that command outside command position', () => {
  assert.deepStrictEqual(detectShapes('cat dir/node "$X/y"'), []);
  assert.deepStrictEqual(detectShapes(`ls /opt/bin/sed "$P/README.md"`), []);
  assert.deepStrictEqual(detectShapes('echo a && cat ./bin/node "$X/y"'), []);
});

// An ANSI-C `$'…'` span closes at its last apostrophe: `\'` inside it is
// escaped. Unmodelled, the escaped apostrophe closed the span early and the
// real closing one opened a quote that hid every later command.
test('an ANSI-C $\'…\' span with an escaped apostrophe does not hide a later eval', () => {
  assert.deepStrictEqual(detectShapes(`echo $'it\\'s' && eval "$x"`), ['eval-token']);
  assert.deepStrictEqual(detectShapes(`echo $'a\\\\' && eval "$x"`), ['eval-token']);
});

test('an ANSI-C $\'…\' span is literal text, like a single-quoted one', () => {
  assert.deepStrictEqual(detectShapes(`echo $'don\\'t eval'`), []);
  // Inside "…" a $' is not ANSI-C quoting.
  assert.deepStrictEqual(detectShapes(`echo "it$'s" && eval "$x"`), ['eval-token']);
});

// Live 2026-10-24/25 (#4028): `P="/abs path"` then `node "$P/x.js"`, and
// `export P=/abs && node "$P/x.js"`, ran; `Q=/abs/nospace && node $Q/hello.js`
// (unquoted) was refused. The older detectors exempt a double-quoted reference
// to a literally assigned name, never an unquoted one.
test('node-var-script: a quoted reference to a literally assigned name is not flagged; an unquoted one is', () => {
  assert.deepStrictEqual(detectShapes('P="/abs path"\nnode "$P/x.js"'), []);
  assert.deepStrictEqual(detectShapes('export P=/abs && node "$P/x.js"'), []);
  assert.deepStrictEqual(detectShapes('P=/abs; node "${P}/x.js"'), []);
  assert.deepStrictEqual(detectShapes('Q=/abs/nospace && node $Q/hello.js'), ['node-var-script']);
  // Order does not matter (live 2026-10-25, #4028 re-review): `node "$P/ct-probe-4028-nonexistent.js";
  // P=/tmp` ran, with P empty at the reference; the same call with no assignment was refused.
  assert.deepStrictEqual(detectShapes('node "$P/x.js"; P=/lit'), []);
  assert.deepStrictEqual(detectShapes('node "$P/x.js"'), ['node-var-script']);
});

test('sed-var-path: a quoted reference to a literally assigned name is not flagged; an unquoted one is', () => {
  assert.deepStrictEqual(detectShapes(`P=/abs/dir; sed -n '1,2p' "$P/README.md"`), []);
  assert.deepStrictEqual(detectShapes(`P=/abs/dir; sed -n '1,2p' $P/README.md`), ['sed-var-path']);
});

test('node-eval-computed-arg: a quoted reference to a literally assigned name is not flagged; an unquoted one is', () => {
  assert.deepStrictEqual(detectShapes(`A=/abs/a.txt; node -e 'x' "$A"`), []);
  assert.deepStrictEqual(detectShapes(`A=/abs/a.txt; node -e 'x' $A`), ['node-eval-computed-arg']);
});

test('github-url-with-var: a quoted reference to a literally assigned name is not flagged; an unquoted one is', () => {
  assert.deepStrictEqual(detectShapes('U=https://github.com/o/r; echo "$U"'), []);
  assert.deepStrictEqual(detectShapes('U=https://github.com/o/r; echo $U'), ['github-url-with-var']);
});
