'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolvePluginVersion } = require('../../plugin/bin/lib/plugin-version');

// #1837 review finding: this module replaces three independent copies of
// the same "read CLAUDE_PLUGIN_ROOT/.claude-plugin/plugin.json, parse,
// extract version" logic (bin/lib/hooks/session-start.js's resolveBuildLine,
// bin/harness-health.js's own resolvePluginVersion, and bin/materialize.js's
// installedPluginVersion deps entry) — these tests pin the one shared
// implementation all three now delegate to.

function tmpPluginRoot(pluginJsonContent) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-version-test-'));
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  if (pluginJsonContent !== undefined) {
    fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), pluginJsonContent);
  }
  return root;
}

test('resolvePluginVersion: returns the version string from a well-formed plugin.json', () => {
  const root = tmpPluginRoot(JSON.stringify({ name: 'claude-tweaks', version: '6.123.0' }));
  assert.equal(resolvePluginVersion({ CLAUDE_PLUGIN_ROOT: root }), '6.123.0');
});

test('resolvePluginVersion: undefined when CLAUDE_PLUGIN_ROOT is unset', () => {
  assert.equal(resolvePluginVersion({}), undefined);
});

test('resolvePluginVersion: undefined when plugin.json does not exist', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-version-test-'));
  assert.equal(resolvePluginVersion({ CLAUDE_PLUGIN_ROOT: root }), undefined);
});

test('resolvePluginVersion: undefined when plugin.json is malformed JSON', () => {
  const root = tmpPluginRoot('{not valid json');
  assert.equal(resolvePluginVersion({ CLAUDE_PLUGIN_ROOT: root }), undefined);
});

test('resolvePluginVersion: undefined when version is missing, empty, or non-string — never fabricates one', () => {
  assert.equal(resolvePluginVersion({ CLAUDE_PLUGIN_ROOT: tmpPluginRoot(JSON.stringify({ name: 'x' })) }), undefined);
  assert.equal(resolvePluginVersion({ CLAUDE_PLUGIN_ROOT: tmpPluginRoot(JSON.stringify({ version: '' })) }), undefined);
  assert.equal(resolvePluginVersion({ CLAUDE_PLUGIN_ROOT: tmpPluginRoot(JSON.stringify({ version: 6 })) }), undefined);
});

test('resolvePluginVersion: defaults to process.env when no env argument is passed', () => {
  const root = tmpPluginRoot(JSON.stringify({ version: '9.9.9' }));
  const prior = process.env.CLAUDE_PLUGIN_ROOT;
  process.env.CLAUDE_PLUGIN_ROOT = root;
  try {
    assert.equal(resolvePluginVersion(), '9.9.9');
  } finally {
    if (prior === undefined) delete process.env.CLAUDE_PLUGIN_ROOT; else process.env.CLAUDE_PLUGIN_ROOT = prior;
  }
});
