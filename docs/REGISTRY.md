# Doc Registry

> Maps documentation to the code areas it covers. Created by /init, maintained by /build and /wrap-up.
> When code matching an Auto-detect pattern changes, the corresponding doc should be reviewed and updated.
>
> Auto-detect patterns are matched against the **current** run's `git diff --name-only`
> (`plugin/skills/wrap-up/docs-health-integration.md` Step 2, via `plugin/bin/lib/issues/blast-radius.js`'s `classifyDiffFiles`),
> never against history — so payload patterns carry only the post-#418 `plugin/` spelling.

## Tier: 3

| Doc | Covers | Auto-detect |
|-----|--------|-------------|
| README.md | Project overview, install, skill index | `plugin/.claude-plugin/plugin.json`, `plugin/skills/**/SKILL.md` |
| CLAUDE.md | How to work in this codebase — stack, structure, conventions, philosophy, releasing, Don'ts | `plugin/.claude-plugin/plugin.json`, `package.json`, `plugin/skills/_shared/*.md` |
| docs/getting-started.md | Full skill reference — every `/claude-tweaks:*` command with its behavior | `plugin/skills/**/*.md` |
| docs/plugin-structure.md | Directory tree, per-skill sub-file table, command reference | `plugin/skills/**/*.md`, `plugin/skills/**/*.yml`, `plugin/skills/**/*.html`, `plugin/skills/**/*.mjs`, `plugin/bin/**/*.js` |
| docs/skill-graph.md | Every skill-to-skill relationship/edge (single source of truth) | `plugin/skills/**/*.md`, `plugin/skills/**/routine-template.yml` |
| docs/donts.md | Full Don'ts rule list (extracted from CLAUDE.md's `## Don'ts`, which now holds only a pointer) | CLAUDE.md `## Don'ts`, `plugin/bin/lib/hooks/**` |
| docs/hooks.md | Hook dispatcher contract — tiered posture, run-dir resolution and ownership, never-break-a-session invariant, consumers (extracted from CLAUDE.md's `### Hooks`, which now holds only a pointer) | `plugin/bin/hooks.js`, `plugin/bin/lib/hooks/**`, `plugin/hooks/hooks.json`, `plugin/bin/lib/reconcile/**` |
| docs/reconcile-checks.md | Reconcile dispatcher contract — dispatch order and why it's significant, the fast/background check split, the full "adding a new check" registration procedure (extracted from `docs/hooks.md`'s inventory-only reconcile coverage; `CLAUDE.md`'s `### Reconcile` pointer) | `plugin/bin/lib/reconcile/**` |
| docs/incident-log.md | Post-mortems behind each `[IL-nn]`-tagged Don't in CLAUDE.md | CLAUDE.md `## Don'ts`, docs/donts.md |
| docs/shipped-versions.tsv | Authoritative record of every shipped version + date | `plugin/.claude-plugin/plugin.json`, `CHANGELOG.md` |
| docs/decisions/*.md | Architecture Decision Records — hard-to-reverse, surprising trade-offs | *(no auto-detect — written deliberately by /wrap-up's ADR gate)* |
| docs/diagrams/*.html | Generated visual diagrams — the directory does not exist until the first `/claude-tweaks:visualize` run creates it, so a missing `docs/diagrams/` is not a registry break | *(no auto-detect — generated on demand by `/claude-tweaks:visualize`)* |
| docs/journeys/*.md | User/developer journeys backing agent e2e testing | *(no auto-detect — see per-journey `files:` frontmatter instead)* |
| docs/plans/*.md | Per-run pipeline ledgers (spec/record scoping, resolve-gate state) | *(no auto-detect — generated per pipeline run by `/claude-tweaks:ledger`)* |
| docs/superpowers/plans/*.md, docs/superpowers/specs/*.md | Execution plans and design docs produced and consumed by the pipeline (`/superpowers:writing-plans`, `/superpowers:brainstorming`) | *(no auto-detect — generated per run; consumed artifacts are deleted at wrap-up)* |
| docs/skill-authoring.md | Skill-file authoring conventions — structure, frontmatter, interaction patterns, CSC | `plugin/skills/**/*.md` |
| docs/releasing.md | Release procedure + judgment calls | `plugin/bin/release.js`, `plugin/bin/lib/release/**` |
| docs/demo-evidence/*.md | Per-record demo verification evidence produced by `/claude-tweaks:demo` | *(no auto-detect — generated per record by `/claude-tweaks:demo`)* |
