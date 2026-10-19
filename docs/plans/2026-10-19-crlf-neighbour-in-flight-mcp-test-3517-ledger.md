# Open Items — Windows regression: 1 test file(s) newly failing after c65b3fdbb (#3517)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | snippet reassigns its text parameter (`text = section(text)`) instead of a separate const — mirrors the original shape (SDD task-review Minor) | resolved | Fixed by /build Common Step 3 simplify: `snippet(index, source = MCP)` with `const text = section(source)` |
