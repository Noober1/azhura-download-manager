import { defineConfig } from "vitest/config";

// Separate from vite.config.ts on purpose: that file's `build.rollupOptions`
// is tuned for the app's three HTML entry points, and has nothing to do with
// running unit tests against plain TS modules.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
