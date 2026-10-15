# Phase 9: Summary Templates

## Initial Mode Summary

```markdown
## Init Summary

### Verified & Consistent

What /init checked and found true about this repo and environment — the affirmative findings behind the config below. Only list checks that actually ran; mark `med`/`low` confidence detections so the user knows what to review.

| Check | Result |
|-------|--------|
| Superpowers plugin | present |
| Code simplifier | available |
| playwright-cli | installed (v{X.Y.Z}) / not installed — install hint surfaced |
| Git repo | yes |
| Node (statusline) | v{X} present |
| Statusline | wired to claude-tweaks wrapper |
| Stack detected | {list} (confidence: high) |
| Architecture | {pattern} (confidence: high) |
| Maturity / doc tier | {value} / {N} (confirmed Phase 3) |
| Conventions detected | {N} grounded in observed code |

### Bootstrap (Phase 0)

| Item | Status |
|------|--------|
| Superpowers plugin | {installed/already installed} |
| Code simplifier | {available} |
| `specs/` | {created/exists} |
| `docs/plans/` | {created/exists} |
| `docs/journeys/` | {created/exists} |
| Git repo | {yes/no — warning if no} |
| Worktree directory | {configured/skipped} |
| Browser: playwright-cli | {installed (vX.Y.Z) / not installed — install hint surfaced} |

### Project Classification (Phase 3)
| Dimension | Confirmed |
|-----------|-----------|
| Maturity | {greenfield/pre-launch/early-production/established} |
| Doc tier | {1/2/3} |

### Doc Registry (Phase 8.5)
| Item | Status |
|------|--------|
| `docs/REGISTRY.md` | {created/updated/skipped} |
| Registry entries | {N} docs tracked |
| Skeleton files created | {list or "none"} |

### CLAUDE.md
- {line count} lines
- Covers: {sections list}

### Skills ({count})
| Skill | Priority | Depth | Files |
|-------|----------|-------|-------|
| {name} | P1 | Full | SKILL.md |
| ... | ... | ... | ... |

### Rules ({count})
| Rule | Scoped to |
|------|-----------|
| {name} | {paths} |

### Backlog Work Records Filed ({count})

Items with Phase 2 context baked in, ready for the normal pipeline:

| Category | Count | Examples |
|----------|-------|---------|
| Improvement work | {N} | {e.g., "Set up CI", "Add test coverage for utils"} |
| Deferred skills | {N} | {e.g., "Create data-access skill (P2)", "Create testing skill [aspirational]"} |
| Doc work | {N} | {e.g., "Refresh README (stale commands)", "Create getting-started.md"} |
| Journey enrichment | {N} | {e.g., "Browser-test checkout flow", "Browser-test onboarding"} |

### Refinement roadmap
After 1 week of use, revisit:
1. {skill most likely to need adjustment and why}
2. {convention most likely to be incomplete}
3. {area where team input would improve the config}

Ready to write these files?
```

## Update Mode Summary

Lead with what was audited and found healthy, then the proposed changes. The **Verified & Consistent** section is not optional — it is the answer to "what did you check and decide not to touch?" Only include rows for checks that actually ran this pass; omit dimensions skipped by an early-exit (the early-exit path has its own shorter verified block in `update-mode.md`).

```markdown
## Configuration Update

### Verified & Consistent (audited — no change needed)

Everything below was checked against the current codebase and found accurate. Surfaced so you can see what was confirmed, not just what changed.

**Environment & dependencies**
| Check | Result |
|-------|--------|
| Superpowers plugin | present |
| Code simplifier | available |
| playwright-cli | installed (v{X.Y.Z}) |
| Git repo | yes |
| Node (statusline) | v{X} present |
| Statusline | wired to claude-tweaks wrapper |
| Workflow dirs (`specs/`, `docs/`) | present |

**Template conformance**
| Section | Status |
|--------|--------|
| {one row per plugin-authored section Phase 1u.5 checked} | {conformant \| missing \| drifted} |

**Config accuracy (verified against codebase)**
| Area | Finding |
|------|---------|
| Stack table | matches detected stack ({list}) |
| Commands | all {N} resolve to real scripts |
| Conventions | {N} confirmed still in force |
| Skills | {N} of {M} accurate — paths + patterns still exist |
| Rules | {N} path scopes still valid |
| Doc registry | {N} entries map to live code areas |
| Journeys | {N} match current routes |

### CLAUDE.md
- {N} patches ({list: "updated Stack table", "added Don't", etc.})

### Skills Updated ({count})
| Skill | Changes |
|-------|---------|
| {name} | {1-line summary of edits} |

### Skills Created ({count})
| Skill | Priority | Rationale |
|-------|----------|-----------|
| {name} | P1 | {gap it fills} |

### Skills to Consider Removing ({count})
| Skill | Reason |
|-------|--------|
| {name} | {e.g., "project no longer uses Redis"} |

### Rules
- {N} updated, {N} created, {N} to remove

Policy review any time: `/claude-tweaks:help policy` — the standing config review surface outside init.

Ready to apply these changes?
```

Execute only after user confirmation.

## Actions Performed (Phase 9)

Rendered after the mode summary above is confirmed. The Worktree policy row's "Worktree Policy Finalization" pointer names that `SKILL.md` section, whose procedure lives in `worktree-policy-finalization.md`.

After writing files, surface what was created. Generate the table from the actual artifacts produced this run (only include rows for actions that actually occurred):

| Action | Detail | Ref |
|--------|--------|-----|
| Bootstrap | Created `specs/`, `docs/`, `docs/journeys/`, `.worktrees/`, etc. (only missing dirs) | Step 2 |
| Statusline | Installed wrapper at `~/.claude-tweaks/bin/statusline.js`; wired `~/.claude/settings.json` | Step 8 |
| Design integration | Set `design-integration: {enabled/plugin-only/disabled}` in CLAUDE.md | Step 11 |
| shadcn integration | Set `shadcn-integration: {enabled/cli-only/disabled}` in CLAUDE.md | Step 13 |
| Work records | Set work-backend / work-types in CLAUDE.md and work-links in `.claude-tweaks/policy.yml`; offer core-label bootstrap (see `_shared/work-record.md`'s Label taxonomy table for current per-family and total counts) | Step 17 |
| GitHub remote | Created `{owner}/{name}` ({visibility}) and set as `origin` (only if Step 9 ran and the user confirmed creation) | Step 9 |
| Cloud parity | Declared {N} plugin(s) in .claude/settings.json#enabledPlugins; wrote scripts/claude-cloud-setup.sh; wrote CLAUDE.md's Cloud parity section | Step 14 |
| Routines | Instantiated {N} routine(s): `{list}` (or "Offered, none set up") | Step 15 |
| Routine re-sync | Re-synced {M} drifted routine(s) to their current templates: `{list}` (Update Mode only) | Update Mode |
| Worktree policy | Set `worktree-always: {true/false}` in `.claude-tweaks/policy.yml` (only if Step 6 asked this run) — written last, after every other row above, to avoid mid-run self-lockout; see "Worktree Policy Finalization" below | Step 6 |
| Classification | Confirmed maturity `{value}` (written to `.claude-tweaks/policy.yml` as `project-maturity`), doc tier `{N}` | Phase 3 |
| CLAUDE.md | Wrote {N} lines (Initial) / Applied {N} patches (Update) | Phase 5 |
| Skills | Generated {N} SKILL.md files: `{list}` | Phase 6 |
| Rules | Created {N} path-scoped rules in `.claude/rules/` | Phase 7 |
| Journeys | Wrote {N} skeleton journey files (or delegated to `/visual-review discover`) | Phase 8 |
| Doc registry | Created `docs/REGISTRY.md` with {N} entries | Phase 8.5 |
| Backlog | Added {N} work records (deferred skills, pain points, doc work, skeleton enrichment) | Phases 4-8.5 |

Execute only after user confirmation.
