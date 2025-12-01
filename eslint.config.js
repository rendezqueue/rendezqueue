import eslintPluginJsonc from "eslint-plugin-jsonc";
import globals from "globals";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

// Configuration for strict TypeScript linting (applied to tests)
const strictTsConfig = {
  files: ["test/**/*.ts"],
  languageOptions: {
    parser: tseslint.parser,
    ecmaVersion: 2021,
    sourceType: "module",
    globals: {
      ...globals.node,
      "console": "readonly",
      "setTimeout": "readonly",
      "setInterval": "readonly",
      "clearInterval": "readonly"
    }
  },
  plugins: {
    "@typescript-eslint": tseslint.plugin,
  },
  rules: {
    ...js.configs.recommended.rules,
    ...tseslint.configs.recommended.rules,
    "no-undef": "off",
    // Enforce 2-space indentation to match previous rules
    "indent": ["error", 2],
    "semi": ["error", "always"],
    "quotes": ["error", "double"],
    "brace-style": ["error", "1tbs"],
    "strict": ["error", "safe"],
    "no-console": "off",
    "camelcase": "off",
    "no-unused-vars": "off", // Disable base rule
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        "argsIgnorePattern": "^_",
        "varsIgnorePattern": "^_",
        "caughtErrorsIgnorePattern": "^_"
      }
    ],
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-non-null-assertion": "error",
  }
};

// Configuration for loose JS linting (applied to src and demo)
const looseJsConfig = {
  files: ["src/**/*.ts", "demo/**/*.ts", "**/*.js"],
  ignores: ["test/**/*.ts"],
  languageOptions: {
    parser: tseslint.parser,
    ecmaVersion: 2021,
    sourceType: "module",
    globals: {
      "console": "readonly",
      "setTimeout": "readonly",
      "setInterval": "readonly",
      "clearInterval": "readonly"
    }
  },
  plugins: {
    "@typescript-eslint": tseslint.plugin,
  },
  rules: {
    ...js.configs.recommended.rules,
    "no-undef": "off",
    "no-unused-vars": "off", // Disable base rule
    "@typescript-eslint/no-unused-vars": "off",

    // Match original rules
    indent: ["error", 2],
    semi: ["error", "always"],
    quotes: ["error", "double"],
    "brace-style": ["error", "1tbs"],
    strict: ["error", "safe"],
    "no-console": "off",
    camelcase: "off",
    "@typescript-eslint/no-non-null-assertion": "error",
  }
};

export default defineConfig([
  // Global ignore
  {
    ignores: ["dist/"]
  },
  // Specific configs
  looseJsConfig,
  strictTsConfig,

  // Specific environment globals
  {
    files: ["demo/webdual/app.ts", "src/client.ts"],
    languageOptions: {
      globals: {
        ...globals.browser,
      }
    }
  },
  {
    files: ["src/server/**/*.ts", "test/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
      }
    }
  },

  // JSONC config
  ...eslintPluginJsonc.configs["flat/recommended-with-json"],
  {
    rules: {
      "jsonc/indent": ["error", 2],
    }
  }
]);
