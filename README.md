# Pumpkin Carving Template

Turn a flat carving design and your pumpkin's tape-measure measurements into a printable template that, taped on, looks like the design from the front.

**Try it:** https://carigon.github.io/pumpkin-carving-template/

A design printed flat and taped to a pumpkin gets stretched as it wraps around the curve, so it looks wrong from the front. This app works out the pumpkin's shape from a few measurements, projects the design onto it as seen from the front, and flattens that back onto paper, adding slits where the paper needs to spread to lie on the curve.

## How it works

The app walks through three steps:

1. **Measure**: the pumpkin's height and a few **rings** (level tape measurements around it at different heights). The app fits a smooth **profile** through them; the Blueprint view shows it against a ruler, and you can drag rings there to adjust it.
2. **Design**: load an SVG, or a scanned stencil or photo that gets traced into outlines. Size, rotate and position it on the pumpkin.
3. **Template**: check the flattened template on the page, with a tint showing where the paper stretches, then export a true-scale PDF on Letter or A4. Templates bigger than a page are split across pages.

There's also a **test grid** mode that prints a square grid to tape on a ball, for checking the method on a shape you already know. [docs/manual-checks.md](docs/manual-checks.md) says how, along with the other checks run by hand on real devices.

All the work happens in the browser; nothing is uploaded.

[GLOSSARY.md](GLOSSARY.md) defines the terms used here and in the code.

## Development

Requires the Node version in `.node-version`.

```bash
npm install
```

```bash
npm run dev
```

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check and build to `dist/` |
| `npm test` | Vitest |
| `npm run check:static` | Type-check, ESLint and knip; the pre-commit hook runs this |
| `npm run check` | `check:static` plus the tests; CI runs this on every PR |

Pushes to `main` deploy to GitHub Pages.

### Layout

- `src/core`: the geometry, with no DOM and no packages. Measurements and a design go in, a flat template comes out (`buildTemplate`).
- `src/input`: reading SVG designs and tracing images.
- `src/pdf`: page layout and PDF rendering.
- `src/ui`, `src/preview`: the controls, the 2D views and the 3D preview.
- `src/worker`: runs the template build off the main thread.
- `test`: Vitest tests, mostly through `buildTemplate`; [ADR 0001](docs/adr/0001-test-seams.md) explains why.

[CODING_STANDARDS.md](CODING_STANDARDS.md) covers what review looks for; [docs/research](docs/research/slit-placement.md) holds the measurements behind slit placement.
