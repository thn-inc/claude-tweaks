'use strict';

// #2564: queue-pull-script.md/next-ranking.md's multi-line `node -e "..."` blocks were
// migrated to the `node bin/node-eval-file.js <<DELIM ... DELIM` heredoc form (the Windows
// Git Bash fix — see node-eval-file.js's own header comment for the root cause). That
// migration has no dedicated syntax check: tests/node-e-snippet-syntax.test.js's live sweep
// only extracts `node -e "..."` / `node -e '...'` invocations, which the migrated blocks no
// longer are, so a body-mangling edit to one of these heredocs (a stray unescaped `"`, a
// dropped delimiter line, an unbalanced brace) would pass `npm test` silently. This is the
// same live-corpus conformance idea generalized to the new call shape: extract every
// `node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" ... <<DELIM ... DELIM` heredoc body
// embedded in a ```bash fence under plugin/skills/**/*.md, and pin zero syntax errors.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, 'plugin', 'skills');

function findMarkdownFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findMarkdownFiles(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

// `\r?\n` (not a bare `\n`) for the same reason node-e-snippet-syntax.test.js's
// BASH_FENCE_RE uses it: a CRLF-normalized checkout (core.autocrlf=true, no
// .gitattributes) would otherwise silently match zero fences.
const BASH_FENCE_RE = /```bash\r?\n([\s\S]*?)```/g;

// Matches a `node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" <args...> <<DELIM` call
// (any trailing args/redirects on that same line — see queue-pull-script.md's `> file`,
// `2>err`, and pipe-chained call sites) through to the matching unindented delimiter line.
// The delimiter is deliberately unquoted at every real call site (so `${CLAUDE_PLUGIN_ROOT}`
// inside the body still expands) — this regex still accepts an optionally quoted delimiter
// so a future quoted-delimiter call site (no shell expansion needed in its body) is not
// silently skipped by the sweep.
const NODE_EVAL_FILE_HEREDOC_RE =
  /node\s+"\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/node-eval-file\.js"[^\n]*<<(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\r?\n([\s\S]*?)\r?\n\2\b/g;

function extractNodeEvalFileHeredocs(markdown) {
  const bodies = [];
  const fenceRe = new RegExp(BASH_FENCE_RE.source, 'g');
  let fence;
  while ((fence = fenceRe.exec(markdown)) !== null) {
    const block = fence[1];
    const heredocRe = new RegExp(NODE_EVAL_FILE_HEREDOC_RE.source, 'g');
    let m;
    while ((m = heredocRe.exec(block)) !== null) bodies.push(m[3]);
  }
  return bodies;
}

// `${CLAUDE_PLUGIN_ROOT}` always appears inside a single-quoted `require(...)` string at
// every real call site, so it's already valid JS text as written and needs no
// substitution — but neutralize it anyway (mirrors node-e-snippet-syntax.test.js's own
// `substituteShellPlaceholders`) so a future body that happens to splice it in bare (outside
// a string) still gets a syntactically valid placeholder rather than a spurious failure this
// sweep didn't intend to report.
function substitutePluginRoot(script) {
  return script.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, 'CLAUDE_PLUGIN_ROOT_PLACEHOLDER');
}

function checkSyntax(script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-node-eval-heredoc-syntax-'));
  const file = path.join(dir, 'snippet.js');
  fs.writeFileSync(file, substitutePluginRoot(script));
  try {
    execFileSync('node', ['--check', file], { stdio: 'pipe' });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.stderr ? err.stderr.toString() : String(err) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- Proof the check can go red (synthetic fixtures, per skill-prose-conformance-tests'
// go-red guidance) ---

test('extractNodeEvalFileHeredocs: finds a heredoc body feeding node-eval-file.js inside a bash fence', () => {
  const md = [
    '```bash',
    'node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$SOME_ARG" <<NODE_EVAL_EOF',
    '  console.log(1);',
    'NODE_EVAL_EOF',
    '```',
  ].join('\n');
  const bodies = extractNodeEvalFileHeredocs(md);
  assert.strictEqual(bodies.length, 1);
  assert.match(bodies[0], /console\.log\(1\)/);
});

test('extractNodeEvalFileHeredocs: finds a heredoc whose delimiter line is chained into a following command (queue-pull-script.md\'s `<<DELIM && mv ...` / `<<DELIM | while ...` shape)', () => {
  const md = [
    '```bash',
    'node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$X" > "$OUT" <<NODE_EVAL_EOF && mv "$OUT" "$FINAL"',
    '  console.log(2);',
    'NODE_EVAL_EOF',
    '```',
  ].join('\n');
  const bodies = extractNodeEvalFileHeredocs(md);
  assert.strictEqual(bodies.length, 1);
  assert.match(bodies[0], /console\.log\(2\)/);
});

test('extractNodeEvalFileHeredocs: ignores an ordinary node -e block (not the node-eval-file.js shape)', () => {
  const md = ['```bash', 'node -e "console.log(1)"', '```'].join('\n');
  assert.deepStrictEqual(extractNodeEvalFileHeredocs(md), []);
});

test('extractNodeEvalFileHeredocs: ignores text outside a ```bash fence', () => {
  const md = 'Some prose mentioning `node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" <<EOF` inline, not fenced.';
  assert.deepStrictEqual(extractNodeEvalFileHeredocs(md), []);
});

test('checkSyntax: a syntactically invalid heredoc body is caught (planted fixture)', () => {
  const result = checkSyntax('const x = ;');
  assert.strictEqual(result.ok, false);
  assert.match(result.message, /SyntaxError/);
});

test('checkSyntax: negative control — the same shape with a valid expression passes', () => {
  const result = checkSyntax('const x = 1;');
  assert.strictEqual(result.ok, true);
});

test('substitutePluginRoot: a bare (unquoted) ${CLAUDE_PLUGIN_ROOT} splice still checks as valid JS', () => {
  const result = checkSyntax('const root = ${CLAUDE_PLUGIN_ROOT};');
  assert.strictEqual(result.ok, true);
});

test('checkSyntax: the literal ${CLAUDE_PLUGIN_ROOT} text inside a single-quoted require() is already valid JS unmodified', () => {
  const result = checkSyntax("const { run } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/x.js');");
  assert.strictEqual(result.ok, true);
});

// --- Live-corpus sweep ---

test('every node-eval-file.js heredoc body embedded in a plugin/skills/**/*.md bash fence is syntactically valid', () => {
  const files = findMarkdownFiles(SKILLS_DIR);
  assert.ok(files.length > 0, 'sanity: the skills sweep must find files to check');

  let bodyCount = 0;
  const failures = [];
  for (const file of files) {
    const markdown = fs.readFileSync(file, 'utf8');
    const bodies = extractNodeEvalFileHeredocs(markdown);
    bodyCount += bodies.length;
    for (const [index, body] of bodies.entries()) {
      const result = checkSyntax(body);
      if (!result.ok) {
        failures.push(`${path.relative(ROOT, file)} (heredoc #${index}): ${result.message.split('\n')[0]}`);
      }
    }
  }

  assert.ok(bodyCount > 0, 'sanity: the skills sweep must find at least one node-eval-file.js heredoc (queue-pull-script.md/next-ranking.md, #2564)');
  assert.deepStrictEqual(failures, [], `node-eval-file.js heredoc syntax error(s):\n${failures.join('\n')}`);
});

// #2564 AC5: a failure in the migrated logic must surface loudly, not as a silent no-op.
// This is a structural guard against regressing to the exact shape that broke: every
// multi-line `node -e "..."` block (the form that silently no-ops on Windows Git Bash) is
// gone from the two files this record's AC1/AC4 target.
test('queue-pull-script.md and next-ranking.md contain no multi-line `node -e "` blocks (the #2564 failure shape)', () => {
  for (const rel of ['plugin/skills/dispatch/queue-pull-script.md', 'plugin/skills/dispatch/next-ranking.md']) {
    const markdown = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    // A multi-line block's opening line is exactly `node -e "` (optionally indented) with
    // nothing but the opening quote before the newline -- a single-line invocation like
    // `node -e "console.log(1)" "$X"` never matches this, by design (single-line args are
    // not the Windows failure mode this record fixes — see node-eval-file.js's header).
    const multilineOpen = /^[ \t]*node -e "\r?$/m;
    assert.doesNotMatch(markdown, multilineOpen, `${rel} still has a multi-line node -e "..." block`);
  }
});
test('node-eval-file.js header and the adopted-branch snippet state the unquoted NODE_EVAL_EOF convention (#3102)', () => {
  const header = fs.readFileSync(path.join(ROOT, 'plugin', 'bin', 'node-eval-file.js'), 'utf8')
    .replace(/\r\n/g, '\n').split("'use strict';")[0];
  assert.match(header, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/node-eval-file\.js" <args\.\.\.> <<NODE_EVAL_EOF/,
    'header must show the unquoted <<NODE_EVAL_EOF call-site form');
  assert.ok(!header.includes("<<'EOF'"), "header still documents the retired quoted <<'EOF' form");
  assert.match(header, /no `\$` other than `\$\{CLAUDE_PLUGIN_ROOT\}`/, 'header must state the no-other-$ rule');
  assert.ok(header.includes('\\`'), 'header must say a literal backtick is written escaped');
  const snippet = fs.readFileSync(path.join(SKILLS_DIR, 'build', 'adopted-branch-collision-check.md'), 'utf8')
    .replace(/\r\n/g, '\n');
  const beforeFence = snippet.slice(0, snippet.indexOf('<<NODE_EVAL_EOF'));
  const lastPara = beforeFence.slice(beforeFence.lastIndexOf('\n\n'));
  // The paragraph already cited the header for the Windows `node -e` no-op before #3102, so pin the new sentence itself.
  assert.match(lastPara, /keep the body free of any other `\$` or unescaped backtick, per `bin\/node-eval-file\.js`'s header/,
    'adopted-branch snippet must cite the header rule beside its fence');
});
