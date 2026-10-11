// tests/impeccable-retired-scripts-sweep.test.js
//
// Impeccable 4.2.2 retired its per-mode `.mjs` scripts (context-signals.mjs,
// doctor.mjs, concept-seed.mjs, live.mjs) and this repo's own
// `resolveImpeccablePlugin` resolver that drove them (record #2985 — the
// engine module, plugin/bin/lib/impeccable-engine, replaced all of it).
// This is a permanent conformance sweep, not a one-time cleanup check: it
// fails if any of those five retired names reappears anywhere under this
// repo's tracked sources, so a future edit (a copy-pasted sentence, a
// reverted doc, a new script that reintroduces the old resolution scheme)
// gets caught immediately rather than drifting back in silently.
//
// Matching is on each file's WHOLE TEXT with every run of whitespace
// (newlines included) collapsed to a single space — `grep -c` would miss a
// name wrapped across a markdown line break, and would count a multi-match
// line as one ([`grep -c` counts lines, not occurrences]).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');

const RETIRED_NAMES = ['context-signals.mjs', 'doctor.mjs', 'concept-seed.mjs', 'live.mjs', 'resolveImpeccablePlugin'];

const SWEPT_DIRS = ['plugin', '.claude/skills', 'docs', 'tests', 'tools'];

// Exempt by exact path, unconditionally — whatever text remains in them.
const EXEMPT_PATHS = new Set([
  'plugin/skills/design-wrapper/claude-design-skill-comparison.md',
  'plugin/skills/design-wrapper/third-party-design-skill-comparisons.md',
  'docs/incident-log.md',
  'tests/bin-lib/issues/fixtures/record-146-body.md',
  'tests/bin-lib/issues/fixtures/record-150-body.md',
  '.claude/skills/upstream-drift/judge-procedure.md',
  'tests/impeccable-retired-scripts-sweep.test.js',
]);

function isUnderDocsSuperpowersPlans(relPath) {
  return relPath.startsWith('docs/superpowers/plans/');
}

function listTrackedFiles(dir) {
  const out = execFileSync('git', ['ls-files', '--', dir], { cwd: REPO_ROOT, encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

function collapseWhitespace(text) {
  return text.replace(/\s+/g, ' ');
}

test('no tracked file reintroduces a retired Impeccable script name or resolveImpeccablePlugin', () => {
  const offenders = [];

  for (const dir of SWEPT_DIRS) {
    for (const relPath of listTrackedFiles(dir)) {
      if (EXEMPT_PATHS.has(relPath) || isUnderDocsSuperpowersPlans(relPath)) continue;
      const fullPath = path.join(REPO_ROOT, relPath);
      let text;
      try {
        text = fs.readFileSync(fullPath, 'utf8');
      } catch {
        continue; // binary or unreadable — nothing this sweep can match on
      }
      const collapsed = collapseWhitespace(text);
      for (const name of RETIRED_NAMES) {
        if (collapsed.includes(name)) {
          offenders.push(`${relPath}: contains "${name}"`);
        }
      }
    }
  }

  assert.deepStrictEqual(
    offenders,
    [],
    `retired Impeccable script name(s)/resolveImpeccablePlugin reappeared outside the exempt list:\n${offenders.join('\n')}`
  );
});
