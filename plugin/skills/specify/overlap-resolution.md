# Specify — Decomposition Mode: Overlap Resolution

Loaded from `decomposition-mode.md`'s Step 1 Overlap Analysis (this skill's directory; #2841's
split). Read it only when that analysis classified at least one design-doc section as **Already
exists** or **Partial overlap** — a run whose every section is a **Gap** never loads it. "Above"
in this file means this file's own earlier text (its Auto mode section, its batch table); the
coverage classifications it resolves come from `decomposition-mode.md`'s Overlap Analysis table.

---

### Auto mode (policy lookup)

When a pipeline run directory exists, resolve `overlap` — `OVERLAP=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values --run "$PIPELINE_RUN_DIR" overlap)`. Apply per policy:

| Policy | Action | Log entry |
|---|---|---|
| `companion` (default) | Add a new sub-issue to the Step 2 work-unit set, noting its dependency on the overlapping record — the record itself is created with the rest of the batch in Step 3, and its `Blocked by #N` link is wired in Step 4's linking pass; no separate write here. Reversible — the sub-issue is its own record. | `AUTO {time} — Step 1: overlap "{section}" ↔ record {ref} resolved as companion sub-issue, Blocked by {ref}.` |
| `skip` | Auto-skip — don't create a sub-issue for this section. Note in summary. | `AUTO {time} — Step 1: overlap "{section}" ↔ record {ref} resolved as skip — already covered.` |
| `extend` | Stage as `staged/specify-overlap-{ref}.md` containing the proposed additions to the record's body. NEVER auto-modify an existing record's body — that's not reversible enough. | `STAGED {time} — Step 1: overlap "{section}" ↔ record {ref} requires extending an open record. Stage path: staged/specify-overlap-{ref}.md.` |
| `replace` | Stage as `staged/specify-overlap-{ref}.md`. Replacement is destructive; the user must approve at the Review Console. | `STAGED {time} — Step 1: overlap "{section}" ↔ record {ref} proposed as replacement. Stage path: staged/specify-overlap-{ref}.md.` |

`{ref}` is `#{N}` under `work-backend: github-issues`, the bare record id under `local-files`.

### Interactive mode (batch per-overlap decisions)

Collect ALL overlaps first, then present as one batch table. Per CLAUDE.md, never present per-item prompts when 2+ items can batch — that scales badly when a design doc overlaps with multiple open records.

```
Overlap analysis — {M} overlap(s) found:

| # | Section | Existing record | Coverage | Recommended | Override? |
|---|---------|-----------------|----------|-------------|-----------|
| 1 | "{section A}" | {ref}: "{title}" | Already exists | Skip | (1) skip / (2) extend / (3) companion / (4) replace |
| 2 | "{section B}" | {ref}: "{title}" | Partial overlap | Companion (Recommended) | (1) skip / (2) extend / (3) companion / (4) replace |
| ...|
```

The table renders as markdown, as above. Immediately below it, call `AskUserQuestion` with:

- `question`: `"How do you want to handle these overlaps?"`, `header`: `"Overlaps"`, `multiSelect`: `false`
- Option 1 — `label`: `"Apply all recommended (Recommended)"`, `description`: `"Apply all recommended"`
- Option 2 — `label`: `"Override specific items"`, `description`: `"Tell me which #s to change and to what"`

**Hard gate.** Check the response you are about to send: does it already contain the overlap analysis table above as literal rendered markdown, with a row for every overlap? If not, render it now, in this response, before the tool call — "Apply all recommended" with no table above it leaves the user approving an unnamed set of spec-overlap resolutions.

The recommendation column pre-fills based on coverage type: `Already exists` → Skip; `Partial overlap` → Companion. The user can pick "Apply all recommended" to accept all in one decision, or "Override specific items" and follow up with which #s to change in ordinary free-text conversation. Policy-driven equivalent in auto mode (above).
