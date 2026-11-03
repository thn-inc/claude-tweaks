# Open Items — Resolve escaped-blank, line-continuation and `$word\ >` redirect targets on the span-mask tokenizer

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | review | Convention (3a, low): plugin/bin/lib/hooks/git-command.js:1497 restated the plain-word rule inside escapedBlankPrefixOk, which gluedRedirectOpEnd already applied | fixed | Extracted isPlainWordSpan, called from both; behavior unchanged. Commit 482d46755 |
| 2 | review | Security (3b, low): plugin/bin/lib/hooks/git-command.js:1509 the brace counter closes a `${` on a `}` inside an unclosed backtick span, so a bash-invalid command resolves a target | accepted | A spurious deny on a command bash rejects, same family as the pinned `echo ${M:-`d}`\ >x}` false deny. A plain `!tick` guard would break a `${N}` nested inside the backticks, so a correct fix needs per-span brace depth; tiebreak recommended drop |
| 3 | review | Test quality (3f, low): tests/hooks-gate-coverage.test.js:1122 comment says the `$WT/x` known misses write y/x | accepted | Refuted by two independent tiebreak runs: the comment names the redirect's resolved target and the loop never runs a shell |
