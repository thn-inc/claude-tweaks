'use strict';

// argument-hint frontmatter extraction, shared by the argument-hint <-> ##
// Input sync guard (tests/argument-hint-input.test.js) and every test file
// that needs a skill's argument-hint value for its own, unrelated assertions
// (tests/argument-hint-mirrors.test.js, tests/batch-ref-argument.test.js,
// tests/specify-batch-input.test.js, tests/specify-next-mode.test.js). Those
// four files used to `require('./argument-hint-input.test.js')` directly,
// which re-executes that file's own `test()` calls inside each importer's
// process and inflates node --test's reported count for every importer
// (#751). Extracted here so importers pull only the function, not a test
// file's registrations.

const { splitFrontmatterFence } = require('../health-core/frontmatter-list');

// argument-hint is a single-line scalar frontmatter value, quoted with either
// ' or " (CLAUDE.md: "Always quote the value"). Strip the surrounding quotes
// only -- the hint's own content may itself contain the other quote style
// (e.g. capture's `--title="..."` inside a single-quoted hint).
function extractArgumentHint(content) {
  const split = splitFrontmatterFence(content);
  if (!split) return null;
  const line = split.frontmatter.find((l) => /^argument-hint:\s*/.test(l));
  if (!line) return null;
  const raw = line.replace(/^argument-hint:\s*/, '').trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

// Returns the text between the `## Input` heading and the next `## `
// heading (or end of file). No `\Z`/lookahead-to-end trick -- JS regex has
// neither, so this scans heading start indices directly instead.
function inputSectionBody(content) {
  const headings = [...content.matchAll(/^## .*$/gm)];
  const start = headings.find((m) => m[0] === '## Input');
  if (!start) return null;
  const startIdx = start.index + start[0].length;
  const next = headings.find((m) => m.index > start.index);
  const endIdx = next ? next.index : content.length;
  return content.slice(startIdx, endIdx);
}

module.exports = { extractArgumentHint, inputSectionBody };
