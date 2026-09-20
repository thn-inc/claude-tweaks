# Eliminate the `agent-browser` dependency

Origin: `#2537` (needs:definition redirect — see that record's Original request for the upstream defects that prompted this)

## Current State

The Playwright CLI consumer migration (`#2645`-`#2649`, shipped in v6.128.0) moved every browser-automation consumer skill off `agent-browser` except two operations that `playwright-cli-reference.md`'s Operation vocabulary table has no row for:

- **`press`** — used in `qa-agent.md`'s structured step executor for the `press` story action (no locator, acts at current focus).
- **Auth vault** — `agent-browser auth login <vault-name>` / `auth save` / `auth list`, used in `qa-agent.md`'s Setup Step e and referenced across `stories/SKILL.md`, `stories/auth-resolution.md`, `stories/refine.md`, and `stories/story-examples.md`.

Both were deliberately left untranslated as out-of-scope for `#2645` ("researching or backfilling a Playwright CLI equivalent for any capability with no documented translation... beyond what the Operation vocabulary table already covers"). Retiring `plugin/skills/browse/agent-browser-reference.md` itself was noted as a future "sub-project 4" in `#2645` but never filed as its own record.

Separately, `#2537` asks to fix two defects inside the vendored `agent-browser` CLI's own source (a synthetic-locator-click dispatch bug, and a screenshot `os error 35` self-heal gap). Investigation for this design doc found that **neither defect is currently exercised by this repo's consumers**: screenshot capture already goes through `playwright-cli screenshot`, and click actions already go through `playwright-cli click <eN>` (ref-based). The only place `agent-browser`'s buggy locator-click path might still run is opaquely inside its own `auth login` command's internal form submission — a path this repo cannot observe or control regardless of `#2537`'s outcome.

A live check of `playwright-cli` (v0.1.21, `npx @playwright/cli@latest --help`) found that **`press` already has a native equivalent** (`press <key>`, under "Keyboard") — the "no translation" note is a gap in this repo's own reference doc, not a tool limitation. `playwright-cli` also has `state-save`/`state-load` (raw storage-state persistence) but no auto-login-and-submit convenience command equivalent to the vault's `auth login <vault-name>`.

## Deliverables

Close both remaining gaps so `agent-browser` is invoked nowhere in the plugin, then retire its reference doc and close `#2537` and `#1768` as moot (neither's defects affect any code path this repo exercises once this ships).

**`press` is already covered by `#2670`** ("browse: resolve or confirm no-equivalent for agent-browser press command"), an existing open record with the identical deliverable and acceptance criteria — not decomposed again here. This design doc's own research already answers `#2670`'s open question: a live check of `playwright-cli` (v0.1.21, `npx @playwright/cli@latest --help`) found `press <key>` (under "Keyboard") already exists — the "no translation" note in `qa-agent.md` is a gap in this repo's own reference doc, not a tool limitation. `#2670`'s builder should confirm this against the bundled self-docs per its own Technical Approach and proceed directly to the row-add + `qa-agent.md` swap, skipping its own investigation step.

### 1. Replace the auth vault with session-state persistence

Chosen model: `playwright-cli`'s native `state-save`/`state-load`, not credential replay — no new secret-storage code, at the cost of the session expiring and needing periodic manual re-capture (accepted trade-off; see Error Handling).

- `auth: { vault: "<name>" }` in story YAML keeps its field name and shape — it now names a session-state file, not a credential entry. No existing story files need editing.
- **Storage location:** `.claude-tweaks/auth-state/<vault-name>.json`. Verify `.claude-tweaks/` is already gitignored; add a specific entry if the existing pattern doesn't cover it.
- **Capture procedure** (replaces `agent-browser auth save <vault-name> --url <url> --username <u> --password <p>`): a human runs `playwright-cli open <login-url>`, logs in manually in the visible browser, then `playwright-cli state-save .claude-tweaks/auth-state/<vault-name>.json`, then closes the session. No credential ever touches the LLM or this repo's tooling, same guarantee the vault made, by a different mechanism (the human types the password directly into the browser, not into a command the LLM composes).
- **List procedure** (replaces `agent-browser auth list`): `ls .claude-tweaks/auth-state/*.json` — a bare filesystem listing, no CLI command needed. Update `stories/auth-resolution.md`'s Step 1 and its "Tag self-heal" section accordingly.
- **Runtime use** (replaces `agent-browser auth login <vault-name>` in `qa-agent.md`'s Setup Step e): call `playwright-cli -s=<story-id> state-load .claude-tweaks/auth-state/<vault-name>.json` immediately after session creation, **before** `open` — Playwright applies storage state at browser-context creation, so loading it before the first navigation is the only ordering guaranteed to work; `--help` output for `state-load`/`open` doesn't document ordering constraints one way or the other, so smoke-test this exact sequence against a real auth-gated page as the first step of building sub-issue 2, before touching any of the surrounding prose.
- Update the printed one-time setup command in `stories/auth-resolution.md`'s "No matching vault" branch, `stories/SKILL.md`, `stories/refine.md`, and `stories/story-examples.md` to the new capture procedure. Remove every `<!-- playwright-cli: no equivalent found for agent-browser auth ... -->` comment these files carry.
- **Expiry handling:** fail-forward, no active pre-flight check. A later step fails naturally against a stale session — the same posture `auth-resolution.md` already uses for a missing vault ("expected to fail until fixed, not a defect"). No new detection machinery.

### 2. Retire `agent-browser-reference.md`

Gated on `#2670` (press) and sub-issue 1 (auth) both shipping — once neither gap needs `agent-browser`, nothing in the plugin calls it.

- Delete `plugin/skills/browse/agent-browser-reference.md`.
- Remove `agent-browser` from the cloud Setup script (`scripts/claude-cloud-setup.sh`, regenerated by `/claude-tweaks:init` Step 14) and from CLAUDE.md's Dependencies table and Cloud parity section.
- Sweep remaining `agent-browser` mentions repo-wide (`grep -rn agent-browser plugin/ docs/ CLAUDE.md`) — comparison prose ("unlike agent-browser, which...") in `browse/SKILL.md`, `_shared/browser-detection.md`, etc. can stay as historical context, but confirm none of it implies a live dependency.
- Close `#2537` **and `#1768`** as moot, one comment each, pointing at the closing PR/commit: both asked to fix defects inside the vendored `agent-browser` CLI directly, and neither defect is exercised by any code path this repo calls anymore once this ships. `#1768`'s `bot:in-progress` label is a stale claim (expired 2026-09-20T04:34, no activity since) — safe to close without coordinating with an active builder.

## Acceptance Criteria

- `grep -rn "agent-browser" plugin/` returns no line that constitutes a live command invocation (comparison/historical prose only).
- A story with a `press` action passes against a real page via `playwright-cli` (verified by `#2670`, not re-verified here).
- A story with `auth: { vault: "<name>" }` passes end-to-end using a captured session-state file, with no `agent-browser` process ever started.
- `stories/auth-resolution.md`'s missing-vault path prints the new capture command, not `agent-browser auth save`.
- `#2537` and `#1768` are both closed, each referencing this work, with a comment explaining why (defects no longer exercised).

## Error Handling

- **Missing session-state file:** identical UX to today's missing-vault path in `auth-resolution.md` — print the capture command, `AskUserQuestion` (interactive) / tag `needs-auth-vault` and stage the install hint (auto mode). Only the printed command text changes.
- **Expired session-state file:** no active detection. A later interactive step fails against the stale session; this is expected, not a defect, matching the existing missing-vault precedent. A human re-runs the capture procedure to refresh it.

## Testing

No dedicated prose test targets `qa-agent.md` or the `stories/*` auth files today (confirmed unchanged at `#2645`) — `npm test`'s existing suite remains the only mechanical gate. Verification for this work is a manual QA run: one story exercising `press`, and one auth-gated story exercising the full capture → `state-load` → authenticated-step flow, confirming no `agent-browser` process starts during either.

## Original request

Follow-up from `#2537`, itself filed from `#1768`'s Blocked / Future Work section. `#1768` diagnosed two `agent-browser` defects (synthetic-locator-click dispatch, screenshot `os error 35` self-heal) that live entirely in the vendored CLI's own source and could not be fixed from this repo. `#2537` asked to fix them upstream (or via a vendoring/patch mechanism); this design instead eliminates the dependency that would have needed those fixes, since the Playwright CLI migration already removed every code path that exercised them except two closeable capability gaps — one of which (`press`) already has its own open record (`#2670`), leaving one sub-issue for this decomposition to create.
