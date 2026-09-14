'use strict';
// Pins record #1490's retirement of the standalone `/backlog grant` mode in favor
// of `/backlog refine`'s headless posture (`--source routine|sweep`, or the
// deprecated `grant` alias): grant-mode.md deleted, its grant chain moved
// verbatim into backlog/refine-headless.md, SKILL.md's mode list narrowed to
// refine/overview/attention with a `--source` presence switch, deprecated-
// aliases.md documenting the forces-headless override, the routine-template
// kickoff and fleet.md row 10 updated to match, and the permission matrix
// merged into one `/backlog refine` row. Each assertion is a literal-string or
// structural pin, not a re-derivation — per skill-prose-conformance-tests,
// every discriminating assertion below was spot-checked against base commit
// 558291189 (pre-#1490) via `git show`, where the old file/text either existed
// (proving a revert would turn these tests red) or was absent (proving the new
// text is genuinely new, not always-true).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKILL_DIR = path.join(ROOT, 'plugin', 'skills', 'backlog');
const SHARED_DIR = path.join(ROOT, 'plugin', 'skills', '_shared');

function read(...segments) {
  return fs.readFileSync(path.join(...segments), 'utf8');
}

// --- (1) grant-mode.md absent, refine-headless.md present ---

test('grant-mode.md no longer exists; refine-headless.md does', () => {
  assert.ok(
    !fs.existsSync(path.join(SKILL_DIR, 'grant-mode.md')),
    'plugin/skills/backlog/grant-mode.md must be deleted — base commit 558291189 had it at 494 lines',
  );
  assert.ok(
    fs.existsSync(path.join(SKILL_DIR, 'refine-headless.md')),
    'plugin/skills/backlog/refine-headless.md must exist — absent at base commit 558291189',
  );
});

// --- (2) refine-headless.md carries the ceiling gate, breaker sweep (reset
// question never offered), audit marker, cap tracking, and MCP-fallback text ---

test('refine-headless.md: ceiling gate, breaker sweep, audit marker, cap tracking, MCP-fallback all present', () => {
  const source = read(SKILL_DIR, 'refine-headless.md');

  assert.match(source, /## Step 0: Ceiling gate/, 'expected the Step 0 Ceiling gate heading');
  assert.match(
    source,
    /## Step 0\.5: Merge-lane circuit breaker sweep/,
    'expected the Step 0.5 breaker sweep heading',
  );
  // The reset question (`--reset-breaker`'s interactive "Reset it?" confirm,
  // merge-lane-reset.md's own text) is never offered in this posture — the
  // breaker sweep here only trips automatically; resetting stays human-present-only.
  // #1887 folded the standalone `#N` single-record form into the Resolve lane
  // (a filter, not its own mode) — this list now names Resolve instead, and
  // --reset-breaker remains the one form still standing on its own.
  assert.ok(
    source.includes('and `--reset-breaker`\nall remain human-present-only'),
    'expected --reset-breaker (the reset question) to be stated as human-present-only, never offered headlessly',
  );
  assert.doesNotMatch(source, /Reset it\?/, 'refine-headless.md must never render the interactive reset question itself');

  assert.ok(
    source.includes('<!-- grant-mode-audit: date={YYYY-MM-DDTHH:MM:SSZ} auto-merge={true|false|pending} -->'),
    'expected the literal grant-mode-audit marker template',
  );
  assert.match(source, /## Cap tracking/, 'expected the Cap tracking heading');
  assert.match(source, /\*\*MCP path\*\*/, 'expected at least one MCP-fallback callout');
  // Four distinct MCP-path callouts carried from grant-mode.md: Preflight
  // (SKILL.md), Step 1+2 Phase A, Step 4 Apply, Audit format, Cap tracking.
  const mcpPathCount = (source.match(/\*\*MCP path/g) || []).length;
  assert.ok(mcpPathCount >= 4, `expected several MCP path callouts, found ${mcpPathCount}`);
});

// --- (3) Dependency-repair needs:decision both-postures sentence ---

test('refine-headless.md: Dependency-repair needs:decision applies in this posture exactly as interactively', () => {
  const source = read(SKILL_DIR, 'refine-headless.md');
  assert.ok(
    source.includes(
      'stamps `needs:decision`\nin this posture exactly as it does interactively',
    ),
    'expected the both-postures needs:decision sentence for the Dependency-repair lane',
  );
  assert.ok(
    source.includes('the old grant-only mode,\nnow merged into this row, never had a Dependency-repair lane at all'),
    'expected the explicit statement that this is new only relative to the retired grant-only mode',
  );
  // Discriminator: the old grant-mode.md never had a Dependency-repair lane at
  // all (it had no labeling lanes whatsoever), so this sentence's claim is
  // genuinely new prose, not an always-true restatement.
});

// --- (4) SKILL.md hint has no `grant` mode token but has --source; alias row
// cross-references deprecated-aliases.md ---

test('backlog SKILL.md: argument-hint drops grant as a mode, gains --source; the grant row cites deprecated-aliases.md', () => {
  const source = read(SKILL_DIR, 'SKILL.md');
  const hintLine = source.split('\n').find((l) => l.startsWith('argument-hint:'));
  assert.ok(hintLine, 'expected an argument-hint frontmatter line');

  // Base commit 558291189's hint was:
  // "[refine|overview|grant|attention] ... [--reset-breaker]" — no --source at all.
  assert.doesNotMatch(
    hintLine,
    /\bgrant\b/,
    'argument-hint must not list grant as a mode token any more (was present at base 558291189)',
  );
  assert.ok(
    hintLine.includes('--source <human|routine|sweep>'),
    'argument-hint must carry the new --source presence switch',
  );

  const grantRow = source.split('\n').find((l) => l.trim().startsWith('- `grant`'));
  assert.ok(grantRow, 'expected the `grant` deprecated-alias row in the Input table');
  assert.match(grantRow, /deprecated-aliases\.md/, 'the `grant` alias row must cite deprecated-aliases.md');
});

// --- (5) deprecated-aliases.md exists with the forces-headless override + removal condition ---

test('deprecated-aliases.md documents the forces-headless override and a removal condition', () => {
  const filePath = path.join(SKILL_DIR, 'deprecated-aliases.md');
  assert.ok(
    fs.existsSync(filePath),
    'plugin/skills/backlog/deprecated-aliases.md must exist — absent at base commit 558291189',
  );
  const source = read(filePath);
  assert.match(
    source,
    /forces the headless\s*\nposture regardless of any `--source` value or its absence/,
    'expected the forces-headless override clause',
  );
  assert.match(source, /Removal condition:/, 'expected a stated removal condition');
});

// --- (6) routine-template kickoff `backlog refine --source routine` ---

test('routine-template.yml kickoff fires refine --source routine, not standalone grant', () => {
  const source = read(SKILL_DIR, 'routine-template.yml');
  assert.match(
    source,
    /^kickoff: backlog refine --source routine$/m,
    'expected the kickoff line to fire refine\'s headless posture',
  );
  // Discriminator: base commit 558291189's kickoff was literally `backlog grant`.
  assert.doesNotMatch(source, /^kickoff: backlog grant$/m, 'the old bare `backlog grant` kickoff must be gone');
});

// --- (7) fleet.md row 10's new withheld wording ---

test('routine/fleet.md row 10 states the grant lane is withheld while labeling lanes still run', () => {
  const fleetPath = path.join(ROOT, 'plugin', 'skills', 'routine', 'fleet.md');
  const source = read(fleetPath);
  assert.ok(
    source.includes(
      '| 10 | backlog refine (routine) | Grant lane withheld — labeling lanes still run once provisioned; set autonomy: unattended + grant-origination-enabled: true to enable the grant chain | — | — |',
    ),
    'expected row 10\'s new withheld wording naming the labeling lanes',
  );
  // Discriminator: base commit 558291189's row 10 read
  // "| 10 | backlog grant | Withheld — set autonomy: unattended + grant-origination-enabled: true to enable | — | — |"
  // with no mention of labeling lanes at all.
  assert.doesNotMatch(
    source,
    /\| 10 \| backlog grant \| Withheld — set autonomy: unattended \+ grant-origination-enabled: true to enable \| — \| — \|/,
    'the old row-10 wording (no labeling-lanes clause) must be gone',
  );
});

// --- (8) matrix has exactly one /backlog refine row and no /backlog grant row ---

test('work-record-permission-matrix.md: exactly one merged /backlog refine row, no separate /backlog grant row', () => {
  const source = read(SHARED_DIR, 'work-record-permission-matrix.md');
  const refineRows = source.split('\n').filter((l) => l.startsWith('| **`/backlog refine`**'));
  const grantRows = source.split('\n').filter((l) => l.startsWith('| **`/backlog grant`**'));
  assert.strictEqual(refineRows.length, 1, 'expected exactly one /backlog refine row');
  assert.strictEqual(grantRows.length, 0, 'expected zero standalone /backlog grant rows');
  assert.match(refineRows[0], /Headless posture/, 'the merged row must describe the headless posture inline');
  // Discriminator: base commit 558291189 had two separate rows —
  // "/backlog refine (write mode, human present)" and
  // "/backlog grant (headless machine-grant mode ...)".
});

// --- (9) Retired-vocabulary sweep: widened past record #1490's original
// AC4 ("backlog grant" only, plugin/+docs/+README) by this record's own
// whole-branch review fix-wave — four offender tokens, evals/ walked too ---

test('retired-vocabulary sweep: no lingering grant-mode/standalone-mode phrasing outside ledgered exemptions', () => {
  // Exemption ruling (fix-wave review amendment, binding): each offender
  // token below may survive only in exactly these places:
  //   - plugin/skills/backlog/refine-headless.md — ONLY its two byte-pinned
  //     audit-comment templates ("Skipped by /claude-tweaks:backlog grant: ..."
  //     / "Machine-granted by /claude-tweaks:backlog grant (headless)." —
  //     ~lines 388/451) — asserted below by an exact "backlog grant" count.
  //   - evals/scenarios/backlog-grant-local-files-preflight-stop.yaml — ONLY
  //     its skill_invocation.prompt literal ("/claude-tweaks:backlog grant")
  //     — the deprecated `grant` alias command actually under test, not a
  //     citation of retired vocabulary — asserted below by an exact
  //     "backlog grant" count.
  //   - docs/incident-log.md — historical incident narrative, never rewritten.
  //   - docs/decisions/**, docs/plans/**, docs/superpowers/plans/** —
  //     whole-directory exemption: ADRs are immutable historical record, and
  //     docs/plans/*.md / docs/superpowers/plans/*.md are per-run plan/ledger
  //     artifacts (deleted at wrap-up per CLAUDE.md, not shipped prose) whose
  //     membership at any given time isn't stable enough to enumerate by
  //     filename — rewriting either's historical language would misrepresent
  //     what was actually decided or done.
  // The `grant-mode` token excludes the permanent `grant-mode-audit` marker
  // (#269's durable, byte-pinned GitHub comment marker, `fleet-counters.js`'s
  // `GRANT_AUDIT_RE`) everywhere — that convention is not a citation of the
  // retired standalone mode and is never renamed.
  const EXEMPT_FILES = new Set(['docs/incident-log.md']);
  const EXEMPT_DIR_PREFIXES = ['docs/decisions/', 'docs/plans/', 'docs/superpowers/plans/'];
  const CAPPED_FILES = {
    'plugin/skills/backlog/refine-headless.md': { 'backlog grant': 2 },
    'evals/scenarios/backlog-grant-local-files-preflight-stop.yaml': { 'backlog grant': 1 },
  };
  const OFFENDER_TOKENS = ['backlog grant', 'grant-mode', 'grant mode', 'Four modes over the open'];

  function countToken(text, token) {
    if (token === 'grant-mode') {
      const matches = text.match(/grant-mode(?!-audit)/g);
      return matches ? matches.length : 0;
    }
    return text.split(token).length - 1;
  }

  const PLUGIN_DIR = path.join(ROOT, 'plugin');
  const DOCS_DIR = path.join(ROOT, 'docs');
  const EVALS_DIR = path.join(ROOT, 'evals');
  const README_PATH = path.join(ROOT, 'README.md');

  function walk(dir, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else out.push(full);
    }
  }

  const files = [];
  walk(PLUGIN_DIR, files);
  walk(DOCS_DIR, files);
  walk(EVALS_DIR, files);
  if (fs.existsSync(README_PATH)) files.push(README_PATH);

  const offenders = [];
  for (const absPath of files) {
    let text;
    try {
      text = fs.readFileSync(absPath, 'utf8');
    } catch {
      continue; // skip unreadable (binary, etc.)
    }
    const rel = path.relative(ROOT, absPath).split(path.sep).join('/');
    if (EXEMPT_FILES.has(rel)) continue;
    if (EXEMPT_DIR_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue;

    for (const token of OFFENDER_TOKENS) {
      const count = countToken(text, token);
      if (count === 0) continue;
      const cap = CAPPED_FILES[rel] && CAPPED_FILES[rel][token];
      if (cap !== undefined) {
        if (count !== cap) {
          offenders.push(
            `${rel}: expected exactly ${cap} "${token}" occurrences, found ${count}`,
          );
        }
        continue;
      }
      offenders.push(`${rel}: found ${count} occurrence(s) of "${token}"`);
    }
  }

  assert.deepStrictEqual(
    offenders,
    [],
    `retired-vocabulary phrasing survives outside the ledgered exemptions:\n${offenders.join('\n')}`,
  );
});
