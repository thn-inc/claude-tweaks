// tests/bin-lib/skill-audit/load.test.js — the per-invocation skill load
// model (#3307): bin/lib/skill-audit/load.js plus the text-level measuring
// helper it shares with context-cost.js.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { measuredTextBytes, measuredBytes } = require('../../../plugin/bin/lib/skill-audit/context-cost');

test('measuredTextBytes equals measuredBytes for the same content (CRLF + markers)', () => {
  const text = '<!-- when: mode=auto -->\r\nhello\r\n<!-- /when -->\r\nbye\r\n';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-model-'));
  const file = path.join(dir, 'x.md');
  fs.writeFileSync(file, text);
  assert.deepStrictEqual(measuredTextBytes(text), measuredBytes(file));
  assert.strictEqual(measuredTextBytes(text).bytes, Buffer.byteLength('hello\nbye\n'));
});

test('measuredTextBytes falls back to raw normalized bytes on a malformed marker, naming the label', () => {
  const text = '<!-- when: mode=auto -->\nx\n';
  const r = measuredTextBytes(text, 'lbl.md');
  assert.strictEqual(r.bytes, Buffer.byteLength(text));
  assert.match(r.markerError, /^lbl\.md:1: unclosed marker/);
});

const load = require('../../../plugin/bin/lib/skill-audit/load');

function existsIn(files) {
  const set = new Set(files);
  return (p) => set.has(p);
}

test('discoverPluginRoots: repo root and one level down only; fixtures deeper are ignored', () => {
  const files = [
    'plugin/skills/flow/SKILL.md',
    'plugin/skills/build/SKILL.md',
    '.claude/skills/x/SKILL.md',
    'skills/top/SKILL.md',
    'evals/fixtures/merge-check-repo/skills/a/SKILL.md',
    'tools/upstream-drift/fixtures/emilkowalski-skills/skills/b/SKILL.md',
    'plugin/skills/flow/manifesto.md',
  ];
  assert.deepStrictEqual(load.discoverPluginRoots(() => files), ['.', '.claude', 'plugin']);
});

test('extractCitations rule (a): relative to the citing file directory', () => {
  const r = load.extractCitations('Read `part.md` in this skill\'s directory.', 'plugin/skills/flow/SKILL.md', 'plugin',
    { exists: existsIn(['plugin/skills/flow/part.md']) });
  assert.deepStrictEqual(r, { resolved: ['plugin/skills/flow/part.md'], unresolved: [] });
});

test('extractCitations rule (b): _shared, stripping a leading _shared/ so it never doubles', () => {
  const ex = existsIn(['plugin/skills/_shared/foo.md']);
  for (const tok of ['foo.md', '_shared/foo.md']) {
    const r = load.extractCitations(`see \`${tok}\``, 'plugin/skills/flow/SKILL.md', 'plugin', { exists: ex });
    assert.deepStrictEqual(r.resolved, ['plugin/skills/_shared/foo.md'], tok);
  }
});

test('extractCitations rule (a) wins over (b) when both exist', () => {
  const r = load.extractCitations('`foo.md`', 'plugin/skills/flow/SKILL.md', 'plugin',
    { exists: existsIn(['plugin/skills/flow/foo.md', 'plugin/skills/_shared/foo.md']) });
  assert.deepStrictEqual(r.resolved, ['plugin/skills/flow/foo.md']);
});

test('extractCitations rule (c): ${CLAUDE_PLUGIN_ROOT}/ resolves against the plugin root', () => {
  const r = load.extractCitations('`${CLAUDE_PLUGIN_ROOT}/skills/test/verification.md`', 'plugin/skills/flow/SKILL.md', 'plugin',
    { exists: existsIn(['plugin/skills/test/verification.md']) });
  assert.deepStrictEqual(r.resolved, ['plugin/skills/test/verification.md']);
});

test('extractCitations rule (d): "in that skill\'s directory" uses the nearest preceding /claude-tweaks:{name}', () => {
  const line = 'Run `/claude-tweaks:stories` then `/claude-tweaks:design-wrapper`; read `frontend-detection.md` in that skill\'s directory.';
  const r = load.extractCitations(line, 'plugin/skills/flow/SKILL.md', 'plugin',
    { exists: existsIn(['plugin/skills/design-wrapper/frontend-detection.md']) });
  assert.deepStrictEqual(r.resolved, ['plugin/skills/design-wrapper/frontend-detection.md']);
});

test('extractCitations rule (d): "in the `/claude-tweaks:{name}` skill\'s directory" names the skill after the token', () => {
  const line = 'read `frontend-detection.md` in the `/claude-tweaks:design-wrapper` skill\'s directory';
  const r = load.extractCitations(line, 'plugin/skills/build/SKILL.md', 'plugin',
    { exists: existsIn(['plugin/skills/design-wrapper/frontend-detection.md']) });
  assert.deepStrictEqual(r.resolved, ['plugin/skills/design-wrapper/frontend-detection.md']);
});

test('extractCitations rule (d) does not apply without the phrase or without a skill token', () => {
  const ex = existsIn(['plugin/skills/design-wrapper/frontend-detection.md']);
  const noPhrase = load.extractCitations('`/claude-tweaks:design-wrapper` uses `frontend-detection.md`.', 'plugin/skills/build/SKILL.md', 'plugin', { exists: ex });
  assert.deepStrictEqual(noPhrase.resolved, []);
  const noToken = load.extractCitations('read `frontend-detection.md` in that skill\'s directory', 'plugin/skills/build/SKILL.md', 'plugin', { exists: ex });
  assert.deepStrictEqual(noToken.resolved, []);
});

test('extractCitations: an unresolvable token is recorded with its 1-based line, never counted', () => {
  const r = load.extractCitations('line one\nsee `docs/skill-graph.md` here', 'plugin/skills/flow/SKILL.md', 'plugin', { exists: () => false });
  assert.deepStrictEqual(r, {
    resolved: [],
    unresolved: [{ citingFile: 'plugin/skills/flow/SKILL.md', line: 2, token: 'docs/skill-graph.md' }],
  });
});

test('extractCitations: a token climbing out of the plugin root is unresolved even if the path exists', () => {
  const r = load.extractCitations('`../../../README.md`', 'plugin/skills/flow/SKILL.md', 'plugin', { exists: () => true });
  assert.deepStrictEqual(r.resolved, []);
  assert.strictEqual(r.unresolved.length, 1);
});

test('extractCitations: repeated citations of one file resolve once', () => {
  const r = load.extractCitations('`a.md` and `a.md`\n`a.md`', 'plugin/skills/flow/SKILL.md', 'plugin',
    { exists: existsIn(['plugin/skills/flow/a.md']) });
  assert.deepStrictEqual(r.resolved, ['plugin/skills/flow/a.md']);
});

test('extractCitations works under a repo-root plugin root (".")', () => {
  const r = load.extractCitations('`_shared/foo.md`', 'skills/flow/SKILL.md', '.', { exists: existsIn(['skills/_shared/foo.md']) });
  assert.deepStrictEqual(r.resolved, ['skills/_shared/foo.md']);
});

function tree(files) {
  const has = (p) => Object.prototype.hasOwnProperty.call(files, p);
  return {
    readFile: (p) => (has(p) ? files[p] : null),
    listSkillMds: () => Object.keys(files).filter((p) => /(^|\/)skills\/[^/]+\/SKILL\.md$/.test(p)),
  };
}
const B = (s) => Buffer.byteLength(s, 'utf8');

test('entryPointLoads: floor is the SKILL.md bytes; closure sums the transitive set once each', () => {
  const files = {
    'plugin/skills/flow/SKILL.md': 'Read `a.md` in this skill\'s directory.\n',
    'plugin/skills/flow/a.md': 'Then `b.md`.\n',
    'plugin/skills/flow/b.md': 'leaf\n',
    'plugin/skills/flow/orphan.md': 'never cited\n',
  };
  const [row] = load.entryPointLoads('plugin', tree(files));
  assert.strictEqual(row.entry, 'plugin:flow');
  assert.strictEqual(row.floor, B(files['plugin/skills/flow/SKILL.md']));
  assert.deepStrictEqual(row.files, ['plugin/skills/flow/SKILL.md', 'plugin/skills/flow/a.md', 'plugin/skills/flow/b.md']);
  assert.strictEqual(row.closure, row.files.reduce((s, f) => s + B(files[f]), 0));
  assert.deepStrictEqual(row.unresolved, []);
});

test('entryPointLoads: entries are namespaced by root so same-named skills never collide', () => {
  const a = load.entryPointLoads('plugin', tree({ 'plugin/skills/x/SKILL.md': 'p\n' }));
  const b = load.entryPointLoads('.claude', tree({ '.claude/skills/x/SKILL.md': 'c\n' }));
  assert.deepStrictEqual([a[0].entry, b[0].entry], ['plugin:x', '.claude:x']);
});

test('entryPointLoads: a citation cycle terminates and counts each file once', () => {
  const files = {
    'plugin/skills/s/SKILL.md': '`a.md`\n',
    'plugin/skills/s/a.md': '`b.md`\n',
    'plugin/skills/s/b.md': '`a.md` and `SKILL.md`\n',
  };
  const [row] = load.entryPointLoads('plugin', tree(files));
  assert.deepStrictEqual(row.files, ['plugin/skills/s/SKILL.md', 'plugin/skills/s/a.md', 'plugin/skills/s/b.md']);
  assert.strictEqual(row.closure, B('`a.md`\n') + B('`b.md`\n') + B('`a.md` and `SKILL.md`\n'));
});

test('entryPointLoads: compose sources join the closure and are walked transitively', () => {
  const composeLine = 'Run `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step x "${CLAUDE_PLUGIN_ROOT}/skills/_shared/src.md"`.\n';
  const files = {
    'plugin/skills/s/SKILL.md': 'Read `step.md` in this skill\'s directory.\n',
    'plugin/skills/s/step.md': composeLine,
    'plugin/skills/_shared/src.md': 'see `deep.md`\n',
    'plugin/skills/_shared/deep.md': 'deep\n',
  };
  const [row] = load.entryPointLoads('plugin', tree(files));
  assert.deepStrictEqual(row.files, [
    'plugin/skills/_shared/deep.md', 'plugin/skills/_shared/src.md',
    'plugin/skills/s/SKILL.md', 'plugin/skills/s/step.md',
  ]);
});

test('entryPointLoads: a file both cited and a compose source counts once', () => {
  const files = {
    'plugin/skills/s/SKILL.md': '`_shared/src.md` and `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --step x "${CLAUDE_PLUGIN_ROOT}/skills/_shared/src.md"`\n',
    'plugin/skills/_shared/src.md': 'src\n',
  };
  const [row] = load.entryPointLoads('plugin', tree(files));
  assert.deepStrictEqual(row.files, ['plugin/skills/_shared/src.md', 'plugin/skills/s/SKILL.md']);
  assert.strictEqual(row.closure, B(files['plugin/skills/s/SKILL.md']) + B('src\n'));
});

test('entryPointLoads: unresolved citations and missing compose sources surface, at zero bytes', () => {
  const files = {
    'plugin/skills/s/SKILL.md': '`missing.md`\n`node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --step x "${CLAUDE_PLUGIN_ROOT}/skills/_shared/gone.md"`\n',
  };
  const [row] = load.entryPointLoads('plugin', tree(files));
  assert.strictEqual(row.closure, row.floor);
  assert.deepStrictEqual(row.unresolved.map((u) => [u.line, u.token]), [
    [1, 'missing.md'],
    [2, 'plugin/skills/_shared/gone.md'],
  ]);
});
