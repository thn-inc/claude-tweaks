'use strict';

// Test tooling, not plugin code: a parser for the corpus-wide conformance
// suite under tests/. It lives in tests/helpers/ so the installed plugin does
// not ship it (#5538).
//
// Parser for `AskUserQuestion` option `description` fields authored in skill
// prose, per docs/skill-authoring.md's "Decisions" bullet: a description
// states the consequence of choosing an option, in one clause — never the
// deliberation behind a recommendation. A literal `?` inside the field is the
// discriminating signal for that failure mode (a self-posed question leaking
// into the option surface); see docs/skill-authoring.md and the record this
// module implements (#659) for why `?` was chosen over a length threshold —
// the corpus has legitimate long descriptions a length gate would
// false-positive on.
//
// The corpus convention this parses is a single-line option block:
//   - Option N — `label`: `"..."`, `description`: `"..."`
// (in-fence templates use the same shape inside a code block). Multi-line
// description fields are out of scope — none exist in the corpus today.

const fs = require('node:fs');
const path = require('node:path');

// Matches `` `description`: `"..."` `` on one line, capturing the field's
// literal content. `(?:[^"\\]|\\.)*` is escape-aware: a backslash-escaped
// quote (`\"`) does not terminate the match, matching how the corpus already
// writes an embedded quote inside a description (e.g. research/verify-mode.md).
const DESCRIPTION_FIELD = /`description`:\s*`"((?:[^"\\]|\\.)*)"`/g;

function extractDescriptionFields(markdown) {
  const out = [];
  markdown.split('\n').forEach((line, idx) => {
    for (const m of line.matchAll(DESCRIPTION_FIELD)) {
      out.push({ line: idx + 1, text: m[1] });
    }
  });
  return out;
}

function flagQuestionMarks(fields) {
  return fields.filter((f) => f.text.includes('?'));
}

// Every `.md` file under `skillsDir`, recursive, sorted. Unlike
// skill-catalog.js's listSkillDirs (directory names with a SKILL.md) or
// context-cost.js's measureSubFiles (excludes SKILL.md), this returns every
// markdown file — SKILL.md and every sub-file both carry AskUserQuestion
// option blocks in this corpus.
function listMarkdownFiles(skillsDir) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (entry.name.endsWith('.md')) out.push(p);
    }
  };
  walk(skillsDir);
  return out.sort();
}

module.exports = { extractDescriptionFields, flagQuestionMarks, listMarkdownFiles };
