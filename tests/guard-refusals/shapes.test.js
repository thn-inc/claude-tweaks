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
  assert.deepStrictEqual(detectShapes(text), ['json-git-redirect-var']);
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
  assert.deepStrictEqual(detectShapes('gh pr view 1 --repo "github.com/o/r" --json url > "$OUT"'), ['github-url-with-var']);
});

test('a heredoc on its own line after a command-substitution line passes; chained with && it is refused', () => {
  assert.deepStrictEqual(detectShapes(`A=$(pwd)\ncat > /abs/f <<'EOF'\nx\nEOF`), []);
  assert.deepStrictEqual(detectShapes(`A=$(pwd) && cat > /abs/f <<'EOF'\nx\nEOF`), ['chained-heredoc-write']);
});
