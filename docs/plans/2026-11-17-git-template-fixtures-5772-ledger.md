# Open Items — Move the statusline, archive-merged and stack-check test fixtures onto git-template

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build/skill | Migrating a git fixture builder onto tests/helpers/git-template.js comes with three repeatable rules no project skill documents. First, the template build must read its git env at call time, or its spawn test passes vacuously. Second, git-derived values (SHAs) are recorded at build time under the template key. Third, the build pins `-c init.defaultRefFormat=files` and `--ff-only` so a developer's global git config cannot break it. Shipped in #5297, #5769 and #5772. [skill: NEW - git-template-fixture-migration] | observation | — |
