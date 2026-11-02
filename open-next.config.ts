// OpenNext adapter config for Cloudflare Workers. Build-time output (icons, page shells) is served from
// static assets; everything else reads live data, so no writable cache is needed.
import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import staticAssetsIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache';

export default defineCloudflareConfig({ incrementalCache: staticAssetsIncrementalCache, enableCacheInterception: true });
