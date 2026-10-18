// tests/multispec-preflight-failure-conformance.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FLOW_DIR = path.join(ROOT, 'plugin', 'skills', 'flow');
const read = (p) => fs.readFileSync(p, 'utf8');

const RULING = path.join(FLOW_DIR, 'multispec-preflight-failure.md');
const MULTI_SPEC = path.join(FLOW_DIR, 'multi-spec.md');
const MERGE_GATE = path.join(FLOW_DIR, 'multispec-merge-gate.md');
const WAVES = path.join(FLOW_DIR, 'multispec-parallel-waves.md');
const PLUGIN_STRUCTURE = path.join(ROOT, 'docs', 'plugin-structure.md');
const FRESHNESS = path.join(FLOW_DIR, 'multispec-freshness.md');
const CLAIM_TARGETS = path.join(FLOW_DIR, 'claim-targets.md');

test('the boundary Key Files re-derive takes the gh-free path and never reads a failed derive as an empty set', () => {
  const step = read(FRESHNESS).split('\n').find((l) => l.includes('**Remaining Key Files**'));
  assert.ok(step, 'Remaining Key Files step present');
  assert.match(step, /gh` unavailable, add `--records-json \{file\}`/, 'gh-absent re-derive uses --records-json');
  assert.match(step, /non-zero exit is never an empty set: skip this boundary's merge/, 'a failed re-derive skips the merge');
});

test('the claim file-overlap warning skips with one SKIP on a failed or gh-absent pre-flight, never stopping', () => {
  const text = read(CLAIM_TARGETS);
  const section = text.slice(text.indexOf('## File-overlap warning'), text.indexOf('## Claim every named target'));
  assert.match(section, /gh` unavailable, or on any non-zero exit,\nskip the warning — no retry, no stop/, 'skip rule present');
  const skipLine = section.split('\n').find((l) => l.includes('bin/log-decision.js'));
  assert.ok(skipLine, 'SKIP command present');
  assert.match(skipLine, /--status SKIP --step "Step 2\.8 file-overlap warning \(skipped\)"/, 'SKIP step id');
  assert.doesNotMatch(skipLine.match(/--text "([^"]*)"/)[1], /`/, 'SKIP --text has no backticks');
});

test('AC6.1: the ruling sub-file states all five branches', () => {
  const text = read(RULING);
  assert.match(text, /exit 0/i, 'exit 0 branch');
  assert.match(text, /exit 1[\s\S]*?re-run[^\n]*once/i, 'exit 1 re-runs once');
  const exit1 = text.split('\n').find((l) => l.startsWith('**Exit 1'));
  assert.ok(exit1, 'exit 1 branch paragraph present');
  assert.match(exit1, /second exit 1 is a \*\*STOP before claiming\*\*/i, 'a second exit 1 STOPs before claiming');
  assert.match(exit1, /names every failing record/i, 'the exit-1 STOP names every failing record');
  const exit2 = text.split('\n').find((l) => l.startsWith('**Exit 2'));
  assert.ok(exit2, 'exit 2 branch paragraph present');
  assert.match(exit2, /\*\*STOP before claiming\*\*, no retry/i, 'exit 2 STOPs before claiming, never retries');
  assert.match(exit2, /--records-json/, 'exit 2 names a bad --records-json input among its causes');
  assert.match(text, /issue_read[\s\S]*?fails[^\n]*STOP before claiming/i, 'an MCP fetch failure STOPs before claiming');
  assert.match(text, /--records-json/, 'gh-free records path');
  assert.match(text, /issue_read/, 'MCP fetch for the gh-free path');
  assert.match(text, /nativeLinksUnchecked/, 'native-unchecked branch');
  assert.match(text, /--step "Step 1 native dependency links \(skipped\)"/, 'verbatim SKIP step id');
  assert.match(text, /github-write-transport\.md/, 'cites the transport routing');
  assert.match(text, /mcp-transport\.md/, 'cites the MCP transport');
  assert.match(text, /#1459/, 'cites the --record-json precedent');
  const skipLine = text.split('\n').find((l) => l.includes('bin/log-decision.js') && l.includes('Step 1 native dependency links (skipped)'));
  assert.ok(skipLine, 'SKIP command line present');
  const textArg = skipLine.match(/--text "([^"]*)"/);
  assert.ok(textArg, 'SKIP --text double-quoted argument present');
  assert.doesNotMatch(textArg[1], /`/, 'SKIP --text must be shell-safe: no backticks inside the double-quoted argument');
});

test('AC6.2: multi-spec.md step 3 points to the ruling', () => {
  const step3 = read(MULTI_SPEC).match(/^3\. \*\*Pre-flight\*\*.*$/m);
  assert.ok(step3, 'step 3 line present');
  assert.match(step3[0], /multispec-preflight-failure\.md/);
});

test('AC6.3: steps 4 and 5 state the exit-0 precondition', () => {
  const text = read(MULTI_SPEC);
  for (const lead of ['4. **Dependency-aware ordering**', '5. **Conflict detection**']) {
    const line = text.split('\n').find((l) => l.startsWith(lead));
    assert.ok(line, `${lead} line present`);
    assert.match(line, /exit-0/i, `${lead} states the exit-0 precondition`);
  }
});

test('AC8.1: the merge gate no longer proceeds unsplit on a non-zero exit', () => {
  const text = read(MERGE_GATE);
  assert.doesNotMatch(text, /proceed unsplit with the full target list/);
  assert.match(text, /multispec-preflight-failure\.md/);
});

test('AC9.1: the waves fallback is step 3\'s single retry', () => {
  const para = read(WAVES).match(/\*\*No plan\.\*\*[^\n]*/);
  assert.ok(para, 'No plan. paragraph present');
  assert.match(para[0], /single retry|one retry/i);
  assert.match(para[0], /multispec-preflight-failure\.md/);
  assert.doesNotMatch(
    para[0],
    /2 malformed, or a `--waves` dependency cycle\), `parallel` falls back/,
    'the re-run without --waves is for exit 1 only; exit 2 (malformed or a --waves cycle) is step 3\'s STOP',
  );
  assert.doesNotMatch(
    para[0],
    /exits? (non-zero|2)[^.]*without `--waves`/i,
    'no wording may tie the re-run without --waves to a non-zero or exit-2 call',
  );
  assert.match(para[0], /exit 2|2 malformed/i, 'names exit 2 as following step 3\'s STOP');
  assert.match(para[0], /STOP/, 'exit 2 routes to step 3\'s STOP');
});

test('AC10.1: docs/plugin-structure.md\'s preflight-records CLI line names --records-json', () => {
  const line = read(PLUGIN_STRUCTURE).match(/^node plugin\/bin\/preflight-records\.js.*$/m);
  assert.ok(line, 'CLI line present');
  assert.match(line[0], /--records-json/);
});
