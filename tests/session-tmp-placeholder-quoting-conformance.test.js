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
//
// The same scanner also sweeps single-line inline-code spans in prose whose text opens with a
// command word (`gh issue edit {n} --body-file "{live-json}"`): inlineShellSpans blanks the fences
// first, then reads spans from what remains. Outside that mechanical sweep, quoted anyway:
//   - spans that wrap across a newline (_shared/pr-checklist-refresh.md's `node …revise-pr-summary.js
//     … --body-file "{body-file}"`);
//   - spans opening with a flag, not a command word (`--summary-file "{file}"` there);
//   - `{file}` and `{path}` generally. They name repo paths at most sites, so they are not global
//     targets; `{path}` in build/plan-review.md is pinned through FILE_TARGETS, `{file}` in
//     pr-checklist-refresh.md is quoted but unpinned (its only spans are the two above), and `{path}`
//     in tidy/release-note-repair.md is the local-files record file (not session-tmp) and stays bare.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const SKILLS_DIR = path.join(__dirname, '..', 'plugin', 'skills');

// Explicit non-{tmp-*} targets: path placeholders that resolve under the session tmp root.
const NAMED_TARGETS = [
  '{subject-dir}', '{frame-path}', '{frame-dir}', '{gif-path}', '{steps-json-path}', '{ctx-dir}',
  '{tmp}', '{path-A}', '{path-B}', '{path-F}', '{path-U}',
  // tidy/release-note-repair.md and _shared/pr-checklist-refresh.md name these as session-tmp files.
  '{live-json}', '{line-file}', '{repaired-body}', '{after-json}', '{snapshot}', '{body-file}',
];
// A variable-name placeholder (`{tmp-var}=$(...)` in _shared/session-tmp-root.md), never a path.
const EXEMPT = ['{tmp-var}'];

// Measured scanCorpus().quoted after the #3544 edits; the sweep must keep seeing at least this many.
const QUOTED_FLOOR = 63;
// Measured scanSpansCorpus().quoted after the #3544 edits (inline-code shell spans).
const SPAN_QUOTED_FLOOR = 17;

// Generic names are never global targets (see the header); a file whose own `{path}` is a session-tmp
// path lists it here, scoped to that file's inline spans. `{path}` in build/plan-review.md is the
// literal path printed for PLAN_REVIEW_BODY.
const FILE_TARGETS = { 'build/plan-review.md': ['{path}'] };

function isTarget(name, extra = []) {
  return (/^\{tmp-[a-z0-9-]+\}$/.test(name) && !EXEMPT.includes(name)) || NAMED_TARGETS.includes(name) || extra.includes(name);
}

// Extract the bodies of ```bash / ```sh / ```shell fences. startLine is the 1-based
// line number of the fence's first body line. Other fence languages are skipped, but
// their bodies are consumed so a nested marker cannot desync the extractor. A fence
// opened inside a blockquote (`> ```bash`) has its `>` prefix stripped from the opener,
// the closer and every body line.
const QUOTE_PREFIX_RE = /^\s*(?:>\s?)+/;
// Every fenced block of any language: { open, close, lang, strip } with 0-based line indexes
// (close === all.length for an unterminated fence).
function fenceBlocks(all) {
  const blocks = [];
  for (let i = 0; i < all.length; i++) {
    const inBlockquote = QUOTE_PREFIX_RE.test(all[i]);
    const strip = (l) => (inBlockquote ? l.replace(QUOTE_PREFIX_RE, '') : l);
    const open = /^\s*(`{3,}|~{3,})\s*(.*?)\s*$/.exec(strip(all[i]));
    if (!open) continue;
    const marker = open[1];
    const closeRe = new RegExp('^\\s*' + (marker[0] === '`' ? '`' : '~') + '{' + marker.length + ',}\\s*$');
    let j = i + 1;
    while (j < all.length && !closeRe.test(strip(all[j]))) j++;
    blocks.push({ open: i, close: j, lang: open[2], strip });
    i = j;
  }
  return blocks;
}
function shellFences(text) {
  const all = text.split(/\r?\n/);
  return fenceBlocks(all)
    .filter((b) => /^(bash|sh|shell)$/.test(b.lang))
    .map((b) => ({ startLine: b.open + 2, lines: all.slice(b.open + 1, b.close).map(b.strip) }));
}

const PLACEHOLDER_RE = /\{[a-z][A-Za-z0-9-]*\}/y;
const HEREDOC_RE = /<<-?\s*['"]?([^\s'"<>;|&]+)['"]?/y;

function mentionsTarget(line, extra) {
  return (line.match(/\{[a-z][A-Za-z0-9-]*\}/g) || []).some((name) => isTarget(name, extra));
}

// Scan one fence body (or one inline span). `extra` adds file-scoped target names.
// `line` in each offender is 0-based within `lines`.
function scanFence(lines, extra = []) {
  const stack = ['cmd'];
  const offenders = [];
  let quoted = 0;
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
        if (m && isTarget(m[0], extra)) {
          // Shell-level quoting only: a JS '…' inside `node -e "…"` never pushes a frame (its
          // dq top counts), while a bare shell '…' never expands $VAR / substituted prose.
          if (top === 'dq') quoted++;
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
  // An unbalanced fence that mentions a target anywhere (even in text the tracker skipped) cannot be trusted.
  if (!balanced && lines.some((l) => mentionsTarget(l, extra))) offenders.push({ line: lines.length - 1, name: 'unbalanced' });
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

// A span is a shell command, not prose naming a placeholder, when its text opens with a command word.
const COMMAND_WORD_RE = /^(?:gh|node|git|cp|mv|cat|rm|npx|bash|sh)\s/;

// Single-line inline-code spans that are shell commands. Fences are blanked first (fences,
// then spans over the remainder), so a span-regex backtick never pairs with a fence marker
// and a command inside a fence is counted once, by shellFences. `line` is 1-based.
function inlineShellSpans(text) {
  const all = text.split(/\r?\n/);
  const rest = all.slice();
  for (const b of fenceBlocks(all)) rest.fill('', b.open, Math.min(b.close + 1, all.length));
  const spans = [];
  rest.forEach((l, i) => {
    for (const m of l.matchAll(/`([^`\n]+)`/g)) {
      if (COMMAND_WORD_RE.test(m[1])) spans.push({ line: i + 1, text: m[1] });
    }
  });
  return spans;
}

// Same sweep as scanCorpus, over the inline shell spans instead of the fences.
function scanSpansCorpus() {
  const result = { offenders: [], quoted: 0, spans: 0, targetSpans: 0 };
  for (const file of listMarkdown(SKILLS_DIR)) {
    const rel = path.relative(SKILLS_DIR, file).split(path.sep).join('/');
    for (const span of inlineShellSpans(readText(file))) {
      const r = scanFence([span.text], FILE_TARGETS[rel]);
      result.spans++;
      if (r.quoted > 0 || r.offenders.length > 0) result.targetSpans++;
      result.quoted += r.quoted;
      for (const o of r.offenders) result.offenders.push({ file: rel, line: span.line, name: o.name });
    }
  }
  return result;
}

// A substitution value that already carries its own quotes: `{tmp-x} = "$VAR"`, `{tmp-x} = '$VAR'`
// or `{tmp-x} = "/abs/path"` — for every target placeholder, not only {tmp-*}.
function preQuotedSubstitutions(text) {
  const hits = [];
  for (const m of text.matchAll(/(\{[a-z][A-Za-z0-9-]*\})`?\s*=\s*`?['"]/g)) {
    if (isTarget(m[1])) hits.push(m[0]);
  }
  return hits;
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

// Frozen: review/step3-lens-dispatch.md lines 91-93 at 1d3934f5c (a blockquoted bash fence).
const PRE_CHANGE_LENS_DISPATCH_FENCE = `> \`\`\`bash
> node "\${CLAUDE_PLUGIN_ROOT}/bin/review-coordination.js" categorise-reproduction {path-A} {path-B}
> \`\`\``;

// Frozen: build/dispatch.md lines 22-26 at 1d3934f5c (the carry-forward stage-item fence).
const PRE_CHANGE_BUILD_DISPATCH_FENCE = `\`\`\`bash
node "\${CLAUDE_PLUGIN_ROOT}/bin/stage-item.js" --run "$PIPELINE_RUN_DIR" --id "sdd-ruling-{N}" --file {tmp}.md --allocate --ledger "{ledger path}" --label "SDD ruling" --item 'SDD ruling — {one-liner}: ratify or reverse at the Review Console'
node "\${CLAUDE_PLUGIN_ROOT}/bin/stage-item.js" --run "$PIPELINE_RUN_DIR" --id "build-deviation-{N}" --file {tmp}.md --allocate --ledger "{ledger path}" --label "SDD ruling" --item 'SDD ruling — {one-liner}: apply or decline at the Review Console'
\`\`\``;

// Frozen: review/step3-debate-and-refutation.md lines 16-18 at 1d3934f5c (an indented bash fence).
const PRE_CHANGE_DETECT_OVERLAP_FENCE = `   \`\`\`bash
   node "\${CLAUDE_PLUGIN_ROOT}/bin/review-coordination.js" detect-overlap {path-F}
   \`\`\``;

// Frozen: build/plan-review.md line 103 at 1d3934f5c (prose carrying the `gh issue comment` span).
const PRE_CHANGE_PLAN_REVIEW_COMMENT = `5. **Comment on the record.** Post the spec amendment as one comment on the record. Run \`node "\${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" PLAN_REVIEW_BODY=plan-review-amendment-{n}.md\` once and take the literal path it prints as \`PLAN_REVIEW_BODY="<path>"\` — the path inside the quotes (a shell variable would not survive into a later Bash call, and the Write tool needs a literal path). Write the body to that path with the Write tool — first line \`<!-- plan-review-amendment -->\`, then the clarification lines as committed — and pass the same literal path to \`gh issue comment {n} --body-file {path}\`, or post the body with \`add_issue_comment\` per \`_shared/github-write-transport.md\` when \`gh\` is absent. The record's history carries the amendment this way. Under \`work-backend: local-files\` there is no GitHub issue to comment on: skip the comment — the committed \`## Plan Review Clarifications\` section is the trail.`;

// Frozen: tidy/release-note-repair.md lines 70-73 at 1d3934f5c (the Auto path step 2 spans).
const PRE_CHANGE_RELEASE_NOTE_REPAIR = `   - \`github-issues\`: \`gh issue view {n} --json body,labels,state > {live-json}\` (gh absent: the
     \`issue_read\` row of \`_shared/github-write-transport.md\`, saved as the same three fields), then
     \`node "\${CLAUDE_PLUGIN_ROOT}/bin/release-note-repair.js" repair --driver github-issues --ref {n} --live-json {live-json} --expect-sha {sha} --line-file {line-file} --out {repaired-body} {dest}\`.
   - \`local-files\`: \`node "\${CLAUDE_PLUGIN_ROOT}/bin/release-note-repair.js" repair --driver local-files --ref {id} --record-file {path} --expect-sha {sha} --line-file {line-file} {dest}\`,`;

const FOUR_PRE_CHANGE_OFFENDERS =['{tmp-records-file}', '{tmp-records-file}', '{tmp-open-only-file}', '{tmp-records-file}'];

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

test('AC1.1: no target placeholder sits unquoted in an inline shell span in plugin/skills', () => {
  const r = scanSpansCorpus();
  assert.ok(r.spans > 0 && r.targetSpans > 0, 'empty haystack — the span extractor found nothing');
  assert.deepStrictEqual(
    r.offenders,
    [],
    'unquoted target placeholder(s) in an inline shell span:\n' + r.offenders.map((o) => `${o.file}:${o.line} ${o.name}`).join('\n'),
  );
  assert.ok(r.quoted >= SPAN_QUOTED_FLOOR, `only ${r.quoted} quoted target sites found in spans — the scanner stopped seeing them`);
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

test('AC1.1 go-red: the frozen blockquoted lens-dispatch fence reports {path-A} and {path-B}', () => {
  const fences = shellFences(PRE_CHANGE_LENS_DISPATCH_FENCE);
  assert.strictEqual(fences.length, 1, 'the blockquoted bash fence must open');
  const r = scanFence(fences[0].lines);
  assert.deepStrictEqual(r.offenders.map((o) => o.name), ['{path-A}', '{path-B}']);
  assert.strictEqual(r.balanced, true);
});

test('AC1.1 go-red: the frozen build/dispatch.md fence reports both {tmp} uses', () => {
  const fences = shellFences(PRE_CHANGE_BUILD_DISPATCH_FENCE);
  assert.strictEqual(fences.length, 1);
  const r = scanFence(fences[0].lines);
  assert.deepStrictEqual(r.offenders.map((o) => [o.line, o.name]), [[0, '{tmp}'], [1, '{tmp}']]);
  assert.strictEqual(r.balanced, true);
});

test('AC1.1 go-red: the frozen detect-overlap fence reports {path-F}', () => {
  const fences = shellFences(PRE_CHANGE_DETECT_OVERLAP_FENCE);
  assert.strictEqual(fences.length, 1);
  assert.deepStrictEqual(scanFence(fences[0].lines).offenders.map((o) => o.name), ['{path-F}']);
});

// The live span sweep's own path: inlineShellSpans over the text, then scanFence per span.
function scanSpansOf(text, extra) {
  const r = { offenders: [], quoted: 0 };
  for (const span of inlineShellSpans(text)) {
    const s = scanFence([span.text], extra);
    r.quoted += s.quoted;
    for (const o of s.offenders) r.offenders.push({ line: span.line, name: o.name });
  }
  return r;
}

test('AC1.1 go-red: the frozen plan-review.md comment span reports its unquoted {path}', () => {
  const r = scanSpansOf(PRE_CHANGE_PLAN_REVIEW_COMMENT, FILE_TARGETS['build/plan-review.md']);
  assert.deepStrictEqual(r.offenders, [{ line: 1, name: '{path}' }]);
  // {path} is scoped to that file: the same span is clean of offenders without the scope.
  assert.deepStrictEqual(scanSpansOf(PRE_CHANGE_PLAN_REVIEW_COMMENT).offenders, []);
});

test('AC1.1 go-red: the frozen release-note-repair.md Auto path spans report their unquoted session-tmp uses', () => {
  const r = scanSpansOf(PRE_CHANGE_RELEASE_NOTE_REPAIR);
  assert.deepStrictEqual(r.offenders, [
    { line: 1, name: '{live-json}' },
    { line: 3, name: '{live-json}' },
    { line: 3, name: '{line-file}' },
    { line: 3, name: '{repaired-body}' },
    { line: 4, name: '{line-file}' },
  ]);
  assert.strictEqual(r.quoted, 0);
});

test('inlineShellSpans: a bare placeholder mention (no command word) is not scanned', () => {
  assert.deepStrictEqual(inlineShellSpans('the file `{live-json}` and `{line-file}`, then `--out {repaired-body}`'), []);
  assert.deepStrictEqual(inlineShellSpans('run `gh issue view {n} > {live-json}` now'), [{ line: 1, text: 'gh issue view {n} > {live-json}' }]);
});

test('inlineShellSpans: a span inside a fenced block is not counted again; spans around the fence are', () => {
  const text = ['see `cp {tmp-a} x`', '```bash', 'cp {tmp-b} `cp {tmp-c} y`', '```', '~~~text', '`cp {tmp-d} z`', '~~~', 'and `git add {tmp-e}`'].join('\n');
  assert.deepStrictEqual(inlineShellSpans(text), [
    { line: 1, text: 'cp {tmp-a} x' },
    { line: 8, text: 'git add {tmp-e}' },
  ]);
});

test('inlineShellSpans: a fence marker is not paired with a span backtick; wrapped spans are outside the sweep', () => {
  const text = ['```bash', 'ls', '```', 'tail `rm {tmp-a}` end', 'wrap `node x.js', '{tmp-b}` here'].join('\n');
  assert.deepStrictEqual(inlineShellSpans(text), [{ line: 4, text: 'rm {tmp-a}' }]);
});

test('AC1.1: the fence shapes the sweep once missed are now scanned (blockquoted, labelled-later)', () => {
  const lens = shellFences(readText(path.join(SKILLS_DIR, 'review', 'step3-lens-dispatch.md')));
  assert.ok(lens.some((f) => f.lines.some((l) => l.includes('categorise-reproduction "{path-A}" "{path-B}"'))), 'blockquoted categorise-reproduction fence not scanned');
  const shape = shellFences(readText(path.join(SKILLS_DIR, 'specify', 'next-mode-shape.md')));
  assert.ok(shape.some((f) => f.lines.some((l) => l.includes('--body-file "{tmp}"'))), 'next-mode-shape.md comment fence is not labelled bash');
});

test('shellFences: a blockquoted fence opens, closes and strips its > prefix; startLine is its first body line', () => {
  const text = ['> intro', '> ```bash', '> cp {tmp-a} x', '>', '> ```', 'after', '```bash', '> not a prefix', '```'].join('\n');
  assert.deepStrictEqual(shellFences(text), [
    { startLine: 3, lines: ['cp {tmp-a} x', ''] },
    { startLine: 8, lines: ['> not a prefix'] },
  ]);
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
  // A shell-level single quote never expands a substituted `$VAR`, so it is not a valid quoting.
  const sq = scanFence(["cp '{tmp-a}' x"]);
  assert.deepStrictEqual(sq.offenders.map((o) => o.name), ['{tmp-a}']);
  assert.strictEqual(sq.quoted, 0);
});

test('scanFence: a target inside $(...) nested in double quotes is unquoted', () => {
  const r = scanFence(['X="$(cat {tmp-a})"']);
  assert.deepStrictEqual(r.offenders.map((o) => o.name), ['{tmp-a}']);
  assert.strictEqual(r.quoted, 0);
  assert.strictEqual(r.balanced, true);
  const ok = scanFence(['X="$(cat "{tmp-a}")"']);
  assert.deepStrictEqual(ok.offenders, []);
  assert.strictEqual(ok.quoted, 1);
});

test('scanFence: a heredoc delimiter with a hyphen is parsed whole, so the line after it is scanned', () => {
  const r = scanFence(["node x.js <<'END-OF'", 'body', 'END-OF', 'cp {tmp-b} y']);
  assert.deepStrictEqual(r.offenders.map((o) => o.name), ['{tmp-b}']);
  assert.strictEqual(r.balanced, true);
});

test('scanFence: an unterminated heredoc swallowing the only target reports unbalanced', () => {
  const r = scanFence(["node x.js <<'EOF'", 'cp {tmp-b} y']);
  assert.strictEqual(r.balanced, false);
  assert.deepStrictEqual(r.offenders.map((o) => o.name), ['unbalanced']);
});

test('scanFence: the newly named {tmp} and {path-*} targets are read (uppercase suffix included)', () => {
  const r = scanFence(['x --file {tmp}.md {path-A} "{path-B}" {path-F} {path-U}']);
  assert.deepStrictEqual(r.offenders.map((o) => o.name), ['{tmp}', '{path-A}', '{path-F}', '{path-U}']);
  assert.strictEqual(r.quoted, 1);
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

test('AC1.1 go-red: preQuotedSubstitutions flags single-quoted and literal-path values, not {tmp-var}', () => {
  assert.strictEqual(preQuotedSubstitutions("with {tmp-records-file} = '$SPECIFY_ALL_ISSUES'").length, 1);
  assert.strictEqual(preQuotedSubstitutions('with `{tmp}` = "/abs/path"').length, 1);
  assert.strictEqual(preQuotedSubstitutions('{tmp-var}="x"').length, 0);
  assert.strictEqual(preQuotedSubstitutions('{owner} = "x"').length, 0);
});
