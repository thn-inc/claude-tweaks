'use strict';

// Test tooling, not plugin code: argument-hint frontmatter extraction for the
// conformance suites under tests/. It lives in tests/helpers/ so the installed
// plugin does not ship it (#5538). Import the functions from here, never from
// a test file: requiring a test file re-runs its `test()` calls inside the
// importer's process and inflates node --test's reported count (#751).

const { splitFrontmatterFence } = require('../../plugin/bin/lib/health-core/frontmatter-list');

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
