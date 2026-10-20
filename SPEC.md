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
10. As a pumpkin carver, I want to enter my pumpkin's height (from the table to a book laid flat on its shoulders, stem left out) and add more tape rings at heights I choose, so that the model matches how squat, tall or lopsided my pumpkin is.
11. As a pumpkin carver with an oval pumpkin, I want an optional depth measurement, so that the model can be narrower front-to-back than side-to-side. (Deferred: every horizontal cross-section is round for now.)
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
24. As a pumpkin carver, I want slits placed automatically where the paper stretches most, and only as many as it needs, so that the paper bends around the curve without wrinkling and without cutting it up more than necessary.
25. As a pumpkin carver, I want to see how many slits Auto chose and override it with my own number, so that I can trade fewer pieces against better fit.
26. As a pumpkin carver, I want to choose the maximum slit depth, so that I can trade template stiffness against fit.
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
43. As a pumpkin carver, I want clear feedback when my measurements are impossible (for example, a ring above the top of the pumpkin, or two rings at the same height), so that I can fix typos instead of getting a broken template.

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

Every physical length in and out of the builder is in millimetres. Inches and centimetres are only **display units**: the carver's choice for the lengths they read or type, converted at the fields and in the printed info block.

Inputs:
- **Design:** closed paths (polylines, or curves broken into segments by the input layer) in arbitrary design units, plus their bounding box.
- **Pumpkin measurements:** the height and one or more tape rings (each a circumference at a fraction of the height), in mm.
- **Placement:** the design's width as seen from the front and its vertical offset (mm), and rotation.
- **Slit options:** count (a number, or Auto) and max depth.

Outputs:
- The flattened design paths in mm on the paper.
- The cut-out outline (the design's outline grown by a margin of 19.05 mm, ¾ in).
- The slit paths.
- Stretch values per area, available both on the 3D surface (for the preview) and on the flat template.
- Warnings: parts past about 60° from the front, impossible measurements, fewer slits fitting than the set count, and Auto stopping with the paper still stretched more than its target.
- The derived surface parameters (the fitted shape's size and side profile), for the preview and the PDF info block.

### Surface model

- The surface is described through a narrow interface: from 2D coordinates on the surface, get a 3D point and the direction the surface faces there; and find where a ray along the viewing direction first hits the surface. This keeps the projection and flattening independent of the shape, so later shapes (a side profile spun around the vertical axis, ribs) can be added without changing the rest.
- Implementation: a side profile spun around the vertical axis, round seen from above.
  - The height is measured directly: from the table to the underside of a book laid flat on the pumpkin's shoulders. Nothing about it is solved for.
  - Each ring is a circumference (radius = circumference ÷ 2π) at a position along the height, 0 at the table and 1 at the top. The form takes it as a height above the table and stores the fraction, so changing the height keeps the rings in proportion. One ring by default, at mid-height.
  - The profile is the smoothest one through every ring at its height. The ring with the largest circumference is the widest part of the pumpkin: the profile only grows down to it and only shrinks after it, so nothing bulges past it, and it never folds back up. With one ring at mid-height it is the ellipsoid with semi-axes C/2π, C/2π, H/2. The top and bottom are never pointed: where a narrow ring would make one so, the profile comes out slightly blunter there instead.
  - The profile is also available on its own, without the 3D surface built from it, so it can be refitted quickly while the carver edits a ring. When no smooth profile passes through the rings, the warning is about the rings as a whole: the fit can't tell which ring is to blame.
  - A new ring takes the circumference the profile already has at its height, so adding it changes nothing until it is measured. When nothing fits, it takes a blend of the rings on either side, or a copy of the one ring next to it at the bottom or top. It goes in the middle of the gap the carver picks: between two rings, or between a ring and the table or the top.
  - The Measure form is a table sorted top to bottom like the Blueprint view: the Height on its own row, then one line per ring with its height above the table, its circumference (Around) and its diameter (Across, derived: a typed diameter d stores d·π exactly). Keystrokes apply as they're typed; on commit (blur or Enter) a typed value is held by the same rules as a drag, without snapping, with a note on its row (or under the Height) when it is. A typed ring height is kept 5 mm from the table and the top, may pass its neighbours (the rows re-sort, the moved row sliding to its place) and may land within 5 mm of another ring with a soft warning. Insert buttons in every gap add a ring there; a row's × removes it, except the last ring's, asking first just as the view's × does (the same "Ask before deleting a ring" setting and "Don't ask again"). In test-grid mode the form shows only the ball's Around and Across.
  - The Measure step shows the form beside the Blueprint view, both editing the same measurements. A ring selected in the view highlights its row (an accent bar and a light tint), scrolling the form to it if need be; focusing any field in a row (or the Height) selects that ring (or the height line) in the view. Selection follows focus, but focus never follows selection: clicking in the view leaves focus there, so the arrow keys keep nudging. Hover works both ways: hovering a row emphasises its line and hovering an insert button shows the view's gap band and ghost ring; hovering a line or a gap in the view highlights its row or insert button. A failed fit's warning goes on the row of the ring edited last; when the page loads with rings that don't fit, it goes under the table, marking no row.
  - Dragging a ring or the height in the Blueprint view follows one set of ring-edit rules (each ring has a stable id so it keeps its identity through edits): ring radius 10–500 mm, height 20–1000 mm, the height between 0.2 and 5 times the widest diameter (not for a ball), and a dragged ring kept 5 mm from its neighbours, the table and the top, though never pulled past where it already sits. Dragging the height keeps every ring's fraction and circumference and stops where the tightest gap would drop below 5 mm. Drags snap to ⅛ in (or 1 mm in centimetres) counted from 0; Alt drags freely. The profile refits every frame of a drag; the 3D view and the template rebuild when it ends. A failed fit is blamed on the ring edited last; on a page load it isn't blamed on any ring.
  - In the Blueprint view, hovering a gap shows where a ring would go, and clicking adds it there: at the gap's middle, with the circumference the profile has there. A gap narrower than 10 mm takes no ring, and a pumpkin has at most 20 rings. Clicking a ring's line or label selects it; its × deletes it, asking first unless "Don't ask again" was ticked (turned back on from the header's settings menu, and saved). Any ring but the last can be deleted, unless taking away the widest ring would leave the pumpkin more than 5 times as tall as it is wide. From the keyboard the view is one Tab stop: Page Up / Page Down select the height or a ring, the arrows nudge it one snap step, Delete deletes the selected ring without asking, and a screen reader hears the selection and nudged values.
- The stem and its dimple are ignored: the model's top is a smooth pole.

### Projection

- Front-view projection: each design point is pushed straight back onto the surface, as if from a projector far in front, along the viewing axis. It's placed according to the design's width, vertical offset and rotation.
- Points that miss the pumpkin's outline (silhouette) are reported as errors or warnings. Points past about 60° from the front are flagged.
- Perspective projection from a set viewing distance is deferred. The projection is kept behind a small interface so it can be added later.

### Flattening

- Build a triangle mesh over the covered part of the surface (the projected cut-out outline plus margin). Mesh it finely enough that the projected design curves are well approximated.
- Slits are cuts in the mesh, running in from the cut-out edge.
- Flatten with ARAP (as-rigid-as-possible) mesh flattening: it finds the flat layout that keeps each triangle closest to its true shape, which is what physically matters when paper is taped down.
- Map design paths into the flat layout through their position inside each triangle (barycentric coordinates).
- Stretch per triangle is computed from how much the flattened triangle differs from the original (its singular values), and is exposed in the output.

### Slit placement

Slits go where they relieve the most stretch. The rules come from measurements in `docs/research/slit-placement.md`.

- **Objective:** the paper's stretch (the per-triangle measure above, over the paper inside the cut-out edge), as an area-weighted root mean square.
- **Greedy trial placement:** slits go in one at a time. For each, 8 candidates spread evenly around the cut-out edge are tried (each round's set sits at other places along the edge). Each candidate runs inward along the shortest path through blank paper, steering around design lines. Each is cut and scored by a short ARAP solve (5 iterations, warm-started from the current layout); the best is kept, and the mesh is solved in full before the next slit.
- **Depth:** each slit runs as deep as the blank paper allows, up to the max depth (2 in by default). Its path through the paper is at most 1.25 × the max depth, so it can't snake along narrow gaps. A slit that can't get about ¾ in deep isn't placed, because short stubs on open paper barely help. With a narrower margin the minimum is 80 % of the margin less the slit's clearance from the design (about 0.52 in with the default ¾ in margin). That way, slits through the margin band still count on solid designs, where they relieve a lot of stretch.
- **Spacing:** a slit stays at least about 1 in from every other slit, along the edge and along its length, so slits don't crowd one gap and leave thin strips of paper.
- **Count:** Auto by default. It adds slits until 95 % of the paper stretches 3 % or less, or the next slit would lower the RMS stretch by less than 3 % (relative), or there are 24. Whenever it stops with the paper still stretching more than 3 % (24 placed, no more fit, or the next would barely help), a warning says so and suggests a smaller design or a wider margin. A count the carver types replaces Auto; if fewer slits fit, a warning says how many did.
- **Finishing:** on paper, each slit's tip is carried a little further straight ahead (the mesh only cuts along its edges), and each side is pulled taut so the printed slit cuts cleanly.
- **Speed:** placing 10 slits takes a few seconds. The build runs in a worker, reports progress ("Placing slits… 4") and stops between slits when a newer edit arrives. The finished set appears at once.
- Moving, removing or dragging individual slits is out of scope.

### PDF output

- Vector output at true physical scale, on Letter or A4 pages.
- Templates bigger than one page are split across pages with an overlap and join marks.
- Content: design paths (outlines by default, with a filled option), the cut-out outline as a solid line, slits as dashed lines, a center cross, an arrow toward the stem, a 10 cm check square, and an info block with the pumpkin measurements and settings, its lengths in the carver's display units.

### Input processing

- Raster pipeline: crop, convert to grayscale, threshold, optionally invert, then Potrace with speckle removal (its turdsize setting). Output curves are broken into short segments to a set tolerance before projection.
- SVG input: the file's paths are read directly and broken into segments the same way.
- Correcting photos taken at an angle is out of scope for v1.

### Settings storage

- The last-used measurements, display units, placement and slit options (count or Auto, and max depth) are saved in localStorage under `pumpkin-template-v2`, every length in mm. Images are not saved. Settings under the first key (`pumpkin-template-settings`, lengths in the display units) are ignored.

## Testing Decisions

- **One test seam: the template builder.** Every automated test calls it with design paths and parameters, and checks only its output geometry, stretch values and warnings. Tests don't reach into the mesh, the ARAP solver, the ellipsoid code or slit placement directly, so those can be rewritten freely.
  - Thin pure helpers in the layers around the core (PDF layout, settings, raster preparation, small UI helpers) may also have direct unit tests; see `docs/adr/0001-test-seams.md`.
- A good test checks behavior you can see from outside, against known formulas or physical properties. It doesn't check intermediate data structures.
- The template builder is built test-first (red-green-refactor).
- Planned tests:
  - **Fitting the shape to measurements:** one ring at mid-height gives the ellipsoid with semi-axes C/2π, C/2π, H/2. A sphere (height = circumference ÷ π, one ring at mid-height) gives equal semi-axes. Several rings are each passed through at their heights, the largest ring is the profile's maximum, and adding a ring read off the fitted shape doesn't change it. Impossible measurements produce a warning instead of bad geometry.
  - **Front projection on a sphere:** a design point at horizontal offset x lands on the surface at the angle arcsin(x/R), and is the expected distance along the surface from the front.
  - **Flattening on a sphere:** distances along lines out from the design center on the template match the true distances along the surface within tolerance. For a design spanning 90°, the default (Auto) slits keep the paper's stretch under set limits (2 % RMS, 3.5 % at the 95th percentile) and well under the stretch without slits.
  - **Slit placement:** with Auto, a design on a sphere gets its 95th-percentile stretch to 3 % or less. A design placed high on a pumpkin that tapers toward the stem gets its slits toward the stem, where the paper stretches most. A count the carver sets is respected. Slits never cross a design path and stay about 1 in apart. Trial placement stretches the paper less than evenly spaced slits did on a recorded case. On solid designs, slits through the margin band are placed and relieve the stretch. When a set count doesn't fit, or Auto stops over its target for any reason, a warning is raised. Auto designs that reach the target get none.
  - **Limit warnings:** designs pushing past about 60° from the front raise the warning. Designs inside that limit don't.
  - **Scale:** a design with a known front-view width, on a large pumpkin (close to flat at small sizes), comes out at that physical size on the flat template.
- **Not tested automatically:** Potrace tracing (a library call with settings passed through), PDF layout and page splitting, the Three.js preview, and the UI. These are covered by a manual real-world test: print a grid template for a basketball (about 29.5 in around), tape it on, and check from the front that the grid looks square and even.
- Prior art: none, since this is a new project with no existing tests. Use Vitest, which fits Vite.

## Out of Scope

- Pumpkin shapes that aren't round seen from above: oval cross-sections (depth) and ribs (the surface interface allows them later).
- Perspective projection from a set viewing distance.
- Correcting photos taken at an angle.
- Moving, removing or dragging individual slits.
- Saving and loading whole projects as files, image included.
- Fitting the pumpkin's shape from a photo.
- Deployment to static hosting (comes after v1 works locally).
- Modeling the stem dimple.

## Further Notes

- The core physical limit: paper can't lie flat on a doubly curved surface without stretching. ARAP spreads the unavoidable stretch evenly, and slits relieve most of it. Small designs (under about 90° across) fit well. Very large wraparound designs will still show some stretch; the tint and warnings make this visible.
- Ribs matter less than you'd expect for v1: taped paper sits across the tops of the ribs rather than following each groove, so a smooth surface of revolution is a reasonable model.
- Published to GitHub Issues as Carigon/sphereprojection#1.
