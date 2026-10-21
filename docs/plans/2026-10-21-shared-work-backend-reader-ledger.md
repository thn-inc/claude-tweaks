# Open Items — #3554 Re-entry banner uses the # sigil under work-backend: local-files — share one work-backend reader

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Final-review Minor 4+5 (follow-up record proposal; existed before this change, and #3554 pinned the regex value as unchanged): (a) the shared `WORK_BACKEND_RE` (`plugin/bin/lib/work-backend.js:11`) lets `\s*` cross a newline, so a blank `work-backend:` line takes the next single-token line as its value (probed: `'work-backend:\n\n---\n'` → `'---'`). Fix: `/^work-backend:[ \t]*(\S+)[ \t]*$/m`. (b) `plugin/bin/lib/compose-context/resolve-conditions.js:78` still reads the key through `parseFlatLines`, with different rules: it strips a trailing `# comment` and the last duplicate line wins, where the shared reader returns null on the comment and the first line wins. Route it through `parseWorkBackend`, or pin the agreed semantics in both. | open | |
