'use strict';

// Plugin-root reader (#3461). Two callers read a plugin root's files
// through it: load-delta.js (its head side) and skill-load-report.js (the
// plugin-root index it builds). Both need the same rule — read only a regular
// file that resolves inside the base — so the rule lives here once.
//
// The base realpath is resolved lazily, on the first readFile, not when the
// reader is constructed: a base absent at construction, or deleted after it,
// then reads as absent (ENOENT -> null, listSkillMds -> []) instead of throwing.

const fs = require('fs');
const path = require('path');
const { isPathContained } = require('../shared-primitives');
const { walkCitable } = require('./load');
const { readdirUnder } = require('./citable-readdir');

const skillsPrefix = (root) => (root === '.' ? 'skills/' : `${root}/skills/`);

function pluginRootReader(baseAbs, root = '.') {
  let realBase = null;
  const readFile = (p) => {
    try {
      // A citation that passed withinRoot's textual check can still be a
      // symlink to a file outside the base, or to a device (/dev/zero) that
      // never reaches EOF — so resolve the real path and read only a regular file
      // inside the base; anything else is absent.
      if (realBase === null) realBase = fs.realpathSync(baseAbs);
      const real = fs.realpathSync(path.join(baseAbs, p));
      if (!isPathContained(real, realBase) || !fs.statSync(real).isFile()) return null;
      return fs.readFileSync(real, 'utf8');
    } catch (err) {
      if (['ENOENT', 'EISDIR', 'ENOTDIR', 'ELOOP'].includes(err.code)) return null;
      throw err;
    }
  };
  const listSkillMds = () => {
    const dir = path.join(baseAbs, root, 'skills');
    // load-delta.js's case: a root discovered only via the base-tree union
    // (ledger row 17) — all its SKILL.md files deleted, committed, at head —
    // has no skills/ directory left on disk at all; a root whose index entries
    // are deleted in the working tree only (never committed) can hit the same
    // ENOENT. skill-load-report.js's case: a plugin root that vanishes after
    // its skills/ check (#3461). Either way that is "no entries", not a crash:
    // readdirSync's ENOENT/ENOTDIR become [], and anything else (a real
    // permissions or I/O error) still rethrows.
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (['ENOENT', 'ENOTDIR'].includes(err.code)) return [];
      throw err;
    }
    return entries
      .filter((d) => d.isDirectory())
      .map((d) => `${skillsPrefix(root)}${d.name}/SKILL.md`)
      .filter((p) => readFile(p) !== null);
  };
  // Rule (f)'s citable listing for bare-name resolution — walked from
  // {root}/skills and {root}/agents only, never `.claude/worktrees/`.
  const listFiles = () => walkCitable(root, readdirUnder(baseAbs));
  return { readFile, listSkillMds, listFiles };
}

module.exports = { pluginRootReader, skillsPrefix };
