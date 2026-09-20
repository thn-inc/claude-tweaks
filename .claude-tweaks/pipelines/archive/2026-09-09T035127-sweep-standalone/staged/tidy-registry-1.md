# Tidy staged item — registry entry points at a non-existent directory

**Proposed:** Fix docs/REGISTRY.md's `docs/diagrams/*.html` row — the docs/diagrams/ directory does not exist. Either delete the row, or keep it and note that /claude-tweaks:visualize creates the directory on first use (the row is a placeholder for generated output).

**Why:** Step 4.6 rule 'Registry entry points to non-existent file -> Delete entry' — Fix now stages at every tier (which side to keep is a judgment).

**Invariant:** at approval time docs/diagrams/ must still be absent; if it exists, skip.
