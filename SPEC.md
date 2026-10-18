# Spec: Pumpkin Carving Template Generator

Status: published as https://github.com/Carigon/sphereprojection/issues/1 (ready-for-agent). The issue is canonical.

## Problem Statement

I have a 2D carving design (a scanned stencil, or vector art) that I want to carve into a pumpkin. If I print the design flat and tape it onto the pumpkin, it doesn't look like my design anymore: the pumpkin curves away from me, so features near the edges get squashed when seen from the front. The paper also won't lie flat on the curved surface, so it wrinkles and shifts. Pumpkins vary too, from squat to tall, so one fixed correction won't work for every pumpkin. I want a template that, once taped onto *this* pumpkin, puts every line where it needs to be so the carved result looks like my original design from the front.

## Solution

A browser-based tool. I load my design (an SVG, or a scan/photo of line art that the tool traces into vector paths) and enter a few tape-measure measurements of my pumpkin. I set how wide the design should be as seen from the front, plus where it sits and how it's rotated. The tool shows a 3D preview of the design on a model of my pumpkin and tints any heavily stretched areas. Then it generates a true-scale vector PDF, split across pages. The template has been pre-warped so it looks right from the front, and it's flattened so it lies on the pumpkin's surface with as little stretch as possible. Slits cut in from the edge, placed between design lines, let the paper bend around the curve. I print it, cut it out along the solid and dashed lines, tape it on, and trace the design onto the skin.

## User Stories

1. As a pumpkin carver, I want to upload a scanned image of a stencil, so that I can use carving patterns I already have on paper.
2. As a pumpkin carver, I want to upload an SVG file, so that crisp vector art goes straight in without a tracing step.
3. As a pumpkin carver, I want my scanned stencil turned into vector paths automatically, so that the printed template has sharp, clean cut lines instead of blurry pixels.
4. As a pumpkin carver, I want a threshold slider, so that I can control which parts of a grayscale scan count as "carve" areas.
5. As a pumpkin carver, I want an invert option, so that I can use stencils where the carve areas are white on black.
6. As a pumpkin carver, I want a speckle-removal setting, so that dust and scanner noise don't become tiny unwanted carve areas.
7. As a pumpkin carver, I want to crop the uploaded image, so that page borders and scan edges aren't traced as part of the design.
8. As a pumpkin carver, I want to see the traced result before continuing, so that I can adjust the cleanup settings until the trace looks right.
9. As a pumpkin carver, I want to enter my pumpkin's widest circumference from a tape measure, so that the model matches my pumpkin's real size.
10. As a pumpkin carver, I want to enter the stem-to-base arc measured over the front, so that the model matches how squat or tall my pumpkin is.
11. As a pumpkin carver with an oval pumpkin, I want an optional depth measurement, so that the model can be narrower front-to-back than side-to-side.
12. As a pumpkin carver, I want to switch between inches and centimeters, so that I can work in whichever units my tape measure uses.
13. As a pumpkin carver, I want inches as the default unit, so that the common case needs no setup.
14. As a pumpkin carver, I want to set the design's width as seen from the front, so that I control how big the face looks on the pumpkin.
15. As a pumpkin carver, I want to move the design up or down, so that I can place a face above the pumpkin's widest point where it looks natural.
16. As a pumpkin carver, I want to rotate the design slightly, so that I can match a pumpkin that leans or a stem that's off-center.
17. As a pumpkin carver, I want a 3D preview of the design on my pumpkin model, so that I can see the result before printing.
18. As a pumpkin carver, I want to orbit the 3D preview, so that I can see how the design wraps toward the sides.
19. As a pumpkin carver, I want the preview updated live as I change measurements or placement, so that I can adjust things quickly.
20. As a pumpkin carver, I want heavily stretched areas tinted in the preview, so that I know which parts of the design will be hard to reproduce faithfully.
21. As a pumpkin carver, I want a warning when parts of my design pass about 60° from the front, so that I know they'll be distorted on the skin, without being blocked from doing it anyway.
22. As a pumpkin carver, I want my design to look exactly like the original when the carved pumpkin is viewed from the front, so that my carving matches what I drew.
23. As a pumpkin carver, I want the flat template to lie on the pumpkin with as little stretch as possible, so that taped-down lines land where they should.
24. As a pumpkin carver, I want slits placed automatically, so that the paper bends around the curve without wrinkling.
25. As a pumpkin carver, I want to choose how many slits there are, so that I can trade fewer pieces against better fit.
26. As a pumpkin carver, I want to choose how deep the slits go, so that I can trade template stiffness against fit near the edges.
27. As a pumpkin carver, I want slits that steer around my design's lines, so that no slit cuts through a line I need to trace.
28. As a pumpkin carver, I want the cut-out edge to follow my design's outline plus a margin, so that I don't waste paper or tape a huge sheet onto the pumpkin.
29. As a pumpkin carver, I want the cut-out edge drawn as a solid line and the slits as dashed lines, so that I know exactly what to cut.
30. As a pumpkin carver, I want the template exported as a vector PDF at true scale, so that it prints at exactly the right size.
31. As a pumpkin carver, I want large templates split across several Letter or A4 pages, so that I can print on a normal home printer.
32. As a pumpkin carver, I want overlap and join marks on split pages, so that I can tape the pages together accurately.
33. As a pumpkin carver, I want to choose Letter or A4 paper, so that it matches the paper in my printer.
34. As a pumpkin carver, I want a 10 cm check square on the template, so that I can confirm my printer didn't scale the page.
35. As a pumpkin carver, I want a center cross on the template, so that I can line it up with the point I chose on the pumpkin.
36. As a pumpkin carver, I want an arrow pointing toward the stem, so that I tape the template on the right way up.
37. As a pumpkin carver, I want the pumpkin measurements the template was made for printed on it, so that I don't mix up templates for different pumpkins.
38. As a pumpkin carver, I want carve areas printed as outlines by default, so that I save ink and can trace through with a poker.
39. As a pumpkin carver, I want an option to print carve areas filled, so that I can clearly see what gets removed when that's easier to read.
40. As a returning user, I want my last measurements, units and slit settings remembered, so that I don't have to re-enter them every time.
41. As a privacy-conscious user, I want everything processed in my browser, so that my images never get uploaded anywhere.
42. As a pumpkin carver, I want to print a grid test template for a ball of known size, so that I can check the tool is accurate before using it on a real pumpkin.
43. As a pumpkin carver, I want clear feedback when my measurements are impossible (for example, an arc too short for the circumference), so that I can fix typos instead of getting a broken template.

## Implementation Decisions

### Architecture

- Static, client-side-only web app: TypeScript, Vite, Three.js for the 3D preview, a Potrace WASM/JS port for tracing, and pdf-lib for vector PDF output. No backend. Runs locally (dev server) first; static hosting (e.g. GitHub Pages) later.
- The core is a single pure **template builder** with no DOM, canvas, WebGL or PDF dependencies. Everything else is a thin layer around it:
  - **Input layer:** image to cleaned bitmap to traced vector paths (Potrace), or SVG to vector paths. Its output is a list of closed paths in design units.
  - **Template builder (core):** design paths + pumpkin measurements + placement + slit options in; template geometry out (see the contract below).
  - **Preview layer:** renders the pumpkin model and the projected design in Three.js, tinted by stretch.
  - **PDF layer:** lays the template geometry out at true scale on tiled pages with marks, using pdf-lib.
  - **Settings storage:** saves and restores the last settings in localStorage.

### Template builder contract

Inputs:
- **Design:** closed paths (polylines, or curves broken into segments by the input layer) in arbitrary design units, plus their bounding box.
- **Pumpkin measurements:** widest circumference, the stem-to-base arc over the front, optional depth, and units.
- **Placement:** the design's width as seen from the front (physical units), vertical offset, and rotation.
- **Slit options:** count and depth.

Outputs:
- The flattened design paths in physical paper units.
- The cut-out outline (the design's outline grown by a margin of about ¾ in).
- The slit paths.
- Stretch values per area, available both on the 3D surface (for the preview) and on the flat template.
- Warnings: parts past about 60° from the front, impossible measurements, and slits that couldn't avoid design lines.
- The derived surface parameters (the ellipsoid's semi-axes), for the preview and the PDF info block.

### Surface model

- The surface is described through a narrow interface: from 2D coordinates on the surface, get a 3D point and the direction the surface faces there; and find where a ray along the viewing direction first hits the surface. This keeps the projection and flattening independent of the shape, so later shapes (a side profile spun around the vertical axis, ribs) can be added without changing the rest.
- v1 implementation: an ellipsoid that is round seen from above, with optional separate depth.
  - Horizontal radius = circumference ÷ 2π.
  - Height is solved numerically so that the meridian arc from stem to base (along the front) matches the measured arc.
  - With depth given, the front-to-back semi-axis is set from it. The circumference is then read as the circumference of the resulting ellipse, and the side-to-side semi-axis is solved from it.
- The stem dimple is ignored.

### Projection

- Front-view projection: each design point is pushed straight back onto the surface, as if from a projector far in front, along the viewing axis. It's placed according to the design's width, vertical offset and rotation.
- Points that miss the pumpkin's outline (silhouette) are reported as errors or warnings. Points past about 60° from the front are flagged.
- Perspective projection from a set viewing distance is deferred. The projection is kept behind a small interface so it can be added later.

### Flattening

- Build a triangle mesh over the covered part of the surface (the projected cut-out outline plus margin). Mesh it finely enough that the projected design curves are well approximated.
- Slits are cuts in the mesh, running from the outline toward the design center.
- Flatten with ARAP (as-rigid-as-possible) mesh flattening: it finds the flat layout that keeps each triangle closest to its true shape, which is what physically matters when paper is taped down.
- Map design paths into the flat layout through their position inside each triangle (barycentric coordinates).
- Stretch per triangle is computed from how much the flattened triangle differs from the original (its singular values), and is exposed in the output.

### Slit placement

- N slits are spaced evenly in angle around the design center. Each starts at the cut-out edge and runs inward to a set depth.
- Each slit is moved sideways or bent so it runs through blank paper and doesn't cross any design path. If it can't, the slit is shortened and a warning is raised.
- Dragging slits by hand is deferred.

### PDF output

- Vector output at true physical scale, on Letter or A4 pages.
- Templates bigger than one page are split across pages with an overlap and join marks.
- Content: design paths (outlines by default, with a filled option), the cut-out outline as a solid line, slits as dashed lines, a center cross, an arrow toward the stem, a 10 cm check square, and an info block with the pumpkin measurements and settings.

### Input processing

- Raster pipeline: crop, convert to grayscale, threshold, optionally invert, then Potrace with speckle removal (its turdsize setting). Output curves are broken into short segments to a set tolerance before projection.
- SVG input: the file's paths are read directly and broken into segments the same way.
- Correcting photos taken at an angle is out of scope for v1.

### Settings storage

- The last-used measurements, units, placement and slit options are saved in localStorage. Images are not saved.

## Testing Decisions

- **One test seam: the template builder.** Every automated test calls it with design paths and parameters, and checks only its output geometry, stretch values and warnings. Tests don't reach into the mesh, the ARAP solver, the ellipsoid code or slit placement directly, so those can be rewritten freely.
- A good test checks behavior you can see from outside, against known formulas or physical properties. It doesn't check intermediate data structures.
- The template builder is built test-first (red-green-refactor).
- Planned tests:
  - **Fitting the shape to measurements:** the ellipsoid worked out from a circumference and arc reproduces those measurements within tolerance. A sphere (arc = half the circumference) gives equal semi-axes. Impossible measurements produce a warning instead of bad geometry.
  - **Front projection on a sphere:** a design point at horizontal offset x lands on the surface at the angle arcsin(x/R), and is the expected distance along the surface from the front.
  - **Flattening on a sphere:** distances along lines out from the design center on the template match the true distances along the surface within tolerance. Stretch stays under a set limit for a design spanning 90° with the default slits.
  - **Slit avoidance:** for designs with paths placed in known spots, no slit crosses a design path. When avoidance is impossible, a warning is raised.
  - **Limit warnings:** designs pushing past about 60° from the front raise the warning. Designs inside that limit don't.
  - **Scale:** a design with a known front-view width, on a large pumpkin (close to flat at small sizes), comes out at that physical size on the flat template.
- **Not tested automatically:** Potrace tracing (a library call with settings passed through), PDF layout and page splitting, the Three.js preview, and the UI. These are covered by a manual real-world test: print a grid template for a basketball (about 29.5 in around), tape it on, and check from the front that the grid looks square and even.
- Prior art: none, since this is a new project with no existing tests. Use Vitest, which fits Vite.

## Out of Scope

- Pumpkin shapes beyond the ellipsoid: side-profile shapes and ribs (the surface interface allows them later).
- Perspective projection from a set viewing distance.
- Correcting photos taken at an angle.
- Dragging slits by hand.
- Saving and loading whole projects as files, image included.
- Fitting the pumpkin's shape from a photo.
- Deployment to static hosting (comes after v1 works locally).
- Modeling the stem dimple.

## Further Notes

- The core physical limit: paper can't lie flat on a doubly curved surface without stretching. ARAP spreads the unavoidable stretch evenly, and slits relieve most of it. Small designs (under about 90° across) fit well. Very large wraparound designs will still show some stretch; the tint and warnings make this visible.
- Ribs matter less than you'd expect for v1: taped paper sits across the tops of the ribs rather than following each groove, so a smooth ellipsoid is a reasonable model.
- Published to GitHub Issues as Carigon/sphereprojection#1.
