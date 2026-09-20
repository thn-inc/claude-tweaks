# Step 7 — Browser / Playwright CLI (detailed procedure)

*Core Bootstrap step — order-dependent, so later steps may assume earlier ones completed; runs unconditionally and idempotently, acting only on missing state. Gated by `version-check.md` in this directory.*

Browser integration lets Claude Code interact with web pages — useful for testing UIs, running QA stories, scraping docs, and verifying deployments. The single supported backend is `playwright-cli` (`@playwright/cli`).

Detect via `npx --no-install playwright-cli --version` — the tool's own documented presence check (falls back cleanly when not installed). See `plugin/skills/browse/playwright-cli-reference.md` for the operation vocabulary consumer skills speak once migrated.

Init-specific contract:

- Run detection on every `/init` invocation.
- If `playwright-cli` is missing, surface an install hint (`npm install -g @playwright/cli`) and **continue** — never block init on a missing browser. Browser features are optional; all other skills work without them and degrade gracefully.
- Do not prompt for backend choice — there is only one backend.
