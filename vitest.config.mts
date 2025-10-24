import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "next-auth/react": path.resolve(__dirname, "test/mocks/next-auth-react.ts"),
      "next-auth/providers/credentials": path.resolve(
        __dirname,
        "test/mocks/next-auth-credentials.ts",
      ),
      "next-auth/providers/google": path.resolve(
        __dirname,
        "test/mocks/next-auth-google.ts",
      ),
      "next-auth": path.resolve(__dirname, "test/mocks/next-auth.ts"),
      "@prisma/client": path.resolve(__dirname, "test/mocks/prisma-client.ts"),
      bcrypt: path.resolve(__dirname, "test/mocks/bcrypt.ts"),
      openai: path.resolve(__dirname, "test/mocks/openai.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    css: true,
    sequence: {
      concurrent: false,
    },
    coverage: {
      reporter: ["text", "html"],
      reportsDirectory: "coverage",
    },
  },
});
