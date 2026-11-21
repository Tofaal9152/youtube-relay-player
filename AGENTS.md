# AGENTS.md — YouTube Relay Player

Instructions for coding assistants and contributors working in this repository.

## Start here

1. Read this file, then `README.md` and the source files relevant to the request.
2. Read `docs/self-hosting.md` for hosting changes and `docs/cookies.md` for YouTube verification problems.
3. Check `git status` before editing. Preserve unrelated work and existing local configuration.
4. Use `package.json` and `package-lock.json` as the dependency/version source of truth. This project uses Next.js 16 and React 19; consult the bundled Next.js docs before changing Next.js APIs.

The project is an experimental, self-hosted YouTube player and DASH relay. The repository is named **YouTube Relay Player**; the existing UI brand is **Nightfury**. Renaming one does not require changing the other.

## Architecture and ownership

Two processes run independently:

- **Next.js frontend/control API**, normally `127.0.0.1:3000`: renders the UI and authenticates session-creation calls to the backend.
- **Plain Node.js backend**, normally `127.0.0.1:4100`: extracts source metadata, generates manifests, keeps temporary sessions and streams media ranges.

Request paths:

```text
Browser -> POST Next.js /api/relay -> authenticated backend POST /v1/sessions
Browser -> backend /s/<session>/manifest.mpd and media ranges -> source CDN
```

Video bytes bypass the Next.js control API. yt-dlp supplies existing source qualities; the relay does not encode, transcode or permanently store full videos. The browser decodes the media. Original source URLs remain server-side, but browser-visible relay URLs are not DRM or download protection.

| File | Responsibility |
| --- | --- |
| `app/page.tsx` | Source form, session state, health/byte polling, quality sidebar and connection panel |
| `app/components/relay-player.tsx` | next-video player-only wrapper and DASH quality/lifecycle integration |
| `app/api/relay/route.ts` | Server-side credential, origin validation, session-creation rate limit and backend control proxy |
| `app/globals.css`, `app/layout.tsx` | Responsive theme, layout and metadata |
| `backend/server.mjs` | HTTP routes, yt-dlp process, track probes, temporary maps and streaming pipeline |
| `backend/core.mjs` | URL/host/range validation, authentication comparison, public-video checks, MP4 ranges and manifests |
| `backend/test/core.test.mjs` | Offline tests for core behavior and network-input boundaries |
| `scripts/setup.mjs` | Local environment creation with matching private keys; refuses overwrites |
| `scripts/smoke.mjs` | Real sample-stream checks through both services; requires internet |
| `.github/workflows/ci.yml` | Clean Linux dependency install, core tests, type checking and production build |

## API contract

- Next.js `GET /api/relay` checks backend health; a healthy relay does not establish YouTube access.
- Next.js `POST /api/relay` accepts `{ "url": "https://www.youtube.com/watch?v=..." }` or `{ "source": "demo" }`.
- Backend `GET /health` reports service health and active media requests.
- Backend `POST /v1/sessions` requires `Authorization: Bearer <API_KEY>` and returns HTTP 201 with `id`, `title`, `creator`, `source`, `duration`, `expiresAt`, `manifestUrl`, `statsUrl` and `qualities` (`id`, `height`, `bandwidth`).
- Session resources include `manifest.mpd`, `stats`, YouTube `media/<format-id>` and approved sample `demo/<filename>` paths.
- Expired sessions return HTTP 410. Extraction/verification failures use structured error codes such as `YOUTUBE_BOT_CHECK`; keep these distinguishable from relay connectivity and player errors.

## Configuration and private data

- `.env.local`: `RELAY_URL`, `RELAY_API_KEY`, optional `PUBLIC_RELAY_URL`, `ALLOWED_ORIGINS`.
- `backend/.env`: `HOST`, `PORT`, `PUBLIC_URL`, `API_KEY`, `ALLOWED_ORIGINS`, `YTDLP_PATH`, optional `YOUTUBE_COOKIES_FILE`.
- `RELAY_API_KEY` must match backend `API_KEY`. Keep credentials on the server; never add them to `NEXT_PUBLIC_*`, client props or API responses.
- `RELAY_URL` is reachable by the Next.js server; backend `PUBLIC_URL` must be reachable by the viewer's browser. They can differ behind a reverse proxy.
- `ALLOWED_ORIGINS` is an explicit comma-separated list of frontend origins on both processes. Keep new deployments configurable; do not add a contributor's personal domain as a source-code default.
- Never print, commit or publish real environment files, cookie exports, account session values, signed upstream URLs or private deployment identifiers. Keep example values synthetic. Use only explicitly supplied/authorized cookie files; do not read browser profiles or account credentials automatically.
- Cookies belong on the backend. Use the exact **Cookie Editor** extension link and Netscape export steps in `docs/cookies.md` when explaining this setup; do not confuse it with similarly named extensions. Cookie replacement can restore access, but cannot guarantee it or bypass all IP challenges.

## Preserve these behavior boundaries

- Retain canonical YouTube link validation, HTTPS source-host allowlists (including redirects), range validation, private-video rejection, bearer authentication and bounded request bodies.
- Launch yt-dlp through `execFile` with an argument array. Do not interpolate user links into shell commands.
- Preserve streaming backpressure, disconnect cancellation, request timeouts and byte accounting. Avoid buffering entire media files in RAM or writing them to disk without an explicit feature request.
- Keep session and extraction limits bounded. Current limits: 20 metadata entries, 30 sessions, one extraction at a time, 10 active media requests and a maximum session lifetime of two hours or earlier upstream expiry. Ten media requests is not ten viewers.
- Current sources are recorded public/unlisted videos up to four hours, with compatible fragmented MP4 H.264 video and AAC audio, at most 1080p. Browser-specific playback support can vary. Update validation, documentation and relevant tests together if changing these constraints.
- Rate limiting is in memory. The trusted reverse proxy must overwrite `X-Real-IP`; keep Node listeners on loopback behind it. Origin checks are not viewer authentication.
- Keep the public test clip independent of YouTube cookies and extraction. Do not bundle its third-party video assets in the repo.

## Player changes

`next-video/player` owns the playback engine through `dash-video-element` and dash.js. Do not initialize another dash.js player on the same element. This project does not use Mux upload/sync processing or require Mux credentials.

Preserve the stable custom-element ref, delayed engine attachment and shared rendition list used by the player settings and quality sidebar. Clean up listeners and timers; account for React Strict Mode effect replay before resetting an engine. Test quality selection, seeking and retry without assuming that a successful manifest request proves playback.

## Local workflow and verification

```sh
npm ci
npm run setup           # Fresh checkout only; existing env files are preserved.
npm run backend         # Terminal 1
npm run dev             # Terminal 2
```

The sample works without yt-dlp or account cookies. YouTube extraction additionally needs the executable and runtimes described in the README.

Choose checks that match the change:

- Docs-only: inspect the diff, verify local links and commands, run `git diff --check`; no full rebuild is necessary.
- Application changes: run `npm test`, `npm run typecheck` and `npm run build`.
- Relay/API/network changes: run the relevant offline tests and `npm run smoke` with both services running. Add meaningful tests for changed input boundaries; avoid external YouTube calls in unit tests.
- Player/UI changes: inspect the affected layout and manually check playback, quality selection, seeking and teardown when browser testing is authorized and available.

The current next-video integration has core/type/build and real manifest/range verification, but browser playback/control QA is still pending. Report exactly what was checked; do not upgrade this to a tested production-readiness or viewer-capacity claim. Keep credentials out of CI and test fixtures.

## Hosting and handoff

Follow `docs/self-hosting.md`. For a slow VPS, build locally or on matching Linux CI, then copy the standalone runtime and static assets. Do not silently build/install dependencies on that VPS, assume macOS native binaries work on Linux, deploy unrequested changes, or stop unrelated services. Never include private environment files or cookies in a frontend build artifact.

Keep changes focused, update affected docs and preserve public API compatibility unless the request changes it. In the handoff, explain the resulting behavior, checks performed and remaining limitations. Answer users in their preferred language; keep shared repository documentation in English.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
