// eslint-config-next v16 exports a flat config array natively; no FlatCompat needed.
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

export default [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "desktop/**",
      "extension/**",
      "migrate/**",
      "output/**",
      "test-results/**",
      "scripts/*.mjs",
    ],
  },
  {
    rules: {
      // The codebase predates lint; gate on errors, keep style opinions off.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "react/no-unescaped-entities": "off",
      // React Compiler rules shipped in eslint-config-next v16 fire on valid patterns
      // this codebase uses (hydration guards, inner components, intentional ref reads).
      // 15 fires each for set-state-in-effect and refs; 3 for static-components.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/static-components": "off",
      "react-hooks/refs": "off",
    },
  },
];
