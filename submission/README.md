# Submission assets

Screenshots and a screen recording for award submissions (Awwwards, CSS Design
Awards, FWA). This folder is not part of the website: nothing here is deployed.

Everything was rendered by `npm run capture` against a production build, on
the High tier (phone shots on Lite), in deterministic capture mode: the page's
clock advances exactly 1/60 s per frame, so motion is smooth and repeatable even
without a GPU. Re-run it after the real content is in (it overwrites these
files):

```
npm run build
npm run serve:prod          # in another terminal
npm run capture             # or: npm run capture -- screenshots | recording
```

Since Phase 6 the home page is 2D by default and the 3D story lives at
`/potential` ("See the potential"), so the story's stills and the recording are
taken there (the capture passes its device check with the forced tier first).

## Screenshots (`screenshots/`)

The 2D home page (Phase 6), at 1440×900 (`1440x900-…`) and on a phone, 390×844
at 3× (`phone-390x844-…`):

| File                      | What it shows                                                   |
| ------------------------- | --------------------------------------------------------------- |
| `…-home-hero.jpg`         | The hero: headline, facts and the stone (frame 0)               |
| `…-home-hero-turning.jpg` | Half a viewport down: the stone part-way through its turn       |
| `…-home-full.jpg`         | The whole landing page (reduced motion: every section in place) |

The 3D story and the content pages:

Desktop, High tier, at 1600×1200 and 2560×1440 (`1600x1200-…`, `2560x1440-…`),
and phone, Lite tier, 390×844 at 3× pixel density (`phone-390x844-…`, 1170×2532
pixels):

(Lite renders the scene at a reduced resolution by design, which shows at 3×;
for a phone shot with the full scene, use a High-tier device.)

| File                          | What it shows                                                  |
| ----------------------------- | -------------------------------------------------------------- |
| `…-potential-00-arrival.jpg`  | The story, Chapter 00: the monolith at dusk, the hero headline |
| `…-potential-01-face-i.jpg`   | Chapter 01: the first project face (SEQDVGC)                   |
| `…-potential-02-face-ii.jpg`  | Chapter 02: the second project face (Allen Gillon)             |
| `…-potential-03-the-lab.jpg`  | Chapter 03: the Lab                                            |
| `…-potential-04-the-core.jpg` | Chapter 04: the core and the services summary                  |
| `…-potential-05-the-dive.jpg` | The dive into the core fissure                                 |
| `…-work.jpg`                  | The Work index                                                 |
| `…-case-study.jpg`            | A case study (SEQDVGC)                                         |
| `…-services.jpg`              | Services and pricing                                           |
| `…-contact.jpg`               | Contact: the project brief form                                |

## Recording

- `monolith-recording-1080p60.mp4`: H.264, 1920×1080, 60 fps
- `monolith-recording-1080p60.webm`: VP9, 1920×1080, 60 fps

About 35 seconds: the 3D story at `/potential` from the arrival to Face I, into the SEQDVGC
case study through its card (the page transition), a look down the case study,
back to the story (restored where it was left), then Face II, the Lab, the Core
and the dive. No sound.
