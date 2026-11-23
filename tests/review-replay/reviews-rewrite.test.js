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

test('originRefsOf: a ref ends at a three-dot range or a space, quote, backtick, paren, comma or the end, once per name', () => {
  assert.deepStrictEqual(rw.originRefsOf('git diff origin/main...HEAD'), ['main']);
  assert.deepStrictEqual(rw.originRefsOf('git diff origin/feat/x...HEAD'), ['feat/x']);
  for (const after of [' ', '\'', '"', '`', ')', ',', '']) assert.deepStrictEqual(rw.originRefsOf(`base origin/main${after}`), ['main'], JSON.stringify(after));
  assert.deepStrictEqual(rw.originRefsOf('origin/main and (origin/dev) then origin/main, origin/v1.2_x-y'), ['main', 'dev', 'v1.2_x-y']);
  assert.deepStrictEqual(rw.originRefsOf('no refs here'), []);
});

test('originRefsOf: a two-dot range also ends the ref (git ref names never hold `..`)', () => {
  assert.deepStrictEqual(rw.originRefsOf('git log origin/main..main'), ['main']);
  assert.deepStrictEqual(rw.originRefsOf('git diff origin/feat/x..HEAD'), ['feat/x']);
});

test('originRefsOf: characterization of the forms it accepts (each a ref git check-ref-format takes)', () => {
  const cases = [
    ['git diff origin/main...HEAD', ['main']], ['git log origin/main..main', ['main']], ['origin/main...', ['main']],
    ['base origin/main ', ['main']], ['base origin/main\t', ['main']], ['base origin/main\nnext', ['main']],
    ['`git diff origin/main...HEAD`', ['main']], ['`origin/main`', ['main']], ['(origin/main)', ['main']],
    ['origin/feat/x.y_z-1 ', ['feat/x.y_z-1']], ['origin/v1.2', ['v1.2']], ['origin/a./b ', ['a./b']], ['origin/a.lockx ', ['a.lockx']],
    ['github.com/origin/main ', ['main']], ['xorigin/main ', []],
    ['origin/dev and origin/main...HEAD, origin/dev', ['dev', 'main']],
  ];
  for (const [text, refs] of cases) assert.deepStrictEqual(rw.originRefsOf(text), refs, JSON.stringify(text));
});

test('originRefsOf: sentence dots, `:` and `;` end a ref; a capture git check-ref-format refuses is dropped', () => {
  const cases = [
    ['origin/main.', ['main']], ['diff against origin/main. Then', ['main']], ['origin/v1.2.', ['v1.2']],
    ['origin/main:', ['main']], ['git show origin/main:src/x.js', ['main']], ['origin/main;', ['main']], ['origin/main; then', ['main']],
    // Refused by git, so never written: a component starting with `.`, a `.lock` component, an empty component.
    ['origin/x/ ', []], ['origin/.x ', []], ['origin/a/.b ', []], ['origin/x.lock ', []], ['origin/a.lock/b ', []],
    ['origin//x ', []], ['origin/a//b ', []], ['origin/. ', []], ['origin/.. ', []],
  ];
  for (const [text, refs] of cases) assert.deepStrictEqual(rw.originRefsOf(text), refs, JSON.stringify(text));
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

const full = { mainRoot, runName: 'R', repoPath: '/out/repos/k/repo', replacements: {}, shaMap: {} };

test('a bare main-checkout path is rewritten and detected', () => {
  assert.strictEqual(rw.rewriteText('RUN_ROOT="' + main + '" cd ' + main, full), 'RUN_ROOT="/out/repos/k/repo" cd /out/repos/k/repo');
  assert.strictEqual(rw.rewriteText(main + '-other/x', full), main + '-other/x');
  assert.deepStrictEqual(rw.unrewrittenPaths('cd "' + main + '" && git diff', { mainRoot, runName: 'R', outDir: '/out' }), [main]);
  assert.deepStrictEqual(rw.unrewrittenPaths('x ' + main, { mainRoot, runName: 'R', outDir: '/out' }), [main]);
  assert.deepStrictEqual(rw.unrewrittenPaths(main + '-other/x', { mainRoot, runName: 'R', outDir: '/out' }), []);
});

test('a relative run directory without a trailing slash is detected', () => {
  const o = { mainRoot, runName: 'R', outDir: '/out' };
  assert.deepStrictEqual(rw.unrewrittenPaths('see `.claude-tweaks/pipelines/R`', o), ['.claude-tweaks/pipelines/R']);
  assert.deepStrictEqual(rw.unrewrittenPaths('.claude-tweaks/pipelines/RR/x', o), []);
});

test('an outDir equal to or containing mainRoot does not blind the barrier', () => {
  const text = main + '/src/a.js ' + main + '/.claude-tweaks/pipelines/R/decisions.md';
  assert.strictEqual(rw.unrewrittenPaths(text, { mainRoot, runName: 'R', outDir: mainRoot }).length, 2);
  assert.strictEqual(rw.unrewrittenPaths(text, { mainRoot, runName: 'R', outDir: '/m' }).length, 2);
  assert.strictEqual(rw.unrewrittenPaths(main + '/out', { mainRoot, runName: 'R', outDir: main + '/out' }).length, 0);
});

test('a trailing slash on mainRoot or outDir is normalised', () => {
  const o = { mainRoot: main + '/', runName: 'R', outDir: main + '/out/' };
  assert.strictEqual(rw.unrewrittenPaths(main + '/src/a.js', o).length, 1);
  assert.strictEqual(rw.unrewrittenPaths(main + '/out/x', o).length, 0);
  assert.strictEqual(rw.rewriteText('git -C ' + main + '/.claude/worktrees/w diff', { ...full, mainRoot: main + '/' }), 'git -C /out/repos/k/repo diff');
  assert.strictEqual(rw.runInputsOf(main + '/.claude-tweaks/pipelines/R/review-ctx/context.md', { mainRoot: main + '/', runName: 'R' }).inputs.length, 1);
});

test('a scratch tail with .. or a comma is unknown', () => {
  const base = main + '/.claude-tweaks/pipelines/R/review-ctx/agent-scratch/';
  const up = rw.runInputsOf(base + 'x/../../decisions.md', opts);
  assert.deepStrictEqual(up.inputs, []);
  assert.strictEqual(up.unknown.length, 1);
  const joined = rw.runInputsOf(base + '3a,' + main + '/.claude-tweaks/pipelines/R/decisions.md', opts);
  assert.deepStrictEqual(joined.inputs, []);
  assert.strictEqual(joined.unknown.length, 2);
  assert.strictEqual(rw.runInputsOf(base + '3a/sub/f.md', opts).inputs[0].kind, 'scratch');
});

test('sha rewrite treats an underscore as a separator', () => {
  assert.strictEqual(rw.rewriteShas('tmp_' + B.slice(0, 7) + '_x', { [B]: RB }), 'tmp_' + RB.slice(0, 7) + '_x');
  assert.strictEqual(rw.rewriteShas('x' + B.slice(0, 7), { [B]: RB }), 'x' + B.slice(0, 7));
});

test('a worktree name does not eat a sentence full stop', () => {
  assert.strictEqual(rw.rewriteText('in ' + main + '/.claude/worktrees/w.', full), 'in /out/repos/k/repo.');
  assert.strictEqual(rw.rewriteText(main + '/.claude/worktrees/flow-1.2', full), '/out/repos/k/repo');
});

test('sentence punctuation after a bare root or run dir counts as a path end', () => {
  const o = { mainRoot, runName: 'R', outDir: '/out' };
  for (const p of ['.', ',', ';', ':', '.)', '...']) {
    assert.strictEqual(rw.rewriteText('cd ' + main + p + ' Then', full), 'cd /out/repos/k/repo' + p + ' Then');
    assert.deepStrictEqual(rw.unrewrittenPaths('cd ' + main + p + ' Then', o), [main], p);
    assert.deepStrictEqual(rw.unrewrittenPaths('see .claude-tweaks/pipelines/R' + p + ' x', o), ['.claude-tweaks/pipelines/R'], p);
  }
  assert.deepStrictEqual(rw.unrewrittenPaths('end ' + main + '.', o), [main]);
});

test('a dotted continuation is not a bare root or run dir', () => {
  const o = { mainRoot, runName: 'R', outDir: '/out' };
  assert.strictEqual(rw.rewriteText(main + '.x/y and ' + main + '.bak', full), main + '.x/y and ' + main + '.bak');
  assert.deepStrictEqual(rw.unrewrittenPaths(main + '.x/y ' + main + '.bak', o), []);
  assert.deepStrictEqual(rw.unrewrittenPaths('.claude-tweaks/pipelines/R.x/y', o), []);
});

test('a path-list separator ends a root mention', () => {
  const o = { mainRoot, runName: 'R', outDir: '/out' };
  const list = 'PATH=' + main + ':/b and ' + main + ',' + main + '2 x ' + main + '."';
  assert.strictEqual(rw.rewriteText(list, full), 'PATH=/out/repos/k/repo:/b and /out/repos/k/repo,' + main + '2 x /out/repos/k/repo."');
  assert.deepStrictEqual(rw.unrewrittenPaths('PATH=' + main + ':/b', o), [main]);
  assert.deepStrictEqual(rw.unrewrittenPaths(main + ',' + main + '2', o), [main]);
  assert.deepStrictEqual(rw.unrewrittenPaths('x .claude-tweaks/pipelines/R:/b', o), ['.claude-tweaks/pipelines/R']);
  assert.deepStrictEqual(rw.unrewrittenPaths('.claude-tweaks/pipelines/RR. .claude-tweaks/pipelines/R.x', o), []);
});

test('the outDir exemption covers only a mention wholly inside outDir', () => {
  const o = { mainRoot, runName: 'R', outDir: main + '/out' };
  assert.deepStrictEqual(rw.unrewrittenPaths('see ' + main + '/out. ok', o), []);
  assert.deepStrictEqual(rw.unrewrittenPaths('see ' + main + '/out/a, ' + main + '/out/b;', o), []);
  assert.strictEqual(rw.unrewrittenPaths(main + '/out:' + main + '/src', o).length, 1);
  assert.deepStrictEqual(rw.unrewrittenPaths(main + '/out:/etc', o), [main + '/out:/etc']);
  assert.deepStrictEqual(rw.unrewrittenPaths(main + '/outside/x', o), [main + '/outside/x']);
});

test('an empty or filesystem-root mainRoot is rejected', () => {
  for (const bad of ['/', '', '//']) {
    assert.throws(() => rw.rewriteText('a b', { ...full, mainRoot: bad }), /mainRoot/);
    assert.throws(() => rw.unrewrittenPaths('a b', { mainRoot: bad, runName: 'R', outDir: '/out' }), /mainRoot/);
  }
});

test('stripEffortLines keeps a following blank line', () => {
  assert.strictEqual(rw.stripEffortLines('a\n[Effort: low — x.]\n\nb'), 'a\n\nb');
});

test('a path under the main checkout is not the bare root: left in place and flagged', () => {
  const o = { mainRoot, runName: 'R', outDir: '/out' };
  const out = rw.rewriteText('read ' + main + '/src/a.js and ' + main + '/', full);
  assert.strictEqual(out, 'read ' + main + '/src/a.js and ' + main + '/');
  assert.deepStrictEqual(rw.unrewrittenPaths(out, o), [main + '/src/a.js', main + '/']);
});

test('no rewrite step re-matches text an earlier step produced', () => {
  // Task 4's repo path carries the archived shas' 7-char prefixes; neither it nor a
  // replacement value under the main checkout may be rewritten a second time.
  const repoPath = main + '/out/repos/R--' + B.slice(0, 7) + '-' + H.slice(0, 7) + '/repo';
  const p = main + '/.claude-tweaks/pipelines/R/review-ctx/context.md';
  const value = main + '/out/repos/k/ctx/context.md';
  const o = { mainRoot, runName: 'R', repoPath, replacements: { [p]: value }, shaMap: { [B]: RB, [H]: RH } };
  const out = rw.rewriteText('git -C ' + main + '/.claude/worktrees/w diff ' + B + ' read ' + p + ' in ' + main, o);
  assert.strictEqual(out, 'git -C ' + repoPath + ' diff ' + RB + ' read ' + value + ' in ' + repoPath);
  assert.deepStrictEqual(rw.unrewrittenPaths(out, { mainRoot, runName: 'R', outDir: main + '/out' }), []);
  assert.strictEqual(rw.rewriteText('at ' + B + ' in ' + main, { ...full, shaMap: { [B]: RB } }), 'at ' + RB + ' in /out/repos/k/repo');
});

test('an outDir span ends at a separator, so a joined path is still flagged', () => {
  for (const m of [main, '/m/repo']) {
    const o = { mainRoot: m, runName: 'R', outDir: m + '/out' };
    for (const sep of [',', ':', ';', '|']) {
      assert.strictEqual(rw.unrewrittenPaths(m + '/out/x' + sep + m + '/src/a.js', o).length, 1, m + sep);
    }
    assert.strictEqual(rw.unrewrittenPaths(m + '/out/x,.claude-tweaks/pipelines/R/decisions.md', o).length, 1, m);
    assert.deepStrictEqual(rw.unrewrittenPaths(m + '/out/x/y-1.2_z+w', o), [], m);
    assert.deepStrictEqual(rw.unrewrittenPaths(m + '/src/a.js ' + m + '/out/x', o), [m + '/src/a.js'], m);
  }
});

test('trailing punctuation is trimmed as a whole run, colon included', () => {
  const p = main + '/.claude-tweaks/pipelines/R/review-ctx/context.md';
  assert.strictEqual(rw.runInputsOf('read ' + p + '...,;:', opts).inputs[0].match, p);
  assert.strictEqual(rw.runInputsOf('read ' + p + ':', opts).inputs[0].match, p);
  const o = { mainRoot, runName: 'R', outDir: main + '/out' };
  assert.deepStrictEqual(rw.unrewrittenPaths('see ' + main + '/out/a: ok', o), []);
});

test('rewriteText replaces an unknown run-directory path the caller names, worktree prefix and all', () => {
  const own = main + '/.claude-tweaks/pipelines/R/decisions.md';
  const wt = main + '/.claude/worktrees/w/.claude-tweaks/pipelines/R/decisions.md';
  const other = main + '/.claude-tweaks/pipelines/OTHER/review-ctx/context.md';
  const wtOther = main + '/.claude/worktrees/w/.claude-tweaks/pipelines/OTHER/x.md';
  const gone = '[run-directory path removed]';
  const text = [own, wt, other, wtOther, 'see .claude-tweaks/pipelines/OTHER/decisions.md'].join('\n');
  const { unknown } = rw.runInputsOf(text, { ...opts, copy: true });
  assert.deepStrictEqual(unknown, [own, wt, other, wtOther]);
  const replacements = Object.fromEntries(unknown.map((u) => [u, gone]));
  const out = rw.rewriteText(text, { ...full, replacements });
  assert.strictEqual(out, [gone, gone, gone, gone, 'see .claude-tweaks/pipelines/OTHER/decisions.md'].join('\n'));
  assert.deepStrictEqual(rw.unrewrittenPaths(out, { mainRoot, runName: 'R', outDir: '/out' }), []);
  // With no replacement named, an unknown path stays and is flagged.
  assert.strictEqual(rw.rewriteText(own, full), own);
});

test('an absolute worktree or run-directory path under another root is flagged when mainRoot is wrong', () => {
  const o = { mainRoot: '/Volumes/backup/repo', runName: 'R', outDir: '/out' };
  const wt = '/Users/x/Code Workspaces/repo/.claude/worktrees/flow-spec-9';
  assert.deepStrictEqual(rw.unrewrittenPaths('WORKTREE: ' + wt, o), [wt]);
  assert.deepStrictEqual(rw.unrewrittenPaths('git -C "' + wt + '" diff', o), [wt]);
  const other = '/Users/x/Code Workspaces/repo/.claude-tweaks/pipelines/OTHER/review-ctx/context.md';
  assert.deepStrictEqual(rw.unrewrittenPaths('Earlier run: ' + other + '.', o), [other]);
  assert.deepStrictEqual(rw.unrewrittenPaths('at C:/w/repo/.claude/worktrees/w now', o), ['C:/w/repo/.claude/worktrees/w']);
  assert.deepStrictEqual(rw.unrewrittenPaths('at ~/repo/.claude/worktrees/w now', o), ['~/repo/.claude/worktrees/w']);
  // A relative mention is no leak: none of these starts at an absolute path.
  for (const rel of ['+see .claude-tweaks/pipelines/OTHER/decisions.md', '`$RUN_ROOT/.claude-tweaks/pipelines/{run}/`', 'diff a/.claude/worktrees/b', '{main}/.claude/worktrees/{name}']) {
    assert.deepStrictEqual(rw.unrewrittenPaths(rel, o), [], rel);
  }
  // A separator ends the absolute path, so a later relative mention is not tied to it.
  assert.deepStrictEqual(rw.unrewrittenPaths('cd /tmp; see a/.claude/worktrees/b', o), []);
  // Inside the output directory it is exempt, wherever that directory sits.
  const out = '/tmp/w/.claude/worktrees/x/out';
  assert.deepStrictEqual(rw.unrewrittenPaths(out + '/repos/k/repo and ' + out + '/s', { ...o, outDir: out }), []);
  assert.deepStrictEqual(rw.unrewrittenPaths('/tmp/w/.claude/worktrees/x/src', { ...o, outDir: out }), ['/tmp/w/.claude/worktrees/x/src']);
  // Under the right mainRoot the existing check reports it, once.
  assert.deepStrictEqual(rw.unrewrittenPaths(main + '/.claude/worktrees/w', { mainRoot, runName: 'R', outDir: '/out' }), [main + '/.claude/worktrees/w']);
});

test('with an exists predicate, a foreign path is flagged only when its checkout prefix exists', () => {
  const live = '/Users/x/Code Workspaces/repo/.claude/worktrees';
  const asked = [];
  const exists = (p) => {
    asked.push(p);
    return p === live;
  };
  const o = { mainRoot: '/Volumes/backup/repo', runName: 'R', outDir: '/out', exists };
  const wt = live + '/flow-spec-9';
  assert.deepStrictEqual(rw.unrewrittenPaths('WORKTREE: ' + wt, o), [wt]);
  assert.deepStrictEqual(rw.unrewrittenPaths("+  root: '/p/.claude-tweaks/pipelines/r1'", o), []);
  // Which prefixes were asked about, not in what order or how often: a probe order is an implementation detail.
  assert.deepStrictEqual([...new Set(asked)].sort(), [live, '/p/.claude-tweaks/pipelines'].sort());
  // The predicate never widens the barrier past the existing checks, and is not asked about them.
  asked.length = 0;
  assert.deepStrictEqual(rw.unrewrittenPaths(main + '/.claude/worktrees/w', { mainRoot, runName: 'R', outDir: '/out', exists }), [main + '/.claude/worktrees/w']);
  assert.deepStrictEqual(asked, []);
  // A prefix longer than any real path cannot exist, so the predicate is not asked.
  assert.deepStrictEqual(rw.unrewrittenPaths('/' + 'a'.repeat(5000) + '/.claude/worktrees/w', { ...o, exists: () => true }), []);
  // Without a predicate every foreign mention is flagged.
  assert.deepStrictEqual(rw.unrewrittenPaths("root: '/p/.claude-tweaks/pipelines/r1'", { ...o, exists: undefined }), ['/p/.claude-tweaks/pipelines/r1']);
});

test('the exists predicate is never handed a checkout prefix longer than the path cap', () => {
  const lengths = [];
  const exists = (p) => {
    lengths.push(p.length);
    return true;
  };
  const o = { mainRoot: '/Volumes/backup/repo', runName: 'R', outDir: '/out', exists };
  rw.unrewrittenPaths('/' + 'a'.repeat(5000) + '/.claude/worktrees/w', o);
  rw.unrewrittenPaths('/' + 'b'.repeat(5000) + '/.claude-tweaks/pipelines/r1', o);
  rw.unrewrittenPaths('/p/.claude/worktrees/w', o);
  assert.ok(lengths.length > 0, 'the control path reaches the predicate');
  assert.ok(lengths.every((n) => n <= 4096), `lengths: ${lengths.join(', ')}`);
});

test('a rewritten path with brackets, @, ~, = or non-ASCII stays inside the outDir span', () => {
  const o = { mainRoot, runName: 'R', outDir: main + '/out' };
  for (const tail of ['app/[slug]/page.tsx', 'node_modules/@types/x.d.ts', 'src/~tmp', 'src/a=b.js', 'docs/café.md']) {
    assert.deepStrictEqual(rw.unrewrittenPaths('read ' + main + '/out/repos/k/repo/' + tail + ' now', o), [], tail);
  }
});

test('a .. segment in an outDir span loses the exemption', () => {
  const o = { mainRoot, runName: 'R', outDir: main + '/out' };
  assert.deepStrictEqual(rw.unrewrittenPaths(main + '/out/x/../../src/a.js', o), [main + '/out/x/../../src/a.js']);
  assert.deepStrictEqual(rw.unrewrittenPaths('see ' + main + '/out/.. ok', o), [main + '/out/..']);
  assert.deepStrictEqual(rw.unrewrittenPaths(main + '/out/x/...y', o), []);
});

test('rewriteText: worktree-prefixed run input, longest literal, and no undefined', () => {
  const spec = main + '/.claude/worktrees/w/.claude-tweaks/pipelines/R/work/9-spec.md';
  assert.strictEqual(rw.rewriteText('read ' + spec, { ...full, replacements: { [spec]: '/S/spec.md' } }), 'read /S/spec.md');
  const s = main + '/.claude-tweaks/pipelines/R/review-ctx/agent-scratch/3a';
  const out = rw.rewriteText(s + ' and ' + s + '/f.md', { ...full, replacements: { [s]: '/S', [s + '/f.md']: '/T/f.md' } });
  assert.strictEqual(out, '/S and /T/f.md');
  const ctx = main + '/.claude-tweaks/pipelines/R/review-ctx/context.md';
  const left = rw.rewriteText('read ' + ctx + ' and ' + s, { ...full, replacements: { [s]: '/S' } });
  assert.strictEqual(left, 'read ' + ctx + ' and /S');
});

test('an own-run mention inside the output directory is still flagged', () => {
  const o = { mainRoot, runName: 'R', outDir: main + '/out' };
  assert.deepStrictEqual(rw.unrewrittenPaths(main + '/out/repos/k/repo/.claude-tweaks/pipelines/R/decisions.md', o), ['.claude-tweaks/pipelines/R/decisions.md']);
  assert.deepStrictEqual(rw.unrewrittenPaths('x ' + main + '/out/.claude-tweaks/pipelines/R y', o), ['.claude-tweaks/pipelines/R']);
  assert.deepStrictEqual(rw.unrewrittenPaths(main + '/out/.claude-tweaks/pipelines/RR/x', o), []);
  assert.deepStrictEqual(rw.unrewrittenPaths(main + '/out/repos/k/repo/src/a.js', o), []);
});

// A win32 archived prompt spells the checkout natively, often joined to a `/` tail (`D:\a\repo/.claude/…`).
const winRoot = 'D:\\a\\main checkout\\repo';
const winText = [
  'git -C "' + winRoot + '/.claude/worktrees/flow-spec-9" status',
  'WORKTREE: ' + winRoot + '\\.claude\\worktrees\\flow-spec-9',
  'Bundle: ' + winRoot + '\\.claude-tweaks\\pipelines\\R\\review-ctx\\context.md',
  "code: split('\\n')",
].join('\n');
const winBundle = 'D:/a/main checkout/repo/.claude-tweaks/pipelines/R/review-ctx/context.md';

test('win32: a native or mixed-separator checkout path is read, rewritten and stitched from the original', () => {
  const w = { mainRoot: winRoot, runName: 'R', platform: 'win32' };
  assert.deepStrictEqual(rw.runInputsOf(winText, w).inputs, [{ match: winBundle, member: null, rel: 'review-ctx/context.md', kind: 'bundle' }]);
  assert.deepStrictEqual(rw.worktreePathsOf(winText, w), ['D:/a/main checkout/repo/.claude/worktrees/flow-spec-9']);
  const out = rw.rewriteText(winText, { ...w, repoPath: '/r/repo', replacements: { [winBundle]: '/out/ctx.md' } });
  assert.strictEqual(out, 'git -C "/r/repo" status\nWORKTREE: /r/repo\nBundle: /out/ctx.md\ncode: split(\'\\n\')');
  assert.deepStrictEqual(rw.unrewrittenPaths(out, { ...w, outDir: '/out' }), []);
  // Off win32 a backslash is a name character, so the same text names no input and nothing is rewritten.
  const l = { ...w, platform: 'linux' };
  assert.deepStrictEqual(rw.runInputsOf(winText, l).inputs, []);
  assert.strictEqual(rw.rewriteText(winText, { ...l, repoPath: '/r/repo' }), winText);
});

test('win32: the leak barrier flags a native main-checkout path and a native foreign worktree path', () => {
  const text = 'Notes: ' + winRoot + '\\notes\\review.md\nOther: E:\\x\\repo\\.claude\\worktrees\\w\\src';
  assert.deepStrictEqual(rw.unrewrittenPaths(text, { mainRoot: winRoot, runName: 'R', platform: 'win32' }), [
    'D:/a/main checkout/repo/notes/review.md',
    'E:/x/repo/.claude/worktrees/w/src',
  ]);
  assert.deepStrictEqual(rw.unrewrittenPaths(text, { mainRoot: winRoot, runName: 'R', platform: 'linux' }), []);
});

test('shaPairOf: Base/Head lines, a sha-less "base" first, and the two-dot fallback', () => {
  assert.deepEqual(rw.shaPairOf('## Diff Under Review\nBase 44200e4559, Head b90d38882a. Diff file: x'), { base: '44200e4559', head: 'b90d38882a' });
  assert.deepEqual(rw.shaPairOf('the review base after a catch-up.\nBase d5346c1c99056b72f56bd2172d720bd6a609fa5b (the merge commit). Head 6a7e879f6f.'), { base: 'd5346c1c99056b72f56bd2172d720bd6a609fa5b', head: '6a7e879f6f' });
  assert.deepEqual(rw.shaPairOf('Fix diff (b90d38882a..c7e979dbd4), read once'), { base: 'b90d38882a', head: 'c7e979dbd4' });
  assert.deepEqual(rw.shaPairOf('Head 1111111aaa was stale. Base 44200e4559, Head b90d38882a.'), { base: '44200e4559', head: 'b90d38882a' });
  assert.equal(rw.shaPairOf('Head 1111111aaa then Base 44200e4559 only'), null);
  assert.equal(rw.shaPairOf('SCOPE: origin/main...HEAD'), null);
  assert.equal(rw.shaPairOf('Base 44200e4559 only'), null);
});

test('pointerPathOf: path on the next line, with spaces', () => {
  const p = 'Read your full review instructions from this file and follow them exactly (it is your prompt; nothing else is):\n/Users/x/Code Workspaces/r/.superpowers/sdd/t/task-3-review-prompt.md\n\n[Effort: high — x.]';
  assert.equal(rw.pointerPathOf(p), '/Users/x/Code Workspaces/r/.superpowers/sdd/t/task-3-review-prompt.md');
  assert.equal(rw.pointerPathOf('(it is your prompt): /tmp/p.txt  '), '/tmp/p.txt');
  assert.equal(rw.pointerPathOf('You are reviewing one task.'), null);
});

test('pointerPathOf: a "this file" prompt with the path alone on its own line, in the archive\'s other wordings', () => {
  const file = '/Users/x/Code Workspaces/r/.superpowers/sdd/t/task-2-review-prompt.md';
  for (const lead of [
    'Your complete instructions for this review are in this file. Read it first and follow it exactly:',
    'Read your full review instructions from this file first and follow them exactly — it is your complete prompt.',
    'You are a task reviewer. Read this file first — it is your complete instructions:',
    'Your full instructions are in this file; read it first, in one Read call, and follow it exactly:',
  ]) {
    assert.equal(rw.pointerPathOf(`${lead}\n\n  ${file}  \n\n[Effort: high — x.]\nReply read-only.`), file, lead);
  }
  assert.equal(rw.pointerPathOf('Your instructions are in this file:\nC:\\Users\\x\\p.md'), 'C:\\Users\\x\\p.md');
  assert.equal(rw.pointerPathOf('Your instructions are in this file:\n~/sdd/p.md'), '~/sdd/p.md');
});

test('pointerPathOf: a "this file" prompt with no lone path line, or two, is not a pointer', () => {
  assert.equal(rw.pointerPathOf('Check the null guard in this file.\nWORKTREE: /Users/x/r\n/tmp/x is your prompt'), null, 'a path followed by words is not a lone path');
  assert.equal(rw.pointerPathOf('Your instructions are in this file:\n/tmp/a/p.md\n/tmp/b/q.md'), null);
  assert.equal(rw.pointerPathOf('Review the change.\n/tmp/a/p.md'), null, 'a lone path line alone does not make a pointer');
});

// The lazy-capture originRefsOf this build replaced for linearity (perf/review-replay-branch-linearity.test.js): kept
// here only as the oracle the hand-cut scan must agree with.
function lazyOriginRefsOf(text) {
  const out = [];
  for (const m of String(text).matchAll(/\borigin\/([A-Za-z0-9._\/-]+?)(?=\.\.|[\s`'"),:;]|$)/g)) {
    let end = m[1].length;
    while (end > 0 && m[1][end - 1] === '.') end--;
    const name = m[1].slice(0, end);
    const takes = name.split('/').every((seg) => seg !== '' && !seg.startsWith('.') && !seg.endsWith('.lock'));
    if (takes && !out.includes(name)) out.push(name);
  }
  return out;
}

test('originRefsOf agrees with the lazy-capture expression on every short string of its pieces', () => {
  const pieces = ['origin/', 'a', '.', '/', '..', '!', ' ', ':', 'x.lock'];
  let checked = 0;
  const walk = (prefix, depth) => {
    assert.deepStrictEqual(rw.originRefsOf(prefix), lazyOriginRefsOf(prefix), JSON.stringify(prefix));
    checked++;
    if (depth === 0) return;
    for (const p of pieces) walk(prefix + p, depth - 1);
  };
  walk('', 5);
  assert.ok(checked > 60000, `checked ${checked} strings`);
});
