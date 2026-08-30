import globals from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  globals.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist", "node_modules", "*.d.ts", "vitest.config.*"],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        sourceType: "module",
      },
    },
  },
);
