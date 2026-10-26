// bin/lib/work-backend.js — the one CLAUDE.md `work-backend:` and `work-types:` reader
// (#3554; `work-types:` added by #4168).
// The keys live in CLAUDE.md's `## Work records` block, not policy.yml
// (`_shared/work-record-config.md`), so policy-schema.js cannot resolve it. An
// absent file or line is UNCONFIGURED: the reader returns null and never
// applies a default — a default would make an undeclared project look
// configured. Read-only; every consumer shares these regexes.
'use strict';
const fs = require('fs');
const path = require('path');

// Horizontal whitespace only: `\s` also matches a newline, so a blank
// `work-backend:` line would borrow the next single-token line as its value.
const WORK_BACKEND_RE = /^work-backend:[ \t]*(\S+)[ \t]*$/m;
const WORK_TYPES_RE = /^work-types:[ \t]*(\S+)[ \t]*$/m;

// The `work-backend:` value from CLAUDE.md text, or null when the input is not
// a string or no line matches.
function parseWorkBackend(text) {
  if (typeof text !== 'string') return null;
  const m = WORK_BACKEND_RE.exec(text);
  return m ? m[1] : null;
}

// The `work-backend:` value from `root/CLAUDE.md`, or null. Never throws: any
// read error (absent file, a directory, an injected readFile that throws) is null.
function readWorkBackend(root, { readFile = fs.readFileSync } = {}) {
  try {
    return parseWorkBackend(readFile(path.join(root, 'CLAUDE.md'), 'utf8'));
  } catch {
    return null;
  }
}

// The `work-types:` value from CLAUDE.md text, or null — same contract as parseWorkBackend.
function parseWorkTypes(text) {
  if (typeof text !== 'string') return null;
  const m = WORK_TYPES_RE.exec(text);
  return m ? m[1] : null;
}

// The `work-types:` value from `root/CLAUDE.md`, or null. Never throws, like readWorkBackend.
function readWorkTypes(root, { readFile = fs.readFileSync } = {}) {
  try {
    return parseWorkTypes(readFile(path.join(root, 'CLAUDE.md'), 'utf8'));
  } catch {
    return null;
  }
}

module.exports = { parseWorkBackend, readWorkBackend, parseWorkTypes, readWorkTypes };
