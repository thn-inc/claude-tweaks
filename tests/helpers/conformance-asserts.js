'use strict';
// tests/helpers/conformance-asserts.js — #4827: the fact-list predicate and go-red proofs the
// prose-conformance suites share, plus the two region readers they slice with. The rules for using
// them live in .claude/skills/skill-prose-conformance-tests/SKILL.md. tests/helpers-conformance-asserts.test.js
// pins this file.
const assert = require('node:assert/strict');

// A fact-list predicate: the facts whose pattern the text no longer matches.
const missingFactsOf = (patterns) => (text) => patterns.filter(([pattern]) => !pattern.test(text)).map(([, fact]) => fact);

// The pattern as a global regex, so a strip removes every match.
const globalOf = (pattern) => new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);

function proveEachGoesRed(text, patterns, missingOf, stripWith) {
  assert.ok(patterns.length > 0, 'fact list is empty — the proof has nothing to check');
  for (const [pattern, fact] of patterns) {
    const doctored = text.replace(stripWith(pattern), '');
    assert.notEqual(doctored, text, `anchor text for "${fact}" not found — proof cannot discriminate`);
    assert.deepEqual(missingOf(doctored), [fact], `removing only "${fact}" must turn exactly that assertion red`);
  }
}

// Per-assertion go-red proof: strip one pattern's first match from the live text, and the shared
// predicate must report exactly that one fact missing. A phrase stated twice survives the strip, so
// this also forces each pattern to match exactly once.
function assertEachPatternGoesRed(text, patterns, missingOf) {
  proveEachGoesRed(text, patterns, missingOf, (pattern) => pattern);
}

// The same proof for a region that deliberately states a fact more than once: strip every match.
// Prefer assertEachPatternGoesRed; this one cannot catch a phrase that went twice by accident.
function assertEveryMatchGoesRed(text, patterns, missingOf) {
  proveEachGoesRed(text, patterns, missingOf, globalOf);
}

const lineStartingWith = (text, prefix) => text.split('\n').find((line) => line.startsWith(prefix)) || '';

// The text from a whole heading line (`## Foo`) to the next `## ` heading, or to the end of the text.
// Asserts the heading exists. The search runs over the text padded with a newline on each side, so a
// heading on the first line, or on the last line with no trailing newline, is still a whole line.
// Padding shifts every index by one, so `start` is the heading's own index in `text` and `next - 1`
// is the index of the newline that ends the section.
function sectionOf(text, heading) {
  const padded = `\n${text}\n`;
  const start = padded.indexOf(`\n${heading}\n`);
  const opening = text.split('\n', 1)[0].slice(0, 60);
  assert.notEqual(start, -1, `heading not found: ${heading} (text opens "${opening}")`);
  const next = padded.indexOf('\n## ', start + 1);
  return next === -1 ? text.slice(start) : text.slice(start, next - 1);
}

module.exports = { missingFactsOf, assertEachPatternGoesRed, assertEveryMatchGoesRed, globalOf, lineStartingWith, sectionOf };
