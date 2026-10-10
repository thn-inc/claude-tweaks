'use strict';
// tests/helpers/read-skill.js — #2763: shared EOL-normalizing read for
// prose-conformance suites that assert on literals, headings, or byte counts
// in plugin/skills/**/*.md, docs/**/*.md, CLAUDE.md, and .gitignore.
//
// This repo has core.autocrlf=true and no .gitattributes, so a Windows
// checkout (fresh clone, revert, `git checkout --`) can carry CRLF line
// endings in the working copy while files written by an editor or the Write
// tool stay LF. A raw `fs.readFileSync(path, 'utf8')` then fails
// literal/heading/byte-count assertions that hold on an LF checkout — not
// because the content changed, but because the line-ending convention did.
//
// readText(absPath) normalizes \r\n -> \n before returning, the same
// normalization tests/skill-mode-split-conformance.test.js already applied
// inline before this helper existed. Every prose-conformance suite that
// reads governed markdown for a literal assertion should route its read
// through this helper instead of a private fs.readFileSync call.
const fs = require('node:fs');

function readText(absPath) {
  return fs.readFileSync(absPath, 'utf8').replace(/\r\n/g, '\n');
}

module.exports = { readText };
