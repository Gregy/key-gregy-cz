# key.gregy.cz: a port-knock page for guests

A static page that performs a TCP port knock from the visitor's browser, so guests who know nothing
about port knocking can still reach the knock-gated home services (photos and the like). They open a
link or type a secret word, and the home router opens up for their IP for 12 hours.

Hosted on GitHub Pages from the `gh-pages` branch, which [`deploy.sh`](deploy.sh) generates.

## How it works
```
visitor's browser ── https://key.gregy.cz/#key=<secret>&redirect=<https://x.gregy.cz/…>
  1. decrypt the knock target with <secret>         (AES-GCM; the page source alone reveals nothing)
  2. resolve the home public IP over DoH             (cloudflare-dns.com; falls back to a baked-in IP)
  3. fetch https://<ip>:<port>/ for each knock port  (each a TCP SYN, refused with RST: that's the knock)
  4. redirect to <redirect>, or offer a "continue to the photos" button
          │
          ▼ the router sees the SYNs in order → opens the gated services to the visitor's IP for 12 h
```
- The knock host, fallback IP and port sequence are **encrypted into the page** with AES-256-GCM under
  a PBKDF2-SHA256 key derived from the secret. Without a secret the page is inert and the ports aren't
  in the source. This is light protection (see [Security](#security)), matching the knock's own
  threat model: it keeps dumb bots out, and the real protection is the services' own logins.
- The browser knocks the **public IP**, resolved over DoH, not the hostname. At home the names resolve
  to LAN addresses, and a public page reaching a LAN address trips Chrome's "local network access" prompt.
- Knocking uses `fetch(..., {mode:'no-cors'})`. The TLS handshake to an IP fails, but the TCP SYN (all
  the knock needs) has already gone out. The sequence runs twice: harmless, and it recovers from a
  stray SYN that reset the first pass.

## Links
The parameters go in the URL **fragment** (`#…`), which browsers never send to the server, so the secret
doesn't end up in GitHub's request logs. The page also drops it from the address bar and history once read.

- `https://key.gregy.cz/#key=<secret>&redirect=<https://…gregy.cz/…>`: knock, then go to `<redirect>`.
  `redirect=` may be pasted **unencoded** (with its own `?`, `&`, `#`); it greedily takes the rest of
  the fragment. Only `https://*.gregy.cz` targets are accepted (no open redirect).
- `https://key.gregy.cz/#key=<secret>`: knock, then offer a "continue to the photos" button.
- `https://key.gregy.cz/`: ask for the secret (the dungeon gate), optionally remember it on the device,
  then knock. A remembered secret knocks automatically on the next visit.

The secret match is **case/diacritics/separator-insensitive**: `Tajné Slovo`, `tajne-slovo` and
`tajne_slovo` are the same.

The page speaks **Czech or English**, whichever comes first in the browser's preferred languages
(Slovak counts as Czech; anything else gets English).

## Files
| Path | What |
|---|---|
| `src/index.html`, `style.css`, `app.js`, `scene.js` | The page. `app.js` has the texts (cs/en), crypto, knock and flow. `scene.js` is the pixel-art dungeon gate: a 160×120 canvas with per-pixel dithered torch lighting, scaled up by whole pixels. `@LOCKS@` in index.html is filled by the build. |
| `src/fonts/` | Self-hosted Press Start 2P and VT323 (SIL OFL 1.1, licences alongside). |
| `src/CNAME`, `src/.nojekyll` | GitHub Pages: the custom domain, and no Jekyll processing. |
| `knockpage.py` | Build: encrypt the knock target under each secret into `www/`. |
| `knock.local.env` (**not committed**) | Build settings: `PORTS_ENV` (file with the `K1`/`K2`/`K3` knock ports, kept with the router config), `KNOCK_HOST`, `KNOCK_IP`. See [`knock.local.env.example`](knock.local.env.example). |
| `key-secrets.txt` (0600, **not committed**) | The secret(s), one per line. |
| `deploy.sh` | Build, then force-push `www/` as the single-commit `gh-pages` branch. |

## Build & deploy
```sh
cp knock.local.env.example knock.local.env    # once; fill in
$EDITOR key-secrets.txt                        # the secret(s) to hand out
./deploy.sh                                    # build www/ and publish it
./knockpage.py --list                          # show which secrets are built in
```
After **changing the knock ports** on the router, just run `./deploy.sh` again. The build reads them
from `PORTS_ENV`, so the page follows. To preview locally: `./knockpage.py && python3 -m http.server -d www`.

GitHub Pages setup (done once): source = branch `gh-pages` `/`, custom domain `key.gregy.cz`,
*Enforce HTTPS* on. DNS: `key.gregy.cz CNAME gregy.github.io` (DNS-only, not proxied).

## Security
- The secret is **light protection**, on purpose. PBKDF2 (200k iterations) slows brute force, but the
  page is public and the ciphertext is in it, so anyone who guesses or is given the secret learns the
  ports. That only lets them *knock*, which the knock already assumes anyone sniffing the traffic can
  do. The real protection is the services' own logins.
- The secret **never leaves the browser**: it travels in the fragment, `<meta name="referrer"
  content="no-referrer">` is set, and the knock fetches send no referrer or credentials.
- CSP as a `<meta>` tag (`default-src 'none'`; scripts, styles and fonts from `'self'`; `connect-src
  https:` for DoH and the knock), no open redirect. Pages can't send `X-Frame-Options` or
  `frame-ancestors`, so the script refuses to do anything when it's framed.
- An opened IP stays open for 12 h. Behind carrier-grade NAT, others sharing that IP get in too (the
  same caveat as any knock).
