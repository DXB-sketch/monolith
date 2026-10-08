# LAUNCH.md — Monolith Web Studio

Your step-by-step checklist for putting the site live on its real domain. Everything
here needs your accounts, your content or your decision, so none of it has been done for
you. Work through the groups in order: each one depends on the one before.

> **Important before you start:** once Phase 4 and 5 are merged into `main`, production
> builds **refuse to deploy while any placeholder is left** (step 1). That's on purpose.
> Until the content is in, Vercel keeps serving the last good production deployment, so
> nothing breaks for visitors; the new deployment simply shows as failed with the list of
> what's missing.

---

## 1. Content

The site still has bracketed placeholders like `[STUDIO EMAIL]` and `[$ PRICE]`. A
production build fails until every one is replaced; a preview build only warns.

**See the list:** run `npm run build` (or open any preview deployment's build log in
Vercel). Near the end, the placeholder gate prints everything still missing, grouped by
page, for example:

```
[WARN] [monolith-placeholder-report] 28 placeholders still to supply, on 14 pages:
  /: [STUDIO EMAIL], [$ PRICE], ...
  /about: [FOUNDER PHOTO TO BE SUPPLIED], [FOUNDER BIO TO BE SUPPLIED], ...
  /contact (on demand): [CAL.COM BOOKING URL], [$X], [$Y]
  /privacy: [REVIEW BEFORE LAUNCH]
  Site URL: [DOMAIN] (set PUBLIC_SITE_URL)
```

To check strictly on your own machine, the way production will: `STRICT_CONTENT=1 npm run build`.

Where things live:

- [ ] **Studio details** (`src/lib/site.ts`): studio email, founder name, ABN, social
      links (only real profiles: they also feed the structured data), and the Cal.com
      booking URL (`bookingUrl`, e.g. `https://cal.com/your-name/intro`).
- [ ] **Prices** (`src/lib/site.ts` packages and `src/lib/contact-fields.ts` budget
      ranges): every `[$ PRICE]`, `[$X]` and `[$Y]`.
- [ ] **About page** (`src/pages/about.astro`): founder photo and bio.
- [ ] **Case studies** (`src/content/work/*.md`): the bracketed facts, real screenshots
      and recordings (the image paths are in each file's front matter), and client quotes
      only if they are real and you have permission.
- [ ] **The concept project** (`src/content/work/concept.md`): choose the subject and
      fill it in. If you haven't chosen one by launch, set `draft: true` in its front
      matter: it is then left out of the build entirely (home page, Work, sitemap), and the
      gate no longer counts it.
- [ ] **Privacy page** (`src/pages/privacy.astro`): read it end to end. It describes
      only what the site does today (Resend, Vercel's cookieless analytics, Cal.com,
      session storage, the short-lived no-JS form cookie). It makes no claims about
      certifications or legal compliance; if you want legal review, now is the time. Then
      delete the `[REVIEW BEFORE LAUNCH]` line.
- [ ] **Sharing images:** after changing any page headline or case study title, rerun
      `npm run dev` and then `npm run og` (in another terminal) so the Open Graph images
      match. The concept's image shows its placeholder title until you do.
- [ ] Commit, push, and check a preview deployment: the build log should say
      `Placeholder gate: nothing left to supply.` apart from `[DOMAIN]`, which step 2 sets.

---

## 2. Accounts and keys

### Resend (the contact form's email)

- [ ] Create a Resend account and add your domain under **Domains**.
- [ ] Add the DNS records Resend shows you (SPF and DKIM, usually TXT and MX/CNAME
      records) at your domain registrar or DNS host. Wait until Resend marks the domain
      **Verified**.
- [ ] Create an API key with **sending access** only.

### Environment variables in Vercel

Project → **Settings → Environment Variables**. Add each one for **Production** (and
Preview too if you want previews to send real emails; without them, a preview's form
shows "The brief couldn't be sent just now" and nothing is emailed):

| Name                 | Value                                                                    |
| -------------------- | ------------------------------------------------------------------------ |
| `RESEND_API_KEY`     | the key from Resend (keep it secret; it never reaches the browser)       |
| `CONTACT_TO_EMAIL`   | where enquiries should arrive, e.g. your studio inbox                    |
| `CONTACT_FROM_EMAIL` | the sender, on your verified domain, e.g. `Monolith <hello@yourdomain>`  |
| `PUBLIC_SITE_URL`    | your final address, e.g. `https://yourdomain.com.au` (no trailing slash) |

`PUBLIC_SITE_URL` sets canonical URLs, the sitemap, `robots.txt`, structured data and
the Open Graph links. Until it's set, those use a placeholder origin and the gate lists
`[DOMAIN]`.

The Cal.com booking URL is not an environment variable: it lives in `src/lib/site.ts`
(step 1). If it ever points at a custom domain or self-hosted Cal.com, the build adds that
origin to the Content-Security-Policy automatically.

### Analytics and Speed Insights

- [ ] Project → **Analytics** → **Enable** (Web Analytics).
- [ ] Project → **Speed Insights** → **Enable**.

Both are cookieless, so no cookie banner is needed. The scripts are already in the site;
until you enable them, they simply have nothing to report to. Custom events (below) may
depend on your Vercel plan: check the Analytics page after enabling. If your plan doesn't
include them, page views and Speed Insights still work and the events are ignored.

---

## 3. Domain

- [ ] Buy the domain (or use one you own).
- [ ] Vercel project → **Settings → Domains** → add the apex (`yourdomain.com.au`) and
      `www.yourdomain.com.au`. Vercel shows the DNS records to add at your registrar.
- [ ] Choose one as primary and set the other to **redirect** to it (Vercel offers this
      when you add the second domain). Use the same one in `PUBLIC_SITE_URL`.
- [ ] Wait for both to show **Valid Configuration** and for HTTPS certificates to be
      issued (automatic, usually minutes).
- [ ] Visit `http://yourdomain…` and check it redirects to `https://`.
- [ ] Redeploy production after setting `PUBLIC_SITE_URL` (Deployments → … → Redeploy) so
      the canonical links pick it up.

**HSTS and `preload`.** The site already sends
`Strict-Transport-Security: max-age=63072000; includeSubDomains` (two years, every
subdomain). It deliberately does **not** include `preload`. Preloading bakes HTTPS-only
into browsers for your domain and **every subdomain**, and is slow to undo. Add it only
once the site and any subdomains (mail, booking, anything later) have run on HTTPS for a
few weeks: add `; preload` in `src/integrations/security-headers.ts`, deploy, then submit
the domain at hstspreload.org.

---

## 4. Git and deployment

The Vercel project already deploys **production from `main`** (`monolith-git-main…` is
the production alias), and the earlier issue (the working branch deploying as production)
is resolved. Phases 4 and 5 are on the branch `claude/new-session-behumn`, in pull request
[DXB-sketch/monolith#6](https://github.com/DXB-sketch/monolith/pull/6), and are not merged.

- [ ] Do steps 1–3 first, so that the merge can actually deploy.
- [ ] Confirm the production branch: Vercel project → **Settings → Git** →
      **Production Branch** should read `main`.
- [ ] Open PR #6 on GitHub, check its preview deployment (the link in the PR), then
      **Merge** (a normal merge commit is fine). The branch is up to date with `main`, so
      there are no conflicts to resolve.
- [ ] Watch the production deployment in Vercel. If the build fails with
      `Placeholder gate: …`, read the list and go back to step 1. The live site doesn't
      change until a production build succeeds.

**Rolling back.** Vercel project → **Deployments** → find the last good production
deployment → **…** → **Promote to Production** (or "Instant Rollback"). That swaps the
live site back in seconds without touching git. Afterwards, fix the problem with a
`git revert` of the bad commit on `main` so the next deployment is good too.

**Node version.** The Vercel project is set to Node 24.x and `package.json` asks for
22.x; builds work on both. If Vercel ever warns about the mismatch, set the project's
Node.js version (Settings → General) to 22.x to match.

---

## 5. Final checks on real devices

- [ ] **Frame rate:** open `https://yourdomain/?fps` on your desktop, laptop and phone.
      The overlay shows the tier each device gets and the frame rate. Desktop/laptop
      should hold about 60 fps on High or Medium; a mid-range phone at least 30 fps on
      Lite. Scroll the whole home story and open a case study.
- [ ] **A real contact form submission,** end to end, from your phone, using an address
      you own. Check that the email arrives at `CONTACT_TO_EMAIL`, that replying goes to
      the address you entered, and that the success message shows.
- [ ] **Book a call:** tap "Book a call" on the contact page; the Cal.com calendar should
      open inline (or the plain link, if Cal.com is blocked).
- [ ] **Screen reader test,** below.
- [ ] **Sharing:** paste your home page and a case study URL into a message to yourself
      (or LinkedIn's Post Inspector) and check the preview image and title.

### Screen reader test script

About 20 minutes. Do it once with **VoiceOver on iPhone** and once with **NVDA** (free) or
**Narrator** (built in) on Windows. Write down anything that is silent, repeated,
confusing or out of order.

**Starting:**

- iPhone: Settings → Accessibility → VoiceOver → On. Swipe right/left to move, double-tap
  to activate, rotor (two-finger twist) → Headings to jump between headings.
- Windows NVDA: `Ctrl+Alt+N` to start; `H` jumps by heading, `D` by landmark, `Tab` by
  link/control, `Insert+F7` lists all links and headings. Narrator: `Ctrl+Win+Enter`;
  `Caps Lock+H` by heading.

**Home page (the story):**

1. Load the home page. You should hear the page title, "Monolith Web Studio — Wamuran,
   Queensland", and nothing about a canvas or animation.
2. The first control is "Skip to content". Activate it: focus moves to the main content.
3. Move by headings: the hero headline, then each chapter (Arrival, Face I, Face II, The
   Lab, The Core), then the closing call to action. Everything visible should be read; no
   chapter should be skipped or read twice.
4. Find the "Start a project" link and the chapter links; each name should make sense
   on its own.
5. Find the sound button: it should say whether sound is on or off ("pressed"/"not
   pressed"). Leave it off.

**A case study:**

1. From the menu, go to Work, then open SEQDVGC. After the page changes, the screen
   reader should announce the new page (its heading or title), not stay silent.
2. Move by headings through the case study: The challenge, Key decisions, Visuals,
   Results, then the next project. Images should have a description, or be skipped if decorative.
3. Use Back (browser back, or the "back to Work" link) and check you land somewhere
   sensible.

**The contact form:**

1. Open Contact. Move to the form: "Step 1 of 5" should be announced.
2. Choose a need, then "Next": focus moves to the next step's question, which is read.
3. On a step, press "Next" without choosing: the error should be read out, and focus or
   the announcement should tell you what's wrong.
4. On "Your details", the privacy note and its link should be read before the fields.
   Each field's label is read when it receives focus.
5. Fill in your own details and send. "Sending…" then the success heading should be
   read.
6. On the success message, "Book a call" should be reachable and named.

**Mobile menu (iPhone only):** open the menu; it should say "expanded", list the pages,
and closing it should return focus to the menu button.

---

## 6. After launch

- [ ] **Google Search Console:** add the domain property (it'll ask for a DNS TXT
      record), then **Sitemaps** → submit `https://yourdomain/sitemap-index.xml`. Check
      **Pages** after a few days for anything not indexed.
- [ ] **Google Business Profile:** set it up as a service-area business (Wamuran, serving
      Moreton Bay, Sunshine Coast and Brisbane) **without a public street address**, using
      the same name, website and email as the site. Add the profile link to `socials` in
      `src/lib/site.ts`: that also adds it to the structured data's `sameAs`.
- [ ] **After a week, check analytics** (below).
- [ ] **Awards,** below, once everything else is done.

### Reading the analytics

Vercel project → **Analytics**. The top of the page shows visitors, page views, top
pages, referrers, countries and devices. Scroll to **Events** for the custom events; click
an event to break it down by its properties.

| Event            | Properties                                                                                                                                                                                                                      | What it tells you                                                                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scene_tier`     | `tier` (high, medium, lite, poster, pending), `live`, and `reason` when poster                                                                                                                                                  | What visitors actually get. A high share of `poster` with `reason: weak-gpu` or `software-renderer` means many visitors see the still image; `reduced-motion` and `save-data` are visitors' own settings. `pending` means they left before the GPU check finished. |
| `story_progress` | `chapter` (arrival … the-core, the-dive), `index` 0–5                                                                                                                                                                           | How far people get through the home story (sent once, when they leave it). If most stop at `arrival`, the opening isn't pulling them in.                                                                                                                           |
| `cta_click`      | `button` (start_project, book_call), `placement` (`nav`, `footer`, or the section it sits in: `arrival` is the home hero, `plain` the home page's closing call to action, `next-step` the closing block on other pages), `page` | Which calls to action work, and where.                                                                                                                                                                                                                             |
| `contact_step`   | `step` 2–5, `name`                                                                                                                                                                                                              | How far people get through the form. A big drop at one step points at that question.                                                                                                                                                                               |
| `contact_submit` | (none)                                                                                                                                                                                                                          | Briefs sent. Compare with `contact_step` 5 for the last-step drop-off.                                                                                                                                                                                             |
| `sound_on`       | `page`                                                                                                                                                                                                                          | How many people try the sound.                                                                                                                                                                                                                                     |
| `intro_skipped`  | (none)                                                                                                                                                                                                                          | How often the opening intro is cut short by a tap or key.                                                                                                                                                                                                          |

None of these include anything a visitor typed.

**Speed Insights** (its own tab) shows real visitors' Core Web Vitals (LCP, INP, CLS) by
page and device. Green is good. If mobile LCP is amber or red on a page, that page's
largest image or headline is arriving late.

### Award submissions

Submit only after the site is live on its real domain with all real content, and you're
happy with step 5. Each site judges design, usability, creativity and content; each
charges a submission fee (check the current fee on the submission page).

What's ready in `submission/` (see its README): desktop screenshots at 1600×1200 and
2560×1440, phone screenshots at 390×844, and a 1080p 60 fps screen recording (MP4 and
WebM).

- [ ] **Awwwards** (awwwards.com → Submit): the live URL, a title and short
      description, category tags, the main colours and fonts (Sora, JetBrains Mono),
      technologies (Astro, Three.js, GSAP, Lenis), a thumbnail (a 1600×1200 screenshot)
      and optional extra images or video.
- [ ] **CSS Design Awards** (cssdesignawards.com → Submit): the URL, a description,
      screenshots and categories. Judged on UI, UX and innovation.
- [ ] **FWA** (thefwa.com → Submit): the URL, a description, the technologies used, and
      a thumbnail and video. FWA leans towards experiences, so lead with the recording.

Use the same short description everywhere, written in the first person (it's a
one-person studio), and only true claims.
