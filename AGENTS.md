# Shopix Agent Guide

## Startup

- Read `MEMORY.md` first for durable cross-session project context.
- Read `CLAUDE.md` for product and design direction.
- If the task changes runtime or user-visible behavior, do the work inside a dedicated git worktree and verify both `pwd` and `git branch --show-current` before editing.

## Runtime Ownership

- Do not trust an existing `http://127.0.0.1:3000` server until you prove the listening PID, owning working directory, and branch.
- When multiple Shopix tasks run in parallel, keep `1 task = 1 worktree = 1 dev server = 1 browser-validation owner`.
- Reserve `3000` for the task currently doing browser QA. Move other active sessions to `3002`, `3003`, or higher.
- If browser output does not match the current source tree, suspect wrong runtime ownership or a stale browser session before changing implementation again.

## Browser QA

- Use agent browser for interactive Shopix browser validation.
- Do not use Playwright MCP as a substitute for interactive local browser QA.
- Keep credentials in environment variables or existing local instruction files, never in repo-tracked memory.

## Memory Upkeep

- Update `MEMORY.md` when you learn durable project facts, workflow constraints, or owner preferences that future sessions will need.
- Do not store secrets, temporary debug notes, or one-off task chatter in `MEMORY.md`.
- If `MEMORY.md` conflicts with the repository, trust the repository and correct `MEMORY.md`.
