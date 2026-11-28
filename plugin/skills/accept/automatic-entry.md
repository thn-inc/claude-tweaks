# Accept — Automatic Entry

The non-interactive entry of `/claude-tweaks:accept`. `wrap-up/verification-brief.md` Step 4 reads
this file on its no-parent path, for the five sub-issue call sites in its Routing table. It arrives
holding the record number `{n}`, the packet body file Step 4 rendered (`{PACKET}`), the run's
`{pr-number}` when `run-state.json` carries a `pr` object, the Oversight-floor gate's result, and
the work backend. The tidy parent row and every parent-linked record never reach this file: they
keep the Parent-Gate Procedure, unchanged, until the feature-level-acceptance record.

This file never prompts, never asks the human for a decision, never walks the packet's guide and
never waits on anyone. It returns to its caller after step 5 whatever happened, so a pipeline run
gains no stop. Walking the packet and taking the human's decision belong to the on-demand entry.

**The label is owed** only when step 2 prints `apply-pending` **and** the caller's Oversight-floor
gate returned `exceeds: true`. Below the floor the packet still lands, with no label (Decision Q5,
`_shared/acceptance-packet.md`).

Resolve the session-temp paths as its own call (`_shared/session-tmp-root.md`), and paste each
printed path where a call below names `{LABELS}` or `{EXISTING}`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" LABELS=accept-labels-{n}.json EXISTING=accept-existing-{n}.md
```

1. **Fetch the labels**, as its own Bash call:

   ```bash
   gh issue view {n} --json labels > "{LABELS}"
   ```

   `work-backend: local-files`: read the record's `acceptance:` facet instead (`readRecord`,
   `bin/lib/issues/local-store.js`; unset is the empty value). A failed fetch skips step 2 and owes
   no label; steps 3 and 4 still run, so a missing packet still lands.
2. **Decide the label**, as its own Bash call:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/accept-entry.js" auto-label --labels-json "{LABELS}"
   ```

   `local-files`: pass `--acceptance-facet "{facet}"` in place of `--labels-json`, pasting the facet
   only when it is `pending`, `approved`, `changes-requested` or empty, and otherwise treating the
   action as `none`. It prints one line, `{"action":"apply-pending"}` when the record carries no
   acceptance label of either vocabulary, else `{"action":"none"}`: any pending or verdict label,
   `demo:*` or `accept:*`, the precedence `dispositionState` reads (`bin/lib/issues/acceptance.js`).
   A non-zero exit reads as `none`.
3. **Read the packet**, as its own Bash call:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/accept-entry.js" read --record {n} --out "{EXISTING}"
   ```

   It prints one line whose `status` is `found`, `unreadable` or `none` (the earliest trusted packet
   comment wins, per `_shared/acceptance-packet.md`'s Reader rules). `local-files`: the record body's
   block between `<!-- acceptance-packet:start -->` and `<!-- acceptance-packet:end -->` reads as
   `found` when present and as `none` when absent.
4. **Post only a missing packet**, routing on that `status`:
   - `status: none` — post the rendered packet, as its own Bash call:

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/bin/acceptance-packet.js" post --record {n} --body-file "{PACKET}"
     ```

     Append `--label accept:pending` only when the label is owed, and `--pr {pr-number}` only when
     the run has a PR; otherwise run it as shown. `local-files` (`{record-file}` per the caller's
     Post paragraph), appending `--pending` only when the label is owed:

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/bin/acceptance-packet.js" local --record-file "{record-file}" --body-file "{PACKET}"
     ```

     Route the exit code and result line as the caller's Post paragraph does (exit 0, 1, 2 and 4).
   - `status: found` or `unreadable` — no post at all, so an existing packet and every human edit to
     it stay as they are. When the label is owed, bootstrap `accept:pending` with
     `_shared/label-bootstrap.md`'s check-then-create loop (its canonical row), then add the label
     alone, as its own Bash call:

     ```bash
     gh issue edit {n} --add-label accept:pending
     ```

     `local-files`: set `facets.acceptance = 'pending'` via `writeRecord`. A failed edit is logged as
     one `SKIP` line (step 5), and the packet stays.
   - A failed `read` (any non-zero exit) — no post and no label: posting blind could add a second
     packet. One `SKIP` line names it (step 5).
5. **Return.** When a run directory resolves, log each failure above as one `SKIP` line through the
   caller's **Log a stop or a failure** call, its text reading `condition: automatic entry {labels |
   auto-label | read | post | local | label} failed ({stderr line}) → fallback: {what happened to the
   packet and the label}`. Then return to the caller, whose next step runs in this same turn.

**`gh` absent** (`_shared/github-write-transport.md`'s Detection, `github-issues` only): run the same
five steps on the MCP transport (`_shared/acceptance-packet.md`'s MCP transport, Decision Q4).
Step 1 reads the labels with `issue_read` (`get_labels`) and writes them to `{LABELS}` with the
Write tool. Step 3 reads the comments with `issue_read` (`get_comments`) and applies `readPacket`'s
rules (`_shared/acceptance-packet.md`'s `## Canonical copy and lookup`); a failed read is the failed
`read` branch. A missing packet is sent with `add_issue_comment`, per `_shared/github-write-transport.md`'s
Marker comments on the MCP path; an existing or unreadable one is never sent again. An owed label
goes through `issue_write`'s read-merge-write (that file's Full-replace hazard) in either case.

On the missing-packet branch, the MCP path makes the writes `post` would. A failed
`add_issue_comment` is the failed `post` branch, and it clears the pending label: `issue_read`
(`get_labels`) immediately before the write, then, only when `demo:pending` or `accept:pending` is
present, `issue_write` with the complete array `mergeLabelNames` computes, and no write when
neither is present. A failed clearing adds a needs-human line naming the pending label still on
the record. After the comment lands and the owed label is written, when the run has a PR, read its
body with `pull_request_read` and link the packet through MCP `update_pull_request`, matching
`publishPacket`'s `replacePacketLine`: replace this record's existing `Acceptance packet:` line (a
single url on the same `/issues/{n}#`; another record's line stays) with
`Acceptance packet: {comment url}`, append that line after a blank line when the body has none,
and write nothing when the body already reads that way. A failed label write leaves the packet in
place and skips the PR line, reported as the `gh` path's `labelApplied: false` is. A failed PR-line
write does not fail the publish, reported as the `gh` path's `prLink` with `ok: false` is.
