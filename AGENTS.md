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
- `src/lib/cola.ts` - The queue of concrete reminder instants the phone computes and uploads (45-day window, 120/600 caps, stable ids). Since Etapa 14 it emits one row per channel (`push`/`whatsapp`/`email`) with destination, profile and timezone. Pure logic: no React, no network.
- `src/lib/entrega.ts` - Who can receive each reminder on which channel (contact ticket, per-profile switches, normalized phone/email) and the destinations the queue uploads. Shared by `App.tsx`, the queue and the tests.
- `src/lib/envio.ts` - Real-delivery state labels (`en_cola`, `enviado`, `entregado`, `fallido`), channel names and the fallback state for old rows. Pure logic.
- `src/lib/nube.ts` - Supabase REST client with `fetch` and the public anon key (no SDK): device id + token, queue upload (per channel), test notification, queue health summary (`resumen_cola`), channel configuration (`estadoCanales`), recent deliveries (`ultimos_envios`) and the last-upload record used by Settings. Never throws; returns `{ ok, error }`.
- `src/lib/cuenta.ts` - Optional account (Etapa 15): Supabase Auth magic link (`/auth/v1/otp`, `/auth/v1/user`), device session (`avispate.cuenta.v1`, refreshed before expiry, never inside backups), local or global sign-out (`scope=global`), and the authenticated RPCs that link/list/rename/unlink devices (`reclamar_dispositivo`, `mis_dispositivos`, `renombrar_dispositivo`, `desvincular_dispositivo`, `desvincular_todos_dispositivos`). Never throws; returns `{ ok, error }`.
- `src/lib/sync.ts` - Sync engine (Etapa 15, fases 2–3): outbox in `localStorage` (`avispate.sync.v1`), five synced entities, batched upload (`subir_cambios`, 200 per batch), cursor download (`bajar_cambios`), tombstones, the shared LWW rule (`updated_at` → `dispositivo_id` → `md5(payload)`) and `revocado: true` when the server rejects a device that was unlinked from another phone. The first pass downloads before uploading. Pure logic plus `fetch`; never throws.
- `src/lib/adjuntos.ts` - Supabase Storage client (Etapa 15, fase 5) without SDK: private `adjuntos` bucket at `{user_id}/{id}`, upload with `x-upsert`, signed URLs, download, delete, list/orphan cleanup and the local retry queue (`avispate.adjuntos.cola.v1`). Never throws; returns `{ ok, error }`.
- `src/lib/tiempo-real.ts` - Raw Supabase Realtime WebSocket (Etapa 15, fase 6): Phoenix join with the account JWT, `postgres_changes` for the five tables filtered by `user_id`, heartbeat, backoff reconnect and the status labels used by Settings. The 45 s poll remains the fallback.
- `src/lib/pwa.ts` - Push state and subscription: permission, service worker, VAPID subscribe/unsubscribe, «version nueva» pill, and sending the device credentials to the worker (IndexedDB) so a notification can be snoozed with the app closed.
- `src/pwa/service-worker.js` - Service-worker source (offline shell, `push`, `notificationclick`, `ACTIVAR` message, Etapa 11 «Posponer» actions backed by `posponer_aviso`). `vite.config.ts` publishes it as `dist/sw.js`; it only registers in production builds, so test push with `npm run build && npm run preview`.
- `public/` - Installable-app assets: `manifest.webmanifest` and the bee icons (`icono-192/512/180/32.png`, maskable) rendered from `public/icono.svg`.
- `supabase/` - Server side: `migrations/0001_etapa10.sql` (tables with RLS and no policies, four token-guarded RPCs, 1-minute cron + daily cleanup), `migrations/0002_etapa11.sql` (`pospuesto_en`, `posponer_aviso`, `resumen_cola`, sync that keeps snoozed rows), `migrations/0003_etapa14.sql` (per-channel rows, PK `(dispositivo, id, canal)`, delivery state, `probar_canal`, `ultimos_envios`, `envios` view), `migrations/0004_etapa15.sql` (account profile + device link tables with per-user RLS, auth trigger, `reclamar_dispositivo`/`desvincular_dispositivo`/`mis_dispositivos` for `authenticated` only), `migrations/0005_etapa15_datos.sql` (five synced entities + tombstones with per-user RLS, `subir_cambios`/`bajar_cambios`, sequence cursor and server-side LWW), `migrations/0006_etapa15_dispositivos.sql` (per-account device name, `renombrar_dispositivo`, `desvincular_todos_dispositivos`), `migrations/0007_etapa15_adjuntos.sql` (private 10 MB `adjuntos` bucket and per-owner Storage policies), `migrations/0008_etapa15_realtime.sql` (five tables in `supabase_realtime`), `tests/0005_negativo.sql` and `tests/0006_negativo.sql` (account/sync and device/Storage/Realtime negative tests, rolled back), `functions/enviar-avisos/` (push + WhatsApp Cloud API + Resend, claim/retry/daily cap) and `functions/webhooks-envio/` (Meta/Resend status webhooks with signature checks). Setup steps: `supabase/README.md`.
- `supabase/config.toml` - Remote project config pulled with `supabase config pull` (Etapa 15): Auth **Site URL** and the allowed **Redirect URLs** for the magic link, plus the remote Auth/DB settings. No secrets; push changes with `supabase config diff` then `supabase config push`.
- `docs/etapa15-cuenta-y-sincronizacion.md` - Etapa 15 design and status: identity model, phases (auth/device link, per-entity schema + RLS, outbox/cursor/tombstones, devices/sessions, Storage attachments, Realtime), conflict rules, security, tests and open decisions. All six phases are implemented; Etapa 16 (calendars) is blocked on OAuth credentials.
- `scripts/generar-vapid.mjs` - Generates the VAPID pair once. The private key goes to `.env.local` and Supabase secrets, never to the repo (and never gets a `VITE_` prefix).
- `.vscode/settings.json` - Live Server pointed at `dist/` (root `/dist`, port 5500, host `0.0.0.0`). Serve the built app with `npm run build:watch` and open `dist/` with Live Server; the build uses a relative `base` (`./assets/…`) so `dist/` works from any root, Vercel included.

## Fin de tarea

Two rules apply when a task ends (the last reply to the user):

- Run `bash scripts/avisar.sh "<short summary>"` so the user gets a desktop notification (for example
  `"Etapa 15 completa · 987/987"`). It is a courtesy ping: it must never fail or delay the task.
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
