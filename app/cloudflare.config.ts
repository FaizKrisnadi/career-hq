import { bindings, defineConfig, defineWorker } from "cf/config";

export default defineConfig({
  worker: defineWorker({
    name: "career-hq",
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-11-05",
    compatibilityFlags: ["nodejs_compat"],
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ASSETS: bindings.assets(),
      IMAGES: bindings.images(),
      DB: bindings.d1({ name: "career-hq-db" }),
      // TODO(user-r2): restore once R2 is enabled in the dashboard and the
      // career-hq-docs bucket is created. Text documents live in D1 meanwhile.
      // DOCS: bindings.r2({ name: "career-hq-docs" }),
      ENGINE_API_KEY: bindings.secret(),
    },
  }),
});
