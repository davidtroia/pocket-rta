# Balance Digital LLC website

Plain static files: no build step, no scripts, no cookies, no third-party requests (fonts and images are bundled).

Pages: `index.html` (company), `pocket-rta.html` (product), `privacy.html`, `support.html`.

## Publish on Cloudflare

`wrangler.jsonc` at the repository root tells Cloudflare to serve the `site/` folder.

1. Cloudflare dashboard, Workers & Pages, Create application, import this GitHub repository.
2. Project name: `balancedigitalllc` (it must match the `name` in `wrangler.jsonc`). Build command: `exit 0`. Deploy command: `npx wrangler deploy`. Preview command: `npx wrangler versions upload`.
3. After the first deploy, open the project's Settings, Domains & Routes, and add the custom domains `balancedigitalllc.com` and `www.balancedigitalllc.com`. Because the domain's DNS is on Cloudflare, it sets up the records for you.

## Before you publish

- Make sure `support@balancedigitalllc.com` receives mail (Cloudflare Email Routing can forward it to your own inbox for free). It is the address used on every page.
- Have the privacy policy reviewed by a lawyer if you can; it is written to match what the app does today and must be updated if that changes.
