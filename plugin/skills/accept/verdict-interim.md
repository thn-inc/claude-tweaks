# Accept Step 3 — Apply Verdicts (interim)

Referenced by `skills/accept/SKILL.md` Step 3. #4614 replaces this file wholesale and deletes it.
Until then these are `/demo`'s verdict mechanics under the `accept:*` labels, for a verdict the
human gives in this session. A verdict given in Dispatch is not handled here, or anywhere in this
skill, until #4614 lands.

For a `#N[,#M...]` batch this step runs per item, immediately after that item's verdict — never
batched across items — so the next ref's Step 1 starts only once this ref's label swap (or
follow-up filing) has landed.

**Label-backed entries** (Step 1's `#N` lookup): bootstrap `accept:pending`, `accept:approved`,
`accept:approved-batch` and `accept:changes-requested` via the check-then-create loop from
`_shared/label-bootstrap.md` before the first swap this run, copying each row from that file's
canonical `LABELS_JSON`. This skill adds only `accept:*` labels; it never adds a `demo:*` one.

**A verdict replaces any prior acceptance label the record carries.** Most-conservative-wins
(`_shared/work-record.md`) would otherwise let a leftover label outrank the new verdict: an Approve
on a previously rejected record would keep reading `changes-requested`. So the verdict's edit also
removes, in the same invocation, each of these the record holds, `demo:*` twins included:

- **Every verdict:** `demo:pending`, `accept:pending`.
- **Approve:** `demo:changes-requested`, `accept:changes-requested`, and the `demo:approved` twin.
- **Single-record Approve** (not batch-sourced): `demo:approved-batch`, `accept:approved-batch`, since the human's individual verdict replaces the batch one.
- **Batch-sourced Approve:** `demo:approved-batch`, the twin of the batch label it writes.
- **Request changes:** `demo:approved`, `accept:approved`, `demo:approved-batch`, `accept:approved-batch`, and the `demo:changes-requested` twin.

A batch-sourced Approve (the Provenance signal note below) keeps `accept:approved-batch`: it is the
batch action, and it writes that batch label in the same invocation. Only its `demo:approved-batch`
twin goes.

`accept-entry.js labels` computes the edit, so nothing here is hand-assembled. Fetch the labels
fresh, as its own Bash call, immediately before it (never Step 1's copy: a failed packet edit in
Step 1 clears a pending label), with `{VERDICT_LABELS}` resolved per `_shared/session-tmp-root.md`:

```bash
gh issue view {n} --json labels > "{VERDICT_LABELS}"
```

Then, as its own Bash call, with `{verdict}` `approved` or `changes-requested`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/accept-entry.js" labels --labels-json "{VERDICT_LABELS}" --verdict {verdict}
```

Append `--batch` only for a batch-sourced Approve (the Provenance signal note below).

It prints one line, `{"add":[…],"remove":[…]}`. `remove` holds a label from the rule above **only
when those labels hold it**, `demo:pending` included: `gh issue edit --remove-label` exits 1 with
"not found" on a label the repo has never created and fails the whole edit, dropping the verdict,
while a label the record holds is known to exist. A closing-commit reconstruction, or a packet on a
record with no pending label, needs no variant: it removes whichever of these it holds, usually
none. A non-zero exit (1 an unreadable labels file, 2 a malformed call) writes nothing: report it
and leave the verdict unapplied, never hand-assembled.

**Provenance signal (Approve only).** A single-record verdict and a `#N,#M` batch-list verdict
are otherwise byte-identical on the wire — both run Step 2's per-item walkthrough in full — so
the Approve action records which invocation shape produced this verdict: a bare `#N`
invocation or the no-argument session-recall path is single-record-backed, the default, nothing
extra written. A `#N,#M...` batch invocation (more than one ref in this run's list — see Input)
is batch-sourced — the Approve action passes `--batch`, which adds `accept:approved-batch`, so
`bin/lib/issues/trust.js`'s coverage/verdict computation (via `acceptance.js`'s
`approvalProvenance`) can tell a rapid multi-item batch pass apart from a dedicated single-record
session. This is a `work-backend: github-issues`-only signal — the trust table it feeds is
already github-issues-only (`_shared/trust-table.md`'s framing note), so `work-backend: local-files`
writes no equivalent facet. A pre-existing approved label carries no such marker and reads
as single-record-backed — the safer default, since promoting an unlabeled historical approval to
"batch" would understate coverage rather than overstate it.

- **Approve** — `gh issue edit {n}` with one `--add-label` per name in the result's `add` and one `--remove-label` per name in its `remove`: the flags the replacement rule above selects for Approve, computed by the labels command with `--verdict approved` (plus `--batch` for a batch-sourced verdict, per the Provenance signal note above). `work-backend: local-files`: set `facets.acceptance = 'approved'` via `writeRecord` — no equivalent provenance facet on this driver (see the Provenance signal note above). For a decomposition parent — `parent-issue` in its labels (`work-backend: github-issues`) or `facets.isParentIssue === true` (`work-backend: local-files`) — close it too: below the oversight floor the Parent-Gate Procedure's **Close the parent below the floor** (`wrap-up/verification-brief-parent-gate.md`) closes a parent with no sign-off, but a parent above the floor is closed only here, so without this the parent stays open forever and the acceptance label is the only trace the parent issue was ever accepted. `work-backend: github-issues`: `gh issue close {n} --reason completed`. `work-backend: local-files`: `closeRecord(path)` (`bin/lib/issues/local-store.js`), run **after** the `writeRecord` call above — `closeRecord` does its own fresh read of the file, so calling it second means it preserves the `acceptance: 'approved'` facet just written rather than racing it.
- **Request changes** — prompt for a short reason inline, then:
  1. **`work-backend: github-issues`:** `gh issue edit {n}` with one `--add-label` per name in the result's `add` and one `--remove-label` per name in its `remove`: the flags the replacement rule above selects for Request changes, computed by the labels command with `--verdict changes-requested`. **`work-backend: local-files`:** set `facets.acceptance = 'changes-requested'` via `writeRecord`. For a decomposition parent — `parent-issue` in its labels (`work-backend: github-issues`) or `facets.isParentIssue === true` (`work-backend: local-files`), the same two-driver test the Approve branch above uses — nothing further follows this: the parent stays open, since a changes-requested verdict means the parent issue's work is not done.
  2. File a linked follow-up record and note the bidirectional link back on the original — read
     `follow-up-record.md` in this skill's directory and follow its items 2 and 3 (both drivers:
     `recordPayload` under `work-backend: github-issues`, `createRecord`+`deriveSlug` under
     `local-files`, the `Origin: demo changes-requested from #{n}` provenance line).
- **Skip for now** — no label change.

**Session-recall entries** (Step 1's no-arguments path) — no record exists, so nothing here ever
bootstraps a label or writes to GitHub/local-files for Approve or Skip:

- **Approve** — nothing written anywhere. The verdict lives in this conversation.
- **Skip for now** — nothing written anywhere. Unlike a label-backed record, this will not
  reappear in a future `/claude-tweaks:accept` run — a different session has no memory of this conversation to
  recall from. This is the accepted tradeoff of not persisting anything, not a bug.
- **Request changes** — the exact same follow-up-filing procedure as the label-backed path's
  Request changes above (step 2, `follow-up-record.md` in this skill's directory), reusing
  `recordPayload` (`work-backend: github-issues`) or
  `createRecord`+`deriveSlug` (`work-backend: local-files`) directly — the only difference is
  there is no original record to relabel or comment a link back onto, or reference within the
  follow-up's own body — the `Origin:` line is the sole provenance marker for a session-recall
  follow-up. The `Origin:` body line reads `Origin: demo changes-requested from session recall`
  instead of `from #{n}`.
