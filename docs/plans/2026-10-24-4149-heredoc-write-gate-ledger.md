# Open Items — #4149 worktree-always write gate misses writes inside heredocs (#3989 regression)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Step 2.5 pre-flight divergence: origin/main was 4 commits ahead of local main, and local main carried one run-dir-only `[reconcile]` commit (49302ee0a) not on origin (reason-not-auto: informational — no action outstanding) | observation | Worktree created directly at origin/main 7070c0b8a, so nothing was behind and the local-only commit did not ride along; catch-up merge was a no-op. |
| 2 | build | SDD ruling — Task 1: Important 1 is valid against the spec fail-closed constraint: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — Task 1: M1, M2, M3, M5, M6 fixed in this build (deferral gate fix-now: small, same module and heredoc feature area; pre-existing-in-touched-file ...: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — Task 1: M4 no change: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build | SDD ruling — Task 1: N1, N2, N3 fixed in round 2 (fail-closed regressions introduced by this task); N1 fix = escape-aware quote-span removal (a backslash outs...: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 6 | build | SDD ruling — Task 1: N4 no change: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 7 | build | SDD ruling — Task 1: OOS $-program check gets a pinning test now (/$D/cat <<EOF): ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 8 | build | SDD ruling — Task 1: round 2 runs on a fresh sonnet implementer: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
| 9 | build | SDD ruling — Task 1: A1 fixed fail-closed: ratify or reverse at the Review Console (staged/sdd-ruling-8.md) | open | — |
| 10 | build | SDD ruling — Task 1: A2 gets its pinning test (cp a.js /main/f.js << EOF reports /main/f.js): ratify or reverse at the Review Console (staged/sdd-ruling-9.md) | open | — |
| 11 | build | SDD ruling — Task 1: OOS M10 redundant } disjunct, M6/M7 untested fail-closed branches: ratify or reverse at the Review Console (staged/sdd-ruling-10.md) | open | — |
| 12 | build | SDD ruling — Task 2: accept the added discriminating assertion: ratify or reverse at the Review Console (staged/sdd-ruling-11.md) | open | — |
| 13 | build | SDD ruling — Task 2: I1, I2, m1, m2 all fixed in round 1: ratify or reverse at the Review Console (staged/sdd-ruling-12.md) | open | — |
| 14 | build | SDD ruling — Task 3: prose names nine reader words plus git-with-data-subcommands (brief said "ten words"): ratify or reverse at the Review Console (staged/sdd-ruling-13.md) | open | — |
| 15 | build | SDD ruling — Task 3: #1 fixed now: ratify or reverse at the Review Console (staged/sdd-ruling-14.md) | open | — |
| 16 | build | SDD ruling — Final: F1 fixed: ratify or reverse at the Review Console (staged/sdd-ruling-15.md) | open | — |
| 17 | build | SDD ruling — Final: F2 fixed now, not deferred: ratify or reverse at the Review Console (staged/sdd-ruling-16.md) | open | — |
| 18 | build | SDD ruling — Final: inert opener-line neighbours (cd, mkdir, true, :, echo, printf: ratify or reverse at the Review Console (staged/sdd-ruling-17.md) | open | — |
| 19 | build | SDD ruling — Final: m1 fixed by the same sticky flag (an unquoted $' anywhere earlier keeps later bodies); m2 fixed (arithmetic depths not reset at newline; ...: ratify or reverse at the Review Console (staged/sdd-ruling-18.md) | open | — |
| 20 | build | SDD ruling — Final: residual fix dispatch authorized (/build dispatch.md override: one targeted fix + one scoped re-review): ratify or reverse at the Review Console (staged/sdd-ruling-19.md) | open | — |
| 21 | build | SDD ruling — Final: lone &: ratify or reverse at the Review Console (staged/sdd-ruling-20.md) | open | — |
| 22 | build | SDD ruling — Final: m1: ratify or reverse at the Review Console (staged/sdd-ruling-21.md) | open | — |
| 23 | build | SDD ruling — Final: F2 bias rules B2 (} outside closer position) and B3 (fi/done/esac outside closer position) get discriminating tests: ratify or reverse at the Review Console (staged/sdd-ruling-22.md) | open | — |
| 24 | build | SDD ruling — Final: m2: ratify or reverse at the Review Console (staged/sdd-ruling-23.md) | open | — |
| 25 | build | SDD ruling — Final: routine table: ratify or reverse at the Review Console (staged/sdd-ruling-24.md) | open | — |
| 26 | build | SDD ruling — Final: git add (bare or via git global flags, without --pathspec-from-file) joins the inert neighbours: ratify or reverse at the Review Console (staged/sdd-ruling-25.md) | open | — |
| 27 | build | SDD ruling — Final: a cd behind a group opener ((cd, ( cd, {, { cd) is read as a cd; its scope ends at the group close, and where the close cannot be placed,...: ratify or reverse at the Review Console (staged/sdd-ruling-26.md) | open | — |
| 28 | build | SDD ruling — Final: a glued redirect token (>/dev/null, 2>&1, >>f) is never a write-shape positional: ratify or reverse at the Review Console (staged/sdd-ruling-27.md) | open | — |
| 29 | build | SDD ruling — Final: m6: ratify or reverse at the Review Console (staged/sdd-ruling-28.md) | open | — |
| 30 | build | SDD ruling — Final: bashCdq (bash -c "$(cat <<'EOF'…)"), readEval (read X <<EOF … eval "$X"), writeThenRun (cat > s.sh <<EOF … bash s.sh), funcShadowsCat (ca...: ratify or reverse at the Review Console (staged/sdd-ruling-29.md) | open | — |
| 31 | build | SDD ruling — Final: accept ruling-6 narrowing (git add not inert behind -c/--config-env/NAME=value: ratify or reverse at the Review Console (staged/sdd-ruling-30.md) | open | — |
| 32 | build | SDD ruling — Final: fold three more fail-opens the fixer found into the same fix dispatch before the scoped re-review (fix-now: same module): git with -c/--c...: ratify or reverse at the Review Console (staged/sdd-ruling-31.md) | open | — |
| 33 | build | SDD ruling — Final: one more targeted fix + scoped re-review beyond the /build cap: ratify or reverse at the Review Console (staged/sdd-ruling-32.md) | open | — |
| 34 | build | SDD ruling — Final: fix: ratify or reverse at the Review Console (staged/sdd-ruling-33.md) | open | — |
| 35 | build | SDD ruling — Final: f() { cd M; }; f; cp (function-body cd), echo $'a&b\'' (ANSI-C quoting in tokenize) and (… ${x:-)} …) deferred: ratify or reverse at the Review Console (staged/sdd-ruling-34.md) | open | — |
| 36 | build | SDD ruling — Final: jq "$(bash)" fixed: ratify or reverse at the Review Console (staged/sdd-ruling-35.md) | open | — |
| 37 | build | SDD ruling — Final: commands inside "$( )"/backticks not walked as commands (echo "$(true && cp a /main/f.js)" reports nothing: ratify or reverse at the Review Console (staged/sdd-ruling-36.md) | open | — |
| 38 | build | SDD ruling — Final: keep the own-segment $(/backtick refusal: ratify or reverse at the Review Console (staged/sdd-ruling-37.md) | open | — |
| 39 | build | SDD ruling — Final: reverse the own-segment half of the N6 ruling: ratify or reverse at the Review Console (staged/sdd-ruling-38.md) | open | — |
| 40 | build | SDD ruling — Final: round 4 fix beyond the cap: ratify or reverse at the Review Console (staged/sdd-ruling-39.md) | open | — |
| 41 | build | SDD ruling — Final: commands inside a backtick span not walked as commands (echo `cp a M/f.js`) joins the deferred substitution-body ruling (Defer-reason: ge...: ratify or reverse at the Review Console (staged/sdd-ruling-40.md) | open | — |
| 42 | build | SDD ruling — Final: round-4 re-review is the last review seat: ratify or reverse at the Review Console (staged/sdd-ruling-41.md) | open | — |
| 43 | build | SDD ruling — Final: round 5, narrow, beyond the stated stop: ratify or reverse at the Review Console (staged/sdd-ruling-42.md) | open | — |
| 44 | build | SDD ruling — Final: OOS a segment starting inside a top-level backtick hands groupEvents the closing backtick as an opener (echo `true; true` & cd M; cp a f.js: ratify or reverse at the Review Console (staged/sdd-ruling-43.md) | open | — |
| 45 | build | SDD ruling — Final: accept fix-1's widening: ratify or reverse at the Review Console (staged/sdd-ruling-44.md) | open | — |
| 46 | build | SDD ruling — Final: the five still-missed-at-every-revision shapes join the deferred substitution-walking ruling: ratify or reverse at the Review Console (staged/sdd-ruling-45.md) | open | — |
| 47 | build | SDD ruling — Final: round 6: ratify or reverse at the Review Console (staged/sdd-ruling-46.md) | open | — |
| 48 | build | SDD ruling — Final: the four new OOS shapes join the deferred substitution-walking ruling: ratify or reverse at the Review Console (staged/sdd-ruling-47.md) | open | — |
| 49 | build | SDD ruling — Final: cap 16 accepted (4 groups with relative cds already make 16; 8 would deny an ordinary shape); 1 MB at 2.3–2.6 s accepted: ratify or reverse at the Review Console (staged/sdd-ruling-48.md) | open | — |
| 50 | build | SDD ruling — Final: arith-paren & residual staged for a human, not fixed: ratify or reverse at the Review Console (staged/sdd-ruling-49.md) | open | — |
| 51 | build | SDD ruling — Final: overflow-collapse residual staged for a human, not fixed: ratify or reverse at the Review Console (staged/sdd-ruling-50.md) | open | — |
| 52 | build | SDD ruling — Final: the unpinned \|\| span.sub arm of the background route (:1685, mutant M4 green) staged for a human with its pin (cd M && x=`true \| true & t...: ratify or reverse at the Review Console (staged/sdd-ruling-51.md) | open | — |
| 53 | build | SDD ruling — Final: past-cap spurious denies (five { cd rel; ls; } groups, 20 { cd $WT/xN; ls; } groups) and the misleading "non-isolated checkout" overflow ...: ratify or reverse at the Review Console (staged/sdd-ruling-52.md) | open | — |
