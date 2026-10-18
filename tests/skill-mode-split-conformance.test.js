'use strict';
// tests/skill-mode-split-conformance.test.js — #2697: /demo and /feedback load only
// the branch they resolve. Pins that each extracted branch body lives in its own
// sub-file (H1 + one distinctive body literal), that SKILL.md routes to it by file
// name, and that SKILL.md no longer carries the body itself. Read live, not frozen:
// this is just-shipped prose expected to evolve in place; the discrimination proof is
// structural — pre-#2697 none of the sub-files existed, so every row was red.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));

const SPLITS = [
  {
    skill: 'demo',
    sub: 'browser-verdict.md',
    heading: '# Demo Step 2 — Browser Verdict',
    bodyLiteral: 'Compose a single-variant `layout`-scope',
  },
  {
    skill: 'demo',
    sub: 'design-contract-section.md',
    heading: '# Demo Step 2 — The Design Contract Section',
    bodyLiteral: 'five blocks reproduced **verbatim**',
  },
  {
    skill: 'demo',
    sub: 'follow-up-record.md',
    heading: '# Demo Step 3 — Filing the Follow-Up Record',
    bodyLiteral: 'Never `allocateId`+`writeRecord`',
  },
  {
    skill: 'feedback',
    sub: 'bare-invocation.md',
    heading: '# Feedback Step 0 — Bare-Invocation Umbrella',
    bodyLiteral: 'gh issue list --label upstream-candidate',
  },
  {
    skill: 'feedback',
    sub: 'pre-confirmed.md',
    heading: '# Feedback — The `--pre-confirmed` Path',
    bodyLiteral: 'compare it, byte-for-byte, against the approved snapshot',
  },
];

for (const s of SPLITS) {
  test(`${s.skill}/${s.sub} carries the extracted body; ${s.skill}/SKILL.md routes to it and no longer restates it`, () => {
    const subPath = `plugin/skills/${s.skill}/${s.sub}`;
    const skillPath = `plugin/skills/${s.skill}/SKILL.md`;
    const sub = read(subPath);
    const skill = read(skillPath);
    assert.ok(sub.startsWith(`${s.heading}\n`), `${subPath} must open with the H1 line ${JSON.stringify(s.heading)}`);
    assert.ok(sub.includes(s.bodyLiteral), `${subPath} must carry the moved body (literal ${JSON.stringify(s.bodyLiteral)})`);
    assert.ok(skill.includes(`\`${s.sub}\``), `${skillPath} must cite \`${s.sub}\` so the branch is loaded by file name`);
    assert.equal(skill.includes(s.bodyLiteral), false, `${skillPath} still carries the moved body — the extraction is a move, not a copy`);
  });
}
