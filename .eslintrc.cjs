/**
 * This is intended to be a basic starting point for linting in your app.
 * It relies on recommended configs out of the box for simplicity, but you can
 * and should modify this configuration to best suit your team's needs.
 */

/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: {
      jsx: true,
    },
  },
  env: {
    browser: true,
    commonjs: true,
    es6: true,
  },
  ignorePatterns: [
    "!**/.server",
    "!**/.client",
    "extensions/script-injector/assets/**",
    "admin-panel/**",
  ],

  // Base config
  extends: ["eslint:recommended"],
  rules: {
    "no-empty": ["error", { allowEmptyCatch: false }],
  },

  overrides: [
    // Server-only modules run on Node: allow process, Buffer, etc.
    {
      files: [
        "app/lib/**/*.{js,ts}",
        "app/routes/api.*.{js,jsx}",
        "scripts/**/*.mjs",
        "tests/**/*.js",
      ],
      env: { node: true },
    },
    // React
    {
      files: ["**/*.{js,jsx,ts,tsx}"],
      plugins: ["react", "jsx-a11y"],
      extends: [
        "plugin:react/recommended",
        "plugin:react/jsx-runtime",
        "plugin:react-hooks/recommended",
        "plugin:jsx-a11y/recommended",
      ],
      settings: {
        react: {
          version: "detect",
        },
        formComponents: ["Form"],
        linkComponents: [
          { name: "Link", linkAttribute: "to" },
          { name: "NavLink", linkAttribute: "to" },
        ],
        "import/resolver": {
          typescript: {},
        },
      },
      rules: {
        "react/no-unknown-property": ["error", { ignore: ["variant"] }],
      },
    },

    // Typescript
    {
      files: ["**/*.{ts,tsx}"],
      plugins: ["@typescript-eslint", "import"],
      parser: "@typescript-eslint/parser",
      parserOptions: {
        project: ["./tsconfig.json"],
        tsconfigRootDir: __dirname,
      },
      settings: {
        "import/internal-regex": "^~/",
        "import/resolver": {
          node: {
            extensions: [".ts", ".tsx"],
          },
          typescript: {
            alwaysTryTypes: true,
          },
        },
      },
      extends: [
        "plugin:@typescript-eslint/recommended",
        "plugin:import/recommended",
        "plugin:import/typescript",
      ],
      rules: {
        "@typescript-eslint/no-floating-promises": [
          "error",
          { ignoreVoid: true, ignoreIIFE: true },
        ],
      },
    },

    // Node
    {
      files: [
        ".eslintrc.cjs",
        "vite.config.{js,ts}",
        ".graphqlrc.{js,ts}",
        "shopify.server.{js,ts}",
        "**/*.server.{js,ts}",
      ],
      env: {
        node: true,
      },
    },

    // Logging: use app/lib/logger.js instead of console.* in app code.
    {
      files: ["app/**/*.{js,jsx,ts,tsx}"],
      rules: { "no-console": "error" },
    },
    {
      // The logger itself writes to stdout/stderr; audit-logging emits its own
      // JSON events; audit-script / script-generator build browser-side code
      // strings. The dashboard-* modules are the unwired refactor cluster
      // (PROJECT_FLOW.md 17.3) awaiting a wire-or-delete decision.
      files: [
        "app/lib/logger.ts",
        "app/lib/audit-logging.server.ts",
        "app/lib/audit-script.ts",
        "app/lib/script-generator.js",
        "app/lib/dashboard-*.server.js",
        "app/lib/dashboard-*.server.ts",
      ],
      rules: { "no-console": "off" },
    },
  ],
  globals: {
    shopify: "readonly",
  },
};
