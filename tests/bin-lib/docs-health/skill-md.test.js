const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  registerHouseSectionOrderTest,
  registerInteractionStyleTest,
  registerPipelineRunDirTest,
  registerNoEmojiTest,
  registerRequiredTokenTests,
} = require('../health-core/skill-md-house-checks');

const SKILL = path.resolve(__dirname, '..', '..', '..', 'plugin', 'skills', 'docs-health', 'SKILL.md');
const read = () => fs.readFileSync(SKILL, 'utf8');

test('exists', () => {
  assert.ok(fs.existsSync(SKILL), `SKILL.md not found at ${SKILL}`);
});

test('frontmatter declares the canonical name', () => {
  assert.match(read(), /^name: docs-health$/m);
});

registerInteractionStyleTest(test, assert, read);

test('invokes the CLI via ${CLAUDE_PLUGIN_ROOT}/bin/docs-health.js (not $SKILL_DIR)', () => {
  const body = read();
  assert.ok(body.includes('${CLAUDE_PLUGIN_ROOT}/bin/docs-health.js'));
  assert.ok(!body.includes('$SKILL_DIR'), 'must not use the non-existent $SKILL_DIR variable');
});

test('documents the dry-run-first procedure and hands payloads to gh', () => {
  const body = read();
  assert.ok(body.includes('--dry-run'));
  assert.ok(/gh issue create/.test(body));
});

registerHouseSectionOrderTest(test, assert, read);
registerPipelineRunDirTest(test, assert, read);

test('docs/skill-graph.md records the edges to /harness-health, /code-health, /tidy, /backlog, /routine', () => {
  // These edges used to be asserted against this skill's own Relationship table.
  // That table is gone; the edges live in the graph, which uses the short form.
  const graph = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'docs', 'skill-graph.md'), 'utf8',
  );
  for (const s of ['/harness-health', '/code-health', '/tidy', '/backlog', '/routine']) {
    assert.ok(graph.includes(s), `docs/skill-graph.md is missing the edge to ${s}`);
  }
});

registerNoEmojiTest(test, assert, read);

registerRequiredTokenTests(test, assert, read, [
  'validate-findings', '$PIPELINE_RUN_DIR', '--dry-run', '_shared/health-state.md',
  'work-record.md', 'work-fingerprint', 'by:docs-health', 'criteria-docs-diataxis.md',
  'docs-health:additive', 'docs-health:restructural', 'docs/superpowers',
  'relatedSections', 'judge-procedure.md',
]);

// ── judge-procedure.md ───────────────────────────────────────────────────────
// The JUDGE procedure and finding schema live in this sub-file, not inline in
// SKILL.md: Step 3 reads it, and Step 1's parallel dispatch inlines its body
// verbatim into each agent's prompt. One source, two callers — keeping it
// inline in both places is the "contract restated twice, only one copy
// updated" failure CLAUDE.md's 40 KB SKILL.md ceiling exists to prevent.

const JUDGE = path.join(path.dirname(SKILL), 'judge-procedure.md');
const readJudge = () => fs.readFileSync(JUDGE, 'utf8');
// The inlinable body is everything below the first horizontal rule; the lead
// above it is meta ("how this file is used") and is NOT sent to agents.
const readJudgeBody = () => readJudge().split(/^---$/m).slice(1).join('---');

test('judge-procedure.md exists and separates its meta lead from the inlinable body', () => {
  assert.ok(fs.existsSync(JUDGE), `judge-procedure.md not found at ${JUDGE}`);
  const body = readJudgeBody();
  assert.ok(body.trim().length > 0, 'no inlinable body found below the horizontal rule');
  assert.ok(body.length < readJudge().length, 'body must be a strict subset of the file');
});

registerRequiredTokenTests(test, assert, readJudge, [
  'Bundling rule', 'relatedSections', 'genre-drift', 'depth-mismatch',
  'findability', 'staleness', 'word-count', 'find-refs', 'check-freshness',
  '{target.path}', '{target.id}', '{plugin-root}', '{root}',
]);

test('judge-procedure.md carries all ten numbered judgment points', () => {
  const body = readJudgeBody();
  for (let n = 1; n <= 10; n += 1) {
    assert.ok(new RegExp(`^${n}\\. `, 'm').test(body), `missing numbered point ${n}`);
  }
});

// #2866: a finding's proposed replacement text must not cite a commit hash
// that was never checked against complete history (#2785 filed two wrong ones).
test('judge-procedure.md point 6 runs verify-commit on every cited commit hash before emitting', () => {
  const body = readJudgeBody();
  const start = body.search(/^6\. /m);
  const end = body.search(/^7\. /m);
  assert.ok(start >= 0 && end > start, 'points 6 and 7 not found');
  const point6 = body.slice(start, end);
  assert.ok(
    point6.includes('node "{plugin-root}/bin/docs-health.js" verify-commit'),
    'point 6 must carry the verify-commit invocation',
  );
  assert.match(point6, /every commit hash/i, 'point 6 must cover every commit hash a finding cites');
  assert.match(point6, /before emitting/i, 'point 6 must run the check before the finding is emitted');
  assert.match(point6, /`unverifiable`[^.]*never[^.]*`not-found`/, 'point 6 must forbid reading unverifiable as not-found');
});

// This is the invariant the whole extraction rests on: the body is inlined
// verbatim into clean-room Task agents, which see ONLY their own prompt. Any
// reference to a sibling file or to SKILL.md's own numbering is unresolvable
// there, and an agent that cannot resolve it emits malformed output.
test('judge-procedure.md body is self-contained — no references a clean-room agent cannot resolve', () => {
  const body = readJudgeBody();
  const forbidden = [
    /\bSKILL\.md\b/, /_shared\//, /\bStep \d/, /criteria fragment/,
    /\babove\b/, /\bbelow\b/, /judge-procedure\.md/,
  ];
  for (const re of forbidden) {
    const hit = body.match(re);
    assert.ok(!hit, `unresolvable reference in the inlinable body: ${hit && hit[0]}`);
  }
});

test('judge-procedure.md fenced blocks balance, so inlining cannot break the prompt', () => {
  const fences = readJudge().split('\n').filter((l) => /^\s*```/.test(l));
  assert.strictEqual(fences.length % 2, 0, `unbalanced code fences: ${fences.length}`);
});

test('states the classification -> scoring fold table literally', () => {
  const body = read();
  assert.ok(/\|\s*`?additive`?\s*\|\s*`risk:low`\s*\|\s*`size:low`\s*\|/.test(body));
  assert.ok(/\|\s*`?restructural`?\s*\|\s*`risk:medium`\s*\|\s*`size:high`\s*\|/.test(body));
});

test('states the born-ready rule explicitly', () => {
  assert.ok(read().includes('born-`ready`'), 'missing an explicit born-ready statement');
});

// Since #529 the template carries no prompt text: the live prompt is assembled from
// the kernel in _shared/routine-template-schema.md, and the template's only invocation
// surface is its `kickoff` value (spliced into the kernel's routine-kickoff closing line).
test('routine-template.yml exists and its kickoff targets docs-health', () => {
  const templatePath = path.join(path.dirname(SKILL), 'routine-template.yml');
  assert.ok(fs.existsSync(templatePath));
  const content = fs.readFileSync(templatePath, 'utf8');
  assert.match(content, /^kickoff: docs-health\b/m);
});
