# Step 13 — shadcn Bootstrap (detailed procedure)

*Optional Enhancement step — see `../SKILL.md`'s `## Input` for when this group is offered or filtered, and `../bootstrap-steps.md` for its ordering and renumbering conventions.*

claude-tweaks integrates [shadcn/ui](https://ui.shadcn.com/) — a CLI-driven component
system distributed as copy-paste source files rather than an npm package. As of CLI v4
(~March 2026), shadcn ships three AI-agent-facing layers: the CLI itself (`init`/`add`),
a first-party MCP server (search/browse/view/install/audit registry items), and an
installable Skill (`skills add shadcn/ui`) that injects live project context into Claude Code
so it stops guessing at component APIs. This step wires all three, mirroring Step 11's
(Impeccable) install-and-flag pattern.

**Detect frontend signals from Phase 2 reconnaissance** (or run a quick sniff of the
project root if Phase 0 is being run before Phase 2) — the same canonical sniff rules
`step-11-impeccable-design-integration.md` uses (`/claude-tweaks:design-wrapper`'s Layer 3 file-extension/path sniff;
read `frontend-detection.md` in that skill's directory for the current list). If none
are detected, skip this step entirely.

Then check whether `components.json` already exists at the project root.

**Case A — no `components.json`, frontend detected:**

Call `AskUserQuestion`:

- `question`: `"Detected frontend project. Set up shadcn/ui integration? Provides a CLI-driven component system plus first-party AI-agent tooling: an MCP server (search/browse/install/audit registry items) and an installable Skill that gives Claude Code live project context, so it discovers and installs components correctly instead of guessing."`, `header`: `"shadcn/ui integration"`, `multiSelect`: `false`
- Option 1 — `label`: `"Full integration (Recommended)"`, `description`: `"CLI init, wire MCP server, install shadcn/skills."`
- Option 2 — `label`: `"CLI only"`, `description`: `"CLI init, skip MCP/skills wiring."`
- Option 3 — `label`: `"Skip"`, `description`: `"Disable shadcn integration."`

**Options 1 and 2 both run:**

1. Detect the package manager from the lockfile present at the project root:

   | Lockfile | Prefix |
   |---|---|
   | `pnpm-lock.yaml` | `pnpm dlx` |
   | `yarn.lock` | `yarn dlx` |
   | `bun.lockb` | `bunx` |
   | `package-lock.json` or none | `npx` |

2. Detect the framework from `package.json` dependencies for the `-t` flag:

   | Dependency present | `-t` value |
   |---|---|
   | `next` | `next` |
   | `vite` | `vite` |
   | `astro` | `astro` |
   | `@remix-run/react` or `react-router` | `react-router` |
   | `@tanstack/react-start` | `start` |
   | `laravel/framework` in `composer.json`, or an `artisan` file at root | `laravel` |
   | None matched | Omit `-t`; let the CLI prompt interactively |

3. Run `<prefix> shadcn@latest init -t <framework>` (omit `-t <framework>` if
   undetected). Let the CLI's own interactive prompts resolve style, base color, and
   CSS-variable choices — do not pre-answer them; claude-tweaks has no fixed preset to
   apply.

**Option 1 only, additionally:**

4. Wire the MCP server for Claude Code. Back up `.mcp.json` first if it exists
   (`cp .mcp.json .mcp.json.bak`), then run shadcn's own documented setup command, which
   handles the merge:

   ```bash
   <prefix> shadcn@latest mcp init --client claude
   ```

   This writes (or merges into an existing) `.mcp.json`:

   ```json
   {
     "mcpServers": {
       "shadcn": {
         "command": "npx",
         "args": ["shadcn@latest", "mcp"]
       }
     }
   }
   ```

   If the `mcp init --client claude` command fails or is unavailable, fall back to
   merging the JSON block above into `.mcp.json` directly (never overwrite existing
   `mcpServers` entries from other tools).

5. Install the shadcn Skill, using the same package-manager prefix resolved in step 1:

   ```bash
   <prefix> skills add shadcn/ui
   ```

**Case B — `components.json` exists, MCP/skills not fully wired:**

Check `.mcp.json` for an existing `mcpServers.shadcn` entry, and check whether the
shadcn Skill is installed by looking for a `shadcn*`-named entry in the available
skills list the harness provides — the same skill-list-resolution technique
`design-wrapper/SKILL.md` uses to detect whether Impeccable is installed (look for
`/impeccable:impeccable*` in that same list); treat no match as not installed. If
either is missing, call `AskUserQuestion`:

- `question`: `"shadcn/ui is already initialized in this project. Wire up the MCP server and shadcn/skills for Claude Code?"`, `header`: `"shadcn/ui wiring"`, `multiSelect`: `false`
- Option 1 — `label`: `"Yes — wire remaining layers (Recommended)"`, `description`: `"Runs steps 4-5 above (skipping CLI init, already done)."`
- Option 2 — `label`: `"Skip"`, `description`: `"Leave both layers unwired."`

Option 1 runs steps 4-5 above (skipping CLI init, already done). Option 2 skips both.

**Case C — fully configured already:**

`components.json` exists, `.mcp.json` has the `mcpServers.shadcn` entry, and the shadcn
Skill is installed. Silent no-op — no prompt, matching every other Optional Enhancement
step's idempotency contract.

**Write the CLAUDE.md flag.** Add (or update) the `## Design integration` section — the
same section Steps 11 and 12 write to:

```markdown
## Design integration

design-integration: enabled
diagram-suggestions: enabled
shadcn-integration: enabled
```

| Case / choice | Flag value |
|---|---|
| Case A, option 1 | `enabled` |
| Case A, option 2 | `cli-only` |
| Case A, option 3 (skip) | `disabled` |
| Case B, option 1 | `enabled` |
| Case B, option 2 (skip) | `cli-only` — the CLI portion is already done regardless of this offer's outcome, so `cli-only` reflects reality; `disabled` would be inaccurate |
| Case C | No write — the flag should already read `enabled` from a prior run; leave untouched |

**Scope note:** this flag is currently write-only — no other claude-tweaks skill reads
it yet. Re-run idempotency for this step comes entirely from the filesystem checks above
(Case A/B/C), not from this flag. The flag is reserved for a future consumer (e.g. `/design-wrapper`
preferring shadcn components when it reads `enabled`), the same role `design-integration`
plays for Step 11.

**Failure handling:** If any install command fails (network error, package-manager
error), surface the failure and continue Phase 0 with `shadcn-integration: disabled` (or
the honestly-reached partial state) rather than aborting the rest of bootstrap.
