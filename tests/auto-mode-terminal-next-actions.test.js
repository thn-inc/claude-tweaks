const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const CONTRACT = readText(path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'auto-mode-contract.md'));

function notSilencedSection() {
  const start = CONTRACT.indexOf('## What `auto` does NOT silence');
  const end = CONTRACT.indexOf('## Forbidden under auto', start);
  assert.notStrictEqual(start, -1, 'not-silenced heading present');
  assert.ok(end > start, 'section delimited by the Forbidden heading');
  return CONTRACT.slice(start, end);
}

test('terminal Next Actions block is on the not-silenced list', () => {
  const section = notSilencedSection();
  assert.match(section, /Terminal `## Next Actions`/);
  assert.match(section, /navigation affordance, not an approval gate/);
  assert.match(section, /outside `consoleAutoResolve`'s zero-click scope/);
  assert.strictEqual((CONTRACT.match(/Next Actions/g) || []).length, 1, 'the phrase appears exactly once file-wide, keeping the acceptance grep unambiguous');
});

test('row defines the recommended line and the rendering convention', () => {
  const section = notSilencedSection();
  assert.match(section, /actual next command/);
  assert.match(section, /never an `AskUserQuestion`/);
  assert.match(section, /including `unattended`/);
});
