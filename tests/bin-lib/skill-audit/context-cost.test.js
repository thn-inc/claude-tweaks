'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  measuredBytes,
  measureSkills,
  measureSubFiles,
  totalBytes,
  extractDescription,
  descriptionHashHazard,
  findDescriptionHashHazards,
  measureDescriptions,
  totalDescriptionChars,
  parseComposeCallLine,
  findComposeCallSites,
  usedConditionKeys,
  measureComposed,
  composedBytesReport,
} = require('../../../plugin/bin/lib/skill-audit/context-cost.js');
const { listSkillDirs, KNOWN_SKILLS } = require('../../../plugin/bin/lib/skill-audit/skill-catalog.js');
const { compose, KEYS, VOCAB } = require('../../../plugin/bin/lib/compose-context/compose.js');
const { RAIL_BYTES, RAIL_LINES, DESCRIPTION_MAX_CHARS, listingBudgetChars } = require('../../../plugin/bin/lib/skill-audit/budgets.js');
const { skillFileRailViolations, composedRailViolations, descriptionRailViolations } = require('../../../plugin/bin/lib/skill-audit/rail.js');

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

test('context-cost.js measures only — no size limit, warning tier or exception map is exported (#3311)', () => {
  // Written as assert.doesNotMatch (not a plain .includes() loop) so this
  // absence guard's own retired-name literals are filtered out of #3311's
  // AC1 repo-wide sweep (`git grep ... | grep -v doesNotMatch`) rather than
  // perpetually tripping it — see the Step 5 resolution note.
  const exported = Object.keys(require('../../../plugin/bin/lib/skill-audit/context-cost.js')).join(' ');
  assert.doesNotMatch(exported, /\b(CEILING_BYTES|WARN_RATIO|DESCRIPTION_CEILING_CHARS|DESCRIPTION_TOTAL_CEILING_CHARS|COMPOSED_STEP_EXCEPTIONS|overCeiling|overCeilingWarnings|overComposedCeiling|headroom|nearCeiling|overDescriptionCeiling)\b/);
});

test('measureSkills finds every shipped skill', () => {
  const skills = measureSkills(REPO);
  // Directory-derived, not a hard-coded `33` -- see skill-catalog.js.
  assert.strictEqual(skills.length, listSkillDirs(REPO).length);
  for (const known of KNOWN_SKILLS) {
    assert.ok(skills.some((s) => s.name === known), `measureSkills is missing known skill: ${known}`);
  }
  assert.ok(skills.every((s) => s.bytes > 0));
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

test('no measured skill file carries a marker error', () => {
  const withErrors = [...measureSkills(REPO), ...measureSubFiles(REPO)].filter((e) => e.markerError);
  assert.deepStrictEqual(withErrors, []);
});

test('reports the payload total and the tightest rail headroom', () => {
  const skills = measureSkills(REPO);
  const total = totalBytes(skills);
  const tightest = skills
    .map((s) => ({ ...s, free: RAIL_BYTES - s.bytes }))
    .sort((a, b) => a.free - b.free)[0];

  // Informational, not asserted: a total that only ever ratchets one direction is
  // the thing this module exists to make visible, but pinning it would fail on
  // every legitimate edit.
  console.log(`    shipped SKILL.md payload: ${kb(total)} KB across ${skills.length} skills`);
  console.log(`    tightest headroom: ${tightest.name} at ${kb(tightest.bytes)} KB `
    + `(${tightest.free} B under the rail)`);

  assert.ok(total > 0);
});

// ── Description budget (#394). Descriptions load into every session of every
// project with the plugin enabled, regardless of whether the skill ever
// fires — a corpus-wide cost the per-SKILL.md rail above doesn't cover.

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

// ── findComposeCallSites (#1990 Task 2). This is the scanner that finds
// every compose call site in the shipped skill prose, which the rail's
// `composedRailViolations` check then judges against `RAIL_BYTES` — the
// same bound a raw file meets, with no per-step exceptions. Single-line
// call form only, by construction of this decomposition's call sites (the
// function's own comment says so).

test('parseComposeCallLine: the production merge call parses to step + two plugin-root sources', () => {
  // Copied verbatim from plugin/skills/wrap-up/auto-merge-short-circuit.md line 156.
  const line = '`issue-list` this one record, `summary` the record\'s own title. Read that procedure as one composed bundle: `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step merge "${CLAUDE_PLUGIN_ROOT}/skills/_shared/pr-first-merge.md" "${CLAUDE_PLUGIN_ROOT}/skills/_shared/pr-checklist-refresh.md"`, then read `$PIPELINE_RUN_DIR/context/merge.md`; if the compose command is unavailable or exits non-zero, read the named source files directly. No checkout is needed — `gh pr';
  assert.deepStrictEqual(parseComposeCallLine(line, '/r'), {
    step: 'merge',
    sources: [
      path.resolve('/r', 'skills/_shared/pr-first-merge.md'),
      path.resolve('/r', 'skills/_shared/pr-checklist-refresh.md'),
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

test('findComposeCallSites: finds all three real merge sites in the shipped corpus', () => {
  const sites = findComposeCallSites(REPO).filter((s) => s.step === 'merge');
  const files = sites.map((s) => s.file).sort();
  assert.deepStrictEqual(files, [
    'wrap-up/auto-merge-short-circuit.md',
    'wrap-up/merge-mode.md',
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

  const violations = composedRailViolations(root);
  assert.strictEqual(violations.length, 1);
  assert.strictEqual(violations[0].error, 'repo-relative source path (install-dead): plugin/skills/_shared/a.md');
});

// ── measureComposed (#1990 Task 3). Composed bytes at a compose call site,
// under every combination of the `when:` keys those sources actually branch
// on — unused keys pinned to `VOCAB[key][0]` (a marker-free key can't change
// the output). `unresolved` is not a combination — it is the standalone-run
// both-branches read: what a run with no `config.yml` actually pays.

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
  assert.deepStrictEqual(parseComposeCallLine(contained, '/r/plugin').sources, [path.resolve('/r/plugin', 'skills/_shared/a.md')]);
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

test('measureComposed: LF and CRLF copies of the same sources measure the same composed bytes (#3871)', () => {
  const sources = {
    'skills/_shared/a.md': `# A\n<!-- when: integration-model=pr-first -->\n${'p'.repeat(100)}\n<!-- /when -->\n`
      + `<!-- when: transport=mcp -->\n${'m'.repeat(50)}\n<!-- /when -->\n`,
    'skills/_shared/b.md': '# B\nbody\n',
  };
  const measure = (slug, eol) => {
    const { root } = tmpCorpus(slug);
    const files = Object.entries(sources).map(([rel, text]) => {
      const abs = path.join(root, rel);
      fs.writeFileSync(abs, text.replace(/\n/g, eol));
      // The fixture really is in the line-ending form its slug names, or the comparison is vacuous.
      assert.strictEqual(fs.readFileSync(abs, 'utf8').includes('\r\n'), eol === '\r\n');
      return abs;
    });
    return measureComposed(root, { step: 'x', file: 'f', line: 1, sources: files });
  };
  const lf = measure('composed-eol-lf', '\n');
  const crlf = measure('composed-eol-crlf', '\r\n');
  assert.strictEqual(lf.error, undefined);
  assert.strictEqual(crlf.error, undefined);
  assert.deepStrictEqual(crlf.combinations.map((c) => c.bytes), lf.combinations.map((c) => c.bytes));
  assert.strictEqual(crlf.max, lf.max);
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

// ── Read-limit rail (#3306). The one size check that guards a real platform
// limit: every shipped skill .md and every composed bundle fits one Read call
// (budgets.js holds the numbers and their calibration). Each test's go-red
// fixture lives in budgets.test.js and runs the same rail.js code.
// Every test name here carries "rail" so #3311 can tell these suites from the
// ones it deletes.

test('rail: every shipped skill .md fits one Read call (bytes and lines)', () => {
  assert.deepStrictEqual(
    skillFileRailViolations(REPO).map((e) => `${e.file} ${e.bytes} B, ${e.lines} lines`),
    [],
    `over the Read rail (${RAIL_BYTES} B / ${RAIL_LINES} lines, budgets.js) — a file this size cannot be read in one call; split it`,
  );
});

test('rail: every compose call site\'s max composed bytes fit one Read call', () => {
  assert.deepStrictEqual(
    composedRailViolations(REPO).map((e) => (e.error ? `${e.file}: ${e.error}` : `${e.file} ${e.bytes} B`)),
    [],
    `a composed bundle is consumed by a single Read — fence or restructure its sources to fit ${RAIL_BYTES} B (budgets.js)`,
  );
});

test('the manifesto and pr-scan compose call sites are present and parse (#3311)', () => {
  const report = composedBytesReport(REPO);
  for (const step of ['manifesto', 'pr-scan']) {
    const rows = report.filter((r) => r.step === step);
    assert.ok(rows.length > 0, `expected a measured ${step} compose call site — it is missing or unparsed`);
    for (const row of rows) {
      assert.equal(row.unparsed, undefined, `${step} row is unparsed: ${row.reason}`);
      assert.equal(row.error, undefined, `${step} row carries an error: ${row.error}`);
    }
  }
});

test('rail: every skill description fits the CLI listing max', () => {
  assert.deepStrictEqual(
    descriptionRailViolations(REPO).map((d) => `${d.name} (${d.chars} chars)`),
    [],
    `the CLI truncates a skill description past ${DESCRIPTION_MAX_CHARS} chars in the skill listing`,
  );
});

test('rail diagnostic: total description chars against the listing budget (reported, never failed)', () => {
  const total = totalDescriptionChars(measureDescriptions(REPO));
  console.log(`    rail diagnostic: description total ${total} chars vs listing budget `
    + `${listingBudgetChars(200000)} chars (200k context) / ${listingBudgetChars(1000000)} chars (1M context) — `
    + 'listing entries also carry whenToUse and the name, so the real listing cost is higher');
});
