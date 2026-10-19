# 1. The template builder is the test seam for core geometry; thin helpers around it may have direct tests

Status: accepted

## Context

The spec names one test seam: the template builder (`buildTemplate`). Every core geometry test goes
through it and checks only its output, so the mesh, the ARAP solver, the ellipsoid fit, the cut-out
edge and slit placement can be rewritten freely. The spec also lists PDF layout, the UI and tracing as
"not tested automatically".

While building the layers around the core, a few small pure helpers got direct unit tests anyway:
PDF page layout and tiling (`test/pdf-layout.test.ts`), raster preparation before tracing
(`test/raster-prep.test.ts`), settings storage (`test/settings.test.ts`), the calibration grid's PDF
export (`test/calibration-grid.test.ts`) and the unit-switching length fields
(`test/length-fields.test.ts`). They are cheap, fast, and have caught real mistakes (page tiling,
corrupt saved settings, unit drift).

## Decision

- Core geometry is tested only through `buildTemplate`. No test imports from `src/core/` other than
  its public index.
- Thin, pure helpers in the layers around the core (input, PDF layout, settings, small UI helpers)
  may have direct unit tests at their own public functions, as long as those tests check behaviour
  you can see from outside the helper (page marks, stored values, field values) and not its internals.
- Rendering (pdf-lib drawing beyond "it produces a valid document"), the Three.js preview, Potrace
  itself and DOM wiring stay untested automatically; the printed basketball grid remains the manual
  end-to-end check.

## Consequences

- The core keeps one seam, so its internals stay free to change.
- The extra tests pin the public shape of a few small helpers (e.g. `layoutTemplatePdf`'s marks); a
  change to those shapes means updating those tests too.
