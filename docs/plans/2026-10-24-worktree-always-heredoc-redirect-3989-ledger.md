# Open Items — #3989 worktree-always PreToolUse hook false-positives on numeric comparisons inside a Bash heredoc

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 1 commit ahead of the dispatched worktree's base at Step 2.5 | observation | Post-creation catch-up fast-forwarded the worktree branch to origin/main (13cabe92d) before any commit |
| 2 | build | SDD ruling — unquoted-delimiter heredoc body with $( or backtick is kept unstripped (fail closed): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — unterminated heredoc body, and a body whose opener line ends in a pipe/&&/\|\| continuation, is kept unstripped: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — shell carve-out widened (su, csh/tcsh/rbash/pwsh, versioned shells, sudo -s/-i, unresolvable word after a wrapper) in fix round 1: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build | SDD ruling — write-then-execute heredoc (cat > s.sh <<EOF; bash s.sh) documented as the opaque-program gap, no code change: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 6 | build | SDD ruling — glued sh<<EOF, (bash)/>(bash) grouped readers and $-quoted delimiters fixed in-loop (rounds 2-3) rather than deferred: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 7 | build | SDD ruling — redirect inside backticks resolving no target left out of scope (pre-existing parser limit, unchanged by #3989): ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 8 | build | Minor 5 — prefilter + fileWriteTargets each run stripHeredocBodies (linear pass, unmeasured); controller runs npm run test:perf centrally | deferred | — |
| 9 | build | `echo foo>x` (redirect glued to a preceding word) resolves no target — REDIRECT_OP_RE is anchored at token start, pre-existing since #3080, not a #3989 regression; follow-up candidate | deferred | — |
