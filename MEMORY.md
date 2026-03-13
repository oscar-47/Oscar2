# Shopix Memory

Last updated: 2026-03-13

## Why This Exists

- The owner wants durable project context captured once so new sessions do not need the same briefing repeated.
- This file is the shared, repo-tracked memory for long-lived product, workflow, and collaboration context.
- Keep it current when stable facts change.

## Session Bootstrap

- Read this file first.
- Then read `CLAUDE.md` for design language and product tone.
- For user-visible or release-affecting work, isolate the task in its own git worktree before editing.
- Before trusting local browser results, verify runtime ownership instead of assuming any existing `3000` server is correct.

## Owner Preferences

- Proactively maintain a shared project memory file instead of relying on repeated chat briefings.
- Prefer repo-tracked memory over machine-local notes when the context should survive across sessions.
- Never store secrets in project memory. Point to the existing source-of-truth location instead.
- The owner expects agents to remember that `951454612@qq.com` is an approved admin QA account email for Shopix browser validation.
- If the owner supplies the QA password in chat, treat it as a session-only secret: move it into local env or auth tooling for the current run, but do not write the plaintext password into repo-tracked memory.

## Product Snapshot

- Shopix is an AI-powered e-commerce image generation platform.
- Primary users are cross-border and domestic e-commerce sellers who need fast, professional visuals.
- Core product surfaces cover hero image generation, detail-page generation, style replication, image refinement, and clothing workflows.
- The product supports both Chinese and English usage, with Chinese as the primary market context.

## Design And UX Anchors

- Brand personality: professional, efficient, reliable.
- Emotional target: trust plus efficiency.
- Light mode is the primary design mode.
- Typography direction: Plus Jakarta Sans for display and Noto Sans SC for body text.
- Do not imitate competitor navbar structure or page flow. Shopix should keep a distinct identity.
- Keep the interface calm, whitespace-driven, and operational rather than playful.

## Worktree And Runtime Discipline

- One task should own one git worktree.
- One task should own one dev server.
- One task should own one browser-validation session.
- Reserve `http://127.0.0.1:3000` for the task actively doing browser QA.
- Move other concurrent Shopix sessions to alternate ports such as `3002`, `3003`, or `3004`.
- Current `package.json` runs `npm run dev` as `next dev --port 3001`.
- `playwright.config.ts` defaults `baseURL` to `http://127.0.0.1:3001`, reuses an existing live server, and can be overridden with `TA_PRO_E2E_BASE_URL`.
- Even with the 3001 defaults, keep `3000` reserved for the task actively doing interactive browser QA when that workflow requires it.
- Never trust an existing `3000` listener without checking the PID, owning working directory, and branch.
- If browser DOM or screenshots do not match the current source tree, suspect wrong runtime ownership or a stale browser profile before rewriting code.

## QA And Model Anchors

- Use agent browser for interactive Shopix browser QA.
- Do not use Playwright MCP as a substitute for interactive local browser validation.
- `e2e/global.setup.ts` reads auth from `TA_PRO_E2E_ADMIN_EMAIL` and `TA_PRO_E2E_ADMIN_PASSWORD`, with `TEST_USER_EMAIL` and `TEST_USER_PASSWORD` as fallback names.
- Preferred admin QA email for this project: `951454612@qq.com`.
- Keep QA credentials in environment variables or local instruction files, not in this file.
- Balanced public model alias: `or-gemini-3.1-flash`.
- Direct provider model for that balanced path: `google/gemini-3.1-flash-image-preview`.
- Source of truth for model routing and credit logic: `supabase/functions/_shared/generation-config.ts`.

## Key Product Surfaces

- `/[locale]/studio-genesis`: main hero image generation.
- `/[locale]/ecom-studio`: e-commerce detail-page generation.
- `/[locale]/aesthetic-mirror`: style replication.
- `/[locale]/refinement-studio`: image refinement.
- `/[locale]/clothing-studio`: clothing workflows.
- `/[locale]/job-health`: admin-only queue health dashboard.
- `/[locale]/profile`: now includes user support feedback entry and unread reply tracking.
- `/[locale]/profile/creator-program`: creator program detail and submission flow.

## Source-Of-Truth Files

- `AGENTS.md`: agent startup and memory-upkeep rules.
- `CLAUDE.md`: design context and product tone.
- `package.json`: scripts and default local start command.
- `playwright.config.ts`: Playwright base URL and server reuse behavior.
- `e2e/global.setup.ts`: auth environment-variable contract for automated QA.
- `scripts/test-core-flow.mjs`: end-to-end image smoke flow.
- `supabase/functions/_shared/generation-config.ts`: model aliases, provider mapping, supported sizes, and credit costs.
- `supabase/functions/_shared/generation-worker-routing.ts`: task-type to worker-function routing and worker invoke failure classification.
- `lib/job-health-monitor.ts`: queue health aggregation and incident cooldown state.
- `lib/support-feedback.ts`: support feedback limits, schema normalization, and unread-reply helpers.
- `lib/creator-program.ts`: creator program platform rules and shared validation.

## Current Repository State

- As of 2026-03-13, the local workspace is not a clean baseline. It contains substantial in-progress changes across frontend, API routes, Supabase functions, migrations, and i18n files.
- Current active product work includes admin operations surfaces such as maintenance controls, queue health monitoring, support-email tooling, and internal job-health checks.
- The profile area is expanding with a support feedback system that supports message threads, attachment uploads, and unread admin-reply tracking.
- A creator program flow is being added on top of the support-feedback stack, including user submissions, platform/date validation, and reward records in `creator_program_rewards`.
- The generation pipeline is being split by task type (`ANALYSIS`, `IMAGE_GEN`, `STYLE_REPLICATE`) into dedicated worker functions, with backoff and attempt-tracking logic reflected in new shared queue code and recent Supabase migrations.
- Major dashboard and studio surfaces are under active UI and copy revision, including profile, marketing, generation flows, admin pages, and both `messages/en.json` and `messages/zh.json`.

## What Belongs Here

- Durable product facts.
- Long-lived workflow rules.
- Stable technical constraints.
- Recurring owner preferences that future sessions will likely need again.

## What Does Not Belong Here

- Secrets or credentials.
- Temporary debugging notes.
- One-off task instructions.
- Facts that are better maintained as code or tests.
