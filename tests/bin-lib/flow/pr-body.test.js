// tests/bin-lib/flow/pr-body.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  composePrEarlyBody, composeExpressBody, repairPrBody, hasRunMarker, hasPhasesPair, hasFixesPair,
  composeResumeLine, parseResumeLine, resumeLineUnder, resumeVerdict,
} = require('../../../plugin/bin/lib/flow/pr-body');
const { isExpressPr } = require('../../../plugin/bin/lib/express/sampling');

test('composePrEarlyBody puts the run marker as the unconditional first line, plain-text companion immediately after', () => {
  const body = composePrEarlyBody({
    runId: '2026-10-06T031832-record-2997',
    specSummary: 'One paragraph.',
    target: '#2997',
    nextStep: 'build',
    fixesLines: ['Fixes #2997'],
  });
  assert.match(
    body,
    /^<!-- claude-tweaks-run: 2026-10-06T031832-record-2997 -->\nclaude-tweaks-run: 2026-10-06T031832-record-2997\n\n### Spec summary/,
  );
});

test('composePrEarlyBody contains both delimiter pairs and one Fixes line per target (#2997 AC1)', () => {
  const body = composePrEarlyBody({
    runId: 'r1', specSummary: 's', target: '#1,#2', nextStep: 'build',
    fixesLines: ['Fixes #1', 'Fixes #2'],
  });
  assert.match(body, /<!-- phases-start -->/);
  assert.match(body, /<!-- phases-end -->/);
  assert.match(body, /\[claude-tweaks-phases-start\]/);
  assert.match(body, /\[claude-tweaks-phases-end\]/);
  assert.match(body, /<!-- fixes-start -->/);
  assert.match(body, /<!-- fixes-end -->/);
  assert.match(body, /\[claude-tweaks-fixes-start\]/);
  assert.match(body, /\[claude-tweaks-fixes-end\]/);
  assert.match(body, /Fixes #1/);
  assert.match(body, /Fixes #2/);
  assert.equal(hasRunMarker(body), true);
  assert.equal(hasPhasesPair(body), true);
  assert.equal(hasFixesPair(body), true);
});

test('composePrEarlyBody defaults the phase checklist to the canonical five phases, all unchecked', () => {
  const body = composePrEarlyBody({ runId: 'r1', specSummary: 's', target: '#1', nextStep: 'build', fixesLines: ['Fixes #1'] });
  for (const phase of ['build', 'test', 'review', 'polish', 'wrap-up']) {
    assert.match(body, new RegExp(`- \\[ \\] ${phase}`));
  }
});

// #2877: the rows between the plain-text phase delimiters, as an array of lines.
function phaseRows(body) {
  const match = body.match(/\[claude-tweaks-phases-start\]\n([\s\S]*?)\n\[claude-tweaks-phases-end\]/);
  assert.ok(match, 'phases span present');
  return match[1].split('\n');
}

const CANONICAL_ROWS = ['- [ ] build', '- [ ] test', '- [ ] review', '- [ ] polish', '- [ ] wrap-up'];

test('#2877: a build,test-scoped first call still starts all five phase rows, unchecked, in order', () => {
  const body = composePrEarlyBody({
    runId: 'r1', specSummary: 's', target: '#2749', nextStep: 'build',
    fixesLines: ['Fixes #2749'], phases: ['build', 'test'],
  });
  assert.deepEqual(phaseRows(body), CANONICAL_ROWS);
});

test('#2877: repairPrBody restores the canonical five rows even when handed a narrower list', () => {
  const { body, restored } = repairPrBody({
    body: 'Freeform body with no markers.', runId: 'r1', fixesLines: ['Fixes #2749'], phases: ['build', 'test'],
  });
  assert.ok(restored.includes('phases block'));
  assert.deepEqual(phaseRows(body), CANONICAL_ROWS);
});

test('#3319: an all-backend run still starts all five phase rows, polish included', () => {
  // composePrEarlyBody takes no surface: input, so an all-backend run composes exactly like
  // any other run — the creation-time polish-row omission #1712 once documented has no way to
  // happen here. `surfaces` is passed (and ignored, mirroring the #2877 `phases` precedent
  // above) to prove the composer never narrows on it. A non-polishing run removes the row
  // later, at polish's would-be exit or the multi-spec pre-merge refresh.
  const body = composePrEarlyBody({
    runId: '2026-10-17T080010-spec-3319', specSummary: 's', target: '#101,#102', nextStep: 'build',
    fixesLines: ['Fixes #101', 'Fixes #102'], surfaces: ['backend', 'backend'],
  });
  assert.deepEqual(phaseRows(body), CANONICAL_ROWS);
});

test('composePrEarlyBody requires runId/target/nextStep', () => {
  assert.throws(() => composePrEarlyBody({ specSummary: 's', target: '#1', nextStep: 'build' }), /runId/);
  assert.throws(() => composePrEarlyBody({ runId: 'r1', specSummary: 's', nextStep: 'build' }), /target/);
  assert.throws(() => composePrEarlyBody({ runId: 'r1', specSummary: 's', target: '#1' }), /nextStep/);
});

test('repairPrBody restores all three marker pairs when none are present, preserving the freeform text (#2997 AC2/AC4 — the #2996 shape)', () => {
  const freeform = '## Summary\n\nThis PR does a thing. It was opened without the template.\n';
  const { body, restored } = repairPrBody({
    body: freeform,
    runId: '2026-10-05T071404-record-2982',
    fixesLines: ['Fixes #2982'],
  });

  assert.deepEqual(restored, ['run marker', 'phases block', 'fixes block']);
  assert.ok(body.includes(freeform.trim()), 'freeform content must survive the repair byte-for-byte');
  assert.equal(hasRunMarker(body), true);
  assert.equal(hasPhasesPair(body), true);
  assert.equal(hasFixesPair(body), true);
  assert.match(body, /Fixes #2982/);
  // The run marker is restored as the new first line, same as a fresh compose.
  assert.match(body, /^<!-- claude-tweaks-run: 2026-10-05T071404-record-2982 -->\nclaude-tweaks-run: 2026-10-05T071404-record-2982\n/);
});

test('repairPrBody is a no-op (restores nothing) on a body that already carries every marker', () => {
  const composed = composePrEarlyBody({ runId: 'r1', specSummary: 's', target: '#1', nextStep: 'build', fixesLines: ['Fixes #1'] });
  const { body, restored } = repairPrBody({ body: composed, runId: 'r1', fixesLines: ['Fixes #1'] });
  assert.deepEqual(restored, []);
  assert.equal(body, composed);
});

test('repairPrBody restores only the pieces actually missing', () => {
  const partial = [
    '<!-- claude-tweaks-run: r1 -->',
    'claude-tweaks-run: r1',
    '',
    'some freeform notes',
    '',
    '<!-- phases-start -->',
    '[claude-tweaks-phases-start]',
    '- [ ] build',
    '[claude-tweaks-phases-end]',
    '<!-- phases-end -->',
    '',
  ].join('\n');
  const { restored, body } = repairPrBody({ body: partial, runId: 'r1', fixesLines: ['Fixes #1'] });
  assert.deepEqual(restored, ['fixes block']);
  assert.equal(hasRunMarker(body), true);
  assert.equal(hasPhasesPair(body), true);
  assert.equal(hasFixesPair(body), true);
  assert.ok(body.includes('some freeform notes'));
});

test('repairPrBody strips an orphaned half-marker instead of appending a duplicate unclosed span (wrap-up #2997 follow-up)', () => {
  // A phases-start with no matching phases-end — e.g. a body truncated mid-write.
  // Human content sits between the orphan and the real fixes block.
  const malformed = [
    '<!-- phases-start -->',
    'some human notes between the orphan and the fixes block',
    '<!-- fixes-start -->',
    '[claude-tweaks-fixes-start]',
    'Fixes #42',
    '[claude-tweaks-fixes-end]',
    '<!-- fixes-end -->',
  ].join('\n');
  const { body, restored } = repairPrBody({ body: malformed, runId: 'r1', fixesLines: ['Fixes #42'] });

  assert.deepEqual(restored, ['run marker', 'phases block']);
  // The orphaned start is gone, not left dangling alongside a freshly appended pair.
  const phasesStartCount = (body.match(/<!-- phases-start -->/g) || []).length;
  const phasesEndCount = (body.match(/<!-- phases-end -->/g) || []).length;
  assert.equal(phasesStartCount, 1, 'exactly one phases-start — the orphan must not survive alongside the new pair');
  assert.equal(phasesEndCount, 1);
  // The freeform content between the orphan and the real fixes block must survive.
  assert.ok(body.includes('some human notes between the orphan and the fixes block'));
  // The original fixes block (never touched — it was already a real pair) must survive untouched.
  assert.match(body, /Fixes #42/);
  assert.equal(hasPhasesPair(body), true);
  assert.equal(hasFixesPair(body), true);
});

test('repairPrBody strips an orphaned fixes-end with no matching fixes-start', () => {
  const malformed = [
    '<!-- claude-tweaks-run: r1 -->',
    'claude-tweaks-run: r1',
    '',
    '<!-- phases-start -->',
    '[claude-tweaks-phases-start]',
    '- [ ] build',
    '[claude-tweaks-phases-end]',
    '<!-- phases-end -->',
    '',
    'stray trailing content',
    '[claude-tweaks-fixes-end]',
  ].join('\n');
  const { body, restored } = repairPrBody({ body: malformed, runId: 'r1', fixesLines: ['Fixes #7'] });

  assert.deepEqual(restored, ['fixes block']);
  const fixesEndCount = (body.match(/\[claude-tweaks-fixes-end\]/g) || []).length;
  assert.equal(fixesEndCount, 1, 'the orphaned end must not survive alongside the new pair\'s own end');
  assert.ok(body.includes('stray trailing content'));
  assert.match(body, /Fixes #7/);
  assert.equal(hasFixesPair(body), true);
});

test('hasRunMarker/hasPhasesPair/hasFixesPair recognize either the HTML-comment or the plain-text form alone (#929 MCP-read case)', () => {
  assert.equal(hasRunMarker('claude-tweaks-run: r1\n'), true);
  assert.equal(hasRunMarker('no marker here'), false);
  assert.equal(hasPhasesPair('[claude-tweaks-phases-start]\n[claude-tweaks-phases-end]'), true);
  assert.equal(hasPhasesPair('<!-- phases-start -->\n<!-- phases-end -->'), true);
  assert.equal(hasPhasesPair('<!-- phases-start -->'), false);
  assert.equal(hasFixesPair('[claude-tweaks-fixes-start]\n[claude-tweaks-fixes-end]'), true);
  assert.equal(hasFixesPair('nothing'), false);
});

// The bluemonday strip a gh-absent MCP read applies: the comment span goes, its newline stays.
const mcpRead = (b) => b.replace(/<!--[\s\S]*?-->/g, '');
const count = (s, token) => s.split(token).length - 1;
const HTML_TOKENS = ['<!-- claude-tweaks-run: r1 -->', '<!-- phases-start -->', '<!-- phases-end -->', '<!-- fixes-start -->', '<!-- fixes-end -->'];
const earlyR1 = () => composePrEarlyBody({ runId: 'r1', specSummary: 's', target: '#1', nextStep: 'test', fixesLines: ['Fixes #1'] });

test('AC1.1 (#5358): repairPrBody restores every HTML-comment marker an MCP read stripped, byte-for-byte', () => {
  const early = earlyR1();
  const express = composeExpressBody({ runId: 'r1', specSummary: 's', fixesLines: ['Fixes #1'] });
  const a = repairPrBody({ body: mcpRead(early), runId: 'r1', fixesLines: ['Fixes #1'] });
  assert.equal(a.body, early);
  assert.deepEqual(a.restored, ['run marker HTML form', 'phases HTML markers', 'fixes HTML markers']);
  const b = repairPrBody({ body: mcpRead(express), runId: 'r1', fixesLines: ['Fixes #1'] });
  // repairPrBody does not know the express lane has no Phases checklist, so it still appends one
  // (pre-existing, #2997); the express body's own markers come back byte-for-byte ahead of it.
  assert.ok(b.body.startsWith(express));
  assert.deepEqual(b.restored, ['phases block', 'run marker HTML form', 'fixes HTML markers']);
});

test('#5358: repeated MCP read-repair-write cycles leave the body unchanged', () => {
  const early = earlyR1();
  let body = early;
  for (let i = 0; i < 3; i++) body = repairPrBody({ body: mcpRead(body), runId: 'r1', fixesLines: ['Fixes #1'] }).body;
  assert.equal(body, early);
});

test('#5358: a body with its HTML marker lines removed entirely gets every HTML form back', () => {
  const input = earlyR1().split('\n').filter((l) => !/^<!--.*-->$/.test(l)).join('\n');
  const out = repairPrBody({ body: input, runId: 'r1', fixesLines: ['Fixes #1'] }).body;
  const lines = out.split('\n');
  assert.equal(lines[0], '<!-- claude-tweaks-run: r1 -->');
  assert.equal(lines[1], 'claude-tweaks-run: r1');
  for (const [pair, start, end] of [['phases', 'phases-start', 'phases-end'], ['fixes', 'fixes-start', 'fixes-end']]) {
    assert.equal(lines[lines.indexOf(`[claude-tweaks-${start}]`) - 1], `<!-- ${start} -->`, pair);
    assert.equal(lines[lines.indexOf(`[claude-tweaks-${end}]`) + 1], `<!-- ${end} -->`, pair);
  }
  for (const token of HTML_TOKENS) assert.equal(count(out, token), 1, token);
  assert.ok(out.endsWith('\n'));
});

test('#5358: a plain marker whose neighbour is text gets the HTML form spliced on a new line', () => {
  const input = [
    'claude-tweaks-run: r1', '### Phases', '[claude-tweaks-phases-start]', '- [ ] build', '[claude-tweaks-phases-end]',
    'after phases', '[claude-tweaks-fixes-start]', 'Fixes #1', '[claude-tweaks-fixes-end]', 'after fixes',
  ].join('\n');
  const out = repairPrBody({ body: input, runId: 'r1', fixesLines: ['Fixes #1'] }).body;
  assert.equal(out, [
    '<!-- claude-tweaks-run: r1 -->', 'claude-tweaks-run: r1', '### Phases', '<!-- phases-start -->', '[claude-tweaks-phases-start]',
    '- [ ] build', '[claude-tweaks-phases-end]', '<!-- phases-end -->', 'after phases', '<!-- fixes-start -->',
    '[claude-tweaks-fixes-start]', 'Fixes #1', '[claude-tweaks-fixes-end]', '<!-- fixes-end -->', 'after fixes',
  ].join('\n'));
});

test('#5358: a non-canonical plain run marker still gets its HTML form, the plain line untouched', () => {
  const input = mcpRead(earlyR1()).replace('claude-tweaks-run: r1', 'claude-tweaks-run:r1');
  const out = repairPrBody({ body: input, runId: 'r1', fixesLines: ['Fixes #1'] });
  const lines = out.body.split('\n');
  assert.equal(lines[0], '<!-- claude-tweaks-run: r1 -->');
  assert.equal(lines[1], 'claude-tweaks-run:r1');
  assert.ok(out.restored.includes('run marker HTML form'));
});

test('#5358: an end token quoted in the Spec summary does not pull the HTML end token before its start', () => {
  const quoted = composePrEarlyBody({
    runId: 'r1', specSummary: 'quote:\n[claude-tweaks-phases-end]\nend quote', target: '#1', nextStep: 'test', fixesLines: ['Fixes #1'],
  });
  const lines = repairPrBody({ body: mcpRead(quoted), runId: 'r1', fixesLines: ['Fixes #1'] }).body.split('\n');
  const htmlStart = lines.indexOf('<!-- phases-start -->');
  const htmlEnd = lines.indexOf('<!-- phases-end -->');
  assert.ok(htmlStart !== -1 && htmlEnd > htmlStart, `end ${htmlEnd} after start ${htmlStart}`);
  const realEnd = lines.indexOf('[claude-tweaks-phases-end]', lines.indexOf('[claude-tweaks-phases-start]'));
  assert.equal(htmlEnd, realEnd + 1);
});

test('#5358: a start and end token quoted in the Spec summary leave the HTML pair on the real Phases block', () => {
  const quoted = composePrEarlyBody({
    runId: 'r1', specSummary: 'quote:\n[claude-tweaks-phases-start]\n[claude-tweaks-phases-end]\nend quote', target: '#1', nextStep: 'test', fixesLines: ['Fixes #1'],
  });
  const lines = repairPrBody({ body: mcpRead(quoted), runId: 'r1', fixesLines: ['Fixes #1'] }).body.split('\n');
  const realStart = lines.lastIndexOf('[claude-tweaks-phases-start]');
  assert.ok(realStart > lines.indexOf('### Phases'), 'the last plain start is the real block');
  assert.equal(lines.indexOf('<!-- phases-start -->'), realStart - 1);
  assert.equal(lines.indexOf('<!-- phases-end -->'), lines.indexOf('[claude-tweaks-phases-end]', realStart) + 1);
  assert.equal(count(lines.join('\n'), '<!-- phases-start -->'), 1);
});

test('#5358: a plain run marker whose id could close an HTML comment gets no HTML form', () => {
  const input = mcpRead(earlyR1()).replace('claude-tweaks-run: r1', 'claude-tweaks-run: r1--><b>x</b>');
  const out = repairPrBody({ body: input, runId: 'r1', fixesLines: ['Fixes #1'] });
  assert.ok(!out.restored.includes('run marker HTML form'));
  assert.ok(!out.body.includes('<!-- claude-tweaks-run:'));
});

test('#5358: the restored HTML run marker keeps the run id its plain companion names', () => {
  const other = composePrEarlyBody({ runId: 'other-run', specSummary: 's', target: '#1', nextStep: 'test', fixesLines: ['Fixes #1'] });
  const out = repairPrBody({ body: mcpRead(other), runId: 'r1', fixesLines: ['Fixes #1'] }).body;
  assert.equal(out.split('\n')[0], '<!-- claude-tweaks-run: other-run -->');
  assert.ok(!out.includes('claude-tweaks-run: r1'));
});

test('#5358: only the missing HTML token of a half-present pair is restored', () => {
  const early = earlyR1();
  const input = early.split('\n').map((l) => (l === '<!-- phases-end -->' ? '' : l)).join('\n');
  const out = repairPrBody({ body: input, runId: 'r1', fixesLines: ['Fixes #1'] });
  assert.deepEqual(out.restored, ['phases HTML markers']);
  assert.equal(out.body, early);
});

test('#5358: a CRLF body gets its HTML markers back with its plain lines untouched', () => {
  const input = mcpRead(earlyR1().replace(/\n/g, '\r\n'));
  const out = repairPrBody({ body: input, runId: 'r1', fixesLines: ['Fixes #1'] }).body;
  for (const token of HTML_TOKENS) assert.equal(count(out, token), 1, token);
  const outLines = out.split('\n');
  for (const l of input.split('\n').filter((x) => x.includes('claude-tweaks-') && !x.includes('<!--'))) {
    assert.ok(outLines.includes(l), `kept: ${JSON.stringify(l)}`);
  }
  for (const l of outLines.slice(0, -1)) assert.ok(l.endsWith('\r'), `CRLF kept: ${JSON.stringify(l)}`);
});

test('#4025: composeExpressBody keeps the dual run markers, the express marker and the fixes span, with no Phases or Resume', () => {
  const body = composeExpressBody({ runId: 'r1', specSummary: 'One paragraph.', fixesLines: ['Fixes #7'] });
  assert.equal(body, [
    '<!-- claude-tweaks-run: r1 -->',
    'claude-tweaks-run: r1',
    'claude-tweaks-express: r1',
    '',
    '### Spec summary',
    '',
    'One paragraph.',
    '',
    '<!-- fixes-start -->',
    '[claude-tweaks-fixes-start]',
    'Fixes #7',
    '[claude-tweaks-fixes-end]',
    '<!-- fixes-end -->',
    '',
  ].join('\n'));
  assert.match(body, /^claude-tweaks-express: r1$/m);
  assert.equal(hasRunMarker(body), true);
  assert.equal(hasFixesPair(body), true);
  assert.equal(hasPhasesPair(body), false);
  assert.doesNotMatch(body, /### Phases|### Resume/);
});

test('#4025: isExpressPr tells an express body from a PR-early body', () => {
  assert.equal(isExpressPr(composeExpressBody({ runId: 'r1', specSummary: 's', fixesLines: ['Fixes #7'] })), true);
  assert.equal(isExpressPr(composePrEarlyBody({
    runId: 'r1', specSummary: 's', target: '#7', nextStep: 'build', fixesLines: ['Fixes #7'],
  })), false);
});

test('#4025: composeExpressBody requires runId', () => {
  assert.throws(() => composeExpressBody({ specSummary: 's', fixesLines: [] }), /runId is required/);
});

// #4596 — parseResumeLine is composeResumeLine's strict parser twin; its input
// is an untrusted PR body that /tidy renders as a paste command.
const RUN = '2026-10-31T005940-record-4596';
const DIR = '/repo/.claude-tweaks/pipelines/' + RUN;
const resume = (over) => composeResumeLine({ runDir: DIR, target: '#4596', nextStep: 'review,polish,wrap-up', ...over });

test('parseResumeLine round-trips composeResumeLine', () => {
  assert.deepEqual(parseResumeLine(resume(), RUN), { runDir: DIR, target: '#4596', steps: 'review,polish,wrap-up' });
  assert.deepEqual(parseResumeLine(resume({ target: '#1,#2' }), RUN), { runDir: DIR, target: '#1,#2', steps: 'review,polish,wrap-up' });
});

test('AC3.1: parseResumeLine rejects a shell tail or a $( ) target', () => {
  assert.equal(parseResumeLine(resume() + '; rm -rf ~', RUN), null);
  assert.equal(parseResumeLine(resume({ target: '#1$(touch /tmp/x)' }), RUN), null);
  assert.equal(parseResumeLine(resume({ nextStep: 'build; rm -rf ~' }), RUN), null);
});

test('parseResumeLine rejects the unrendered placeholder and a foreign run', () => {
  assert.equal(parseResumeLine(composeResumeLine({ target: '#1', nextStep: 'test' }), RUN), null);
  assert.equal(parseResumeLine(resume({ runDir: '/repo/.claude-tweaks/pipelines/2026-10-31T000000-other' }), RUN), null);
  assert.equal(parseResumeLine(resume({ runDir: '/repo\\x/.claude-tweaks/pipelines/' + RUN }), RUN), null);
});

test('parseResumeLine: the run id must be a whole final path segment of the dir', () => {
  assert.equal(parseResumeLine(resume({ runDir: '/repo/pipelines/X' + RUN }), RUN), null);
});

test('parseResumeLine: an empty or non-string run id never matches', () => {
  assert.equal(parseResumeLine(resume({ runDir: '/repo/pipelines/' }), ''), null);
  assert.equal(parseResumeLine(resume(), undefined), null);
  // A non-string id would otherwise coerce into the suffix and match.
  assert.equal(parseResumeLine(resume({ runDir: '/x/undefined' }), undefined), null);
  assert.equal(parseResumeLine(resume({ runDir: '/x/null' }), null), null);
});

test('parseResumeLine: a `..` segment in the dir is rejected on its own; a dotted name is not a segment', () => {
  assert.equal(parseResumeLine(resume({ runDir: '/repo/../x/.claude-tweaks/pipelines/' + RUN }), RUN), null, 'dot-dot segment');
  assert.equal(parseResumeLine(resume({ runDir: '/repo/x/../' + RUN }), RUN), null, 'dot-dot before the run id');
  const dotted = '/repo/a..b/.claude-tweaks/pipelines/' + RUN;
  assert.deepEqual(parseResumeLine(resume({ runDir: dotted }), RUN), { runDir: dotted, target: '#4596', steps: 'review,polish,wrap-up' });
});

test('parseResumeLine: a dir with a space passes (real checkouts have them)', () => {
  const dir = '/Users/a b/.claude-tweaks/pipelines/' + RUN;
  assert.deepEqual(parseResumeLine(resume({ runDir: dir }), RUN), { runDir: dir, target: '#4596', steps: 'review,polish,wrap-up' });
});

test('parseResumeLine: the dir and target classes are allowlists — `!` and control bytes never pass', () => {
  // bash history expansion runs inside double quotes: `!#` re-reads the line.
  assert.equal(parseResumeLine(resume({ runDir: '/x/!# ; touch pwned1 #/' + RUN }), RUN), null, 'history-expansion payload in dir');
  assert.equal(parseResumeLine(resume({ runDir: '/x/a!b/' + RUN }), RUN), null, 'bang in dir');
  assert.equal(parseResumeLine(resume({ runDir: '/x/a\x1bb/' + RUN }), RUN), null, 'ESC in dir');
  assert.equal(parseResumeLine(resume({ target: '#1!x' }), RUN), null, 'bang in target');
  assert.equal(parseResumeLine(resume({ target: '#1\x1bx' }), RUN), null, 'ESC in target');
});

test('parseResumeLine: each excluded character in the dir or target decides rejection alone', () => {
  // Each case has the right shape and a dir ending in the run id, so only the
  // one excluded character rejects it.
  assert.equal(parseResumeLine(resume({ runDir: '/repo/a`b/' + RUN }), RUN), null, 'backtick in dir');
  assert.equal(parseResumeLine(resume({ runDir: '/repo/$HOME/' + RUN }), RUN), null, 'dollar in dir');
  assert.equal(parseResumeLine(resume({ runDir: '/repo/x"y/' + RUN }), RUN), null, 'quote in dir');
  assert.equal(parseResumeLine(resume({ runDir: '/repo/a\nb/' + RUN }), RUN), null, 'newline in dir');
  assert.equal(parseResumeLine(resume({ runDir: '/repo/a\rb/' + RUN }), RUN), null, 'CR in dir');
  assert.equal(parseResumeLine(resume({ target: '#1`id`' }), RUN), null, 'backtick in target');
  assert.equal(parseResumeLine(resume({ target: '#1"x' }), RUN), null, 'quote in target');
  assert.equal(parseResumeLine(resume({ target: '#1$X' }), RUN), null, 'dollar in target');
  assert.equal(parseResumeLine(resume({ target: '#1\\x' }), RUN), null, 'backslash in target');
  assert.equal(parseResumeLine(resume({ target: '#1\n#2' }), RUN), null, 'newline in target');
  assert.equal(parseResumeLine(resume({ target: '#1\r#2' }), RUN), null, 'CR in target');
});

test('parseResumeLine: the whole line must match, anchored at both ends', () => {
  assert.equal(parseResumeLine(resume() + 'x', RUN), null, 'text after the closing backtick');
  assert.equal(parseResumeLine(resume() + '\n', RUN), null, 'trailing newline');
  assert.equal(parseResumeLine('x' + resume(), RUN), null, 'text before the opening backtick');
  assert.equal(parseResumeLine(' ' + resume(), RUN), null, 'leading space');
  assert.equal(parseResumeLine(resume({ nextStep: 'Review' }), RUN), null, 'uppercase step');
  assert.equal(parseResumeLine(resume({ nextStep: 'review polish' }), RUN), null, 'space in steps');
  assert.equal(parseResumeLine(null, RUN), null, 'non-string line');
});

test('resumeLineUnder reads the line under ### Resume in a composed body', () => {
  const body = composePrEarlyBody({ runId: RUN, target: '#4596', nextStep: 'review', runDir: DIR });
  const line = composeResumeLine({ runDir: DIR, target: '#4596', nextStep: 'review' });
  assert.equal(resumeLineUnder(body), line);
  assert.equal(resumeLineUnder(body.replace(/\n/g, '\r\n')), line);
  assert.equal(resumeLineUnder(body.replace('### Resume', '### Other')), null);
  assert.equal(resumeLineUnder('### Spec summary\n\nx\n\n### Resume'), null);
  assert.equal(resumeLineUnder('### Resume\n\n   \n'), null);
});

test('resumeLineUnder reads the LAST ### Resume, so a Spec summary quoting the heading cannot shadow it', () => {
  const body = composePrEarlyBody({
    runId: RUN, target: '#4596', nextStep: 'review', runDir: DIR,
    specSummary: 'Quoted below.\n\n### Resume\n\n`PIPELINE_RUN_DIR="/evil/' + RUN + '" /claude-tweaks:flow "#1" build`',
  });
  assert.equal(resumeLineUnder(body), composeResumeLine({ runDir: DIR, target: '#4596', nextStep: 'review' }));
});

test('resumeVerdict: a composed body yields resume plus its parsed fields', () => {
  const body = composePrEarlyBody({ runId: RUN, specSummary: 's', target: '#4596', nextStep: 'review,polish,wrap-up', runDir: DIR });
  assert.deepEqual(resumeVerdict(body, RUN), { resume: resume(), runDir: DIR, target: '#4596', steps: 'review,polish,wrap-up' });
  assert.deepEqual(resumeVerdict(body.replace(/\n/g, '\r\n'), RUN).resume, resume(), 'CRLF body');
});

test('resumeVerdict: no heading, or nothing under it, is no-resume-line', () => {
  assert.deepEqual(resumeVerdict('claude-tweaks-run: x\n', RUN), { resolve: 'no-resume-line' });
  assert.deepEqual(resumeVerdict('### Resume\n\n  \n', RUN), { resolve: 'no-resume-line' });
});

test('resumeVerdict: a line parseResumeLine rejects is resume-line-shape', () => {
  assert.deepEqual(resumeVerdict(`### Resume\n\n${resume({ runDir: '/x/a!b/' + RUN })}\n`, RUN), { resolve: 'resume-line-shape' });
  assert.deepEqual(resumeVerdict(`### Resume\n\n${resume({ runDir: '/repo/pipelines/2026-10-31T000000-other' })}\n`, RUN), { resolve: 'resume-line-shape' });
});
