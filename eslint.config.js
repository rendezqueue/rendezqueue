import eslintPluginJsonc from "eslint-plugin-jsonc";
import globals from "globals";
import js from "@eslint/js";
import { defineConfig } from "eslint/config";

export default defineConfig([
  js.configs.recommended,
  {
    files: ["**/*.js"],
    ignores: ["src/webdual/script.js"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "module",
      globals: {
        ...globals.node,
      }
    },
    rules: {
      indent: ["error", 2],
      semi: ["error", "always"],
      quotes: ["error", "double"],
      "brace-style": ["error", "1tbs"],
      strict: ["error", "safe"],
      "no-console": "off",
      camelcase: "off",
    }
  },
  {
    files: ["src/webdual/script.js"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "module",
      globals: {
        ...globals.browser,
      }
    },
    rules: {
      indent: ["error", 2],
      semi: ["error", "always"],
      quotes: ["error", "double"],
      "brace-style": ["error", "1tbs"],
      strict: ["error", "safe"],
      "no-console": "off",
      camelcase: "off",
    }
  },
  ...eslintPluginJsonc.configs["flat/recommended-with-json"],
  {
    rules: {
      "jsonc/indent": ["error", 2],
    }
  },
]);
