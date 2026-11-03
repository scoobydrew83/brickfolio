import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone", // Docker image runs .next/standalone/server.js
  // The OCR model files are read from node_modules at run time (app/ocr/[file]/route.ts); copy them into the build.
  outputFileTracingIncludes: {
    "/ocr/*": [
      "./node_modules/tesseract.js/dist/worker.min.js",
      "./node_modules/tesseract.js-core/tesseract-core-*lstm.wasm.js",
      "./node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
    ],
  },
  // No cacheComponents: every page reads live data anyway, and it hangs on Cloudflare Workers (OpenNext 1.20).
  images: {
    // Set photos come from BrickLink. Next downloads each once, shrinks it, and keeps it in .next/cache/images
    // (mounted as a volume in docker-compose so it survives restarts).
    remotePatterns: [new URL("https://img.bricklink.com/**"), new URL("https://cdn.rebrickable.com/**")],
    minimumCacheTTL: 2678400, // 31 days: set photos almost never change
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
