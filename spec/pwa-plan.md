# PWA plan

Make the web client installable and able to cold-boot offline. The app is
already offline-first below the asset layer: boot restores the session from the
IndexedDB DEK vault and rebuilds the doc from the local op log with zero
network, and the sync bridge reconnects with backoff when the server is
unreachable. What's missing is the app shell — HTML/JS/CSS/wasm are fetched
from the network on every load. This plan adds the manifest, service worker,
and server plumbing to close that gap, plus a purpose-built auth-probe endpoint
(`GET /api/session`) that the reconnect path currently fakes via
`GET /api/devices`.

**Non-goals** (deliberately out of scope):

- Reworking `onAuthFailed → logout() → dekVault.clear()` into a non-destructive
  locked state. Deferred; see "Deferred work" below. The probe endpoint added
  here is shaped so reason codes can land later without another migration.
- Multi-tab support. The Web Locks single-tab gate already covers installed PWA
  windows (locks are origin-wide), so nothing changes here.
- Push notifications, Periodic Background Sync, share targets. A CRDT that
  catches up on open doesn't need background wakeups.
- iOS. Native app planned; desktop Safari remains in scope but gets no
  special treatment beyond standard manifest/SW.

## Current state (survey, 2026-07)

- Build: Vite 7 + `vite-plugin-solid` + `vite-plugin-wasm`, target es2022.
  `dist/` is `index.html` + exactly three content-hashed assets
  (~2.8 MB wasm, ~400 KB js, ~36 KB css). No `public/` dir.
- Serving: `server/src/http/web.rs` (feature `bundled-web`) embeds `dist/` via
  `rust_embed` and routes only `/`, `/index.html`, `/assets/{*path}`.
  `index.html` is `no-cache`; assets are `immutable`. No SPA fallback.
- No manifest, no service worker, no icons, no `navigator.storage.persist()`,
  no `online`-event listener (reconnect is backoff-timer only, though
  `SyncBridge.reconnectNow()` exists).
- Auth probe: on a WS close-before-open, `SyncBridge` calls `probeAuth`
  (`js/web/src/sync/sync.ts`), currently `api.listDevices()`; only a 401 there
  means "auth is bad".

## Phase 1 — manifest + icons — **done**

`js/web/public/` (Vite copies it verbatim into `dist/` root):

- `icons/`: `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`,
  `apple-touch-icon.png` (180×180). The filenames are the contract; swap the
  artwork any time. Current artwork is the marketing site's app mark (the
  `Ad` glyph on the brand purple), lifted from `airday_website/public/`. The
  maskable variant is derived from the 512: the same art inset to ~92% over a
  flat-bleed brand-purple field, since the source tile has transparent
  corners and would get chewed by a circular mask as-is.
- Root favicons: `favicon.ico` (16/32/48), `favicon-32x32.png`,
  `favicon-16x16.png` — same source, matching the website's tab icon.

Manifest was to be declared in the vite-plugin-pwa config (Phase 2), but the
icons landed ahead of the plugin, so `public/manifest.webmanifest` is a static
file for now and `index.html` carries the `<link rel="manifest">` and the
icon/apple-touch links by hand. When Phase 2 lands, either let the plugin emit
the manifest (delete the static file, drop the `<link>`) or keep `manifest:
false` and leave this as-is; do not ship both. Contents:

```json
{
  "name": "Airday",
  "short_name": "Airday",
  "start_url": "/",
  "display": "standalone",
  "background_color": "<light bg>",
  "theme_color": "<light bg>",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

`theme_color` is static while the in-app theme is a cookie; pick the light
value (`--bg`, `#f9f9f9` — the html-level theme script still applies dark
instantly). `index.html` additionally gets `<link rel="apple-touch-icon" ...>`
and a matching `<meta name="theme-color">`.

## Phase 2 — service worker (vite-plugin-pwa, generateSW)

`vite-plugin-pwa@^1` (Vite 7 compatible), Workbox `generateSW` strategy — the
precache manifest is four files; hand-rolling `injectManifest` buys nothing.

```ts
VitePWA({
  registerType: "prompt",            // update toast, never rug-pull
  manifest: { ...as above },
  workbox: {
    globPatterns: ["**/*.{js,css,html,wasm,webmanifest,png,svg,ico}"],
    maximumFileSizeToCacheInBytes: 8 * 1024 * 1024, // wasm > 2 MB default
    inlineWorkboxRuntime: true,      // single sw.js, no workbox-*.js sidecar
    navigateFallback: "/index.html",
    navigateFallbackDenylist: [/^\/api\//, /^\/admin\//, /^\/healthz$/],
    cleanupOutdatedCaches: true,
  },
  devOptions: { enabled: false },    // SW is prod-build only, like the tab gate
})
```

Notes:

- Precache is keyed by Vite's content hashes, so cache invalidation is
  automatic and an update is atomic: the new SW installs the new
  js+wasm+css set as a unit, which removes today's (theoretical) skew between
  a cached `index.html` and a redeployed binary.
- WebSocket upgrades never hit the SW fetch handler; `/api` HTTP calls are
  excluded from the navigation fallback and get no runtime caching — API
  responses must never be served stale from a cache.
- `inlineWorkboxRuntime` keeps the server-side embedding surface to exactly
  `sw.js` + `manifest.webmanifest` + icons.

## Phase 3 — server: root-level embedded files + cache policy — **done for icons/manifest**

The routes below are in `web.rs` as of Phase 1: `/{file}` and `/icons/{file}`
serve the favicons and the manifest. `sw.js` and `registerSW.js` don't exist
yet — the `/{file}` catch-all will pick them up once Phase 2 emits them, but
the `sw.js` → `no-cache` rule still needs adding to `root_file` at that point
(it currently falls through to the icon policy, which for a service worker is
the wrong answer).

The build emits root-level files (`sw.js`, `manifest.webmanifest`, `icons/*`,
`registerSW.js` if the plugin emits one), served by a single-segment catch-all
alongside the existing asset route:

- `/` and `/index.html` → embedded `index.html`, `no-cache` (as today)
- `/assets/{*path}` → `immutable` (as today)
- `/{file}` and `/icons/{file}` → look up in `WebAssets`, 404 if absent.
  Cache policy by name:
  - `sw.js` → `no-cache` — **load-bearing**: an immutable-cached service
    worker is permanently stale
  - `manifest.webmanifest` → `no-cache` (it's tiny; not worth staleness)
  - icons → `public, max-age=86400` (not content-hashed, but change rarely)

Axum gives static routes precedence over captures at the same level, so
`/healthz`, `/api/...` (all multi-segment), and `/admin/...` are unaffected —
verified against a running bundled server. `mime_guess` does yield
`application/manifest+json` for `.webmanifest`, so `serve()` needs no
extension override.

Build-order note: `bundled-web` embeds at compile time, so a production server
build must run after `bun run --cwd js/web build` (which itself follows
`bun run build:wasm`). Unchanged from today, but the SW makes a stale embed
more confusing — worth a comment in the release steps.

## Phase 4 — `GET /api/session` (auth probe)

Purpose-built replacement for the `listDevices` probe. Requirements:

- Behind the **same** `DeviceAuth` extractor as every authed route, so the
  probe cannot disagree with the WS-upgrade validation it stands in for.
- `200` → `Msgpack<SessionInfo { account_id, device_id }>` (new
  `airday_protocol` type). Doubles as a whoami.
- `401` → existing `ApiError` shape. Future reason codes (`device_revoked`,
  `password_changed`, `unknown_token`) ride the existing `ApiErrorBody.code`
  field when the locked-state work lands — no wire change needed.

Changes: handler in `auth_routes.rs` (or a new `session_routes.rs`), route in
`http/mod.rs`, `SessionInfo` in `airday_protocol`, `api.session()` in
`js/web/src/api.ts`, and `probeAuth` in `js/web/src/sync/sync.ts` swaps
`api.listDevices()` → `api.session()`. Document the endpoint in
`spec/auth.md`, plus a note in `spec/sync-protocol.md` recording the
alternative that was considered and shelved: accepting the WS upgrade on bad
auth and closing with a custom code (e.g. 4401) would remove the HTTP probe
entirely (browsers hide the upgrade's HTTP status), at the cost of changing
the validate-on-upgrade contract.

## Phase 5 — client runtime wiring

New `js/web/src/pwa.ts`, imported from `index.tsx`:

- Register via `virtual:pwa-register` (framework-agnostic API):
  `registerSW({ onNeedRefresh, onRegisteredSW })`.
- **Update checks** (an installed PWA may not navigate for days, so the
  browser's on-navigation check never fires): call `registration.update()`
  on `visibilitychange → visible` and on an hourly `setInterval`. Both are
  conditional-request cheap.
- **Update toast**: `onNeedRefresh` flips a signal; `App` renders a small
  fixed toast — "A new version is available — Reload" — whose action calls
  `updateSW(true)` (posts `skipWaiting`, reloads). Single-tab means exactly
  one toast and no cross-tab reload coordination.
- **`navigator.storage.persist()`**: request once at boot, log the result.
  IDB may hold the only unsynced copy of E2EE data; eviction protection is
  not optional. (Best-effort — browsers may decline; installed PWAs are
  usually granted.)
- **`online` event → `bridge.reconnectNow()`** in
  `js/web/src/sync/runtime.ts` (with cleanup), so reconnect after a network
  drop doesn't wait out the 30s backoff cap. The event is a hint, not truth —
  the bridge's own connect attempt remains the arbiter.

## Verification

1. `bun run build:wasm && bun run --cwd js/web build` — dist contains
   `sw.js`, `manifest.webmanifest`, icons; precache manifest inside `sw.js`
   lists the wasm file.
2. `cargo run -p airday-server --features bundled-web` and, via Playwright
   against `http://localhost:8000`:
   - first load registers the SW (`navigator.serviceWorker.ready`);
   - `context.setOffline(true)` + reload → app boots to the workspace from
     cache, sync badge shows offline;
   - offline mutations persist; `setOffline(false)` → bridge reconnects and
     pushes.
   - `/api/session` returns 200 authed, 401 with cookie cleared; the 401
     path drives `onAuthFailed` exactly as the old probe did.
3. Update flow: bump something visible, rebuild, restart server, wait for the
   update check (or trigger `registration.update()` in devtools) → toast
   appears; Reload swaps to the new version.
4. Lighthouse installability audit passes (manifest + icons + SW + offline
   200 for `start_url`).

## Deferred work (recorded, not in scope)

- **Non-destructive auth failure**: replace `onAuthFailed → logout() →
  dekVault.clear()` with a locked state (keep session/DEK/doc; offer
  re-auth / keep-working-offline / explicit sign-out). Server-side reason
  codes on the `/api/session` 401 body feed this.
- **Sharing constraint** (for `spec/sharing-plan.md`): account authentication
  (401) must stay distinct from doc authorization. Losing access to a shared
  doc must surface as a doc-scoped error (403 / sync frame), never as a 401
  on account endpoints or an auth-shaped WS close — otherwise an unshare
  would cascade into the auth-failure path.
- Multi-tab story (SharedWorker or equivalent) — independent of PWA.
