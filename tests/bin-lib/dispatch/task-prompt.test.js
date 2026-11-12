'use strict';
// #4589: the pure renderer behind the dispatch-prompt CLI — fills the two fenced Task() templates
// of the dispatch skill's task-prompt.md from a closed placeholder set, so no prompt is
// hand-substituted. Reads the live template file so a prose edit there flows through untouched.
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const path = require('node:path');
const { readText } = require('../../helpers/read-skill');
const tp = require('../../../plugin/bin/lib/dispatch/task-prompt');

const {
  DISPATCHER_PLACEHOLDERS, extractTemplates, extractContextPack, profileOf, findUnsubstituted,
  renderResumeContext, MARKER_RE, markerLine, promptDigest, REGISTRY_FILE, promptSize, fitsChunk,
  chunkPrompt, renderTaskPrompt,
} = tp;

const TEMPLATE_FILE = path.join(__dirname, '..', '..', '..', 'plugin', 'skills', 'dispatch', 'task-prompt.md');
const text = readText(TEMPLATE_FILE);

const RUN_ID = '2026-11-01T181353-record-4589';
const EFFORT = '[Effort: high — apply high-level reasoning depth to this task.]';
const OPTS = {
  call: 'first',
  issues: [4589],
  runDir: '/tmp/x y/.claude-tweaks/pipelines/' + RUN_ID,
  pluginRoot: '/p/root',
  policyValues: 'autonomy=unattended, integration-model=pr-first',
  selectedAt: '2026-11-01T18:13:14.928Z',
  effortLine: EFFORT,
};
const render = (o = {}, t = text) => renderTaskPrompt(t, { ...OPTS, ...o });

function assertRendered(out, call, template, pack) {
  assert.deepStrictEqual(findUnsubstituted(out), []);
  assert.ok(out.includes(OPTS.runDir));
  if (call === 'first') assert.ok(out.includes('/p/root/bin/verify-run-bookends.js'));
  assert.ok(out.includes('Selected at: 2026-11-01T18:13:14.928Z'));
  assert.ok(out.includes(OPTS.policyValues));
  assert.ok(out.includes(RUN_ID));
  assert.ok(out.startsWith('[dispatch-prompt: ' + RUN_ID + ' ' + call + ']\n\n'));
  assert.ok(out.endsWith(OPTS.effortLine));
  assert.ok(template.length && pack.length);
}

const fixedLines = (src) => src.split('\n').filter((l) => l.length
  && !DISPATCHER_PLACEHOLDERS.some((p) => l.includes(p)) && !l.includes('{issue}') && !l.includes('{n1}'));

test('AC1.1: the live first and second templates render with no dispatcher placeholder left', () => {
  const { first, second } = extractTemplates(text);
  const pack = extractContextPack(text);
  for (const [call, tpl] of [['first', first], ['second', second]]) {
    assertRendered(render({ call }), call, tpl, pack);
  }
});

test('Deliverable 3: the rendered prompt contains every fixed line of its template and of the Context pack', () => {
  const templates = extractTemplates(text);
  const pack = extractContextPack(text);
  for (const call of ['first', 'second']) {
    const out = render({ call });
    for (const line of [...fixedLines(templates[call]), ...fixedLines(pack)]) {
      assert.ok(out.includes(line), `${call}: missing line ${JSON.stringify(line)}`);
    }
  }
});

test('singleton fills #{issue} only', () => {
  const out = render();
  assert.ok(out.includes('/claude-tweaks:flow #4589 build,test auto`'));
  assert.ok(out.includes('"#{n1},#{n2},..."'));
});

test('bundle fills the bundle line only', () => {
  const out = render({ issues: [4589, 4590] });
  assert.ok(out.includes('"#4589,#4590" build,test auto'));
  assert.ok(out.includes('GROUP: 4589,4590'));
  assert.ok(out.includes('#{issue}'));
});

test('continuation replaces both step lists and keeps the stop sentence', () => {
  const first = render({ stepToken: 'test' });
  assert.strictEqual(first.split('build,test auto').length, 1);
  assert.strictEqual(first.split('test auto').length - 1, 2);
  assert.ok(first.includes('Stop after the test gate -- do not proceed to review, polish, or wrap-up;'));
  const second = render({ call: 'second', stepToken: 'polish,wrap-up' });
  assert.strictEqual(second.split('polish,wrap-up auto').length - 1, 2);
  assert.ok(!second.includes('review,polish,wrap-up auto'));
});

test('continuation takes a per-record stepArg', () => {
  const token = 'record-steps=#12:none;#34:test';
  const out = render({ issues: [12, 34], stepToken: token });
  assert.strictEqual(out.split(token + ' auto').length - 1, 2);
  assert.ok(out.split('\n').some((l) => l.includes('/claude-tweaks:flow "#12,#34"') && l.includes(token + ' auto')));
  assert.ok(!out.includes('build,test'));
});

test('headless inserts the marker on both first-call invocation lines', () => {
  const out = render({ headless: true });
  assert.strictEqual(out.split('" DISPATCH_HEADLESS=1 /claude-tweaks:flow').length - 1, 2);
  assert.throws(() => render({ call: 'second', headless: true }), /first call only/);
});

const VERDICT = {
  prUrl: 'https://github.com/o/r/pull/9',
  priorRunId: '2026-10-30T101632-record-4589',
  context: { lastPhase: { section: '/build', step: 'Common Step 1.6' }, openDefects: ['plan review: 2 questions', 'x'] },
};

test('resume prefixes RESUME_PR and appends the resume context', () => {
  const out = render({ resume: VERDICT });
  assert.strictEqual(out.split('" RESUME_PR="https://github.com/o/r/pull/9" /claude-tweaks:flow').length - 1, 2);
  const line = renderResumeContext(VERDICT);
  assert.strictEqual(line, 'Resuming stalled run 2026-10-30T101632-record-4589 on PR https://github.com/o/r/pull/9; '
    + 'last logged phase: /build Common Step 1.6; open defects: plan review: 2 questions; x');
  const at = out.indexOf(line);
  assert.ok(at !== -1);
  assert.ok(out.indexOf('contract § Model Selection') !== -1);
  assert.ok(out.indexOf('contract § Model Selection') < at);
  assert.ok(at < out.indexOf(EFFORT));
  for (const context of [null, { lastPhase: null, openDefects: [] }]) {
    assert.ok(renderResumeContext({ ...VERDICT, context }).endsWith('last logged phase: none recorded; open defects: none recorded'));
  }
  assert.throws(() => render({ call: 'second', resume: VERDICT }), /first call only/);
  assert.throws(() => render({ headless: true, resume: VERDICT }), /resume/);
  assert.ok(render({ resume: VERDICT, stepToken: 'test' }).includes('test auto'));
  assert.throws(() => renderResumeContext({ ...VERDICT, prUrl: '' }));
  assert.throws(() => renderResumeContext({ ...VERDICT, priorRunId: undefined }));
});

test('renders a $& path literally', () => {
  const runDir = '/tmp/a$&b/.claude-tweaks/pipelines/r1';
  assert.ok(render({ runDir }).includes(runDir));
});

test('renders a $& resume prUrl literally on both invocation lines', () => {
  const prUrl = 'https://github.com/o/r/pull/9?x=$&y=$1';
  const out = render({ resume: { ...VERDICT, prUrl } });
  assert.strictEqual(out.split(`" RESUME_PR="${prUrl}" /claude-tweaks:flow`).length - 1, 2);
});

test('a value carrying a dispatcher placeholder token is refused, never rewritten', () => {
  const cases = [
    ['runDir', { runDir: '/tmp/{ISO}/.claude-tweaks/pipelines/r1' }, '{ISO}'],
    ['runDir', { runDir: '/tmp/x/.claude-tweaks/pipelines/{run-id}' }, '{run-id}'],
    ['pluginRoot', { pluginRoot: '/p/{policy-values}' }, '{policy-values}'],
    ['policyValues', { policyValues: 'autonomy={minted-run-dir}' }, '{minted-run-dir}'],
    ['selectedAt', { selectedAt: '{plugin-root}' }, '{plugin-root}'],
    ['stepToken', { stepToken: 'test{ISO}' }, '{ISO}'],
    ['resume.prUrl', { resume: { ...VERDICT, prUrl: 'https://x/{ISO}' } }, '{ISO}'],
  ];
  for (const [name, o, tok] of cases) {
    assert.throws(() => render(o), (err) => err.message === `${name} contains the placeholder token ${tok}`, name);
  }
  // A value with a non-dispatcher brace token (agent-facing) still renders.
  assert.ok(render({ runDir: '/tmp/{n}/.claude-tweaks/pipelines/r1' }).includes('/tmp/{n}/.claude-tweaks/pipelines/r1'));
});

test('issues must be positive integers', () => {
  for (const issues of [[0], [-3], [1.5], ['12'], [NaN], [4589, null]]) {
    assert.throws(() => render({ issues }), /issues must be positive integers/, JSON.stringify(issues));
  }
  assert.ok(render({ issues: [1] }).includes('#1'));
});

test('a missing or empty runDir fails with a clear error', () => {
  for (const runDir of [undefined, null, '', 42]) {
    assert.throws(() => render({ runDir }), (err) => !(err instanceof TypeError) && err.message === 'runDir must be a non-empty string', String(runDir));
  }
});

test('AC4.1: an unsubstituted placeholder fails the render', () => {
  assert.throws(() => render({ selectedAt: undefined }), /unsubstituted.*\{ISO\}/);
  assert.deepStrictEqual(findUnsubstituted('x {minted-run-dir} y'), ['{minted-run-dir}']);
});

test('AC4.1 go-red control', () => {
  const { first } = extractTemplates(text);
  const out = render();
  assert.throws(() => assertRendered(out.split(OPTS.runDir).join('{minted-run-dir}'), 'first', first, 'p'));
});

test('AC3.1: editing a sentence in a fenced block changes the output with no code change', () => {
  const doctored = text.replace('Never run `git stash`', 'Never run EDITED-SENTENCE');
  assert.notStrictEqual(doctored, text);
  assert.ok(render({}, doctored).includes('Never run EDITED-SENTENCE'));
  assert.ok(!render().includes('Never run EDITED-SENTENCE'));
});

test('a template that lost a value placeholder fails loud', () => {
  assert.throws(() => render({}, text.replace('{policy-values}', 'none')), /\{policy-values\}/);
});

test("profileOf reads each template's [Use:] line", () => {
  const { first, second } = extractTemplates(text);
  assert.strictEqual(profileOf(first), 'capable');
  assert.strictEqual(profileOf(second), 'standard');
  assert.throws(() => profileOf('no profile line'));
});

test('structure drift throws', () => {
  assert.throws(() => extractTemplates(text.replace('## Second call', '## Gone')), /Second call/);
  assert.throws(() => extractContextPack(text.replace('Substitute this whole block', 'Gone')));
});

test('marker and digest', () => {
  const m = MARKER_RE.exec(render());
  assert.deepStrictEqual([m[1], m[2]], [RUN_ID, 'first']);
  assert.strictEqual(markerLine('r1', 'second'), '[dispatch-prompt: r1 second]');
  assert.strictEqual(REGISTRY_FILE, 'dispatch-prompts.jsonl');
});

test('MARKER_RE matches the marker only as the first line', () => {
  const marker = markerLine(RUN_ID, 'first');
  assert.ok(MARKER_RE.exec(`${marker}\n\nbody`));
  assert.ok(MARKER_RE.exec(marker));
  assert.strictEqual(MARKER_RE.exec(`Review this prompt:\n${marker}\n\nbody`), null);
  assert.strictEqual(MARKER_RE.exec(`\n${marker}\nbody`), null);
  assert.strictEqual(MARKER_RE.exec(`${marker} trailing\nbody`), null);
  assert.strictEqual(MARKER_RE.exec(` ${marker}\nbody`), null);
});

test('digest hashes the exact bytes', () => {
  assert.notStrictEqual(promptDigest('a\nb'), promptDigest('a\nb\n'));
  assert.notStrictEqual(promptDigest('a\nb'), promptDigest('a \nb'));
  assert.strictEqual(promptDigest('a\nb'), promptDigest('a\nb'));
  assert.match(promptDigest('a\nb'), /^[0-9a-f]{64}$/);
  assert.strictEqual(promptDigest('é'), crypto.createHash('sha256').update('é', 'utf8').digest('hex'));
});

test('the rendered prompt ends without whitespace', () => {
  for (const call of ['first', 'second']) {
    for (const effortLine of [EFFORT, null]) {
      const out = render({ call, effortLine });
      assert.strictEqual(out, out.replace(/\s+$/, ''));
    }
  }
});

const LONG = {
  runDir: '/' + 'r'.repeat(70) + '/.claude-tweaks/pipelines/2026-11-01T190716-record-4589',
  pluginRoot: '/' + 'p'.repeat(93),
  policyValues: 'autonomy=unattended, integration-model=pr-first, merge-verification=merge-when-green, risk-floor=high, size-floor=high',
};

test('chunkPrompt rejoins to the exact prompt', () => {
  for (const call of ['first', 'second']) {
    const out = render({ call, ...LONG });
    const chunks = chunkPrompt(out);
    assert.strictEqual(chunks.join('\n'), out);
    for (const c of chunks) {
      assert.ok(fitsChunk(c));
      assert.strictEqual(c, c.trim());
    }
    if (call === 'second') assert.ok(chunks.length >= 2);
  }
});

test('the live second template renders and chunks at PATH_MAX path lengths', () => {
  const pad = (prefix, tail) => prefix + 'd'.repeat(1024 - prefix.length - tail.length) + tail;
  const tail = '/.claude-tweaks/pipelines/2026-11-01T190716-record-4589';
  const runDir = pad('/', tail);
  assert.strictEqual(runDir.length, 1024);
  const out = render({ call: 'second', runDir, pluginRoot: '/' + 'p'.repeat(1023) });
  assert.strictEqual(promptSize(out).ok, true);
  assert.strictEqual(chunkPrompt(out).join('\n'), out);
  assert.strictEqual(promptSize(render({ call: 'second', pluginRoot: '/' + 'p'.repeat(19999) })).ok, false);
});

test('chunkPrompt throws on an unsplittable prompt', () => {
  assert.throws(() => chunkPrompt('a'.repeat(20001)), /no chunk split/);
  assert.throws(() => chunkPrompt('b\n' + 'a'.repeat(20001)), /no chunk split/);
  assert.strictEqual(chunkPrompt('a'.repeat(20000)).length, 1);
});

test('chunkPrompt never cuts beside whitespace', () => {
  const lines = Array.from({ length: 300 }, (_, i) => (i % 3 ? '  ' : '') + 'x'.repeat(99));
  const fixture = lines.join('\n');
  const chunks = chunkPrompt(fixture);
  assert.strictEqual(chunks.join('\n'), fixture);
  for (const c of chunks) assert.strictEqual(c, c.trim());
});

test("chunkPrompt cuts where its own rule allows, not at the last newline that fits", () => {
  // L1..L3 fit one chunk (18,002 B) and L4 would overflow it, so a greedy cut lands after L3 —
  // but L4 starts with a space, and the L2/L3 newline sits after L2's trailing space. The only
  // legal cut in reach is after L1; the rest (18,103 B) fits one chunk.
  const L = ['a'.repeat(6000), `${'b'.repeat(5999)} `, 'c'.repeat(6000), ` ${'d'.repeat(5999)}`, 'e'.repeat(100)];
  const fixture = L.join('\n');
  assert.deepStrictEqual(chunkPrompt(fixture), [L[0], L.slice(1).join('\n')]);
});

test('promptSize and fitsChunk count UTF-8 bytes', () => {
  assert.strictEqual(promptSize('é').bytes, 2);
  assert.strictEqual(promptSize('a'.repeat(131072)).ok, true);
  assert.strictEqual(promptSize('a'.repeat(131073)).ok, false);
  assert.strictEqual(fitsChunk('a'.repeat(20000)), true);
  assert.strictEqual(fitsChunk('é'.repeat(10001)), false);
});
