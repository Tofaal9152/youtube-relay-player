# YouTube access and cookies

The relay can be healthy while YouTube extraction fails. **Relay connected** checks the backend, not whether YouTube currently accepts its requests.

If you see **YouTube needs verification**, try the public test clip first. If it works, investigate upstream access rather than the player UI.

YouTube may request sign-in from datacenter IPs. A current yt-dlp executable and your own valid session cookies can help, but they do not guarantee access. The same export may work and later stop working. An unexpired date does not establish that YouTube still accepts a session.

## Optional cookie configuration

Follow the upstream [YouTube cookie export instructions](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies). Use your own YouTube-only Netscape-format export and keep it outside public directories.

For a local setup:

1. Save the export as `backend/youtube-cookies.txt`.
2. Restrict access: `chmod 600 backend/youtube-cookies.txt`.
3. Add `YOUTUBE_COOKIES_FILE=./backend/youtube-cookies.txt` to `backend/.env`.
4. Restart `npm run backend`, then load the video again.

For a remote backend, securely transfer the file to your own server, restrict it to the service account and configure its absolute path. yt-dlp can update the cookie jar, so the backend service account needs write access to the file and its parent directory.

Cookies are account credentials. Never commit them, paste them into issues, put them into frontend environment variables or include them in build artifacts. This repository includes no cookies. Private, membership-only and other account-restricted videos are rejected even when account cookies are configured.

To update the extractor installed by the quick-start instructions:

```sh
./backend/bin/yt-dlp -U
```

If extraction succeeds but media is refused, the failure can be at the upstream media request rather than the login step. Reload the video to obtain a fresh session. Include only redacted error codes in bug reports; signed source URLs and cookies must stay private.
