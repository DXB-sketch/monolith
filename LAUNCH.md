# LAUNCH.md — Monolith Web Studio

Your step-by-step checklist for putting the site live on **monolithstudio.au**, hosted on
**Cloudflare**. Everything here needs your accounts or your decision, so none of it has
been done for you. Work through the groups in order: each one depends on the one before.

> **How it's hosted.** The site is built by Astro with the Cloudflare adapter. Every page
> except the contact page is static and served straight from Cloudflare's edge; the
> contact page and its form endpoint (`/api/contact`) run in a small Cloudflare Worker.
> Both are deployed together as one Worker called `monolith` (see `wrangler.jsonc`).
> Cloudflare's free plan covers it.

> **The placeholder gate.** Builds of `main` on Cloudflare **refuse to deploy while any
> bracketed placeholder is left** (step 1). Builds of other branches only warn. Until a
> build succeeds, Cloudflare keeps serving the last good version, so nothing breaks for
> visitors.

---

## 1. Content

All the required content is in. A strict build (`STRICT_CONTENT=1 npm run build`, the
way `main` builds on Cloudflare) ends with `Placeholder gate: nothing left to supply.`

Optional, whenever you're ready (none of these block a launch):

- [ ] **ABN** (`abn` in `src/lib/site.ts`): once set, it appears in the footer.
- [ ] **Your photo:** save it as `src/assets/founder.jpg` (or `.png`/`.webp`), portrait,
      at least 1000 px wide. The About page picks it up automatically.
- [ ] **Social links** (`socials` in `src/lib/site.ts`), only real profiles: they add a
      footer column and feed the structured data.
- [ ] **A concept project** (`src/content/work/concept.md`, currently `draft: true` and
      left out of the build). Fill it in and remove `draft: true` when you have one; it
      must stay clearly labelled as a concept.
- [ ] **Sharing images:** after changing any page headline or case study title, run
      `npm run dev` and then `npm run og` (in another terminal) so the Open Graph images
      match.

---

## 2. Cloudflare account and domain

- [ ] Create a Cloudflare account (free plan) if you don't have one.
- [ ] **Add the domain:** Cloudflare dashboard → **Add a domain** → `monolithstudio.au` →
      Free plan. Cloudflare shows two nameservers. At the registrar where you bought the
      domain, replace its nameservers with those two. Wait until Cloudflare marks the
      domain **Active** (often within an hour; up to a day).
- [ ] **SSL/TLS → Edge Certificates:** turn on **Always Use HTTPS**.
- [ ] **Turn off the features that rewrite pages** (they would break the site's security
      policy or its no-JavaScript links):
  - **Speed → Optimization → Content Optimization → Rocket Loader:** Off.
  - **Scrape Shield → Email Address Obfuscation:** Off. (It replaces the `mailto:`
    links with a script-based version, which doesn't work without JavaScript.)

### Email for `inquiry@monolithstudio.au`

Receiving and sending are separate:

- [ ] **Receiving (Cloudflare Email Routing):** your domain → **Email → Email Routing** →
      enable it (it adds the MX and SPF records for you) → add a route from
      `inquiry@monolithstudio.au` to your personal inbox, and confirm the email it sends.
- [ ] **Sending the form's emails (Resend):** create a Resend account → **Domains** →
      add `monolithstudio.au`. Resend lists DNS records (on a `send.` subdomain and a
      DKIM `resend._domainkey` record); add each in Cloudflare → **DNS → Records**, with
      the proxy **off** (grey cloud, "DNS only"). Wait until Resend marks the domain
      **Verified**. They don't clash with Email Routing's records.
- [ ] In Resend, create an API key with **sending access** only. Keep it for step 3.

---

## 3. Deploying

The site's code is on the branch `claude/new-session-behumn`, in pull request
[DXB-sketch/monolith#7](https://github.com/DXB-sketch/monolith/pull/7), not yet merged.

- [ ] **Stop Vercel first.** In Vercel → the monolith project → **Settings → Git** →
      **Disconnect** (or delete the project). Once this PR is merged, Vercel can't build the
      site any more (it now uses the Cloudflare adapter), so it would only report failed
      builds. Keep the Vercel project around until Cloudflare is live if you want a fallback;
      just disconnect Git.
- [ ] **Merge PR #7** on GitHub (a normal merge commit is fine).
- [ ] **Create the Worker from GitHub:** Cloudflare → **Workers & Pages** → **Create** →
      **Import a repository** → connect GitHub and pick `DXB-sketch/monolith`. Settings:

  | Setting           | Value                 |
  | ----------------- | --------------------- |
  | Project name      | `monolith`            |
  | Production branch | `main`                |
  | Build command     | `npm run build`       |
  | Deploy command    | `npx wrangler deploy` |
  | Root directory    | (leave empty)         |

  The Node version comes from `.node-version` (22). Every push to `main` then builds and
  deploys; pushes to other branches build a preview version with its own URL (the
  placeholder gate only warns there, and previews are marked `noindex`).

- [ ] **Secrets:** Workers & Pages → `monolith` → **Settings → Variables and Secrets** →
      **Add**, type **Secret**, one for each:

  | Name                 | Value                                                                                  |
  | -------------------- | -------------------------------------------------------------------------------------- |
  | `RESEND_API_KEY`     | the key from Resend (it never reaches the browser)                                     |
  | `CONTACT_TO_EMAIL`   | `inquiry@monolithstudio.au` (or wherever you want briefs)                              |
  | `CONTACT_FROM_EMAIL` | `Monolith Web Studio <website@monolithstudio.au>` (any address on the verified domain) |

  Then redeploy (Deployments → the latest → **Retry build**, or push a commit) so the
  Worker has them. Without them, the form shows "The brief couldn't be sent just now"
  and nothing is emailed. Preview versions share the same secrets, so a test brief sent
  from a preview is really emailed.

- [ ] Watch the build log. It should end with `Placeholder gate: nothing left to supply.`
      and `_headers written`, then the deploy. If it fails with `Placeholder gate: …`, read
      the list and fix it in step 1.

### Custom domain

- [ ] Workers & Pages → `monolith` → **Settings → Domains & Routes** → **Add** →
      **Custom domain** → `monolithstudio.au`. Cloudflare creates the DNS record and the
      HTTPS certificate (a few minutes).
- [ ] **`www` → the bare domain:** DNS → Records → add an `AAAA` record, name `www`,
      address `100::`, proxied (orange cloud). Then **Rules → Redirect Rules** → create
      from the template **"Redirect from WWW to Root"** (301, keep the path and query).
- [ ] Check: `https://monolithstudio.au` shows the site; `http://monolithstudio.au` and
      `https://www.monolithstudio.au/work` redirect to `https://monolithstudio.au/…`.
- [ ] Optional: once the custom domain works, turn off the `workers.dev` address in the
      same **Domains & Routes** panel, so the site has only one public address.
      (Canonical links already point at monolithstudio.au either way.)

### Analytics

- [ ] Cloudflare → **Analytics & Logs → Web Analytics** → **Add a site** → choose
      `monolithstudio.au` → **automatic setup** (Cloudflare adds its beacon to every page
      at the edge; the site's security policy already allows it).

It's cookieless, so no cookie banner is needed, and it doesn't record anything visitors
type. See "Reading the analytics" in step 5.

### Rolling back

Workers & Pages → `monolith` → **Deployments** → find the last good version → **…** →
**Rollback** (or "Deploy version"). The live site swaps back in seconds without touching
git. Afterwards, fix the problem with a `git revert` of the bad commit on `main` so the
next build is good too.

**HSTS and `preload`.** The site sends
`Strict-Transport-Security: max-age=63072000; includeSubDomains` (two years, every
subdomain). It deliberately does **not** include `preload`. Preloading bakes HTTPS-only
into browsers for your domain and **every subdomain**, and is slow to undo. Add it only
once the site and any subdomains have run on HTTPS for a few weeks: add `; preload` to
`HSTS` in `src/lib/security-policy.ts`, deploy, then submit the domain at
hstspreload.org.

---

## 4. Final checks on real devices

- [ ] **Frame rate:** open `https://monolithstudio.au/?fps` on your desktop, laptop and phone.
      The overlay shows the tier each device gets and the frame rate. Desktop/laptop
      should hold about 60 fps on High or Medium; a mid-range phone at least 30 fps on
      Lite. Scroll the whole home story and open a case study.
- [ ] **A real contact form submission,** end to end, from your phone, using an address
      you own. Check that the email arrives at `CONTACT_TO_EMAIL`, that replying goes to
      the address you entered, and that the success message shows.
- [ ] **Arrange a call:** tap "Arrange a call" on the contact page; your email app should
      open a new message to `inquiry@monolithstudio.au`.
- [ ] **The Lab demo:** open `/lab/light-through-stone` on your laptop. The live shader
      should replace the still, and both sliders should respond to dragging and to the
      arrow keys. (It couldn't be tried during the build: it deliberately refuses
      software renderers, and the build machine had no GPU.)
- [ ] **Firefox and Safari:** do the same checks once in each. To run the automated
      flows in them: `npx playwright install firefox webkit`, `npm run build`,
      `npm run serve:prod`, then `BROWSER=firefox npm run test:flows` and
      `BROWSER=webkit npm run test:flows`.
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

1. Load the home page. You should hear the page title, "Monolith Web Studio — Bribie Island,
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
6. On the success message, "Arrange a call" should be reachable and named.

**Mobile menu (iPhone only):** open the menu; it should say "expanded", list the pages,
and closing it should return focus to the menu button.

---

## 5. After launch

- [ ] **Google Search Console:** add the domain property (it'll ask for a DNS TXT
      record), then **Sitemaps** → submit `https://monolithstudio.au/sitemap-index.xml`. Check
      **Pages** after a few days for anything not indexed.
- [ ] **Google Business Profile:** set it up as a service-area business (Bribie Island, serving
      Moreton Bay, Sunshine Coast and Brisbane) **without a public street address**, using
      the same name, website and email as the site. Add the profile link to `socials` in
      `src/lib/site.ts`: that also adds it to the structured data's `sameAs`.
- [ ] **After a week, check analytics** (below).
- [ ] **Awards,** below, once everything else is done.

### Reading the analytics

Cloudflare → **Analytics & Logs → Web Analytics** → `monolithstudio.au`. It shows
visits, page views, top pages, referrers, countries, browsers and devices, and real
visitors' **Core Web Vitals** (LCP, INP, CLS) by page. Green is good. If mobile LCP is
amber or red on a page, that page's largest image or headline is arriving late.

Cloudflare Web Analytics has no custom events, so the finer signals the site measures
(which scene tier visitors get, how far they scroll the story, which calls to action they
use, where they leave the contact form) are not reported anywhere yet. The site still
raises them in the page as `monolith:analytics` events (`src/lib/analytics.ts` lists them
all, and none includes anything a visitor typed), so a privacy-friendly analytics service
with custom events can be connected later in one place, with a matching update to the
privacy page and the security policy.

### Award submissions

Submit only after the site is live on its real domain with all real content, and you're
happy with step 4. Each site judges design, usability, creativity and content; each
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
