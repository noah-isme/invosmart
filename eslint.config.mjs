import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",

    // Keep the flat-config equivalent of the former .eslintignore. Test
    // fixtures and generated declarations are covered by their own runners
    // and should not make the production lint gate noisy.
    "app/**/__tests__/**",
    "app/**/__mocks__/**",
    "app/**/tests/**",
    "lib/**/__tests__/**",
    "test/**",
    "types/**",
    "**/*.d.ts",

    // Runtime/generated artifacts are not application source and can contain
    // work-in-progress agent scratch files or generated graph data.
    ".agents/**",
    "graphify-out/**",
    "coverage/**",
    "QA-report/**",
  ]),
]);

export default eslintConfig;
