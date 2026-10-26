'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

// Live-corpus scan, deliberately not a frozen fixture (#670-style carve-out, per
// skill-prose-conformance-tests' Decision Framework): the whole point of this suite is to
// catch a *future* skill-prose snippet that resolves a plugin module path via
// `process.env.CLAUDE_PLUGIN_ROOT` instead of docs/skill-authoring.md's "Plugin-root
// references" mandated `'${CLAUDE_PLUGIN_ROOT}/…'` string-literal placeholder (#802).
//
// `process.env.CLAUDE_PLUGIN_ROOT` reads as ordinary, plausible JS with no visual cue that it
// needs substitution — an executing agent following the snippet literally spawns a real Node
// process whose environment genuinely has no `CLAUDE_PLUGIN_ROOT` set (the harness only
// rewrites the `${CLAUDE_PLUGIN_ROOT}` token in the raw skill-prose text before the agent
// reads it; it never exports the variable into a Bash-tool-launched subprocess's real
// environment), and fails with `Cannot find module 'undefined/bin/…'`. This happened for real
// (#802's Current State) before the corpus-wide fix that this test pins.
//
// `plugin/hooks/hooks.json` is the sanctioned exception — hook processes are spawned by the
// harness with `CLAUDE_PLUGIN_ROOT` populated, so hook command strings may read the real
// `process.env.CLAUDE_PLUGIN_ROOT` at runtime. This suite only scans `plugin/skills/**/*.md`
// (skill prose, never hook command strings), so that exception never needs a carve-out here.

const ROOT = path.join(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, 'plugin', 'skills');

const PROCESS_ENV_PATTERN = /process\.env\.CLAUDE_PLUGIN_ROOT/;

function findAllMdFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findAllMdFiles(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

// Returns [{ lineNumber, line }] for every `process.env.CLAUDE_PLUGIN_ROOT` occurrence in `text`.
function findProcessEnvOccurrences(text) {
  const lines = text.split('\n');
  const sites = [];
  for (let i = 0; i < lines.length; i++) {
    if (PROCESS_ENV_PATTERN.test(lines[i])) {
      sites.push({ lineNumber: i + 1, line: lines[i] });
    }
  }
  return sites;
}

// --- Proof the check can go red (synthetic fixtures, per skill-prose-conformance-tests'
// go-red guidance) ---

test('findProcessEnvOccurrences: flags require(process.env.CLAUDE_PLUGIN_ROOT + ...)', () => {
  const text = "const { recordPayload } = require(process.env.CLAUDE_PLUGIN_ROOT + '/bin/lib/issues/record.js');";
  const sites = findProcessEnvOccurrences(text);
  assert.strictEqual(sites.length, 1, 'must go red on the process.env require() form');
});

test('findProcessEnvOccurrences: flags a bare `const root = process.env.CLAUDE_PLUGIN_ROOT;` assignment', () => {
  const text = 'const root = process.env.CLAUDE_PLUGIN_ROOT;';
  const sites = findProcessEnvOccurrences(text);
  assert.strictEqual(sites.length, 1, 'must go red on the bare assignment form');
});

test('findProcessEnvOccurrences: passes on the string-literal placeholder form', () => {
  const text = "const { recordPayload } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');";
  assert.deepStrictEqual(findProcessEnvOccurrences(text), []);
});

test('findProcessEnvOccurrences: passes on the shell-invocation placeholder form', () => {
  const text = 'node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values auto-mode';
  assert.deepStrictEqual(findProcessEnvOccurrences(text), []);
});

// --- Live-corpus sweep ---

test('no plugin/skills/**/*.md snippet resolves CLAUDE_PLUGIN_ROOT via process.env', () => {
  const files = findAllMdFiles(SKILLS_DIR);
  const failures = [];
  for (const file of files) {
    const text = readText(file);
    for (const site of findProcessEnvOccurrences(text)) {
      failures.push(`${path.relative(ROOT, file)}:${site.lineNumber}`);
    }
  }
  assert.deepStrictEqual(
    failures,
    [],
    'process.env.CLAUDE_PLUGIN_ROOT occurrence(s) in skill prose instead of the ' +
      "'${CLAUDE_PLUGIN_ROOT}/…' string-literal placeholder (see docs/skill-authoring.md's " +
      `"Plugin-root references" section): ${failures.join(', ')}`,
  );
});
