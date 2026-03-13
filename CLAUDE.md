## Shared Memory

Read `MEMORY.md` first for durable cross-session project context. If you learn a lasting product rule, workflow constraint, or owner preference, update `MEMORY.md` before finishing the task.

## Design Context

### Users
Cross-border and domestic e-commerce sellers (Amazon, TikTok Shop, Taobao, etc.) who need to quickly produce professional product images — hero images, detail pages, batch visuals, and style replication. They are busy, results-oriented, and value speed over exploration. Bilingual audience: Chinese-speaking primary market with English support.

### Brand Personality
**Warm · Efficient · Approachable** — a capable creative partner, not a cold instrument. The interface should feel inviting and human while still being highly productive. Professional confidence balanced with warmth.

### Emotional Goals
**Trust + Warmth** — users should feel confident the tool delivers quality results, AND feel welcomed and supported. Interactions should convey competence with a human touch — not sterile or intimidating. Subtle personality is encouraged; gratuitous playfulness is not.

### Aesthetic Direction
- **Reference**: Notion / Stripe (clean whitespace, refined typography) + Figma / Framer (creative tool vitality, rich micro-interactions, approachable personality). Blend the clarity of Notion with the warmth and energy of Figma.
- **Anti-reference**: Picket/competitors — MUST NOT resemble competitor layouts, especially navbar structure and page flow. Establish a distinct visual identity. Avoid cold/clinical enterprise SaaS aesthetics.
- **Theme**: Light mode primary. Warm neutral palette with soft accent colors. Approachable warmth over cold tech — the UI should feel like a friendly creative workspace, not a data dashboard.
- **Typography**: Plus Jakarta Sans (display) + Noto Sans SC (body). Confident sizing, generous line height.

### Design Principles
1. **Own Identity First** — Every component should feel distinctly Shopix. Never copy competitor patterns wholesale. When in doubt, differentiate.
2. **Warm Calm** — Reduce visual noise while maintaining warmth. Use whitespace generously but avoid sterile emptiness. Soft edges, gentle gradients, and subtle texture create an inviting atmosphere.
3. **Efficient by Design** — Minimize clicks, reduce cognitive load. Information hierarchy should guide the eye naturally.
4. **Consistent System** — Unified spacing scale, color tokens, component patterns across marketing and dashboard.
5. **Delightful Motion** — Animations serve function AND add personality. Inspired by Figma/Framer: spring physics, playful hover states, satisfying micro-interactions. Motion should make the tool feel alive and responsive, not just functional.

### Design System — Implementation Reference

#### Color Tokens (HSL via CSS variables)
- **Background**: warm off-white `40 20% 99%`, not pure white
- **Foreground**: deep ink `225 14% 12%`, not pure black
- **Accent**: confident blue `215 65% 55%` — used sparingly for CTAs and focus rings
- **Muted**: warm gray `36 10% 93%` for backgrounds, `222 7% 48%` for secondary text
- **Border**: soft warm `30 8% 84%` — never stark gray
- **Surface**: `38 12% 96%` — subtle card/panel lift
- Dark mode supported (`.dark` class) with inverted warm palette

#### Typography
- **Display**: `Plus Jakarta Sans` via `--font-display` CSS var, weights 500–800. Used for headings and hero text with tight tracking (`tracking-[-0.03em]` to `tracking-[-0.04em]`).
- **Body**: `Noto Sans SC` with Latin fallbacks. Weights 400–700. Default for all body text, labels, UI copy.
- **Sizing pattern**: `text-2xl`/`text-[2.2rem]` for page titles, `text-sm` for body/labels, `text-xs` for chips/badges/tertiary.

#### Component Patterns
- **Cards**: `rounded-[28px]` large radius with `border border-border bg-white` is the standard panel. Nested cards use `rounded-2xl` (16px).
- **Buttons**: `rounded-full` pill shape. Primary = `bg-zinc-950 text-white`, secondary = `border bg-white/85`. All buttons include `press-scale` utility for tactile feedback.
- **Chips/Badges**: `rounded-full` with `px-2.5 py-1 text-xs font-semibold`. Color-coded per context (amber for creator program, emerald for success, etc.).
- **Inputs**: `rounded-2xl` with `border-border bg-background`. Focus: `focus:border-foreground/20`.
- **Section containers**: `rounded-[28px]`–`rounded-[32px]` outer shell, `rounded-[26px]` inner panels, `rounded-2xl` for nested elements. Creates visual depth hierarchy.

#### Spacing & Layout
- Container max-width: `max-w-6xl` for dashboard, `max-w-5xl` for marketing.
- Section spacing: `space-y-8` between major sections, `space-y-4` within sections.
- Grid patterns: `lg:grid-cols-[minmax(0,1.08fr)_minmax(260px,0.92fr)]` for asymmetric two-column layouts.

#### Motion & Animation
- `framer-motion` for complex interactions (mouse-follow glow, spring physics).
- CSS `transition-colors` / `transition-transform` at `duration-300` for hover states.
- `press-scale` utility: `scale(0.97)` on `:active` with `120ms cubic-bezier(0.25,1,0.5,1)`.
- Respects `prefers-reduced-motion: reduce`.

#### Accessibility
- Semantic HTML: `<section>`, `<article>`, `<nav>` used appropriately.
- All interactive elements have visible focus indicators via `ring` token.
- Color contrast maintained through HSL token system (muted-foreground passes AA on background).
- Motion respects system preference via `@media (prefers-reduced-motion: reduce)`.
