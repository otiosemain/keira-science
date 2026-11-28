# Keira 的学习站 / Keira's Study Site

Bilingual (Chinese + English) study site for Keira, Standard 5, SJKC Yuk Chai.

**Site:** https://otiosemain.github.io/keira-science/

| Folder | Subject | Status |
|---|---|---|
| `science/` | 科学 Science | live |
| `math/`, `english/`, `bm/`, `chinese/`, `moral/`, `sejarah/`, `rbt/`, `seni/`, `jasmani/` | other subjects | coming soon |

- `index.html` is the hub. `sync.js` is the shared Google sign-in + progress sync (Firebase Realtime Database, path `users/{uid}/kv/{subject}/{key}`).
- Every page stores progress in `localStorage` as `ks:<subject>:<key>` and works offline without signing in.
- Root `*.html` files other than `index.html` are redirects from the old (pre-hub) Science URLs.
- `*.pdf.b64` at the root are the Science PDFs (legacy location). New subjects keep theirs in their own folder. GitHub Actions decodes them when publishing.
