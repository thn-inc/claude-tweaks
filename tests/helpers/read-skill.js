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
// tests/raw-markdown-read-conformance.test.js (#3922) enforces it: a raw
// text-mode read of any repo-rooted path other than a JSON file fails the scan.
//
// crlfCheckoutRead(absPath) (#3574) builds the CRLF case on any OS: it returns
// { raw, text } where raw is the file's LF text with every \n turned into \r\n
// (what a Windows autocrlf checkout holds) and text is that raw copy read back
// through readText() from a temp file. A suite asserting text still finds its
// '\n\n' paragraph breaks proves readText() makes the search CRLF-safe (the
// checkout is not what does).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function readText(absPath) {
  return fs.readFileSync(absPath, 'utf8').replace(/\r\n/g, '\n');
}

function crlfCheckoutRead(absPath) {
  const raw = readText(absPath).replace(/\n/g, '\r\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-crlf-'));
  try {
    const tmp = path.join(dir, path.basename(absPath));
    fs.writeFileSync(tmp, raw);
    return { raw, text: readText(tmp) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { readText, crlfCheckoutRead };
