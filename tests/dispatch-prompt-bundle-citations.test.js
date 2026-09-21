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
const path = require('node:path');

const PLUGIN = path.join(__dirname, '..', 'plugin');
const TASK_PROMPT = path.join(PLUGIN, 'skills', 'dispatch', 'task-prompt.md');
const LENS_DISPATCH = path.join(PLUGIN, 'skills', 'review', 'step3-lens-dispatch.md');

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
  const text = fs.readFileSync(TASK_PROMPT, 'utf8');
  const offenders = sharedOffenders(governedLines(text), { gaps: GAPS });
  assert.deepStrictEqual(offenders, [], `un-exempted _shared/ citation(s):\n${offenders.join('\n')}`);
});

test('the compose-context.js procedure is dispatcher-facing (outside the governed region) while item 5 stays governed and _shared/-free', () => {
  const text = fs.readFileSync(TASK_PROMPT, 'utf8');
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
  const text = fs.readFileSync(TASK_PROMPT, 'utf8');
  for (const gap of GAPS) {
    assert.equal(gapStatus(text, gap), 'ok', `gap is stale or missing (fix the citation or shrink GAPS): ${gap}`);
  }
});

test('the gap stale-check can detect a fallback-shaped or vanished gap (discrimination proof, every gap)', () => {
  const text = fs.readFileSync(TASK_PROMPT, 'utf8');
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
  const text = fs.readFileSync(LENS_DISPATCH, 'utf8');
  const offenders = fencedBlocks(text).flat().filter((line) => line.includes('_shared/'));
  assert.deepStrictEqual(offenders, [], `_shared/ citation inside a dispatched fenced block:\n${offenders.join('\n')}`);
});

test('task-prompt.md composes exactly one claims bundle and one merge bundle before dispatch', () => {
  const text = fs.readFileSync(TASK_PROMPT, 'utf8');
  const claimsLines = text.split('\n').filter((l) => l.includes('--step claims'));
  const mergeLines = text.split('\n').filter((l) => l.includes('--step merge'));
  assert.equal(claimsLines.length, 1, `expected exactly one --step claims line, found ${claimsLines.length}`);
  assert.equal(mergeLines.length, 1, `expected exactly one --step merge line, found ${mergeLines.length}`);
  for (const line of [...claimsLines, ...mergeLines]) {
    assert.match(line, /--run "\{minted-run-dir\}"/, `compose line missing --run "{minted-run-dir}": ${line}`);
  }
  assert.ok(
    text.includes('if the compose command is unavailable or exits non-zero, read the named source files directly'),
    'Context pack section is missing the compose-fallback sentence',
  );
});

test('the second-call template still runs whole skills via /claude-tweaks:flow, and wrap-up composes its own merge bundle', () => {
  const text = fs.readFileSync(TASK_PROMPT, 'utf8');
  const secondCallBlock = fencedBlocks(text)[1];
  assert.ok(secondCallBlock, 'expected a second fenced block (the second-call template)');
  const joined = secondCallBlock.join('\n');
  assert.match(joined, /\/claude-tweaks:flow/);
  assert.match(joined, /review,polish,wrap-up/);

  // eslint-disable-next-line global-require
  const { findComposeCallSites } = require('../plugin/bin/lib/skill-audit/context-cost.js');
  const mergeRows = findComposeCallSites(PLUGIN).filter((c) => c.step === 'merge' && !c.unparsed);
  assert.ok(mergeRows.length > 0, 'expected at least one real (non-placeholder) merge compose call site');
  assert.ok(
    mergeRows.some((c) => c.file.startsWith('wrap-up/')),
    `expected a merge compose call site under wrap-up/, got: ${mergeRows.map((c) => c.file).join(', ')}`,
  );
});

test('the _shared/ citation predicate can actually go red (discrimination proof)', () => {
  const text = fs.readFileSync(TASK_PROMPT, 'utf8');
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
