import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Run against the SDK sources so no build is needed.
export default defineConfig({
  resolve: { alias: { "@plinth/sdk": fileURLToPath(new URL("../../ts/src/index.ts", import.meta.url)) } },
  test: { include: ["test/**/*.test.ts"], testTimeout: 60000 },
});
