'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(ROOT, 'plugin', 'bin', 'lib', 'log-decision');
const { formatEntry, parseEntry } = require(path.join(LIB, 'append'));
const {
  CLAIM_LOG_SECTION, CLAIM_LOG_STEP, claimLogText, isClaimLogEntry, hasClaimLogFor, classifyDecisions, paraphrasedClaimNumbers,
} = require(path.join(LIB, 'claim-log'));

const NOW = Date.parse('2026-10-04T12:00:00Z');
// Verbatim from run 2026-10-04T163945-record-2861's decisions.md after Step 2.8.
const REAL_SINGLE = '## /flow\n- AUTO 18:42:06 — Step 2.8: claimed #2861 (bin/claim-targets.js, transport: git). Reversibility: high.\n';
// Verbatim shape from pre-tool-use.js's #2636 note (a real multi-record run).
const REAL_BATCH = '## /flow\n- AUTO 02:30:28 — Step 2.8: Claimed all 2 targets under run 2026-09-20T002426-record-1235 (claim-targets.js exit 0). Reversibility: high.\n';

test('parseEntry inverts formatEntry: status, time, location and action survive, with and without --spec/--lever (#2861)', () => {
  const plain = formatEntry({ status: 'AUTO', now: NOW, step: 'Step 2.8', text: 'claimed #7 (x)', reversibility: 'high' });
  const p = parseEntry(plain);
  assert.strictEqual(p.status, 'AUTO');
  assert.match(p.time, /^\d{2}:\d{2}:\d{2}$/);
  assert.strictEqual(p.location, 'Step 2.8');
  assert.strictEqual(p.action, 'claimed #7 (x). Reversibility: high.');
  const spec = parseEntry(formatEntry({ status: 'STAGED', now: NOW, step: 'Step 3', spec: '42', text: 'y', lever: 'a=b (policy)' }));
  assert.deepStrictEqual({ status: spec.status, location: spec.location }, { status: 'STAGED', location: 'spec #42 — Step 3' });
  assert.strictEqual(parseEntry(formatEntry({ status: 'SKIP', now: NOW, text: 'z' })).location, 'log-decision');
  for (const junk of ['', '## /flow', 'Step 2.8: claimed #7', '- auto 10:00:00 — Step 2.8: claimed #7', '- AUTO 10:00 — Step 2.8: claimed #7', '- AUTO 10:00:00 - Step 2.8: claimed #7']) {
    assert.strictEqual(parseEntry(junk), null, JSON.stringify(junk));
  }
});

test("claim-targets.md's documented argv produces a line isClaimLogEntry accepts, for every transport it names (#2861 writer/parser pin)", () => {
  const prose = fs.readFileSync(path.join(ROOT, 'plugin', 'skills', 'flow', 'claim-targets.md'), 'utf8');
  const start = prose.indexOf('**Log the claim (mandatory, #2492).**');
  assert.notStrictEqual(start, -1, 'claim-targets.md no longer has its "Log the claim" paragraph — this pin has lost its anchor');
  const block = prose.slice(start, prose.indexOf('```', prose.indexOf('```bash', start) + 7));
  assert.ok(block.includes(`--section "${CLAIM_LOG_SECTION}"`), 'documented --section equals CLAIM_LOG_SECTION');
  assert.ok(block.includes(`--step "${CLAIM_LOG_STEP}"`), 'documented --step equals CLAIM_LOG_STEP');
  assert.ok(block.includes('--status AUTO'), 'documented status is AUTO');
  assert.ok(block.includes(`--text "${claimLogText('{n}', '{git|contents-api|mcp}')}"`), 'documented --text equals claimLogText over the prose placeholders');
  for (const transport of ['git', 'contents-api', 'mcp']) {
    const line = formatEntry({ status: 'AUTO', now: NOW, step: CLAIM_LOG_STEP, text: claimLogText(2861, transport), reversibility: 'high' });
    assert.strictEqual(isClaimLogEntry(line), true, line);
  }
});

test('isClaimLogEntry: single and batch forms, with or without a spec prefix; unparseable, foreign, truncated or tail-carrying lines are not claim lines (#2861)', () => {
  for (const yes of [
    '- AUTO 18:42:06 — Step 2.8: claimed #2861 (bin/claim-targets.js, transport: git). Reversibility: high.',
    '- AUTO 00:00:00 — Step 2.8: claimed #991 (bin/claim-targets.js, transport: contents-api). Reversibility: n/a.',
    '- AUTO 00:00:00 — spec #991 — Step 2.8: claimed #991 (bin/claim-targets.js, transport: mcp). Reversibility: high.',
    '- AUTO 02:30:28 — Step 2.8: Claimed all 2 targets under run 2026-09-20T002426-record-1235 (claim-targets.js exit 0). Reversibility: high.',
  ]) assert.strictEqual(isClaimLogEntry(yes), true, yes);
  for (const no of [
    'Step 2.8: claimed #2861 (bin/claim-targets.js, transport: git).',
    '- STAGED 18:42:06 — Step 2.8: claimed #2861 (bin/claim-targets.js, transport: git).',
    '- AUTO 18:42:06 — Step 2.5: claimed #2861 (bin/claim-targets.js, transport: git).',
    '- AUTO 18:42:06 — Step 2.8: claim contested for #2861, stopping.',
    '- AUTO 18:42:06 — Step 2.8: claimed #abc.',
    // The whole action is matched, not its prefix: a line cut mid-write, a line
    // missing the suffix formatEntry always appends, and a claim prefix with
    // another decision riding behind it are all something other than a claim entry.
    '- AUTO 18:42:06 — Step 2.8: claimed #7 (bin/claim-targets.js, transp',
    '- AUTO 18:42:06 — Step 2.8: claimed #7 (bin/claim-targets.js, transport: git).',
    '- AUTO 18:42:06 — Step 2.8: claimed #7 (bin/claim-targets.js, transport: git). Reversibility: hi',
    '- AUTO 18:42:06 — Step 2.8: claimed #7 and also wrote config.yml by hand. Reversibility: n/a.',
    '- AUTO 18:42:06 — Step 2.8: claimed #7 (bin/claim-targets.js, transport: git). Then backfilled the PR. Reversibility: high.',
    '- AUTO 02:30:28 — Step 2.8: Claimed all 2 targets under run 2026-09-20T002426-record-1235',
    '- AUTO 18:42:06 — Step 3: noted that Step 2.8: claimed #2861 earlier.',
    '## /flow',
    '',
  ]) assert.strictEqual(isClaimLogEntry(no), false, JSON.stringify(no));
});

test('classifyDecisions: absent, empty, claim-log-only, content — and nothing unparseable ever reads as claim-log-only (#2861)', () => {
  assert.strictEqual(classifyDecisions(null), 'absent');
  assert.strictEqual(classifyDecisions(''), 'empty');
  assert.strictEqual(classifyDecisions(' \n\n\t\n'), 'empty');
  assert.strictEqual(classifyDecisions(REAL_SINGLE), 'claim-log-only');
  assert.strictEqual(classifyDecisions(REAL_BATCH), 'claim-log-only');
  assert.strictEqual(classifyDecisions(REAL_SINGLE.replace(/\n/g, '\r\n')), 'claim-log-only');
  const lineFor = (n) => formatEntry({ status: 'AUTO', now: NOW, step: CLAIM_LOG_STEP, text: claimLogText(n, 'git'), reversibility: 'high' });
  assert.strictEqual(classifyDecisions(`${lineFor(7)}\n${lineFor(8)}\n`), 'claim-log-only', 'no heading, two targets');
  assert.strictEqual(classifyDecisions(REAL_SINGLE.slice(0, -30)), 'content', 'a claim line truncated mid-write');
  // Header-only shapes: no claim entry at all.
  assert.strictEqual(classifyDecisions('## /flow\n'), 'content');
  assert.strictEqual(classifyDecisions('# Auto-Decision Log — pipeline 2026-05-15T143207-spec-42\n\nPipeline config snapshot:\n- mode: auto\n'), 'content');
  // Claim lines mixed with one real decision.
  assert.strictEqual(classifyDecisions(`${REAL_SINGLE}- AUTO 18:42:16 — Manifesto: design-critique resolved to auto (source: default). Reversibility: n/a.\n`), 'content');
  assert.strictEqual(classifyDecisions(`${REAL_SINGLE}## /build\n- AUTO 18:50:00 — Common Step 1: worktree created. Reversibility: high.\n`), 'content');
  // Unparseable or foreign lines beside a claim line.
  assert.strictEqual(classifyDecisions(`${REAL_SINGLE}Step 2.8: claimed #2861\n`), 'content', 'a claim-looking line with no entry prefix');
  assert.strictEqual(classifyDecisions(`${REAL_SINGLE}stray text\n`), 'content');
  assert.strictEqual(classifyDecisions(REAL_SINGLE.replace('## /flow', '## /build')), 'content', 'a claim line under a foreign heading');
  assert.strictEqual(classifyDecisions(`# Auto-Decision Log\n\n${REAL_SINGLE}`), 'content', 'a file header means a Manifesto already initialised this file');
});

test('hasClaimLogFor keeps hasLoggedClaim\'s semantics: exact number with a word boundary, or the batch form covering every number (#2861)', () => {
  assert.strictEqual(hasClaimLogFor(REAL_SINGLE, 2861), true);
  assert.strictEqual(hasClaimLogFor(REAL_SINGLE, 286), false);
  assert.strictEqual(hasClaimLogFor('- AUTO 00:00:00 — Step 2.8: claimed #700 (x).\n', 7), false);
  assert.strictEqual(hasClaimLogFor(REAL_BATCH, 1235), true);
  assert.strictEqual(hasClaimLogFor(REAL_BATCH, 9), true);
  assert.strictEqual(hasClaimLogFor('', 9), false);
});

test('AC1.1: hasClaimLogFor accepts paraphrased claim lines that name the number (#3012)', () => {
  const cases = [
    ['- AUTO 06:31:43 — log-decision: flow: claimed issue #2694 via MCP transport (gh CLI unavailable); tombstone reclaim from prior run. Reversibility: high.', 2694],
    ['- AUTO 07:42:07 — spec #827 — flow/claim-targets: Claimed issue #827 for this run (claims-registry blob write, state: absent -> live). Reversibility: high.', 827],
    ["- AUTO 01:03:28 — Step 2.8: claimed #517, #518, #519 on claims-registry (all classified 'absent'). Reversibility: high.", 517],
    ["- AUTO 01:03:28 — Step 2.8: claimed #517, #518, #519 on claims-registry (all classified 'absent'). Reversibility: high.", 518],
    ["- AUTO 01:03:28 — Step 2.8: claimed #517, #518, #519 on claims-registry (all classified 'absent'). Reversibility: high.", 519],
    ['- AUTO 07:49:40 — Step 2.8: group-claimed #533,#534,#536 under run 2026-08-16T074746-spec-533-534-536. Reversibility: high.', 534],
    ['- AUTO -- Step 2.8 claim: both #1447 and #1446 claimed successfully under runId 2026-08-29T232244-record-1446 (claim-targets.js exit 0). Reversibility: high.', 1446],
    ['- AUTO -- Step 2.8 claim: both #1447 and #1446 claimed successfully under runId 2026-08-29T232244-record-1446 (claim-targets.js exit 0). Reversibility: high.', 1447],
    ['- AUTO 07:27:52 — Step 2.8: claimed 2554,2745 (bin/claim-targets.js, transport: git). Reversibility: high.', 2745],
    ['- AUTO 05:25:45 — Step 2.8 (claim targets): Claimed issue #2328 (create-only write). Reversibility: high.', 2328],
  ];
  for (const [line, n] of cases) assert.strictEqual(hasClaimLogFor(line, n), true, `${n} in ${line}`);
});

test('AC1.1: hasClaimLogFor still denies a claim that was never logged (#3012 Gotcha)', () => {
  const cases = [
    ['', 7],
    ['## /flow\n', 7],
    ['- AUTO 16:14:57 — log-decision: Wrap-up outcome: pending-review. Separately noted: this run never itself claimed #1786 via claim-targets.js. Reversibility: n/a.', 1786],
    ['- AUTO 08:00:00 — Step 2.8: #3012 was not claimed (blob unreadable). Reversibility: n/a.', 3012],
    ['- AUTO 21:08:27 — Step 2.8: claim contested: #3004 held live by run 2026-10-16T190307-record-2734 (claimed 19:07:35, ttl 72h). Reversibility: n/a.', 3004],
    ['- AUTO 08:00:00 — Step 2.8: #3012 was claimed by run 2026-10-01T000000-record-3012 (another session). Reversibility: n/a.', 3012],
    ['- AUTO 17:54:54 — log-decision: Group E abandoned before claiming: sibling-session claims (#1769 alone, host=vm, claimed 2026-09-14T14:29Z). Reversibility: n/a.', 2026],
    ['- AUTO 17:54:54 — log-decision: Group E abandoned before claiming: sibling-session claims (#1769 alone, host=vm, claimed 2026-09-14T14:29Z). Reversibility: n/a.', 1769],
    ['- AUTO 03:49:47 — Known drift: issue #614 claimed eight objectives. Reversibility: high.', 614],
    ['- AUTO 08:00:00 — flow: claimed issue #700 via MCP.', 7],
    ['- AUTO 08:00:00 — flow: #3012 left unclaimed. Reversibility: n/a.', 3012],
  ];
  for (const [body, n] of cases) assert.strictEqual(hasClaimLogFor(body, n), false, `${n} in ${JSON.stringify(body)}`);
  assert.strictEqual(hasClaimLogFor('- STAGED 08:00:00 — Step 2.8: claimed #3012 (bin/claim-targets.js, transport: git).', 3012), true, 'the status-agnostic exact match is pinned, not changed');
  assert.deepStrictEqual(paraphrasedClaimNumbers('- STAGED 08:00:00 — flow: claimed issue #3012.'), []);
});

test('AC1.1: hasClaimLogFor rejects hypothetical and other-actor claim wording (#3012 final review)', () => {
  const cases = [
    '- AUTO 08:00:00 — Step 2.8: would have claimed #3012 but blob unreadable. Reversibility: n/a.',
    '- AUTO 08:00:00 — Step 2.8: another run claimed #3012 first; aborting. Reversibility: n/a.',
    '- AUTO 08:00:00 — Step 2.8: should be claimed #3012 next. Reversibility: n/a.',
  ];
  for (const line of cases) {
    assert.deepStrictEqual(paraphrasedClaimNumbers(line), [], line);
    assert.strictEqual(hasClaimLogFor(line, 3012), false, line);
  }
});

test('AC1.1: paraphrasedClaimNumbers rejects a FAILED claim line (#3012 final review)', () => {
  assert.deepStrictEqual(paraphrasedClaimNumbers('- AUTO 08:00:00 — Step 2.8: claimed #3012 — FAILED (exit 4). Reversibility: n/a.'), []);
  const line = '- AUTO 08:00:00 — flow: claimed issue #3012 — FAILED (exit 4). Reversibility: n/a.';
  assert.strictEqual(hasClaimLogFor(line, 3012), false);
});

test('AC1.1: paraphrasedClaimNumbers returns the numbers a single line positively records as claimed (#3012)', () => {
  assert.deepStrictEqual(paraphrasedClaimNumbers("- AUTO 01:03:28 — Step 2.8: claimed #517, #518, #519 on claims-registry (all classified 'absent'). Reversibility: high."), [517, 518, 519]);
  assert.deepStrictEqual(paraphrasedClaimNumbers('- AUTO -- Step 2.8 claim: both #1447 and #1446 claimed successfully under runId 2026-08-29T232244-record-1446 (claim-targets.js exit 0). Reversibility: high.'), [1447, 1446]);
  assert.deepStrictEqual(paraphrasedClaimNumbers('- AUTO 07:27:52 — Step 2.8: claimed 2554,2745 (bin/claim-targets.js, transport: git). Reversibility: high.'), [2554, 2745]);
  assert.deepStrictEqual(paraphrasedClaimNumbers('- AUTO 17:54:54 — log-decision: Group E abandoned before claiming: sibling-session claims (#1769 alone, host=vm, claimed 2026-09-14T14:29Z). Reversibility: n/a.'), []);
  assert.deepStrictEqual(paraphrasedClaimNumbers('- AUTO 21:08:27 — Step 2.8: claim contested: #3004 held live by run 2026-10-16T190307-record-2734 (claimed 19:07:35, ttl 72h). Reversibility: n/a.'), []);
  assert.deepStrictEqual(paraphrasedClaimNumbers(''), []);
  assert.deepStrictEqual(paraphrasedClaimNumbers('## /flow'), []);
});

test('AC1.1: paraphrasedClaimNumbers only reads the text before Reversibility (anchor after the suffix does not count) (#3012)', () => {
  assert.deepStrictEqual(paraphrasedClaimNumbers('- AUTO 08:00:00 — flow: claimed 2554. Reversibility: high (Step 2.8 claim).'), []);
  assert.deepStrictEqual(paraphrasedClaimNumbers('- AUTO 08:00:00 — Step 2.8: claimed 2554. Reversibility: high.'), [2554]);
});

test('AC1.1: paraphrasedClaimNumbers does not read a count ("claimed 5 of 7") as a record number (#3012)', () => {
  assert.deepStrictEqual(paraphrasedClaimNumbers('- AUTO 08:00:00 — Step 2.8: claimed 5 of 7 targets. Reversibility: n/a.'), []);
  assert.deepStrictEqual(paraphrasedClaimNumbers('- AUTO 08:00:00 — Step 2.8: claimed 5 of 7. Reversibility: n/a.'), []);
  assert.deepStrictEqual(paraphrasedClaimNumbers('- AUTO 08:00:00 — Step 2.8: claimed #5 for this run. Reversibility: n/a.'), [5]);
});
