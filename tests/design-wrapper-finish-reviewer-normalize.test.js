// tests/design-wrapper-finish-reviewer-normalize.test.js — pins #2984's
// normalization rule for skills/design-wrapper/modes/review.md Step 3.7 +
// Step 4's "Adapting the finishing review" mapping: a first-line
// `disposition: ship|fix|rebuild|recapture` word, followed by exactly five
// named sections (`persistence`, `fidelity`, `ceiling`, `material_fixes`,
// `keep`) or, on `recapture`, a single `recapture` section replacing all
// five.
//
// review.md's own procedure is prose an LLM agent follows by hand at
// dispatch time — there is no production module that calls a function to do
// this. The `normalizeFinishReview` helper below is a REFERENCE
// implementation of that prose rule, written only so the rule itself is
// provably unambiguous and mechanically checkable (the AC's "prose plus a
// small helper" option) — nothing in the pipeline imports or calls it.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const DISPOSITIONS = ['ship', 'fix', 'rebuild', 'recapture'];
const SECTIONS = ['persistence', 'fidelity', 'ceiling', 'material_fixes', 'keep'];

function splitSections(text, names) {
  const re = new RegExp(`^(${names.join('|')}):\\s*$`, 'i');
  const sections = {};
  let current = null;
  for (const line of text.split('\n')) {
    const m = re.exec(line.trim());
    if (m) {
      current = m[1].toLowerCase();
      sections[current] = [];
    } else if (current) {
      sections[current].push(line);
    }
  }
  for (const key of Object.keys(sections)) sections[key] = sections[key].join('\n').trim();
  return sections;
}

// reply text -> { disposition, findings: [{severity, category, message}] }
//            | { unparseable: true, reason }
function normalizeFinishReview(replyText) {
  const lines = String(replyText).split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i >= lines.length) return { unparseable: true, reason: 'empty reply' };

  const m = /^disposition:\s*(\S+)/i.exec(lines[i].trim());
  if (!m || !DISPOSITIONS.includes(m[1].toLowerCase())) {
    return { unparseable: true, reason: 'unknown or missing disposition word' };
  }
  const disposition = m[1].toLowerCase();
  const rest = lines.slice(i + 1).join('\n');

  if (disposition === 'recapture') {
    const sections = splitSections(rest, ['recapture']);
    if (!sections.recapture) {
      return { unparseable: true, reason: 'missing or empty recapture section' };
    }
    return {
      disposition,
      findings: [{ severity: 'warning', category: 'contract', message: sections.recapture }],
    };
  }

  const sections = splitSections(rest, SECTIONS);
  for (const name of SECTIONS) {
    if (!(name in sections)) return { unparseable: true, reason: `missing section: ${name}` };
  }

  if (disposition === 'ship') return { disposition, findings: [] };

  const fixes = sections.material_fixes.split('\n').map((l) => l.trim()).filter(Boolean);
  if (fixes.length === 0) {
    return { unparseable: true, reason: `${disposition} with empty material_fixes` };
  }

  if (disposition === 'fix') {
    return {
      disposition,
      findings: fixes.map((message) => ({ severity: 'warning', category: 'contract', message })),
    };
  }

  // rebuild
  return {
    disposition,
    findings: [{ severity: 'error', category: 'contract', message: fixes[0] }],
  };
}

test('ship gives zero findings', () => {
  const reply = [
    'disposition: ship',
    'persistence:',
    'Pass — PRODUCT.md present.',
    '',
    'fidelity:',
    'Faithful.',
    '',
    'ceiling:',
    'reached',
    '',
    'material_fixes:',
    '',
    'keep:',
    'The asymmetric masthead.',
  ].join('\n');
  const result = normalizeFinishReview(reply);
  assert.equal(result.disposition, 'ship');
  assert.deepEqual(result.findings, []);
});

test('fix with three material fixes and a missing-inputs line gives three medium (warning) findings', () => {
  const reply = [
    'disposition: fix',
    'Missing inputs: none.',
    'persistence:',
    'Pass.',
    '',
    'fidelity:',
    'TYPE match; GROUND slightly cool.',
    '',
    'ceiling:',
    'reached',
    '',
    'material_fixes:',
    "Tighten hero headline tracking to match comp.",
    "Swap CTA shadow for comp's embossed treatment.",
    'Increase mobile padding to 24px per comp.',
    '',
    'keep:',
    'The asymmetric masthead — do not centre it while fixing spacing.',
  ].join('\n');
  const result = normalizeFinishReview(reply);
  assert.equal(result.disposition, 'fix');
  assert.equal(result.findings.length, 3);
  for (const finding of result.findings) assert.equal(finding.severity, 'warning');
});

test('rebuild gives one high (error) finding carrying the first material fix', () => {
  const reply = [
    'disposition: rebuild',
    'persistence:',
    'Pass.',
    '',
    'fidelity:',
    'MATERIAL contradicted on hero — flat CSS where comp shows painted texture.',
    '',
    'ceiling:',
    'reached',
    '',
    'material_fixes:',
    "Rebuild: re-derive the hero region from the comp's painted-texture treatment.",
    'Produce a new hero asset.',
    '',
    'keep:',
    'Nothing yet — rebuild first.',
  ].join('\n');
  const result = normalizeFinishReview(reply);
  assert.equal(result.disposition, 'rebuild');
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].severity, 'error');
  assert.match(result.findings[0].message, /re-derive the hero region/);
});

test('recapture gives one medium (warning) finding naming the invalid captures', () => {
  const reply = [
    'disposition: recapture',
    'recapture:',
    'mobile.png is blank — recapture the mobile viewport before any other check.',
  ].join('\n');
  const result = normalizeFinishReview(reply);
  assert.equal(result.disposition, 'recapture');
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].severity, 'warning');
  assert.match(result.findings[0].message, /mobile\.png is blank/);
});

test('fix with an empty material_fixes gives one unparseable outcome, never a clean pass', () => {
  const reply = [
    'disposition: fix',
    'persistence:',
    'Pass.',
    '',
    'fidelity:',
    'Faithful.',
    '',
    'ceiling:',
    'reached',
    '',
    'material_fixes:',
    '',
    'keep:',
    'Nothing to protect.',
  ].join('\n');
  const result = normalizeFinishReview(reply);
  assert.equal(result.unparseable, true);
});

test('a reply missing the keep section gives one unparseable outcome', () => {
  const reply = [
    'disposition: fix',
    'persistence:',
    'Pass.',
    '',
    'fidelity:',
    'Faithful.',
    '',
    'ceiling:',
    'reached',
    '',
    'material_fixes:',
    'Tighten hero headline tracking to match comp.',
  ].join('\n');
  const result = normalizeFinishReview(reply);
  assert.equal(result.unparseable, true);
  assert.match(result.reason, /missing section: keep/);
});
