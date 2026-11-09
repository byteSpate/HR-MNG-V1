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
  ]),
  // Design system rules. Errors since the migration waves finished (Phase 3, wave 6).
  // The same rules, counted per file, are enforced by tools/design-ratchet.mjs.
  {
    files: ["app/**/*.tsx", "components/**/*.tsx"],
    ignores: ["components/ds/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/text-\\[\\d+(\\.\\d+)?px\\]/]",
          message: "Do not pick a font size by hand. Use a named size, for example text-caption, text-body-sm or text-body, or the Heading and Text pieces.",
        },
        {
          selector: "Literal[value=/-\\[#[0-9a-fA-F]{3,8}\\]/]",
          message: "Do not pick a color by hand. Use a named color, for example text-ink-muted, border-line or bg-surface-subtle.",
        },
        {
          selector: "JSXOpeningElement[name.name=/^h[1-3]$/]",
          message: "Use <Heading level=\"page|section|card\"> from components/ds/heading instead of a plain heading tag.",
        },
        {
          selector: "JSXOpeningElement[name.name='img']",
          message: "Use <Img> from components/ds/img. It needs an alt text.",
        },
      ],
    },
  },
]);

export default eslintConfig;
