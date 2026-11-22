'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const rw = require(path.join(__dirname, '..', '..', 'tools', 'review-replay', 'reviews-rewrite.js'));

const B = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const H = 'fedcba9876543210fedcba9876543210fedcba98';
const RB = '1111111111111111111111111111111111111111';
const RH = '2222222222222222222222222222222222222222';
const mainRoot = '/m/Code Workspaces/repo';
const main = mainRoot;
const opts = { mainRoot, runName: 'R' };

test('rangeOf reads git diff X...Y', () => {
  assert.deepStrictEqual(rw.rangeOf('SCOPE: git diff ' + B + '...' + H), { base: B, head: H });
});

test('rangeOf reads base X ... HEAD Y', () => {
  assert.deepStrictEqual(rw.rangeOf('Diff scope: base ' + B + ' (merge-base) ... HEAD ' + H), { base: B, head: H });
});

test('rangeOf reads X...HEAD with HEAD named apart', () => {
  assert.deepStrictEqual(rw.rangeOf('`git diff ' + B + '...HEAD` (HEAD ' + H + ')'), { base: B, head: H });
});

test('rangeOf returns nulls for a symbolic range', () => {
  assert.deepStrictEqual(rw.rangeOf('git diff origin/main...HEAD'), { base: null, head: null });
  assert.deepStrictEqual(rw.originRefsOf('git diff origin/main...HEAD'), ['main']);
});

test('runInputsOf classifies the four kinds', () => {
  const text = [
    main + '/.claude-tweaks/pipelines/R/review-ctx/context.md',
    main + '/.claude/worktrees/w/.claude-tweaks/pipelines/R/work/9-spec.md',
    main + '/.claude-tweaks/pipelines/R/context/lens-child.md',
    main + '/.claude-tweaks/pipelines/R/spec-2/review-ctx/agent-scratch/3b-a',
  ].join('\n');
  const { inputs, unknown } = rw.runInputsOf(text, opts);
  assert.deepStrictEqual(inputs.map((i) => i.kind), ['bundle', 'spec', 'procedure', 'scratch']);
  assert.strictEqual(inputs[3].member, 'spec-2');
  assert.strictEqual(inputs[0].member, null);
  assert.strictEqual(inputs[1].match, main + '/.claude/worktrees/w/.claude-tweaks/pipelines/R/work/9-spec.md');
  assert.deepStrictEqual(unknown, []);
});

test('runInputsOf reports decisions.md and another run as unknown', () => {
  const text = main + '/.claude-tweaks/pipelines/R/decisions.md and ' + main + '/.claude-tweaks/pipelines/OTHER/review-ctx/context.md';
  const { inputs, unknown } = rw.runInputsOf(text, opts);
  assert.deepStrictEqual(inputs, []);
  assert.strictEqual(unknown.length, 2);
});

test('runInputsOf strips trailing punctuation from a match', () => {
  const { inputs } = rw.runInputsOf('read ' + main + '/.claude-tweaks/pipelines/R/review-ctx/context.md.', opts);
  assert.strictEqual(inputs[0].match, main + '/.claude-tweaks/pipelines/R/review-ctx/context.md');
});

test('rewrite handles a main-checkout path containing a space', () => {
  const out = rw.rewriteText('git -C "' + main + '/.claude/worktrees/w" diff', {
    mainRoot, runName: 'R', repoPath: '/out/repos/k/repo', replacements: {}, shaMap: {},
  });
  assert.strictEqual(out, 'git -C "/out/repos/k/repo" diff');
  assert.deepStrictEqual(rw.unrewrittenPaths(out, { mainRoot, runName: 'R', outDir: '/out' }), []);
});

test('rewriteText applies replacements and shas', () => {
  const p = main + '/.claude-tweaks/pipelines/R/review-ctx/context.md';
  const out = rw.rewriteText('read ' + p + ' at ' + B, {
    mainRoot, runName: 'R', repoPath: '/r', replacements: { [p]: '/out/ctx.md' }, shaMap: { [B]: RB },
  });
  assert.strictEqual(out, 'read /out/ctx.md at ' + RB);
});

test('copy mode skips another run\'s relative mention', () => {
  const rel = 'see .claude-tweaks/pipelines/OTHER/decisions.md';
  assert.deepStrictEqual(rw.runInputsOf(rel, { ...opts, copy: true }), { inputs: [], unknown: [] });
  assert.strictEqual(rw.runInputsOf(rel, opts).unknown.length, 1);
  const abs = main + '/.claude-tweaks/pipelines/OTHER/x.md';
  assert.strictEqual(rw.runInputsOf(abs, { ...opts, copy: true }).unknown.length, 1);
  assert.strictEqual(rw.runInputsOf(abs, opts).unknown.length, 1);
});

test('unrewrittenPaths ignores the output directory', () => {
  const outDir = mainRoot + '/out';
  assert.deepStrictEqual(rw.unrewrittenPaths(mainRoot + '/out/repos/k/repo', { mainRoot, runName: 'R', outDir }), []);
  assert.strictEqual(rw.unrewrittenPaths(mainRoot + '/src/a.js', { mainRoot, runName: 'R', outDir }).length, 1);
});

test('unrewrittenPaths reports a leftover run-relative path', () => {
  const left = rw.unrewrittenPaths('x .claude-tweaks/pipelines/R/work/a.md y', { mainRoot, runName: 'R', outDir: '/out' });
  assert.deepStrictEqual(left, ['.claude-tweaks/pipelines/R/work/a.md']);
});

test('sha rewrite maps full and abbreviated shas', () => {
  const out = rw.rewriteShas('x ' + B + ' y ' + H.slice(0, 7), { [B]: RB, [H]: RH });
  assert.strictEqual(out, 'x ' + RB + ' y ' + RH.slice(0, 7));
});

test('sha rewrite leaves unrelated hex tokens', () => {
  const text = 'index ' + B.slice(0, 6) + 'f..deadbeef1';
  assert.notStrictEqual(B[6], 'f');
  assert.strictEqual(rw.rewriteShas(text, { [B]: RB }), text);
});

test('stripEffortLines removes only the resolver line', () => {
  assert.strictEqual(rw.stripEffortLines('a\n[Effort: high — apply high-level reasoning depth to this task.]\nb'), 'a\nb');
  assert.strictEqual(rw.stripEffortLines('see [Effort: high] above'), 'see [Effort: high] above');
  assert.strictEqual(rw.stripEffortLines('tail [Effort: high — x.]'), 'tail [Effort: high — x.]');
});
