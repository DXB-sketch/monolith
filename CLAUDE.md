# CLAUDE.md — Monolith Web Studio

Read this file at the start of every session. It is the source of truth for how this project is built. Detailed specs live in `/docs`.

## What this project is

The portfolio and sales site for **Monolith Web Studio** ("Monolith"), a one-person web design and development studio based in Wamuran, Queensland, Australia.

The site has two jobs, and both matter equally:

1. **Be a digital artwork.** A cinematic, scroll-driven 3D experience: a cracked obsidian monolith glowing with magma, standing in a volcanic dusk landscape. It must feel award-level (Awwwards Site of the Day standard) and unlike a template.
2. **Convert visitors into clients.** Small and medium local businesses in South East Queensland must be able to understand what Monolith does, see the work, see pricing, and start a project within seconds, on any device, without needing the 3D experience at all.

When these two goals conflict, never sacrifice clarity, speed or accessibility for spectacle. Find a design that does both.

## Required reading

- `docs/BRIEF.md` — positioning, audience, content, copy and placeholders
- `docs/ART_DIRECTION.md` — palette, type, UI language, motion, scroll story
- `docs/SCENE_SPEC.md` — technical spec for the 3D scene
- `docs/PHASES.md` — build roadmap and phase scope
- The most recent `PHASE_N_COMPLETE.md` at the project root, if one exists

## Tech stack (do not substitute without asking)

- **Astro** (latest stable) with TypeScript, static output, deployed to **Vercel**
- **Astro ClientRouter (View Transitions)** for page transitions; the WebGL canvas persists across pages with `transition:persist`
- **Three.js** (vanilla, no React Three Fiber) for the 3D scene
- **GSAP** + **ScrollTrigger** for scroll-driven animation
- **Lenis** for smooth scrolling
- **Astro content collections** (Markdown/MDX) for case studies and lab entries
- **Resend** for the contact form email (via a Vercel serverless endpoint), **Cal.com** embed for booking calls
- Plain CSS with custom properties (CSS modules or scoped Astro styles). **No Tailwind. No UI component libraries.**

## Project structure

```
src/
  pages/            index, work/, work/[slug], services, about, lab/, lab/[slug], contact, 404
  layouts/          BaseLayout.astro (head, nav, footer, persistent canvas)
  components/       UI components (Nav, Hud, FaceCard, ServiceCard, ContactForm, etc.)
  scene/            all Three.js code — see SCENE_SPEC.md
    index.ts        createScene(), public API used by pages
    monolith.ts     terrain.ts  lava.ts  sky.ts  embers.ts  camera-path.ts
    shaders/        *.glsl
    quality.ts      device tier detection
  content/          work/*.md, lab/*.md (content collections)
  styles/           tokens.css, global.css, type.css
  lib/              scroll.ts (Lenis + ScrollTrigger setup), motion.ts (reduced-motion helpers)
public/
  models/           optional GLB assets (reserved for later Blender/Higgsfield assets)
  posters/          static fallback images of the scene
  fonts/            self-hosted fonts
```

## Non-negotiable rules

**Design tokens**
- All colours come from CSS custom properties in `src/styles/tokens.css`. Never hardcode hex values in components. Shader colours are passed in as uniforms read from a single `scene/palette.ts` that mirrors the tokens.
- Fonts: Sora (200, 300, 500) and JetBrains Mono (400, 500), self-hosted with `font-display: swap`.

**Content and accessibility**
- Every word of content lives in real, semantic HTML. The WebGL canvas is decorative: `aria-hidden="true"`, `pointer-events` managed explicitly, and never the only place information appears.
- The site must be fully usable with JavaScript disabled, WebGL unavailable, or `prefers-reduced-motion: reduce`. In those cases show the static poster image of the scene and normal scrolling.
- Skip link, visible focus states, keyboard access to everything, WCAG 2.2 AA contrast for all text.
- Sound is optional and off by default. Never autoplay audio.

**Performance**
- The scene initialises after first paint. Text and the hero headline must render before any 3D code runs.
- Use the quality tiers in `SCENE_SPEC.md`. Mobile gets a lighter scene, not the desktop scene scaled down.
- Budgets: LCP < 2.5s on a mid-range phone over 4G; initial JS (excluding the lazily loaded scene chunk) under 100 KB gzipped; scene chunk under 300 KB gzipped plus assets; steady 60fps on a recent laptop, 30fps minimum on mid-range mobile.
- Dispose Three.js geometries, materials and textures when no longer needed. Pause rendering when the tab is hidden or the canvas is offscreen.

**Honesty**
- Monolith is openly a one-person studio. Copy uses "I", never an implied team.
- Concept projects must be clearly labelled as concepts.
- Never invent client names, quotes, metrics or awards. Use the bracketed placeholders from `BRIEF.md` until real content is supplied.

## Working conventions

- Work one phase at a time, exactly as scoped in the phase prompt. Do not start the next phase.
- Do not rebuild things that already work. If something from a previous phase must change, say why in the completion file.
- Run `npm run build` before finishing any phase. It must complete without errors or warnings you have not explained.
- Commit at the end of each step with a clear message.
- When a phase is finished, write `PHASE_N_COMPLETE.md` at the project root covering: what was built, deviations from the spec and why, known issues, performance numbers measured, and what the next phase needs to know.
