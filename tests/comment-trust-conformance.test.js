'use strict';

// #3358 — a marker comment drives behavior only when its author is an owner,
// member, or collaborator. `_shared/pr-run-comments.md`'s `## Trusted authors`
// section is the one statement of the rule; this suite pins the prose sites
// against `plugin/bin/lib/issues/comment-trust.js` (the code twin). The jq text
// is never retyped here: it is built by the module's own builders and compared
// against the prose, so a change to the module's set or order goes red until the
// prose is updated in the same change.
//
// The live prose is read on purpose (skill-prose-conformance-tests' "declared
// contract" carve-out): updating these sites IS the response to a change in the
// trust module. Every pin is paired with a frozen pre-change excerpt it must
// NOT match, so a green result proves the pattern can go red [IL-105].

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  TRUSTED_AUTHOR_ASSOCIATIONS,
  trustedJqSelect,
  untrustedJqNote,
} = require('../plugin/bin/lib/issues/comment-trust.js');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const COMMENTS = fs.readFileSync(path.join(SKILLS, '_shared', 'pr-run-comments.md'), 'utf8');
const SCAN = fs.readFileSync(path.join(SKILLS, 'tidy', 'scan-procedures.md'), 'utf8');

// Frozen pre-change excerpts (the bytes #3358 Task 4 replaced).
const PRE_CHANGE_FIND_JQ = `  --jq '.comments[] | select(.body | startswith("<!-- run-comment: {kind} -->")) | .id'`;
const PRE_CHANGE_MCP_PARAGRAPH = `**MCP transport (no \`gh\`, #3131).** The find and update steps above are \`gh\`-only, and there is no
MCP comment-edit mapping — post a new comment with \`add_issue_comment\` on the PR's number instead
of updating. Before posting, list the PR's comments (\`issue_read\`, \`get_comments\`) and look for a
prior comment of this kind by its marker; when one is found, make the new body's second line
\`Supersedes {prior comment URL} — this transport cannot edit comments.\` so a reader knows which one
is current, and log an \`AUTO\` line naming both comment ids. When the read cannot identify one (the
read fails, or returns no marker), post without that line — never skip the post to avoid a duplicate. Compose`;
const PRE_CHANGE_TOMBSTONE_ROW = `| \`CLOSED\` (unmerged) — check for the tombstone marker: \`gh pr view {pr-number} --json comments --jq '.comments[] \\| select(.body \\| startswith("<!-- run-comment: failure -->"))'\` | **Non-empty result → tombstoned.**`;

// Text of the `## {heading}` section, up to (not including) the next `## `
// heading. Both anchors must resolve — a missing end anchor would otherwise
// widen the slice to the rest of the file and let a later section satisfy a
// presence pin.
function section(text, heading) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l === heading);
  if (start === -1) return null;
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end === -1) end = lines.length; // deliberate: last section has no following heading
  return lines.slice(start + 1, end).join('\n');
}

// Paragraph (blank-line delimited) that begins with `opener`, or null.
function paragraphStartingWith(text, opener) {
  return text.split(/\r?\n\r?\n/).find((p) => p.startsWith(opener)) ?? null;
}

// Backticked all-caps tokens in prose outside fenced blocks, first-seen order,
// de-duplicated.
function capsTokens(text) {
  const prose = text.replace(/```[\s\S]*?```/g, '');
  const seen = [];
  for (const m of prose.matchAll(/`([^`\n]+)`/g)) {
    if (/^[A-Z_]+$/.test(m[1]) && !seen.includes(m[1])) seen.push(m[1]);
  }
  return seen;
}

const collapse = (s) => s.replace(/\s+/g, ' ');

test('AC5.1: the Find-step jq tests the association', () => {
  const needle = `select(.body | startswith("<!-- run-comment: {kind} -->")) | ${trustedJqSelect()} | .id`;
  assert.ok(COMMENTS.includes(needle), 'Find-step jq must pipe the marker select through trustedJqSelect() before .id');
  assert.ok(!PRE_CHANGE_FIND_JQ.includes(needle), 'needle must NOT match the pre-change Find jq (proves it can go red)');
});

test('AC5.1: the Find step also runs the skip-notice jq so skipped comments are named', () => {
  const note = untrustedJqNote();
  const from = COMMENTS.indexOf('1. **Find.**');
  const to = COMMENTS.indexOf('2. **Found');
  assert.ok(from !== -1 && to > from, 'Find step anchors must resolve before slicing');
  const findStep = COMMENTS.slice(from, to);
  assert.ok(findStep.includes(`startswith("<!-- run-comment: {kind} -->")) | ${note}`), 'Find step must run untrustedJqNote() over the marker comments');
  assert.ok(!PRE_CHANGE_FIND_JQ.includes(note), 'note must NOT match the pre-change Find jq');
});

test('the gh pr view command the Find step pins stays byte-identical', () => {
  assert.ok(
    COMMENTS.includes('gh pr view {pr-number} --repo {host}/{owner}/{repo} --json comments'),
    'tests/pr-run-comments.test.js pins this exact command',
  );
});

test('AC5.3: the Trusted authors section exists and lists exactly the module set, in order', () => {
  const body = section(COMMENTS, '## Trusted authors');
  assert.notStrictEqual(body, null, '`## Trusted authors` heading missing from _shared/pr-run-comments.md');
  assert.strictEqual(section(PRE_CHANGE_FIND_JQ, '## Trusted authors'), null, 'extractor must find nothing in pre-change text');

  // The excluded-on-purpose paragraph names CONTRIBUTOR; the trusted list is every
  // other paragraph's backticked all-caps tokens.
  const excluded = paragraphStartingWith(body, '**Excluded on purpose.**');
  assert.notStrictEqual(excluded, null, 'the section needs an `**Excluded on purpose.**` paragraph');
  const trustedProse = body.split(/\r?\n\r?\n/).filter((p) => p !== excluded).join('\n\n');
  assert.deepStrictEqual(capsTokens(trustedProse), [...TRUSTED_AUTHOR_ASSOCIATIONS]);
  assert.ok(capsTokens(excluded).includes('CONTRIBUTOR'), 'the excluded paragraph names CONTRIBUTOR');
  assert.ok(!capsTokens(trustedProse).includes('CONTRIBUTOR'), 'CONTRIBUTOR must appear only in the excluded paragraph');
});

test('AC5.3: the Trusted authors section carries the jq select and skip-notice jq verbatim', () => {
  const body = section(COMMENTS, '## Trusted authors');
  assert.notStrictEqual(body, null);
  assert.ok(body.includes(trustedJqSelect()), 'section must paste trustedJqSelect() verbatim');
  assert.ok(body.includes(untrustedJqNote()), 'section must paste untrustedJqNote() verbatim');
  const mutated = body.replace('"OWNER"', '"OWNER2"');
  assert.notStrictEqual(mutated, body, 'doctoring must change the section');
  assert.ok(!mutated.includes(trustedJqSelect()), 'a changed set member in the prose must read as drift');
});

test('AC5.3: the Trusted authors section states the fixed facts', () => {
  const body = collapse(section(COMMENTS, '## Trusted authors') ?? '');
  for (const fact of [
    '`authorAssociation`',
    '`author_association`',
    'bin/lib/issues/comment-trust.js',
    'missing',
    'viewer',
  ]) {
    assert.ok(body.includes(fact), `Trusted authors section must mention: ${fact}`);
  }
});

test('AC5.2: the MCP transport paragraph filters the Supersedes lookup by author_association', () => {
  const para = paragraphStartingWith(COMMENTS, '**MCP transport');
  assert.notStrictEqual(para, null, '**MCP transport paragraph missing');
  const flat = collapse(para);
  assert.ok(flat.includes('`author_association`'), 'MCP paragraph must name author_association');
  assert.ok(flat.includes('Trusted authors'), 'MCP paragraph must cite Trusted authors');
  assert.ok(flat.includes('github-write-transport.md'), 'MCP paragraph keeps its existing transport citation');
  const pre = collapse(PRE_CHANGE_MCP_PARAGRAPH);
  assert.ok(!pre.includes('`author_association`') && !pre.includes('Trusted authors'), 'pre-change paragraph must lack both (proves the pins can go red)');
});

test("tidy's tombstone check filters by association", () => {
  const rows = SCAN.split(/\r?\n/).filter((l) => l.includes('run-comment: failure'));
  assert.strictEqual(rows.length, 1, 'exactly one scan-procedures line carries the failure tombstone marker');
  // The row lives in a markdown table cell, so each pipe between jq stages is `\|`.
  const needle = `startswith("<!-- run-comment: failure -->")) \\| ${trustedJqSelect()}`;
  assert.ok(rows[0].includes(needle), 'tombstone jq must pipe the marker select through trustedJqSelect()');
  assert.ok(!PRE_CHANGE_TOMBSTONE_ROW.includes(needle), 'needle must NOT match the pre-change tombstone row');
  assert.ok(PRE_CHANGE_TOMBSTONE_ROW.includes('run-comment: failure'), 'control carries the anchor, lacking only the filter');
});

// ---- Task 5: demo, parent-gate and grant-maturation readers (#3358) ----

const { spawnSync } = require('node:child_process');
const { isTrustedComment, untrustedSkipNote } = require('../plugin/bin/lib/issues/comment-trust.js');

const PLUGIN_ROOT = path.join(__dirname, '..', 'plugin');
const ENTRY_PATHS = fs.readFileSync(path.join(SKILLS, 'demo', 'entry-paths.md'), 'utf8');
const PARENT_GATE = fs.readFileSync(path.join(SKILLS, 'wrap-up', 'verification-brief-parent-gate.md'), 'utf8');
const GRANT_GATE = fs.readFileSync(path.join(SKILLS, 'dispatch', 'grant-maturation-gate.md'), 'utf8');
const SHORT_CIRCUIT = fs.readFileSync(path.join(SKILLS, 'wrap-up', 'auto-merge-short-circuit.md'), 'utf8');

// Frozen pre-change passages (the bytes #3358 Task 5 replaced), each carrying its
// anchor and lacking only the trust citation / skip notice.
const PRE_CHANGE_DEMO_BRIEF = `If the result carries the \`demo:pending\` label, fetch its Verification Brief: the last issue
comment **containing** \`## Verification Brief\`. Fetch every comment (\`gh issue view {n} --json
comments\`) and take the last one carrying that heading — test the heading, never assume the
position. A \`.comments[-1]\` shortcut holds only when the brief happens to be the most recent
comment, which nothing about the record predicts. Go straight to
Step 2 with it.`;
const PRE_CHANGE_DEMO_POINTER = `**Under \`pr-first\` the brief lives on the PR** (\`wrap-up/verification-brief.md\` Step 4's \`pr\`
object present branch), and the issue carries only the unmarkered pointer line \`Verification Brief
posted to PR #{pr-number}: {pr-url}\`. When no issue comment carries the heading but one carries
that pointer, take \`{pr-number}\` from the last such comment and run the **PR run-comment lookup**
below for its \`brief\` comment — that comment, minus its marker line, is the Verification Brief; go
straight to Step 2 with it.`;
const PRE_CHANGE_DEMO_LOOKUP = `2. **Read its comments by marker** — \`_shared/pr-run-comments.md\`'s Find step (its \`{host}/{owner}/{repo}\`
   resolution, \`gh pr view {pr-number} --repo {host}/{owner}/{repo} --json state,comments\`, first-line
   \`startswith\` marker test — the same PR read \`bin/lib/wrap-up/engine-verify.js\`'s
   acceptance-labeling check runs on a pointer), selecting comment bodies rather than ids:
   - **Try it** — \`<!-- run-comment: try-it:{n} -->\` (a multi-spec run).
3. **Fail open, visibly.** No PR.`;
const PRE_CHANGE_PARENT_GATE = `**Then check whether a brief is already posted, before posting one** — and, when re-entering for
a parent that may already be partially applied, before even composing it above. Fetch the parent's comments
(\`gh issue view $PARENT_NUM --json comments\`, the same lookup \`/claude-tweaks:demo\`'s Step 1
already does) and test whether **any** of them contains a \`## Verification Brief\` heading **with
a \`### Confirmed\` section** — every comment on the parent.`;
const PRE_CHANGE_SNIPPET_COMMENTS_LINE = `// comments: this member's fetched comment body array (issue.comments[].body).
const pendingSince = extractPendingGrantedAt(comments);`;

// Passage located by an anchor literal: the one blank-line paragraph containing it.
function paragraphContaining(text, anchor) {
  const hits = text.split(/\r?\n\r?\n/).filter((p) => p.includes(anchor));
  return hits.length === 1 ? hits[0] : null;
}
// A list item: from its opener up to the next item's opener (both must resolve).
function listItem(text, opener, nextOpener) {
  const from = text.indexOf(opener);
  if (from === -1) return null;
  const to = text.indexOf(nextOpener, from);
  return to === -1 ? null : text.slice(from, to);
}
const TRUST_CITATION = /Trusted authors/;
const SKIP_NOTICE = /skipped marker comment|skip notice/;

const DEMO_PASSAGES = [
  ['issue-side brief scan', (t) => paragraphContaining(t, 'comment **containing** `## Verification Brief`'), PRE_CHANGE_DEMO_BRIEF],
  ['pointer paragraph', (t) => paragraphContaining(t, 'posted to PR #{pr-number}: {pr-url}`. When no issue comment'), PRE_CHANGE_DEMO_POINTER],
  ['PR run-comment lookup step 2', (t) => listItem(t, '2. **Read its comments by marker**', '3. **Fail open, visibly.**'), PRE_CHANGE_DEMO_LOOKUP],
];

for (const [name, extract, frozen] of DEMO_PASSAGES) {
  test(`AC5.2: demo's ${name} cites Trusted authors and the skip notice`, () => {
    const live = collapse(extract(ENTRY_PATHS) ?? '');
    assert.notStrictEqual(live, '', `${name}: anchor did not resolve to exactly one passage in entry-paths.md`);
    assert.match(live, TRUST_CITATION, `${name} must cite Trusted authors`);
    assert.match(live, SKIP_NOTICE, `${name} must name skipped marker comments`);
    const pre = collapse(extract(frozen) ?? '');
    assert.notStrictEqual(pre, '', `${name}: control must carry the anchor (proves the extractor resolves it)`);
    assert.doesNotMatch(pre, TRUST_CITATION, 'control must lack the citation (proves the pin can go red)');
    assert.doesNotMatch(pre, SKIP_NOTICE, 'control must lack the skip notice (proves the pin can go red)');
  });
}

test('AC5.2: the parent-gate already-posted check counts only trusted briefs', () => {
  const opener = '**Then check whether a brief is already posted';
  const live = collapse(paragraphStartingWith(PARENT_GATE, opener) ?? '');
  assert.notStrictEqual(live, '', 'the already-posted paragraph anchor must resolve');
  assert.match(live, TRUST_CITATION, 'paragraph must cite Trusted authors');
  assert.match(live, SKIP_NOTICE, 'paragraph must name skipped marker comments');
  const pre = collapse(paragraphStartingWith(PRE_CHANGE_PARENT_GATE, opener) ?? '');
  assert.notStrictEqual(pre, '', 'control must carry the anchor');
  assert.doesNotMatch(pre, TRUST_CITATION, 'control must lack the citation');
  assert.doesNotMatch(pre, SKIP_NOTICE, 'control must lack the skip notice');
});

// The `node -e "…"` body of the single bash fence in `doc` that calls
// extractPendingGrantedAt — anchored on the fence delimiters and the
// `node -e "` / closing `"` lines, not on a prose sentence. null when the
// fence count is not exactly one or the body does not extract.
function snippetBody(doc) {
  const fences = [...doc.matchAll(/```bash\r?\n([\s\S]*?)```/g)].map((m) => m[1]).filter((f) => f.includes('extractPendingGrantedAt'));
  if (fences.length !== 1) return null;
  const m = fences[0].match(/node -e "\r?\n([\s\S]*?)\r?\n\s*"\s*(?:\r?\n|$)/);
  return m ? m[1] : null;
}

const SNIPPETS = [
  ['dispatch/grant-maturation-gate.md', GRANT_GATE],
  ['wrap-up/auto-merge-short-circuit.md', SHORT_CIRCUIT],
];

for (const [file, doc] of SNIPPETS) {
  test(`grant maturation snippet in ${file} filters comments by trust before extracting the grant date`, () => {
    const body = snippetBody(doc);
    assert.notStrictEqual(body, null, `${file}: extraction pattern is out of sync with the fence`);
    // Either the shared partition (which filters by trust and builds the notes) or
    // the trust module's predicate directly satisfies "filter before extracting".
    assert.ok(
      body.includes('partitionGrantComments') || body.includes('comment-trust.js'),
      `${file}: snippet must require partitionGrantComments (grant-maturation.js) or isTrustedComment (comment-trust.js)`,
    );
    assert.ok(/extractPendingGrantedAt\(\s*(bodies|[^)]*\.map\()/.test(body), `${file}: extractPendingGrantedAt must receive the trusted bodies`);
    assert.ok(/console\.error\(/.test(body) && /skippedUntrusted|untrustedSkipNote/.test(body), `${file}: snippet must print each skipped note to stderr`);
    assert.ok(!doc.includes('issue.comments[].body'), `${file}: must no longer describe comments as a body array`);
    assert.ok(/issue\.comments/.test(body), `${file}: comments must be described as the fetched comment objects (issue.comments)`);
    // Go-red: the frozen pre-change lines carry the retired phrase and none of the new tokens.
    assert.ok(PRE_CHANGE_SNIPPET_COMMENTS_LINE.includes('issue.comments[].body'), 'control carries the retired phrase (proves the absence check can go red)');
    assert.ok(!/partitionGrantComments|comment-trust\.js|console\.error\(/.test(PRE_CHANGE_SNIPPET_COMMENTS_LINE), 'control lacks the new tokens');
  });

  test(`grant maturation snippet in ${file} runs: a NONE pending-grant marker is skipped with a note, a MEMBER one counts`, () => {
    const body = snippetBody(doc);
    assert.notStrictEqual(body, null, `${file}: extraction pattern is out of sync with the fence`);
    const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();
    const marker = (iso) => `<!-- grant-mode-audit: date=${iso} auto-merge=pending -->`;
    const comments = [
      // A forged, newer NONE marker: unfiltered it would be the latest grant and reset the clock.
      { url: 'https://x/c/1', author: { login: 'mallory' }, authorAssociation: 'NONE', body: marker(hoursAgo(1)) },
      // The real MEMBER grant, past the 24h window.
      { url: 'https://x/c/2', author: { login: 'maint' }, authorAssociation: 'MEMBER', body: marker(hoursAgo(48)) },
    ];
    const script = body
      .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, PLUGIN_ROOT)
      .replace(/\$GRANT_VETO_WINDOW_HOURS/g, '24');
    const prelude = `const labels = ['auto:merge-pending']; const comments = ${JSON.stringify(comments)};\n`;
    const run = spawnSync(process.execPath, ['-e', prelude + script], { encoding: 'utf8' });
    assert.strictEqual(run.status, 0, `snippet failed: ${run.stderr}`);
    // Only the 48h-old MEMBER grant counts -> matured; an unfiltered read would see the 1h-old NONE marker as latest.
    assert.strictEqual(JSON.parse(run.stdout).state, 'matured');
    assert.ok(run.stderr.includes(untrustedSkipNote(comments[0])), `stderr must carry the skip note, got: ${run.stderr}`);
    assert.ok(!run.stderr.includes('https://x/c/2'), 'the MEMBER comment must not be reported as skipped');
    assert.strictEqual(isTrustedComment(comments[0]), false);
    assert.strictEqual(isTrustedComment(comments[1]), true);
  });
}

test('the snippet extractor can go red: no node -e body, or two fences, yield null; CRLF still extracts', () => {
  assert.strictEqual(snippetBody('```bash\nextractPendingGrantedAt(x)\n```'), null);
  const one = '```bash\nnode -e "\nextractPendingGrantedAt(c);\n"\n```\n';
  assert.notStrictEqual(snippetBody(one), null);
  assert.strictEqual(snippetBody(one + one), null);
  assert.notStrictEqual(snippetBody(one.replace(/\n/g, '\r\n')), null, 'CRLF checkout still extracts');
});
