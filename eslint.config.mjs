import { defineConfig, globalIgnores } from "eslint/config";
import nextTypeScript from "eslint-config-next/typescript";
import nextWebVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextWebVitals,
  ...nextTypeScript,
  globalIgnores([".next/**", "node_modules/**", "coverage/**"]),
]);
