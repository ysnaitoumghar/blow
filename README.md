# Blow

Type a word. It becomes thousands of glowing particles that you can touch, tilt, shake and blow away. The word always slowly rebuilds itself.

Live: https://ysnaitoumghar.github.io/blow/ · Share a word: `?w=Salma&t=warm` (themes: `warm`, `electric`, `mono`, `sunset`; optional `l=en|fr|ar`)

## What it does

- **Particles** – 5,000 to 15,000 points sampled from the rendered text, each with a home position, velocity and spring. Soft additive glow on a dark background, breathing and drift while idle. Themes switch with a smooth colour crossfade.
- **Tilt** – gravity follows the phone; particles slide like sand and return home when you lay it flat (or hold a new grip for a few seconds).
- **Touch** – every finger is a force field (multi-touch). A mouse hovering does the same on desktop.
- **Blow** – the microphone level (with a low-frequency weighting so breath counts more than speech) becomes wind; a stronger blow is a stronger wind. Nothing is recorded or sent; the audio is only analysed locally and never played.
- **Shake** – explosion, then reassembly.
- **Desktop** – hold `B` to blow, `Space` to shake (or use the extra buttons, which also appear on phones when a permission is denied).
- **Share & capture** – Web Share API with copy-link fallback; capture shows a PNG you can save (long-press on iOS, or the Save button).
- **Languages** – English, French, Arabic (RTL); Latin and Arabic script text.
- **Robust** – pauses in the background and resumes cleanly, survives rotation and WebGL context loss, works touch-only if motion or the mic is denied, and lowers the particle count automatically if frames get slow.

## Develop

```bash
npm install
npm run dev      # http://localhost:4321/blow/
npm run build
```

Motion and microphone require HTTPS on phones (GitHub Pages is HTTPS; for local testing use a tunnel such as `cloudflared` or `ngrok`).

## Deploy

Push to `main`; the workflow in `.github/workflows/deploy.yml` builds and publishes to GitHub Pages. In the repo settings set **Pages → Source → GitHub Actions**.

## Stack

Astro + TypeScript, raw WebGL (one `gl.POINTS` draw call, CPU physics on typed arrays). No runtime dependencies.
