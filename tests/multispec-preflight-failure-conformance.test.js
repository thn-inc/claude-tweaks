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

test('AC6.1: the ruling sub-file states all five branches', () => {
  const text = read(RULING);
  assert.match(text, /exit 0/i, 'exit 0 branch');
  assert.match(text, /exit 1[\s\S]*?re-run[^\n]*once/i, 'exit 1 re-runs once');
  assert.match(text, /STOP[^\n]*before[^\n]*claim/i, 'a STOP before claiming');
  assert.match(text, /exit 2[\s\S]*?no retry/i, 'exit 2 never retries');
  assert.match(text, /--records-json/, 'gh-free records path');
  assert.match(text, /issue_read/, 'MCP fetch for the gh-free path');
  assert.match(text, /nativeLinksUnchecked/, 'native-unchecked branch');
  assert.match(text, /--step "Step 1 native dependency links \(skipped\)"/, 'verbatim SKIP step id');
  assert.match(text, /github-write-transport\.md/, 'cites the transport routing');
  assert.match(text, /mcp-transport\.md/, 'cites the MCP transport');
  assert.match(text, /#1459/, 'cites the --record-json precedent');
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

test('AC7.1: multi-spec.md stays under its 20,480-byte read budget', () => {
  assert.ok(Buffer.byteLength(read(MULTI_SPEC), 'utf8') < 20480);
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
});

test('AC10.1: docs/plugin-structure.md\'s preflight-records CLI line names --records-json', () => {
  const line = read(PLUGIN_STRUCTURE).match(/^node plugin\/bin\/preflight-records\.js.*$/m);
  assert.ok(line, 'CLI line present');
  assert.match(line[0], /--records-json/);
});
