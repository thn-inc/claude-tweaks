const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HOOKS_DOC = path.join(ROOT, 'docs/hooks.md');
const DONTS = path.join(ROOT, 'docs/donts.md');
const INCIDENT_LOG = path.join(ROOT, 'docs/incident-log.md');

// Whitespace-collapsed read, per skill-prose-conformance-tests' control-scan convention --
// a hard-wrapped literal must not silently defeat these assertions.
function collapsed(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/\s+/g, ' ');
}

test('docs/hooks.md states the inform-tier relay rule once, inside the inform-tier run', () => {
  const lines = fs.readFileSync(HOOKS_DOC, 'utf8').split('\n');
  const relayLines = lines.filter((line) => /Every inform-tier line names its relay/.test(line));
  assert.equal(relayLines.length, 1);
  assert.match(relayLines[0], /never run it yourself/);
  const idx = lines.indexOf(relayLines[0]);
  assert.match(lines[idx + 1], /\(inform tier/);
});

test('docs/donts.md [IL-150] names fs.realpathSync.native', () => {
  const lines = fs.readFileSync(DONTS, 'utf8').split('\n');
  const il150 = lines.filter((line) => line.includes('realTarget()') && line.includes('[IL-150]'));
  assert.equal(il150.length, 1);
  assert.match(il150[0], /fs\.realpathSync\.native/);
  assert.match(il150[0], /realTarget\(\)`'s leaf handling/);
});

test('docs/incident-log.md IL-150 cites #3380 row 48 as the casing instance', () => {
  const text = collapsed(INCIDENT_LOG);
  const start = text.indexOf('## IL-150 ');
  const end = text.indexOf('## IL-151 ');
  assert.ok(start !== -1 && end > start, 'IL-150 section bounds not found');
  const section = text.slice(start, end);
  assert.match(section, /#3380/);
  assert.match(section, /row 48/);
  assert.match(section, /#3406/);
  assert.match(section, /ffe20b982/);
  assert.match(section, /realTarget\(\)` in `pre-tool-use\.js` still uses the JS form/);
  assert.match(section, /fs\.realpathSync\.native/);
});
