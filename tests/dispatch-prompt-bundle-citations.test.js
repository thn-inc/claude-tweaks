// tests/dispatch-prompt-bundle-citations.test.js — pins #1995: a dispatched Task agent must be
// pointed at the run's composed bundle (`{minted-run-dir}/context/{step}.md`), never at a raw
// `_shared/*.md` path, inside any text that actually reaches the agent (fenced Task-prompt
// blocks, and the Context pack's numbered-list region — items 1-5, including the CLI table and
// any indented continuation lines — those blocks are substituted into the templates verbatim)
// — except the agent-side fallback sentence itself, which is expected to name the source it
// falls back to, and two documented gaps with no compose step yet. The dispatcher-facing
// compose-context.js procedure paragraph that follows the "Substitute this whole block"
// paragraph is deliberately NOT governed — it never reaches the dispatched agent. Modeled on
// tests/skill-prose-plugin-root-invocations.test.js's walk/exemption shape.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { findComposeCallSites } = require('../plugin/bin/lib/skill-audit/context-cost.js');
const { PHASES } = require('../plugin/bin/lib/compose-context/phases.js');

const PLUGIN = path.join(__dirname, '..', 'plugin');
const TASK_PROMPT = path.join(PLUGIN, 'skills', 'dispatch', 'task-prompt.md');
const LENS_DISPATCH = path.join(PLUGIN, 'skills', 'review', 'step3-lens-dispatch.md');
const CONTRACT = path.join(PLUGIN, 'skills', '_shared', 'subagent-output-contract.md');

// Documented gaps: a `_shared/` citation with no compose step behind it yet. Each entry must
// still occur on a governed line with no fallback clause on it — a stale-exemption check
// (parse-signal-discipline): if a gap's file is ever composed and its citation moves to a
// bundle path (or gains a "read directly" fallback of its own), this list must shrink with it,
// or a rotted exemption starts silently covering something new.
const GAPS = ['_shared/run-dir-resolution.md', '_shared/integration-model.md'];

// The agent-side fallback shape: a `_shared/` mention is allowed only when it is the source
// named by a "read `_shared/<file>` directly" fallback clause on the same physical line — every
// agent-side fallback in the file now names its file this way (#1995 Task A step 4).
const FALLBACK_RE = /if that bundle is absent, read `_shared\/[^`]+` directly/;

function fencedBlocks(text) {
  const blocks = [];
  const lines = text.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('```')) continue;
    if (start === -1) { start = i + 1; } else { blocks.push(lines.slice(start, i)); start = -1; }
  }
  // An unclosed fence would otherwise drop its block from coverage silently; fail loud instead.
  assert.equal(start, -1, 'unbalanced ``` fences — the last fenced block is unclosed');
  return blocks;
}

function section(text, heading) {
  const lines = text.split('\n');
  const startIdx = lines.findIndex((l) => l.startsWith(heading));
  assert.ok(startIdx !== -1, `heading not found: ${heading}`);
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) { endIdx = i; break; }
  }
  return lines.slice(startIdx, endIdx);
}

// The Context pack's numbered-list region: from the first `1. ` item through the line before
// the "Substitute this whole block" paragraph — items 1-5, the CLI table, and any indented
// continuation lines. The dispatcher-facing compose-context.js paragraph sits AFTER that
// paragraph and is excluded on purpose: it is never substituted into a dispatched agent's prompt.
function contextPackNumberedRegion(text) {
  const packLines = section(text, '## Context pack');
  const startIdx = packLines.findIndex((l) => /^1\. /.test(l));
  assert.ok(startIdx !== -1, 'no numbered item 1 found in the Context pack section');
  const endIdx = packLines.findIndex((l) => l.startsWith('Substitute this whole block'));
  assert.ok(endIdx !== -1, 'no "Substitute this whole block" paragraph found in the Context pack section');
  assert.ok(endIdx > startIdx, 'the "Substitute this whole block" paragraph appears before the numbered list');
  return packLines.slice(startIdx, endIdx);
}

// The lines this file's `_shared/`-citation rule actually governs: every fenced code block in
// the whole file, plus the Context pack's numbered-list region (item 5's own line included).
function governedLines(text) {
  const out = [];
  for (const block of fencedBlocks(text)) out.push(...block);
  out.push(...contextPackNumberedRegion(text));
  return out;
}

function sharedOffenders(lines, { gaps = [] } = {}) {
  return lines.filter((line) => {
    if (!line.includes('_shared/')) return false;
    if (FALLBACK_RE.test(line)) return false;
    if (gaps.some((gap) => line.includes(gap))) return false;
    return true;
  });
}

// A gap is stale once its citation either disappears from the governed region, or is already
// fallback-shaped (in which case it no longer needs the GAPS exemption at all).
function gapStatus(text, gap) {
  const governed = governedLines(text);
  const hit = governed.find((line) => line.includes(gap));
  if (!hit) return 'missing';
  if (FALLBACK_RE.test(hit)) return 'fallback-shaped';
  return 'ok';
}

test('task-prompt.md fenced blocks and the Context-pack numbered list cite composed bundles, not _shared/ paths', () => {
  const text = readText(TASK_PROMPT);
  const offenders = sharedOffenders(governedLines(text), { gaps: GAPS });
  assert.deepStrictEqual(offenders, [], `un-exempted _shared/ citation(s):\n${offenders.join('\n')}`);
});

test('the compose-context.js procedure is dispatcher-facing (outside the governed region) while item 5 stays governed and _shared/-free', () => {
  const text = readText(TASK_PROMPT);
  const governed = governedLines(text);
  const composeLines = text.split('\n').filter((l) => l.includes('compose-context.js'));
  assert.equal(composeLines.length, 2, `expected exactly two compose-context.js lines, found ${composeLines.length}`);
  for (const line of composeLines) {
    assert.ok(!governed.includes(line), `compose-context.js line leaked into the governed region: ${line}`);
  }
  const item5 = governed.find((l) => l.includes('**Composed bundles**'));
  assert.ok(item5, 'item 5 ("Composed bundles") not found inside the governed numbered-list region');
  assert.ok(!item5.includes('_shared/'), `item 5's line must be _shared/-free: ${item5}`);
});

test('the documented gap list is not stale — each gap still occurs on a governed, non-fallback-shaped line', () => {
  const text = readText(TASK_PROMPT);
  for (const gap of GAPS) {
    assert.equal(gapStatus(text, gap), 'ok', `gap is stale or missing (fix the citation or shrink GAPS): ${gap}`);
  }
});

test('the gap stale-check can detect a fallback-shaped or vanished gap (discrimination proof, every gap)', () => {
  const text = readText(TASK_PROMPT);
  for (const gap of GAPS) {
    const lines = text.split('\n');
    const idx = lines.findIndex((l) => l.includes(gap));
    assert.ok(idx !== -1, `setup: gap citation not found in the file: ${gap}`);
    assert.equal(gapStatus(text, gap), 'ok', `setup: gap must not already be stale before doctoring: ${gap}`);
    const shaped = lines.slice();
    shaped[idx] = `if that bundle is absent, read \`${gap}\` directly`;
    assert.equal(gapStatus(shaped.join('\n'), gap), 'fallback-shaped', `doctored fallback-shaped gap was not caught as stale: ${gap}`);
    const vanished = lines.slice();
    vanished[idx] = lines[idx].replace(gap, '{minted-run-dir}/context/gone.md');
    assert.equal(gapStatus(vanished.join('\n'), gap), 'missing', `doctored vanished gap was not caught as missing: ${gap}`);
  }
});

test('review/step3-lens-dispatch.md fenced blocks never cite _shared/ at all', () => {
  const text = readText(LENS_DISPATCH);
  const offenders = fencedBlocks(text).flat().filter((line) => line.includes('_shared/'));
  assert.deepStrictEqual(offenders, [], `_shared/ citation inside a dispatched fenced block:\n${offenders.join('\n')}`);
});

// #4027: each call composes its bundles with one `--phase` line; the phase registry
// (bin/lib/compose-context/phases.js) names the bundles, never the line.
const FIRST_CALL_LINE = '`node "{plugin-root}/bin/compose-context.js" --run "{minted-run-dir}" --phase first-call`';
const SECOND_CALL_LINE = '`node "{plugin-root}/bin/compose-context.js" --run "{minted-run-dir}" --phase second-call`';
const READ_ONCE = 'Read {minted-run-dir}/context/merge.md once, whole, with one Read call, before your first step';
const NO_PIECEWISE = 'never re-read it unless your context was compacted since, and never open its source files piecewise (sed, grep, cat)';
const flat = (s) => s.replace(/\s+/g, ' ');

test('task-prompt.md composes each call\'s bundles with one --phase line, and no --step line remains', () => {
  const text = readText(TASK_PROMPT);
  const lines = text.split('\n');
  for (const want of [FIRST_CALL_LINE, SECOND_CALL_LINE]) {
    const hits = lines.filter((l) => l.startsWith(want));
    assert.equal(hits.length, 1, `expected exactly one line starting with ${want}, found ${hits.length}`);
  }
  assert.ok(!text.includes('--step claims'), 'task-prompt.md still composes with --step claims');
  assert.ok(!text.includes('--step merge'), 'task-prompt.md still composes with --step merge');
  assert.ok(
    text.includes('if the compose command is unavailable or exits non-zero, read the named source files directly'),
    'Context pack section is missing the compose-fallback sentence',
  );
});

test('the second-call template, and only it, has the agent read merge.md once, whole, before its first step', () => {
  const text = readText(TASK_PROMPT);
  const [first, second] = fencedBlocks(text).map((b) => flat(b.join('\n')));
  assert.ok(second.includes(READ_ONCE), `second-call template is missing: ${READ_ONCE}`);
  assert.ok(second.includes(NO_PIECEWISE), `second-call template is missing: ${NO_PIECEWISE}`);
  assert.equal(flat(text).split(READ_ONCE).length - 1, 1, 'the read-once instruction must occur exactly once in the file');
  assert.ok(!first.includes('context/merge.md'), 'the first-call template must not cite the merge bundle');
});

test('claims.md stays an on-demand citation with its fallback in both templates; item 5 says which bundle is read up front', () => {
  const text = readText(TASK_PROMPT);
  const blocks = fencedBlocks(text);
  for (const block of blocks) assert.ok(block.includes('{context-pack}'), 'each template must substitute {context-pack}');
  const packRow = contextPackNumberedRegion(text).filter((l) => l.trim().startsWith('|') && l.includes('context/claims.md'));
  assert.equal(packRow.length, 1, 'the CLI table must carry the one claims-registry row citing context/claims.md');
  const cites = [...packRow, ...blocks.flat().filter((l) => l.includes('context/claims.md'))];
  for (const line of cites) {
    assert.match(line, FALLBACK_RE, `claims.md citation without its fallback: ${line}`);
    assert.ok(!/once, whole/.test(line), `claims.md must stay on-demand, not read up front: ${line}`);
  }
  const region = contextPackNumberedRegion(text);
  const start = region.findIndex((l) => l.startsWith('5. **Composed bundles**'));
  const end = region.findIndex((l) => l.startsWith('6. '));
  assert.ok(start !== -1 && end > start, 'item 5 not found ahead of item 6');
  const item5 = flat(region.slice(start, end).join('\n'));
  assert.match(item5, /`\{minted-run-dir\}\/context\/claims\.md` is on-demand in both calls/);
  assert.match(item5, /`\{minted-run-dir\}\/context\/merge\.md` is read once, whole, up front by the second call only/);
});

test('review/step3-lens-dispatch.md composes its bundle with --phase review-lens', () => {
  const text = readText(LENS_DISPATCH);
  assert.ok(
    text.includes('node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --phase review-lens'),
    'step3-lens-dispatch.md is missing its --phase review-lens compose line',
  );
  assert.ok(!text.includes('--step review-dispatch'), 'step3-lens-dispatch.md still composes with --step review-dispatch');
});

test('subagent-output-contract.md names the phase registry as the one home and the always-bundle read rule', () => {
  const text = flat(readText(CONTRACT));
  assert.ok(text.includes('`bin/lib/compose-context/phases.js` is the one home of which bundles a phase gets'), 'contract bullet does not name the phase registry as the one home');
  assert.ok(text.includes('a bundle registered `load: \'always\'` is read once, whole, before the child\'s first step'), 'contract bullet does not state the always-bundle read rule');
});

// Which registered phases have no shipped `--phase` call line under `root` — a phase with no
// line is a bundle the composed-bytes rail gate never measures.
function phasesMissingFromProse(root) {
  const seen = new Set(findComposeCallSites(root).filter((r) => !r.unparsed && r.phase).map((r) => r.phase));
  return Object.keys(PHASES).filter((p) => !seen.has(p));
}

test('every registered phase has a shipped --phase call line, so each of its bundles meets the composed rail gate', () => {
  assert.deepStrictEqual(phasesMissingFromProse(PLUGIN), []);
});

test('the phase-coverage guard reports exactly the phase whose line is missing (discrimination proof)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-coverage-'));
  try {
    const skillDir = path.join(root, 'skills', 'demo');
    fs.mkdirSync(skillDir, { recursive: true });
    const line = (p) => `node "\${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --phase ${p}`;
    const names = Object.keys(PHASES);
    assert.ok(names.length > 1, 'setup: the registry must hold more than one phase');
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `${names.map(line).join('\n')}\n`);
    assert.deepStrictEqual(phasesMissingFromProse(root), []);
    for (const dropped of names) {
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `${names.filter((n) => n !== dropped).map(line).join('\n')}\n`);
      assert.deepStrictEqual(phasesMissingFromProse(root), [dropped], `dropping ${dropped}'s line was not caught`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the second-call template still runs whole skills via /claude-tweaks:flow, and wrap-up composes its own merge bundle', () => {
  const text = readText(TASK_PROMPT);
  const secondCallBlock = fencedBlocks(text)[1];
  assert.ok(secondCallBlock, 'expected a second fenced block (the second-call template)');
  const joined = secondCallBlock.join('\n');
  assert.match(joined, /\/claude-tweaks:flow/);
  assert.match(joined, /review,polish,wrap-up/);

  const mergeRows = findComposeCallSites(PLUGIN).filter((c) => c.step === 'merge' && !c.unparsed);
  assert.ok(mergeRows.length > 0, 'expected at least one real (non-placeholder) merge compose call site');
  assert.ok(
    mergeRows.some((c) => c.file.startsWith('wrap-up/')),
    `expected a merge compose call site under wrap-up/, got: ${mergeRows.map((c) => c.file).join(', ')}`,
  );
});

test('the _shared/ citation predicate can actually go red (discrimination proof)', () => {
  const text = readText(TASK_PROMPT);
  // Doctor a copy: replace the first call's fenced block content with one that cites a raw
  // _shared/ path with no fallback clause on the line.
  const doctored = text.replace(
    'Do NOT tear the worktree down yourself',
    'See `_shared/pr-first-merge.md` for the merge procedure. Do NOT tear the worktree down yourself',
  );
  assert.notEqual(doctored, text, 'doctoring did not apply — anchor text not found');
  const before = sharedOffenders(governedLines(text), { gaps: GAPS });
  const after = sharedOffenders(governedLines(doctored), { gaps: GAPS });
  assert.deepStrictEqual(before, []);
  assert.ok(after.some((line) => line.includes('`_shared/pr-first-merge.md` for the merge procedure')), `doctored _shared/ citation (no fallback) was not caught; offenders: ${after.join(' | ')}`);
});
