import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "cli/up": "src/cli/up.ts",
  },
  format: ["esm"],
  sourcemap: true,
  clean: true,
  dts: false,
  target: "node20",
});
