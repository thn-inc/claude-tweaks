'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

// Live-corpus scan, deliberately not a frozen fixture (#670): the whole point of this suite
// is to catch a *future* dispatch site that invokes `bin/resolve-profile.js` with a
// repo-relative path instead of `docs/skill-authoring.md`'s mandated
// `"${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js"` placeholder. Freezing the input would
// defeat that purpose — per `skill-prose-conformance-tests`'s Decision Framework, this is the
// declared-contract carve-out (the prose IS the thing being enforced going forward), not the
// "a future migration is expected to rewrite this" case that calls for a fixture.
//
// Detection is invocation-only (`node ` immediately followed by a repo-relative
// `bin/resolve-profile.js` or `plugin/bin/resolve-profile.js` path), not "the filename
// anywhere in the file". A broader any-occurrence scan flags legitimate descriptive mentions
// that name the file without instructing an invocation — e.g. `skills/build/SKILL.md`'s
// "enforced by `bin/resolve-profile.js` per dispatch" and
// `skills/_shared/policy-schema-model-profiles.md`'s reader-column table entries — both would
// be false positives under a filename-anywhere scan. Matching both the pre-restructure
// `bin/resolve-profile.js` spelling and the current `plugin/bin/resolve-profile.js` spelling
// keeps this pinned across another path-prefix change the way #670 itself was not.

const ROOT = path.join(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, 'plugin', 'skills');

// Matches `node bin/resolve-profile.js` or `node plugin/bin/resolve-profile.js` — a
// shell-relative invocation — but not the `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js"`
// placeholder form, since that starts with a quote/brace, not a bare path character.
const REPO_LOCAL_INVOCATION_PATTERN = /\bnode\s+(?:plugin\/)?bin\/resolve-profile\.js/;

function findAllMdFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findAllMdFiles(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

// Returns [{ lineNumber, line }] for every repo-local resolve-profile.js invocation found in
// `text`.
function findRepoLocalInvocations(text) {
  const lines = text.split('\n');
  const sites = [];
  for (let i = 0; i < lines.length; i++) {
    if (REPO_LOCAL_INVOCATION_PATTERN.test(lines[i])) {
      sites.push({ lineNumber: i + 1, line: lines[i] });
    }
  }
  return sites;
}

// --- Proof the check can go red (synthetic fixtures, per skill-prose-conformance-tests'
// go-red guidance) ---

test('findRepoLocalInvocations: flags the pre-restructure repo-local form', () => {
  const text = 'Resolve via `node bin/resolve-profile.js standard` (contract § Model Selection).';
  const sites = findRepoLocalInvocations(text);
  assert.strictEqual(sites.length, 1, 'must go red on the repo-local `bin/resolve-profile.js` form');
});

test('findRepoLocalInvocations: flags the post-restructure repo-local form', () => {
  const text = 'run `node plugin/bin/resolve-profile.js {profile}` from the checkout root';
  const sites = findRepoLocalInvocations(text);
  assert.strictEqual(
    sites.length,
    1,
    'must go red on the repo-local `plugin/bin/resolve-profile.js` form',
  );
});

test('findRepoLocalInvocations: passes on the placeholder form', () => {
  const text = 'run `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" standard`';
  assert.deepStrictEqual(findRepoLocalInvocations(text), []);
});

test('findRepoLocalInvocations: ignores a descriptive mention with no `node` invocation', () => {
  const text =
    'the per-run cap is `frontier-run-cap`, enforced by `bin/resolve-profile.js` per dispatch';
  assert.deepStrictEqual(findRepoLocalInvocations(text), []);
});

// --- Live-corpus sweep ---

test('no resolve-profile.js invocation under plugin/skills/**/*.md uses a repo-local path', () => {
  const files = findAllMdFiles(SKILLS_DIR);
  const failures = [];
  for (const file of files) {
    const text = readText(file);
    for (const site of findRepoLocalInvocations(text)) {
      failures.push(`${path.relative(ROOT, file)}:${site.lineNumber}`);
    }
  }
  assert.deepStrictEqual(
    failures,
    [],
    'resolve-profile.js invocation(s) using a repo-local path instead of the ' +
      '`"${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js"` placeholder (see docs/skill-authoring.md\'s ' +
      `Plugin-root references section): ${failures.join(', ')}`,
  );
});
