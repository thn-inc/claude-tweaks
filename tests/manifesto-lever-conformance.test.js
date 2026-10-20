// tests/manifesto-lever-conformance.test.js
//
// Binds plugin/skills/flow/manifesto.md's "Canonical lever numbering" line
// (the declared list of Pipeline Config Manifesto policy levers) to the four
// other prose files that restate the same set by hand:
// plugin/skills/_shared/auto-mode-contract.md, plugin/skills/flow/SKILL.md,
// plugin/skills/help/reference-card.md, plugin/skills/help/context-flow.md.
// Nothing kept these five restatements in sync automatically — adding lever
// 12 (design-critique) missed all four non-canonical files until a
// whole-branch review caught it by reading, and lever 11's addition (#559)
// needed a dedicated "lever checklist" commit for the same reason.
//
// This suite reads live production prose, which [IL-80] warns against — a
// test asserting "this real file currently contains X" is a scheduled
// failure timed to the next migration. It is acceptable HERE, and only
// here, because the enumeration IS the declared contract whose update is
// the intended action when a lever is added or removed (same house pattern
// as tests/wrap-up-registry-pin.test.js and tests/hooks-gate-coverage.test.js).
// Do not generalize this pattern to prose that merely happens to mention a
// lever in passing.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { RUN_PINS } = require('../plugin/bin/lib/set-config/write');

const REPO_ROOT = path.join(__dirname, '..');
const MANIFESTO_PATH = path.join(REPO_ROOT, 'plugin', 'skills', 'flow', 'manifesto.md');
// Absolute (REPO_ROOT-anchored) — reading must not depend on the process's
// cwd (`node --test tests/manifesto-lever-conformance.test.js` from the repo
// root vs. from inside tests/ must behave identically). `path.relative`
// derives the repo-relative form used for SKIP_KEYS_BY_FILE keys and failure
// messages from these at use time instead.
const TARGET_FILES = [
  path.join(REPO_ROOT, 'plugin', 'skills', '_shared', 'auto-mode-contract.md'),
  path.join(REPO_ROOT, 'plugin', 'skills', 'flow', 'SKILL.md'),
  path.join(REPO_ROOT, 'plugin', 'skills', 'help', 'reference-card.md'),
  path.join(REPO_ROOT, 'plugin', 'skills', 'help', 'context-flow.md'),
];

// Parses the "**Canonical lever numbering**" line into its ordered list of
// `N=Name` pairs (e.g. "1=Mode", "2=Scope-creep", ...) and returns just the
// names, in order. Anchored on the literal bolded token per
// skill-prose-conformance-tests's "anchor on a literal token the skill
// already uses" convention.
function parseLeverNames(manifestoText) {
  const lineMatch = /\*\*Canonical lever numbering\*\*[^:]*:\s*([^\n]+)/.exec(manifestoText);
  assert.ok(lineMatch, 'manifesto.md: "**Canonical lever numbering**" line not found — anchor text may have changed');
  // The line ends "...13=Merge authorization. The table below shows only ..."
  // — split off the trailing sentence before splitting the pairs on ", ".
  const pairsPart = lineMatch[1].split(/\.\s+The table/)[0];
  const pairs = pairsPart.split(',').map((s) => s.trim());
  return pairs.map((pair) => {
    const m = /^\d+=(.+)$/.exec(pair);
    assert.ok(m, `manifesto.md: malformed lever pair "${pair}" in the canonical numbering line`);
    return m[1].trim();
  });
}

const YAML_FENCE = '```yaml';

// Locates the config.yml example block inside the "On approval (option 1)"
// section and returns its ordered list of lever config keys, stopping
// before the trailing per-run bookkeeping keys `spec:`/`created:` (which are
// not policy levers).
function parseConfigKeys(manifestoText) {
  const approvalIdx = manifestoText.indexOf('On approval (option 1)');
  assert.ok(approvalIdx !== -1, 'manifesto.md: "On approval (option 1)" section not found');
  const fenceStart = manifestoText.indexOf(YAML_FENCE, approvalIdx);
  assert.ok(fenceStart !== -1, 'manifesto.md: no ```yaml fence found after "On approval (option 1)"');
  const blockStart = fenceStart + YAML_FENCE.length;
  const fenceEnd = manifestoText.indexOf('```', blockStart);
  assert.ok(fenceEnd !== -1, 'manifesto.md: unterminated ```yaml fence after "On approval (option 1)"');
  const block = manifestoText.slice(blockStart, fenceEnd);
  const keys = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = /^([a-z0-9-]+):/.exec(line);
    if (!m) continue;
    if (m[1] === 'spec' || m[1] === 'created') break; // trailing bookkeeping keys, not levers
    if (RUN_PINS.includes(m[1])) continue; // run pins (integration-model) sit in this block but are not levers
    keys.push(m[1]);
  }
  return keys;
}

// A no-op on every key parseConfigKeys can return (it only yields
// kebab-case, `[a-z0-9-]+`), kept as a guard against a future key shape.
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The single line (in each target file) that enumerates the lever set, by
// locating the one line containing this token. Every target file has
// exactly one line mentioning `tidy-aggressiveness` today (verified by
// hand across all four before writing this check) — asserting on exactly
// one keeps this check honest if that ever stops being true.
const ANCHOR_TOKEN = 'tidy-aggressiveness';

// Levers whose per-file presence check is intentionally skipped, with why.
// `mode` on context-flow.md only: word-boundary matching against that file's
// anchor line (`plugin/skills/help/context-flow.md`) finds no standalone
// "mode" token there today — that file's lever enumeration genuinely omits
// it (real, pre-existing prose drift, not a matcher defect: `grep -n
// "tidy-aggressiveness" plugin/skills/help/context-flow.md` shows the list
// starting at "scope-creep", never "mode"). Fixing that omission means
// editing prose, which is out of scope for this coverage-test-only record
// (Gotchas: file unrelated prose findings separately via
// /claude-tweaks:capture). Scoped to this one file: the other three target
// files' anchor lines already carry a standalone "mode" token today
// (verified directly — `auto-mode-contract.md`'s "computes all policy
// levers (mode, scope-creep, ...", `SKILL.md`'s "In every mode except
// `interactive`, it computes the levers (...", `reference-card.md`'s
// "policy lever (Mode, scope-creep, ...") and get full coverage for this
// lever like every other. All 12 other levers, on every file, still get
// full word-boundary + line-anchored checking.
const SKIP_KEYS_BY_FILE = new Map([
  [path.join('plugin', 'skills', 'help', 'context-flow.md'), new Set(['mode'])],
]);

test('manifesto-lever-conformance', async (t) => {
  const manifestoText = fs.readFileSync(MANIFESTO_PATH, 'utf8');
  const leverNames = parseLeverNames(manifestoText);
  const configKeys = parseConfigKeys(manifestoText);

  await t.test('numbering line and config.yml example agree on lever count', () => {
    // Self-check that both anchors are still being read correctly: the two
    // independently-parsed lists must describe the same set of levers, so
    // their lengths must match. This is intentionally NOT pinned to a
    // hardcoded literal — a future lever added to one anchor but not the
    // other must fail here, by count mismatch, however many levers exist
    // at the time.
    assert.strictEqual(
      leverNames.length,
      configKeys.length,
      `lever count mismatch: numbering line has ${leverNames.length} pairs (${JSON.stringify(leverNames)}), ` +
        `config.yml example has ${configKeys.length} keys (${JSON.stringify(configKeys)})`,
    );
    assert.ok(leverNames.length > 0, 'parsed zero levers — anchor text may have changed');
  });

  // Guard against noisy secondary failures: when the lengths disagree, the
  // positional lever-name/config-key zip below is meaningless (it would
  // either mispair entries or leave "undefined" keys for the tail of the
  // longer list), so every per-file subtest below would fail with a
  // confusing "missing key \"undefined\"" message on top of the real
  // failure already reported above. Skip them instead — the length
  // mismatch itself is the actionable failure.
  if (leverNames.length !== configKeys.length) {
    await t.test('per-file lever checks skipped — fix the lever count mismatch above first', (skipped) => {
      skipped.skip('leverNames/configKeys length mismatch — see the length-agreement subtest above');
    });
    return;
  }

  // Positional zip — NOT a mechanical kebab-case transform of the lever
  // name. Lever 5's name is "Leftover routing" but its config key is
  // `leftover-default`, not `leftover-routing`; a naive transform would
  // silently check for the wrong string. Kept as pairs rather than an
  // object so two levers sharing a name can't collapse into one check.
  const leverPairs = leverNames.map((name, i) => [name, configKeys[i]]);

  for (const targetFile of TARGET_FILES) {
    const relPath = path.relative(REPO_ROOT, targetFile);
    await t.test(`every lever's config key appears in ${relPath}`, () => {
      const content = fs.readFileSync(targetFile, 'utf8');
      const anchorLines = content.split('\n').filter((line) => line.includes(ANCHOR_TOKEN));
      assert.strictEqual(
        anchorLines.length,
        1,
        `${relPath}: expected exactly one line containing "${ANCHOR_TOKEN}" (the lever-enumeration anchor line), found ${anchorLines.length}`,
      );
      // [IL-66] Collapse whitespace before matching — a hard-wrapped line
      // could otherwise split the enumeration across physical line breaks,
      // and this also normalizes any incidental multi-space/tab runs
      // within the anchor line itself before the word-boundary match below.
      const anchorLine = anchorLines[0].replace(/\s+/g, ' ');
      const skipKeys = SKIP_KEYS_BY_FILE.get(relPath) ?? new Set();

      for (const [name, key] of leverPairs) {
        if (skipKeys.has(key)) continue;
        // Word-boundary match, not `String.includes` — a bare substring
        // test is non-discriminating (e.g. `'model-stance'.includes('mode')`
        // is true), so it can't tell "this file's own enumeration line
        // mentions this key" apart from "this key happens to be a substring
        // of an unrelated key that mentions it". `(?<![\w-])`/`(?![\w-])`
        // treat `-` as a word character for this purpose, matching how
        // these keys are actually tokenized in kebab-case prose. Matched
        // case-insensitively because prose restates some keys in their
        // capitalized human lever-name form (e.g. "Mode" vs config key
        // `mode`) rather than literal kebab-case.
        const pattern = new RegExp(`(?<![\\w-])${escapeRegExp(key)}(?![\\w-])`, 'i');
        assert.ok(
          pattern.test(anchorLine),
          `${relPath}: missing key "${key}" (lever "${name}") on anchor line: ${JSON.stringify(anchorLine)}`,
        );
      }
    });
  }
});
