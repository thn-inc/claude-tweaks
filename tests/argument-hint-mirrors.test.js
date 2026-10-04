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

// A restatement line opens with `$ARGUMENTS`, a connective, and one code
// span holding the whole grammar. All three connectives are in use; the
// longest is tried first so `is parsed as` is not read as `is`.
const RESTATEMENT = /^`\$ARGUMENTS` (?:is parsed as|is|=) `([^`]+)`/;

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
      const m = line.match(RESTATEMENT);
      if (m) {
        found.push(m[1]);
        continue;
      }
      // A line that talks about parsing `$ARGUMENTS` but is not shaped like
      // a restatement must fail loudly, not drop out of the walk as absent.
      if (line.includes('$ARGUMENTS') && /parsed as/i.test(line)) {
        throw new Error(`restatement line is not "\`$ARGUMENTS\` is parsed as \`<grammar>\`": ${line}`);
      }
    }
    return found;
  },
  'usage-line'(content, skill) {
    const prefix = `usage: /claude-tweaks:${skill} `;
    return content.split('\n').filter((l) => l.startsWith(prefix)).map((l) => l.slice(prefix.length).trimEnd());
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

// What a mutation adds on top of whatever the live corpus already reports,
// so one real drift fails the corpus test alone rather than every probe too.
const introduced = (overrides) => {
  const baseline = new Set(walk());
  return walk(overrides).filter((p) => !baseline.has(p));
};

// Hand the walker mutated copies of the named files; other reads stay live.
const readWith = (mutations) => (p) => {
  const original = readRepoFile(p);
  if (!Object.hasOwn(mutations, p)) return original;
  const mutated = mutations[p](original);
  assert.notStrictEqual(mutated, original, `mutation of ${p} was a no-op -- the probe would prove nothing`);
  return mutated;
};

// The skill the discrimination probes mutate: it carries every enumerated
// surface, and its hint has no `|`, so the card cell holds it unescaped.
const PROBE = 'release';
const PROBE_SKILL_MD = `plugin/skills/${PROBE}/SKILL.md`;
const PROBE_HINT = extractArgumentHint(readRepoFile(PROBE_SKILL_MD));
const CARD = 'plugin/skills/help/reference-card.md';
const GROWN = `${PROBE_HINT} [--zz-probe]`;
const RESTATED = `\`$ARGUMENTS\` is parsed as \`${PROBE_HINT}\``;
const keysOf = (problems) => [...new Set(problems.map((p) => p.split(': ')[0]))].sort();

test('the enumeration table and the extractor registry name the same surfaces', () => {
  assert.deepStrictEqual(
    ROWS.map((r) => r.id).sort(),
    Object.keys(EXTRACTORS).sort(),
    `${ENUMERATION}'s mirror-surface table and this file's EXTRACTORS must list the same ids`,
  );
  assert.strictEqual(new Set(ROWS.map((r) => r.id)).size, ROWS.length, 'a surface id is enumerated twice');
  for (const row of ROWS) {
    assert.ok(PRESENCE.includes(row.presence), `${row.id}: Presence must be one of ${PRESENCE.join(' / ')}, got "${row.presence}"`);
    const found = EXTRACTORS[row.id](readRepoFile(row.file.replace('{skill}', PROBE)), PROBE);
    assert.ok(found.length > 0, `${row.id}: the probe skill (${PROBE}) must carry every surface, or the probes below prove nothing for it`);
  }
  assert.strictEqual(ROWS.find((r) => r.id === CANONICAL).presence, 'required', 'the canonical surface must be required');
});

test('every skill carries the same grammar on every enumerated mirror surface', () => {
  assert.ok(SKILLS.length > 10, 'sanity check: expected a substantial skill set');
  const problems = walk();
  assert.deepStrictEqual(problems, [], `argument-hint mirror drift (${ENUMERATION}, "${SECTION_HEADING}"):\n${problems.join('\n')}`);
});

test('a flag added to argument-hint alone is reported on every other surface', () => {
  const problems = introduced({
    read: readWith({ [PROBE_SKILL_MD]: (md) => md.replace(/^(argument-hint: ")(.*)(")$/m, '$1$2 [--zz-probe]$3') }),
  });
  assert.deepStrictEqual(
    keysOf(problems),
    ROWS.filter((r) => r.id !== CANONICAL).map((r) => `${PROBE}:${r.id}`).sort(),
    `expected one stale mirror per non-canonical surface of ${PROBE}, got:\n${problems.join('\n')}`,
  );
});

test('a flag added to argument-hint and to every mirror is accepted', () => {
  const grow = (text) => text.split(PROBE_HINT).join(GROWN);
  const read = readWith({ [PROBE_SKILL_MD]: grow, [CARD]: grow });
  assert.strictEqual(extractArgumentHint(read(PROBE_SKILL_MD)), GROWN, 'the probe did not reach the canonical surface');
  assert.deepStrictEqual(introduced({ read }), []);
});

// Each case drifts exactly one non-canonical surface and must be reported
// on that surface and no other.
const ONE_SURFACE_DRIFTS = [
  ['reference-card-takes', 'a flag only in the Takes cell', CARD, (card) => card.split(`\`${PROBE_HINT}\``).join(`\`${GROWN}\``)],
  ['input-parse-line', 'a flag only in the restatement line', PROBE_SKILL_MD, (md) => md.replace(RESTATED, `\`$ARGUMENTS\` is parsed as \`${GROWN}\``)],
  ['input-parse-line', 'a stale restatement line written with "="', PROBE_SKILL_MD, (md) => md.replace(RESTATED, '`$ARGUMENTS` = `[--dry-run]`')],
  ['input-parse-line', 'a stale restatement line written with "is"', PROBE_SKILL_MD, (md) => md.replace(RESTATED, '`$ARGUMENTS` is `[--dry-run]`')],
  ['usage-line', 'a stale usage line', PROBE_SKILL_MD, (md) => md.replace(`usage: /claude-tweaks:${PROBE} ${PROBE_HINT}`, `usage: /claude-tweaks:${PROBE} [--dry-run]`)],
];

for (const [surface, label, file, mutate] of ONE_SURFACE_DRIFTS) {
  test(`${label} is reported on ${surface} alone`, () => {
    const problems = introduced({ read: readWith({ [file]: mutate }) });
    assert.deepStrictEqual(keysOf(problems), [`${PROBE}:${surface}`], problems.join('\n'));
  });
}

test('a required surface that is missing for a skill is reported, not skipped', () => {
  const problems = introduced({
    read: readWith({ [CARD]: (card) => card.split('\n').filter((l) => !l.startsWith(`| \`/claude-tweaks:${PROBE}\``)).join('\n') }),
  });
  assert.deepStrictEqual(problems, [`${PROBE}:reference-card-takes: required surface is absent`]);
});

test('a surface added to the enumeration is walked without touching the walker', () => {
  const extra = { id: 'zz-added-surface', file: CARD, presence: 'required' };
  assert.throws(() => walk({ rows: [...ROWS, extra] }), /"zz-added-surface" is enumerated in .* but has no extractor/);
  EXTRACTORS[extra.id] = () => ['not the hint'];
  try {
    const problems = introduced({ rows: [...ROWS, extra] });
    assert.strictEqual(problems.length, SKILLS.length, 'the added surface must be compared for every skill');
    for (const p of problems) assert.match(p, /^[a-z0-9-]+:zz-added-surface: has "not the hint"/);
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
  assert.deepStrictEqual(EXTRACTORS['input-parse-line']('## Input\n\n`$ARGUMENTS` controls scope.\n\n| Argument | Behavior |\n'), []);
  assert.throws(() => parseEnumeration('# no such section\n'), /no "### Argument-hint mirror surfaces" heading/);
  const key = `${PROBE}:reference-card-takes`;
  assert.deepStrictEqual(introduced({ exceptions: { ...EXCEPTIONS, [key]: 'probe' } }), [
    `${key}: listed in EXCEPTIONS but agrees with its argument-hint -- remove the entry`,
  ]);
});

// The enumeration has one home. Scans whitespace-collapsed text so a phrase
// that wraps across lines is still seen. docs/incident-log.md is history and
// docs/superpowers/ holds run artifacts that quote what they replace.
const SWEEP_ROOTS = ['plugin/skills', '.claude/skills', 'docs', 'README.md', 'CLAUDE.md'];
const SWEEP_SKIP = ['docs/incident-log.md', 'docs/superpowers'];
const RETIRED = [
  /two syntactic-mirror surfaces/i,
  /treat these two as always in scope/i,
  /the two places a flag appears/i,
];

function markdownFiles(rel) {
  if (SWEEP_SKIP.includes(rel)) return [];
  const abs = path.join(ROOT, rel);
  if (fs.statSync(abs).isDirectory()) {
    return fs.readdirSync(abs).sort().flatMap((name) => markdownFiles(`${rel}/${name}`));
  }
  return rel.endsWith('.md') ? [rel] : [];
}

test('the mirror-surface table has one home and the counted wording stays retired', () => {
  const files = SWEEP_ROOTS.flatMap(markdownFiles);
  assert.ok(files.includes(ENUMERATION), 'sanity check: the sweep must reach the enumeration file itself');
  assert.deepStrictEqual(files.filter((f) => readRepoFile(f).includes(TABLE_HEADER)), [ENUMERATION]);
  const hits = [];
  for (const f of files) {
    const flat = readRepoFile(f).replace(/\s+/g, ' ');
    for (const re of RETIRED) if (re.test(flat)) hits.push(`${f}: ${re}`);
  }
  assert.deepStrictEqual(hits, [], `retired "exactly two surfaces" wording is back:\n${hits.join('\n')}`);
  // The collapse is what lets a wrapped phrase match -- prove it does.
  assert.match('has two syntactic-mirror\n  surfaces'.replace(/\s+/g, ' '), RETIRED[0]);
});
