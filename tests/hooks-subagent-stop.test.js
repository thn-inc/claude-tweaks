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

function transcript(lastText) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-substop-t-')), 'agent.jsonl');
  const lines = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'task' }] } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: lastText }] } }),
  ];
  fs.writeFileSync(f, lines.join('\n') + '\n');
  return f;
}

function callSubstop(lastText) {
  const run = mkRun();
  const out = substop.run({
    input: { agent_transcript_path: transcript(lastText) },
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
// all. Logged exactly as before (no variant field).
test('AC3: a status word absent from the reply entirely is a genuine violation, logged unchanged from pre-migration behavior', () => {
  const { out, events } = callSubstop('Looked into the issue.\nStill not sure what is causing it.\nWill keep digging.');
  assert.match(out.json.systemMessage, /status line/i);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'contract-violation');
  assert.strictEqual(events[0].variant, undefined, 'a genuine violation must carry no variant field');
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
  assert.strictEqual(events[0].variant, undefined, 'must be a genuine violation, not a lenient match on table content');
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
