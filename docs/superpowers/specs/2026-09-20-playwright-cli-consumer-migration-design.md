# Playwright CLI consumer migration (sub-project 3)

## Context

`agent-browser` → Playwright CLI migration status: sub-project 1 (spike) and sub-project 2
(`plugin/skills/browse/playwright-cli-reference.md`, plus `step-07-browser-integration.md` and
`_shared/browser-detection.md` detecting `playwright-cli`) have both shipped (#2627).
`agent-browser-reference.md` still exists unmodified — retiring it is sub-project 4, out of scope
here.

Every other file that hand-constructs `agent-browser` CLI command strings, or names it in a
functional (not prose) context, still speaks the old syntax. A grep sweep (this session, verified
against the current tree) found **20 files** needing a real change, split into two kinds:

- **16 markdown skill files** that construct `agent-browser` commands directly (not just cite the
  reference doc) — listed per-group below.
- **4 non-skill-body files**: `plugin/skills/browse/SKILL.md` (names `agent-browser` in
  description/install-requirement prose but constructs no commands — a pure name-swap),
  `plugin/.claude-plugin/plugin.json` (declares `agent-browser` as an optional dependency),
  `plugin/bin/lib/deps.js` (the actual JS detection code), and
  `plugin/skills/init/bootstrap/step-14-cloud-routine-parity.md` (the literal
  `npm install -g agent-browser` line in the cloud-sandbox Setup script).

Out of scope for this sub-project: `agent-browser-reference.md` itself, and 11 files that mention
`agent-browser` only in prose/status-line context with no command construction
(`_shared/auto-mode-contract.md`, `_shared/dev-url-detection.md`, `flow/SKILL.md`,
`init/bootstrap-steps.md`, `init/SKILL.md`, `init/summary-templates.md`, `init/update-mode.md`,
`review/code-mode-steps.md`, `routine/guided-environment-creation.md`, and
`specify/spec-template.md`, which documents a past incident by name and should stay as historical
record). These fold into sub-project 4 or a final name-swap-only sweep, not this one.

## Scope: five sub-issues

Grouped by skill-directory ownership rather than even file-count, so each sub-issue's context is
self-contained — an agent building one group never needs to read files outside it.

1. **`plugin/agents/qa-agent.md`** (standalone) — the heaviest single consumer (26 `agent-browser`
   hits: `--session`, `open`, `trace start`/`stop`, `snapshot -i -c`, `find`,
   `screenshot --annotate`, `close`). Pulled out solo because of its size, not its content — same
   translation approach as every other group.
2. **`plugin/skills/stories/*`** (6 files: `auth-resolution.md`, `refine.md`, `SKILL.md`,
   `source-analysis.md`, `source-aware-design.md`, `story-examples.md`). Includes the
   React-introspection removal (below).
3. **`plugin/skills/visual-review/*`** (5 files: `browser-review.md`, `journey-mode.md`,
   `page-mode.md`, `qa-accelerated.md`, `reconnaissance.md`).
4. **`plugin/skills/demo/*` + `plugin/skills/test/*`** (4 files: `demo/legacy-brief-compatibility.md`,
   `demo/SKILL.md`, `test/qa-procedures.md`, `test/qa-prompts.md`) — combined; each skill alone is
   too small to be its own sub-issue.
5. **Install/detect plumbing** (4 files: `browse/SKILL.md` name-swap,
   `plugin/.claude-plugin/plugin.json`, `plugin/bin/lib/deps.js`,
   `step-14-cloud-routine-parity.md`) — grouped separately from the skill-body groups above because
   it's a different kind of change (dependency declaration and detection code, not skill
   instructions) and needs one specific technical note (below).

Each sub-issue's Technical Approach: for every `agent-browser` command in its files, look up the
row in `plugin/skills/browse/playwright-cli-reference.md`'s Operation vocabulary table and
substitute the Playwright CLI equivalent — mechanical translation, no new design per file. Two
things every sub-issue must get right beyond the substitution itself:

- **Session flag position.** `agent-browser --session <name> <verb>` puts `--session` before the
  verb; Playwright CLI's `-s=<name>` is documented in the reference doc the same way (`playwright-cli
  -s=<name> <verb>`) — carry that positioning over, don't invent a new convention per file.
  Standalone commands (e.g. `agent-browser doctor`, referenced in `visual-review/browser-review.md`)
  have no Playwright CLI equivalent documented — check the reference doc's Authority section
  (bundled self-docs) before assuming one doesn't exist; if genuinely none exists, note the gap in
  that sub-issue's Gotchas rather than inventing a workaround.
- **Absolute paths.** Every `screenshot`/`trace stop` path argument must be absolute in the
  migrated Playwright CLI form (the reference doc's caution) — a file that passed a relative path
  under `agent-browser` needs that path resolved to absolute, not just the command syntax swapped.

## React-introspection removal (sub-issue 2: stories/*)

`stories/source-analysis.md` and `stories/source-aware-design.md` use `agent-browser`'s
`react tree` / `react inspect @eN` commands — Playwright CLI's reference doc documents no
equivalent. Decision (made before this design doc): **drop the feature** rather than research a
replacement or carve out an exception. Both files' migrated versions remove the React-introspection
step entirely and note the capability loss (one sentence: React component-tree inspection was
available under `agent-browser` and has no Playwright CLI equivalent as of this migration) rather
than silently deleting the capability with no trace.

## Install/detect plumbing (sub-issue 5): a real technical note, not just a rename

`plugin/bin/lib/deps.js`'s `agentBrowserMessage()` (line 60) currently calls `has('agent-browser')`
(line 61), which shells out to `agent-browser --version` via the shared `has(cmd)` helper (line 5:
`execSync(\`${cmd} --version\`)`). **This helper cannot be reused as-is for Playwright CLI** — the
detection command `_shared/browser-detection.md` and `playwright-cli-reference.md` both document is
`npx --no-install playwright-cli --version`, not a bare `playwright-cli --version`; a naive
`has('playwright-cli')` call would only detect a global install and miss the local/npx-resolved
case the rest of the plugin already treats as the real detection contract. The migrated
`agentBrowserMessage()` (rename to `playwrightCliMessage()`, called from `collect()` at line 92)
needs its own `execSync('npx --no-install playwright-cli --version', { stdio: 'ignore' })` check
inline, matching `has()`'s try/catch-false shape, rather than calling the shared `has()` helper.
The install-hint string (line 62) becomes `npm install -g @playwright/cli`, mirroring
`_shared/browser-detection.md`'s Install section.

`plugin.json`'s dependency declaration (line 19) is a one-line value swap:
`agent-browser` → `@playwright/cli` (confirm the exact declared-dependency shape by reading the
surrounding lines before editing — don't assume the field name).

`step-14-cloud-routine-parity.md`'s literal `npm install -g agent-browser` line becomes
`npm install -g @playwright/cli`.

## Testing

No dedicated test file exists for `deps.js`'s agent-browser detection (confirmed: `tests/` has no
`*deps*` file, and the two `agent-browser` hits in `tests/bin-lib/skill-audit/anti-patterns.test.js`
are comments, not assertions). No new tests are required for this migration — matches
`agent-browser-reference.md`'s own precedent of shipping without a test suite. Run the full
`npm test` suite after each sub-issue's changes to confirm no unrelated regression (the standard
gate, not new coverage).

## Non-Goals

- `agent-browser-reference.md` itself — untouched, sub-project 4's job to retire it.
- The 11 prose-only files listed in Context above — folded into sub-project 4 or a later
  name-swap-only sweep, not this decomposition.
- Researching a Playwright CLI React-introspection replacement — explicitly declined; the feature
  is dropped, not replaced.
- Any change to `docs/donts.md` — sub-project 4's scope.
