// bin/lib/design-session/design-md.js — section readers for a /claude-tweaks:design
// session's design.md, shared by status.js and brief.js. Fences follow the one
// CommonMark rule in ../markdown-blocks.js. No I/O.
'use strict';

const { fencedLineMask } = require('../markdown-blocks');
const { H2_RE, splitLines } = require('./notes');

// Lines of the `## {heading}` section, heading excluded, up to the next `## `
// line outside a fence; null when the heading is absent.
function sectionLines(designText, heading) {
  const range = sectionRange(designText, heading);
  return range && range.body;
}

// -> { start: line index of the `## {heading}` line, body: its section lines },
// bounded as sectionLines describes; null when the heading is absent.
function sectionRange(designText, heading) {
  const lines = splitLines(designText);
  const fenced = fencedLineMask(lines);
  let start = null;
  let body = null;
  for (let i = 0; i < lines.length; i++) {
    const h2 = !fenced[i] && H2_RE.test(lines[i]);
    if (body) {
      if (h2) break;
      body.push(lines[i]);
    } else if (h2 && lines[i].replace(/^##\s+/, '').trim() === heading) {
      start = i;
      body = [];
    }
  }
  return body && { start, body };
}

// First `{key}: value` line in the section, trimmed; null when absent.
function sectionField(designText, heading, key) {
  const re = new RegExp(`^\\s*${key}:\\s*(.*?)\\s*$`, 'i');
  for (const line of sectionLines(designText, heading) || []) {
    const m = re.exec(line);
    if (m) return m[1];
  }
  return null;
}

module.exports = { sectionLines, sectionRange, sectionField };
