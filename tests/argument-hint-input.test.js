'use strict';

// argument-hint <-> ## Input sync guard.
//
// CLAUDE.md's Frontmatter conventions section requires: "`argument-hint` --
// required whenever a skill's `## Input` section documents any accepted
// argument grammar" and "Keep it in sync when `## Input` changes." Nothing
// enforced the converse direction -- a skill can declare `argument-hint` with
// no `## Input` section at all, and the hint's own grammar can drift out of
// sync with what `## Input` documents. Confirmed drift at the time this test
// was written: build, flow, visual-review, and wrap-up all declared
// `argument-hint` with no `## Input` heading (fixed in the same change --
// each got a compact `## Input` section, kept minimal per the coordinating
// record's own note that #237 was editing the same four core SKILL.md files
// in a parallel wave).
//
// The token check is deliberately coarse: every `|`-separated leaf inside
// each top-level `[...]` bracket group of the hint must appear as a literal
// substring somewhere in the `## Input` section's body. This passes both
// styles the corpus actually uses -- a full per-alternative table (e.g.
// capture's `--route=brainstorm` / `--route=keep` / `--route=absorb:N` rows,
// where each leaf like "keep" survives as a substring of "--route=keep") and
// a compact pointer that quotes the whole hint verbatim (build/flow/
// visual-review/wrap-up, where every leaf is trivially present because the
// entire hint string is embedded character-for-character).
//
// The check runs in both directions. The leaf check above is hint -> Input.
// undocumentedHintFlags (below) is the converse: every `--flag` in an `## Input`
// table row's first cell, or in a bullet's leading code span, must appear in the
// hint, unless that entry carries `(producer-only)` or `(deprecated alias)`
// (EXEMPT_MARKERS) -- in the row's first cell, or opening the bullet's text after
// the code span -- a flag only an agent or another skill passes, or a superseded
// alias, which the user-facing hint may leave out. A marker anywhere else does
// not exempt the entry.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { listSkillDirs } = require('../plugin/bin/lib/skill-audit/skill-catalog');
const { extractArgumentHint, inputSectionBody } = require('../plugin/bin/lib/skill-audit/argument-hint');
const { splitFrontmatterFence } = require('../plugin/bin/lib/health-core/frontmatter-list');

const ROOT = path.join(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, 'plugin', 'skills');
const SKILLS = listSkillDirs(path.join(ROOT, 'plugin'));

const read = (name) => fs.readFileSync(path.join(SKILLS_DIR, name, 'SKILL.md'), 'utf8');

const EXEMPT_MARKERS = ['(producer-only)', '(deprecated alias)'];

// Split `group` on `|` characters that are not nested inside `<...>` or
// `[...]` -- e.g. `tier=<fast|standard|capable>` stays one leaf (the pipes
// are inside `<>`), and `next|#N[,#M...]` splits into `next` and
// `#N[,#M...]` (the second leaf's own inner `[,#M...]` has no top-level
// pipe to begin with, but if it did, it would stay nested too).
function splitTopLevelPipes(group) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of group) {
    if (ch === '<' || ch === '[') depth++;
    else if (ch === '>' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === '|' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

// Extract every `|`-separated leaf inside each top-level `[...]` group.
// "Top-level" matters: dispatch's hint nests brackets (`[next|#N[,#M...]]`),
// and a non-nesting-aware bracket regex mis-parses that into a truncated
// leaf -- this walks the string tracking `[`/`]` depth so only the outermost
// bracket pair opens a new group, and nested `[...]`/`<...>` stay inside the
// leaf they belong to (see splitTopLevelPipes above).
function bracketLeaves(hint) {
  const leaves = [];
  let i = 0;
  while (i < hint.length) {
    if (hint[i] !== '[') {
      i++;
      continue;
    }
    let depth = 1;
    let j = i + 1;
    while (j < hint.length && depth > 0) {
      if (hint[j] === '[') depth++;
      else if (hint[j] === ']') depth--;
      j++;
    }
    const group = hint.slice(i + 1, j - 1);
    leaves.push(...splitTopLevelPipes(group));
    i = j;
  }
  return leaves.map((s) => s.trim()).filter((s) => s.length > 0);
}

// A leaf that is entirely a caller-supplied placeholder (`<url>`, `<file-or-
// dir>...`, `#<n>`, `#{n}`, bare `#N`, `#N[,#M...]`) is legitimately
// explained in prose rather than echoed as literal syntax -- deepen's Input
// section says "File paths or directories", never the literal string
// `<file-or-dir>`. Concrete vocabulary (flags, `key=value` pairs, bare mode
// words like `worktree` or `refine`) is what a well-written Input section
// actually reproduces verbatim, since it is exact syntax the caller types --
// that is the vocabulary this check holds to a literal match. Every `#`-led
// leaf in this corpus is a record-reference placeholder in one of several
// notations (`#<n>`, `#{n}`, `#N`, `#N[,#M...]`, ...) -- never literal flag
// syntax -- so the leading `#` alone is a sufficient placeholder signal.
function isPlaceholderKey(key) {
  if (/^<[^>]*>(\.\.\.)?$/.test(key)) return true;
  if (key.startsWith('#')) return true;
  return false;
}

test('every skill declaring argument-hint has an ## Input section', () => {
  for (const name of SKILLS) {
    const content = read(name);
    const hint = extractArgumentHint(content);
    if (!hint) continue;
    assert.ok(
      /^## Input$/m.test(content),
      `skills/${name}/SKILL.md declares argument-hint but has no '## Input' section`,
    );
  }
});

// A double-quoted argument-hint containing a literal `"` must escape it
// (`\"`) to stay valid YAML -- but docs/skill-authoring.md's own convention
// is to write such a hint single-quoted instead (`'[... "<name>"]'`), never
// double-quoted with a `\"` escape. extractArgumentHint strips the
// surrounding quotes without unescaping, so a double-quoted-with-escape
// hint leaks its literal backslashes into every consumer that extracts the
// value verbatim (plugin/bin/lib/skill-audit/argument-hint.js's own
// extractArgumentHint, and therefore plugin/skills/help/reference-card.md's
// `Takes` cell). Read the raw frontmatter line directly -- before
// extractArgumentHint's quote-stripping -- so this check sees the same
// double-quote-vs-single-quote distinction a human editing the file sees.
test('argument-hint is never double-quoted with a backslash escape', () => {
  for (const name of SKILLS) {
    const content = read(name);
    const split = splitFrontmatterFence(content);
    if (!split) continue;
    const line = split.frontmatter.find((l) => /^argument-hint:\s*/.test(l));
    if (!line) continue;
    const raw = line.replace(/^argument-hint:\s*/, '').trim();
    if (!raw.startsWith('"')) continue; // single-quoted or unquoted: not this check's concern
    assert.ok(
      !raw.slice(1, -1).includes('\\"'),
      `skills/${name}/SKILL.md: argument-hint is double-quoted and contains an escaped \\" -- ` +
        `per docs/skill-authoring.md, a hint containing a literal " must be written single-quoted instead`,
    );
  }
});

test('every bracketed leaf in argument-hint appears in ## Input', () => {
  for (const name of SKILLS) {
    const content = read(name);
    const hint = extractArgumentHint(content);
    if (!hint) continue;
    const body = inputSectionBody(content);
    if (body === null) continue; // reported by the previous test
    // Case-insensitive: a placeholder token's case is a stylistic choice
    // (e.g. browse's argument-hint uses `<url>`, its own ## Input table uses
    // `<URL>` for table-row readability) -- not the kind of staleness this
    // test exists to catch.
    const bodyLower = body.toLowerCase();
    for (const leaf of bracketLeaves(hint)) {
      // A multi-word leaf (e.g. browse's `--session <name> ...`) is a whole
      // sub-grammar clause, not a single token -- `## Input` documents it via
      // concrete usage examples (`--session <name> open <URL>`) rather than
      // reproducing the clause byte-for-byte. Checking the leaf's own first
      // word (the flag/identifier itself, e.g. `--session`) is what CLAUDE.md
      // actually means by "every bracketed token" here; the words after it
      // are the sub-grammar the flag introduces, not a second token to match.
      let key = leaf.split(/\s+/)[0];
      if (isPlaceholderKey(key)) continue;
      // A `--flag=value` or `flag:value` leaf that came from splitting a
      // bare (unwrapped) alternation -- e.g. `--mode=quick|standard|...`
      // loses the `--mode=` prefix on every alternative after the first
      // when top-level-pipe-split, and review's `journey:<name>` uses `:`
      // where its own `## Input` writes `journey:{name}`. Truncating at the
      // first `=`/`:` and checking the bare flag/keyword name is what both
      // wrapped (`--mode=<quick|...>`) and unwrapped documentation styles
      // have in common.
      const cut = Math.min(
        ...['=', ':'].map((c) => (key.includes(c) ? key.indexOf(c) : Infinity)),
      );
      if (Number.isFinite(cut)) key = key.slice(0, cut);
      assert.ok(
        bodyLower.includes(key.toLowerCase()),
        `skills/${name}/SKILL.md: argument-hint leaf '${leaf}' (key '${key}') does not appear in '## Input'`,
      );
    }
  }
});

test('AC2.1: docs/skill-authoring.md argument-hint bullet names every exemption marker', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'skill-authoring.md'), 'utf8');
  const bullet = doc.split('\n').find((l) => l.startsWith('- **`argument-hint`**'));
  assert.ok(bullet, 'argument-hint bullet not found');
  for (const marker of EXEMPT_MARKERS) {
    assert.ok(bullet.includes(`\`${marker}\``), `bullet does not name ${marker}`);
  }
});

// Every `--flag` in an ## Input table row's first cell that the skill's hint
// omits, in first-seen order, deduplicated. A row whose first cell carries an
// EXEMPT_MARKERS entry is skipped. Cells split only on unescaped pipes, so a
// `\|` inside a first cell (capture's `--risk=<low\|medium\|high>`) stays put.
// A flag matches the hint only as a whole token: `--batch-size` in the hint does
// not cover `--batch` in a row.
function undocumentedHintFlags(content) {
  const hint = extractArgumentHint(content);
  const body = inputSectionBody(content);
  if (!hint || body === null) return [];
  const found = [];
  for (const line of body.split('\n')) {
    let flagText;
    if (line.startsWith('|')) {
      const firstCell = line.split(/(?<!\\)\|/)[1] || '';
      if (EXEMPT_MARKERS.some((m) => firstCell.includes(m))) continue;
      flagText = firstCell;
    } else {
      // Bullet form: `- \`--flag\` <rest>` -- flags come from the leading code
      // span only; the mark must open <rest>.
      const bullet = line.match(/^\s*[-*]\s+`([^`]*)`(.*)$/);
      if (!bullet) continue;
      if (EXEMPT_MARKERS.some((m) => bullet[2].trimStart().startsWith(m))) continue;
      flagText = bullet[1];
    }
    for (const flag of flagText.match(/--[a-z][a-z0-9-]*/g) || []) {
      const inHint = new RegExp(flag + '(?![a-z0-9-])').test(hint);
      if (!inHint && !found.includes(flag)) found.push(flag);
    }
  }
  return found;
}

test('AC1.1: every --flag an ## Input table row documents is in argument-hint unless marked', () => {
  for (const name of SKILLS) {
    assert.deepStrictEqual(undocumentedHintFlags(read(name)), [], `skills/${name}/SKILL.md: ## Input documents flags missing from argument-hint — add them to the hint or mark the row ${EXEMPT_MARKERS.join(' / ')}`);
  }
});

test('go-red control: capture with its markers stripped reports exactly its five producer flags', () => {
  const stripped = read('capture').split(' (producer-only)').join('');
  assert.deepStrictEqual(undocumentedHintFlags(stripped), ['--defer-reason', '--risk', '--size', '--origin', '--source']);
});

test('marker outside the first cell does not exempt the row', () => {
  const c = "---\nargument-hint: '[--a]'\n---\n## Input\n\n| Argument | Behavior |\n|---|---|\n| `--b` | (producer-only) |\n";
  assert.deepStrictEqual(undocumentedHintFlags(c), ['--b']);
});

test('an ## Input bullet is read: its leading code span counts unless the mark opens the rest', () => {
  const doc = (bullet) => "---\nargument-hint: '[--a]'\n---\n## Input\n\n" + bullet + "\n";
  assert.deepStrictEqual(undocumentedHintFlags(doc('- `--b` → x')), ['--b']);
  assert.deepStrictEqual(undocumentedHintFlags(doc('- `--b` (producer-only) → x')), []);
});

test('longer flag in hint does not cover a shorter prefix flag', () => {
  const c = "---\nargument-hint: '[--batch-size]'\n---\n## Input\n\n| Argument | Behavior |\n|---|---|\n| `--batch` | x |\n";
  assert.deepStrictEqual(undocumentedHintFlags(c), ['--batch']);
});
