import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** Packages and code outside src/core: the core stays pure geometry (CODING_STANDARDS.md). */
const outsideCore = (escape) => ({
  patterns: [
    { regex: "^[^.]", message: "src/core is pure geometry: no packages (Three.js, pdf-lib, DOM helpers) in here." },
    { regex: escape, message: "src/core must not import from outside src/core." },
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
          ],
        },
      ],
    },
  },
);
