'use strict';

// Shared corpus → rail-violation mapping for the #3306 rail suites. The
// live-corpus rail tests (context-cost.test.js) and their go-red fixtures
// (budgets.test.js) run this same code against different roots, so a fixture
// that goes red proves the live assertion can.
const fs = require('node:fs');
const path = require('node:path');

const {
  corpusDir,
  measureSkills,
  measureSubFiles,
  composedBytesReport,
  measureDescriptions,
} = require('../../../plugin/bin/lib/skill-audit/context-cost.js');
const { overRail, DESCRIPTION_MAX_CHARS } = require('../../../plugin/bin/lib/skill-audit/budgets.js');

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
