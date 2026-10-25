# Open Items — #4210 Resolve a redirect glued to a word that holds a quoted span or a subshell

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 1 commit ahead at run start (reason-not-auto: informational) | fixed | Post-creation catch-up merged origin/main into the worktree branch |
| 2 | build | `cd foo"bar"` test in tests/hooks-gate-coverage.test.js cites only #4210, no AC clause id (plan-mandated) | deferred | SDD minor (deferred), whole-branch review triage: leave |
| 3 | build | quoted/escaped `>` test labelled AC1.1 though it guards Deliverable 2 too (label loose) | deferred | SDD minor (deferred), whole-branch review triage: leave |
| 4 | build | BALANCED_GROUP_RE accepts an empty group, so `()>x` resolves `x` (bash syntax error; fail-closed only) | deferred | SDD minor (deferred), whole-branch review triage: leave |
| 5 | build | `(ls)2>x` (fd-numbered redirect after a group) resolves nothing — allow-side miss, also missed on main | deferred | SDD minor (deferred), whole-branch review triage: follow-up |
| 6 | build | SDD ruling — fix the quoted leading `>` in the start-anchored scan too (spec Deliverable 2 outranks the plan's out-of-scope line): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 7 | build | SDD ruling — #4212 (in progress, same tokenizer/doc region, conflicting escape design) not coordinated from inside this build; settle merge order: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 8 | build | SDD ruling — one targeted residual fix past SDD's no-second-wave rule (Critical regression vs main on heredoc-body/jq-pipe idioms): ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 9 | build | SDD ruling — park the heredoc-apostrophe fail-open miss (`git commit -m "$(cat <<'EOF'\nDon't …\nEOF\n)" && echo x > out.js` → no target; main resolved out.js) as a follow-up: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 10 | build | SDD ruling — `NAME="a b"` assignment tracking: comment-only; `echo 'hi'>$WT/x` miss left as follow-up: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 11 | build | Follow-up record: unmatched `case a)` / bare `}` / `${x%)}` closers inside "$( … )" close the nesting early and fabricate targets (`echo "$(case $x in a) echo "p>q";; esac)"` → `/r/q;; esac)`; main resolved nothing) | open | — |
| 12 | build | Follow-up record: an unbalanced opener inside quotes (`"${x:-(}"`, `"${x//(/y}"`) hides later genuine redirects in the same command (fail-open; main resolved `echo "${x:-(}" > out.js` → out.js) | open | — |
| 13 | build | Follow-up record (pre-existing on main): `if (( x>y ))`/`while (( x>y ))` resolve `y`; `echo $(cmd x>y)` resolves `y)`; `NAME="a b"; echo x > $NAME` resolves `/r/a b` (bash: ambiguous redirect) — all fail closed | open | — |
