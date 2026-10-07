# Phase 3 complete: Content pages

Every page of the site now exists and works without the 3D scene: Work, the case studies, Services, About, the Lab with a live WebGL2 demo, the contact brief with its endpoint, booking, and the 404 page. The home page's scroll story, the scene, tier caching and layer loading are unchanged. On content pages the canvas stays dormant.

All measurements were taken in this container, which has **no GPU**. WebGL runs on SwiftShader, and Lighthouse uses simulated mobile throttling.

## What was built

### Step 1: shared reveals and scoped cleanup

- **Shared reveals: `src/lib/reveal.ts`.**
  - `mountReveals(root, 'full' | 'lite')` holds all the Phase 2 reveal rules:
    - A block already in the viewport (above 90%) is never hidden.
    - Full mode reveals with a fade plus a 28 px rise, and splits headings into lines with SplitText (`aria: 'auto'`, masked).
    - Lite mode is a fade only.
    - Focus moving into a hidden block finishes its reveal.
    - The `motion-ready` class is added and removed with the reveals.
  - It returns `{ finish, destroy, pending }`.
- **Scoped story cleanup.** `story.ts` now uses `mountReveals`. On unmount it kills only its own triggers (`reveals.destroy()` plus `ctx.revert()`), never `ScrollTrigger.getAll()`.
- **Content-page reveals (`scene-boot.ts`).**
  - They mount after first paint on `astro:page-load`, and unmount on `astro:before-swap`.
  - They run only when the page has `[data-reveal]`, has no `[data-story]`, and motion is allowed.
  - GSAP is imported dynamically only in that case.
  - The poster tier gets `lite` reveals.
  - Scrolling is native on content pages (no Lenis).
- **`?debug` hook.** `__monolith.state()` now also reports `page`, `triggers` (live ScrollTriggers) and `reveals` (pending).

### Step 2: content collections

- **`src/content.config.ts`** defines the `work` and `lab` collections, with glob loaders and Zod schemas (see [Content schemas](#content-schemas)).
- **The stubs moved into Markdown entries:**
  - `src/content/work/seqdvgc.md`, `allen-gillon.md` and `concept.md`
  - `src/content/lab/light-through-stone.md`
- **Facts come from BRIEF.md only.** Everything else is a bracketed placeholder.
  - Allen Gillon carries the two real accessibility decisions from the brief: the "listen to this page" audio feature and the skip link.
- **Build-time placeholder report** (`src/integrations/placeholder-report.ts`). `astro build` warns with every placeholder still in content, pages, components and site data, grouped by file. It currently lists 40.
- **Placeholder media** (`npm run placeholders`, `scripts/make-placeholders.ts`):
  - Each image is a labelled card rendered in the palette and fonts. The label is the image's bracketed placeholder, e.g. `[COVER IMAGE TO BE SUPPLIED]`.
  - It also makes a 6-second screen-recording stand-in, so the templates (picture sizes, the video player) are exercised.
  - None of it pretends to be a real screenshot.

### Step 3: work index (`/work`)

- **The list.** It is an ordered list of rows. Each row is a single link containing:
  - the number
  - the title in Sora 200
  - the client type and year
  - for concepts, the Concept badge and the line "An unofficial concept: not a client project, and not commissioned by its subject."
- **Floating cover preview** (fine pointer only). It follows the pointer with lerp inertia (0.16) and an AbortController cleanup on `before-swap`. It is hidden:
  - with reduced motion
  - on touch
  - on scroll
  - for keyboard focus
- **Static inline thumbnail.** It shows for keyboard focus (`:focus-visible`) and in every row on touch screens.
- **Phone LCP.** The first row's thumbnail is loaded eagerly at high priority.

### Step 4: case study (`/work/[slug]`)

The sections, in order:

1. **Hero:** title, client, type and year, the concept note, the summary, and a live link labelled "Visit the live site: seqdvgc.com.au". The link opens in the same tab.
2. **The challenge.**
3. **Key decisions,** grouped as Design, Technical and Accessibility.
4. **Visuals.**
5. **Results.** Only rendered when real Lighthouse scores or notes exist.
6. **Quote.** Only rendered when a real quote exists.
7. **Next project.** It loops back to the first project and has a large title.
8. **Start a project.**

Media handling:

- **Images:** `<Picture>` with AVIF and WebP, explicit width and height, `loading="lazy"`, and responsive `sizes`.
- **Video (`Recording.astro`):**
  - Attributes: `muted loop playsinline preload="none"`, with a poster.
  - The server HTML includes `controls`, so it works without JS. JS swaps them for play-in-view: IntersectionObserver at a 0.4 threshold, pausing out of view and when the tab is hidden.
  - With reduced motion it never autoplays; the poster and a Play button show instead.
  - Every video has a text description in its `<figcaption>`.

### Step 5: Services

- The hero.
- Three package panels (`ServiceCard detailed`), each with a "What's included" list and a "from [$ PRICE]" line.
- Ongoing care and hosting (a placeholder).
- The four-step process.
- An FAQ of six questions as `details`/`summary`, each answered `[ANSWER TO BE SUPPLIED]`.
- The closing CTA.

### Step 6: About

- A founder photo frame, plus `[FOUNDER NAME]` and `[FOUNDER BIO TO BE SUPPLIED]`.
- What a one-person studio means for the client.
- How I work: craft, performance and accessibility, in first person.
- Location: Wamuran, at the foot of the Glasshouse Mountains, serving SEQ.
- Nothing is invented.

### Step 7: Lab

- **Index:** a card grid with date, title (a stretched link), summary and tags.
- **Entry template:** hero, an optional demo stage, the Markdown body, and the CTA.
- **Demo loading.** The demo is chosen by the entry's `demo` key through `src/lab/demos.ts`, a map of dynamic imports. A page without a demo loads no demo code.
- **The "Light through stone" demo** (`src/lab/light-through-stone.ts`):
  - Raw WebGL2: a full-screen triangle from `gl_VertexID` running the site's own `noise.glsl` and `fissure-field.glsl`.
  - Range inputs for Heat (0–1.5) and Pulse speed (0–3).
  - Colours are read from the CSS tokens.
  - DPR is capped at 1.5.
  - It pauses offscreen and when the tab is hidden, and is disposed on page swap.
  - **4.5 KB gzipped** in total: its own 2.0 KB chunk plus the 2.5 KB shared GLSL chunk.
- **Still fallback.** A still `Picture` (captured from the demo) shows instead when any of these hold:
  - motion is reduced
  - the tier is Off/poster (the Lite tier is still allowed to run the demo, which is cheap)
  - WebGL2 is missing
  - the renderer is software
  - the shader fails

  The controls are revealed only when the demo is actually running.

### Step 8: contact brief and endpoint

**Form (`ContactForm.astro`, `src/lib/contact-form.ts`).**

- **Fields** are exactly as in BRIEF.md:
  1. What you need
  2. Budget
  3. Timeline
  4. Name, email, business, phone
  5. The message
- **Without JS:**
  - One page of five fieldsets that POSTs to `/api/contact`.
  - Success redirects to `/contact/thanks`.
  - Errors redirect back to `/contact#form-errors`, with the error summary and every answer preserved.
- **With JS:**
  - A multi-step form with a polite live "Step N of 5", Back and Next, and per-step validation.
  - Focus moves to each step's legend.
  - On failure the error summary takes focus and links to each field.
  - A sessionStorage draft (`monolith:brief`) survives a reload and is cleared on success.
  - The submission is sent as JSON. The success panel takes focus.
- **Accessibility:** fieldset/legend, real labels, radio groups, `autocomplete`, `aria-describedby` and `aria-invalid`.
- **Validator loading.** The validator (Zod) loads on demand, on first interaction with the form. The page's form script is 2.2 KB gzipped (it was 24 KB with Zod inline).

**Endpoint (`src/pages/api/contact.ts`, `src/lib/contact-server.ts`).**

- **Validation:** the same Zod schema as the browser (`src/lib/contact-schema.ts`).
- **Size limits:** bodies over 24 KB are rejected (400), and so is malformed JSON.
- **Spam checks:**
  - a honeypot field
  - a signed start time (an HMAC of the time the form was served), which rejects anything under 3 s or over 24 h
  - a per-IP rate limit of 5 per 10 minutes

  All three reject silently. The response is identical to a success, so it never reveals which check failed.
- **Sending:**
  - Resend's REST API with `reply_to` set to the enquirer.
  - An HTML body (every value escaped) and a plain-text body.
  - **No auto-reply.**
- **Responses:** JSON for JS clients (200, 422 with field errors, 502 on a send failure) and 303 redirects otherwise.
- **Logging:** only the Resend status code. Never the message, the enquirer's details or the key.
- **Other methods:** 405. Cross-site form posts are refused by Astro's origin check (403).
- **No-JS errors:** they round-trip through short-lived (120 s), httpOnly, chunked flash cookies, scoped to `/contact` and cleared once read.
- **Success copy:** "Message received. *The stone is listening.*", then `[REPLY TIME TO BE SUPPLIED]`, then the booking option.

### Step 9: booking

- **Button.** "Book a call" appears only with JS.
- **Lazy load.** Clicking it loads Cal.com's documented embed loader and an inline month view. Nothing is requested from Cal.com before the click (verified).
- **Theme:** dark, with the brand colour read from the `--lava` token at runtime (no hex in code).
- **Fallbacks.** If the script fails or no calendar appears within 10 s, the status message points to the plain booking-page link. With no JS, the plain link is all there is.
- **Configuration.** The URL is a single config value, `SITE.bookingUrl` in `src/lib/site.ts`, currently `[CAL.COM BOOKING URL]`. While it is a placeholder, the button explains that online booking isn't set up yet.

### Step 10: 404 and polish

- **404:** "Off the map" copy, with links back to the monolith, the work, and Start a project.
- **Navigation state.** The nav sets `aria-current="page"` on the exact page and `"true"` on its section (e.g. a case study under Work). Both have a visible underline, and the CTA gets a ring.
- **Titles and descriptions.** Every page has a unique title and meta description (verified across all 12 routes).

### Step 11: tests

| Test | Result |
|---|---|
| `npm run test:contact` (new, `scripts/test-contact.ts`): 17 tests against the built Vercel function with Resend mocked | All pass. Covers valid JSON and no-JS sends, escaping, no auto-reply, 422 errors, the no-JS error round trip with values kept, honeypot, fast/forged/expired timestamps, rate limit, missing forwarding headers, oversized and malformed bodies, provider failure, other methods, cross-site posts, and that logs contain no message, details or key |
| All 12 routes × 1440×900 and 390×844 × JS / no JS / reduced motion (72 loads) | No page errors, no horizontal overflow, exactly one `h1`, no reveal left hidden, every image has dimensions, unique titles |
| Full no-JS submission in a real browser | Native validation blocks an empty form. With validation stripped, the server round trip shows 6 summary errors with every value kept. A valid brief lands on `/contact/thanks` and the mock received the email |
| Keyboard-only multi-step | The summary takes focus on an empty step. Arrow and Space choose radios. Focus lands on each legend, and "Step N of 5" updates. Back keeps answers. A bad email sets `aria-invalid` and `aria-describedby`. The draft survives a reload. Success focuses the heading and clears the draft |
| Home ↔ Work/Services/Lab round trips, ×3 | 23 triggers on home every time, the story restores to `full`, and the content pages are back to 0 or 1 live triggers after scrolling |
| Booking | No Cal.com request before the click. With a URL configured and the script blocked, it falls back with a message |
| `build`, `lint`, `format:check`, `check:camera` | Clean. The only build warning is the intentional placeholder report |

## Deviations from the spec, and why

1. **`/contact` is rendered on demand, not static.**
   - It needs a fresh signed timestamp on every request, and it shows no-JS validation errors from the flash cookies, with `cache-control: no-store`.
   - `/contact/thanks` and every other page stay static. Only `/contact` and `/api/contact` reach the Vercel function.
2. **Business and phone are optional.**
   - Many enquirers (musicians, clubs, people starting out) have no separate business name or would rather not give a phone number.
   - Name, email, the three choices and the message are required. The email shows "(not given)" for missing optional fields.
3. **No extra secret for the timestamp.**
   - The HMAC key is derived from `RESEND_API_KEY` (never the key itself), so the deployment needs no additional environment variable.
   - Without a key (local dev), a per-process random key is used.
4. **Silent rejections return a fake success.**
   - This is how "never reveal which check failed" is implemented.
   - A real person who trips one (e.g. an autofill filling the honeypot) would see a success and send nothing. The honeypot is `aria-hidden`, has `tabindex="-1"` and `autocomplete="off"`, and is positioned offscreen to make that unlikely.
5. **The rate limit is per serverless instance, in memory.** This is best effort. A shared store (Vercel KV/Upstash) would make it global; I didn't add one, to avoid a new dependency and service.
6. **The footer's "Have a project in mind?" lead was changed (a Phase 1 component).**
   - It is hidden on pages that already end on their own CTA (work, case studies, services, about, lab), and on contact and thanks.
   - Otherwise the content pages ended in two near-identical CTAs back to back.
   - The home and 404 pages keep it. BaseLayout has a new `footerCta` prop.
7. **Lab tier rule.** The demo runs on Lite as well as High and Medium. It is cheap, and the scene is paused on content pages. Only the poster tier, reduced motion and software renderers get the still.
8. **The concept entry's title is `[CONCEPT PROJECT]`, and its subject is `[SUBJECT TO BE CHOSEN]`.** No subject is invented.
9. **Validator loading.** The client validator loads on demand rather than with the page (performance; see the bundle table).

## Content schemas

### `work` (`src/content/work/*.md`)

| Field | Type | Notes |
|---|---|---|
| `title` | string | |
| `client` | string | |
| `clientType` | string | e.g. "Sporting club" |
| `year` | `"2025"`-style four digits, or a bracketed placeholder | |
| `liveUrl` | URL, optional | Omitted for concepts |
| `summary` | string | One line |
| `order` | integer | List order and the next-project loop |
| `isConcept` | boolean | Labels the card and page |
| `cover`, `coverAlt` | image, string | |
| `gallery` | optional array of `{ type: 'image', src: image, alt, wide = true }` or `{ type: 'video', src: '/public-path.mp4', poster: image, description }` | |
| `challenge` | string | |
| `decisions` | at least one `{ area: 'design' \| 'technical' \| 'accessibility', text }` | |
| `results` | optional `{ lighthouse?: { performance, accessibility, bestPractices, seo } (0–100), notes?: string[] }` | Real numbers only; the section is omitted when absent |
| `quote` | optional `{ text, name, role }` | Real quotes only; omitted when absent |
| `seo` | optional `{ title?, description? }` | |

### `lab` (`src/content/lab/*.md`)

| Field | Type | Notes |
|---|---|---|
| `title` | string | |
| `date` | date (coerced) | |
| `summary` | string | |
| `cover`, `coverAlt` | image, string, both optional | |
| `demo` | optional key in `src/lab/demos.ts` | |
| `tags` | string[] | Default `[]` |

### Enquiry (`src/lib/contact-schema.ts`, shared by the browser and the server)

| Field | Rule |
|---|---|
| `need` | `new-website` \| `redesign` \| `something-else` |
| `budget` | `under-x` \| `x-to-y` \| `over-y` \| `not-sure` |
| `timeline` | `asap` \| `1-3-months` \| `flexible` |
| `name` | 1–100 characters |
| `email` | A valid email, up to 200 characters |
| `business` | Optional, up to 120 characters |
| `phone` | Optional, up to 40 characters; digits, spaces and `+ ( ) . -` |
| `message` | 10–4,000 characters |

The step data (choices and labels) lives in the Zod-free `contact-fields.ts`.

## Placeholders still to supply, by page

`npm run build` prints the current list on every build.

| Page | Placeholders |
|---|---|
| **Every page** (footer, nav) | `[STUDIO EMAIL]`, `[ABN]`, `[SOCIAL LINKS]` |
| **Home** | Package prices `[$ PRICE]` ×3. Care and hosting `[DETAILS TO BE SUPPLIED]`. The work cards show the year and concept placeholders below |
| **Work index** | `[YEAR TO BE SUPPLIED]` ×3, `[CONCEPT PROJECT]`, the three cover images |
| **SEQDVGC case study** | `[YEAR TO BE SUPPLIED]`, `[CHALLENGE TO BE SUPPLIED]`, a design, technical and accessibility decision each `[… DECISION TO BE SUPPLIED]`, `[COVER IMAGE TO BE SUPPLIED]`, the screen recording and `[SCREEN RECORDING DESCRIPTION TO BE SUPPLIED]`, `[DESKTOP SCREENSHOT TO BE SUPPLIED]`, `[MOBILE SCREENSHOT TO BE SUPPLIED]`. Results and quote are omitted until real ones exist |
| **Allen Gillon case study** | `[YEAR TO BE SUPPLIED]`, `[CHALLENGE TO BE SUPPLIED]`, design and technical decisions (the accessibility ones are real), `[COVER IMAGE TO BE SUPPLIED]`, the desktop and mobile screenshots |
| **Concept case study** | `[CONCEPT PROJECT]`, `[SUBJECT TO BE CHOSEN]`, `[YEAR TO BE SUPPLIED]`, `[CHALLENGE TO BE SUPPLIED]`, all three decisions, `[CONCEPT COVER IMAGE TO BE SUPPLIED]` |
| **Services** | `[$ PRICE]` ×3, `[WHAT’S INCLUDED TO BE SUPPLIED]` ×3, care and hosting `[DETAILS TO BE SUPPLIED]`, `[ANSWER TO BE SUPPLIED]` ×6 FAQ |
| **About** | `[FOUNDER NAME]`, `[FOUNDER PHOTO TO BE SUPPLIED]`, `[FOUNDER BIO TO BE SUPPLIED]` |
| **Lab** | None; the entry is real |
| **Contact** | Budget bands `[$X]` and `[$Y]`, `[CAL.COM BOOKING URL]`, `[STUDIO EMAIL]` |
| **Contact success and `/contact/thanks`** | `[REPLY TIME TO BE SUPPLIED]`, `[CAL.COM BOOKING URL]` |

**To replace media,** drop the real files over `src/assets/placeholders/*` and `public/media/seqdvgc-recording.mp4` (or point the entries at new files). Then update each `alt`, `coverAlt` and video `description`. Remove the placeholder generator once nothing uses it.

## Environment variables and Resend setup

The variables are listed in `.env.example`.

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | A Resend API key with sending permission. It also derives the form-timestamp signing key |
| `CONTACT_TO_EMAIL` | Where enquiries arrive: [STUDIO EMAIL] |
| `CONTACT_FROM_EMAIL` | The sender, e.g. `Monolith Web Studio <website@yourdomain>` |
| `RESEND_API_BASE` | Tests only. Never set it in production |

Still needed before launch:

1. Create a Resend account and an API key.
2. **Verify the sending domain in Resend** (the SPF and DKIM DNS records it gives you). Until then, Resend's test sender `onboarding@resend.dev` only delivers to the account owner's own address.
3. Set the three variables in Vercel → Project → Settings → Environment Variables, for Production (and Preview if wanted).
4. Send one real enquiry from the deployed site and reply to it, to confirm `reply_to` reaches the enquirer.

If the variables are missing, the endpoint responds as a send failure (502 / "couldn't send") rather than pretending to succeed.

## Performance

### Lighthouse, mobile

Three runs each, against the production build served locally (static files plus the real Vercel function).

| Page | Performance | Accessibility | Best practices | SEO | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|
| Home `/` | 99 / 99 / 98 | 100 | 100 | 100 | 1.7–2.1 s | 0–60 ms | 0 |
| Case study `/work/seqdvgc` | 98 / 98 / 98 | 100 | 100 | 100 | 2.3 s | 20–40 ms | 0 |
| Services | 97 / 100 / 98 | 100 | 100 | 100 | 1.7–2.0 s | 0–160 ms | 0 |
| Contact | 98 / 98 / 98 | 100 | 100 | 100 | 2.1 s | 0–10 ms | 0.022 |
| Work index | 99 / 98 / 98 | 100 | 100 | 100 | 2.0–2.1 s | 10–110 ms | 0 |
| About | 99 / 99 / 94 | 100 | 100 | 100 | 2.0–2.9 s | 0–90 ms | 0 |
| Lab entry | 99 / 97 / 99 | 100 | 100 | 100 | 2.1–2.3 s | 0–100 ms | 0 |

Before the validator split and the eager thumbnail, Contact measured 95/95/96 with an LCP of 2.5–2.6 s, and Work 95/95/94 with an LCP of 2.9 s.

### JavaScript per page

Gzipped, with reduced motion. With motion allowed, GSAP and the reveals load after first paint.

| Page | Initial JS | Loaded after first paint |
|---|---|---|
| Content pages (work, case study, services, about, lab) | 11.3 KB | `reveal` + GSAP 44.7 KB + SplitText 3.3 KB, only if motion is allowed |
| Lab entry | 12.0 KB | Demo 4.5 KB (WebGL2 only) |
| Contact | 13.5 KB | Validator (Zod) 22.7 KB, on first interaction with the form |
| Home | Unchanged from Phase 2.5 | Scene chunk 153 KB, layers 20 KB (unchanged) |

## Known issues

- **Live hardware testing.**
  - The live demo couldn't be watched on real hardware here. SwiftShader is a software renderer, which the demo correctly declines, so the tests saw the still.
  - The still itself was captured from the demo running in this container with that check bypassed.
  - Check it on a real GPU, including the range inputs, and on a phone.
- **Mocked services.**
  - Resend was only ever mocked. No real email has been sent.
  - The Cal.com embed hasn't been seen against a real Cal.com account (the URL is a placeholder). Only the lazy load and the fallback path were tested.
- **The rate limit is per instance** (see Deviations).
  - Requests with no forwarding header share one bucket. Vercel always sets `x-forwarded-for`, so this only affects local tools.
- **Contact CLS of 0.022.** It comes from the mono font swapping inside the first fieldset. That is well under 0.1, and not worth preloading a third font for.
- **Placeholder images are PNG sources.** They are converted to AVIF and WebP at build time. The real screenshots should be supplied at 1600 px or wider.
- **The placeholder tool needs ffmpeg.** `npm run placeholders` needs ffmpeg with libx264 for the recording stand-in. It is a one-off tool and not part of the build.

## What Phase 4 needs to know

### Per-page camera framings

- **The canvas is dormant on content pages today.**
  - `scene-boot.ts` keys everything off `[data-scene-anchor]`, which only the home page has.
  - Without an anchor, the stage gets `.is-dormant` (the CSS dims it to 32% opacity) and `handle.pause()` stops rendering.
  - Behind a content page you see the last rendered frame if the visitor came from home, or the poster otherwise.
  - **If a visitor's first page is a content page, the scene is never loaded at all.** Keep that property: content pages must not pay for the scene unless Phase 4 deliberately decides otherwise.
- **To add per-page framings:**
  - Give each content page a framing name, e.g. `<main data-scene-frame="work">`.
  - Add a `setFraming(name)` to the scene's public API (`createScene` in `src/scene/index.ts`) that tweens the camera to a fixed pose, separate from the scroll-driven `camera-path.ts`.
  - Have `onPage()` call it when the scene is already loaded. Decide per tier whether a content page wakes the scene at all: Lite and Poster should probably stay dormant.
- **Keep content-page reveals independent of the scene.**
  - They mount through `mountPageReveals()` and never touch the story.
  - `__monolith.state().triggers` is the check that nothing leaks. It should return to the home baseline (23) after any round trip.

### Page transitions with the persistent canvas

- **The persistent stage.** It is in `BaseLayout` with `transition:persist`. Its state survives swaps, and `stampIncoming()` copies the tier and story attributes onto the incoming document before the swap, so there's no flash.
- **Hook order a transition must respect:**
  1. `astro:before-swap`: story unmount, page-reveal unmount, and the work-preview and demo cleanup (AbortControllers). The swap animation must start after these, or reuse `before-preparation` for the visual only.
  2. `astro:page-load`: `onPage()` decides dormant or active and mounts the story or reveals.
- **No Lenis on content pages.** A transition that reads scroll positions should use `window.scrollY` there.
- **Pages with their own lifecycles:**
  - `/contact` is rendered on demand. A transition into it waits on a function response (cold starts are possible); give it a loading state, not a fixed-duration animation.
  - The contact form, booking and lab demo initialise on `astro:page-load` and are idempotent (`data-enhanced`, `data-book-ready`). Keep it that way if transitions re-run hooks.
- **Reduced motion.** Transitions must be instant with reduced motion. Content-page reveals already skip GSAP entirely in that case.

### New scripts

- `npm run test:contact`: the endpoint tests. Run it after `npm run build`.
- `npm run placeholders`: regenerates the placeholder media.
