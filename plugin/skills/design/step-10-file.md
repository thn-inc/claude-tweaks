# Step 10: File

Loaded by `/claude-tweaks:design` when `status` resumes at step 10.

The approved parts become issues, filed by `/claude-tweaks:specify` and nothing else. `action: 'continue'` → run section 1 again, then go on at section 2: filing skips every part already marked `owner/name#N`.

## 1. Check the approval

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/design-session.js" check-approval --folder "{folder}"
```

Exit 1 → stop and show the `reason` it printed, then run step 9 again (`not-approved`, `digest-mismatch`) or fix the parts in step 8 (`no-parts`, `invalid-parts`). On `no-repository`, run it again with `--repository {owner/name}` when the session knows this checkout's repository (`gh repo view --json nameWithOwner -q .nameWithOwner`, or the cloud session's repository); otherwise stop and say so. Exit 2 → stop and show stderr.

## 2. File

On exit 0, invoke `/claude-tweaks:specify {design.md path}` with the Skill tool, `{design.md path}` being the repository-relative path of `design.md`. Decomposition files the parts as written, marks each part's Issue cell and keeps the folder.

Then run `parts --folder "{folder}"` and check every part carries an Issue mark. A part without one → say which, and run section 2 again.

## 3. Write

```
## Filing
Status: done
Parent: {record ref}
```

`{record ref}` is in the backend's own form: `#{N}` under `github-issues`, the record id under `local-files`. A collapse to one part writes `Parent: none — one part`. Append the filing to `## Decisions` (`by: model`).

## 4. Parts for another repository

A part marked `left for {owner/name}` belongs to that repository. Tell the maintainer to commit this folder, copy it as committed into the same path of that repository's checkout, and run `/claude-tweaks:design {argument}` there. `status` resumes at step 10, which files only that repository's parts, skips the parts already marked `owner/name#N`, and rewrites the symbolic blockers in the earlier repository's issues.

Then run `status`, remind the maintainer that the folder is uncommitted, and render SKILL.md's `## Next Actions`.
