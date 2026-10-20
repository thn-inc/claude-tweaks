// tests/flow-pre-authorize-merge-token.test.js — #2734. Pins the decision that
// no autonomy ceiling sets merge-authorization, and the /flow
// `pre-authorize-merge` token that answers lever 13 for one run instead. Reads
// live skill prose deliberately (skill-prose-conformance-tests): these
// sentences ARE the contract the record asked to have documented.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));
const TOKEN = 'pre-authorize-merge';

function ceilingSection() {
  const text = read('plugin/skills/_shared/autonomy-ceiling.md');
  const start = text.indexOf("### Orthogonal to the ceiling: the Manifesto's `merge-authorization` lever");
  assert.ok(start !== -1, 'autonomy-ceiling.md: Orthogonal-to-the-ceiling heading not found');
  const end = text.indexOf('\n### ', start + 1);
  return text.slice(start, end === -1 ? undefined : end);
}

test('AC1.1: autonomy-ceiling.md records the #2734 decision that no ceiling sets merge-authorization', () => {
  const section = ceilingSection();
  assert.match(section, /no ceiling sets it/);
  assert.match(section, /#2734/);
  assert.match(section, /#1802/, 'the rationale must name the ungranted-member carve-out it protects');
  assert.ok(section.includes('`' + TOKEN + '`'), 'the section must name the per-run route that replaces the extension');
  assert.match(section, /policySourceExcluded/, 'the why-bullet on the standing policy value must stay');
  assert.match(section, /consoleAutoResolve/, 'the why-bullet on what unattended already merges must stay');
  assert.match(section, /The real gap was per-run/, 'the why-bullet on the per-run gap must stay');
});

test('the retired "auto:* invariant" citation stays gone from the lever-13 sources', () => {
  for (const rel of ['plugin/bin/lib/policy-schema.js', 'plugin/skills/_shared/autonomy-ceiling.md', 'plugin/skills/_shared/auto-mode-contract.md']) {
    assert.doesNotMatch(read(rel), /auto:\* invariant/, rel + ' cites an invariant that no file defines');
  }
});

test('flow SKILL.md documents the token, its dispatch-bound refusal, and that no skill composes it', () => {
  const row = read('plugin/skills/flow/SKILL.md').split('\n').find((l) => l.startsWith('| `' + TOKEN + '` |'));
  assert.ok(row, 'flow/SKILL.md: no Arguments row for the token');
  assert.match(row, /dispatch-bound/);
  assert.match(row, /no skill composes it/);
  assert.match(row, /interactive/, 'the row must state the interactive no-op');
  assert.match(row, /multi-record/, 'the row must state the multi-record no-op');
  assert.match(row, /pr-first/, 'the no-final-click promise is qualified by integration model');
});

test('manifesto.md sets lever 13 from the token (source arg) and refuses it on a dispatch-bound run', () => {
  const row = read('plugin/skills/flow/manifesto.md').split('\n').find((l) => l.startsWith('| Merge authorization | `ask` |'));
  assert.ok(row, 'manifesto.md: Recommendation defaults Merge authorization row not found');
  assert.ok(row.includes('`' + TOKEN + '`'));
  assert.match(row, /source `arg`/);
  assert.match(row, /dispatch-bound/);
  assert.match(row, /`SKIP`/);
  assert.ok(row.includes('write `ask` despite the token'), 'a refused token must write ask, never pre-authorized');
  assert.match(row, /multi-record/);
  assert.ok(row.includes('log-decision.js --run "$PIPELINE_RUN_DIR" --status SKIP'), 'the SKIP log command must carry --run');
});

// An agent never originates its own merge authorization: no plugin file other
// than flow's own grammar/examples may compose a /flow invocation (qualified or
// bare) carrying the token. `[^`|\n]*` keeps the match inside one invocation
// string, so prose naming both in separate code spans does not count. flow's
// SKILL.md is scanned too, minus the lines that ARE the documented grammar:
// the argument-hint/Syntax/Input lines (they carry `[pre-authorize-merge]`)
// and the one Examples line.
test('no plugin file composes a /flow invocation carrying the token', () => {
  const INVOCATION = new RegExp('/(?:claude-tweaks:)?flow\\b[^`|\\n]*' + TOKEN);
  const GRAMMAR_LINE = new RegExp('\\[' + TOKEN + '\\]|^/claude-tweaks:flow 42 ' + TOKEN);
  const offenders = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = dir + '/' + ent.name;
      if (ent.isDirectory()) { walk(rel); continue; }
      if (!/\.(md|js|ya?ml|json)$/.test(ent.name)) continue;
      const text = rel === 'plugin/skills/flow/SKILL.md'
        ? read(rel).split('\n').filter((l) => !GRAMMAR_LINE.test(l)).join('\n')
        : read(rel);
      if (INVOCATION.test(text)) offenders.push(rel);
    }
  };
  walk('plugin');
  assert.deepStrictEqual(offenders, []);
});

test('every restatement of how lever 13 is set names the token alongside confirm/hybrid', () => {
  const SITES = [
    'plugin/skills/wrap-up/manifesto-authorized-merge.md',
    'plugin/skills/_shared/auto-mode-contract.md',
    'plugin/skills/_shared/policy-schema.md',
    'plugin/skills/help/policy.md',
    'plugin/skills/_shared/github-pr-scan.md',
  ];
  for (const rel of SITES) {
    const text = read(rel);
    assert.ok(text.includes('`' + TOKEN + '`'), rel + ' does not name the token');
    assert.match(text, /`confirm`\/`hybrid`|confirm\/hybrid/, rel + ' names the token without the confirm/hybrid route');
  }
  const { POLICY_KEYS } = require('../plugin/bin/lib/policy-schema');
  const row = POLICY_KEYS.find((k) => k.key === 'merge-authorization');
  assert.doesNotMatch(row.summary, /at Manifesto time/, 'summary still says only the Manifesto sets it');
});

test('manifesto.md applies the token on an adopted run and the Write-mechanism paragraph names both single-key callers', () => {
  const text = read('plugin/skills/flow/manifesto.md');
  const row = text.split('\n').find((l) => l.startsWith('| Merge authorization | `ask` |'));
  assert.ok(row, 'manifesto.md: Merge authorization defaults row not found');
  assert.match(row, /adopted run/);
  assert.ok(row.includes('--key merge-authorization --value pre-authorized'));
  const para = text.split('\n').find((l) => l.startsWith('**Write mechanism'));
  assert.ok(para, 'manifesto.md: Write mechanism paragraph not found');
  assert.doesNotMatch(para, /its only remaining caller/);
  assert.match(para, /ceremony escape hatch/, 'the paragraph must name the escape-hatch caller');
  assert.ok(para.includes('`' + TOKEN + '` token'), 'the paragraph must name the token caller');
  assert.ok(row.includes('before the FYI table renders'), 'the adopted-run write must precede the render');
});

test('steps-and-gates.md cases 1 and 3 both point at manifesto.md\'s Merge authorization row for the token', () => {
  const text = read('plugin/skills/flow/steps-and-gates.md');
  const hits = text.split("manifesto.md`'s Merge authorization row").length - 1;
  assert.ok(hits >= 2, 'expected the case 1 and case 3 token pointers, found ' + hits);
});
