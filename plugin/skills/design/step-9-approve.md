# Step 9: Approve

Loaded by `/claude-tweaks:design` when `status` resumes at step 9, with `action: 'start'`, `'continue'` or `'reapprove'`.

The maintainer approves what will be filed: the frame, the chosen approach, the parts and the estimate.

## 1. Show and ask

Show the `## Frame`, the chosen way from `## Approaches`, the `## Parts` table and its estimate. Ask with one `AskUserQuestion`: `Approve the design, its parts and estimate (Recommended)` — or `Change something first`. Recommend approving, because the parts were just confirmed in step 8 and the filing runs from exactly this text. On `Change something first`, make the change the maintainer names, then ask again.

## 2. Write

On approve, print the digest:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/design-session.js" digest --folder "{folder}"
```

Write `## Approval` after `## Parts`:

```
## Approval
Status: done
Approved: {YYYY-MM-DD} — digest sha256:{digest}
```

Append the approval to `## Decisions` (`by: maintainer`), then run `status` and continue.

## The approval rule

Once approved, the skill changes the frame, the approach or the parts only after asking for a new approval: it first sets the Approval section back to `Status: in-progress` and removes the `Approved:` line, makes the change, then runs this step again. `status`'s `reapprove` action — a `done` Approval whose digest no longer matches, for example after a hand edit — runs this step again the same way, from section 1.
