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
//             A token no path rule (a)–(e) resolves still resolves under rule
//             (f) when it names exactly one `.md` under the root's
//             `skills/`/`agents/` (a bare name or a trailing sub-path).
// A PR's delta on both makes a split show as a move ("floor -10 KB, closure
// +80 B"), not a cut. Pure over an injected readFile, so the CLI
// (bin/load-delta.js) feeds it working-tree content for head and
// `git show` content for base. All paths are repo-relative POSIX strings.

const path = require('node:path');
const { toPosix } = require('../shared-primitives');
const { measuredTextBytes, parseComposeCallLine } = require('./context-cost');

// parseComposeCallLine resolves `${CLAUDE_PLUGIN_ROOT}/x` against an absolute
// root; a fixed sentinel root keeps this module free of the real filesystem.
const SENTINEL_ROOT = path.resolve(path.sep, '__skill_load_model_root__');

const posix = path.posix;
const PLUGIN_ROOT_PREFIX = '${CLAUDE_PLUGIN_ROOT}/';
const BACKTICK_MD = /`([^`\n]+\.md)`/g;
const SKILL_DIR_PHRASE = /in that skill's directory|in the `\/claude-tweaks:[a-z0-9-]+` skill's directory/g;
// Rule (e)'s `{skill}/…` form: a first segment that is not dot-led, then more path.
const SKILLS_DIR_TOKEN = /^([^/.][^/]*)\/./;
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

// Rule (f)'s citable universe: the directories a skill's citation can name.
const CITABLE_DIRS = ['skills', 'agents'];

// Rule (f): a lookup from a citation token to the one citable `.md` it names
// by trailing path segments, or null when none or several do. `paths` is any
// repo-relative file list; only `.md` under {pluginRoot}/{CITABLE_DIRS}/ count.
function citableNameIndex(pluginRoot, paths) {
  const prefixes = CITABLE_DIRS.map((d) => (pluginRoot === '.' ? `${d}/` : `${pluginRoot}/${d}/`));
  const files = paths.map(toPosix).filter((p) => p.endsWith('.md') && prefixes.some((pre) => p.startsWith(pre)));
  const memo = new Map();
  return (token) => {
    if (memo.has(token)) return memo.get(token);
    let hit = null;
    const eligible = !posix.isAbsolute(token) && token.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
    if (eligible) {
      const matches = files.filter((f) => `/${f}`.endsWith(`/${token}`));
      if (matches.length === 1) hit = matches[0];
    }
    memo.set(token, hit);
    return hit;
  };
}

// Lists repo-relative POSIX `.md` paths under each {pluginRoot}/{CITABLE_DIRS}
// entry through an injected readdir(relDir) => [{ name, isDirectory }] that
// returns [] for a missing directory. Keeps this module free of `fs`.
function walkCitable(pluginRoot, readdir) {
  const out = [];
  const walk = (rel) => {
    for (const e of readdir(rel)) {
      const child = posix.join(rel, e.name);
      if (e.isDirectory) walk(child);
      else if (e.name.endsWith('.md')) out.push(child);
    }
  };
  for (const d of CITABLE_DIRS) walk(posix.join(pluginRoot, d));
  return out.sort();
}

function extractCitations(text, citingFile, pluginRoot, { exists, byName }) {
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
      // (e) plugin-root-relative `skills/…`, or skills-dir-relative `{skill}/…`
      // when the first segment names an existing skill directory.
      if (token.startsWith('skills/')) {
        candidates.push(posix.join(pluginRoot, token));
      } else {
        const seg = token.match(SKILLS_DIR_TOKEN);
        if (seg && exists(posix.join(pluginRoot, 'skills', seg[1], 'SKILL.md'))) {
          candidates.push(posix.join(pluginRoot, 'skills', token));
        }
      }
      let hit = candidates.find((c) => withinRoot(pluginRoot, c) && exists(c));
      // (f) unique name over citable files, only when (a)–(e) all miss and no
      // owner skill was named: a broken (d) citation must not reroute silently.
      if (!hit && byName && !skill) {
        const named = byName(token);
        if (named && withinRoot(pluginRoot, named) && exists(named)) hit = named;
      }
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

function composeSources(text, citingFile, pluginRoot, { exists }) {
  const resolved = [];
  const unresolved = [];
  text.replace(/\r\n/g, '\n').split('\n').forEach((line, i) => {
    if (!line.includes('compose-context.js')) return;
    const parsed = parseComposeCallLine(line, SENTINEL_ROOT);
    if (!parsed) return;
    if (parsed.unparsed) {
      unresolved.push({ citingFile, line: i + 1, token: `compose-context.js: ${parsed.reason}` });
      return;
    }
    for (const abs of parsed.sources) {
      const p = posix.join(pluginRoot, toPosix(path.relative(SENTINEL_ROOT, abs)));
      if (withinRoot(pluginRoot, p) && exists(p)) resolved.push(p);
      else unresolved.push({ citingFile, line: i + 1, token: p });
    }
  });
  return { resolved, unresolved };
}

function entryPointLoads(pluginRoot, { readFile, listSkillMds, listFiles }) {
  const byName = listFiles ? citableNameIndex(pluginRoot, listFiles()) : undefined;
  const texts = new Map();
  const read = (p) => {
    if (!texts.has(p)) texts.set(p, readFile(p));
    return texts.get(p);
  };
  const exists = (p) => read(p) !== null;
  const edges = new Map();
  const edgesOf = (p) => {
    if (!edges.has(p)) {
      const text = read(p) || '';
      const cites = extractCitations(text, p, pluginRoot, { exists, byName });
      const composed = composeSources(text, p, pluginRoot, { exists });
      edges.set(p, {
        next: [...new Set([...cites.resolved, ...composed.resolved])],
        unresolved: [...cites.unresolved, ...composed.unresolved],
      });
    }
    return edges.get(p);
  };
  const bytesOf = (p) => measuredTextBytes(read(p) || '', p).bytes;
  // The full repo-relative root path, not just its basename: two explicit
  // `--plugin-root a/foo` / `--plugin-root b/foo` roots share a basename but
  // must never collide on one entry name (ledger row 18). For every
  // depth-≤1 root (`plugin`, `.claude`) this is identical to the old
  // basename-only name, and `.` stays `.`.
  const rootName = pluginRoot;

  return listSkillMds().map((skillMd) => {
    const seen = new Set([skillMd]);
    const queue = [skillMd];
    const unresolved = [];
    while (queue.length) {
      const p = queue.shift();
      const e = edgesOf(p);
      unresolved.push(...e.unresolved);
      for (const n of e.next) {
        if (!seen.has(n)) { seen.add(n); queue.push(n); }
      }
    }
    const files = [...seen].sort();
    return {
      entry: `${rootName}:${posix.basename(posix.dirname(skillMd))}`,
      floor: bytesOf(skillMd),
      closure: files.reduce((sum, f) => sum + bytesOf(f), 0),
      files,
      unresolved,
    };
  }).sort((a, b) => (a.entry < b.entry ? -1 : a.entry > b.entry ? 1 : 0));
}

const unresolvedKey = (u) => `${u.citingFile}\u0000${u.token}`;

// A placeholder/glob token (`skills/*/SKILL.md`, `{n}-spec.md`, `<x>.md`) is
// not a citation to a real file — the citation grammar correctly leaves it
// unresolved, but it has no bytes to ever be "missing" from a closure, so it
// must never surface in newUnresolved (it still stays in `unresolved`, which
// every unresolved token is required to list).
const PLACEHOLDER_TOKEN = /[*{}<>]/;
const notPlaceholder = (u) => !PLACEHOLDER_TOKEN.test(u.token);

function loadDelta(baseRows, headRows) {
  const base = new Map(baseRows.map((r) => [r.entry, r]));
  const head = new Map(headRows.map((r) => [r.entry, r]));
  const entries = [...new Set([...base.keys(), ...head.keys()])].sort();
  const out = [];
  for (const entry of entries) {
    const b = base.get(entry);
    const h = head.get(entry);
    if (!b) {
      out.push({ entry, floor: h.floor, dFloor: h.floor, closure: h.closure, dClosure: h.closure, newUnresolved: h.unresolved.filter(notPlaceholder), added: true });
      continue;
    }
    if (!h) {
      out.push({ entry, floor: 0, dFloor: -b.floor, closure: 0, dClosure: -b.closure, newUnresolved: [], removed: true });
      continue;
    }
    const dFloor = h.floor - b.floor;
    const dClosure = h.closure - b.closure;
    if (dFloor === 0 && dClosure === 0) continue;
    const known = new Set(b.unresolved.map(unresolvedKey));
    out.push({
      entry, floor: h.floor, dFloor, closure: h.closure, dClosure,
      newUnresolved: h.unresolved.filter((u) => !known.has(unresolvedKey(u))).filter(notPlaceholder),
    });
  }
  return out;
}

module.exports = { CITABLE_DIRS, citableNameIndex, walkCitable, discoverPluginRoots, extractCitations, withinRoot, entryPointLoads, loadDelta };
