# Staged: Delete merged remote branch — origin/worktree-capture-mcp-gap

**Finding:** `origin/worktree-capture-mcp-gap` is already merged into `main` but not yet deleted — an outward-facing git push, staged for approval per the auto-mode contract's reversibility floor (never auto-applied at any tidy tier).

**Proposed:** Delete the merged remote branch.

**Commands:**
```
git push origin --delete worktree-capture-mcp-gap
```
