# Self-hosting

Run the Next.js frontend and Node.js backend on the same machine or on separate hosts. The frontend needs a Node runtime because its API keeps the relay credential private; it is not a static-only export.

Use your own domain and accounts. No author-specific deployment scripts, server credentials or live endpoint defaults are included.

## Example: one HTTPS domain

Suppose your frontend is `https://video.example.com` and your public relay is `https://video.example.com/relay-api`.

Frontend environment:

```dotenv
RELAY_URL=http://127.0.0.1:4100
PUBLIC_RELAY_URL=https://video.example.com/relay-api
RELAY_API_KEY=your-random-key-at-least-32-characters
ALLOWED_ORIGINS=https://video.example.com
```

Backend environment:

```dotenv
HOST=127.0.0.1
PORT=4100
PUBLIC_URL=https://video.example.com/relay-api
API_KEY=your-random-key-at-least-32-characters
ALLOWED_ORIGINS=https://video.example.com
YTDLP_PATH=/srv/nightfury-stream/backend/bin/yt-dlp
```

Replace the key in both files with the same generated secret. Absolute paths are recommended for the backend executable and optional cookies in production. Keep secrets in private environment files, outside build artifacts.

Configure TLS through your reverse proxy. Inside your own HTTPS Nginx server block, the relevant routes are:

```nginx
location ^~ /relay-api/ {
    proxy_pass http://127.0.0.1:4100/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_read_timeout 120s;
    client_max_body_size 8k;
}

location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 100s;
    client_max_body_size 8k;
}
```

The trailing slash on the backend `proxy_pass` strips `/relay-api/` before forwarding. Nginx must overwrite `X-Real-IP`, and the Node listeners should be reachable only through the proxy. Validate changes with `nginx -t` before reloading your own Nginx installation.

## Build away from a small VPS

Build on a local Linux machine or CI environment matching the VPS operating system and CPU architecture:

```sh
npm ci
npm run build
mkdir -p .next/standalone/.next
cp -R .next/static .next/standalone/.next/static
# If you later add a public/ directory, copy it into standalone/public too.
python3 - <<'PY'
from pathlib import Path
for path in Path('.next/standalone').rglob('.env*'):
    if path.is_file():
        path.unlink()
PY
```

Transfer the contents of `.next/standalone/` to the frontend runtime directory on your VPS. Do not transfer `.env*` files from your build machine. Native dependencies are platform-specific: a macOS build is not a portable Linux artifact without replacing the appropriate native binaries. Linux CI is the simpler route.

From the uploaded runtime directory, with a private runtime environment file in place:

```sh
PORT=3000 HOSTNAME=127.0.0.1 NODE_ENV=production node --env-file=/srv/nightfury-stream/frontend.env server.js
```

Copy `backend/server.mjs`, `backend/core.mjs` and your separately installed yt-dlp executable to your backend directory. The backend has no npm package dependencies and no build step:

```sh
node --env-file=/srv/nightfury-stream/backend/.env /srv/nightfury-stream/backend/server.mjs
```

Manage both processes with your process supervisor, using a dedicated unprivileged account and private environment files. Restrict cookie and configuration access to that account. Keep enough writable space for yt-dlp's cookie jar if you enable it. No full video media cache is created by this project.

## Local frontend with a remote relay

Keep the local frontend's `RELAY_URL` pointed at your remote HTTPS relay and use the matching API key. Keep `PUBLIC_URL` on the backend set to that same publicly reachable relay address. Allow `http://localhost:3000,http://127.0.0.1:3000` on both services.

Media travels from the source through the remote relay directly to the browser. It does not pass through the local Next.js API.

## Check the deployment

```sh
npm run smoke -- https://video.example.com
```

Add access control at your gateway if the site should be private. The server-side API key protects backend session creation from direct anonymous calls, but the frontend itself allows its visitors to request sessions. Origin checks are not authentication, and every delivered video byte can count toward your server's outbound transfer bill.
