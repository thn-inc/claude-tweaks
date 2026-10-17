'use strict';

// Per-invocation skill load model (#3307, parent #3305).
//
// Raw file size stopped being an honest cost measure once a per-file cap
// rewarded splitting: moving a section into a sibling file that SKILL.md
// tells the reader to load immediately looked like a saving while the
// invocation still paid for every byte. For each entry point (every
// skills/*/SKILL.md under a plugin root) this module computes
//   floor   — the SKILL.md's own measured bytes, paid on every invocation;
//   closure — floor + every file reachable from it by citation (backticked
//             `.md` tokens, compose-context.js sources), transitively, each
//             file counted once: the upper bound an invocation can load.
// A PR's delta on both makes a split show as a move ("floor -10 KB, closure
// +80 B"), not a cut. Pure over an injected readFile, so the CLI
// (bin/load-delta.js) feeds it working-tree content for head and
// `git show` content for base. All paths are repo-relative POSIX strings.

const path = require('node:path');
const { toPosix } = require('../shared-primitives');

const posix = path.posix;
const PLUGIN_ROOT_PREFIX = '${CLAUDE_PLUGIN_ROOT}/';
const BACKTICK_MD = /`([^`\n]+\.md)`/g;
const SKILL_DIR_PHRASE = /in that skill's directory|in the `\/claude-tweaks:[a-z0-9-]+` skill's directory/g;
const SKILL_TOKEN = /\/claude-tweaks:([a-z0-9-]+)/g;
// A plugin root is the repo root or one directory down. Deeper trees are
// test fixtures (evals/fixtures/…, tools/upstream-drift/fixtures/…), never a
// shipped or project-local skill root.
const ROOT_SKILL_MD = /^(?:([^/]+)\/)?skills\/[^/]+\/SKILL\.md$/;

function discoverPluginRoots(listFiles) {
  const roots = new Set();
  for (const f of listFiles()) {
    const m = toPosix(f).match(ROOT_SKILL_MD);
    if (m) roots.add(m[1] || '.');
  }
  return [...roots].sort();
}

function withinRoot(pluginRoot, p) {
  if (p === '..' || p.startsWith('../') || posix.isAbsolute(p)) return false;
  return pluginRoot === '.' || p.startsWith(`${pluginRoot}/`);
}

// Rule (d)'s skill: the nearest /claude-tweaks:{name} token preceding the end
// of the first directory phrase at or after the cited token. For "in the
// `/claude-tweaks:X` skill's directory" that is X itself (it follows the
// token); for "in that skill's directory" it is the last skill named before
// the phrase. A phrase only before the token anchors at the token.
function phraseSkill(line, tokenIndex) {
  const phrases = [...line.matchAll(SKILL_DIR_PHRASE)];
  if (phrases.length === 0) return null;
  const after = phrases.find((m) => m.index >= tokenIndex);
  const anchor = after ? after.index + after[0].length : tokenIndex;
  const names = [...line.slice(0, anchor).matchAll(SKILL_TOKEN)];
  return names.length ? names[names.length - 1][1] : null;
}

function extractCitations(text, citingFile, pluginRoot, { exists }) {
  const resolved = [];
  const unresolved = [];
  const seen = new Set();
  const citingDir = posix.dirname(citingFile);
  const sharedDir = posix.join(pluginRoot, 'skills', '_shared');
  text.replace(/\r\n/g, '\n').split('\n').forEach((line, i) => {
    for (const m of line.matchAll(BACKTICK_MD)) {
      const token = m[1];
      const candidates = [
        posix.join(citingDir, token), // (a)
        posix.join(sharedDir, token.replace(/^_shared\//, '')), // (b)
      ];
      if (token.startsWith(PLUGIN_ROOT_PREFIX)) {
        candidates.push(posix.join(pluginRoot, token.slice(PLUGIN_ROOT_PREFIX.length))); // (c)
      }
      const skill = phraseSkill(line, m.index);
      if (skill) candidates.push(posix.join(pluginRoot, 'skills', skill, token)); // (d)
      const hit = candidates.find((c) => withinRoot(pluginRoot, c) && exists(c));
      if (!hit) {
        unresolved.push({ citingFile, line: i + 1, token });
      } else if (!seen.has(hit)) {
        seen.add(hit);
        resolved.push(hit);
      }
    }
  });
  return { resolved, unresolved };
}

module.exports = { discoverPluginRoots, extractCitations, withinRoot };
