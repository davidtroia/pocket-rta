# davidtroia.com

One static page: no build step, no scripts, no cookies, no third-party requests (the font is bundled).

## Publish on Cloudflare Pages

1. Cloudflare dashboard, Workers & Pages, Create, Pages, connect this GitHub repository.
2. Build command: empty. Build output directory: `davidtroia-site`.
3. Add `davidtroia.com` (and `www`) under the project's Custom domains.

## Still to add (see the TODO comment in `index.html`)

About text, featured releases with links, listen/follow links, an optional photo. The three headline numbers (20 years, 150 major releases, 220 million streams) are the ones David gave me; confirm each before publishing. The contact address `hello@davidtroia.com` must exist (Cloudflare Email Routing can forward it).

This site lives in this repository for now. It can move to its own repository later without changes.
