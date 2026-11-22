'use strict';
// tests/helpers/planning-decisions-clauses.js — #6051: the three defining clauses of
// plugin/skills/_shared/planning-decisions.md's asked classes, and the sweep that finds every file
// stating one. AC5 makes that shared file the only place the classes are stated, so the plan-review
// suites (tests/planning-decisions-conformance.test.js and the asked-classes routing suite) share
// one copy of the clauses instead of retyping them.

// (a) design-level, (b) hard to undo, (c) contradiction — each class's own defining clause.
const CLASS_CLAUSES = [
  'says the work is for, who it serves, its shape',
  'falls in a risk category the record keeps in',
  'No reading keeps every Acceptance Criterion and recorded decision intact',
];

// The clause auto-mode-contract.md's plan-review needs-human HARD-GATE row ends with under
// `planning-decisions: asked-classes` (closing paren included). One copy for the convergence and
// hard-gate conformance suites.
const ASKED_CLASSES_TEXT = 'under `planning-decisions: asked-classes`, only a row `_shared/planning-decisions.md` asks, #6051)';

const normalize = (s) => s.replace(/\s+/g, ' ').toLowerCase();

// files: Map<relPath, text>. Returns every relPath whose whitespace-collapsed, lowercased text
// includes any class clause, in the map's order. Collapsing keeps a clause hard-wrapped across lines
// visible; lowercasing keeps a restatement that starts mid-sentence ("no reading keeps …") visible.
function classStatementSites(files) {
  const clauses = CLASS_CLAUSES.map(normalize);
  const out = [];
  for (const [rel, text] of files) {
    const flat = normalize(text);
    if (clauses.some((clause) => flat.includes(clause))) out.push(rel);
  }
  return out;
}

module.exports = { CLASS_CLAUSES, ASKED_CLASSES_TEXT, classStatementSites };
