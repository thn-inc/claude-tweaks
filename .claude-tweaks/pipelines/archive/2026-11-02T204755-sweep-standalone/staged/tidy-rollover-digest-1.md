# Staged: Rollover digest container — #1426

**Finding:** [digest] container #1426 holds 115 comments, past the 100-comment rollover threshold (100-comment read truncation hazard).

**Proposed:** Rollover digest container #1426 per tidy/digest-sweep.md: create the replacement, carry every trusted live entry and a tombstone per promoted or expired entry, verify both counts, move the digest label and pin, then close #1426 with a summary comment.

**Order note:** apply after any approved digest-promotion items in this run, so promoted lines carry their → #n markers into the new container as tombstones.
