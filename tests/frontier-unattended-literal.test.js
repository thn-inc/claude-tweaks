'use strict';

// Pins record #648's contract: a Frontier singleton call site must never
// hard-code --unattended (the resolver reads it as "no human present" and
// unconditionally degrades Frontier, making the singleton slot dead at its
// call site). The one legitimate written headless-context command lives on
// an explicit allowlist below — never a proximity heuristic, whose
// discrimination proved coincidental. \s+ spans newlines deliberately — the
// original offender in skills/feedback/session-evaluation.md wrapped
// mid-command ("frontier\n--unattended"), which a plain single-line grep
// misses.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

function mdFilesUnder(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...mdFilesUnder(p));
    else if (entry.name.endsWith('.md')) out.push(p);
  }
  return out;
}

test('no unguarded "frontier --unattended" literal in skills/ (whitespace-spanning)', () => {
  // Explicit allowlist of the one legitimate written headless-context command
  // (skills/init/claude-md-template.md), because proximity heuristic's discrimination
  // was coincidental (measured margin: 72 chars at the protected site).
  const ALLOWED = new Set(['plugin/skills/init/claude-md-template.md']);

  const root = path.join(__dirname, '..', 'plugin', 'skills');
  const offenders = [];
  for (const file of mdFilesUnder(root)) {
    const rel = path.relative(path.join(__dirname, '..'), file).split(path.sep).join('/');
    if (ALLOWED.has(rel)) continue;

    const text = readText(file);
    const re = /frontier\s+--unattended/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      const lineNum = text.slice(0, m.index).split('\n').length;
      offenders.push(`${rel}:${lineNum}`);
    }
  }
  assert.deepEqual(offenders, [], `Unguarded frontier --unattended literal(s): ${offenders.join('; ')}`);
});
