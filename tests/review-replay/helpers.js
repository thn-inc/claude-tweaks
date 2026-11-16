'use strict';
// Shared fixtures and fake deps for the review-replay tests.

const fs = require('fs');
const path = require('path');

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'review-replay');
const ARCHIVE = path.join(FIXTURES, 'archive');
const TREE = path.join(FIXTURES, 'tree');
const HEAD_A = 'a'.repeat(40);
const BASE_A = 'b'.repeat(40);
const HEAD_C = 'c'.repeat(40);

// What the fake git answers, keyed by the space-joined args.
const GIT_TABLE = {
  'log -1 --format=%ct 1111111': '100\n',
  [`rev-parse 1111111^`]: `${HEAD_A}\n`,
  'log -1 --format=%ct 2222222': '200\n',
  [`rev-parse 2222222^`]: `${HEAD_C}\n`,
};

// Deps for run(): the real fs, a git that answers from a table (and throws on anything else), a writeTree that copies
// the fixture tree, and captured log and err lines.
function makeDeps({ gitTable, ...overrides } = {}) {
  const logs = [];
  const errs = [];
  const gitCalls = [];
  const table = { ...GIT_TABLE, ...(gitTable || {}) };
  const deps = {
    fs,
    git: (args) => {
      const key = args.join(' ');
      gitCalls.push(key);
      if (Object.prototype.hasOwnProperty.call(table, key)) return table[key];
      throw new Error(`fake git: no answer for ${key}`);
    },
    writeTree: (head, destDir) => {
      fs.mkdirSync(destDir, { recursive: true });
      fs.cpSync(TREE, destDir, { recursive: true });
    },
    log: (line) => logs.push(line),
    err: (line) => errs.push(line),
    pluginRoot: path.join(__dirname, '..', '..', 'plugin'),
  };
  return Object.assign(deps, overrides, { logs, errs, gitCalls });
}

module.exports = { FIXTURES, ARCHIVE, TREE, HEAD_A, BASE_A, HEAD_C, GIT_TABLE, makeDeps };
