# Step 19 — Emil Design-Engineering Skills (detailed procedure)

*Optional Enhancement step — see `../SKILL.md`'s `## Input` for when this group is offered or filtered, and `../bootstrap-steps.md` for its ordering and renumbering conventions.*

claude-tweaks' craft layer (`skills/_shared/design-craft.md`) live-loads [Emil Kowalski](https://github.com/emilkowalski/skills)'s design-engineering skills as the generic-principles half of every UI-writing dispatch's design context — alongside the project's own decisions (`DESIGN.md` + the `.impeccable/design.json` sidecar). The skill set is MIT-licensed, published as plain `SKILL.md` files, and pinned by content hash in `tools/upstream-drift/manifest.yml` (the upstream repo has no version tags).

**Detect frontend signals** the same way Step 11 does (Phase 2 reconnaissance, or the Layer 3 trigger-extension sniff via `frontend-detection.md` in the `/claude-tweaks:design-wrapper` skill's directory). If none are detected, skip this step entirely.

**If frontend is detected, call `AskUserQuestion`:**

- `question`: `"Install Emil Kowalski's design-engineering skills? They feed generic craft principles (design engineering, motion, Apple-style treatment) into every UI-writing dispatch's context, per the design-craft contract. The install is optional — when absent, dispatches simply proceed without them (graceful degradation, never a gate)."`, `header`: `"Emil skills"`, `multiSelect`: `false`
- Option 1 — `label`: `"Install (Recommended)"`, `description`: `"Run npx skills@latest add emilkowalski/skills — installs the skill files and Claude Code symlinks into this project."`
- Option 2 — `label`: `"Skip"`, `description`: `"Proceed without; UI dispatches degrade gracefully per the contract. Install any time later with the same command."`

**For option 1 — run the install:**

```
npx skills@latest add emilkowalski/skills
```

This writes the skill files under the project's `.agents/skills/{name}/` with per-skill Claude Code symlinks at `.claude/skills/{name}` (the layout the design-craft contract's resolution procedure reads). Note the `skills` CLI's latest releases require Node ≥ 22.20 — on an older Node, pin a compatible release (e.g. `npx skills@1.5.18 add emilkowalski/skills`). Verify by checking that `.claude/skills/emil-design-eng/SKILL.md` resolves (through its symlink).

**No CLAUDE.md flag is written — deliberately.** Unlike the sibling integration steps (Impeccable's `design-integration`, shadcn's `shadcn-integration`), the craft contract resolves Emil availability by **presence** at dispatch time (its lookup paths), and its kill-switch is Step 11's existing `design-integration` flag — a separate Emil flag would be config nothing reads. Installed-or-not *is* the durable record; a decline is noted in the init run summary only.

**Failure handling:** if the install fails (network, Node version), do not abort `/init` — surface the failure and continue; the contract degrades gracefully without the skills, and the command can be re-run any time.

**Re-run behavior:** when `.claude/skills/emil-design-eng` already resolves, report "already installed" and skip the offer; the upstream-drift auditor (not this step) is what watches the pinned content for drift.
