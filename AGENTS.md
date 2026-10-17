# figma-make-app

React + Vite + Tailwind CSS project running inside Figma Make.

## Development Server

A Vite development server is **already running** on `$PORT` (default 8443). You don't need to start it manually.

- Preview URL: The user can access the running app through the preview panel
- Hot reload: Changes to source files are reflected immediately

## Project Structure

This is the canonical project structure. Start with task-relevant files below. Only follow imports or inspect other files when required, when a documented path is missing, or when the repository contradicts this guide.

- `src/main.tsx` - React entrypoint; imports `src/index.css` and mounts `src/App.tsx` into the `#root` element
- `src/App.tsx` - Primary application component and the usual starting point for UI work
- `src/index.css` - Global CSS entrypoint and Tailwind CSS v4 import
- `index.html` - Vite HTML shell containing the `#root` element and loading `src/main.tsx`
- `package.json` - Project dependencies and the Vite build, development, preview, test, verification, and formatting scripts
- `vite.config.ts` - Vite configuration with React, Tailwind CSS v4, the Figma Make plugins and the service-worker plugin (reads `src/pwa/service-worker.js`, injects the build hash, the asset list and the Supabase URL/anon key, emits `sw.js`), plus the `@` alias for `src`
- `.mise.toml` - Toolchain version for Node.js (24); dependencies are installed and run with npm (single `package-lock.json`)
- `tests/` - The jsdom E2E battery: `harness.mjs` (shared mounting and helpers), `e2e-*.mjs` (one suite per delivery), `run.mjs` (runner). Run it with `npm test`; it needs a fresh `dist/` (`npm run build` first).
- `scripts/verificar.sh` - The loop: types → build → local battery; with `--deploy` also publishes to Vercel and runs the live battery (`npm run verificar` / `npm run verificar -- --deploy`).
- `scripts/avisar.sh` - Desktop notification (macOS `osascript`, no dependencies) so the user hears when a task ends: `bash scripts/avisar.sh "resumen corto"`. See *Fin de tarea* below.
- `.github/workflows/verificar.yml` - GitHub Actions: on every push to `main` and every pull request it runs `npm ci`, `format:check` and `npm run verificar` (no deploy; Vercel handles publishing).
- `.vercelignore` - Keeps `dist/`, `tests/.logs/` and `.env*` out of the Vercel upload: Vercel builds from source, so its CSS/JS hashes match the local build (uploading `dist/` made Tailwind scan it and add stray utilities).
- `src/lib/copia.ts` - Backup file format (`.json` with `localStorage` keys plus base64 attachments) and its validation, plus the Etapa 12 merge (`combinarDatos`: add only what is missing, never overwrite) and the «hace cuánto» wording (`haceCuanto`); kept out of `App.tsx` so the format can be read and tested on its own.
- `src/lib/repeticion.ts` - Repetition calendar (`nextOccurrenceAt`: «cada 8 horas», «cada mes»…) and the local-date helpers (`parseDate`, `pad2`, month/year-safe math). The only place that decides when a reminder repeats.
- `src/lib/avisos.ts` - Alert offsets («30 días antes», «1 hora antes»): labels, conversion to days and duplicate removal.
- `src/lib/buscar.ts` - Home search (Etapa 11): NFD accent folding, query split into words (all must match), `buscarRecordatorios` over name, notes and category. Pure logic; no React.
- `src/lib/cola.ts` - The queue of concrete reminder instants the phone computes and uploads (45-day window, 120/600 caps, stable ids). Pure logic: no React, no network.
- `src/lib/nube.ts` - Supabase REST client with `fetch` and the public anon key (no SDK): device id + token, queue upload, test notification, queue health summary (`resumen_cola`) and the last-upload record used by Settings. Never throws; returns `{ ok, error }`.
- `src/lib/pwa.ts` - Push state and subscription: permission, service worker, VAPID subscribe/unsubscribe, «version nueva» pill, and sending the device credentials to the worker (IndexedDB) so a notification can be snoozed with the app closed.
- `src/pwa/service-worker.js` - Service-worker source (offline shell, `push`, `notificationclick`, `ACTIVAR` message, Etapa 11 «Posponer» actions backed by `posponer_aviso`). `vite.config.ts` publishes it as `dist/sw.js`; it only registers in production builds, so test push with `npm run build && npm run preview`.
- `public/` - Installable-app assets: `manifest.webmanifest` and the bee icons (`icono-192/512/180/32.png`, maskable) rendered from `public/icono.svg`.
- `supabase/` - Server side: `migrations/0001_etapa10.sql` (tables with RLS and no policies, four token-guarded RPCs, 1-minute cron + daily cleanup), `migrations/0002_etapa11.sql` (`pospuesto_en`, `posponer_aviso`, `resumen_cola`, sync that keeps snoozed rows) and `functions/enviar-avisos/` (the sender; its payload carries the row id). Setup steps: `supabase/README.md`.
- `scripts/generar-vapid.mjs` - Generates the VAPID pair once. The private key goes to `.env.local` and Supabase secrets, never to the repo (and never gets a `VITE_` prefix).
- `.vscode/settings.json` - Live Server pointed at `dist/` (root `/dist`, port 5500, host `0.0.0.0`). Serve the built app with `npm run build:watch` and open `dist/` with Live Server; the build uses a relative `base` (`./assets/…`) so `dist/` works from any root, Vercel included.

## Fin de tarea

Two rules apply when a task ends (the last reply to the user):

- Run `bash scripts/avisar.sh "<short summary>"` so the user gets a desktop notification (for example
  `"Etapa 13 lista · 799/799"`). It is a courtesy ping: it must never fail or delay the task.
- **Do not deploy to Vercel** (`npm run verificar -- --deploy`, `npx vercel --prod`) unless the user asks
  for it. `npm run verificar` is the default gate and never publishes; publishing is a separate decision.

## Verification

Before claiming any UI change is done, run the battery: `npm run build && npm test` (types + build + local
battery in one go with `npm run verificar`; publishing is opt-in with `npm run verificar -- --deploy`).
It mounts the built bundle in jsdom and walks the real app, so it catches regressions without a browser.
Two conventions matter when adding checks:

- Search elements by `m.byLabel("…")` from the harness, **never** with `[aria-label="…"]` selectors: jsdom
  fails to match attribute selectors whose value contains emoji.
- `npm run format` covers `tests/` and `scripts/` only. **Never run oxfmt on `src/`**: version 0.2.0 strips
  the `;` that separates TypeScript type members and leaves the file uncompilable.

## Dependencies

- Runtime: React 19 and React DOM 19
- Styling: Tailwind CSS v4 with the `@tailwindcss/vite` plugin
- Build tooling: Vite 8, TypeScript 5.7, and `@vitejs/plugin-react`
- Testing: jsdom 30 (dev dependency, used by `tests/`)
- Formatting: oxfmt (see the caveat above)

## Styling

This project uses **Tailwind CSS v4** through the `@tailwindcss/vite` plugin configured in `vite.config.ts`. `src/index.css` imports Tailwind with `@import 'tailwindcss';`. Use Tailwind utility classes directly in JSX and put global CSS or Tailwind v4 theme customization in `src/index.css`. This scaffold does not need a Tailwind config file or PostCSS config.

`src/main.tsx` imports `src/index.css`, so global font wiring belongs in `src/index.css`. Keep CSS `@import` statements first, then add any `@font-face` rules and font-family defaults there.

## Code quality

- Use double quotes for strings containing apostrophes (`"We're here to help"`), or escape them in single-quoted strings. An unescaped apostrophe in a single-quoted string breaks the build.
- Ensure JSX tags are closed and braces are balanced.
- Export components as default exports.
