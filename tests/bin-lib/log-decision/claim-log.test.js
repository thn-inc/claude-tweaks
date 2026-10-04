'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(ROOT, 'plugin', 'bin', 'lib', 'log-decision');
const { formatEntry, parseEntry } = require(path.join(LIB, 'append'));
const {
  CLAIM_LOG_SECTION, CLAIM_LOG_STEP, claimLogText, isClaimLogEntry, hasClaimLogFor, classifyDecisions,
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
