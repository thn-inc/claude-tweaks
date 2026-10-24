// tests/wrap-up-registry-pin.test.js
//
// Binds skills/wrap-up/SKILL.md's Phase 2 registry table to the code registry
// it documents (bin/lib/wrap-up/registry.js). The table is prose restating a
// data structure — target, judge file, and disposition per curation row — and
// nothing enforced that the two stay in sync. A row added, reordered, or
// edited on one side and not the other would silently misdescribe the engine's
// actual behaviour to anyone reading SKILL.md. [IL-80] warns against reading
// live production prose in a test — it's acceptable HERE, and only here,
// because the table IS the declared contract whose update is the intended
// action when the registry changes (see the house pattern in
// tests/hooks-gate-coverage.test.js).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { REGISTRY } = require('../plugin/bin/lib/wrap-up/registry');
const { readText } = require('./helpers/read-skill');

const SKILL_PATH = path.join(__dirname, '..', 'plugin', 'skills', 'wrap-up', 'SKILL.md');
const skill = readText(SKILL_PATH);

// Strip markdown inline formatting (backticks, bold) from a table cell so
// `` `apply-or-stage` `` compares equal to the raw string 'apply-or-stage'.
function stripFormatting(cell) {
  return cell.trim().replace(/`/g, '').replace(/\*\*/g, '').trim();
}

function splitRow(line) {
  // A markdown table row: leading/trailing '|' are optional-ish but SKILL.md's
  // rows are fully piped ('| a | b | c |'). Drop the empty strings produced by
  // the leading/trailing delimiter.
  const cells = line.split('|').map((c) => c.trim());
  if (cells.length && cells[0] === '') cells.shift();
  if (cells.length && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

function proseRows() {
  const lines = skill.split('\n');
  const headerIdx = lines.findIndex(
    (l) => l.includes('| Target |') && l.includes('| Judge |')
  );
  assert.ok(
    headerIdx !== -1,
    'SKILL.md must contain a registry table whose header row has both "| Target |" and "| Judge |"'
  );

  const header = splitRow(lines[headerIdx]);
  const targetCol = header.indexOf('Target');
  const gateCol = header.indexOf('Gate');
  const scopeCol = header.indexOf('Scope');
  const judgeCol = header.indexOf('Judge');
  const dispositionCol = header.indexOf('Disposition');
  assert.ok(
    targetCol !== -1 && gateCol !== -1 && scopeCol !== -1 && judgeCol !== -1 && dispositionCol !== -1,
    'registry table header must have Target, Gate, Scope, Judge, and Disposition columns'
  );

  // Row after the header is the '|---|---|' separator; body rows start after it.
  const rows = [];
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith('|')) break; // table ended
    const cells = splitRow(line);
    rows.push({
      target: stripFormatting(cells[targetCol] || ''),
      gate: (cells[gateCol] || '').trim(),
      scope: (cells[scopeCol] || '').trim(),
      judge: stripFormatting(cells[judgeCol] || ''),
      disposition: stripFormatting(cells[dispositionCol] || ''),
    });
  }
  return rows;
}

// Count the distinct conditions a Gate cell's prose describes: this table's
// house style is an Oxford-comma list ("X, Y, or Z"), one comma per boundary
// between conditions, so (comma count + 1) is the condition count. This is a
// structural proxy for anyOf.length + orSignals.length — it can't verify the
// prose names the *correct* condition (that's still a human judgment at
// review time), but it catches the gap class the two 6.71.0 drifts belong to:
// a condition added to or removed from the registry without a matching edit
// to the prose.
//
// Deliberately NOT "or"-splitting: a single condition can itself be phrased
// as an internal disjunction with no comma ("renamed or removed", "renamed or
// deleted target") — splitting on every bare " or " over-counts those as two
// conditions. Comma-count avoids that trap because this table's authored
// style never puts a comma inside one condition's own phrasing, only between
// conditions.
function countGateConditions(gateCell) {
  const commaCount = (gateCell.match(/,/g) || []).length;
  return commaCount + 1;
}

function gateConditionCount(gate) {
  if (gate.kind === 'facts') {
    return gate.anyOf.length + (gate.orSignals ? gate.orSignals.length : 0);
  }
  if (gate.kind === 'signals') {
    return 1; // a single signals key, e.g. adrCandidateCount
  }
  throw new Error(`unhandled gate kind "${gate.kind}" — extend gateConditionCount`);
}

// Extract every integer literal from a Scope cell's prose (e.g. "top 5
// (fast-lane 2; ...)" -> [5, 2]). Used to cross-check registry.js's own cap /
// fastLaneCap numbers actually appear in the prose, in order.
function extractScopeCaps(scopeCell) {
  const matches = scopeCell.match(/\d+/g);
  return matches ? matches.map(Number) : [];
}

test('SKILL.md registry table row order matches registry.js row order', () => {
  const prose = proseRows();
  assert.deepStrictEqual(
    prose.map((p) => p.target),
    REGISTRY.map((r) => r.target),
    'SKILL.md\'s registry table target column, read top to bottom, must match REGISTRY\'s target sequence exactly — a swapped or reordered row will show up as a full-sequence diff here'
  );
});

test('SKILL.md registry table matches registry.js — same rows, same fields', () => {
  const prose = proseRows();
  assert.strictEqual(
    prose.length,
    REGISTRY.length,
    `SKILL.md's registry table has ${prose.length} rows, registry.js has ${REGISTRY.length} — add or remove a row in both places`
  );
  prose.forEach((p, i) => {
    const r = REGISTRY[i];
    assert.strictEqual(
      p.target,
      r.target,
      `row ${i} ("${r.target}"): SKILL.md target "${p.target}" !== registry.js target "${r.target}"`
    );
    assert.ok(
      p.judge.includes(r.judge),
      `row ${i} ("${r.target}"): SKILL.md judge cell "${p.judge}" does not include registry.js judge "${r.judge}"`
    );
    assert.strictEqual(
      p.disposition,
      r.disposition,
      `row ${i} ("${r.target}"): SKILL.md disposition "${p.disposition}" !== registry.js disposition "${r.disposition}"`
    );
  });
});

test('every judge file the registry names exists in skills/wrap-up/', () => {
  for (const r of REGISTRY) {
    assert.ok(
      fs.existsSync(path.join(__dirname, '..', 'plugin', 'skills', 'wrap-up', r.judge)),
      `registry.js names judge "${r.judge}" for target "${r.target}" but skills/wrap-up/${r.judge} does not exist`
    );
  }
});

test('SKILL.md Gate cell condition count matches registry.js anyOf + orSignals count', () => {
  const prose = proseRows();
  prose.forEach((p, i) => {
    const r = REGISTRY[i];
    const expected = gateConditionCount(r.gate);
    const actual = countGateConditions(p.gate);
    assert.strictEqual(
      actual,
      expected,
      `row ${i} ("${r.target}"): SKILL.md Gate cell describes ${actual} condition(s) ("${p.gate}") but registry.js's gate spec has ${expected} (anyOf: ${JSON.stringify(r.gate.anyOf || [])}, orSignals: ${JSON.stringify(r.gate.orSignals || [])}, kind: "${r.gate.kind}") — add or remove a condition in both places`
    );
  });
});

test('SKILL.md Scope cell cap numbers match registry.js scope cap/fastLaneCap', () => {
  const prose = proseRows();
  prose.forEach((p, i) => {
    const r = REGISTRY[i];
    if (r.scope.kind !== 'domain-overlap') return; // only domain-overlap rows carry cap numbers
    const caps = extractScopeCaps(p.scope);
    assert.ok(
      caps.includes(r.scope.cap),
      `row ${i} ("${r.target}"): SKILL.md Scope cell "${p.scope}" does not mention cap ${r.scope.cap} from registry.js`
    );
    assert.ok(
      caps.includes(r.scope.fastLaneCap),
      `row ${i} ("${r.target}"): SKILL.md Scope cell "${p.scope}" does not mention fast-lane cap ${r.scope.fastLaneCap} from registry.js`
    );
  });
});
