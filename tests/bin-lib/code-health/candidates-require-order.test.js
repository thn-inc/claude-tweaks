'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// refs #2908, #2869, #3478 — the registry (focus-generators.js) autoloads every
// vertical, so a vertical that imports a helper from a sibling vertical makes
// the require graph a cycle that only survives through load order (the
// "inside circular dependency" warning, helpers bound to undefined). #3478
// removed the cause: the helpers shared across verticals live in the leaf
// source-scan.js, and no vertical requires another. The first test is the
// historical #2908 load check for candidates-security-hardening.js; the
// all-modules test (refs #2869) covers every module, picking up a new
// candidates-*.js file by discovery; the last test records every require
// edge in a fresh process and pins the leaf property directly.

const CODE_HEALTH_DIR = path.join(__dirname, '../../../plugin/bin/lib/code-health');
const MODULE_PATH = path.join(CODE_HEALTH_DIR, 'candidates-security-hardening.js');

test('candidates-security-hardening.js loads in a fresh process with no circular-dependency warning', () => {
  const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(MODULE_PATH)})`], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `load exited non-zero: ${result.stderr}`);
  assert.ok(
    !/inside circular dependency/i.test(result.stderr || ''),
    `candidates-security-hardening.js emitted a circular-dependency warning on load:\n${result.stderr}`
  );
});

test('every candidates-*.js module and focus-generators.js loads in a fresh process with no circular-dependency warning', () => {
  const modules = fs
    .readdirSync(CODE_HEALTH_DIR)
    .filter((name) => /^candidates-.*\.js$/.test(name) || name === 'focus-generators.js');
  assert.ok(modules.includes('candidates-dead-code.js'), 'discovery must include candidates-dead-code.js');
  assert.ok(modules.length >= 9, `expected >= 9 modules, discovered ${modules.length}: ${modules.join(', ')}`);

  const offenders = [];
  for (const name of modules) {
    const modulePath = path.join(CODE_HEALTH_DIR, name);
    const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(modulePath)})`], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${name} load exited non-zero: ${result.stderr}`);
    if (/inside circular dependency/i.test(result.stderr || '')) offenders.push(name);
  }
  assert.deepEqual(offenders, [], `modules that emit a circular-dependency warning on load: ${offenders.join(', ')}`);
});

test('dead-code stays registered under both load orders', () => {
  const deadCodePath = path.join(CODE_HEALTH_DIR, 'candidates-dead-code.js');
  const registryPath = path.join(CODE_HEALTH_DIR, 'focus-generators.js');
  const printRegistration = `console.log(typeof require(${JSON.stringify(registryPath)}).FOCUS_GENERATORS['dead-code'])`;

  // Order A: dead-code first, then the registry.
  const deadCodeFirst = spawnSync(
    process.execPath,
    ['-e', `require(${JSON.stringify(deadCodePath)}); ${printRegistration}`],
    { encoding: 'utf8' }
  );
  // Order B: the registry only (it autoloads dead-code itself).
  const registryOnly = spawnSync(process.execPath, ['-e', printRegistration], { encoding: 'utf8' });

  assert.equal(deadCodeFirst.stdout.trim(), 'function', `dead-code first: ${deadCodeFirst.stderr}`);
  assert.equal(registryOnly.stdout.trim(), 'function', `registry only: ${registryOnly.stderr}`);
});

test('AC1.1 AC2.1: candidates-dead-code.js loads in a fresh process with no circular-dependency warning and no vertical requires a sibling vertical', () => {
  const deadCodePath = path.join(CODE_HEALTH_DIR, 'candidates-dead-code.js');
  // Records every (requiring file basename, request) edge in a fresh process.
  const script = [
    "const Module = require('module'); const p = require('path');",
    'const edges = []; const orig = Module.prototype.require;',
    'Module.prototype.require = function (id) { edges.push([p.basename(this.filename || ""), id]); return orig.apply(this, arguments); };',
    `require(${JSON.stringify(deadCodePath)});`,
    'process.stdout.write(JSON.stringify(edges));',
  ].join('\n');
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, `load exited non-zero: ${result.stderr}`);
  assert.doesNotMatch(result.stderr || '', /inside circular dependency/i);
  const edges = JSON.parse(result.stdout);
  const isVertical = (f) => /^candidates-.*\.js$/.test(f);
  assert.ok(edges.some(([from, id]) => from === 'candidates-dead-code.js' && id === './source-scan'), 'dead-code must take its helpers from ./source-scan');
  const loadedVerticals = [...new Set(edges.map(([from]) => from).filter(isVertical))].sort();
  const discoveredVerticals = fs.readdirSync(CODE_HEALTH_DIR).filter(isVertical).sort();
  assert.deepEqual(loadedVerticals, discoveredVerticals, 'every discovered candidates-*.js vertical must have been loaded in the recorded process (vacuity guard)');
  const siblingEdges = edges.filter(([from, id]) => isVertical(from) && /^\.\/candidates-/.test(id));
  assert.deepEqual(siblingEdges, [], 'a vertical requires a sibling vertical — move the shared helper into ./source-scan');
  const leafEdges = edges.filter(([from, id]) => from === 'source-scan.js' && /^\.\/(focus-generators|candidates-)/.test(id));
  assert.deepEqual(leafEdges, [], 'source-scan.js must stay a leaf: no registry or vertical requires');
});
