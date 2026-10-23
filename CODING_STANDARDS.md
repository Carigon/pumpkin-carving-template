# Coding standards

Read during review. Every rule here is a judgement call; the mechanical rules live in tooling (see the last section), so skip anything `npm run check` already enforces.

## Lengths are millimetres

Every physical length inside the app is in mm: builder input and output, saved settings, module state. Inches and cm are **display units** (GLOSSARY.md) and appear only where the carver reads or types a length, converted by `src/displayUnits.ts`. Name a length constant with an `_MM` suffix.

Flag: a length stored or passed in inches or cm, a new local conversion factor (`25.4`, `2.54`, `72 / 25.4`) where `displayUnits.ts` or an existing constant already has it.

## Pure core, thin rendering

- `src/core` is the geometry: measurements and a design in, a template out, no DOM and no packages. Tooling enforces the imports; review the spirit: logic that belongs in the core (a fit, a geometric rule) should not grow in `src/ui` or `src/main.ts`.
- Outside the core, a view is a **pure geometry module** plus a **DOM wiring module**: `src/paperView.ts` + `src/ui/paperViewSvg.ts`, `src/blueprintView.ts` + `src/ui/blueprintViewSvg.ts`. The geometry module computes what to draw and is unit-tested; the SVG module only draws it and wires events. Flag decisions (hit tests, limits, refusals) made in the wiring module.
- Shared rules have one home. Ring edits (insert, delete, drag, typed values) go through `src/ringEdits.ts`, so the Blueprint view and the Measure form agree. Flag a second copy of a rule that module already holds.

## Tests

`docs/adr/0001-test-seams.md` is the authority. Beyond the import rule tooling checks:

- Tests assert behaviour visible from outside (template geometry, warnings, page marks, stored values), not intermediate structures.
- A pure helper outside the core that gains direct tests is listed in the ADR's Context in the same change.
- Test names say what the test checks; flag a name the body no longer matches.

## Vocabulary

Names in code, comments, tests and UI text use GLOSSARY.md's terms. Flag a term listed under _Avoid_, or a new domain concept the glossary lacks (propose adding it).

## Reuse before writing

Check for an existing helper before accepting a new local one: `src/core/geometry/vector.ts` and `polygon.ts` for vector and polygon math, `src/displayUnits.ts` for unit conversion, `src/ui/svg.ts` for SVG element building, `src/stretchTint.ts` for stretch thresholds. Duplicated helpers and constants were the most common review finding so far.

## Dead code

Knip catches unused exports and files. Review what it can't see: an interface member or parameter nothing reads any more, a branch for a case the change made impossible, a doc comment that describes the code as it was.

## Style

Match the surrounding code: compact functional TypeScript, factories returning plain objects, short plain doc comments on exports and on every named constant. Comments say why, or what a number means; they don't narrate the code.

## Enforced by tooling (skip in review)

`npm run check` runs, and CI runs it on every PR:

- `tsc` on the whole app, plus `tsconfig.core.json`: the core type-checked without the DOM.
- ESLint (`eslint.config.js`): typescript-eslint's type-checked recommended rules; `src/core` imports no packages and nothing outside itself; tests import the core only through `src/core/index.ts`.
- Knip: unused files, exports and dependencies.
- Vitest.
