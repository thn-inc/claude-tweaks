'use strict';

// tests/release-skill-reference-form.test.js (#2256, Task 8) — pins that every
// skill reference inside `/claude-tweaks:release`'s actionable text uses the
// fully-qualified `/claude-tweaks:{skill}` form. `docs/skill-authoring.md`
// requires the qualified form in actionable instruction text — a bare
// `/{skill}` there fails the `Skill` tool with "Unknown skill" at invocation
// time — and reserves bare short-form references for descriptive prose, which
// this test does not scan.
//
// Classification differs by file (ruling 18, fix round 1 — supersedes the
// original "## Step / ## Next Actions everywhere" resolution, which never
// read a sub-file at all: none of console.md/bookkeeping.md carry a `## Step`
// heading, so a bare reference planted under console.md's `## Inputs` stayed
// invisible to that version of the scanner):
//
// - `SKILL.md`: actionable = the body of every `## Step …` section, plus the
//   terminal `## Next Actions` block. Everything else (the Lifecycle line,
//   `## When to Use`, `## Input`, `## --train semantics`,
//   `## Component-Skill Contract`, `## Anti-Patterns`) is descriptive prose.
// - Every other `plugin/skills/release/*.md` file is a lazy-loaded sub-file,
//   read in full when its parent Step says to — actionable by construction.
//   Actionable = the whole file EXCEPT the H1 preamble before the first
//   `## ` heading (the title and its one-line "Step N of
//   /claude-tweaks:release" framing — never scanned, since section-slicing
//   only yields text after a heading) and a `## Anti-Patterns` section.
//   Nothing else in a sub-file is exempt.
//
// Two literals name a decisions-log section, not a skill invocation, and are
// never references in either classification: the `## /release` heading this
// skill's own log lines live under, and its `--section "/release"` argument.
// A `## /review` mention (SKILL.md's Step 3, reading `/claude-tweaks:review`'s
// decisions-log block) is the same exemption class. A `/` preceded by a path
// character (a letter, `.`, `}`, or another `/`) is a path segment, never a
// reference, e.g. `plugin/skills/release/SKILL.md`,
// `${CLAUDE_PLUGIN_ROOT}/bin/release-local.js`, `staged/release-held.md`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { listSkillDirs } = require('../plugin/bin/lib/skill-audit/skill-catalog');

const ROOT = path.join(__dirname, '..');
const PLUGIN_ROOT = path.join(ROOT, 'plugin');
const RELEASE_DIR = path.join(PLUGIN_ROOT, 'skills', 'release');

const SKILL_NAMES = listSkillDirs(PLUGIN_ROOT);

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Slices `text` into `{heading, start, end}` sections on line-start `## `
// headings (`start`/`end` are absolute offsets into `text`) — the same
// anchoring pattern as
// tests/feedback-next-actions-plain-markdown-conformance.test.js's
// `section()`, generalized to return every section instead of one named
// heading, and to keep offsets so a violation can report its line number.
// A `### ` sub-heading (execute.md's `### pr-first` / `### local-merge`)
// does not match `^## ` and so stays inside its parent section's body; text
// before the first `## ` heading (a sub-file's H1 preamble) belongs to no
// section at all.
function splitSections(text) {
  const heads = [...text.matchAll(/^## (.+)$/gm)];
  return heads.map((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index : text.length;
    return { heading: m[1].trim(), start, end };
  });
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

// SKILL.md: actionable = `## Step …` sections and exactly `## Next Actions`.
// Every other file: actionable = every section except `## Anti-Patterns`
// (the file's H1 preamble is already excluded — see splitSections above).
function actionableSections(text, isSkillFile) {
  const sections = splitSections(text);
  if (isSkillFile) {
    return sections.filter((s) => s.heading === 'Next Actions' || /^Step\b/.test(s.heading));
  }
  return sections.filter((s) => s.heading !== 'Anti-Patterns');
}

// Finds bare `/{skillName}` references inside `body`: a `/` immediately
// followed by a shipped skill name at a word boundary, that is not part of
// `/claude-tweaks:{name}`, not one of the two log-section literal shapes
// (`## /release`/`## /review` or `--section "/release"`), and not a path
// segment (a `/` preceded by a letter, `.`, `}`, or another `/`). Returns the
// raw regex match objects (index is relative to `body`).
function findBareReferenceMatches(body, skillNames) {
  const namesPattern = skillNames.map(escapeRegExp).join('|');
  const re = new RegExp(
    `(?<!claude-tweaks:)(?<!--section ")(?<!## )(?<![A-Za-z.}/])/(?:${namesPattern})\\b`,
    'g',
  );
  const matches = [];
  let m;
  while ((m = re.exec(body)) !== null) matches.push(m);
  return matches;
}

// The scanner under test: classifies `text` (`isSkillFile` selects
// SKILL.md's rule vs. a sub-file's rule), scans each actionable section, and
// returns one string per violation: `{file}:{line} (## {heading}): {token}`.
function scanForBareReferences(file, text, skillNames, isSkillFile) {
  const violations = [];
  for (const section of actionableSections(text, isSkillFile)) {
    const body = text.slice(section.start, section.end);
    for (const m of findBareReferenceMatches(body, skillNames)) {
      const absoluteIndex = section.start + m.index;
      const line = lineNumberAt(text, absoluteIndex);
      violations.push(`${file}:${line} (## ${section.heading}): ${m[0]}`);
    }
  }
  return violations;
}

// Applies scanForBareReferences to every plugin/skills/release/*.md file,
// classifying SKILL.md under its own rule and every other file as a sub-file.
function scanReleaseSkillFiles(dir, skillNames) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort();
  const violations = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    violations.push(...scanForBareReferences(file, text, skillNames, file === 'SKILL.md'));
  }
  return violations;
}

test('release skill fixtures: scanner reports a bare reference in a ## Step section (AC 7)', () => {
  const violations = scanForBareReferences('fixture.md', '## Step 1\nRun /release now.\n', SKILL_NAMES, true);
  assert.deepEqual(violations, ['fixture.md:2 (## Step 1): /release']);
});

test('release skill fixtures: scanner passes a fully-qualified reference (AC 7)', () => {
  const violations = scanForBareReferences(
    'fixture.md',
    '## Step 1\nRun /claude-tweaks:release now.\n',
    SKILL_NAMES,
    true,
  );
  assert.deepEqual(violations, []);
});

test('release skill fixtures: a bare /review reference is also reported', () => {
  // Kept as a permanent fixture proving the scanner discriminates on a
  // second skill name, not just the one this skill happens to be named for.
  const violations = scanForBareReferences(
    'fixture.md',
    '## Step 1\nInvoke /review base:{base}.\n',
    SKILL_NAMES,
    true,
  );
  assert.deepEqual(violations, ['fixture.md:2 (## Step 1): /review']);
});

test('release skill fixtures: path segments and log-section literals are exempt', () => {
  const violations = scanForBareReferences(
    'fixture.md',
    'Read plugin/skills/release/console.md and staged/release-held.md; log with --section "/release".\n',
    SKILL_NAMES,
    false,
  );
  assert.deepEqual(violations, []);
});

test('release skill fixtures: a sub-file is scanned in full outside ## Anti-Patterns (ruling 18)', () => {
  const subfile = '# Console\n\nStep 4 of /claude-tweaks:release.\n\n## Gates\nThen run /review on the result.\n';
  const violations = scanForBareReferences('console.md', subfile, SKILL_NAMES, false);
  assert.deepEqual(violations, ['console.md:6 (## Gates): /review']);

  const exempted =
    '# Console\n\nStep 4 of /claude-tweaks:release.\n\n## Anti-Patterns\nThen run /review on the result.\n';
  assert.deepEqual(scanForBareReferences('console.md', exempted, SKILL_NAMES, false), []);
});

test('release skill: actionable text uses only the fully-qualified reference form', () => {
  const violations = scanReleaseSkillFiles(RELEASE_DIR, SKILL_NAMES);
  assert.deepEqual(
    violations,
    [],
    `bare skill references found in actionable text:\n${violations.join('\n')}`,
  );
});
