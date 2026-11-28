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

Then run `parts --folder "{folder}"` and check every part carries an Issue mark and none is still marked `left for` this checkout's repository. A part that fails → say which, and run section 2 again.

## 3. Write

```
## Filing
Status: done
Parent: {owner/name}#{N}
```

Every `Parent:` line is repository-qualified, in the same form as the filed marks: `{owner/name}` is this checkout's repository (`check-approval`'s `thisRepository`), and `{N}` the parent's issue number under `github-issues` or its record id under `local-files`. There is one line per repository: a later repository's run keeps the earlier lines and adds its own below them. A collapse to one part writes `Parent: {owner/name} — none, one part`. Append the filing to `## Decisions` (`by: model`).

## 4. Parts for another repository

A part marked `left for {owner/name}` belongs to that repository. `/claude-tweaks:specify`'s Step 9 committed this folder, its marks included; the copy for that repository is taken from that commit. Tell the maintainer to copy the folder as committed into the same path of that repository's checkout and run `/claude-tweaks:design {argument}` there. `status` there reads that repository, so the part marked `left for` it keeps step 10 open: it resumes at step 10, which files only that repository's parts, skips the parts already marked `owner/name#N`, and rewrites the symbolic blockers in the earlier repository's issues.

Then run `status` (with `--repository {owner/name}` when section 1 passed it to `check-approval`) and render SKILL.md's `## Next Actions`.
