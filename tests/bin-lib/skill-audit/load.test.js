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

test('extractCitations rule (d): two skills named on one line, interleaved with an unrelated citation, each resolve against their own nearest preceding token (ledger row 7)', () => {
  const line = 'See `unrelated.md`, then `/claude-tweaks:stories` reads `story.md` in that skill\'s directory, '
    + 'and `/claude-tweaks:build` reads `build-notes.md` in that skill\'s directory.';
  const r = load.extractCitations(line, 'plugin/skills/flow/SKILL.md', 'plugin', {
    exists: existsIn(['plugin/skills/stories/story.md', 'plugin/skills/build/build-notes.md']),
  });
  assert.deepStrictEqual(r.resolved, ['plugin/skills/stories/story.md', 'plugin/skills/build/build-notes.md']);
});

test('extractCitations rule (e): a skills/ token resolves against the plugin root', () => {
  const r = load.extractCitations('see `skills/build/SKILL.md`', 'plugin/skills/flow/SKILL.md', 'plugin',
    { exists: existsIn(['plugin/skills/build/SKILL.md']) });
  assert.deepStrictEqual(r.resolved, ['plugin/skills/build/SKILL.md']);
});

test('extractCitations rule (e): a {skill}/{file}.md token resolves under skills/ when the first segment names an existing skill', () => {
  const ex = existsIn([
    'plugin/skills/wrap-up/SKILL.md', 'plugin/skills/wrap-up/cleanup-procedures.md',
    'plugin/skills/design-wrapper/SKILL.md', 'plugin/skills/design-wrapper/modes/review.md',
  ]);
  const flat = load.extractCitations('`wrap-up/cleanup-procedures.md`', 'plugin/skills/flow/SKILL.md', 'plugin', { exists: ex });
  assert.deepStrictEqual(flat.resolved, ['plugin/skills/wrap-up/cleanup-procedures.md']);
  const nested = load.extractCitations('`design-wrapper/modes/review.md`', 'plugin/skills/flow/SKILL.md', 'plugin', { exists: ex });
  assert.deepStrictEqual(nested.resolved, ['plugin/skills/design-wrapper/modes/review.md']);
});

test('extractCitations rule (e): a first segment that is not a skill directory stays unresolved', () => {
  const notSkill = load.extractCitations('`docs/x.md`', 'plugin/skills/flow/SKILL.md', 'plugin',
    { exists: existsIn(['plugin/skills/docs/x.md']) });
  assert.deepStrictEqual(notSkill.resolved, []);
  assert.strictEqual(notSkill.unresolved.length, 1);
  const missing = load.extractCitations('`wrap-up/missing.md`', 'plugin/skills/flow/SKILL.md', 'plugin',
    { exists: existsIn(['plugin/skills/wrap-up/SKILL.md']) });
  assert.deepStrictEqual(missing.resolved, []);
  assert.strictEqual(missing.unresolved.length, 1);
});

test('extractCitations rule (a) still wins over (e) for a same-named relative sibling', () => {
  const r = load.extractCitations('`wrap-up/x.md`', 'plugin/skills/flow/SKILL.md', 'plugin', {
    exists: existsIn(['plugin/skills/flow/wrap-up/x.md', 'plugin/skills/wrap-up/SKILL.md', 'plugin/skills/wrap-up/x.md']),
  });
  assert.deepStrictEqual(r.resolved, ['plugin/skills/flow/wrap-up/x.md']);
});

test('extractCitations rule (e): a token climbing out of the root stays unresolved', () => {
  // Rules (a)/(b) normalise this token to plugin/skills/README.md, still inside
  // the root, so a blanket `exists: () => true` would resolve via (a). Only the
  // path rule (e) produces — README.md at the repo root — exists here.
  const r = load.extractCitations('`skills/../../README.md`', 'plugin/skills/flow/SKILL.md', 'plugin',
    { exists: existsIn(['README.md']) });
  assert.deepStrictEqual(r.resolved, []);
  assert.strictEqual(r.unresolved.length, 1);
});

test('extractCitations rule (e) works under a repo-root plugin root (".")', () => {
  const r = load.extractCitations('`skills/build/SKILL.md` and `wrap-up/a.md`', 'skills/flow/SKILL.md', '.', {
    exists: existsIn(['skills/build/SKILL.md', 'skills/wrap-up/SKILL.md', 'skills/wrap-up/a.md']),
  });
  assert.deepStrictEqual(r.resolved, ['skills/build/SKILL.md', 'skills/wrap-up/a.md']);
});

test('extractCitations rule (e): a dot-led first segment is never read as a skill directory', () => {
  // Under a "." plugin root with a root-level SKILL.md, a "../README.md" token
  // would otherwise build skills/../README.md = README.md and resolve. Rules
  // (a)/(b) normalise it to skills/README.md, which the fixture lacks.
  const r = load.extractCitations('`../README.md`', 'skills/flow/SKILL.md', '.',
    { exists: existsIn(['SKILL.md', 'README.md']) });
  assert.deepStrictEqual(r.resolved, []);
  assert.strictEqual(r.unresolved.length, 1);
});

test('extractCitations rule (d) still wins over (e) when a {skill}/… token has both hits', () => {
  const line = 'read `build/x.md` in the `/claude-tweaks:flow` skill\'s directory.';
  const r = load.extractCitations(line, 'plugin/skills/stories/SKILL.md', 'plugin', {
    exists: existsIn(['plugin/skills/flow/build/x.md', 'plugin/skills/build/SKILL.md', 'plugin/skills/build/x.md']),
  });
  assert.deepStrictEqual(r.resolved, ['plugin/skills/flow/build/x.md']);
});

test('extractCitations rule (f): a bare name naming exactly one citable file resolves to it (AC1.1)', () => {
  const files = ['plugin/skills/wrap-up/cleanup-procedures.md', 'plugin/skills/flow/SKILL.md'];
  const r = load.extractCitations('see `cleanup-procedures.md`', 'plugin/skills/flow/SKILL.md', 'plugin', {
    exists: existsIn(['plugin/skills/wrap-up/cleanup-procedures.md']),
    byName: load.citableNameIndex('plugin', files),
  });
  assert.deepStrictEqual(r.resolved, ['plugin/skills/wrap-up/cleanup-procedures.md']);
  assert.deepStrictEqual(r.unresolved, []);
});

test('extractCitations rule (f): a sub-path resolves by trailing segments, and agents/ is citable', () => {
  const files = ['plugin/skills/design-wrapper/modes/review.md', 'plugin/agents/qa-agent.md'];
  const r = load.extractCitations('`modes/review.md` and `agents/qa-agent.md`', 'plugin/skills/flow/SKILL.md', 'plugin', {
    exists: existsIn(files),
    byName: load.citableNameIndex('plugin', files),
  });
  assert.deepStrictEqual(r.resolved, files);
});

test('extractCitations rule (f): an ambiguous name stays unresolved', () => {
  const files = ['plugin/skills/code-health/filing.md', 'plugin/skills/harness-health/filing.md'];
  const r = load.extractCitations('`filing.md`', 'plugin/skills/flow/SKILL.md', 'plugin', {
    exists: existsIn(files),
    byName: load.citableNameIndex('plugin', files),
  });
  assert.deepStrictEqual(r.resolved, []);
  assert.strictEqual(r.unresolved.length, 1);
});

test('extractCitations rule (f): only skills/ and agents/ are citable', () => {
  const lookup = load.citableNameIndex('plugin', ['plugin/docs/x.md', 'plugin/bin/y.md']);
  assert.strictEqual(lookup('x.md'), null);
  assert.strictEqual(lookup('y.md'), null);
});

test('extractCitations rule (f): dot segments and absolute tokens never match by name', () => {
  // Non-normalized entries make the eligibility guard — not path normalization — keep these null.
  const lookup = load.citableNameIndex('plugin', ['plugin/skills/a/x.md', 'plugin/skills/a/../x.md', 'plugin/skills/a//x.md']);
  for (const token of ['./x.md', '../x.md', 'a/../x.md', '/x.md', 'a//x.md']) {
    assert.strictEqual(lookup(token), null, token);
  }
});

test('extractCitations rule (f) runs last: first-existing-wins order (a)–(e) is unchanged (AC2.1)', () => {
  const byName = () => 'plugin/skills/other/x.md';
  const both = load.extractCitations('`x.md`', 'plugin/skills/flow/SKILL.md', 'plugin', {
    exists: existsIn(['plugin/skills/flow/x.md', 'plugin/skills/_shared/x.md', 'plugin/skills/other/x.md']),
    byName,
  });
  assert.deepStrictEqual(both.resolved, ['plugin/skills/flow/x.md']);
  const sharedOnly = load.extractCitations('`x.md`', 'plugin/skills/flow/SKILL.md', 'plugin', {
    exists: existsIn(['plugin/skills/_shared/x.md', 'plugin/skills/other/x.md']),
    byName,
  });
  assert.deepStrictEqual(sharedOnly.resolved, ['plugin/skills/_shared/x.md']);
});

test('extractCitations rule (f) is skipped when rule (d) named an owner skill, so a broken (d) citation is not rerouted', () => {
  const files = ['plugin/skills/u/x.md'];
  const r = load.extractCitations('see `/claude-tweaks:t` then read `x.md` in that skill\'s directory', 'plugin/skills/flow/SKILL.md', 'plugin', {
    exists: existsIn(['plugin/skills/t/SKILL.md', 'plugin/skills/u/SKILL.md', 'plugin/skills/u/x.md']),
    byName: load.citableNameIndex('plugin', files),
  });
  assert.deepStrictEqual(r.resolved, []);
  assert.deepStrictEqual(r.unresolved.map((u) => u.token), ['x.md']);
});

test('extractCitations rule (f): absent byName keeps the token unresolved', () => {
  const r = load.extractCitations('see `cleanup-procedures.md`', 'plugin/skills/flow/SKILL.md', 'plugin', {
    exists: existsIn(['plugin/skills/wrap-up/cleanup-procedures.md']),
  });
  assert.deepStrictEqual(r.resolved, []);
  assert.strictEqual(r.unresolved.length, 1);
});

test('entryPointLoads rule (f): listFiles feeds the index and the hit is walked transitively', () => {
  const files = {
    'plugin/skills/flow/SKILL.md': 'see `helper.md`\n',
    'plugin/skills/wrap-up/SKILL.md': 'w\n',
    'plugin/skills/wrap-up/helper.md': 'then `leaf.md`\n',
    'plugin/skills/wrap-up/leaf.md': 'leaf\n',
  };
  const rows = load.entryPointLoads('plugin', { ...tree(files), listFiles: () => Object.keys(files) });
  const flow = rows.find((r) => r.entry === 'plugin:flow');
  assert.ok(flow.files.includes('plugin/skills/wrap-up/helper.md'));
  assert.ok(flow.files.includes('plugin/skills/wrap-up/leaf.md'));
});

test('entryPointLoads rule (f) is inert without listFiles', () => {
  const files = {
    'plugin/skills/flow/SKILL.md': 'see `helper.md`\n',
    'plugin/skills/wrap-up/SKILL.md': 'w\n',
    'plugin/skills/wrap-up/helper.md': 'then `leaf.md`\n',
    'plugin/skills/wrap-up/leaf.md': 'leaf\n',
  };
  const flow = load.entryPointLoads('plugin', tree(files)).find((r) => r.entry === 'plugin:flow');
  assert.deepStrictEqual(flow.files, ['plugin/skills/flow/SKILL.md']);
  assert.deepStrictEqual(flow.unresolved.map((u) => u.token), ['helper.md']);
});

test('walkCitable lists .md under skills/ and agents/ only, never other top-level dirs', () => {
  const dir = (name) => ({ name, isDirectory: true });
  const file = (name) => ({ name, isDirectory: false });
  const mk = (prefix) => {
    const map = {
      [`${prefix}skills`]: [dir('s')],
      [`${prefix}skills/s`]: [file('SKILL.md'), file('a.txt')],
      [`${prefix}agents`]: [file('q.md')],
      [`${prefix}worktrees`]: [file('z.md')],
    };
    return (rel) => map[rel] || [];
  };
  assert.deepStrictEqual(load.walkCitable('plugin', mk('plugin/')), ['plugin/agents/q.md', 'plugin/skills/s/SKILL.md']);
  assert.deepStrictEqual(load.walkCitable('.', mk('')), ['agents/q.md', 'skills/s/SKILL.md']);
});

test('walkCitable walks a directory named like a file and sorts entries across skills and agents', () => {
  const dir = (name) => ({ name, isDirectory: true });
  const file = (name) => ({ name, isDirectory: false });
  const map = {
    'plugin/skills': [dir('b'), dir('a')],
    'plugin/skills/a': [dir('notes.md'), file('z.md')],
    'plugin/skills/a/notes.md': [file('inner.md')],
    'plugin/skills/b': [file('SKILL.md')],
    'plugin/agents': [file('m.md')],
  };
  assert.deepStrictEqual(load.walkCitable('plugin', (rel) => map[rel] || []), [
    'plugin/agents/m.md',
    'plugin/skills/a/notes.md/inner.md',
    'plugin/skills/a/z.md',
    'plugin/skills/b/SKILL.md',
  ]);
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

test('entryPointLoads: entries are sorted by entry name regardless of listSkillMds\' own order (ledger row 10)', () => {
  const files = {
    'plugin/skills/zebra/SKILL.md': 'z\n',
    'plugin/skills/apple/SKILL.md': 'a\n',
    'plugin/skills/mango/SKILL.md': 'm\n',
  };
  const rows = load.entryPointLoads('plugin', tree(files));
  assert.deepStrictEqual(rows.map((r) => r.entry), ['plugin:apple', 'plugin:mango', 'plugin:zebra']);
});

test('entryPointLoads: deep explicit roots use the full root path, not just its basename, so same-basename roots never collide (ledger row 18)', () => {
  const a = load.entryPointLoads('a/foo', tree({ 'a/foo/skills/s/SKILL.md': 'p\n' }));
  const b = load.entryPointLoads('b/foo', tree({ 'b/foo/skills/s/SKILL.md': 'q\n' }));
  assert.deepStrictEqual([a[0].entry, b[0].entry], ['a/foo:s', 'b/foo:s']);
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

test('entryPointLoads: a --phase compose line adds every registered bundle\'s sources to the closure (#4027)', () => {
  const files = {
    'plugin/skills/s/SKILL.md': 'Run `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --phase second-call`.\n',
    'plugin/skills/_shared/issue-claims.md': 'claims\n',
    'plugin/skills/_shared/pr-first-merge.md': 'merge\n',
  };
  const [row] = load.entryPointLoads('plugin', tree(files));
  assert.deepStrictEqual(row.files, [
    'plugin/skills/_shared/issue-claims.md', 'plugin/skills/_shared/pr-first-merge.md', 'plugin/skills/s/SKILL.md',
  ]);
  assert.deepStrictEqual(row.unresolved.map((u) => [u.line, u.token]), [[1, 'plugin/skills/_shared/pr-checklist-refresh.md']]);
});

test('entryPointLoads: a compose call line in a closure member that parseComposeCallLine cannot parse adds nothing to the closure and does not throw (ledger row 8)', () => {
  const files = {
    'plugin/skills/s/SKILL.md': 'Read `step.md` in this skill\'s directory.\n',
    'plugin/skills/s/step.md': 'Run `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --bogus-flag x`.\n',
  };
  const [row] = load.entryPointLoads('plugin', tree(files));
  assert.deepStrictEqual(row.files, ['plugin/skills/s/SKILL.md', 'plugin/skills/s/step.md']);
  assert.ok(
    row.unresolved.some((u) => u.token.startsWith('compose-context.js: unknown flag --bogus-flag')),
    JSON.stringify(row.unresolved)
  );
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

test('loadDelta move-not-cut: a 10,000 B split shows floor ≈ -10,000 and closure = the pointer line', () => {
  const pointer = 'Read `part.md` in this skill\'s directory.';
  const base = load.entryPointLoads('plugin', tree({ 'plugin/skills/s/SKILL.md': `${'a'.repeat(19999)}\n` }));
  const head = load.entryPointLoads('plugin', tree({
    'plugin/skills/s/SKILL.md': `${'a'.repeat(9999)}\n${pointer}\n`,
    'plugin/skills/s/part.md': `${'a'.repeat(9999)}\n`,
  }));
  assert.strictEqual(base[0].floor, 20000);
  const [row] = load.loadDelta(base, head);
  assert.strictEqual(row.entry, 'plugin:s');
  assert.ok(Math.abs(row.dFloor + 10000) <= B(pointer) + 2, `dFloor ${row.dFloor}`);
  assert.ok(Math.abs(row.dClosure - B(pointer)) <= 2, `dClosure ${row.dClosure}`);
});

test('loadDelta: a _shared change fans out to exactly the entry points whose closure holds it', () => {
  const files = {
    'plugin/skills/one/SKILL.md': '`_shared/x.md`\n',
    'plugin/skills/two/SKILL.md': 'see `_shared/x.md`\n',
    'plugin/skills/three/SKILL.md': 'no citations\n',
    'plugin/skills/_shared/x.md': 'shared\n',
  };
  const base = load.entryPointLoads('plugin', tree(files));
  const head = load.entryPointLoads('plugin', tree({ ...files, 'plugin/skills/_shared/x.md': 'shared, now longer\n' }));
  const rows = load.loadDelta(base, head);
  assert.deepStrictEqual(rows.map((r) => r.entry), ['plugin:one', 'plugin:two']);
  for (const r of rows) {
    assert.strictEqual(r.dFloor, 0);
    assert.strictEqual(r.dClosure, B('shared, now longer\n') - B('shared\n'));
  }
});

test('loadDelta: an added entry point also excludes placeholder tokens from newUnresolved (F6)', () => {
  const base = load.entryPointLoads('plugin', tree({}));
  const head = load.entryPointLoads('plugin', tree({ 'plugin/skills/new/SKILL.md': '`{n}-spec.md`\n`real-miss.md`\n' }));
  const [row] = load.loadDelta(base, head);
  assert.strictEqual(row.entry, 'plugin:new');
  assert.deepStrictEqual(row.newUnresolved.map((u) => u.token), ['real-miss.md']);
});

test('loadDelta: added and removed entry points', () => {
  const base = load.entryPointLoads('plugin', tree({ 'plugin/skills/old/SKILL.md': 'old\n' }));
  const head = load.entryPointLoads('plugin', tree({ 'plugin/skills/new/SKILL.md': 'brand new\n' }));
  assert.deepStrictEqual(load.loadDelta(base, head), [
    { entry: 'plugin:new', floor: 10, dFloor: 10, closure: 10, dClosure: 10, newUnresolved: [], added: true },
    { entry: 'plugin:old', floor: 0, dFloor: -4, closure: 0, dClosure: -4, newUnresolved: [], removed: true },
  ]);
});

test('loadDelta: CRLF base content measures the same as LF head — no phantom delta', () => {
  const lf = 'Read `a.md` in this skill\'s directory.\nline two\n';
  const base = load.entryPointLoads('plugin', tree({
    'plugin/skills/s/SKILL.md': lf.replace(/\n/g, '\r\n'), 'plugin/skills/s/a.md': 'x\r\n',
  }));
  const head = load.entryPointLoads('plugin', tree({ 'plugin/skills/s/SKILL.md': lf, 'plugin/skills/s/a.md': 'x\n' }));
  assert.deepStrictEqual(load.loadDelta(base, head), []);
});

test('loadDelta: placeholder/glob tokens are excluded from newUnresolved but stay in unresolved (F6)', () => {
  const base = load.entryPointLoads('plugin', tree({ 'plugin/skills/s/SKILL.md': 'nothing\n' }));
  const head = load.entryPointLoads('plugin', tree({
    'plugin/skills/s/SKILL.md': '`skills/*/SKILL.md`\n`{n}-spec.md`\n`<x>.md`\n`real-miss.md`\n',
  }));
  assert.deepStrictEqual(head[0].unresolved.map((u) => u.token), ['skills/*/SKILL.md', '{n}-spec.md', '<x>.md', 'real-miss.md']);
  const [row] = load.loadDelta(base, head);
  assert.deepStrictEqual(row.newUnresolved.map((u) => u.token), ['real-miss.md']);
});

test('loadDelta: newUnresolved lists only citations unresolved at head and not at base, ignoring line moves', () => {
  const base = load.entryPointLoads('plugin', tree({ 'plugin/skills/s/SKILL.md': '`gone.md`\n' }));
  const head = load.entryPointLoads('plugin', tree({ 'plugin/skills/s/SKILL.md': 'moved down\n`gone.md`\n`new-miss.md`\n' }));
  const [row] = load.loadDelta(base, head);
  assert.deepStrictEqual(row.newUnresolved, [{ citingFile: 'plugin/skills/s/SKILL.md', line: 3, token: 'new-miss.md' }]);
});
