'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseParts, partsDigest, approvalLine, checkApproval, estimate, measure, unitSlug, designSlug, markFiled,
  planFiling, TABLE_HEADER, SIZES,
} = require('../../../plugin/bin/lib/design-session/parts');

const REPO = 'thn-inc/claude-tweaks';
const OTHER = 'thn-inc/other';
const HEADER = `| ${TABLE_HEADER.join(' | ')} |`;
const SEPARATOR = `|${TABLE_HEADER.map(() => '---').join('|')}|`;

function row(n, name, size, repository, waits, issue = '') {
  return `| ${n} | ${name} | ${size} | ${repository} | ${waits} | ${issue} |`;
}

const FRAME = [
  '## Frame', '', 'Status: done', '',
  'Problem: orders are filed by hand',
  'Measure: weekly orders filed — for 4 weeks', '',
];
const APPROACHES = ['## Approaches', '', 'Status: done', '', 'Chosen: A — file from the parts table', ''];

function designWith(rows, { approval = null, header = HEADER } = {}) {
  const lines = [
    '# Design', '', ...FRAME, ...APPROACHES,
    '## Builder check', '', 'Status: done', '',
    '## Parts', '', 'Status: done', '', header, SEPARATOR, ...rows, '',
    'Estimate: 4 parts — 2 size:low, 2 size:medium, 0 size:high.', '',
  ];
  if (approval !== null) lines.push('## Approval', '', 'Status: done', '', ...(approval ? [approval] : []), '');
  lines.push('## Decisions', '', '- none', '');
  return lines.join('\n');
}

const FOUR_ROWS = [
  row(1, 'Parser', 'size:low', REPO, '—'),
  row(2, 'Decomposition branch', 'size:medium', REPO, 'Parser'),
  row(3, 'Skill steps', 'size:medium', REPO, 'Parser'),
  row(4, 'Docs and help', 'size:low', REPO, 'Decomposition branch, Skill steps'),
];
const UNAPPROVED_FOUR = designWith(FOUR_ROWS, { approval: '' });
const APPROVED_FOUR = designWith(FOUR_ROWS, { approval: approvalLine('2026-11-28', partsDigest(UNAPPROVED_FOUR)) });
const APPROVED_LINE = approvalLine('2026-11-28', partsDigest(UNAPPROVED_FOUR));

function TWO_REPO_ROWS(marks = {}) {
  return [
    row(1, 'Parser', 'size:low', REPO, '—', marks.Parser || ''),
    row(2, 'Skill steps', 'size:medium', OTHER, 'Parser', marks['Skill steps'] || ''),
    row(3, 'Docs and help', 'size:low', REPO, 'Parser, Skill steps', marks['Docs and help'] || ''),
  ];
}

test('AC1.1/AC1.2: four parts parse with their names and blockers, in table order', () => {
  const p = parseParts(APPROVED_FOUR);
  assert.equal(p.present, true);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.parts.map((x) => x.name), ['Parser', 'Decomposition branch', 'Skill steps', 'Docs and help']);
  assert.deepEqual(p.parts[3].waitsFor, ['Decomposition branch', 'Skill steps']);
  assert.deepEqual(p.parts[0].waitsFor, []);
  assert.deepEqual(p.parts[1], {
    n: 2, name: 'Decomposition branch', slug: 'decomposition-branch', size: 'size:medium', repository: REPO,
    waitsFor: ['Parser'], issue: null,
  });
  const c = checkApproval(APPROVED_FOUR);
  assert.equal(c.approved, true);
  assert.equal(c.reason, 'approved');
  assert.match(c.digest, /^[0-9a-f]{64}$/);
});

test('AC3.1: no status line → not-approved', () => {
  const c = checkApproval(UNAPPROVED_FOUR);
  assert.equal(c.approved, false);
  assert.equal(c.reason, 'not-approved');
  const noSection = designWith(FOUR_ROWS);
  assert.equal(checkApproval(noSection).reason, 'not-approved');
  const misshapen = APPROVED_FOUR.replace(' — digest sha256:', ' digest sha256:');
  assert.equal(checkApproval(misshapen).reason, 'not-approved');
});

test('AC7.1/AC7.4: the digest covers frame, approach and parts; editing one cell after approval refuses', () => {
  const cell = APPROVED_FOUR.replace(row(2, 'Decomposition branch', 'size:medium', REPO, 'Parser'),
    row(2, 'Decomposition branch', 'size:high', REPO, 'Parser'));
  assert.notEqual(cell, APPROVED_FOUR);
  assert.equal(checkApproval(cell).reason, 'digest-mismatch');
  assert.equal(checkApproval(cell).approved, false);
  const edits = [
    [row(4, 'Docs and help', 'size:low', REPO, 'Decomposition branch, Skill steps'),
      row(4, 'Docs and helps', 'size:low', REPO, 'Decomposition branch, Skill steps')],
    [row(3, 'Skill steps', 'size:medium', REPO, 'Parser'), row(3, 'Skill steps', 'size:medium', OTHER, 'Parser')],
    [row(3, 'Skill steps', 'size:medium', REPO, 'Parser'), row(3, 'Skill steps', 'size:medium', REPO, '—')],
  ];
  for (const [from, to] of edits) {
    const edited = APPROVED_FOUR.replace(from, to);
    assert.notEqual(edited, APPROVED_FOUR);
    assert.equal(checkApproval(edited).reason, 'digest-mismatch', to);
  }
  const frame = APPROVED_FOUR.replace('Problem: orders are filed by hand', 'Problem: orders are filed by mail');
  assert.equal(checkApproval(frame).reason, 'digest-mismatch');
  const approach = APPROVED_FOUR.replace('Chosen: A — file from', 'Chosen: B — file from');
  assert.equal(checkApproval(approach).reason, 'digest-mismatch');
});

test('the digest ignores Status: lines and cell padding', () => {
  const statuses = APPROVED_FOUR.replace(/Status: done/g, 'Status: in-progress');
  assert.equal(checkApproval(statuses).reason, 'approved');
  const padded = APPROVED_FOUR.replace('| 1 | Parser |', '|  1  |   Parser |');
  assert.equal(checkApproval(padded).reason, 'approved');
});

test('AC7.2/AC7.3: filed-issue marks are left out of the digest', () => {
  const r = markFiled(APPROVED_FOUR, { Parser: `${REPO}#7001` });
  assert.deepEqual(r.unknown, []);
  assert.deepEqual(r.conflicts, []);
  const c = checkApproval(r.text);
  assert.equal(c.approved, true);
  assert.equal(c.parts[0].issue, `${REPO}#7001`);
  assert.equal(c.parts[1].issue, null);
});

test('markFiled conflicts', () => {
  const once = markFiled(APPROVED_FOUR, { Parser: `${REPO}#7001` }).text;
  const conflict = markFiled(once, { Parser: `${REPO}#7002` });
  assert.deepEqual(conflict.conflicts, ['Parser']);
  assert.equal(conflict.text, once);
  const same = markFiled(once, { Parser: `${REPO}#7001` });
  assert.deepEqual(same.conflicts, []);
  assert.equal(same.text, once);
  const twoRepo = designWith(TWO_REPO_ROWS());
  const left = markFiled(twoRepo, { 'Skill steps': `left for ${OTHER}` }).text;
  assert.equal(parseParts(left).parts[1].issue, `left for ${OTHER}`);
  const over = markFiled(left, { 'Skill steps': `${OTHER}#5` });
  assert.deepEqual(over.conflicts, []);
  assert.equal(parseParts(over.text).parts[1].issue, `${OTHER}#5`);
  const wrongRepo = markFiled(twoRepo, { Parser: `left for ${OTHER}` });
  assert.deepEqual(wrongRepo.conflicts, ['Parser']);
  assert.equal(wrongRepo.text, twoRepo);
  const unknown = markFiled(APPROVED_FOUR, { Nope: `${REPO}#1` });
  assert.deepEqual(unknown.unknown, ['Nope']);
  assert.equal(unknown.text, APPROVED_FOUR);
  assert.throws(() => markFiled(APPROVED_FOUR, { Parser: '#7001' }), /mark/);
});

test('markFiled leaves a row whose cell count is not the table\'s as a conflict', () => {
  const full = row(1, 'Parser', 'size:low', REPO, '—');
  for (const bad of [`| 1 | Parser | size:low | ${REPO} |`, `| 1 | Parser | size:low | ${REPO} | —`]) {
    const text = designWith(FOUR_ROWS).replace(full, bad);
    assert.notEqual(text, designWith(FOUR_ROWS));
    const r = markFiled(text, { Parser: `${REPO}#7001` });
    assert.deepEqual([r.marked, r.unknown, r.conflicts], [[], [], ['Parser']], bad);
    assert.equal(r.text, text);
  }
});

test('markFiled keeps CRLF line endings', () => {
  const crlf = APPROVED_FOUR.replace(/\n/g, '\r\n');
  const r = markFiled(crlf, { Parser: `${REPO}#7001` });
  assert.equal(r.text, markFiled(APPROVED_FOUR, { Parser: `${REPO}#7001` }).text.replace(/\n/g, '\r\n'));
});

test('planFiling compares the repository case-insensitively and keeps each cell\'s own spelling', () => {
  const parts = parseParts(designWith(TWO_REPO_ROWS())).parts;
  const plan = planFiling(parts, REPO.toUpperCase());
  assert.deepEqual(plan.file.map((p) => p.name), ['Parser', 'Docs and help']);
  assert.equal(plan.file[0].repository, REPO);
  assert.deepEqual(plan.leftFor, [{ name: 'Skill steps', repository: OTHER }]);
  const left = parseParts(designWith(TWO_REPO_ROWS({ Parser: `left for ${REPO}` }))).parts;
  assert.deepEqual(planFiling(left, REPO.toUpperCase()).file.map((p) => p.name), ['Parser', 'Docs and help']);
});

test('every repository comparison ignores case: a differently-cased mark parses, marks and counts as filed', () => {
  const MIXED = 'Thn-Inc/Claude-Tweaks';
  const rows = (issue1, issue3 = '') => [
    row(1, 'Parser', 'size:low', MIXED, '—', issue1),
    row(2, 'Skill steps', 'size:medium', OTHER, 'Parser'),
    row(3, 'Docs and help', 'size:low', MIXED, 'Parser', issue3),
  ];
  // the mark names the lower-cased origin spelling of the row's own repository
  const filed = parseParts(designWith(rows(`${REPO}#7001`)));
  assert.deepEqual(filed.errors, []);
  const left = parseParts(designWith(rows('', `left for ${REPO}`)));
  assert.deepEqual(left.errors, []);
  const other = parseParts(designWith(rows(`${OTHER}#7001`)));
  assert.equal(other.errors.length, 1);

  // markFiled writes the mark with the caller's spelling, with no conflict, over empty and left-for cells
  const text = designWith(rows('', `left for ${REPO}`));
  const r = markFiled(text, { Parser: `${REPO}#7001`, 'Docs and help': `${REPO}#7002` });
  assert.deepEqual([r.marked, r.unknown, r.conflicts], [['Parser', 'Docs and help'], [], []]);
  assert.deepEqual(parseParts(r.text).errors, []);
  assert.deepEqual(parseParts(r.text).parts.map((p) => p.issue), [`${REPO}#7001`, null, `${REPO}#7002`]);
  // the same mark in the other case is already there, not a conflict
  const again = markFiled(r.text, { Parser: `${MIXED}#7001` });
  assert.deepEqual([again.marked, again.conflicts], [[], []]);
  assert.equal(again.text, r.text);

  // a differently-cased filed mark counts as filed, and a differently-cased left-for as fileable
  const plan = planFiling(parseParts(r.text).parts, OTHER.toUpperCase());
  assert.deepEqual(plan.skipped, ['Parser', 'Docs and help']);
  assert.deepEqual(plan.file.map((p) => p.name), ['Skill steps']);
  assert.deepEqual(plan.file[0].blockers, [{ kind: 'issue', ref: `${REPO}#7001` }]);
  const leftPlan = planFiling(left.parts, REPO.toUpperCase());
  assert.deepEqual(leftPlan.file.map((p) => p.name), ['Parser', 'Docs and help']);
});

test('markFiled reports the names it changed', () => {
  const text = designWith(TWO_REPO_ROWS());
  const first = markFiled(text, { Parser: `${REPO}#7001` });
  assert.deepEqual(first.marked, ['Parser']);
  assert.deepEqual(markFiled(first.text, { Parser: `${REPO}#7001` }).marked, []);
  assert.deepEqual(markFiled(text, { Nope: `${REPO}#7001` }).marked, []);
});

test('planFiling', () => {
  const first = planFiling(parseParts(designWith(TWO_REPO_ROWS())).parts, REPO);
  assert.deepEqual(first.file.map((p) => p.name), ['Parser', 'Docs and help']);
  assert.deepEqual(first.file[0].blockers, []);
  assert.deepEqual(first.file[1].blockers, [
    { kind: 'sibling', ref: 'Parser' },
    { kind: 'symbolic', ref: `Skill steps (left for ${OTHER})` },
  ]);
  assert.deepEqual(first.leftFor, [{ name: 'Skill steps', repository: OTHER }]);
  assert.deepEqual(first.skipped, []);
  assert.deepEqual(first.writeBack, []);

  const marked = designWith(TWO_REPO_ROWS({
    Parser: `${REPO}#7001`, 'Docs and help': `${REPO}#7004`, 'Skill steps': `left for ${OTHER}`,
  }));
  const second = planFiling(parseParts(marked).parts, OTHER);
  assert.deepEqual(second.file.map((p) => p.name), ['Skill steps']);
  assert.deepEqual(second.file[0].blockers, [{ kind: 'issue', ref: `${REPO}#7001` }]);
  assert.deepEqual(second.skipped, ['Parser', 'Docs and help']);
  assert.deepEqual(second.leftFor, []);
  assert.deepEqual(second.writeBack, [{ issue: `${REPO}#7004`, waitsOn: 'Skill steps', line: `Blocked by: Skill steps (left for ${OTHER})` }]);
});

test('the write-back line is the symbolic line the earlier run wrote, in the table\'s spelling', () => {
  const CELL = 'Thn-Inc/Other';
  const rows = (marks = {}) => TWO_REPO_ROWS(marks).map((r) => r.replace(`| ${OTHER} |`, `| ${CELL} |`));
  const first = planFiling(parseParts(designWith(rows())).parts, REPO);
  const symbolic = first.file[1].blockers.find((b) => b.kind === 'symbolic');
  assert.equal(symbolic.ref, `Skill steps (left for ${CELL})`);
  const marked = designWith(rows({ Parser: `${REPO}#7001`, 'Docs and help': `${REPO}#7004`, 'Skill steps': `left for ${CELL}` }));
  // the later run's origin spells the repository in lower case; the line keeps the cell's spelling
  const second = planFiling(parseParts(marked).parts, OTHER);
  assert.deepEqual(second.writeBack.map((w) => w.line), [`Blocked by: ${symbolic.ref}`]);
  assert.notEqual(second.writeBack[0].line, `Blocked by: Skill steps (left for ${OTHER})`);
});

test('planFiling keeps external blockers as written', () => {
  const text = designWith([
    row(1, 'Parser', 'size:low', REPO, `${OTHER}#12, #40`),
  ]);
  const p = parseParts(text);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(planFiling(p.parts, REPO).file[0].blockers, [
    { kind: 'issue', ref: `${OTHER}#12` }, { kind: 'issue', ref: '#40' },
  ]);
});

test('AC5.1: the measure is read word for word', () => {
  assert.equal(measure(APPROVED_FOUR), 'weekly orders filed — for 4 weeks');
  assert.equal(checkApproval(APPROVED_FOUR).measure, 'weekly orders filed — for 4 weeks');
  assert.equal(measure('# Design\n\n## Frame\n\nStatus: done\n'), null);
});

test('no parts section → no-parts', () => {
  const text = ['# Design', '', ...FRAME, ...APPROACHES].join('\n');
  assert.equal(parseParts(text).present, false);
  assert.equal(partsDigest(text), null);
  const c = checkApproval(text);
  assert.equal(c.reason, 'no-parts');
  assert.equal(c.approved, false);
});

test('a missing Frame or Approaches section is invalid-parts', () => {
  const noFrame = designWith(FOUR_ROWS).replace('## Frame', '## Framing');
  assert.equal(partsDigest(noFrame), null);
  const c = checkApproval(noFrame);
  assert.equal(c.reason, 'invalid-parts');
  assert.ok(c.errors.some((e) => e.includes('Frame')), c.errors.join('; '));
  const noApproaches = designWith(FOUR_ROWS).replace('## Approaches', '## Alternatives');
  assert.equal(partsDigest(noApproaches), null);
  const a = checkApproval(noApproaches);
  assert.equal(a.reason, 'invalid-parts');
  assert.ok(a.errors.some((e) => e.includes('Approaches')), a.errors.join('; '));
});

test('invalid-parts', () => {
  const cases = [
    [designWith(FOUR_ROWS, { header: '| # | Part | Repository | Size | Waits for | Issue |' }), /header/],
    [designWith([row(1, 'Parser', 'small', REPO, '—')]), /row 1/],
    [designWith([row(1, 'Parser', 'size:low', REPO, '—'), row(2, '', 'size:low', REPO, '—')]), /row 2/],
    [designWith([row(1, 'Parser', 'size:low', 'claude-tweaks', '—')]), /row 1/],
    [designWith([row(2, 'Parser', 'size:low', REPO, '—')]), /row 1/],
  ];
  for (const [text, re] of cases) {
    const p = parseParts(text);
    assert.equal(p.errors.length, 1, p.errors.join('; '));
    assert.match(p.errors[0], re);
    assert.equal(checkApproval(text).reason, 'invalid-parts');
  }
});

test('the allowed size labels', () => {
  assert.deepEqual(SIZES, ['size:low', 'size:medium', 'size:high']);
});

test('waits-for errors', () => {
  const cases = [
    [row(1, 'Parser', 'size:low', REPO, 'Nothing'), row(2, 'Skill steps', 'size:low', REPO, '—')],
    [row(1, 'Parser', 'size:low', REPO, 'Parser'), row(2, 'Skill steps', 'size:low', REPO, '—')],
    [row(1, 'Parser', 'size:low', REPO, 'Skill steps'), row(2, 'Skill steps', 'size:low', REPO, '—')],
  ];
  for (const rows of cases) {
    const p = parseParts(designWith(rows));
    assert.equal(p.errors.length, 1, p.errors.join('; '));
    assert.match(p.errors[0], /row 1/);
  }
  const external = parseParts(designWith([row(1, 'Parser', 'size:low', REPO, `${OTHER}#3, #9`)]));
  assert.deepEqual(external.errors, []);
  assert.deepEqual(external.parts[0].waitsFor, [`${OTHER}#3`, '#9']);
});

test('slug collision', () => {
  const p = parseParts(designWith([
    row(1, 'Docs & help', 'size:low', REPO, '—'),
    row(2, 'Docs help', 'size:low', REPO, '—'),
  ]));
  assert.equal(p.errors.length, 1, p.errors.join('; '));
  assert.match(p.errors[0], /row 2/);
  const parent = parseParts(designWith([row(1, 'Parent', 'size:low', REPO, '—')]));
  assert.equal(parent.errors.length, 1);
  assert.equal(unitSlug('Docs and help'), 'docs-and-help');
  assert.equal(unitSlug('  --Docs & Help!-- '), 'docs-help');
  assert.equal(designSlug('2026-11-27-factory-v7-slice1'), 'factory-v7-slice1');
  assert.equal(designSlug('factory-v7'), 'factory-v7');
});

test('estimate', () => {
  const e = estimate(parseParts(APPROVED_FOUR).parts);
  assert.equal(e.count, 4);
  assert.deepEqual(e.bySize, { 'size:low': 2, 'size:medium': 2, 'size:high': 0 });
  assert.equal(e.tokens, null);
  assert.equal(e.basis, 'v6 records no per-size token use in its timing or model-profile data.');
  assert.equal(e.line, 'Estimate: 4 parts — 2 size:low, 2 size:medium, 0 size:high. Tokens: not estimated — v6 records no per-size token use in its timing or model-profile data.');
});

test('approvalLine', () => {
  assert.equal(approvalLine('2026-11-28', 'a'.repeat(64)), 'Approved: 2026-11-28 — digest sha256:' + 'a'.repeat(64));
});

test('fences', () => {
  const fencedParts = ['```', '## Parts', '', HEADER, SEPARATOR, row(1, 'Fake', 'size:low', REPO, '—'), '```', ''];
  const text = ['# Design', '', ...FRAME.slice(0, -1), ...fencedParts, ...APPROACHES].join('\n');
  assert.equal(parseParts(text).present, false);
  assert.equal(checkApproval(text).reason, 'no-parts');
});

test('a fenced example table inside the Parts section is ignored', () => {
  const fake = ['```', '| Fake | Header |', '|---|---|', row(1, 'Fake', 'size:low', REPO, '—'), '```', ''];
  const plain = designWith(FOUR_ROWS);
  const before = plain.replace(`\n${HEADER}\n`, `\n${fake.join('\n')}\n${HEADER}\n`);
  const after = plain.replace('\nEstimate: ', `\n${fake.join('\n')}\nEstimate: `);
  for (const text of [before, after]) {
    assert.notEqual(text, plain);
    const p = parseParts(text);
    assert.deepEqual(p.errors, []);
    assert.deepEqual(p.parts.map((x) => x.name), ['Parser', 'Decomposition branch', 'Skill steps', 'Docs and help']);
    assert.equal(partsDigest(text), partsDigest(plain));
  }
});

test('a malformed Issue cell is a row error, never a part missing from the filing plan', () => {
  for (const issue of ['#7001', 'TBD', `left for ${OTHER}`]) {
    const text = designWith([
      row(1, 'A', 'size:low', REPO, '—', issue),
      row(2, 'B', 'size:low', REPO, 'A'),
    ]);
    const p = parseParts(text);
    assert.equal(p.errors.length, 1, `${issue}: ${p.errors.join('; ')}`);
    assert.match(p.errors[0], /^row 1: .*Issue/);
    assert.equal(checkApproval(text).reason, 'invalid-parts');
  }
  const own = parseParts(designWith([row(1, 'A', 'size:low', REPO, '—', `left for ${REPO}`)]));
  assert.deepEqual(own.errors, []);
  assert.deepEqual(planFiling(own.parts, REPO).file.map((x) => x.name), ['A']);
  const dash = parseParts(designWith([row(1, 'A', 'size:low', REPO, '—', '—')]));
  assert.deepEqual(dash.errors, []);
  assert.equal(dash.parts[0].issue, null);
});

test('planFiling throws on parts a parse would have rejected', () => {
  const a = { n: 1, name: 'A', slug: 'a', size: 'size:low', repository: REPO, waitsFor: [], issue: 'TBD' };
  const b = { n: 2, name: 'B', slug: 'b', size: 'size:low', repository: REPO, waitsFor: ['A'], issue: null };
  assert.throws(() => planFiling([a, b], REPO), /part 'A' .*neither fileable nor filed/);
  const c = { ...b, waitsFor: ['Ghost'] };
  assert.throws(() => planFiling([c], REPO), /unknown part 'Ghost'/);
  assert.throws(() => planFiling([a], REPO), /part 'A' .*neither fileable nor filed/);
  const foreign = { ...a, issue: `${OTHER}#5` };
  assert.throws(() => planFiling([foreign], REPO), /part 'A' .*neither fileable nor filed/);
});

test('a filed mark must name the row own repository', () => {
  const text = designWith([row(1, 'A', 'size:low', REPO, '—', `${OTHER}#5`)]);
  const p = parseParts(text);
  assert.equal(p.errors.length, 1, p.errors.join('; '));
  assert.match(p.errors[0], /^row 1: .*Issue/);
  assert.equal(checkApproval(text).reason, 'invalid-parts');
  const clean = designWith([row(1, 'A', 'size:low', REPO, '—')]);
  const r = markFiled(clean, { A: `${OTHER}#5` });
  assert.deepEqual(r.conflicts, ['A']);
  assert.equal(r.text, clean);
  // the repository check comes before the already-marked check: a cell already holding the
  // same foreign mark is a conflict, never a silent no-op
  const same = markFiled(text, { A: `${OTHER}#5` });
  assert.deepEqual([same.marked, same.conflicts], [[], ['A']]);
  assert.equal(same.text, text);
  const sameLeft = designWith([row(1, 'A', 'size:low', REPO, '—', `left for ${OTHER}`)]);
  assert.deepEqual(markFiled(sameLeft, { A: `left for ${OTHER}` }).conflicts, ['A']);
});

test('fenced Approved: and Measure: lines are not read', () => {
  const fencedApproval = designWith(FOUR_ROWS, { approval: ['```', APPROVED_LINE, '```'].join('\n') });
  assert.equal(checkApproval(fencedApproval).reason, 'not-approved');
  const fencedMeasure = APPROVED_FOUR.replace('Measure: weekly orders filed — for 4 weeks',
    ['```', 'Measure: fenced example', '```', 'Measure: weekly orders filed — for 4 weeks'].join('\n'));
  assert.equal(measure(fencedMeasure), 'weekly orders filed — for 4 weeks');
  const onlyFenced = APPROVED_FOUR.replace('Measure: weekly orders filed — for 4 weeks',
    ['```', 'Measure: fenced example', '```'].join('\n'));
  assert.equal(measure(onlyFenced), null);
});

test('more than one Approved: line is not-approved', () => {
  const twice = designWith(FOUR_ROWS, { approval: [APPROVED_LINE, APPROVED_LINE].join('\n') });
  assert.equal(checkApproval(twice).reason, 'not-approved');
  const stale = designWith(FOUR_ROWS, { approval: [approvalLine('2026-11-27', 'b'.repeat(64)), APPROVED_LINE].join('\n') });
  assert.equal(checkApproval(stale).reason, 'not-approved');
});
