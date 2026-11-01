# Tidy — Digest Sweep

The digest sweep's procedures, kept in their own lazy-load unit so `SKILL.md` keeps only a
short trigger paragraph pointing here.

The dispatcher reads this file **whole** and inlines it into the relevant agent's prompt when this
sweep is in scope (an unscoped run, or `--scope=backlog`/`--scope=github` per the driver the
digest container lives on); subagents cannot read sibling files, so everything the sweep needs is
here or in the `_shared/` fragments this file names for the dispatcher to inline alongside it.

---

## Digest sweep (Step 5.6)

**Resume an unfinished rollover.** `github-issues` only. Before the no-op check below, list the open issues that carry a marker line: `gh issue list --state open --limit {window} --json number,body --jq '.[] | select(.body | test("(?m)^<!-- digest-rollover-of: [0-9]+ -->\\s*$")) | .number'`, no `--search`, `{window}` sized per `_shared/github-write-transport.md`'s "Sizing the list-then-filter window". On MCP that file's `list_issues` form (`state: OPEN`, `perPage: {window}`) pages the same list, and the filter is applied client-side to each body. The filter prints numbers only, so a sweep never prints every issue body. A title alone never identifies a replacement. Read each printed candidate's body (`gh api repos/{owner}/{repo}/issues/{n} --jq .body`, `issue_read` get mode on MCP): its marker line names `{old}`. For each distinct `{old}`, run the verdict over every issue naming it, in one call, never a pre-selected one: the trust check and the lowest-numbered pick happen inside it.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/digest-rollover.js" verdict --old {old} --candidates {n},{n}
```

Exit 2 means `gh` is absent: read `{old}` and each candidate with `issue_read` get mode, Write `{old}` as one object and the candidates as one flat JSON array to the paths `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value digest-resume-old.json` and `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value digest-resume-candidates.json` print, and run this instead:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/digest-rollover.js" verdict --old-json "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value digest-resume-old.json)" --candidates-json "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value digest-resume-candidates.json)"
```

Any other non-zero exit is an unreadable pair: name `{old}` in the sweep report with its candidates, and that pair gets no action.

Every working path in this section resolves this way, through `bin/session-tmp-resolve.js --value` (`_shared/session-tmp-root.md`), and each name is distinct from `/claude-tweaks:specify`'s `$CANDIDATES`. A Bash call is its own shell, so each fence that uses a variable sets it first.

`resume` is a rollover a failure interrupted, whichever step it reached: propose finishing it with the `Rollover digest container` action, whatever the comment count, using the printed `replacement`. An interrupted rollover at 100 comments or more also meets the threshold below: the two make one `Rollover digest container` row, never two. `stalled` means step 4 stopped between removing the label and adding it, so neither issue holds `digest` while the old issue is still open: it is never resumed automatically. Name both issues in the sweep report as a stalled label move, and list open `digest` issues first (`gh issue list --label digest --state open --json number`): a routing skill may have bootstrapped one while the label was off, and adding the label beside it would leave two. Name each one found with step 4's stranded-issue handling, to run before the add, then `gh issue edit {replacement} --add-label digest` as the command that lets the next sweep finish the rollover. `finished` means the old issue closed and the replacement holds the label, but an interruption can still have stopped before the post-close recount: re-run step 2's `carry` against the closed issue, and propose finishing when `verified` is `false` or `extras` is non-empty. `none` needs nothing, and that includes an earlier generation: a replacement keeps its marker for good, so once a later rollover has moved the label on, the closed pair reads `none`. A `none` printing `orphan: {n}` needs one check: `{n}` is a trusted open replacement of a closed old issue, with neither labeled, which is what a person closing the old issue during an interrupted move leaves behind. Skip an orphan that another pair reports as `stalled` or `resume`, as its `{old}` or its `replacement`: a second-generation stall prints it on the earlier pair while the later pair names it correctly, and a second report would call a stalled move hand-orphaned. List open `digest` issues, and when none exists name `{n}` and `{old}` in the sweep report for a human. Never re-label it here, since a later generation looks the same otherwise.

No-ops silently when no open `digest`-labeled issue exists (`work-backend: github-issues`) or
`specs/digest.md` doesn't exist (`work-backend: local-files`) — nothing has routed yet (#1262 has
not landed, or no below-floor finding has fired since it did). Four procedures run in order
against whatever container exists, per `_shared/materiality-floor.md`'s Container section. Every
output below routes through `SKILL.md`'s Action Vocabulary (`Merge-close duplicate digest`,
`Propose digest cluster`, `Expiry summary`, `Rollover digest container`) and `step-6-auto.md`'s
matching tier rows — none of these bypasses Step 6/7.

### Bootstrap-race repair

When more than one open `digest`-labeled issue exists (a creation race in
`_shared/materiality-floor.md`'s lazy bootstrap), merge the newer issue's trusted comments into the older
(in creation order) and close the newer with a comment pointing at the surviving issue — the
`Merge-close duplicate digest` action, Stage at every tier (`step-6-auto.md`). Runs before
promotion/expiry below, since both need a single container to operate against. No analogous race
exists on `work-backend: local-files` (single-writer backend) — skip this procedure there.

### Cluster promotion

Read every active entry line (no trailing marker — neither a promotion `→ {id}` nor an expiry
`→ expired`) from trusted content only. On `github-issues` that is the digest issue's comment
*objects* (`gh issue view {n} --json comments`) filtered to author association `OWNER`, `MEMBER`, or
`COLLABORATOR` (`_shared/pr-run-comments.md`'s Trusted authors) — filter the objects, never reduce
them to bare bodies first, since promotion and expiry edit entry lines by comment `url`/`id` and
read `createdAt` for the expiry timestamp fallback. Add this select to the comment iteration
(`.comments[] | …`):

```
select((.authorAssociation // .author_association) == "OWNER" or (.authorAssociation // .author_association) == "MEMBER" or (.authorAssociation // .author_association) == "COLLABORATOR")
```

and run this note filter alongside it — already prefixed with the marker select, so only a skipped
comment carrying a marker is named — to name each one in one line in the sweep report:

```
select(.body | contains("<!-- materiality-fingerprint:")) | select(((.authorAssociation // .author_association) == "OWNER" or (.authorAssociation // .author_association) == "MEMBER" or (.authorAssociation // .author_association) == "COLLABORATOR") | not) | "skipped marker comment \(.url // .html_url // .id // "unknown") by \(.author.login // .user.login // "unknown") (\(.authorAssociation // .author_association // "no association")) — not an owner, member, or collaborator"
```

(Code callers get the same two filters from `trustedMaterialityTexts(comments)` in
`bin/lib/health-core/materiality-digest.js`; its `.texts` are bare bodies without the per-comment
`url`/`id`/`createdAt` this sweep needs, so use it for dedup, not for this read.) On `local-files`
it is the body. An entry line in any other comment is never counted, promoted, or expired, so a
planted entry line can neither inflate a cluster to the ≥3 threshold nor be expired. Entry lines
follow `_shared/materiality-floor.md`'s entry format. Group by `{area}` (the entry format's first field).
A re-encountered finding never produces a second active line to read here in the first place —
`_shared/materiality-floor.md`'s Dedup section has every routing skill check
`isMaterialityDuplicate` before appending, so this sweep's own count is never inflated by
repeated firings of one recurring finding.
When **3 or more** un-promoted entry lines share the same `{area}`, propose one spec-shaped issue
absorbing them — each entry becomes one Deliverables bullet, the cluster's shared `{area}` becomes
the proposal's title subject. Present the proposal per this project's standard staged-item flow
(`{run-dir}/staged/digest-promotion-{n}.md`, staged through `step-6-auto.md`'s `stage-item.js` call with
`--id "digest-promotion-{n}"`) — the `Propose digest cluster` action, Stage at every
tier (`step-6-auto.md`).

On approval: file the proposed record, then append `→ {id}` to each promoted entry **line** in the
container — `→ #{n}` under `work-backend: github-issues`, `→ {n}` under `work-backend: local-files`
(this project's `#`-optional record-reference convention, `_shared/work-record.md`). Markers and
counting are strictly per-line, never per-comment, since one comment can hold many entries from one
run.

Individual entries — including solitary ones that never cluster — remain manually promotable or
re-filable at any time; the ≥3 threshold gates only this sweep's own automatic *proposals*, never a
human's ability to act on a single entry directly.

### Expiry

Expiry operates on the same trusted active set as Cluster promotion above: an entry line in an
untrusted comment is never expired and never marked `→ expired`.

Un-promoted entry lines older than 90 days (on `github-issues`, `materialityEntryDate(line, comment.createdAt || comment.created_at)` in `bin/lib/health-core/materiality-digest.js`: a run-id's ISO timestamp from `{provenance}`, else the `<!-- materiality-first-seen: {ISO} -->` marker a rollover stamped, else the comment's timestamp. On `local-files`, the age comes from `{provenance}`'s run-id timestamp, or the edit timestamp when provenance names a skill instead of a run) roll
into one closing summary comment naming every expired entry; those lines then move out of the
active set — the `Expiry summary` action (`step-6-auto.md`: Stage at every tier on `github-issues`,
Auto-apply at moderate+ on `local-files`, a tracked-file edit). An entry whose age cannot be read (on
`github-issues`, `materialityEntryDate` returns `null`; on `local-files`, `{provenance}` parses to
neither date form) is left un-promoted and excluded from this sweep's expiry set — never
guessed at — since the `local-files` Auto-apply path has no staging review to catch a misclassified
age before the file edit lands. On `github-issues`, the summary
comment is the durable record (the entries themselves stay in the closed comment's history —
nothing is deleted); append `→ expired` to each rolled-in entry **line**, the same per-line marker
mechanism Cluster promotion uses above, so a later sweep's "no trailing marker" read excludes it
and never re-summarizes the same entry twice. On `local-files`, no marker is needed — the entry
lines physically move to an `## Archived {YYYY-MM-DD}` section at the bottom of `specs/digest.md`,
which the active-set read already excludes by location.

**Dating a `github-issues` line.** Run the fence below with `{n}` the digest issue. It sets `$EXPIRY_COMMENTS`, saves the paginated read (`gh issue view {n} --json comments --jq .comments`, every page as one flat array) there, and keeps only trusted comments, so a line in a comment the filters above skip is never dated. It prints, per live entry line (`isLiveEntryLine`: an entry-format line with no trailing `→` mark), its date (`null` when unreadable), the comment's `url`, and the line, reading the comment date from `createdAt` (`gh`) or `created_at` (MCP); a line already marked `→ …` never appears, since it is not in the expiry set. A failed read stops the fence before the dating runs. With `gh` absent, join the MCP pages into one flat array (the Container rollover section's paging), Write it to the path the first line sets, and run the fence without its `gh … &&` prefix.

```bash
EXPIRY_COMMENTS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value digest-expiry-comments.json)"
gh issue view {n} --json comments --jq .comments > "$EXPIRY_COMMENTS" && node -e "const fs=require('fs');const {materialityEntryDate,isLiveEntryLine}=require(process.argv[1]+'/bin/lib/health-core/materiality-digest.js');const {isTrustedComment}=require(process.argv[1]+'/bin/lib/issues/comment-trust.js');for(const c of JSON.parse(fs.readFileSync(process.argv[2],'utf8')).filter(isTrustedComment))for(const l of String(c.body).split(/\r?\n/))if(isLiveEntryLine(l)){const d=materialityEntryDate(l,c.createdAt||c.created_at);console.log((d?d.toISOString():'null')+'\t'+(c.url||c.html_url||c.id)+'\t'+l)}" "${CLAUDE_PLUGIN_ROOT}" "$EXPIRY_COMMENTS"
```

### Container rollover

`github-issues` only — a file has no analogous limit. When the digest issue reaches 100 comments, propose the `Rollover digest container` action, Stage at every tier (`step-6-auto.md`). Read the true count from REST, `gh api repos/{owner}/{repo}/issues/{n} --jq .comments` (`issue_read` get mode on MCP). The threshold does two jobs: a rollover compacts promoted and expired lines out of every sweep's read, since a live line moves whole and a marked line moves as markers only, and 100 is where `gh issue list --json comments` truncates, so a reader that slipped onto that form would start missing entries from there on. What compacts is the open container every sweep reads: the `finished` re-check above still reads the closed issue once per sweep for the replacement's whole life, kept because it repairs an interrupted recount.

**Every digest read is paginated.** `gh issue view {n} --json comments --jq .comments` walks every page and prints one flat array, the read `carry` below makes and the shape its planner takes. On MCP, `issue_read` in `get_comments` mode needs `perPage: 100`, then `page` 2, 3, … until a page returns fewer than 100, joined into one flat array. Never `gh issue list --json comments` for this container.

On approval, read everything fresh, since the proposal holds no copy of the entries. Apply after any `Propose digest cluster` or `Expiry summary` approved in the same run, so their markers land before the carry reads them. A proposal of either kind approved after a rollover marks the carried copy in the current container, never the closed issue's line. Each step below is safe to re-run from the top, and a re-run converges by fingerprint. The pointer comment (step 4) and the summary comment (step 6) each open with a line `<!-- digest-rollover-to: {replacement} -->` and post only when the issue's trusted comments (the paginated read above) lack it, and a close is skipped on an issue already closed, so a re-run posts nothing twice and closes nothing twice:

1. **Create the replacement** without the `digest` label, unless it already exists. Re-list immediately before creating, since a retry or a second session may have made one: run the **Resume an unfinished rollover** list and its `verdict` over every issue naming `{old}`. A bare list proves nothing, because the verdict's trust check is what makes an issue the replacement. Take the printed `replacement` and `extras`, and no issue naming `{old}` or a `none` verdict means create one. The lowest-numbered match is the printed `replacement`, and the printed `extras` are closed in step 4. Title it `{old title} (continues #{old})`, dropping any earlier `(continues #…)` suffix from `{old title}`. Its body's first line is exactly `<!-- digest-rollover-of: {old} -->`, followed by a sentence saying it is a digest container continuing `#{old}`. Then read the created issue's `author_association` (`gh api repos/{owner}/{repo}/issues/{replacement} --jq .author_association`, `issue_read` get mode on MCP). On anything but `OWNER`, `MEMBER` or `COLLABORATOR`, close that issue so a re-approved rollover does not leave another stray (`gh issue comment {replacement} --body "This issue was created by an identity whose marker the sweep does not trust, so the rollover did not proceed."`, then `gh issue close {replacement} --reason "not planned"`; `add_issue_comment`, then `issue_write` with `state: closed` and `state_reason: not_planned` on MCP), then stop here and say so in the report, naming the issue: the running identity's marker and comments are untrusted, so the new side reads empty and every attempt would create another replacement.
2. **Carry.** Run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/digest-rollover.js" carry --old {old} --new {replacement}
   ```

   It reads both issues' comments and the old issue's true count, plans, writes each body to a file and prints the plan as one JSON line. Exit 2 means `gh` is absent: page both issues' comments as above, Write each joined array to the path `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value digest-carry-old.json` or `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value digest-carry-new.json` prints, read the old issue's true count as `{count}`, take the number of comments in the replacement's joined array as `{newCount}`, and run this instead:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/digest-rollover.js" carry --old {old} --new {replacement} --count {count} --new-count {newCount} --old-json "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value digest-carry-old.json)" --new-json "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value digest-carry-new.json)"
   ```

   Any other non-zero exit is a refused read: a failed call, or a paged, wrapped, malformed or short array, never an empty plan. Re-read and re-run; it is never `live: 0`. A refusal naming `--new-count` means the replacement's comments were paged short: re-page them. A digest issue with zero comments has nothing to carry: a true count of 0 prints `empty: true` and `verified: true` with nothing to post. Otherwise post each printed `paths` file to the replacement (`gh issue comment {replacement} --body-file "{path}"`), and apply each printed `edits` entry with `gh api -X PATCH repos/{owner}/{repo}/issues/comments/{commentId} -F body=@"{path}"`: a line promoted or expired on the old issue during an interruption gets the same mark on its carried copy, and a key still live on the old issue gets no edit. `_shared/github-write-transport.md` has no MCP row for a comment edit, so with `gh` absent report the pending edits and stop at step 3's mismatch. The planner selects trusted lines only, sharing `isTrustedComment`, so a planted line is never carried, and it leaves out what the replacement already holds, so a re-run never posts anything twice. Name each `skipped` note in the sweep report, and `unfingerprintedMarked`: a marked line with no fingerprint has nothing to carry. Name a non-zero `unparsedEntryLines` with its count too: those `- [` lines parse as no entry and carry no marker, so they are not carried and do not affect `verified`, and a person can look at them before the old issue is closed. A carried line keeps its text, fingerprint and provenance, plus a `materiality-first-seen` marker holding its comment's timestamp, so expiry's age read survives the move. A promoted or expired entry moves as a fingerprint-only tombstone: its `materiality-fingerprint` and `consolebackfill-item` markers with no entry line, split across comments as needed. `isMaterialityDuplicate` and console backfill's held check read it and the active-set read ignores it, so a rollover never changes which findings dedup suppresses.
3. **Verify the count.** Re-run `carry`, which compares both the live-entry count and the tombstone count against the old issue. Continue only when `verified` is `true`. A mismatch stops here: the issue being carried keeps every entry and nothing closes, and the report names the numbers.
4. **Move the label.** Read both issues' labels first, since `gh issue edit --remove-label` on an absent label fails the whole edit. Handle a stranded issue, one the move would leave open beside the replacement, by running steps 2 and 3 with it as the old side, then closing it, unless it is already closed, with a pointer comment naming the replacement and opening with the `<!-- digest-rollover-to: {replacement} -->` line. Handle every `extras` issue from step 1 first, so the label stays on while they carry. Remove `digest` from the old issue next, if it holds it, then add it to the replacement, if it lacks it, so two open `digest` issues never exist for bootstrap-race repair to merge. Before the add, list open `digest` issues and handle any that appeared while the label was off (a routing skill's lazy bootstrap): only those are handled inside the window. A title alone never gives an issue the label: only the replacement step 1 identified, the verdict's printed `replacement` or the issue it just created, gets it. Unpin the old issue and pin the replacement. A pin failure is reported and never stops the rollover, since no reader keys on the pin.
5. **Catch late appends.** A router that read the label before step 4 may have posted to the old issue, and a staged approval may have marked it. Re-run steps 2 and 3 once more.
6. **Close the old issue.** Take `{C}` from the `count` that step 5's last `carry` printed, the count its verified read saw, so an append after that read is not hidden. Post a summary comment stating both carried counts and pointing at the replacement, opening with the `<!-- digest-rollover-to: {replacement} -->` line, adding 1 to `{C}` when this pass posts it, then close the issue. On an issue already closed, skip the close and go to the recount. Its comment history stays the archive for everything it held, marked lines and non-entry notes included. Re-read its true comment count: if it rose above `{C}`, a router posted after the last read, so run steps 2 and 3 with the closed issue as the old side, and name any gap that remains in the report.
