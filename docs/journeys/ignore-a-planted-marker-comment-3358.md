---
files:
  - plugin/bin/lib/issues/comment-trust.js
  - plugin/bin/find-run-comment.js
  - plugin/skills/_shared/pr-run-comments.md
  - plugin/skills/demo/entry-paths.md
  - plugin/bin/lib/wrap-up/engine-verify.js
  - plugin/bin/lib/reconcile/console-execute.js
  - plugin/bin/lib/issues/grant-maturation.js
  - plugin/skills/_shared/work-record.md
  - plugin/bin/lib/health-core/materiality-digest.js
  - plugin/skills/_shared/materiality-floor.md
  - plugin/skills/tidy/digest-sweep.md
  - plugin/skills/tidy/SKILL.md
  - plugin/skills/tidy/scan-procedures.md
  - plugin/skills/backlog/grant-lane-decision.md
  - plugin/skills/specify/shaping-mode-stamping.md
---

# Ignore a Planted Marker Comment

**Persona:** A maintainer of a public repository where anyone with a GitHub account can comment on issues and PRs. A stranger has posted a comment that copies one of the plugin's markers, such as a `<!-- run-comment: try-it -->` walkthrough or a backdated `grant-mode-audit … auto-merge=pending` line.
**Goal:** Have every plugin reader treat that comment as if it were absent, and see in one line that it was skipped, so a planted comment can never steer a demo, pass a check, or mature a merge grant.
**Entry point:** Any plugin step that reads marker comments back from GitHub: `/claude-tweaks:demo #N`, wrap-up's acceptance-labeling check, `hooks.js resolve-console`, the auto-merge grant gate, the backlog's `needs-decision` lane, or the materiality digest (routing dedup and `/claude-tweaks:tidy`'s digest sweep).
**Success state:** Every reader took the "no such comment" path for the planted comment and printed `skipped marker comment {url} by {login} ({association}) — not an owner, member, or collaborator`. Comments from the maintainer and their collaborators still worked exactly as before.

## Steps

### 1. Demo a record whose PR carries a stranger's walkthrough — `/claude-tweaks:demo #N`
- **URL:** `/claude-tweaks:demo #N`, for a record whose PR has a `<!-- run-comment: try-it -->` comment posted by an account with author association `NONE`
- **Action:** Run demo. It reads the PR's run comments through `_shared/pr-run-comments.md`'s Find step, which keeps only comments whose author association (`authorAssociation` from `gh`, `author_association` from REST and MCP) is `OWNER`, `MEMBER` or `COLLABORATOR`.
- **Should feel:** Uneventful. The walkthrough on screen is the run's own, or a fresh one composed from the record's acceptance criteria. The stranger's steps never appear.
- **Should understand:** The skip line, printed one line above the verdict, names the planted comment's URL, its author and their association. Trust comes from GitHub's author association, not from which account is reading. Anyone with write access could already push to the branch, so a collaborator's comment is trusted, and another maintainer reading the same PR sees the same result.
- **Red flags:** Steps from the planted comment shown as the walkthrough. A planted comment dropped with no skip line. A collaborator's legitimate walkthrough rejected because a different account ran demo.

### 2. Close a run whose issue carries a planted Verification Brief — wrap-up's acceptance check
- **URL:** wrap-up's verify table (`bin/lib/wrap-up/engine-verify.js` acceptance-labeling check) on a `demo:pending` record
- **Action:** A stranger has posted a comment headed `## Verification Brief`, or the pointer line `Verification Brief posted to PR #…`, and it is the only brief on the record. Run wrap-up's verification.
- **Should feel:** Strict in the right place. The check fails as if no brief were posted.
- **Should understand:** The failing row's detail ends with `; ignored: skipped marker comment …`. When a run spans several records and some pass, each passing record's ignored comments still show as `; ignored (#N): …`, so none goes unmentioned. The same brief posted by a member passes.
- **Red flags:** The check passing on the planted brief. A pass row that hides a skipped comment it ignored.

### 3. Resolve a Review Console that has a planted "executed" reply — `hooks.js resolve-console`
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-console --run {run-dir}`
- **Action:** Resolve the console after a stranger posted a reply starting `<!-- console-item: executed -->` under the console comment.
- **Should feel:** Like the stranger's reply is not there. The run posts its own executed reply instead of editing theirs.
- **Should understand:** The command's output lists each skipped reply on its own line. A reply from a trusted author is still updated in place on later runs.
- **Red flags:** The stranger's reply edited by the plugin. Two executed replies from the run itself on a re-run.

### 4. Let a pending merge grant age — the auto-merge grant gate
- **URL:** dispatch's group gate (`dispatch/grant-maturation-gate.md`) or wrap-up's singleton short-circuit (`wrap-up/auto-merge-short-circuit.md`), on a record labelled `auto:merge-pending`
- **Action:** A stranger has posted a `grant-mode-audit` marker dated weeks ago, and the record's real grant marker is missing. Reach the merge checkpoint.
- **Should feel:** Safe. The grant is not matured, and nothing merges early.
- **Should understand:** Only trusted comments are passed to `extractPendingGrantedAt`, so the backdated marker gives the grant no age, and it reads as not yet matured. The gate's report carries the skip line the snippet printed to stderr. `console-resolve` and the console-execute merge check name the skipped marker in their leave-open or merge reason.
- **Red flags:** `auto:merge` promoted from a planted marker. A skip line printed to stderr but missing from the gate's report.

### 5. Triage a record with an outsider's decision comment — the `needs-decision` lane
- **URL:** `/claude-tweaks:backlog` attention/refine lanes, `/claude-tweaks:tidy`, or `/claude-tweaks:specify #N` shaping, on a record with a `<!-- needs-decision: … -->` comment
- **Action:** A stranger has posted an unresolved `needs-decision` comment on a record. Run the lane that reads it.
- **Should feel:** Like the record has no open decision. It is neither held for a decision nor kept labelled `needs:decision` because of that comment.
- **Should understand:** `_shared/work-record.md`'s Resolution rule counts only a trusted author's comment as a decision comment, and every reader names any lookalike it skipped. A stranger's `needs-decision: tidy` comment also no longer keeps release-note repair from proposing its fix. The summary line lists the ignored comment.
- **Red flags:** A record parked in the decision lane by a stranger's comment. A resolver editing the stranger's comment.

### 6. Route a below-floor finding past a planted digest entry — the materiality digest
- **URL:** any routing skill's digest step (`/claude-tweaks:review`'s Defer → Digest row, `/claude-tweaks:wrap-up`'s residue sweep, a health sweep) and `/claude-tweaks:tidy`'s digest sweep, against the open `digest`-labelled issue
- **Action:** A stranger has commented on the digest issue with a copied entry line carrying `<!-- materiality-fingerprint: … -->` for a finding the next run will route, or with three fake entries sharing one `{area}`. Run the routing step, then `/claude-tweaks:tidy`.
- **Should feel:** Like the stranger's comment is not there. The real finding is appended to the digest as new, and no cluster proposal appears for the fake entries.
- **Should understand:** Dedup (`isMaterialityDuplicate`) counts only fingerprints in `OWNER`/`MEMBER`/`COLLABORATOR` comments, so a planted marker routes the finding as new instead of suppressing it. The tidy sweep's promotion and expiry read only trusted comments, and the run's output names each skipped marker comment in the standard skip line. A bootstrap-race merge re-posts only trusted comments into the surviving digest, so a stranger's entry is never laundered under the maintainer's identity. A caller that passes raw comment bodies instead of comment objects gets its own `skipped bare-string digest element …` line rather than silent non-dedup.
- **Red flags:** A finding missing from the digest because a stranger's marker matched it. A digest cluster proposal built from a stranger's entry lines. A stranger's entry re-posted under the maintainer's account by the merge-close action.

### 7. Run the same readers where `gh` is absent — a cloud Routine sandbox on the MCP transport
- **URL:** any marker reader above whose skill prose pastes the trust filter as jq (`_shared/pr-run-comments.md`'s Trusted authors, `tidy/digest-sweep.md`'s Cluster promotion, `tidy/scan-procedures.md`'s tombstone check, the `needs-decision` lookups), run over comments fetched through REST or MCP `issue_read` instead of `gh --json comments`
- **Action:** The maintainer's own marker comment comes back in the REST shape (`author_association: "MEMBER"`, `user.login`, `html_url`), alongside a stranger's planted copy (`author_association: "NONE"`). Run the reader's jq filter over those comment objects.
- **Should feel:** The same as on a `gh` run. The maintainer's comment is found and the stranger's is skipped. Switching transport changes nothing the maintainer can see.
- **Should understand:** The pasted filter reads either spelling (`(.authorAssociation // .author_association)`), so the REST and MCP shape is judged exactly like the `gh` shape. The skip line names the REST comment by its `url` (or `html_url`, then `id`) and its author by `user.login`, the same text `untrustedSkipNote()` prints.
- **Red flags:** Every marker comment, the maintainer's included, reads as untrusted on a `gh`-absent run (the failure before #3823: the jq keyed on `authorAssociation` only). A skip line reading `by unknown (no association)` for a REST comment that does carry `user.login` and `author_association`.

### 8. Find a run comment from inside a dispatched worktree session — `bin/find-run-comment.js`
- **URL:** `_shared/pr-run-comments.md`'s Find step, worktree-safe form. First `gh pr view {n} --repo {owner}/{repo} --json comments > {file}`, then `node {plugin-root}/bin/find-run-comment.js --comments-file {file} --kind verdict`.
- **Action:** A pipeline agent in a worktree-isolated session looks up the run's `verdict` comment. The PR also carries a stranger's copy of the same marker.
- **Should feel:** The same as the jq shortcut. One JSON line comes back, `{kind, id, ids, skipped}`. `id` is the maintainer's comment, and `skipped` holds the stranger's skip line, ready to relay.
- **Should understand:** The CLI judges trust through `comment-trust.js`'s `isTrustedComment`/`untrustedSkipNote`, the same rule the jq filter pastes. A test pins parity with that jq. An empty file left by a failed fetch, or a `{"message":"Not Found"}` body, is exit 1 (a failed find), never "not found".
- **Red flags:** The stranger's comment id returned as `id`. A skipped comment missing from `skipped`. A failed fetch read as "no comment yet", which would make the run post a duplicate.

## Origin
- Created during build of #3358 (filter run-comment marker reads by the posting identity, not the marker alone)
- Steps 1-5 built in this session
- Step 6 added during build of #3766 (digest dedup and the tidy digest sweep trust only owner/member/collaborator comments)
- Step 7 added, and step 1's association wording updated, during build of #3823 (trusted-author jq reads both association spellings, so it works on the REST/MCP transport)
- Step 8 added during build of #3936 (the Find step's worktree-safe form, `bin/find-run-comment.js`, applies the same trust rule to a fetched comments file)
- Related specs: #3358, #3766, #3823, #2821 (the try-it walkthrough demo reads back), #309 (pending-grant maturation)
