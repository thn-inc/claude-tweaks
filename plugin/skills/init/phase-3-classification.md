# Phase 3: Project Classification Gate

Loaded by `/init` Phase 3 after presenting the Stack Profile (Initial Mode) or Drift Report (Update Mode). Contains the unified Project Classification gate, confidence-gated auto-confirm logic, and the interactive confirmation template.

## Determine doc tier

Use the heuristics from `docs-structure.md` in this skill's directory, combining Phase 2 reconnaissance findings with the detected maturity.

## Compute detection confidence

For each dimension (maturity, doc-tier), rate the signal strength:

| Confidence | Criteria |
|-----------|----------|
| `high` | ≥3 strong consistent signals |
| `med` | 1-2 consistent signals, no contradictions |
| `low` | contradictory or sparse signals |

## Auto mode (confidence-gated)

When `auto` mode is set AND both dimensions classify with confidence `high` AND signals are internally consistent:

1. Auto-confirm the detected classification
2. Log to the active pipeline's `decisions.md` using the resolution order in `_shared/run-dir-resolution.md`. `/init` is on the standalone-auto allowlist — if `PIPELINE_RUN_DIR` is unset and no recent run matches, create a standalone run dir at `.claude-tweaks/pipelines/{ISO-timestamp}-init-standalone/` and append the entry there. Never suppress the audit-log write.
   ```
   AUTO {time} — Phase 3: classification auto-confirmed. Maturity: {value} (confidence: high). Doc tier: {value} (confidence: high). Proceed to Phase 4.
   ```
3. Print a one-line summary (not a prompt): "Classified as {maturity}, doc tier {N}. Proceeding."
4. Write the confirmed maturity to `.claude-tweaks/policy.yml` — see "Writing project-maturity to policy.yml" below.
5. Skip to Phase 4

Auto-confirm is **forbidden** when either dimension is `med` or `low` confidence, OR when signals contradict (e.g., greenfield code + production-grade infra). In those cases, fall through to the confirmation gate (KEPT-PROMPT).

## Confirmation gate (interactive mode OR auto with low confidence)

**Present for confirmation:**

```
### Project Classification

Based on codebase analysis:

| Dimension | Detected | Confidence | Rationale |
|-----------|----------|-----------|-----------|
| Maturity | {greenfield/pre-launch/early-production/established} | {high/med/low} | {key signals: age, infra, users, migrations} |
| Doc tier | {1/2/3} | {high/med/low} | {key signals: project size, API surfaces, team size} |

### Philosophy (derived from maturity)
- Change philosophy: {e.g., "Move fast, refactor freely" / "Expand-contract, safe migrations"}
- Schema management: {e.g., "Push directly" / "Migrations with rollback plans"}
- Backward compatibility: {e.g., "Not required" / "Required for published interfaces"}
- Dependencies: {e.g., "Latest versions, update aggressively" / "Pin versions, upgrade deliberately"}

### Doc Structure (derived from tier)
- {list of docs that will be proposed in Phase 8.5, based on tier + what exists}
```

**Call `AskUserQuestion`:**

- `question`: `"Confirm this project classification (maturity + doc tier), or override before it drives CLAUDE.md philosophy and doc structure?"`, `header`: `"Classification"`, `multiSelect`: `false`
- Option 1 — `label`: `"Confirm (Recommended)"`, `description`: `"Accept the detected maturity and doc tier as shown above."`
- Option 2 — `label`: `"Override maturity"`, `description`: `"Change the detected maturity — changes the derived philosophy."`
- Option 3 — `label`: `"Override doc tier"`, `description`: `"Change the detected doc tier — changes the derived doc structure."`
- Option 4 — `label`: `"Override both"`, `description`: `"Change both maturity and doc tier."`

Wait for confirmation. The user may know things the code doesn't reveal (e.g., "this is 6 months old but we haven't launched yet — treat it as pre-launch"). Carry the confirmed maturity and doc tier forward to Phase 5 (CLAUDE.md Philosophy) and Phase 8.5 (Doc Registry). Also write the confirmed maturity to `.claude-tweaks/policy.yml` — see "Writing project-maturity to policy.yml" below.

## Writing project-maturity to policy.yml

Once classification is confirmed (either the auto-confirm path above or the interactive gate), write it as a durable config value — `project-maturity` is a project fact other skills (`/claude-tweaks:build`, `/claude-tweaks:specify`) read directly, not just Phase 5 Philosophy-prose input. Unlike `worktree-always` (see `SKILL.md`'s "Finalizing the worktree-always Decision"), this write has no self-lock risk — turning it on mid-run can't deny this same run's own remaining writes the way enabling worktree enforcement can — so it happens immediately here rather than being deferred to Phase 9.

Create `.claude-tweaks/` if it doesn't exist. Read `.claude-tweaks/policy.yml` if present; if it has an existing `project-maturity:` line, replace that line, otherwise append a new `project-maturity: {value}` line (create the file with just that line if it didn't exist). Preserve every other line in the file untouched.

```yaml
project-maturity: established   # greenfield | pre-launch | early-production | established
```
