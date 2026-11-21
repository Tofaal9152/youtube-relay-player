# YouTube access and cookies

The relay can be healthy while YouTube extraction fails. **Relay connected** checks the backend, not whether YouTube currently accepts its requests.

If you see **YouTube needs verification**, try the public test clip first. If it works, investigate upstream access rather than the player UI.

YouTube may request sign-in from datacenter IPs. A current yt-dlp executable and your own valid session cookies can help, but they do not guarantee access. The same export may work and later stop working. An unexpired date does not establish that YouTube still accepts a session.

## Optional cookie configuration

Follow the upstream [YouTube cookie export instructions](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies). Use your own YouTube-only Netscape-format export and keep it outside public directories.

## Export with Cookie Editor in Chrome

This walkthrough uses **[Cookie Editor on the Chrome Web Store](https://chromewebstore.google.com/detail/cookie-editor/ookdjilphngeeeghgngjabigmpepanpl?hl=en)**, linked from `cookieeditor.org` (extension ID: `ookdjilphngeeeghgngjabigmpepanpl`). It is a third-party browser extension, not part of this repository; similarly named extensions are different products.

1. Install **Cookie Editor** using the exact link above. In `chrome://extensions`, open its **Details** and enable **Allow in Incognito** for this export.
2. Open a fresh Incognito window with only one tab. Sign in to **your own YouTube account**.
3. In that same tab, navigate to **https://www.youtube.com/robots.txt**. This is the page to leave open for exporting, not an extension download page.
4. While that YouTube tab is active, open **Cookie Editor** and select its **Export** button. Confirm the current page/domain is YouTube, not GitHub or another website. Export only `youtube.com` cookies, not all browser cookies.
5. In the export dialog, select **Netscape**, not JSON or Header String. Leave **Password to encrypt cookies** empty: yt-dlp needs the readable Netscape file.
6. Press **Export** and save the result as `backend/youtube-cookies.txt`. If the extension copies the result to the clipboard instead of downloading it, save that text in a plain-text file with this name. The Netscape header is `# Netscape HTTP Cookie File`; do not paste cookie values into a bug report or chat.
7. Close the entire Incognito window after exporting and do not reopen that exported session. Disable the extension's Incognito access afterward if no longer needed.
8. Configure the backend as described below, restart it, and load the video again.

This follows yt-dlp's single-tab Incognito export procedure to reduce cookie rotation. It does not guarantee that YouTube will accept the session from a VPS. Use account cookies only when needed; yt-dlp's upstream guide notes possible account restrictions. Screenshots used in documentation or public posts must hide real cookie values.

## Configure the backend

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
