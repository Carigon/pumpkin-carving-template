import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** Packages and code outside src/core: the core stays pure geometry (CODING_STANDARDS.md). */
const outsideCore = (escape) => ({
  patterns: [
    { regex: "^[^.]", message: "src/core is pure geometry: no packages (Three.js, pdf-lib, DOM helpers) in here." },
    { regex: escape, message: "src/core must not import from outside src/core." },
  ],
});

/**
 * The hand-trace editor stays pure like the core (ADR 0001): no packages, and nothing outside src/handTrace but the
 * core's public index. `up` is the escaped relative path from the file's folder back to src/.
 */
const editorOnly = (up) => ({
  patterns: [
    { regex: "^[^.]", message: "src/handTrace is pure: no packages (or DOM helpers) in here." },
    {
      regex: `^${up}(?!core$)`,
      message: "src/handTrace imports nothing outside itself but the core's public index (docs/adr/0001-test-seams.md).",
    },
  ],
});

export default tseslint.config(
  { ignores: ["dist", "node_modules", ".claude"] },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: { allowDefaultProject: ["*.js"] } } },
    rules: {
      // `const { kind: _, ...rest } = x` is how this code drops a field.
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },
  { files: ["**/*.js"], extends: [tseslint.configs.disableTypeChecked] },
  {
    files: ["src/core/*.ts"],
    rules: { "no-restricted-imports": ["error", outsideCore("^\\.\\./")] },
  },
  {
    files: ["src/core/*/**/*.ts"],
    rules: { "no-restricted-imports": ["error", outsideCore("^(\\.\\./){2,}")] },
  },
  {
    files: ["src/handTrace/*.ts"],
    rules: { "no-restricted-imports": ["error", editorOnly("\\.\\./")] },
  },
  {
    files: ["src/handTrace/*/**/*.ts"],
    rules: { "no-restricted-imports": ["error", editorOnly("\\.\\./\\.\\./")] },
  },
  {
    files: ["test/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "src/core/",
              message: "Tests reach the core only through its public index, ../src/core (docs/adr/0001-test-seams.md).",
            },
            {
              regex: "src/handTrace/",
              message:
                "Tests reach the hand-trace editor only through its public index, ../src/handTrace (docs/adr/0001-test-seams.md).",
            },
          ],
        },
      ],
    },
  },
);
