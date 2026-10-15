'use strict';
// tests/agent-browser-retirement-conformance.test.js — #3119: PR #2717 replaced
// the stale `agent-browser` detection claims in /init, /routine and the docs,
// but shipped skill instructions outside its listed files still directed an
// agent to `agent-browser` commands that no longer exist (a daemon, a `doctor`
// subcommand, a `batch` invocation, a path-taking `trace stop`) — none of
// which `playwright-cli`, the only supported browser backend
// (`_shared/browser-detection.md`), actually has.
//
// This suite pins the retirement repo-wide: `agent-browser` may still appear
// in `plugin/skills/**/*.md` and `**/*.yml`, but only inside the files on the
// ALLOWLIST below, where every remaining mention is explicit history (a past
// incident, a dated migration note) or contrast (a migration translation
// table, an "unlike agent-browser" aside) — never a live instruction telling
// an agent to run an `agent-browser` command or expect its daemon. Every
// other file must carry zero mentions.
//
// Each ALLOWLIST entry needs a `reason` (asserted below) so an addition is
// reviewable in diff, the same discipline tests/payload-boundary.test.js's
// BOUNDARY_ALLOW already applies. A file that starts using `agent-browser`
// as a live instruction again gets fixed at the source, never allowlisted.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, 'plugin', 'skills');

// ── ALLOWLIST ────────────────────────────────────────────────────────────

const ALLOWLIST = [
  {
    file: 'plugin/skills/_shared/browser-detection.md',
    reason:
      'contrast aside in the Session/process lifecycle section: "unlike `agent-browser`, which ' +
      'auto-started one on port 4848" — states what playwright-cli does NOT do, by contrast.',
  },
  {
    file: 'plugin/skills/_shared/auto-mode-contract.md',
    reason:
      'contrast example: "(A *global install* like `agent-browser` is NOT in this class — see ' +
      '`browser-detection.md`.)" — illustrates a reversibility category, not an instruction.',
  },
  {
    file: 'plugin/skills/browse/SKILL.md',
    reason:
      'contrast asides marked with `<!-- playwright-cli: no equivalent found for agent-browser ' +
      '... — see issue Gotchas -->` (no persistent daemon, no `doctor`, no `batch`) — the ' +
      'migration-gap annotations this allowlist exists to cover.',
  },
  {
    file: 'plugin/skills/browse/playwright-cli-reference.md',
    reason:
      'the migration translation table itself (`agent-browser` command -> playwright-cli ' +
      'equivalent) — explicitly named as an allowed exception by record #3119\'s Deliverables.',
  },
  {
    file: 'plugin/skills/visual-review/discover-mode.md',
    reason:
      'contrast asides marked with `<!-- playwright-cli: no equivalent found for agent-browser ' +
      '... -->` (batch, vitals) — migration-gap annotations.',
  },
  {
    file: 'plugin/skills/visual-review/reconnaissance.md',
    reason:
      'contrast aside marked with `<!-- playwright-cli: no equivalent found for agent-browser ' +
      'batch -->` — migration-gap annotation.',
  },
  {
    file: 'plugin/skills/visual-review/browser-review.md',
    reason:
      'contrast asides marked with `<!-- playwright-cli: no equivalent found for agent-browser ' +
      '... -->` (doctor, vitals, batch) — migration-gap annotations.',
  },
  {
    file: 'plugin/skills/visual-review/page-mode.md',
    reason:
      'contrast asides marked with `<!-- playwright-cli: no equivalent found for agent-browser ' +
      '... -->` (vitals, batch) — migration-gap annotations.',
  },
  {
    file: 'plugin/skills/visual-review/journey-mode.md',
    reason:
      'contrast asides (marked `<!-- playwright-cli: no equivalent found for agent-browser ' +
      '... -->`, plus "Unlike `agent-browser`\'s `trace stop <path>`, `tracing-stop` takes no ' +
      'output-path argument") — migration-gap annotations, never an instruction to run ' +
      'agent-browser.',
  },
  {
    file: 'plugin/skills/specify/spec-template.md',
    reason:
      'explicit historical incident: "spec #1503 documented that `find role <role>` only ' +
      'reliably resolves ... in a pinned agent-browser version" — a dated past-tense example, ' +
      'not an instruction.',
  },
  {
    file: 'plugin/skills/feedback/upstream-draft.md',
    reason:
      '`vercel-labs/agent-browser` is a worked example value for the generic owner/name slug ' +
      'resolution table (a real third-party repo used to illustrate the form), and a ' +
      'parenthetical example of an unresolvable dependency name — not an instruction to use it.',
  },
  {
    file: 'plugin/skills/stories/source-aware-design.md',
    reason:
      'explicit past-tense history: "React component-tree inspection was available under ' +
      '`agent-browser` and has no Playwright CLI equivalent as of this migration."',
  },
  {
    file: 'plugin/skills/stories/source-analysis.md',
    reason:
      'explicit past-tense history: "React component-tree inspection was available under ' +
      '`agent-browser` and has no Playwright CLI equivalent" — same migration note as ' +
      'source-aware-design.md.',
  },
  {
    file: 'plugin/skills/init/bootstrap/step-14-cloud-routine-parity.md',
    reason:
      'contrast aside: "Unlike `agent-browser`\'s old workaround, Playwright\'s own install-deps ' +
      'detects root ... and skips sudo entirely" — explains current behavior by contrast with ' +
      'the retired tool.',
  },
];

const ALLOWLIST_FILES = new Set(ALLOWLIST.map((e) => e.file));

// ── Walk plugin/skills/**/*.md and **/*.yml ─────────────────────────────

function findFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findFiles(full));
    } else if (/\.(md|ya?ml)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function findMatchingLineNumbers(text) {
  const lineNumbers = [];
  text.split('\n').forEach((line, idx) => {
    if (line.includes('agent-browser')) lineNumbers.push(idx + 1);
  });
  return lineNumbers;
}

test('ALLOWLIST entries each carry a non-empty reason and name a file that actually exists', () => {
  for (const entry of ALLOWLIST) {
    assert.ok(entry.file, 'every ALLOWLIST entry needs a file');
    assert.ok(
      typeof entry.reason === 'string' && entry.reason.trim().length > 0,
      `${entry.file}: ALLOWLIST entry needs a non-empty reason`,
    );
    const abs = path.join(ROOT, entry.file);
    assert.ok(fs.existsSync(abs), `ALLOWLIST references a file that does not exist: ${entry.file}`);
  }
});

test('no shipped skill instruction outside the ALLOWLIST mentions agent-browser', () => {
  const files = findFiles(SKILLS_DIR);
  const violations = [];

  for (const abs of files) {
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    if (ALLOWLIST_FILES.has(rel)) continue;

    const lineNumbers = findMatchingLineNumbers(readText(abs));
    if (lineNumbers.length > 0) {
      violations.push(`${rel}:${lineNumbers.join(',')}`);
    }
  }

  assert.deepStrictEqual(
    violations,
    [],
    `agent-browser reappeared as a shipped instruction outside the ALLOWLIST: ${violations.join('; ')} ` +
      '— agent-browser is retired (playwright-cli is the only supported browser backend); add the ' +
      'file to ALLOWLIST (with a reason) only if the mention is genuine history/contrast, never if ' +
      'it instructs an agent to run an agent-browser command or expect its daemon.',
  );
});

test('every ALLOWLIST file still contains agent-browser (stale entries are removed, not left stale)', () => {
  const stale = [];
  for (const entry of ALLOWLIST) {
    const text = readText(path.join(ROOT, entry.file));
    if (findMatchingLineNumbers(text).length === 0) stale.push(entry.file);
  }
  assert.deepStrictEqual(
    stale,
    [],
    `ALLOWLIST carries a file with zero remaining agent-browser mentions — remove its entry: ${stale.join(', ')}`,
  );
});
