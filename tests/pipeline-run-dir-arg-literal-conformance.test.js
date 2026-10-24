// tests/pipeline-run-dir-arg-literal-conformance.test.js
//
// #790: static backstop for the same failure class Tasks 1-3 fixed at
// runtime — a skill .md citing `--run`/`--run-dir` with a bare-relative
// `.claude-tweaks/pipelines/` literal instead of an anchored value
// ($RUN_ROOT/..., "$PIPELINE_RUN_DIR", or a {run-dir} placeholder) would
// silently teach a future reader/agent the exact worktree-relative-shadow
// mistake this record fixed. Scans all skill .md files under skills/
// recursively to catch bare-relative literals in any citing skill step.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');

// Manual recursive directory walk — fs.readdirSync's `{ recursive: true }`
// option requires Node >=18.17.0/>=20.1.0, a minor-version floor this
// project doesn't otherwise declare (CLAUDE.md and package.json both say
// only "Node 18+", no engines field — see #790 Finding 4). Returns relative
// path strings from `root`, files only (directories are recursed into, not
// themselves returned) — sufficient for this scanner's `.endsWith('.md')`
// filter below.
function walkFilesRelative(root, relBase = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, relBase), { withFileTypes: true })) {
    const rel = relBase ? path.join(relBase, entry.name) : entry.name;
    if (entry.isDirectory()) out.push(...walkFilesRelative(root, rel));
    else out.push(rel);
  }
  return out;
}

// Dynamically scan all .md files under plugin/skills/ recursively
function getAllSkillFiles() {
  const skillsDir = path.join(ROOT, 'plugin', 'skills');
  const files = walkFilesRelative(skillsDir);
  return files
    .filter(f => f.endsWith('.md'))
    .map(f => path.join('plugin', 'skills', f));
}

// A bare-relative literal: `--run`/`--run-dir` (or `--run-dir=`) directly
// followed by a quoted or bare `.claude-tweaks/pipelines/...` path — never
// preceded by `$RUN_ROOT`, `"$PIPELINE_RUN_DIR"`, or a `{...}` placeholder,
// all of which are already-anchored forms this test must NOT flag.
function findBareRelativeRunArgLiterals(content) {
  const re = /--run(?:-dir)?[= ]['"]?\.claude-tweaks\/pipelines\//g;
  return content.match(re) || [];
}

test('shipped skill prose never passes a bare-relative .claude-tweaks/pipelines/ literal to --run/--run-dir', () => {
  const files = getAllSkillFiles();
  for (const rel of files) {
    const content = readText(path.join(ROOT, rel));
    const hits = findBareRelativeRunArgLiterals(content);
    assert.deepStrictEqual(hits, [], `${rel} carries a bare-relative --run/--run-dir literal: ${JSON.stringify(hits)}`);
  }
});

test('the scanner actually detects a deliberately reintroduced violation (discrimination check)', () => {
  const clean = 'run `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" check-resume-freshness --run "$PIPELINE_RUN_DIR"`';
  const dirtyBareNoQuote = 'run `node bin/wrap-up-engine.js plan --run-dir .claude-tweaks/pipelines/2026-01-01T000000-spec-1`';
  const dirtyDoubleQuote = 'run `node bin/script.js --run ".claude-tweaks/pipelines/foo"`';
  const dirtySingleQuote = "run `node bin/script.js --run-dir '.claude-tweaks/pipelines/foo'`";
  assert.deepStrictEqual(findBareRelativeRunArgLiterals(clean), []);
  assert.strictEqual(findBareRelativeRunArgLiterals(dirtyBareNoQuote).length, 1);
  assert.strictEqual(findBareRelativeRunArgLiterals(dirtyDoubleQuote).length, 1);
  assert.strictEqual(findBareRelativeRunArgLiterals(dirtySingleQuote).length, 1);
});
