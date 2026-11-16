# Balance Digital LLC website

Plain static files: no build step, no scripts, no cookies, no third-party requests (fonts and images are bundled).

Pages: `index.html` (company), `pocket-rta.html` (product), `privacy.html`, `support.html`.

## Publish on Cloudflare Pages

1. Cloudflare dashboard, Workers & Pages, Create, Pages, connect this GitHub repository.
2. Build command: leave empty. Build output directory: `site`.
3. After the first deploy, open the project's Custom domains tab and add `balancedigitalllc.com` (and `www`). Because the domain's DNS is on Cloudflare, it creates the records for you.

## Before you publish

- Make sure `support@balancedigitalllc.com` receives mail (Cloudflare Email Routing can forward it to your own inbox for free). It is the address used on every page.
- Have the privacy policy reviewed by a lawyer if you can; it is written to match what the app does today and must be updated if that changes.
