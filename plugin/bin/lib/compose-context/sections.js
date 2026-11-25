// bin/lib/compose-context/sections.js — named-section selection for composed
// bundles (#5668). Pure: no fs, no shell. A source listed with selectors
// contributes only the named slices, so a child bundle carries the rules its
// prompt cites instead of the whole shared file.
//
// Selector kinds (a selector is the literal first line of the slice):
//   "## Heading"   a markdown heading; the slice runs to the line before the
//                  next heading of the same or higher level, or to EOF
//   "**Lead.**"    a bold lead; the slice runs to the line before the next
//                  blank line or heading line, or to EOF
// Each selector must match exactly one line. Lines inside a fenced code block
// never match and never end a slice (fence state comes from parseMarkers).
// Slices come back in selector order, joined by one blank line. Callers pass
// LF-normalized content and prefix errors with the file (err.file).
'use strict';

const { parseMarkers } = require('./compose');

const HEADING_SELECTOR_RE = /^#{1,6} /;
const HEADING_LINE_RE = /^(#{1,6}) /;

class SectionError extends Error {
  constructor(message, { file = null, selector = null } = {}) {
    super(message);
    this.name = 'SectionError';
    this.file = file;
    this.selector = selector;
  }
}

function trimTrailingBlank(lines) {
  let end = lines.length;
  while (end > 0 && /^\s*$/.test(lines[end - 1])) end--;
  return lines.slice(0, end);
}

function selectSections(content, selectors, label) {
  const lines = String(content).split('\n');
  const tokens = parseMarkers(content, label);
  const fail = (message, selector) => { throw new SectionError(message, { file: label, selector }); };
  if (!Array.isArray(selectors) || selectors.length === 0) fail('no section selectors given', null);
  // depthAt[i]: open when-blocks around line i (an open line itself counts as outside).
  const depthAt = [];
  let depth = 0;
  tokens.forEach((t, i) => {
    if (t.type === 'close') depth--;
    depthAt[i] = depth;
    if (t.type === 'open') depth++;
  });
  const taken = [];
  const slices = selectors.map((selector) => {
    const isHeading = HEADING_SELECTOR_RE.test(selector);
    if (!isHeading && !selector.startsWith('**')) {
      fail(`unknown selector shape "${selector}" (expected a markdown heading or a **bold lead**)`, selector);
    }
    const hits = [];
    lines.forEach((line, i) => {
      if (tokens[i].fenced) return;
      if (isHeading ? line.trimEnd() === selector : line.startsWith(selector)) hits.push(i);
    });
    if (hits.length === 0) fail(`section selector "${selector}" not found`, selector);
    if (hits.length > 1) fail(`section selector "${selector}" matches ${hits.length} lines`, selector);
    const start = hits[0];
    let end = lines.length;
    if (isHeading) {
      const level = selector.indexOf(' ');
      for (let i = start + 1; i < lines.length; i++) {
        if (tokens[i].fenced) continue;
        const m = lines[i].match(HEADING_LINE_RE);
        if (m && m[1].length <= level) { end = i; break; }
      }
    } else {
      for (let i = start + 1; i < lines.length; i++) {
        if (tokens[i].fenced) continue;
        if (/^\s*$/.test(lines[i]) || HEADING_LINE_RE.test(lines[i])) { end = i; break; }
      }
    }
    if (depthAt[start] > 0) fail(`section selector "${selector}" starts inside a when: block`, selector);
    const kept = trimTrailingBlank(lines.slice(start, end));
    const stop = start + kept.length;
    if (taken.some(([s, e]) => start < e && s < stop)) fail(`section selector "${selector}" overlaps an earlier selector`, selector);
    taken.push([start, stop]);
    return kept.join('\n');
  });
  return `${slices.join('\n\n')}\n`;
}

module.exports = { selectSections, SectionError };
