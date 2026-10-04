'use strict';

// Argument-hint mirror-surface walker (#2772).
//
// A skill's argument grammar is restated verbatim in several places. Which
// places is not this file's knowledge: the one enumeration is the
// "Argument-hint mirror surfaces" table in docs/skill-authoring.md, and this
// suite reads that table and walks every row for every skill. EXTRACTORS
// below is only the mechanics of pulling the grammar string out of each
// surface -- the first test pins its keys to the table's rows in both
// directions, so a row added to the table with no extractor fails, and so
// does an extractor whose row was deleted. The count of mirrors was carried
// in a plan author's head twice and was short both times (#679, #2759).
//
// Consolidates tests/reference-card-argument-hint.test.js (#564), whose
// Takes-table parser lives on as the `reference-card-takes` extractor.
// tests/argument-hint-input.test.js stays: it checks that `## Input`
// *documents* every leaf of the hint, which is coverage, not a mirror.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { extractArgumentHint, inputSectionBody } = require('../plugin/bin/lib/skill-audit/argument-hint');
const { listSkillDirs } = require('../plugin/bin/lib/skill-audit/skill-catalog');

const ROOT = path.join(__dirname, '..');
const ENUMERATION = 'docs/skill-authoring.md';
const SECTION_HEADING = '### Argument-hint mirror surfaces';
const TABLE_HEADER = '| Surface | File | Where | Presence |';
const CANONICAL = 'frontmatter';
const PRESENCE = ['required', 'when-present'];
const SKILLS = listSkillDirs(path.join(ROOT, 'plugin'));

const readRepoFile = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Split a markdown table row on unescaped `|` only -- a `\|` inside a cell
// is the markdown escape for a literal pipe (every alternation in a Takes
// cell), never a column delimiter.
function splitRow(line) {
  return line.split(/(?<!\\)\|/).map((c) => c.trim());
}

// The enumeration table, as [{ id, file, presence }]. Shape is asserted, not
// best-effort: a missing heading, a missing table, a row with the wrong cell
// count, or an id/file cell that is not a single code span throws rather
// than yielding a shorter list that would silently narrow the walk.
function parseEnumeration(md) {
  const lines = md.split('\n');
  const heading = lines.indexOf(SECTION_HEADING);
  if (heading === -1) throw new Error(`${ENUMERATION}: no "${SECTION_HEADING}" heading`);
  const header = lines.indexOf(TABLE_HEADER, heading);
  if (header === -1) throw new Error(`${ENUMERATION}: no "${TABLE_HEADER}" table under "${SECTION_HEADING}"`);
  const span = (cell, line) => {
    const m = cell.match(/^`([^`]+)`$/);
    if (!m) throw new Error(`${ENUMERATION}: expected a single code span, got "${cell}" in row: ${line}`);
    return m[1];
  };
  const rows = [];
  for (let i = header + 2; i < lines.length && lines[i].startsWith('|'); i++) {
    const cells = splitRow(lines[i]);
    if (cells.length !== 6) throw new Error(`${ENUMERATION}: malformed mirror-surface row (expected 4 cells): ${lines[i]}`);
    rows.push({ id: span(cells[1], lines[i]), file: span(cells[2], lines[i]), presence: cells[4] });
  }
  if (rows.length === 0) throw new Error(`${ENUMERATION}: the mirror-surface table has no rows`);
  return rows;
}

// Only the three `| Command | What it does | Takes |` tables -- the card's
// Artifact Lifecycle table has different columns. A row that does not split
// into exactly 5 cells throws instead of vanishing from the parse (#564).
function parseTakesRows(card) {
  const rows = [];
  let inTable = false;
  let tables = 0;
  for (const line of card.split('\n')) {
    if (line.startsWith('| Command | What it does | Takes |')) {
      inTable = true;
      tables += 1;
      continue;
    }
    if (!inTable) continue;
    if (line.startsWith('|---')) continue;
    if (!line.startsWith('|')) {
      inTable = false;
      continue;
    }
    const cells = splitRow(line);
    if (cells.length !== 5 || cells[0] !== '' || cells[4] !== '') {
      throw new Error(`Malformed Takes-table row (expected 5 cells, got ${cells.length}): ${line}`);
    }
    rows.push({ command: cells[1], takes: cells[3] });
  }
  if (tables !== 3) throw new Error(`Expected exactly 3 "| Command | What it does | Takes |" tables, found ${tables}`);
  return rows;
}

// One extractor per enumerated surface: (file content, skill name) -> every
// grammar string that surface carries for that skill, unwrapped. An empty
// array means "this surface is absent for this skill"; a surface that is
// there but cannot be read throws -- never the same signal as absent.
const EXTRACTORS = {
  frontmatter(content) {
    const hint = extractArgumentHint(content);
    return hint === null ? [] : [hint];
  },
  'input-parse-line'(content) {
    const body = inputSectionBody(content);
    if (body === null) return [];
    const found = [];
    for (const line of body.split('\n')) {
      // Loose detection, strict extraction: a reworded restatement line
      // must fail loudly rather than drop out of the walk as "absent".
      if (!line.includes('$ARGUMENTS') || !/parsed as/i.test(line)) continue;
      const m = line.match(/`\$ARGUMENTS` is parsed as `([^`]+)`/);
      if (!m) throw new Error(`restatement line is not "\`$ARGUMENTS\` is parsed as \`<grammar>\`": ${line}`);
      found.push(m[1]);
    }
    return found;
  },
  'reference-card-takes'(content, skill) {
    const found = [];
    for (const { command, takes } of parseTakesRows(content)) {
      const m = command.match(/`\/claude-tweaks:([a-z0-9-]+)/);
      if (!m || m[1] !== skill) continue;
      const unescaped = takes.replace(/\\\|/g, '|');
      found.push(unescaped.startsWith('`') && unescaped.endsWith('`') ? unescaped.slice(1, -1) : unescaped);
    }
    return found;
  },
};

// `{skill}:{surface}` -> reason, for a surface that legitimately diverges
// from its skill's argument-hint. Empty by design: every divergence found
// when this suite landed was staleness or an abbreviation, and was fixed.
// An entry whose surface passes is itself reported, so the list cannot rot.
const EXCEPTIONS = {};

// Walk every enumerated surface for every skill. `read` is injectable so the
// discrimination tests below can hand the walker a mutated copy of one file.
function collectProblems({ rows, skills, read, exceptions }) {
  const problems = [];
  const used = new Set();
  for (const skill of skills) {
    const values = {};
    for (const row of rows) {
      const extract = EXTRACTORS[row.id];
      if (!extract) throw new Error(`mirror surface "${row.id}" is enumerated in ${ENUMERATION} but has no extractor`);
      values[row.id] = extract(read(row.file.replace('{skill}', skill)), skill);
    }
    const [canonical] = values[CANONICAL];
    if (canonical === undefined) {
      problems.push(`${skill}:${CANONICAL}: SKILL.md declares no argument-hint`);
      continue;
    }
    for (const row of rows) {
      if (row.id === CANONICAL) continue;
      const key = `${skill}:${row.id}`;
      const bad = [];
      if (values[row.id].length === 0 && row.presence === 'required') bad.push(`${key}: required surface is absent`);
      for (const value of values[row.id]) {
        if (value !== canonical) bad.push(`${key}: has ${JSON.stringify(value)}, argument-hint is ${JSON.stringify(canonical)}`);
      }
      if (bad.length > 0 && Object.hasOwn(exceptions, key)) used.add(key);
      else problems.push(...bad);
    }
  }
  for (const key of Object.keys(exceptions)) {
    if (!used.has(key)) problems.push(`${key}: listed in EXCEPTIONS but agrees with its argument-hint -- remove the entry`);
  }
  return problems;
}

const ROWS = parseEnumeration(readRepoFile(ENUMERATION));
const walk = (overrides = {}) => collectProblems({ rows: ROWS, skills: SKILLS, read: readRepoFile, exceptions: EXCEPTIONS, ...overrides });

// Hand the walker one mutated file; every other read stays live.
const readWith = (rel, mutate) => (p) => {
  const original = readRepoFile(p);
  if (p !== rel) return original;
  const mutated = mutate(original);
  assert.notStrictEqual(mutated, original, `mutation of ${rel} was a no-op -- the probe would prove nothing`);
  return mutated;
};

// The skill the discrimination probes mutate: it carries all three surfaces
// and its hint has no `|`, so the card cell holds the hint unescaped.
const PROBE = 'release';
const PROBE_SKILL_MD = `plugin/skills/${PROBE}/SKILL.md`;
const PROBE_HINT = extractArgumentHint(readRepoFile(PROBE_SKILL_MD));
const CARD = 'plugin/skills/help/reference-card.md';

test('the enumeration table and the extractor registry name the same surfaces', () => {
  assert.deepStrictEqual(
    ROWS.map((r) => r.id).sort(),
    Object.keys(EXTRACTORS).sort(),
    `${ENUMERATION}'s mirror-surface table and this file's EXTRACTORS must list the same ids`,
  );
  assert.strictEqual(new Set(ROWS.map((r) => r.id)).size, ROWS.length, 'a surface id is enumerated twice');
  for (const row of ROWS) {
    assert.ok(PRESENCE.includes(row.presence), `${row.id}: Presence must be one of ${PRESENCE.join(' / ')}, got "${row.presence}"`);
    assert.ok(fs.existsSync(path.join(ROOT, row.file.replace('{skill}', PROBE))), `${row.id}: File "${row.file}" does not resolve`);
  }
  assert.strictEqual(ROWS.find((r) => r.id === CANONICAL).presence, 'required', 'the canonical surface must be required');
});

test('every skill carries the same grammar on every enumerated mirror surface', () => {
  assert.ok(SKILLS.length > 10, 'sanity check: expected a substantial skill set');
  const problems = walk();
  assert.deepStrictEqual(problems, [], `argument-hint mirror drift (${ENUMERATION}, "${SECTION_HEADING}"):\n${problems.join('\n')}`);
});

test('a flag added to argument-hint alone is reported on every other surface', () => {
  const problems = walk({
    read: readWith(PROBE_SKILL_MD, (md) => md.replace(/^(argument-hint: ")(.*)(")$/m, '$1$2 [--zz-probe]$3')),
  });
  assert.deepStrictEqual(
    [...new Set(problems.map((p) => p.split(': ')[0]))].sort(),
    ROWS.filter((r) => r.id !== CANONICAL).map((r) => `${PROBE}:${r.id}`).sort(),
    `expected one stale mirror per non-canonical surface of ${PROBE}, got:\n${problems.join('\n')}`,
  );
});

test('a flag present only in the reference card Takes cell is reported', () => {
  const problems = walk({
    read: readWith(CARD, (card) => card.split(`\`${PROBE_HINT}\``).join(`\`${PROBE_HINT} [--zz-probe]\``)),
  });
  assert.ok(problems.length > 0, 'a Takes-only flag went unreported');
  for (const p of problems) assert.ok(p.startsWith(`${PROBE}:reference-card-takes: `), `unexpected problem: ${p}`);
});

test('a flag present only in the Input parse line is reported', () => {
  const problems = walk({
    read: readWith(PROBE_SKILL_MD, (md) => md.replace(`is parsed as \`${PROBE_HINT}\``, `is parsed as \`${PROBE_HINT} [--zz-probe]\``)),
  });
  assert.strictEqual(problems.length, 1, problems.join('\n'));
  assert.ok(problems[0].startsWith(`${PROBE}:input-parse-line: `), problems[0]);
});

test('a required surface that is missing for a skill is reported, not skipped', () => {
  const problems = walk({
    read: readWith(CARD, (card) => card.split('\n').filter((l) => !l.startsWith(`| \`/claude-tweaks:${PROBE}\``)).join('\n')),
  });
  assert.deepStrictEqual(problems, [`${PROBE}:reference-card-takes: required surface is absent`]);
});

test('a surface added to the enumeration is walked without touching the walker', () => {
  const extra = { id: 'zz-fourth-surface', file: CARD, presence: 'required' };
  assert.throws(() => walk({ rows: [...ROWS, extra] }), /"zz-fourth-surface" is enumerated in .* but has no extractor/);
  EXTRACTORS[extra.id] = () => ['not the hint'];
  try {
    const problems = walk({ rows: [...ROWS, extra] });
    assert.strictEqual(problems.length, SKILLS.length, 'the added surface must be compared for every skill');
    for (const p of problems) assert.match(p, /^[a-z0-9-]+:zz-fourth-surface: has "not the hint"/);
  } finally {
    delete EXTRACTORS[extra.id];
  }
});

test('an unreadable surface and a stale exception are each their own signal', () => {
  assert.throws(
    () => EXTRACTORS['input-parse-line']('## Input\n\n`$ARGUMENTS` is parsed as the flags below:\n'),
    /restatement line is not/,
  );
  assert.throws(
    () => EXTRACTORS['input-parse-line']('## Input\n\n$ARGUMENTS gets parsed as `[--x]`:\n'),
    /restatement line is not/,
  );
  assert.deepStrictEqual(EXTRACTORS['input-parse-line']('## Input\n\n| Argument | Behavior |\n'), []);
  assert.throws(() => parseEnumeration('# no such section\n'), /no "### Argument-hint mirror surfaces" heading/);
  const key = `${PROBE}:reference-card-takes`;
  assert.deepStrictEqual(walk({ exceptions: { ...EXCEPTIONS, [key]: 'probe' } }), [
    `${key}: listed in EXCEPTIONS but agrees with its argument-hint -- remove the entry`,
  ]);
});
