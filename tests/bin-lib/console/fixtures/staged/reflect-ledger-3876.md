# Reflect — staged finding 1
Ledger: docs/plans/2026-10-22-review-lens-scratch-plain-bash-ledger.md#4

**Category:** convention
**Severity:** low
**Reversibility:** high
**Source:** light mode, lens "Near-misses"
**Files:** plugin/skills/_shared/subagent-dispatch-core.md, plugin/skills/_shared/scratch-worktree.md, plugin/skills/review/step3-lens-dispatch.md

## Finding

`_shared/subagent-dispatch-core.md` line 39 states that `&&`/`;` chains and "a variable assigned and then used in the same call" are "refused by shape", but `_shared/scratch-worktree.md` §7 (re-verified 2026-10-20, #3340) lists a `;` sequence (including assign-then-use) and `VAR=val && command "$VAR"` as **passes**; the refused shapes it records are a `mkdir -p` chained with a heredoc write (#3519's row) and a runtime-variable operand to `node`/`sed`/`gh`. The #3876 clause in `step3-lens-dispatch.md` (never `S={path} && mkdir -p "$S"`, "the shape #3809's lens agents were refused on") attributes the refusal to the variable assignment, when the refused part of #3809's chain was the `mkdir -p ... && cat > ... <<'EOF'` pairing. Evidence: scratch-worktree.md §7 rows "`;`-separated sequence" and "`VAR=val && command` assign-then-use" (both `passes`), versus dispatch-core.md:39. Cost this session: unclear (the conservative one-plain-command-per-call instruction is still safe, so no retry resulted; the cost is a prose claim a later reader will find contradicted by the table).

## Suggested resolution

Reword dispatch-core.md:39 to the table's own framing ("one plain command per call avoids every refused shape; the refused ones are listed in §7") instead of asserting that `;` chains and carried variables are refused, and drop the "the shape #3809's lens agents were refused on" attribution from the lens Scratch path parenthetical (or give it the full `mkdir -p … && cat > … <<'EOF'` chain). Keep the instruction itself: it is the safe default.

## Decision-log reference

STAGED — Step 3: convention finding "dispatch-core.md:39 overstates which shapes the guard refuses". Stage path: staged/reflect-1.md.
