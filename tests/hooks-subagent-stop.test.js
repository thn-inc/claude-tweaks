// tests/hooks-subagent-stop.test.js — #2265: dedicated coverage for
// subagent-stop.js's two-tier canonical/lenient status-line detection.
//
// Migration this pins: the canonical status signal moved from a bare-word
// FIRST line to a labeled trailing "STATUS: {WORD}" line (the reply's last
// non-empty line). The checker stays lenient about exact position — a bare
// or off-position status word within the first-or-last 3 non-empty lines is
// still accepted, logging only an informational event variant — which is
// what makes the format migration itself safe with no explicit transition
// period: an in-flight dispatch given an old-format prompt is still accepted
// by the checker that runs after this ships.
//
// Broader regression coverage for this hook (exemptions, ctx.ownedRun
// scoping, tool-call-only/narration-plus-tool-call last turns, the #750 bold
// "**Status:**" prefix, and the pre-#2265 test updates this migration made)
// lives in tests/hooks-log-modules.test.js — not duplicated here.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const substop = require('../plugin/bin/lib/hooks/subagent-stop');

function mkRun() {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-substop-'));
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  fs.mkdirSync(run, { recursive: true });
  return run;
}

// One tool_use block precedes the final text turn by default, so tests
// exercising the contract-violation/status-line detection (not #2345's own
// zero-tool-use-verdict) never also trip that unrelated check. Pass
// `{ toolUse: false }` for a test that specifically wants a zero-tool-use
// transcript.
function transcriptWithToolUse(lastText, { toolUse = true } = {}) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-substop-t-')), 'agent.jsonl');
  const lines = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'task' }] } }),
  ];
  if (toolUse) {
    lines.push(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Read', input: {} }] } }));
    lines.push(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } }));
  }
  lines.push(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: lastText }] } }));
  fs.writeFileSync(f, lines.join('\n') + '\n');
  return f;
}

function callSubstop(lastText, opts = {}) {
  const run = mkRun();
  const out = substop.run({
    input: { agent_transcript_path: transcriptWithToolUse(lastText, opts) },
    runDir: run,
    runState: null,
    ownedRun: { dir: run, attribution: 'session' },
    cwd: '/x',
  });
  const eventsPath = path.join(run, 'events.jsonl');
  const events = fs.existsSync(eventsPath)
    ? fs.readFileSync(eventsPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    : [];
  return { out, events };
}

const WORDS = ['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED'];

// AC1: canonical trailing "STATUS: {WORD}" — compliant, no event at all,
// for each of the four contract words.
for (const word of WORDS) {
  test(`AC1: a reply whose last non-empty line is exactly "STATUS: ${word}" is canonical-compliant, no event logged`, () => {
    const { out, events } = callSubstop(`Did the work.\nChecked twice.\nSTATUS: ${word}`);
    assert.deepStrictEqual(out, {}, 'canonical compliance returns no dispatcher-facing warning');
    assert.strictEqual(events.length, 0, 'canonical compliance logs nothing at all — not even an informational variant');
  });
}

// AC2: lenient fallback — the status word as the first token of one of the
// first-or-last 3 non-empty lines, but NOT the canonical trailing line —
// still compliant, but logs the informational variant (never a hard
// violation).
test('AC2: a status word as the first token of an early non-empty line (not the trailing canonical line) is lenient-compliant and logs the informational variant', () => {
  const { out, events } = callSubstop('DONE\nRan the full suite.\nEverything green.');
  assert.deepStrictEqual(out, {}, 'lenient compliance returns no dispatcher-facing warning');
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'contract-violation');
  assert.strictEqual(events[0].variant, 'lenient', 'off-position compliance must log the lenient variant, never a hard violation');
});

// AC3: genuine violation — the status word appears nowhere in the reply at
// all. Logged with variant: 'violation' (#2344 — every logged
// contract-violation event now carries an explicit variant tag).
test('AC3: a status word absent from the reply entirely is a genuine violation, tagged variant: violation (#2344)', () => {
  const { out, events } = callSubstop('Looked into the issue.\nStill not sure what is causing it.\nWill keep digging.');
  assert.match(out.json.systemMessage, /status line/i);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'contract-violation');
  assert.strictEqual(events[0].variant, 'violation', 'a genuine violation must carry variant: violation');
});

// AC4: migration safety — an old-format reply (the bare status word as the
// literal FIRST line, no trailing "STATUS:" line anywhere) is STILL accepted
// by the new lenient fallback. This is what makes the migration itself safe
// with no explicit transition period: an in-flight dispatch given an
// old-format prompt, checked after this ships, is still accepted.
test('AC4: an old-format reply (bare status word as the literal first line, no trailing STATUS: line) is still accepted by the lenient fallback', () => {
  const { out, events } = callSubstop('DONE\nAll checks passed, nothing else to report.');
  assert.deepStrictEqual(out, {}, 'the old first-line format must still be accepted post-migration');
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].variant, 'lenient');
});

// AC7: table-row exclusion — a findings-table row containing a matching word
// must not itself trigger a false lenient-compliant match when the reply's
// actual trailing status line is missing. Template A's own findings table
// sits in the reply's last few lines by construction, so without this
// exclusion a table cell that happens to contain one of the four words would
// be indistinguishable from a genuine trailing status line.
test('AC7: a findings-table row containing a matching word does not itself trigger a false lenient-compliant match when the real status line is missing', () => {
  const body = [
    '| Severity | Path:Line | Finding | Evidence |',
    '|---|---|---|---|',
    '| info | src/x.js:5 | Migration already DONE here | historical note only |',
  ].join('\n');
  const { out, events } = callSubstop(body);
  // No genuine trailing "STATUS: {WORD}" line exists, and the table row
  // (excluded from the lenient candidate window) must not supply one either
  // — this must fall through to a genuine violation, not a false
  // lenient-compliant match on the table cell's "DONE" text.
  assert.match(out.json.systemMessage, /status line/i, 'a table cell must never substitute for the real status line');
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].variant, 'violation', 'must be a genuine violation, not a lenient match on table content');
});

// Companion to AC7: the SAME reply, with a genuine trailing status line
// appended after the table, is fully canonical-compliant — proving the
// table-row exclusion only screens candidates out of the lenient window, it
// never blocks the real canonical check on the reply's true last line.
test('AC7 companion: a findings table followed by a genuine trailing STATUS line is canonical-compliant', () => {
  const body = [
    '| Severity | Path:Line | Finding | Evidence |',
    '|---|---|---|---|',
    '| info | src/x.js:5 | Migration already DONE here | historical note only |',
    'STATUS: DONE',
  ].join('\n');
  const { out, events } = callSubstop(body);
  assert.deepStrictEqual(out, {});
  assert.strictEqual(events.length, 0, 'a genuine trailing STATUS line after a table is fully canonical, no event at all');
});

// #2344 AC1: a reply beginning with a verdict word from ANOTHER dispatch
// site's own declared contract (a review-lens/fix-verification reply) is
// still logged (never silently skipped — the aggregation layer decides
// friction, not the detector), but tagged variant: 'foreign-contract'
// instead of the genuine 'violation' tag.
for (const word of ['APPROVED', 'NEEDS_FIXES', 'ADDRESSED', 'VERIFIED']) {
  test(`#2344 AC1: a reply beginning with the foreign contract word "${word}" logs variant: foreign-contract, not a genuine violation`, () => {
    const { out, events } = callSubstop(`${word}\n\nNo material fixes found.`);
    assert.match(out.json.systemMessage, /status line/i, 'still returns the same dispatcher-facing warning shape');
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'contract-violation');
    assert.strictEqual(events[0].variant, 'foreign-contract', `"${word}" must classify as foreign-contract, not a genuine violation`);
  });
}

// #2344 AC1's orthogonal case: an unrelated third vocabulary — not in the
// curated FOREIGN_CONTRACT_WORDS list — still grades as a genuine violation.
// Proves the classifier is a closed, curated list, not a general heuristic
// that would swallow any capitalized first line.
test('#2344 AC1 orthogonal case: an unrelated third vocabulary word still grades as a genuine violation', () => {
  const { out, events } = callSubstop('REJECTED\n\nThis is not one of the curated foreign-contract words.');
  assert.match(out.json.systemMessage, /status line/i);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].variant, 'violation', 'an unrecognized vocabulary word must still be graded as a genuine violation');
});

// #2345 AC3: a well-formed status line and findings table, with ZERO
// tool-use blocks anywhere in the transcript, logs a zero-tool-use-verdict
// event — independent of the reply's own status-line compliance.
test('#2345 AC3: a compliant reply with zero tool-use blocks in the transcript logs zero-tool-use-verdict', () => {
  const body = [
    '| Severity | Path:Line | Finding | Evidence |',
    '|---|---|---|---|',
    '| high | src/x.js:5 | Missing null check | direct read |',
    'STATUS: DONE',
  ].join('\n');
  const { out, events } = callSubstop(body, { toolUse: false });
  assert.deepStrictEqual(out, {}, 'the status line is fully canonical-compliant on its own terms');
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'zero-tool-use-verdict');
});

// #2345 AC3's other direction: an otherwise-identical transcript WITH one
// tool-use block logs nothing (for this specific check — the reply is also
// canonical-compliant, so no contract-violation event fires either).
test('#2345 AC3: an otherwise-identical transcript with one tool-use block logs no zero-tool-use-verdict', () => {
  const body = [
    '| Severity | Path:Line | Finding | Evidence |',
    '|---|---|---|---|',
    '| high | src/x.js:5 | Missing null check | direct read |',
    'STATUS: DONE',
  ].join('\n');
  const { out, events } = callSubstop(body, { toolUse: true });
  assert.deepStrictEqual(out, {});
  assert.strictEqual(events.length, 0, 'one tool-use block anywhere in the transcript must suppress zero-tool-use-verdict');
});

// zero-tool-use-verdict and contract-violation are independent signals — a
// non-compliant reply with zero tool calls logs BOTH events.
test('#2345: a non-compliant reply with zero tool-use blocks logs both zero-tool-use-verdict and contract-violation', () => {
  const { events } = callSubstop('Looked into the issue but ran out of time.', { toolUse: false });
  const types = events.map((e) => e.type).sort();
  assert.deepStrictEqual(types, ['contract-violation', 'zero-tool-use-verdict']);
});
