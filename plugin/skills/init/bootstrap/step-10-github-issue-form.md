# Step 10 — GitHub issue form template (agent-task)

*Optional Enhancement step — see `../SKILL.md`'s `## Input` for when this group is offered or filtered, and `../bootstrap-steps.md` for its ordering and renumbering conventions.*

Offer only when the project has a GitHub-flavored remote — same two-tier check Step 9
documents. Check whether `.github/ISSUE_TEMPLATE/agent-task.yml` exists; if absent,
offer to install it. The form makes human-filed issues work-record-ready at filing time:
its three sections (Current State / Deliverables / Acceptance Criteria) are exactly the
spec-shaped body `_shared/work-record.md` documents — the same three sections
`/claude-tweaks:backlog refine`'s gate re-verifies before granting authorization and
`/claude-tweaks:flow`'s materialization hard gate (`flow/materialize.md`) re-verifies before
build — so a form-filed issue satisfies both checks with zero translation (GitHub renders
the form's labels as `###` headings; the structural check treats any heading level as
satisfying "the section is present").

When this project's `work-types` config key reads `native`, mention to the user that the
filed issue can also carry a native Type — GitHub's own Type picker in the create-issue UI
sits alongside this form (it is not a templated YAML field below), so a filer sets Type
there directly instead of a filing skill inferring it from prose afterward. `work-types`
is only ever written by Step 17's capability probe, so on a fresh bootstrap run (where
this step executes before Step 17 in the file's presented order) it is still unset when
Step 10 runs — the template-install offer itself proceeds regardless (it doesn't depend on
Type), but defer this specific mention: re-check `work-types` once Step 17 completes and
surface the native-Type note then as a short addendum, not a repeat of the whole offer. On
an `/init update` re-run, `work-types` is already set from a prior run, so this step can
check and mention it inline as written, with no deferral needed.

```yaml
name: Agent task
description: File a task an agent pipeline can build directly (claude-tweaks issue-sourced batch)
title: "[task] "
body:
  - type: textarea
    id: current-state
    attributes:
      label: Current State
      description: What exists today, and what is wrong or missing
    validations:
      required: true
  - type: textarea
    id: deliverables
    attributes:
      label: Deliverables
      description: What should exist when this is done
    validations:
      required: true
  - type: textarea
    id: acceptance-criteria
    attributes:
      label: Acceptance Criteria
      description: How to verify it is done
    validations:
      required: true
```

**Label check.** The YAML above applies no top-level `labels:` key (GitHub's
auto-apply-on-create array, distinct from each field's own `label:` attribute above) —
leave it unchanged today. If a future edit adds a `labels:` key naming retired
vocabulary (`backlog`, `code-health`), replace it with the appropriate `by:*` origin
label or drop the key entirely — never ship a template that stamps retired labels onto
newly filed issues by default.

Write the YAML exactly as above to `.github/ISSUE_TEMPLATE/agent-task.yml`. Declining is
fine — freeform issues still work via `/specify`'s own issue-ingestion path (`specify/SKILL.md`
"Resolve the input" case 1 already handles a freeform body with "more editorializing," per
that section); the form just removes the translation judgment.
