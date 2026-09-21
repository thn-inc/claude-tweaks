'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CEILING_BYTES,
  DESCRIPTION_CEILING_CHARS,
  DESCRIPTION_TOTAL_CEILING_CHARS,
  measuredBytes,
  measureSkills,
  measureSubFiles,
  overCeiling,
  overCeilingWarnings,
  totalBytes,
  headroom,
  nearCeiling,
  WARN_RATIO,
  extractDescription,
  descriptionHashHazard,
  findDescriptionHashHazards,
  measureDescriptions,
  overDescriptionCeiling,
  totalDescriptionChars,
  parseComposeCallLine,
  findComposeCallSites,
  usedConditionKeys,
  measureComposed,
  composedBytesReport,
  overComposedCeiling,
  COMPOSED_STEP_EXCEPTIONS,
} = require('../../../plugin/bin/lib/skill-audit/context-cost.js');
const { listSkillDirs, KNOWN_SKILLS } = require('../../../plugin/bin/lib/skill-audit/skill-catalog.js');
const { compose, KEYS, VOCAB } = require('../../../plugin/bin/lib/compose-context/compose.js');

// The corpus root these measurements take is the plugin payload root — the one
// with `skills/` directly beneath it — which is `plugin/`, not the repo root.
const REPO = path.join(__dirname, '..', '..', '..', 'plugin');
const kb = (b) => (b / 1024).toFixed(1);

// Builds a scratch {tmp}/skills/{name}/SKILL.md fixture so findDescriptionHashHazards
// can be proven against a synthetic corpus without touching the real skills/ tree.
function makeFixtureRepo(skillName, descriptionLine) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'context-cost-hazard-'));
  const skillDir = path.join(root, 'skills', skillName);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${skillName}\n${descriptionLine}\n---\nbody\n`,
  );
  return root;
}

// A fresh scratch corpus root for the #1990 measurement tests.
function tmpRoot(slug) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `context-cost-${slug}-`));
}

// The same, with `skills/_shared/` already created — where nearly every
// compose fixture below puts its source files.
function tmpCorpus(slug) {
  const root = tmpRoot(slug);
  const sharedDir = path.join(root, 'skills', '_shared');
  fs.mkdirSync(sharedDir, { recursive: true });
  return { root, sharedDir };
}

test('measureSkills finds every shipped skill', () => {
  const skills = measureSkills(REPO);
  // Directory-derived, not a hard-coded `33` -- see skill-catalog.js.
  assert.strictEqual(skills.length, listSkillDirs(REPO).length);
  for (const known of KNOWN_SKILLS) {
    assert.ok(skills.some((s) => s.name === known), `measureSkills is missing known skill: ${known}`);
  }
  assert.ok(skills.every((s) => s.bytes > 0));
});

test('overCeiling and headroom agree on the boundary', () => {
  const at = { name: 'x', bytes: CEILING_BYTES };
  const over = { name: 'y', bytes: CEILING_BYTES + 1 };
  assert.deepStrictEqual(overCeiling([at]), []);
  assert.deepStrictEqual(overCeiling([over]), [over]);
  assert.strictEqual(headroom(at), 0);
  assert.strictEqual(headroom(over), -1);
});

test('nearCeiling flags only the half-open [90%, 100%) band', () => {
  const belowBand = { name: 'a', bytes: Math.floor(CEILING_BYTES * 0.9) - 1 };
  const atBandStart = { name: 'b', bytes: Math.ceil(CEILING_BYTES * 0.9) };
  const justUnderCeiling = { name: 'c', bytes: CEILING_BYTES - 1 };
  const atCeiling = { name: 'd', bytes: CEILING_BYTES };
  const overCeilingEntry = { name: 'e', bytes: CEILING_BYTES + 1 };

  assert.deepStrictEqual(nearCeiling([belowBand]), []);
  assert.deepStrictEqual(nearCeiling([atBandStart]), [atBandStart]);
  assert.deepStrictEqual(nearCeiling([justUnderCeiling]), [justUnderCeiling]);
  assert.deepStrictEqual(nearCeiling([atCeiling]), []);
  assert.deepStrictEqual(nearCeiling([overCeilingEntry]), []);
});

// ── measuredBytes: CRLF-normalized, marker-stripped byte counts (#1990, #1880).
// A `core.autocrlf=true` checkout otherwise inflates every count by one byte
// per line; an unrendered `<!-- when: ... -->` marker is never part of what a
// reader actually pays either. A malformed marker is reported on the entry,
// never thrown out of a measurement pass (parent #1987 promise F1).

test('measuredBytes: a CRLF file measures the same marker-stripped byte count as its LF twin (#1880)', () => {
  const root = tmpRoot('crlf');
  const aFile = path.join(root, 'a.md');
  const bFile = path.join(root, 'b.md');
  fs.writeFileSync(aFile, 'line one\r\nline two\r\n');
  fs.writeFileSync(bFile, 'line one\nline two\n');
  assert.strictEqual(measuredBytes(aFile).bytes, measuredBytes(bFile).bytes);
  assert.strictEqual(measuredBytes(bFile).bytes, 18);
});

test('measuredBytes: marker lines are not counted', () => {
  const root = tmpRoot('markers');
  const file = path.join(root, 'x.md');
  fs.writeFileSync(file, 'x\n<!-- when: mode=auto -->\ny\n<!-- /when -->\nz\n');
  assert.strictEqual(measuredBytes(file).bytes, 6);
});

test('measuredBytes: a malformed marker is reported, never thrown (F1)', () => {
  const root = tmpRoot('malformed');
  const file = path.join(root, 'bad.md');
  const content = '<!-- when: mode=auto -->\n';
  fs.writeFileSync(file, content);
  const result = measuredBytes(file);
  assert.strictEqual(result.bytes, Buffer.byteLength(content, 'utf8'));
  assert.ok(result.markerError.startsWith(file), 'markerError should name the file');
  assert.ok(/:1: /.test(result.markerError), `expected markerError to name line 1, got: ${result.markerError}`);
});

// ── The per-file 40 KB ceiling is a warning tier since #1990 — the hard gate is
// composed bytes per compose call site (Task 4). Both can still be over budget;
// that's now reported, never failed.

test('overCeilingWarnings: a synthetic SKILL.md over 40 KB is warned about, not failed', () => {
  const root = tmpRoot('overceiling');
  const skillDir = path.join(root, 'skills', 'huge-skill');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'x'.repeat(CEILING_BYTES + 100));
  const warnings = overCeilingWarnings(measureSkills(root));
  assert.strictEqual(warnings.length, 1);
  assert.ok(warnings[0].includes('huge-skill'), `expected the skill name in: ${warnings[0]}`);
  assert.ok(warnings[0].includes('KB'), `expected a KB suffix in: ${warnings[0]}`);
});

test('per-file ceiling is a warning tier for sub-files (#1990): report, never fail', () => {
  // A stub citing a sub-file pays the whole file — Read has no section
  // granularity. This is the shape that let init/bootstrap-steps.md reach 86 KB
  // behind 18 stubs (IL-70). Sub-files stay warning-tier: the hard gate for
  // them moved to composed bytes per compose call site (Task 4). SKILL.md
  // itself is no longer covered by this test — see "no shipped SKILL.md
  // exceeds CEILING_BYTES" below (#2020): an invocation unit has no compose
  // call site or lazy-read path to gate it instead, so its raw bytes are a
  // hard gate, not a warning.
  const subFileHits = overCeiling(measureSubFiles(REPO));

  // A composition check, mirroring the nearCeiling test's shape: every entry
  // overCeilingWarnings reports must really be over CEILING_BYTES.
  for (const hit of subFileHits) {
    assert.ok(hit.bytes > CEILING_BYTES, `${hit.file} should be over the ceiling`);
  }

  const warnings = overCeilingWarnings(subFileHits);
  if (warnings.length > 0) {
    console.warn(`    WARNING: ${warnings.length} sub-file(s) over the ${kb(CEILING_BYTES)} KB per-file `
      + 'ceiling (warning tier since #1990 — extract a section to a sub-file, or fence with `when:`):');
    for (const w of warnings) console.warn(`      ${w}`);
  }
});

// ── SKILL.md invocation-unit hard ceiling (#2020). Unlike a sub-file (composed
// or lazily read) or a `_shared/*.md` (composed), a SKILL.md loads in full on
// every invocation of its skill with no lazy path around its own bytes — the
// composed-bytes gate (Task 4) only covers files that feed a compose call
// site, so leaving SKILL.md at warning tier left three shipped files sitting
// a single paragraph away from a silent, unenforced regression (`[IL-153]`).
// This replaces the thirteen deleted ad-hoc per-file pins with one central
// gate instead of zero.

test('no shipped SKILL.md exceeds CEILING_BYTES (#2020: invocation units keep a hard ceiling)', () => {
  const over = overCeiling(measureSkills(REPO));
  assert.deepStrictEqual(
    over.map((s) => `${s.name} ${kb(s.bytes)} KB`),
    [],
    `a SKILL.md loads in full on every invocation of its skill and has no compose call site or `
      + `lazy-read path to gate it instead — extract a section to a sub-file, or fence with `
      + `\`when:\` markers. Ceiling is ${kb(CEILING_BYTES)} KB ([IL-153]).`,
  );
});

test('the SKILL.md hard ceiling actually goes red on a doctored 41 KB fixture (#2020 AC)', () => {
  const root = tmpRoot('skill-ceiling-fixture');
  const skillDir = path.join(root, 'skills', 'huge-skill');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'x'.repeat(CEILING_BYTES + 100));
  const over = overCeiling(measureSkills(root));
  assert.strictEqual(over.length, 1, 'expected the doctored fixture to trip the hard gate');
  assert.strictEqual(over[0].name, 'huge-skill');
  assert.ok(over[0].bytes > CEILING_BYTES);
});

test('no measured skill file carries a marker error', () => {
  const withErrors = [...measureSkills(REPO), ...measureSubFiles(REPO)].filter((e) => e.markerError);
  assert.deepStrictEqual(withErrors, []);
});

// ── /specify lazy-loaded sub-file ceiling (#611). A sub-file over this size
// costs multiple extra tool calls to read once (a `cat`/Read call above it
// gets truncated and needs a follow-up slice) — a tighter, single-read-call
// concern distinct from the 40 KB per-session context-budget ceiling above.
// #611 verified empirically during its own build: a 19.4 KB and a 24.4 KB
// file each rendered in one call; a 34.3 KB file truncated. 28 KB sits
// between those two known points, comfortably above the post-#611-split
// decomposition-mode.md (~25.6 KB) with headroom for incidental growth.
// This measures via `measureSubFiles` (CRLF-normalized, marker-stripped
// `measuredBytes`), a fine proxy today since no /specify sub-file is fenced
// with `when:` markers — but the concern here is a raw single Read/cat call,
// which pays the file's *raw* on-disk bytes, markers included. If a
// /specify sub-file is ever fenced, this ceiling would need raw bytes, not
// the marker-stripped count.
const SPECIFY_SUBFILE_CEILING_BYTES = 28 * 1024;

// record-creation.md, shaping-mode.md, and next-mode.md all exceeded this ceiling —
// filed as #1346, out of #611's own scope (which only split decomposition-mode.md).
// #1346 split all three (record-creation.md -> record-creation.md + record-creation-subissues.md
// + record-creation-linking.md; shaping-mode.md -> shaping-mode.md + shaping-mode-stamping.md;
// next-mode.md -> next-mode.md + next-mode-shape.md), landing every resulting sub-file under
// the ceiling — the exception set is empty again. New growth on any /specify sub-file
// crossing the ceiling still fails below.
const SPECIFY_SUBFILE_LEGACY_EXCEPTIONS = new Set([]);

test('no /specify lazy-loaded sub-file exceeds the ~20-28 KB single-read ceiling (legacy exceptions aside)', () => {
  const specifySubFiles = measureSubFiles(REPO).filter((e) => e.skill === 'specify');
  const over = specifySubFiles.filter(
    (e) => e.bytes > SPECIFY_SUBFILE_CEILING_BYTES && !SPECIFY_SUBFILE_LEGACY_EXCEPTIONS.has(e.file),
  );
  assert.deepStrictEqual(
    over.map((s) => `${s.file} ${kb(s.bytes)} KB`),
    [],
    'a /specify sub-file over this ceiling costs multiple extra tool calls to read once (#611) — split it',
  );
});

test('reports the payload total and the tightest headroom', () => {
  const skills = measureSkills(REPO);
  const total = totalBytes(skills);
  const tightest = skills
    .map((s) => ({ ...s, free: headroom(s) }))
    .sort((a, b) => a.free - b.free)[0];

  // Informational, not asserted: a total that only ever ratchets one direction is
  // the thing this module exists to make visible, but pinning it would fail on
  // every legitimate edit.
  console.log(`    shipped SKILL.md payload: ${kb(total)} KB across ${skills.length} skills`);
  console.log(`    tightest headroom: ${tightest.name} at ${kb(tightest.bytes)} KB `
    + `(${tightest.free} B under the ceiling)`);

  assert.ok(total > 0);
  // Defensive only: "no shipped SKILL.md exceeds CEILING_BYTES" above (#2020)
  // already hard-fails before this branch could ever trigger on real corpus
  // data — kept as a second signal in case that gate is ever weakened without
  // this one being updated to match.
  if (tightest.free < 0) {
    console.warn(`    WARNING: ${tightest.name} is ${-tightest.free} B over the per-file ceiling`);
  }
});

// ── Early-warning tier (#336). Non-failing: flags files approaching the
// ceiling before they cross it, so an extraction can be planned ahead of an
// unrelated edit forcing one under time pressure.

test('warns (without failing) on any file in the 90-100% ceiling band', () => {
  const skillHits = nearCeiling(measureSkills(REPO));
  const subFileHits = nearCeiling(measureSubFiles(REPO));

  // Real assertions against the live corpus, not a vacuous placeholder: every
  // hit nearCeiling returns must actually sit in the half-open warning band.
  // This catches a future regression in nearCeiling's boundary logic even
  // though the boundary itself is already unit-tested in Task 1 against
  // synthetic entries — this test is what proves the composition with the
  // real measureSkills/measureSubFiles output also holds.
  const threshold = CEILING_BYTES * WARN_RATIO;
  for (const hit of [...skillHits, ...subFileHits]) {
    assert.ok(hit.bytes < CEILING_BYTES, `${hit.name || hit.file} should be under the ceiling`);
    assert.ok(hit.bytes >= threshold, `${hit.name || hit.file} should be at or above the warning threshold`);
  }

  // Sorted by bytes descending (== headroom ascending): the file closest to
  // the ceiling — the most urgent one to act on — prints first.
  const warnings = [...skillHits, ...subFileHits]
    .sort((a, b) => b.bytes - a.bytes)
    .map((s) => (s.name ? `${s.name} ${kb(s.bytes)} KB` : `${s.file} ${kb(s.bytes)} KB`));

  if (warnings.length > 0) {
    console.warn(`    WARNING: ${warnings.length} file(s) at ${Math.round(WARN_RATIO * 100)}%+ `
      + `of the ${kb(CEILING_BYTES)} KB ceiling:`);
    for (const w of warnings) console.warn(`      ${w}`);
  }
});

// ── Description budget (#394). Descriptions load into every session of every
// project with the plugin enabled, regardless of whether the skill ever
// fires — a corpus-wide cost the per-SKILL.md ceiling above doesn't cover.

test('extractDescription reads a plain-scalar description', () => {
  const content = '---\nname: x\ndescription: Use when doing a thing. Keywords - a, b.\nargument-hint: "[x]"\n---\nbody\n';
  assert.strictEqual(extractDescription(content), 'Use when doing a thing. Keywords - a, b.');
});

test('extractDescription reads a double-quoted description (needed when the value contains a bare #)', () => {
  const content = '---\nname: x\ndescription: "Use when doing a thing with #N. Keywords - a, b."\n---\nbody\n';
  assert.strictEqual(extractDescription(content), 'Use when doing a thing with #N. Keywords - a, b.');
});

test('extractDescription returns null with no frontmatter or no description field', () => {
  assert.strictEqual(extractDescription('no frontmatter here'), null);
  assert.strictEqual(extractDescription('---\nname: x\n---\nbody\n'), null);
});

test('descriptionHashHazard: unquoted, no hash — safe', () => {
  assert.strictEqual(descriptionHashHazard('description: Use when doing a thing.'), false);
});

test('descriptionHashHazard: unquoted, hash preceded by whitespace — hazard (#393)', () => {
  assert.strictEqual(descriptionHashHazard('description: Bare, next, or #N direct.'), true);
});

test('descriptionHashHazard: unquoted, value itself starts with hash — hazard', () => {
  assert.strictEqual(descriptionHashHazard('description: #N direct only.'), true);
});

test('descriptionHashHazard: unquoted, hash glued to a non-space character — not a YAML comment marker', () => {
  assert.strictEqual(descriptionHashHazard('description: see issue#5 for context.'), false);
});

test('descriptionHashHazard: double-quoted scalar is immune even with a bare hash inside', () => {
  assert.strictEqual(descriptionHashHazard('description: "Bare, next, or #N direct."'), false);
});

test('findDescriptionHashHazards: proof — flags a synthetic skill carrying the hazard', () => {
  const root = makeFixtureRepo('hazard-skill', 'description: Bare, next, or #N direct.');
  assert.deepStrictEqual(findDescriptionHashHazards(root), ['hazard-skill']);
});

test('findDescriptionHashHazards: proof — a quoted description with the same text is not flagged', () => {
  const root = makeFixtureRepo('safe-skill', 'description: "Bare, next, or #N direct."');
  assert.deepStrictEqual(findDescriptionHashHazards(root), []);
});

test('findDescriptionHashHazards: the real skill corpus is currently clean (#393)', () => {
  assert.deepStrictEqual(
    findDescriptionHashHazards(REPO),
    [],
    'an unquoted description containing a bare # (preceded by whitespace) gets silently truncated by the YAML frontmatter parser — see #393',
  );
});

test('measureDescriptions finds every shipped skill', () => {
  const descriptions = measureDescriptions(REPO);
  assert.strictEqual(descriptions.length, listSkillDirs(REPO).length);
  for (const known of KNOWN_SKILLS) {
    assert.ok(descriptions.some((d) => d.name === known), `measureDescriptions is missing known skill: ${known}`);
  }
  assert.ok(descriptions.every((d) => d.chars > 0), 'every shipped skill must carry a non-empty description');
});

test('no description exceeds the per-skill ceiling', () => {
  const over = overDescriptionCeiling(measureDescriptions(REPO));
  assert.deepStrictEqual(
    over.map((d) => `${d.name} (${d.chars} chars)`),
    [],
    `description is the skill-selection surface: trim prose, never Keywords — see #394. Ceiling is ${DESCRIPTION_CEILING_CHARS} chars.`,
  );
});

test('the corpus-wide description total stays under budget', () => {
  const descriptions = measureDescriptions(REPO);
  const total = totalDescriptionChars(descriptions);
  console.log(`    shipped description payload: ${total} chars across ${descriptions.length} skills`);
  assert.ok(
    total <= DESCRIPTION_TOTAL_CEILING_CHARS,
    `description corpus is ${total} chars, over the ${DESCRIPTION_TOTAL_CEILING_CHARS}-char budget (#394)`,
  );
});

// ── findComposeCallSites (#1990 Task 2). The hard gate moves from "no single
// file exceeds 40 KB" to "no compose call site's composed bytes exceed the
// ceiling" — this is the scanner that finds every such call site in the
// shipped skill prose. Single-line call form only, by construction of this
// decomposition's call sites (the function's own comment says so).

test('parseComposeCallLine: the production merge call parses to step + two plugin-root sources', () => {
  // Copied verbatim from plugin/skills/wrap-up/auto-merge-short-circuit.md line 156.
  const line = '`issue-list` this one record, `summary` the record\'s own title. Read that procedure as one composed bundle: `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step merge "${CLAUDE_PLUGIN_ROOT}/skills/_shared/pr-first-merge.md" "${CLAUDE_PLUGIN_ROOT}/skills/_shared/pr-checklist-refresh.md"`, then read `$PIPELINE_RUN_DIR/context/merge.md`; if the compose command is unavailable or exits non-zero, read the named source files directly. No checkout is needed — `gh pr';
  assert.deepStrictEqual(parseComposeCallLine(line, '/r'), {
    step: 'merge',
    sources: [
      '/r/skills/_shared/pr-first-merge.md',
      '/r/skills/_shared/pr-checklist-refresh.md',
    ],
  });
});

test('parseComposeCallLine: a documentation line with a placeholder is not a call site', () => {
  const line = 'node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step {step} {files}';
  assert.strictEqual(parseComposeCallLine(line, '/r'), null);
});

test('parseComposeCallLine: a line without compose-context.js is null', () => {
  assert.strictEqual(parseComposeCallLine('nothing to see here', '/r'), null);
});

test('parseComposeCallLine: an unknown flag before --step is unparsed, naming the flag', () => {
  const line = 'node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run x --out y.md --step merge "${CLAUDE_PLUGIN_ROOT}/skills/_shared/a.md"';
  const result = parseComposeCallLine(line, '/r');
  assert.deepStrictEqual(result, { unparsed: true, reason: 'unknown flag --out' });
});

test('parseComposeCallLine: a bare repo-relative source is unparsed as install-dead', () => {
  const line = 'node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --step merge plugin/skills/_shared/a.md';
  const result = parseComposeCallLine(line, '/r');
  assert.deepStrictEqual(result, {
    unparsed: true,
    reason: 'repo-relative source path (install-dead): plugin/skills/_shared/a.md',
  });
});

test('findComposeCallSites: finds both real merge sites in the shipped corpus', () => {
  const sites = findComposeCallSites(REPO).filter((s) => s.step === 'merge');
  const files = sites.map((s) => s.file).sort();
  assert.deepStrictEqual(files, [
    'wrap-up/auto-merge-short-circuit.md',
    'wrap-up/review-console.md',
  ]);
  for (const site of sites) {
    assert.strictEqual(site.sources.length, 2);
    for (const src of site.sources) {
      assert.ok(path.isAbsolute(src), `expected an absolute path, got: ${src}`);
      assert.ok(fs.existsSync(src), `expected source to exist: ${src}`);
    }
  }
});

test('findComposeCallSites: a fixture skill file with a call site is found with its line number', () => {
  const { root, sharedDir } = tmpCorpus('callsite');
  const skillDir = path.join(root, 'skills', 'demo');
  fs.mkdirSync(skillDir, { recursive: true });
  const sharedFile = path.join(sharedDir, 'x.md');
  fs.writeFileSync(sharedFile, 'body\n');
  const callLine = 'node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step demo "${CLAUDE_PLUGIN_ROOT}/skills/_shared/x.md"';
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `line one\n${callLine}\nline three\n`);
  assert.deepStrictEqual(findComposeCallSites(root), [
    {
      step: 'demo',
      file: 'demo/SKILL.md',
      line: 2,
      sources: [sharedFile],
    },
  ]);
});

test('findComposeCallSites: an unparsed line is emitted as { step: null, unparsed: true, reason }, and fails the composed-bytes gate', () => {
  const root = tmpRoot('unparsed');
  const skillDir = path.join(root, 'skills', 'demo');
  fs.mkdirSync(skillDir, { recursive: true });
  const callLine = 'node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --step merge plugin/skills/_shared/a.md';
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `line one\n${callLine}\nline three\n`);

  const sites = findComposeCallSites(root);
  assert.deepStrictEqual(sites, [
    {
      step: null,
      file: 'demo/SKILL.md',
      line: 2,
      unparsed: true,
      reason: 'repo-relative source path (install-dead): plugin/skills/_shared/a.md',
    },
  ]);

  const over = overComposedCeiling(composedBytesReport(root));
  assert.strictEqual(over.length, 1);
  assert.strictEqual(over[0].error, 'repo-relative source path (install-dead): plugin/skills/_shared/a.md');
});

// ── measureComposed (#1990 Task 3). Composed bytes at a compose call site,
// under every combination of the `when:` keys those sources actually branch
// on — unused keys pinned to `VOCAB[key][0]` (a marker-free key can't change
// the output). `unresolved` is not a combination — it is the standalone-run
// both-branches read the per-file warnings already show.

function makeComposeFixture() {
  const { root, sharedDir } = tmpCorpus('composed');
  const aFile = path.join(sharedDir, 'a.md');
  const bFile = path.join(sharedDir, 'b.md');
  fs.writeFileSync(
    aFile,
    `# A\n<!-- when: integration-model=pr-first -->\n${'p'.repeat(100)}\n<!-- /when -->\n`
      + `<!-- when: transport=mcp -->\n${'m'.repeat(50)}\n<!-- /when -->\n`,
  );
  fs.writeFileSync(bFile, '# B\nbody\n');
  return { root, aFile, bFile };
}

test('parseComposeCallLine: a source token that escapes the plugin root is an unparsed row, never a read outside the corpus (#1678 rule)', () => {
  const escaping = 'node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step merge "${CLAUDE_PLUGIN_ROOT}/../../etc/passwd"';
  const parsed = parseComposeCallLine(escaping, '/r/plugin');
  assert.strictEqual(parsed.unparsed, true);
  assert.ok(/escapes the plugin root/.test(parsed.reason), `expected the escape reason, got: ${parsed.reason}`);
  const contained = 'node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step merge "${CLAUDE_PLUGIN_ROOT}/skills/_shared/a.md"';
  assert.deepStrictEqual(parseComposeCallLine(contained, '/r/plugin').sources, ['/r/plugin/skills/_shared/a.md']);
});

test('a root with no skills/ directory beneath it fails every corpus entry point with the plugin-root rule, not a raw scandir error', () => {
  const notAPluginRoot = tmpRoot('wrong-root');
  for (const fn of [findComposeCallSites, measureSkills, measureSubFiles]) {
    assert.throws(() => fn(notAPluginRoot), /not a plugin root: no skills\/ directory/, `${fn.name} should name the rule`);
  }
});

test('usedConditionKeys: only the keys the sources use, in canonical order', () => {
  const { aFile, bFile } = makeComposeFixture();
  const sources = [aFile, bFile].map((p) => ({ path: p, content: fs.readFileSync(p, 'utf8') }));
  assert.deepStrictEqual(usedConditionKeys(sources), ['integration-model', 'transport']);
});

test('measureComposed: one row per combination of the used keys, plus the unresolved row, bytes differ where a branch is taken', () => {
  const { root, aFile, bFile } = makeComposeFixture();
  const callSite = { step: 'x', file: 'f', line: 1, sources: [aFile, bFile] };
  const result = measureComposed(root, callSite);

  assert.deepStrictEqual(result.keys, ['integration-model', 'transport']);
  // 4 resolved combinations (2x2 over integration-model x transport) plus the
  // trailing `unresolved` row (#1990) — the standalone-run reading with no
  // config.yml to resolve either key, which keeps both branches of each and
  // so is strictly >= every resolved combination.
  assert.strictEqual(result.combinations.length, 5);

  const bySignature = new Map(result.combinations.map((c) => [
    `${c.conditions['integration-model']}|${c.conditions.transport}`,
    c,
  ]));
  const largest = bySignature.get('pr-first|mcp');
  const smallest = bySignature.get('local-merge|gh');
  const unresolved = result.combinations[result.combinations.length - 1];
  assert.ok(largest, 'expected a pr-first+mcp row');
  assert.ok(smallest, 'expected a local-merge+gh row');
  assert.ok(largest.bytes > smallest.bytes, `expected pr-first+mcp (${largest.bytes}) > local-merge+gh (${smallest.bytes})`);
  assert.deepStrictEqual(unresolved.conditions, { 'integration-model': 'unresolved', transport: 'unresolved' });
  assert.ok(
    unresolved.bytes >= largest.bytes,
    `expected the unresolved row (${unresolved.bytes}) to be the largest, >= pr-first+mcp (${largest.bytes})`,
  );

  // Recompute every row independently against compose() directly, for that
  // row's full six-key conditions (unused keys pinned to VOCAB[k][0]) — a
  // composition proof, not trust in the module's own math.
  const sources = [aFile, bFile].map((p) => ({ path: p, content: fs.readFileSync(p, 'utf8') }));
  for (const combo of result.combinations) {
    const conditions = {};
    for (const key of KEYS) {
      conditions[key] = Object.prototype.hasOwnProperty.call(combo.conditions, key)
        ? combo.conditions[key]
        : VOCAB[key][0];
    }
    const expected = Buffer.byteLength(compose(sources, conditions), 'utf8');
    assert.strictEqual(combo.bytes, expected);
  }
  assert.strictEqual(result.max, Math.max(...result.combinations.map((c) => c.bytes)));
  assert.strictEqual(result.max, unresolved.bytes, 'the unresolved row should be the max');
});

test('measureComposed: marker-free sources yield exactly one combination with empty conditions', () => {
  const { root, sharedDir } = tmpCorpus('composed-plain');
  const file = path.join(sharedDir, 'plain.md');
  fs.writeFileSync(file, '# Plain\nno markers here\n');
  const callSite = { step: 'x', file: 'f', line: 1, sources: [file] };
  const result = measureComposed(root, callSite);
  assert.deepStrictEqual(result.keys, []);
  assert.strictEqual(result.combinations.length, 1);
  assert.deepStrictEqual(result.combinations[0].conditions, {});
});

test('measureComposed: a malformed source is reported on the row, never thrown (F1)', () => {
  const { root, sharedDir } = tmpCorpus('composed-malformed');
  const badFile = path.join(sharedDir, 'bad.md');
  fs.writeFileSync(badFile, '<!-- when: mode=auto -->\nbody\n');
  const callSite = { step: 'x', file: 'f', line: 1, sources: [badFile] };
  const result = measureComposed(root, callSite);
  assert.deepStrictEqual(result.combinations, []);
  assert.ok(typeof result.error === 'string', 'expected an error string');
  assert.ok(/:1: /.test(result.error), `expected the error to name line 1, got: ${result.error}`);
  // #1997: an error row still carries `sources` — a consumer intersecting
  // error rows against touched files needs them, same as a success row.
  assert.deepStrictEqual(result.sources, [badFile]);
});

test('measureComposed: a missing source is an error row naming the path', () => {
  const root = tmpRoot('composed-missing');
  const missing = path.join(root, 'skills', '_shared', 'missing.md');
  const callSite = { step: 'x', file: 'f', line: 1, sources: [missing] };
  const result = measureComposed(root, callSite);
  assert.deepStrictEqual(result.combinations, []);
  assert.ok(result.error.includes(missing), `expected the missing path in: ${result.error}`);
  assert.deepStrictEqual(result.sources, [missing], '#1997: error row must carry sources');
});

test('measureComposed: a source path that is a directory is an error row (not only ENOENT)', () => {
  const root = tmpRoot('composed-eisdir');
  const dirAsSource = path.join(root, 'skills', '_shared', 'a-directory.md');
  fs.mkdirSync(dirAsSource, { recursive: true });
  const callSite = { step: 'x', file: 'f', line: 1, sources: [dirAsSource] };
  const result = measureComposed(root, callSite);
  assert.deepStrictEqual(result.combinations, []);
  assert.ok(typeof result.error === 'string', 'expected an error string');
  assert.ok(result.error.includes('EISDIR'), `expected EISDIR in: ${result.error}`);
  assert.deepStrictEqual(result.sources, [dirAsSource], '#1997: error row must carry sources');
});

test('measureComposed: a malformed-marker error row also carries sources (#1997)', () => {
  const { root, sharedDir } = tmpCorpus('composed-malformed-sources');
  const okFile = path.join(sharedDir, 'ok.md');
  fs.writeFileSync(okFile, '# fine\n');
  const badFile = path.join(sharedDir, 'bad.md');
  fs.writeFileSync(badFile, '<!-- when: mode=auto -->\nbody\n');
  const callSite = { step: 'x', file: 'f', line: 1, sources: [okFile, badFile] };
  const result = measureComposed(root, callSite);
  assert.ok(typeof result.error === 'string', 'expected an error string');
  assert.deepStrictEqual(result.sources, [okFile, badFile]);
});

// ── composedBytesReport / overComposedCeiling (#1990 Task 4). The hard gate:
// no compose call site's composed bytes exceed its ceiling under any
// condition combination its sources branch on. `COMPOSED_STEP_EXCEPTIONS`
// raises one step's ceiling above `CEILING_BYTES` where today's real corpus
// already exceeds it — never `CEILING_BYTES` itself.

function writeComposeCallSite(root, skillName, step, sourceRelPath) {
  const skillDir = path.join(root, 'skills', skillName);
  fs.mkdirSync(skillDir, { recursive: true });
  const callLine = `node "\${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step ${step} "\${CLAUDE_PLUGIN_ROOT}/${sourceRelPath}"`;
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `${callLine}\n`);
}

function fmtOverComposed(e) {
  if (e.error) return `${e.step} @ ${e.file}:${e.line}: ${e.error}`;
  return `${e.step} @ ${e.file}:${e.line}: ${JSON.stringify(e.conditions)} ${kb(e.bytes)} KB > ${kb(e.ceiling)} KB ceiling`;
}

test('overComposedCeiling: a synthetic call site whose composed bytes exceed 40 KB fails the gate (AC2)', () => {
  const { root, sharedDir } = tmpCorpus('overceiling-big');
  fs.writeFileSync(path.join(sharedDir, 'big.md'), 'x'.repeat(CEILING_BYTES + 100));
  writeComposeCallSite(root, 'demo', 'bigstep', 'skills/_shared/big.md');

  const over = overComposedCeiling(composedBytesReport(root), { exceptions: {} });
  assert.strictEqual(over.length, 1);
  assert.strictEqual(over[0].step, 'bigstep');
  assert.deepStrictEqual(over[0].conditions, {});
  assert.ok(over[0].bytes > CEILING_BYTES, `expected bytes (${over[0].bytes}) > CEILING_BYTES`);
  assert.strictEqual(over[0].ceiling, CEILING_BYTES);
});

test('overComposedCeiling: a per-step exception raises that step\'s ceiling only', () => {
  const { root, sharedDir } = tmpCorpus('overceiling-exception');
  fs.writeFileSync(path.join(sharedDir, 'big.md'), 'x'.repeat(CEILING_BYTES + 100));
  writeComposeCallSite(root, 'demo-a', 'bigstep', 'skills/_shared/big.md');
  writeComposeCallSite(root, 'demo-b', 'otherbig', 'skills/_shared/big.md');

  const rows = composedBytesReport(root);
  const bigStepBytes = rows.find((r) => r.step === 'bigstep').combinations[0].bytes;

  const over = overComposedCeiling(rows, { exceptions: { bigstep: bigStepBytes + 1 } });
  assert.deepStrictEqual(over.map((e) => e.step), ['otherbig']);
});

test('no compose call site\'s composed bytes exceed its ceiling under any condition combination (#1990)', () => {
  const over = overComposedCeiling(composedBytesReport(REPO));
  assert.deepStrictEqual(
    over.map(fmtOverComposed),
    [],
    'a compose call site composes over its ceiling — fence or restructure the sources, never raise CEILING_BYTES',
  );
});

// How much headroom an exception ceiling is allowed above the real corpus's
// measured max before it's judged loose rather than tight — a wide exception
// silently turns the gate off for that step, no different from deleting it.
const COMPOSED_EXCEPTION_SLACK_BYTES = 4 * 1024;

test('COMPOSED_STEP_EXCEPTIONS: every exception is still needed, and stays tight to the measured max', () => {
  const rows = composedBytesReport(REPO);
  for (const [step, ceiling] of Object.entries(COMPOSED_STEP_EXCEPTIONS)) {
    assert.ok(ceiling > CEILING_BYTES, `${step}'s exception ceiling (${ceiling}) must exceed CEILING_BYTES, or it isn't an exception`);
    const stepRows = rows.filter((r) => r.step === step);
    assert.ok(
      stepRows.some((r) => r.max > CEILING_BYTES),
      `${step}'s exception is stale — no real row exceeds CEILING_BYTES anymore, remove the entry`,
    );
    const maxForStep = Math.max(...stepRows.map((r) => r.max));
    assert.ok(
      ceiling - maxForStep <= COMPOSED_EXCEPTION_SLACK_BYTES,
      `${step}'s exception ceiling (${ceiling}) is ${ceiling - maxForStep} B above its measured max (${maxForStep}) — `
        + 'shrink the exception to the measured max plus slack, or the gate is off for this step',
    );
  }
});

test('overComposedCeiling: a step named after an Object.prototype member is not silently treated as exception-free (own-property guard)', () => {
  const rows = [{
    step: 'toString', file: 'f', line: 1, combinations: [{ conditions: {}, bytes: 999999 }], max: 999999,
  }];
  const over = overComposedCeiling(rows, { exceptions: {} });
  assert.strictEqual(over.length, 1);
  assert.strictEqual(over[0].step, 'toString');
  assert.strictEqual(over[0].ceiling, CEILING_BYTES);
});

test('reports composed bytes per call site and combination', () => {
  const rows = composedBytesReport(REPO);
  for (const row of rows) {
    assert.strictEqual(row.error, undefined, `unexpected error on ${row.step} @ ${row.file}: ${row.error}`);
    assert.ok(row.combinations.length >= 1, `expected at least one combination for ${row.step} @ ${row.file}`);
    for (const combo of row.combinations) {
      console.log(`    ${row.step} @ ${row.file}:${row.line} — ${JSON.stringify(combo.conditions)}: ${kb(combo.bytes)} KB`);
    }
    console.log(`    ${row.step} @ ${row.file}:${row.line} — max: ${kb(row.max)} KB`);
  }
});
