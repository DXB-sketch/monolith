# PHASES — build roadmap

Each phase ends with `npm run build` passing, a deploy preview (Cloudflare since the Phase 5 addendum), and a `PHASE_N_COMPLETE.md` at the project root. Test on a real phone between phases before starting the next one.

## Phase 1 — Foundation and the hero scene
Project setup, design tokens, base layout, navigation, footer, the plain-HTML home page content, quality tiers, poster fallback, and the procedural scene for Chapter 00 (monolith with fissures, terrain, sky, fog, a basic lava channel, embers, bloom). Static camera at the Chapter 00 position with gentle idle motion and pointer heat.

## Phase 2 — The scroll story
Lenis + ScrollTrigger, camera path through all five chapters, per-chapter scene states (face heat, ember density, lava intensity), the HUD with live chapter tracking, headline and content reveal animations, the Chapter 04 fissure push-in and cool-down into the plain section. Reduced-motion behaviour complete.

## Phase 3 — Content pages
Content collections for work and lab. Work index, case study template, Services, About, Lab index and entry template, Contact page with the multi-step form (Resend endpoint, validation, honeypot) and Cal.com embed. 404 page. Real content where supplied, bracketed placeholders elsewhere.

## Phase 4 — Polish and transitions
Page transitions with the persistent canvas (camera moves to a position per page), preloader (short, skippable, only on first visit), heat-haze post-processing, refined lava flow and crust, custom cursor on desktop, hover states, optional sound toggle (off by default), micro-interactions.

## Phase 5 — Performance, accessibility, launch
Lighthouse and WebPageTest passes on mobile and desktop, accessibility audit (axe + manual keyboard and screen reader check), SEO (meta, Open Graph images from posters, sitemap, structured data for a local business), analytics (privacy-friendly), final copy review, launch checklist, and Awwwards submission assets (screenshots, short screen recording).

### Targets for launch
- Lighthouse mobile: Performance 85+, Accessibility 100, Best Practices 100, SEO 100
- No layout shift from the canvas or fonts (CLS < 0.05)
- Fully usable with reduced motion, keyboard only, and with WebGL disabled

## Phase 6 — 2D by default, 3D by choice
The default experience everywhere becomes 2D: no WebGL runs unless the visitor asks for it (an experience mode, `'2d' | '3d'`, above the quality tiers). The home page is rebuilt as a 2D landing page that sells the studio (hero, work, why one person, process, packages, the core CTA) in the "strata" layout, with a hero stone pre-rendered from the real scene as an image sequence and scrubbed by scroll (`npm run orbit`). The 3D story moves, unchanged, to `/potential` as the opt-in showcase "See the potential", behind a gate that benchmarks the device first (Medium or High only). Entering 3D is remembered and keeps live page views on content pages; "Back to 2D" in the nav leaves it without a reload.

### Targets
- First visit to any content page or the home page: no scene chunk, no fissure atlas, no WebGL worker
- Lighthouse mobile for `/`: Performance 95+, LCP < 2.5 s, CLS < 0.02, TBT < 150 ms; Accessibility, Best Practices and SEO 100
- Orbit assets: desktop set ≤ 2.8 MB, phone set ≤ 1.0 MB, loaded only after `load`
