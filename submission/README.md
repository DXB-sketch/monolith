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

> These were captured while the site still had placeholder content (bracketed
> text, placeholder images). **Re-capture before submitting**, once every
> placeholder is filled.

## Screenshots (`screenshots/`)

Desktop, High tier, at 1600×1200 and 2560×1440 (`1600x1200-…`, `2560x1440-…`),
and phone, Lite tier, 390×844 at 3× pixel density (`phone-390x844-…`, 1170×2532
pixels):

(Lite renders the scene at a reduced resolution by design, which shows at 3×;
for a phone shot with the full scene, use a High-tier device.)

| File                     | What it shows                                             |
| ------------------------ | --------------------------------------------------------- |
| `…-home-00-arrival.jpg`  | Home, Chapter 00: the monolith at dusk, the hero headline |
| `…-home-01-face-i.jpg`   | Home, Chapter 01: the first project face (SEQDVGC)        |
| `…-home-02-face-ii.jpg`  | Home, Chapter 02: the second project face (Allen Gillon)  |
| `…-home-03-the-lab.jpg`  | Home, Chapter 03: the Lab and the concept project         |
| `…-home-04-the-core.jpg` | Home, Chapter 04: the core and the services summary       |
| `…-home-05-the-dive.jpg` | Home: the dive into the core fissure                      |
| `…-work.jpg`             | The Work index                                            |
| `…-case-study.jpg`       | A case study (SEQDVGC)                                    |
| `…-services.jpg`         | Services and pricing                                      |
| `…-contact.jpg`          | Contact: the project brief form and booking               |

## Recording

- `monolith-recording-1080p60.mp4`: H.264, 1920×1080, 60 fps
- `monolith-recording-1080p60.webm`: VP9, 1920×1080, 60 fps

About 30 seconds: the home story from the arrival to Face I, into the SEQDVGC
case study through its card (the page transition), a look down the case study,
back to the story (restored where it was left), then Face II, the Lab, the Core
and the dive. No sound.
