# Open Items — Make the SessionStart unfinished-runs and staged-proposals banners say never to run their command

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD minor (deferred): the `#1493 I4` test title in tests/hooks-session-start.test.js now carries two em-dash separators (an AC1.1 id suffix) | accepted | The brief mandated the suffix. Both the task review and the whole-branch review rated it non-blocking polish |
| 2 | build | SDD minor (deferred): the `#803` never-run pin duplicates the AC6.1 pin on the same clause | accepted | Intentional. The two pins cover different paths (a plain interrupted run versus the multi-spec re-entry suffix), and the whole-branch review recommended keeping both |
| 3 | build | docs/hooks.md:23 says every SessionStart line carrying a runnable command says never to run it. The console-residue banner (plugin/bin/lib/hooks/session-start.js:189-191) carries runnable `--ack` commands that it deliberately tells the model to run, and the rule records no carve-out for it. Whole-branch review Minor 3, out of #3475's scope | open | — |
