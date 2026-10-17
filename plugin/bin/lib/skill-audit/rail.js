'use strict';

// The Read-limit rail over a plugin corpus (#3306): every shipped skill .md
// (bytes and lines), every compose call site's max composed bytes, and every
// description, each mapped to the entry shape budgets.js's overRail judges.
// Shipped (not a test helper) so harness-health's rail check (#3310) and the
// rail tests run the same mapping — the live-corpus rail tests in
// context-cost.test.js and their go-red fixtures in budgets.test.js call it
// with different roots.
const fs = require('node:fs');
const path = require('node:path');

const {
  corpusDir,
  measureSkills,
  measureSubFiles,
  composedBytesReport,
  measureDescriptions,
} = require('./context-cost.js');
const { overRail, DESCRIPTION_MAX_CHARS } = require('./budgets.js');

// Lines as Read counts them: CRLF-normalized, and a trailing newline ends the
// last line rather than starting another.
function lineCount(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  if (text === '') return 0;
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

// Every shipped skill .md (each SKILL.md plus every sub-file) over the byte or
// line rail. Bytes are measuredBytes's (CRLF-normalized, marker-stripped).
function skillFileRailViolations(root) {
  const dir = corpusDir(root);
  const skills = measureSkills(root).map((s) => {
    const file = `${s.name}/SKILL.md`;
    return { file, bytes: s.bytes, lines: lineCount(path.join(dir, file)) };
  });
  const subFiles = measureSubFiles(root).map((s) => ({
    file: s.file, bytes: s.bytes, lines: lineCount(path.join(dir, s.file)),
  }));
  return overRail([...skills, ...subFiles]);
}

// Every compose call site whose max composed bytes exceed the byte rail. A
// row with no measured max (an error or unparsed row) is a violation too —
// an unmeasured bundle never passes silently.
function composedRailViolations(root) {
  const out = [];
  const measured = [];
  for (const row of composedBytesReport(root)) {
    const file = `${row.step} @ ${row.file}:${row.line}`;
    if (row.error || typeof row.max !== 'number') out.push({ file, error: row.error || 'no measured max' });
    else measured.push({ file, bytes: row.max });
  }
  return [...out, ...overRail(measured)];
}

// Every skill description over the CLI's per-description listing max.
// `root` is the plugin root (`plugin/`), never the repo root.
function descriptionRailViolations(root) {
  return measureDescriptions(root).filter((d) => d.chars > DESCRIPTION_MAX_CHARS);
}

module.exports = {
  lineCount,
  skillFileRailViolations,
  composedRailViolations,
  descriptionRailViolations,
};
