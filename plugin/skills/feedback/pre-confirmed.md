# Feedback — The `--pre-confirmed` Path

Referenced by `skills/feedback/SKILL.md` Step 7 (Confirm — HARD GATE) and Step 8 (File). Read
only when `--pre-confirmed` was passed — legitimately only by `/claude-tweaks:wrap-up`'s Review
Console or `/claude-tweaks:flow`'s consolidated multi-spec console (`SKILL.md`'s Component-Skill
Contract). A direct invocation never reads this file. `--dry-run` takes precedence over
`--pre-confirmed` (Step 7) and stops before either section below runs.

## Step 7 — the two checks before filing

**`--pre-confirmed`:** the caller passes both the item's staged-file path and the exact body text
it rendered and got approval for (the approved snapshot) — not just a path reference. Before
filing, two checks run, always in this order:

1. **Scrub rerun (unconditional)** — Step 6's scrub always reruns first, on the current on-disk
   staged content, as a defense-in-depth safety net before publishing — regardless of whether the
   drift check below finds a mismatch, since a modification that caused drift could itself have
   reintroduced content that needs scrubbing. This produces the content that will actually be
   filed. If this rerun trips Step 6's own hard-stop ("cannot survive the scrub") for this item,
   treat it exactly like a Step 6 stop anywhere else in a batch: drop this one item (report why)
   and continue processing the rest of the chunk — it never aborts sibling items.
2. **Drift check** — if `staged/wrap-up-upstream-{N}.md` no longer exists, treat this as "already
   filed" (see Step 8's cleanup-on-success below) and skip this item without re-filing or
   erroring. Otherwise, re-read it fresh from disk (the post-scrub content from step 1 above) and
   compare it, byte-for-byte, against the approved snapshot the caller passed. A mismatch means
   the staged file changed after it was rendered and approved — fall back to the normal
   `AskUserQuestion` confirm, showing the post-scrub content (not the pre-scrub approved snapshot)
   so the human approves exactly what would be filed. This fallback is per-item — it never aborts
   sibling items in the same batch.

When the drift check finds no mismatch, skip the `AskUserQuestion` call for that item and file the
post-scrub content directly.

## Step 8 — cleanup on success

Step 8's item 5, verbatim:

5. **On success when invoked via `--pre-confirmed`:** delete the staged file at
   `staged/wrap-up-upstream-{N}.md` for each draft the CLI table reports as `status: filed` or
   `status: dedup-hit` — condition on the table's status, not on `gh issue create`'s own exit code
   directly — immediately after the CLI returns. This is what makes Step 7's drift check "file not
   found" branch mean "already filed" rather than an error, and prevents a
   `/claude-tweaks:wrap-up resume` (or the multi-spec console's own resume) from re-rendering and
   re-filing an item whose chunk already succeeded before an interruption. A direct
   (non-`--pre-confirmed`) invocation has no staged file to clean up — this step is a no-op in
   that path.
