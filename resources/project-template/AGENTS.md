# HyperFrames Composition Project

## Skills

This project uses AI agent skills for framework-specific patterns. Install them if not already present:

```bash
npx skills add heygen-com/hyperframes
```

Skills encode patterns like `window.__timelines` registration, `data-*` attribute semantics, Tailwind v4 browser-runtime styling for `--tailwind` projects, and shader-compatible CSS rules that are not in generic web docs. Using them produces correct compositions from the start.

## Commands

```bash
npm run check        # lint + validate + inspect
npx hyperframes docs <topic> # reference docs in terminal
```

## Project Structure

- `index.html` — main composition (root timeline)
- `compositions/` — sub-compositions referenced via `data-composition-src`
- `assets/` — media files (video, audio, images)
- `.tinyfilm/transcripts/` — generated word-level or segment-level transcript JSONs
- `meta.json` — project metadata (id, name)

## Opinionated Workflow: Media & Captions

When editing clips and generating captions for a TikTok/Reel:

1. **The Audio Lock & Zero Volume:** Every video must be accompanied by an `<audio>` tag. The `<video>` and `<audio>` tag for a specific clip MUST share the exact same `data-start`, `data-duration`, and `data-media-start` values. **Crucially**, the `<video>` MUST have both `muted` AND `data-volume="0"` attributes. Without `data-volume="0"`, the browser will play the video's internal audio track alongside your `<audio>` element, causing a "double audio" echo.
2. **Prevent Track Collisions:** Both the `<video>` and `<audio>` must have `class="clip"`. Sequential clips (e.g. 0-5s, 5-10s) can sit back-to-back on Track 1, but you MUST mathematically prevent them from touching perfectly to avoid audio phasing and linter overlaps. Subtract `0.001` from the duration of each clip (e.g. if Clip 1 starts at 0.0 and Clip 2 starts at 5.0, Clip 1's duration must be `4.999`, not `5.0`).
3. **Static Caption Generation:** Do NOT use JS (`document.createElement`) to inject captions at runtime. Write a Node.js build script to read `.tinyfilm/transcripts/` and generate hardcoded `<div class="clip">` tags directly inside `index.html`. Alternate text tracks (e.g., track 4 and 5) to prevent overlap errors.
4. **Opinionated Caption Styling:** Agents frequently mess up caption placement by using `padding-bottom` or weird flexboxes. Follow this exact CSS string for every word container:
   `style="position: absolute; bottom: 20%; width: 100%; display: flex; justify-content: center; align-items: flex-end;"`
   - **Aesthetics:** Use massive (e.g., `80px`), uppercase, ultra-bold white text. **Do NOT use `-webkit-text-stroke`**, as it causes weird glyph lines/artifacts. Instead, use a thick CSS `text-shadow`:
     `style="font-size: 80px; font-weight: 900; color: white; text-transform: uppercase; text-shadow: 6px 6px 0 #000, -3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000;"`
5. **GSAP Captions:** Apply GSAP animations (like a `scale` pop) *only* to the inner text element. Leave the outer container's visibility strictly up to the `class="clip"` lifecycle.

## Linting — Always Run After Changes

```bash
npm run check
```

Fix all errors before presenting the result.

## Key Rules

1. Every timed element needs `data-start`, `data-duration`, and `data-track-index`.
2. Visible timed elements **must** have `class="clip"` — the framework uses this for native visibility control and DOM garbage collection.
3. Every timed media and text element **must** have a unique `id` attribute.
4. GSAP timelines must be paused and registered on `window.__timelines`:
   ```js
   window.__timelines = window.__timelines || {};
   // Key MUST match the data-composition-id of the HTML wrapper
   window.__timelines["composition-id"] = gsap.timeline({ paused: true });
   ```
5. Videos use `muted` with a separate `<audio>` element for the audio track. Overlapping media must be separated onto different `data-track-index` layers.
6. Only deterministic logic — no `Date.now()`, no `Math.random()`, no network fetches.
