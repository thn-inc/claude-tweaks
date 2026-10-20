// tests/review-console-header-conformance.test.js
//
// Pins the header the Review Console ask gate keys on. pre-tool-use.js denies the
// console's AskUserQuestion only when a question's header equals
// REVIEW_CONSOLE_HEADER exactly; the two console prompts are where that header is
// actually authored. If either prompt stops carrying the same string, the gate
// silently stops firing and nothing else fails.
//
// This suite reads live production prose, which [IL-80] warns against. It is
// acceptable HERE, and only here, because the header is a declared contract
// between two prose files and one hook constant, and updating all three together
// is the intended action when it changes (same reasoning as
// tests/hooks-gate-coverage.test.js). Do not generalize the pattern to prose that
// merely happens to mention the console.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { REVIEW_CONSOLE_HEADER } = require('../plugin/bin/lib/hooks/pre-tool-use');

const CONSOLE_FILES = [
  'plugin/skills/wrap-up/review-console-interactive.md',
  'plugin/skills/flow/multispec-review-console.md',
];

const PIN = `\`header\`: \`"${REVIEW_CONSOLE_HEADER}"\``;

const readConsole = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

// Lines that author an AskUserQuestion header. A file may carry several (the
// multi-spec console also asks per-item Q#/M# questions); the console's own is
// the one that pins REVIEW_CONSOLE_HEADER.
function assertPinsHeader(text, file) {
  const askLines = text.split('\n').filter((l) => l.includes('AskUserQuestion') && l.includes('`header`:'));
  assert.ok(askLines.length > 0,
    `${file} has no line carrying both AskUserQuestion and a \`header\`: value — could not find the console ask to pin; the gate keys on that header, so locate it before changing this test`);
  assert.ok(askLines.some((l) => l.includes(PIN)),
    `${file} no longer pins ${PIN} — the Review Console ask gate in plugin/bin/lib/hooks/pre-tool-use.js (REVIEW_CONSOLE_HEADER) keys on that exact header; the hook constant and the prose must change together`);
}

for (const file of CONSOLE_FILES) {
  test(`AC5.1/AC5.2: ${file} pins the console AskUserQuestion header the gate keys on`, () => {
    assertPinsHeader(readConsole(file), file);
  });

  test(`control: assertPinsHeader goes red on ${file} when the header drifts`, () => {
    const drifted = readConsole(file).split(PIN).join(`\`header\`: \`"${REVIEW_CONSOLE_HEADER} X"\``);
    assert.notStrictEqual(drifted, readConsole(file), 'the control mutation must actually change the text');
    assert.throws(() => assertPinsHeader(drifted, file), /no longer pins/);
  });

  test(`control: assertPinsHeader reports a missing ask distinctly for ${file}`, () => {
    assert.throws(() => assertPinsHeader('no ask here', file), /could not find the console ask/);
  });
}
