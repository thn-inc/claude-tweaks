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
//
// The same reasoning covers the second contract pinned below: the gate's deny
// reason quotes a console section heading by name, so that heading must exist,
// verbatim, in the console file the reason names.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const pre = require('../plugin/bin/lib/hooks/pre-tool-use');
const { REVIEW_CONSOLE_HEADER } = pre;
const { readText } = require('./helpers/read-skill');

const CONSOLE_FILES = [
  'plugin/skills/wrap-up/review-console-interactive.md',
  'plugin/skills/flow/multispec-review-console.md',
];

const PIN = `\`header\`: \`"${REVIEW_CONSOLE_HEADER}"\``;

const readConsole = (file) => readText(path.join(__dirname, '..', file));

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

// Builds a real deny reason for one run shape (single-spec, or multi-spec via
// manifest.yml). The run sits in a real git repo whose run-state.json names the
// caller's session, so classifyOwnership answers 'mine'; the ceiling is injected.
function denyReason({ multiSpec }) {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-console-heading-')));
  execFileSync('git', ['-C', repo, 'init', '-q']);
  const dir = path.join(repo, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ status: 'active', sessionId: 'sess-1' }));
  if (multiSpec) fs.writeFileSync(path.join(dir, 'manifest.yml'), 'specs: []\n');
  const ctx = {
    input: { tool_name: 'AskUserQuestion', tool_input: { questions: [{ header: REVIEW_CONSOLE_HEADER, question: 'q', options: [] }] }, session_id: 'sess-1', cwd: repo },
    ownedRun: { dir, attribution: 'session' },
    cwd: repo,
  };
  const out = pre.checkReviewConsoleAskGate(ctx, { readConsoleCeiling: () => 'unattended' });
  return out.json.hookSpecificOutput.permissionDecisionReason;
}

for (const multiSpec of [false, true]) {
  test(`#3712: the deny reason's quoted section heading exists in the console file it names (${multiSpec ? 'multi-spec' : 'single-spec'})`, () => {
    const m = /follow (\S+\.md)'s "([^"]+)" section/.exec(denyReason({ multiSpec }));
    assert.ok(m, 'the deny reason no longer quotes a console file and section heading in the shape this test parses');
    const [, file, heading] = m;
    const lines = readConsole(path.join('plugin', 'skills', file)).split('\n');
    assert.ok(lines.includes(`## ${heading}`),
      `plugin/skills/${file} has no "## ${heading}" heading — pre-tool-use.js's checkReviewConsoleAskGate deny reason sends the model to that section by name; rename both together`);
  });
}
