// tests/session-tmp-placeholder-quoting-conformance.test.js
//
// Conformance sweep for #3544: a `{tmp-*}` session-tmp placeholder (or another
// named path placeholder) inside a ```bash fence in plugin/skills/**/*.md must sit
// inside a quoted shell argument. The substituted path can carry a space (a Windows
// `C:\Users\First Last\...` tmp root), and an unquoted word-splits there.
//
// The scanner below is a small shell-quote tracker, not a shell parser: it follows
// quote / command-substitution / heredoc / comment state across the lines of one
// fence and classifies each target placeholder as quoted or unquoted. Every go-red
// control calls the same scanFence the live sweep calls.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const SKILLS_DIR = path.join(__dirname, '..', 'plugin', 'skills');

// Explicit non-{tmp-*} targets: path placeholders that resolve under the session tmp root.
const NAMED_TARGETS = ['{subject-dir}', '{frame-path}', '{frame-dir}', '{gif-path}', '{steps-json-path}', '{ctx-dir}'];
// A variable-name placeholder (`{tmp-var}=$(...)` in _shared/session-tmp-root.md), never a path.
const EXEMPT = ['{tmp-var}'];

// Measured scanCorpus().quoted after the #3544 edits; the sweep must keep seeing at least this many.
const QUOTED_FLOOR = 56;

function isTarget(name) {
  return (/^\{tmp-[a-z0-9-]+\}$/.test(name) && !EXEMPT.includes(name)) || NAMED_TARGETS.includes(name);
}

// Extract the bodies of ```bash / ```sh / ```shell fences. startLine is the 1-based
// line number of the fence's first body line. Other fence languages are skipped, but
// their bodies are consumed so a nested marker cannot desync the extractor.
function shellFences(text) {
  const all = text.split(/\r?\n/);
  const fences = [];
  for (let i = 0; i < all.length; i++) {
    const open = /^\s*(`{3,}|~{3,})\s*(.*?)\s*$/.exec(all[i]);
    if (!open) continue;
    const marker = open[1];
    const isShell = /^(bash|sh|shell)$/.test(open[2]);
    const closeRe = new RegExp('^\\s*' + (marker[0] === '`' ? '`' : '~') + '{' + marker.length + ',}\\s*$');
    let j = i + 1;
    while (j < all.length && !closeRe.test(all[j])) j++;
    if (isShell) fences.push({ startLine: i + 2, lines: all.slice(i + 1, j) });
    i = j;
  }
  return fences;
}

const PLACEHOLDER_RE = /\{[a-z][a-z0-9-]*\}/y;
const HEREDOC_RE = /<<-?\s*['"]?(\w+)['"]?/y;

// Scan one fence body. `line` in each offender is 0-based within `lines`.
function scanFence(lines) {
  const stack = ['cmd'];
  const offenders = [];
  let quoted = 0;
  let seen = 0;
  let pendingHeredocs = []; // delimiters armed on the current line
  let heredocTerm = null; // delimiter being skipped
  let directiveDepth = null; // brace depth while skipping a {Capitalised ...} directive

  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln];
    if (heredocTerm !== null) {
      if (line.trim() === heredocTerm) heredocTerm = pendingHeredocs.shift() ?? null;
      continue;
    }
    if (directiveDepth !== null || (stack.length === 1 && /^\{[A-Z]/.test(line.trim()))) {
      directiveDepth = directiveDepth ?? 0;
      for (const ch of line) {
        if (ch === '{') directiveDepth++;
        else if (ch === '}') directiveDepth--;
      }
      if (directiveDepth <= 0) directiveDepth = null;
      continue;
    }
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const top = stack[stack.length - 1];
      if (ch === '{') {
        PLACEHOLDER_RE.lastIndex = i;
        const m = PLACEHOLDER_RE.exec(line);
        if (m && isTarget(m[0])) {
          seen++;
          if (top === 'dq' || top === 'sq') quoted++;
          else offenders.push({ line: ln, name: m[0] });
        }
        if (m) { i += m[0].length - 1; continue; }
      }
      if (top === 'sq') {
        if (ch === "'") stack.pop();
        continue;
      }
      if (ch === '\\') { i++; continue; }
      if (top === 'dq') {
        if (ch === '"') stack.pop();
        else if (ch === '$' && line[i + 1] === '(') { stack.push('sub'); i++; }
        continue;
      }
      // cmd, sub or bt context
      if (ch === "'") stack.push('sq');
      else if (ch === '"') stack.push('dq');
      else if (ch === '$' && line[i + 1] === '(') { stack.push('sub'); i++; }
      else if (ch === '(') stack.push('sub');
      else if (ch === ')') { if (top === 'sub') stack.pop(); }
      else if (ch === '`') { if (top === 'bt') stack.pop(); else stack.push('bt'); }
      else if (ch === '#' && (i === 0 || /[\s;|&(]/.test(line[i - 1]))) break;
      else if (ch === '<' && line[i + 1] === '<') {
        if (line[i + 2] === '<') { i += 2; continue; } // here-string, no body
        HEREDOC_RE.lastIndex = i;
        const h = HEREDOC_RE.exec(line);
        if (h) { pendingHeredocs.push(h[1]); i += h[0].length - 1; }
        else i++;
      }
    }
    if (pendingHeredocs.length > 0) heredocTerm = pendingHeredocs.shift();
  }
  const balanced = stack.length === 1 && heredocTerm === null && directiveDepth === null;
  if (!balanced && seen > 0) offenders.push({ line: lines.length - 1, name: 'unbalanced' });
  return { offenders, quoted, balanced };
}

function listMarkdown(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listMarkdown(p));
    else if (entry.name.endsWith('.md')) out.push(p);
  }
  return out.sort();
}

function scanCorpus() {
  const result = { offenders: [], quoted: 0, fences: 0, targetFences: 0 };
  for (const file of listMarkdown(SKILLS_DIR)) {
    const rel = path.relative(SKILLS_DIR, file).split(path.sep).join('/');
    for (const fence of shellFences(readText(file))) {
      const r = scanFence(fence.lines);
      result.fences++;
      if (r.quoted > 0 || r.offenders.length > 0) result.targetFences++;
      result.quoted += r.quoted;
      for (const o of r.offenders) result.offenders.push({ file: rel, line: fence.startLine + o.line, name: o.name });
    }
  }
  return result;
}

// A substitution value that already carries its own quotes: `{tmp-x} = "$VAR"` or `{tmp-x}=$...`.
function preQuotedSubstitutions(text) {
  return text.match(/\{tmp-[a-z0-9-]+\}`?\s*=\s*`?"\$/g) || [];
}

// Frozen: record-queue-fetch.md lines 60-85 at 1d3934f5c (the read-fresh-or-fetch fence body).
const PRE_CHANGE_QUEUE_FETCH = `SESSION_ID="\${CLAUDE_CODE_SESSION_ID:-}"
TTL=$(node "\${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values record-snapshot-ttl-seconds)
SNAPSHOT=$(node -e "console.log(require('\${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record-snapshot.js').snapshotPath(process.env.CLAUDE_CODE_SESSION_ID) || '')")
if [ -n "$SNAPSHOT" ] && node -e "
  const { isFresh } = require('\${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record-snapshot.js');
  process.exit(isFresh(process.argv[1], Number(process.argv[2])) ? 0 : 1)
" "$SNAPSHOT" "$TTL"; then
  cp "$SNAPSHOT" {tmp-records-file}
else
  LIMIT=$(node "\${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values backlog-fetch-limit)
  export FETCH_LIMIT="$LIMIT"
  FIELDS=$(node -e "console.log(require('\${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record-snapshot.js').UNION_FIELDS)")
  gh issue list --state all --json "$FIELDS" --limit "$LIMIT" > {tmp-records-file}
  UNION_LEN=$(node -e "console.log(require('{tmp-records-file}').length)")
  if [ "$UNION_LEN" = "$LIMIT" ]; then
    echo "WARNING: the --state all snapshot hit backlog-fetch-limit ($LIMIT); open records were completed by a second open-only fetch — closed-record coverage is truncated at the $LIMIT newest" >&2
    gh issue list --state open --json "$FIELDS" --limit "$LIMIT" > {tmp-open-only-file}
    node -e "
      const { mergeOpenIntoUnion } = require('\${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record-snapshot.js');
      const union = require('{tmp-records-file}');
      const open = require('{tmp-open-only-file}');
      require('fs').writeFileSync('{tmp-records-file}', JSON.stringify(mergeOpenIntoUnion(union, open)));
    "
  fi
  [ -n "$SNAPSHOT" ] && cp {tmp-records-file} "$SNAPSHOT"
fi`;

// Frozen: the pre-quoted substitution at decomposition-mode.md:50 at 1d3934f5c.
const PRE_CHANGE_SPECIFY_SUBST = 'with {tmp-records-file} = "$SPECIFY_ALL_ISSUES"}';

// Frozen: walkthrough/SKILL.md line 72 at 1d3934f5c (the Step 4 encode fence line).
const PRE_CHANGE_WALKTHROUGH_ENCODE = `node "\${CLAUDE_PLUGIN_ROOT}/bin/walkthrough-encode.js" --frames {frame-dir} --out {gif-path} --delay-ms {delay-ms} --budget-mb {budget-mb} --steps-json {steps-json-path} --captions {name}.md --caption-title "{story description}"`;

// Frozen: review/review-effort-derivation.md line 20 at 1d3934f5c, trimmed of its list indent.
const PRE_CHANGE_CTX_REDIRECT = `gh issue view {n} --json labels > {ctx-dir}/record-{n}.json`;

const FOUR_PRE_CHANGE_OFFENDERS = ['{tmp-records-file}', '{tmp-records-file}', '{tmp-open-only-file}', '{tmp-records-file}'];

test('AC1.1: no target placeholder sits unquoted on a shell line in plugin/skills', () => {
  const r = scanCorpus();
  assert.ok(r.fences > 0 && r.targetFences > 0, 'empty haystack — the fence extractor found nothing');
  assert.ok(r.quoted >= QUOTED_FLOOR, `only ${r.quoted} quoted target sites found — the scanner stopped seeing them`);
  assert.deepStrictEqual(
    r.offenders,
    [],
    'unquoted target placeholder(s) in a shell fence:\n' + r.offenders.map((o) => `${o.file}:${o.line} ${o.name}`).join('\n'),
  );
});

test('AC1.1 go-red: the frozen pre-change record-queue-fetch.md fence reports its four unquoted uses', () => {
  const r = scanFence(PRE_CHANGE_QUEUE_FETCH.split('\n'));
  assert.deepStrictEqual(r.offenders.map((o) => o.name), FOUR_PRE_CHANGE_OFFENDERS);
  assert.strictEqual(r.quoted, 4);
  assert.strictEqual(r.balanced, true);
});

test('AC1.1 go-red: the frozen walkthrough encode line reports {frame-dir}, {gif-path}, {steps-json-path}', () => {
  const r = scanFence([PRE_CHANGE_WALKTHROUGH_ENCODE]);
  assert.deepStrictEqual(r.offenders.map((o) => o.name), ['{frame-dir}', '{gif-path}', '{steps-json-path}']);
  assert.strictEqual(r.balanced, true);
});

test('AC1.1 go-red: the frozen review redirect reports {ctx-dir}', () => {
  const r = scanFence([PRE_CHANGE_CTX_REDIRECT]);
  assert.deepStrictEqual(r.offenders.map((o) => o.name), ['{ctx-dir}']);
  assert.strictEqual(r.balanced, true);
});

test('AC1.1 go-red (CRLF): the same excerpt with \\r\\n line ends reports the same four', () => {
  const crlf = PRE_CHANGE_QUEUE_FETCH.replace(/\n/g, '\r\n');
  const fenced = '```bash\r\n' + crlf + '\r\n```\r\n';
  const fences = shellFences(fenced);
  assert.strictEqual(fences.length, 1);
  const r = scanFence(fences[0].lines);
  assert.deepStrictEqual(r.offenders.map((o) => o.name), FOUR_PRE_CHANGE_OFFENDERS);
  assert.strictEqual(r.quoted, 4);
  assert.strictEqual(r.balanced, true);
  const direct = scanFence(crlf.split(/\r?\n/));
  assert.deepStrictEqual(direct.offenders.map((o) => o.name), FOUR_PRE_CHANGE_OFFENDERS);
});

test('shellFences: indented and tilde fences open, other languages are consumed, startLine is 1-based', () => {
  const text = ['intro', '   ```bash', 'cp {tmp-a} x', '   ```', '```text', '```bash', '```', '~~~sh', 'ls', '~~~'].join('\n');
  const fences = shellFences(text);
  assert.deepStrictEqual(fences, [
    { startLine: 3, lines: ['cp {tmp-a} x'] },
    { startLine: 9, lines: ['ls'] },
  ]);
});

test('scanFence: a target after a node -e double-quoted body is unquoted, inside it is quoted', () => {
  const r = scanFence(['node -e "', "  require('{tmp-a}')", '" > {tmp-b}']);
  assert.deepStrictEqual(r.offenders.map((o) => o.name), ['{tmp-b}']);
  assert.strictEqual(r.quoted, 1);
});

test('scanFence: bare, double-quoted and single-quoted arguments', () => {
  const bare = scanFence(['cp {tmp-a} "$S"']);
  assert.deepStrictEqual(bare.offenders.map((o) => o.name), ['{tmp-a}']);
  const dq = scanFence(['cp "{tmp-a}" "$S"']);
  assert.deepStrictEqual(dq.offenders, []);
  assert.strictEqual(dq.quoted, 1);
  const sq = scanFence(["cp '{tmp-a}' x"]);
  assert.deepStrictEqual(sq.offenders, []);
  assert.strictEqual(sq.quoted, 1);
});

test('scanFence: a node -e nested inside "$(...)" keeps its placeholder quoted', () => {
  const r = scanFence(['X="$(node -e "console.log(require(\'{tmp-a}\'))")"']);
  assert.deepStrictEqual(r.offenders, []);
  assert.strictEqual(r.quoted, 1);
  assert.strictEqual(r.balanced, true);
});

test('scanFence: a comment line is ignored, apostrophe included', () => {
  const r = scanFence(["# don't touch {tmp-a}"]);
  assert.deepStrictEqual(r.offenders, []);
  assert.strictEqual(r.quoted, 0);
  assert.strictEqual(r.balanced, true);
});

test('scanFence: a heredoc body is skipped, the line after its terminator is scanned', () => {
  const r = scanFence(["node x.js <<'EOF'", "it's {tmp-a}", 'EOF', 'cp {tmp-b} y']);
  assert.deepStrictEqual(r.offenders.map((o) => o.name), ['{tmp-b}']);
  assert.strictEqual(r.balanced, true);
});

test('scanFence: a {Capitalised ...} substitution directive is skipped to its closing brace', () => {
  const r = scanFence(['{Session-scoped block, with {tmp-records-file} =', ' $VAR}', 'cp {tmp-b} y']);
  assert.deepStrictEqual(r.offenders.map((o) => o.name), ['{tmp-b}']);
});

test('scanFence: the exempt {tmp-var} variable-name placeholder is not a target', () => {
  const r = scanFence(['{tmp-var}=$(node -e "x")']);
  assert.deepStrictEqual(r.offenders, []);
  assert.strictEqual(r.quoted, 0);
});

test('scanFence: an unterminated quote with a target reports unbalanced', () => {
  const r = scanFence(['echo "it\'s {tmp-a}']);
  assert.strictEqual(r.balanced, false);
  assert.deepStrictEqual(r.offenders.map((o) => o.name), ['unbalanced']);
});

test('scanFence: non-target placeholders are ignored', () => {
  const r = scanFence(['echo {owner} {repo}']);
  assert.deepStrictEqual(r.offenders, []);
  assert.strictEqual(r.quoted, 0);
});

test('EXEMPT {tmp-var} is still a variable-name placeholder — shrink the list if this fails', () => {
  const text = readText(path.join(SKILLS_DIR, '_shared', 'session-tmp-root.md'));
  assert.match(text, /^\{tmp-var\}=/m);
});

test('AC1.1: no {tmp-*} substitution value is pre-quoted', () => {
  const hits = [];
  for (const file of listMarkdown(SKILLS_DIR)) {
    for (const m of preQuotedSubstitutions(readText(file))) hits.push(`${path.relative(SKILLS_DIR, file)}: ${m}`);
  }
  assert.deepStrictEqual(hits, [], 'a {tmp-*} substitution value carries its own quotes; the fences quote the placeholder themselves');
});

test('AC1.1 go-red: preQuotedSubstitutions flags the frozen pre-change specify substitution', () => {
  assert.strictEqual(preQuotedSubstitutions(PRE_CHANGE_SPECIFY_SUBST).length, 1);
});
