// Static site only: files in site/ are served by Cloudflare before this runs.
// This script exists because older wrangler versions refuse a config with no entry point.
export default {
  fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
