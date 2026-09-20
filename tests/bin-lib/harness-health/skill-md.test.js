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

const SKILL = path.resolve(__dirname, '..', '..', '..', 'plugin', 'skills', 'harness-health', 'SKILL.md');
const read = () => fs.readFileSync(SKILL, 'utf8');

test('exists', () => {
  assert.ok(fs.existsSync(SKILL), `SKILL.md not found at ${SKILL}`);
});

test('frontmatter declares the canonical name', () => {
  assert.match(read(), /^name: harness-health$/m);
});

registerInteractionStyleTest(test, assert, read);

test('invokes the CLI via ${CLAUDE_PLUGIN_ROOT}/bin/harness-health.js (not $SKILL_DIR)', () => {
  const body = read();
  assert.ok(body.includes('${CLAUDE_PLUGIN_ROOT}/bin/harness-health.js'));
  assert.ok(!body.includes('$SKILL_DIR'), 'must not use the non-existent $SKILL_DIR variable');
});

test('documents the dry-run-first procedure and hands payloads to gh', () => {
  const body = read();
  assert.ok(body.includes('--dry-run'));
  assert.ok(/gh issue create/.test(body));
});

registerHouseSectionOrderTest(test, assert, read);
registerPipelineRunDirTest(test, assert, read);

test('docs/skill-graph.md records the edges to /wrap-up, /init, /tidy, /backlog, /routine', () => {
  // These edges used to be asserted against this skill's own Relationship table.
  // That table is gone; the edges live in the graph, which uses the short form.
  const graph = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'docs', 'skill-graph.md'), 'utf8',
  );
  for (const s of ['/wrap-up', '/init', '/tidy', '/backlog', '/routine']) {
    assert.ok(graph.includes(s), `docs/skill-graph.md is missing the edge to ${s}`);
  }
});

registerNoEmojiTest(test, assert, read);

// ── spec 15: recordPayload migration anchors ────────────────────────────────

registerRequiredTokenTests(test, assert, read, [
  'validate-findings', '$PIPELINE_RUN_DIR', '--dry-run', '_shared/health-state.md',
  'work-record.md', 'work-fingerprint', 'by:harness-health', 'extractFingerprint',
  'relatedSections', 'Bundling rule', 'filing.md',
]);

// ── filing.md (Step 7, lazy-loaded) ─────────────────────────────────────────
// Step 7's filing procedure lives in its own sub-file: it is ~10.5 KB of
// mechanical reference a firing only needs once it actually has surviving
// findings to file, and keeping it inline pushed SKILL.md past CLAUDE.md's
// 40 KB soft ceiling. The tokens below moved with it — assert them against the
// file that now owns them, not against SKILL.md.

const FILING = path.resolve(__dirname, '..', '..', '..', 'plugin', 'skills', 'harness-health', 'filing.md');
const readFiling = () => fs.readFileSync(FILING, 'utf8');

test('filing.md exists and SKILL.md Step 7 delegates to it', () => {
  assert.ok(fs.existsSync(FILING), `filing.md not found at ${FILING}`);
  const body = read();
  assert.match(body, /\*\*Step 7 — FILE\.\*\*/, 'SKILL.md must still declare Step 7');
  assert.ok(body.includes('filing.md'), 'Step 7 must point at the sub-file that owns the procedure');
});

[
  'work-types', 'TYPE_LABELS', 'harness-health:additive', 'harness-health:restructural',
  'harness-health:new-skill', 'gh issue create', 'retry-queue', 'born-`ready`',
].forEach((token) => {
  test(`filing.md contains required token '${token}'`, () => {
    assert.ok(readFiling().includes(token), `missing required token in filing.md: ${token}`);
  });
});

test('filing.md states the classification -> scoring fold table literally', () => {
  const body = readFiling();
  assert.ok(/\|\s*`?additive`?\s*\|\s*`risk:low`\s*\|\s*`size:low`\s*\|/.test(body), 'missing literal additive -> risk:low/size:low table row');
  assert.ok(/\|\s*`?restructural`?\s*\|\s*`risk:medium`\s*\|\s*`size:high`\s*\|/.test(body), 'missing literal restructural -> risk:medium/size:high table row');
});

// The reason the extraction happened at all — guard the regression directly.
// Per-file 40 KB pin on this SKILL.md retired by #1997 — the per-file tier
// is a warning since #1990 and this file has no compose call site; removal
// condition in docs/incident-log.md [IL-153].

test('states the born-ready rule explicitly', () => {
  assert.ok(read().includes('born-`ready`'), 'missing an explicit born-ready statement');
});

test('never emits the bare harness-health label as mechanical origin (by:harness-health only)', () => {
  const body = read();
  assert.ok(!/`harness-health`-labelled/.test(body), 'must not describe issues as bare `harness-health`-labelled anymore');
  assert.ok(!body.includes('--label harness-health --label'), 'must not file with a bare --label harness-health anymore');
  assert.ok(!body.includes('gh issue list --label harness-health '), 'must not gather issues via the bare harness-health label anymore');
  assert.ok(body.includes('--label by:harness-health'), 'filing snippets must use the qualified by:harness-health label');
});

test('does not carry a "not pulled by / never pulled by" triage carve-out', () => {
  assert.ok(!/not pulled by|never pulled by/.test(read()));
});

test('documents the wontfix suppression and the dual fingerprint marker (legacy harness-health-fingerprint, read via extractFingerprint)', () => {
  const body = read();
  assert.ok(body.includes('wontfix'));
  assert.ok(body.includes('harness-health-fingerprint'), 'legacy marker name must still be documented as a read-only fallback');
  assert.ok(body.includes('extractFingerprint'));
});

// ── judge-procedure.md (dispatch-facing distillation) ────────────────────────
// The parallel dispatch inlines this file's body verbatim into each Task agent's
// prompt rather than handing over a path. A path reaches nothing (agents see only
// their own prompt) and makes every agent in a --budget batch independently read
// the much larger _shared/harness-health-analysis.md. Mirrors the same pair of tests in
// tests/bin-lib/docs-health/skill-md.test.js.

const JUDGE = path.resolve(__dirname, '..', '..', '..', 'plugin', 'skills', 'harness-health', 'judge-procedure.md');
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

test('SKILL.md dispatch inlines judge-procedure.md rather than passing a pointer', () => {
  const body = read();
  assert.ok(body.includes('judge-procedure.md'), 'dispatch must name the file it inlines');
  assert.ok(
    !/a pointer to `_shared\/harness-health-analysis\.md`/.test(body),
    'dispatch must not hand agents a pointer to the shared fragment',
  );
});

test('judge-procedure.md covers only the kinds the dispatch routes through it', () => {
  const body = readJudgeBody();
  for (const kind of ['skill', 'rule', 'claude-md']) {
    assert.ok(body.includes(kind), `missing in-scope kind: ${kind}`);
  }
  // design-artifact and memory use SKILL.md's own Step 3 branch text instead; the
  // gap scan runs once per firing, never per target. All three are out of scope by
  // construction, and the meta lead (excluded from body) is where that is stated.
  assert.ok(!body.includes('new-skill'), 'gap-scan/new-skill content must stay out of the per-target body');
});

// This is the invariant the whole extraction rests on: the body is inlined
// verbatim into clean-room Task agents, which see ONLY their own prompt. A
// reference to a sibling procedure file or to SKILL.md's own numbering is
// unresolvable there. Live data-source reads (the origin templates under
// skills/init/, .claude-tweaks/policy.yml) are deliberately allowed — an agent
// must read those fresh to judge template conformance at all.
test('judge-procedure.md body is self-contained — no procedure references a clean-room agent cannot resolve', () => {
  const body = readJudgeBody();
  const forbidden = [
    /\bSKILL\.md\b/, /harness-health-analysis\.md/, /\bStep \d/,
    /\babove\b/, /\bbelow\b/, /judge-procedure\.md/,
  ];
  for (const re of forbidden) {
    const hit = body.match(re);
    assert.ok(!hit, `unresolvable reference in the inlinable body: ${hit && hit[0]}`);
  }
});

test('judge-procedure.md body carries its own output contract and status line', () => {
  const body = readJudgeBody();
  assert.ok(body.includes('/tmp/harness-health-findings-{target.id}.json'), 'missing findings-file path');
  for (const s of ['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED']) {
    assert.ok(body.includes(s), `missing status value: ${s}`);
  }
});

test('judge-procedure.md fenced blocks balance, so inlining cannot break the prompt', () => {
  const fences = readJudge().split('\n').filter((l) => /^\s*```/.test(l));
  assert.strictEqual(fences.length % 2, 0, `unbalanced code fences: ${fences.length}`);
});
