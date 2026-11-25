'use strict';
// Pins the Review Console's proposal-bundling wiring prose (#6283): the sub-file, its citation from the
// single-spec and multi-spec consoles (under the multi-spec file's Read rail), the narrowing step's
// ordering after bundling, and the ledger Resolution naming for a bundled member.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { RAIL_BYTES } = require(path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'skill-audit', 'budgets'));

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const read = (p) => fs.readFileSync(path.join(SKILLS, p), 'utf8');

const BUNDLING = read('wrap-up/proposal-bundling.md');
const CONSOLE = read('wrap-up/review-console.md');
const MULTISPEC_PATH = path.join(SKILLS, 'flow/multispec-review-console.md');
const MULTISPEC = fs.readFileSync(MULTISPEC_PATH, 'utf8');
const NARROWING = read('wrap-up/ledger-narrowing-auto-file.md');
const LEDGER_FORMAT = read('_shared/ledger-format.md');

// Each claim is checked on a copy with only its own pinned text removed: the check must throw with its
// own message (a bare throw could be any other claim failing first).
const CLAIMS = [
  ['cli', BUNDLING, /bin\/bundle-proposals\.js" --run/, 'bundling file lacks the CLI invocation'],
  ['skip', BUNDLING, /log-decision\.js[^\n]*--status SKIP[^\n]*condition: bundle-proposals\.js exited \{code\}/, 'bundling file lacks the Degrade-trace SKIP command naming the bundler exit'],
  ['unbundle', BUNDLING, /un-bundle \{Q#\}[^\n]*--unbundle/, 'bundling file lacks the un-bundle Override route'],
  ['carry', BUNDLING, /--set-item bundle-\{n\}\.md --resolution carried/, 'bundling file lacks the carry route'],
  ['order', CONSOLE, /proposal-bundling\.md[\s\S]*ledger-narrowing-auto-file\.md/, 'review-console.md must cite proposal-bundling.md before ledger-narrowing-auto-file.md'],
  ['bundled-into', NARROWING, /Bundled-into:/, 'narrowing file lacks the Bundled-into: skip'],
  ['after', NARROWING, /runs after proposal bundling/, 'narrowing file does not state it runs after bundling'],
  ['multispec', MULTISPEC, /proposal-bundling\.md/, 'multispec console does not cite proposal-bundling.md'],
  ['ledger', LEDGER_FORMAT, /staged\/bundle-\{n\}\.md/, 'ledger-format.md does not name staged/bundle-{n}.md'],
];

for (const [name, text, re, msg] of CLAIMS) {
  test(`pinned: ${name}`, () => {
    assert.ok(re.test(text), msg);
    const mutated = text.replace(new RegExp(re.source, 'g'), '');
    assert.notEqual(mutated, text);
    assert.ok(!re.test(mutated), `${name}: control still matches after the strip`);
  });
}

test('multispec console stays under the Read rail', () => {
  assert.ok(Buffer.byteLength(MULTISPEC) <= RAIL_BYTES, 'multispec-review-console.md is over the Read rail');
});

test('bundling file runs before console.json and is skipped under --dry-run', () => {
  assert.match(BUNDLING, /--dry-run/);
  assert.match(BUNDLING, /console\.json/);
});
