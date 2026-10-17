# Common Step 7: Handoff Template

Loaded by `/claude-tweaks:build` Common Step 7 at end-of-build to render the user-facing handoff.

Render the markdown below, substituting placeholders. Generate field values from: `git log --oneline -n 20` since build start (a build producing more than 20 commits is unusual — widen the count only if the handoff genuinely needs to cite a commit older than that), `git diff --stat` against pre-build state, ledger entries with status `fixed`, journey files from Step 6, operational fixes from Step 5.5.

```markdown
## Build Complete: {record reference and title OR design doc topic}

### Mode
{Record mode (#{n}) | Design mode ({design doc filename})}

### Verification
- Type check: {pass/fail}
- Lint: {pass/fail}
- Tests: {pass/fail}

### What was built
- {summary of implemented features}

### Code simplification
- {summary of simplifications made, or "No changes needed"}

### User Journeys
- {created/updated journey name} — {summary of what changed}
(or: No user-facing journeys affected.)

### Documentation
- Updated: {doc} ({what changed})
- Flagged for wrap-up: {doc} ({reason})
(or: No documentation changes needed.)

### Blocked items (if any)
- {item} — blocked by {reason}

### SDD rulings (standalone build, if any)
- {one-liner} — ledger #{item} (open; `Accept` = ratify, `Keep`/`Defer` = reverse at a standalone `/claude-tweaks:wrap-up`)
(or omit this section: no `Ruling:` line survived SDD's Finish, or a run directory exists — the Review Console carries them as `staged/sdd-ruling-{N}.md` instead.)

### Manual Steps Required
| # | What | Where |
|---|------|-------|
| 1 | {description} | {spec section / detected in `{file}`} |
(or: No manual steps — nothing to do outside the codebase.)

### Skipped steps
- {step name} — condition: {condition that fired} → fallback: {fallback taken}
(or omit this section: every conditional step ran, or a run directory exists — see below.)
```

> Populated from ledger entries with phase `ops`. **In `/flow` pipeline context:** Skip this section — flow's pipeline summary handles it.

**Skipped steps section — the no-run-dir carrier.** (`integration-model` in the rendered example below is the policy key `_shared/integration-model.md` defines.) This section is the standalone counterpart to a `SKIP` entry in `decisions.md` (`_shared/auto-decision-log.md`'s degrade-trace rule): when `$PIPELINE_RUN_DIR` resolves, every documented conditional action that skips or degrades writes there instead, and this section is omitted entirely — the Review Console is the reader, not this handoff. Render this section only for a standalone `/build` run (no run dir) that hit at least one documented conditional action's skip/degrade path; omit it when every such step ran normally. One line per skip, in the same `{step name} — condition: … → fallback: …` shape the `SKIP` entry itself uses, so a reader can trace either form back to the same rule. Rendered example (a standalone backend build, non-frontend surface, `local-merge`):

```markdown
### Skipped steps
- Common Step 1.7 (Design Pre-Build) — condition: surface=backend, not web/mobile/desktop/terminal → fallback: no design pre-load
- Common Step 5.5 (Operational Checklist) — condition: no schema/env/IaC/CI/platform-config files in diff → fallback: no operational checklist run
- Spec Step 1 (draft-PR bootstrap) — condition: integration-model=local-merge → fallback: no draft PR opened
```

### Actions Performed table

| Action | Detail | Ref |
|--------|--------|-----|
| Implemented | {feature} — `{file}` | `{hash}` |
| Bug fix | {what was fixed} — `{file}` | `{hash}` |
| Simplified | {what} — `{file}` | `{hash}` |
| Operational | {schema push, env update} | `{hash}` |
| Journey | {created/updated} {name} — `{file}` | `{hash}` |
| Ledger fix | {item} ({phase}) — `{file}` | `{hash}` |
