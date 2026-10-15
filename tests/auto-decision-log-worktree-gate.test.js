'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { readText } = require('./helpers/read-skill');
// #596: skills/_shared/auto-decision-log.md falsely claimed a skill already
// running inside a /flow-/build-created worktree "is unaffected ... the
// worktree already satisfies the gate" for decisions.md appends. It does
// not — the run directory is anchored to the main checkout while the
// session runs in the worktree, so Edit/Write/heredoc/redirect attempts
// against it are refused regardless of worktree existence. This pin:
// (1) asserts the false claim and its worktree-conditional append-shape
// block are gone, replaced by one unconditional log-decision instruction;
// (2) asserts pipeline-run-dir.md no longer illustrates the same obsolete
// heredoc/redirect append shape for decisions.md; (3) a repo-wide negative
// sweep — no plugin/skills/**/*.md file prescribes a `>>`/`<<` append
// against decisions.md under a run-dir variable, catching a future
// regression anywhere in the tree, not just these two known files.

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));

const AUTO_DECISION_LOG = read('plugin', 'skills', '_shared', 'auto-decision-log.md');
const PIPELINE_RUN_DIR = read('plugin', 'skills', '_shared', 'pipeline-run-dir.md');

test('auto-decision-log.md no longer claims a worktree "already satisfies the gate"', () => {
  assert.doesNotMatch(AUTO_DECISION_LOG, /already satisfies the gate/);
});

test('auto-decision-log.md no longer gates the append shape on worktree existence', () => {
  assert.doesNotMatch(AUTO_DECISION_LOG, /before a worktree exists for this run/);
});

test('auto-decision-log.md states the append path is unconditional regardless of worktree state', () => {
  assert.match(
    AUTO_DECISION_LOG,
    /regardless of whether the session sits in a worktree or the main checkout/,
  );
});

test('pipeline-run-dir.md no longer illustrates a heredoc/redirect append to decisions.md', () => {
  assert.doesNotMatch(PIPELINE_RUN_DIR, /cat >> "\$RUN_DIR\/decisions\.md"/);
});

test('pipeline-run-dir.md cites bin/log-decision.js for the Edit/Write refusal case', () => {
  assert.match(PIPELINE_RUN_DIR, /bin\/log-decision\.js/);
});

// --- Repo-wide negative sweep (Deliverable 4) ---
// Windowed, not a same-line-only match: a redirect/heredoc token can wrap
// onto an adjacent line in prose (see the project's own
// whitespace-spanning-sweep-greps lesson), so this scans a character
// window around every decisions.md occurrence rather than requiring both
// tokens on one line.

function findSkillFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findSkillFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

test('no plugin/skills/**/*.md file prescribes a >>/<< append to decisions.md under a run-dir variable', () => {
  const skillsDir = path.join(ROOT, 'plugin', 'skills');
  const offenders = [];
  for (const file of findSkillFiles(skillsDir)) {
    const text = fs.readFileSync(file, 'utf8');
    let idx = text.indexOf('decisions.md');
    while (idx !== -1) {
      const windowStart = Math.max(0, idx - 120);
      const windowEnd = Math.min(text.length, idx + 40);
      const window = text.slice(windowStart, windowEnd);
      // A redirect (>>) or heredoc (<<) token in the same window as a
      // decisions.md occurrence under a $RUN_DIR-shaped variable name.
      if (/(>>|<<)\s*['"]?\$\{?(RUN_DIR|PIPELINE_RUN_DIR)\}?\/?[^\s'"]*decisions\.md/.test(window)
        || /decisions\.md['"]?\s*(>>|<<)/.test(window)) {
        offenders.push(`${path.relative(ROOT, file)} (near offset ${idx})`);
      }
      idx = text.indexOf('decisions.md', idx + 1);
    }
  }
  assert.deepStrictEqual(offenders, [], `stale append-shape prescriptions found: ${offenders.join(', ')}`);
});
