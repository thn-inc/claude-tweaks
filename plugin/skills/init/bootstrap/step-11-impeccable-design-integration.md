# Step 11 — Impeccable Design Integration (detailed procedure)

*Optional Enhancement step — see `../SKILL.md`'s `## Input` for when this group is offered or filtered, and `../bootstrap-steps.md` for its ordering and renumbering conventions.*

claude-tweaks v4.5+ integrates [Impeccable](https://impeccable.style/) — a frontend-design Claude Code plugin that ships LLM commands (`critique`, `audit`, `polish`, `bolder`, `delight`, etc.). Impeccable also publishes a separate deterministic Node CLI (`impeccable detect`) for catching design anti-patterns without LLM cost; it is an independent npm package with its own version line, not something the plugin install provides — see the install step below. The integration is opt-in and only runs on frontend projects.

**Detect frontend signals from Phase 2 reconnaissance** (or run a quick sniff of the
project root if Phase 0 is being run before Phase 2), using the same trigger-extension
and trigger-path rules as `/claude-tweaks:design-wrapper`'s Layer 3 sniff — for the
canonical list, read `frontend-detection.md` in the `/claude-tweaks:design-wrapper`
skill's directory. If none are detected, skip this step entirely — the project is not
frontend-facing.

**If frontend is detected, call `AskUserQuestion`:**

- `question`: `"Detected frontend project. Set up Impeccable design integration? Impeccable provides design-quality commands invoked by /test (deterministic CLI gate) and /review (LLM critique + audit). All findings are advisory in v4.5 — code is never auto-modified."`, `header`: `"Impeccable integration"`, `multiSelect`: `false`
- Option 1 — `label`: `"Full integration (Recommended)"`, `description`: `"Install plugin, run init + document."`
- Option 2 — `label`: `"Plugin only"`, `description`: `"Install plugin, skip the design-context interview (run later)."`
- Option 3 — `label`: `"Skip"`, `description`: `"Disable design integration."`

**For options 1 or 2 — install the plugin.** Surface this exact three-command sequence (claude-tweaks does not programmatically install plugins):

```
/plugin marketplace add pbakaus/impeccable
/plugin install impeccable@impeccable
/reload-plugins
```

The plugin and the CLI are independent artifacts with independent version lines: the three-command sequence above installs only the plugin's LLM-command skills. The CLI (`impeccable detect`, invoked via `npx`) needs its own install — run `npm install -g impeccable` and verify with `npx impeccable --version`. `/claude-tweaks:test`'s design gate depends on this install; `/claude-tweaks:review`'s LLM commands depend only on the plugin above.

Verify the plugin install by checking that `/impeccable:impeccable` resolves to a skill in the next session. If it does not, the plugin install must complete before downstream features work.

**For option 1 only — generate design context files.** Run the init interview (interactive, ~5 minutes) and then generate the spec-compliant design document:

```
/impeccable:impeccable init
/impeccable:impeccable document
```

(`/impeccable:impeccable teach` still works as a deprecated alias for `init`, in case older instructions elsewhere reference it.)

This writes `PRODUCT.md` (strategic context: audience, brand voice, anti-references) and `DESIGN.md` (visual system: colors, typography, components) at the project root. These are the files the design wrapper reads.

**Write the kill-switch flag to CLAUDE.md.** Add (or update) a `## Design integration` section near the existing project-level config sections:

```markdown
## Design integration

design-integration: enabled
```

Use the appropriate value:

| Choice | Flag value |
|--------|-----------|
| Option 1 (Full) | `enabled` |
| Option 2 (Plugin only) | `plugin-only` |
| Option 3 (Skip) | `disabled` |

The `/claude-tweaks:design-wrapper` wrapper reads this flag as Layer 1 of its detection logic. Missing flag is treated identically to `disabled` — design integration only activates when explicitly enabled by `/init`.

**For option 3:** Write `design-integration: disabled` to CLAUDE.md and continue. The wrapper short-circuits universally — no CLI calls, no LLM invocations, no token cost.

**Genesis-moment recommendation.** Applies whenever the step ends `enabled` or `plugin-only` on a web-frontend project with no `DESIGN.md` at the project root — option 2 ("Plugin only") skipped the interview entirely, or option 1's interview didn't produce one (its `document` run above normally does). Then the step's summary/next-actions output recommends `/claude-tweaks:design-wrapper explore` as the genesis move: it compares competing visual identities in the browser and, on a pick, locks `DESIGN.md` via upstream. Recommendation text only, never a `Skill` tool invocation — `explore` needs a human in a browser to judge the tournament, and `/init` may run in cloud or Routine contexts where none exists.

**Optional companion (not part of the integration).** Impeccable also publishes a Chrome extension at https://chromewebstore.google.com/detail/impeccable/bdkgmiklpdmaojlpflclinlofgjfpabf that overlays the same 25-rule detector on any webpage during normal browsing. It does not connect to the slash commands and is not tracked by the `design-integration` flag — install it separately if you want ad-hoc audits while browsing your dev server, staging, or any third-party site. Skip otherwise.

**Re-run behavior:** When `/init` is re-run on a project where `design-integration: enabled`, offer to re-run `/impeccable:impeccable init` + `document` to refresh `PRODUCT.md` / `DESIGN.md` (the codebase may have evolved since the last run). When the flag is `plugin-only` or `disabled`, offer the upgrade path back to full integration.

**Failure handling:** If the plugin install or the CLI install fails, do not abort `/init` — surface the failure and continue with `design-integration: disabled` until the user resolves it. The two installs are independent, so one can succeed while the other fails (e.g. the plugin installs but `npm install -g impeccable` hits a permissions error); surface exactly which one failed. The wrapper's availability checks gracefully skip when dependencies are absent.

**Automatic design hook (optional, separate offer).** After the install sequence completes for option 1 or 2 (Impeccable is installed either way), offer the automatic detection hook as its own follow-up. This is a materially different kind of decision from the context-file setup above — automatic runtime behavior during editing, not one-time context generation — so it gets its own prompt rather than a fourth item bolted onto the three-option choice above:

**Call `AskUserQuestion`:**

- `question`: `"Enable Impeccable's automatic design hook? It runs the anti-pattern detector after every UI edit and surfaces findings inline — no slash command needed. Note: consent lives in the working tree, not .git/ — a fresh git worktree (via /build worktree or /flow worktree) won't have this enabled until you run /impeccable hooks on inside it again."`, `header`: `"Automatic design hook"`, `multiSelect`: `false`
- Option 1 — `label`: `"Yes — run /impeccable hooks on (Recommended)"`, `description`: `"Enables the automatic anti-pattern detector for this working tree."`
- Option 2 — `label`: `"Skip"`, `description`: `"Enable later, or per-worktree, as needed."`

On option 1, run `/impeccable:impeccable hooks on` via the Skill tool. This writes hook consent into `.impeccable/config.local.json` in the current working tree only — it does not carry over to worktrees created later by `/build worktree` or `/flow worktree` (see `skills/build/worktree-setup.md` for the per-worktree note). No CLAUDE.md flag is needed for this choice — Impeccable's own `.impeccable/config.local.json` is the on/off state, checked directly by Impeccable, not by this wrapper.

Skip this offer entirely when Impeccable was not installed (option 3 was chosen above, or the install failed) — there is nothing to enable.
