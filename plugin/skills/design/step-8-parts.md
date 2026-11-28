# Step 8: Parts

Loaded by `/claude-tweaks:design` when `status` resumes at step 8.

Split the chosen approach into the parts that become issues, with the maintainer. `action: 'continue'` → read the partial `## Parts` and pick up where it stopped.

## 1. Work out the parts

Add `## Parts` after `## Builder check`, with `Status: in-progress`. From the chosen approach and the storyboard, work out the parts with the maintainer: each part is one unit a builder can plan and ship, and the part that makes the order visible to a user goes last. A part for another repository names it in Repository.

Write them in the table `bin/lib/design-session/parts.js`'s header comment defines — columns, sizes, `Waits for` entries, Issue marks. That header is the one definition; this step never restates it.

## 2. Check

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/design-session.js" parts --folder "{folder}"
```

Exit 1 → fix every reported error until it exits 0. Exit 2 → stop and show stderr. On exit 0 write `estimate.line` under the table exactly as printed.

## 3. Confirm

Show the table and the estimate. Ask in a plain message whether the parts are right; change them until the maintainer says so. Append the parts decision to `## Decisions` (`by: maintainer`), set `Status: done`, then run `status` and continue.
