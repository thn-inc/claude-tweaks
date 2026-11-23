'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { STATIONS } = require('../../../plugin/bin/lib/station-events/stations');

const ROOT = path.resolve(__dirname, '../../..');
const doc = fs.readFileSync(path.join(ROOT, 'docs/reference/station-events.md'), 'utf8');

// The text from the `## {heading}` line to the next `## ` line.
function section(md, heading) {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l === `## ${heading}`);
  assert.ok(start >= 0, `docs/reference/station-events.md has no "## ${heading}" section`);
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  return lines.slice(start, end).join('\n');
}

// Cells of each row of the first table in text, after the header and separator, trimmed.
function tableRows(text) {
  const lines = text.split('\n');
  const first = lines.findIndex((l) => l.startsWith('|'));
  assert.ok(first >= 0, 'no table found');
  const rows = [];
  for (let i = first + 2; i < lines.length && lines[i].startsWith('|'); i += 1) {
    rows.push(lines[i].replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
  }
  return rows;
}

const backticked = (text) => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

test('AC1.1 every station has a row in the transition table', () => {
  const rows = tableRows(section(doc, 'Transition code by station'));
  const ids = rows.map((r) => r[0].replace(/`/g, ''));
  assert.deepEqual([...ids].sort(), [...STATIONS].sort());
  assert.equal(new Set(ids).size, ids.length);
});

test('AC1.2 every cited code path exists', () => {
  const rows = tableRows(section(doc, 'Transition code by station'));
  for (const r of rows) {
    const cell = r[1];
    if (cell === 'none') continue;
    for (const entry of cell.split('; ')) {
      const m = /^`(plugin\/bin\/[^`:]+\.js):([A-Za-z_$][\w$]*)`$/.exec(entry);
      assert.ok(m, `${r[0]}: malformed code entry ${entry}`);
      const file = path.join(ROOT, m[1]);
      assert.ok(fs.existsSync(file), `${r[0]}: ${m[1]} does not exist`);
      const fn = m[2];
      const defines = new RegExp(`(?:\\bfunction\\s*\\*?\\s*${fn}\\s*\\(|\\b(?:const|let|var)\\s+${fn}\\s*=|^\\s*(?:async\\s+)?${fn}\\s*\\([^)]*\\)\\s*\\{)`, 'm');
      assert.match(fs.readFileSync(file, 'utf8'), defines, `${r[0]}: ${m[1]} does not define ${fn}`);
    }
  }
});

test('AC1.3 the order section names every station once', () => {
  const text = section(doc, 'Station order from real moves');
  const lines = text.split('\n').filter((l) => l.startsWith('Confirmed order: '));
  assert.equal(lines.length, 1);
  const ids = lines[0].slice('Confirmed order: '.length).split(' → ').map((s) => s.replace(/`/g, ''));
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, [...STATIONS]);
});

test('AC2.1 AC2.2 the starting lists section lists observed lists only', () => {
  const rows = tableRows(section(doc, 'Starting lists'));
  assert.deepEqual(rows.map((r) => r[0].replace(/`/g, '')), ['standard', 'fast-lane', 'driver']);
  for (const r of rows) {
    let from = 0;
    for (const id of backticked(r[1])) {
      const at = STATIONS.indexOf(id, from);
      assert.ok(at >= 0, `${r[0]}: ${id} is not a station, or is out of order`);
      from = at + 1;
    }
  }
  assert.deepEqual(backticked(rows[0][1]), [...STATIONS]);
});

test('AC3 the precedence sentence and the simplify reading are stated', () => {
  const lists = section(doc, 'Starting lists');
  const sentence = 'A lane of `driver` selects the list `driver`; otherwise a ceremony profile of `fast-lane` selects `fast-lane`; otherwise the list is `standard`. An absent or unknown lane with an absent profile is `standard`, and the `planned` event carries reason `default-list`.';
  assert.ok(lists.includes(sentence), 'precedence sentence missing or altered');
  assert.match(section(doc, 'Station order from real moves'), /Polish-to-Test[^.]*`simplify`[^.]*not returns/);
});
