# PHASES — build roadmap

Each phase ends with `npm run build` passing, a deploy preview on Vercel, and a `PHASE_N_COMPLETE.md` at the project root. Test on a real phone between phases before starting the next one.

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
