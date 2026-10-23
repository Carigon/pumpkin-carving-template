# Perspective-correcting a photo in the browser

Research for [#7](https://github.com/Carigon/pumpkin-carving-template/issues/7), run on 2026-10-23. It answers how to straighten a phone photo of a drawing on paper, taken at an angle, entirely in the browser: the maths for four dragged corners, how to resample, how fast it is, what aspect ratio the result gets, and whether the corners can be found automatically.

## Answer

Write it ourselves; no library. The homography from four corners is a closed formula of about 20 lines. The warp is an inverse-mapped bilinear loop of about 40 lines, run in the existing worker on a photo first downscaled with the browser's high-quality resize. Pick the output aspect ratio from the corners with Zhang and He's rectangle formula, using a fixed phone focal length rather than estimating one, and offer paper presets. Leave automatic corner detection out of v1.

## 1. The homography from four corners

A homography is a 3×3 matrix `H`, defined up to scale, so it has 8 degrees of freedom. Each point correspondence gives 2 equations, so 4 corners, no three of them collinear, fix it exactly. This is the minimal case in Hartley and Zisserman's *Multiple View Geometry*, 2nd ed. (2003), §4.1. Their normalised DLT (Algorithm 4.2) exists for the over-determined, noisy case (n > 4 points, solved by SVD). With exactly 4 points there is nothing to fit.

Three ways to get `H` from 4 points, all exact:

- **8×8 linear solve.** Fix `h33 = 1` and solve 8 equations. OpenCV's `getPerspectiveTransform` does exactly this, and falls back to an SVD only if the solve fails ([imgwarp.cpp](https://github.com/opencv/opencv/blob/4.x/modules/imgproc/src/imgwarp.cpp), `cv::getPerspectiveTransform`).
- **Closed-form square-to-quad.** This is the one to use. Heckbert, *Fundamentals of Texture Mapping and Image Warping* ([UCB/CSD-89-516](https://www2.eecs.berkeley.edu/Pubs/TechRpts/1989/5504.html), 1989), §2.2.3, gives the projective map from the unit square to any quad in closed form, with no linear solve. glfx.js uses the same formula ([matrix.js](https://github.com/evanw/glfx.js/blob/master/src/core/matrix.js), credited to Java JAI's `PerspectiveTransform`). The quad-to-rectangle map is its inverse composed with a scale. The inverse of a 3×3 matrix is its adjugate over the determinant.
- A library. That means pulling 13 MB (section 2) in for 20 lines.

The closed form, with corners `q0..q3` = top-left, top-right, bottom-right, bottom-left (row-major, column vectors, mapping `(u, v)` in the unit square to the photo):

```ts
function squareToQuad([x0, y0, x1, y1, x2, y2, x3, y3]: number[]): number[] {
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
  const den = dx1 * dy2 - dx2 * dy1; // 0 only for a degenerate quad (three corners collinear)
  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0,
          y1 - y0 + g * y1, y3 - y0 + h * y3, y0,
          g, h, 1];
}
```

In a throwaway Node check, this mapped the output corners onto the four picked corners exactly (to 6 decimals), and its inverse mapped back exactly. It costs about 0.1 µs per call. The UI has to keep the quad convex and non-degenerate (`den` far from 0) while corners are dragged, or the map folds.

Two properties matter beyond the warp:

- **`H` is invertible**, so any point can move between photo space and corrected space at any time (`H⁻¹` is the adjugate).
- **Straight lines map to straight lines**, but Bézier curves don't stay polynomial Béziers: polynomial Bézier curves are invariant under affine maps only, and under a projective map they become rational Bézier curves (Farin, *Curves and Surfaces for CAGD*, 5th ed., 2002, the chapter on rational Bézier curves). See "What this changes for other tickets" below.

## 2. Resampling: options

The warp is done backwards. For each output pixel, map it through `H` into the photo and sample there. OpenCV's `warpPerspective` defines it the same way, with `INTER_LINEAR` (bilinear) or `INTER_NEAREST` as the only interpolation choices ([imgproc.hpp](https://github.com/opencv/opencv/blob/4.x/modules/imgproc/include/opencv2/imgproc.hpp)).

| Option | Can it do a projective warp? | Cost to the app | Verdict |
|---|---|---|---|
| Canvas 2D `drawImage` with `setTransform` | **No.** The transform matrix is fixed at `[a c e; b d f; 0 0 1]`, which is affine only ([HTML spec, transformations](https://html.spec.whatwg.org/multipage/canvas.html#transformations)). Faking it with many small triangles gives an approximation with seams. | None | Rejected |
| WebGL fragment shader | Yes: a texture lookup through `H` per pixel. It's the fastest option, and WebGL2 gets mipmaps for non-power-of-two textures. | A GL context and its loss handling, shader code, `readPixels` to get pixels back for auto-trace, and texture size limits: 25 % of Android devices report `MAX_TEXTURE_SIZE` of only 4096 ([web3dsurvey](https://web3dsurvey.com/webgl2/parameters/MAX_TEXTURE_SIZE)), so a 50 MP photo has to be downscaled first anyway | Keep as an upgrade if phones are too slow |
| OpenCV.js (`@techstark/opencv-js` 5.0.0, Apache-2.0) | Yes: `getPerspectiveTransform` + `warpPerspective` | `dist/opencv.js` is **13.3 MB, 3.75 MB gzipped** (measured from the npm tarball). Its warp is plain bilinear, with no better filtering than our own. | Rejected: too heavy for ~60 lines |
| glfx.js (MIT) | Yes: a WebGL `perspective(before, after)` filter that uses the same square-to-quad maths | Last npm release in 2016 (0.0.4) and no types. You'd still need the WebGL readback. | Rejected: unmaintained, and it saves little |
| **Our own JS loop** | Yes | About 60 lines, DOM-free, testable in Vitest | **Recommended** |

### Speed of our own loop

A throwaway benchmark warped a synthetic 4032×3024 (12 MP) image with an angled paper quad. It used Node 24 on an Intel i9-9900K desktop, single-threaded, RGBA bilinear, median of 5 runs:

| Output | Samples per pixel | Time |
|---|---|---|
| 1500×2000 (3 MP, about auto-trace's 2000 px limit) | 1 | **114 ms** |
| 1500×2000 | 2×2 supersampled | 356 ms |
| 3000×4000 (12 MP) | 1 | 435 ms |

Phones weren't measured. Expect them to be several times slower than this desktop, so a few hundred ms for a 2000 px output. That's fine **once per corner release**, in the existing worker, but not on every `pointermove`. While a corner is being dragged, show the original photo with the quad drawn over it. If live feedback is wanted, warp a small preview: a 400 px output is about 1/20 of the pixels, about 6 ms on this desktop.

### Quality

The output is about 2000 px, and the source photo is about 4000 px. So most of the warp *shrinks* the image, about 2× on the near edge and less on the far edge. Bilinear sampling alone then aliases: it reads only 4 source pixels per output pixel. That's tolerable for pencil lines about 5 px wide in a 12 MP photo, but it's avoidable. Downscale the photo first with the browser's own filter, then warp at a scale near 1:

- `createImageBitmap(file, { resizeWidth, resizeQuality: "high" })` decodes and downscales in one step. The spec lets `"high"` cost more for better interpolation ([HTML spec, createImageBitmap](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html)). It's in Safari 15+ ([MDN browser-compat-data](https://github.com/mdn/browser-compat-data/blob/main/api/_globals/createImageBitmap.json)).
- Pre-scale so the paper's longest side in the photo is about the output's long side. Don't just halve the whole photo: the paper might fill only part of the frame.

Other browser facts that matter:

- **EXIF orientation is already handled.** `createImageBitmap`'s `imageOrientation` defaults to `"from-image"`. The spec defines `"flipY"` as the option that disregards EXIF, so the default respects it. Supported in Safari 15+. Corners and points should all live in this oriented pixel space, which is what `tracePanel.ts` already decodes to.
- **Canvas size is not the limit.** WebKit caps a canvas at 8192 × 8192 pixels of area on iOS ([CanvasBase.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/CanvasBase.cpp), `maxCanvasArea`), so 12 MP fits. A full RGBA 12 MP buffer is 48 MB, which is another reason to downscale first.
- **`OffscreenCanvas` works in a worker** in Safari 16.4+, Chrome 69+ and Firefox 105+ ([browser-compat-data](https://github.com/mdn/browser-compat-data/blob/main/api/OffscreenCanvas.json)). `traceImage.ts` already relies on it.

## 3. Output aspect ratio when the paper size is unknown

The four corners say where the paper is, but not its shape: a tall sheet seen from a low angle looks like a square. Averaging opposite side lengths is the obvious guess, and it's wrong by a lot.

Zhang and He, ["Whiteboard scanning and image enhancement"](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/11/Digital-Signal-Processing.pdf), *Digital Signal Processing* 17 (2007) 414–432, §3.2, recover a rectangle's true aspect ratio from its four imaged corners. It assumes square pixels and the principal point at the image centre:

- With corners `m1..m4` = top-left, top-right, bottom-left, bottom-right (note the different order from section 1) as homogeneous `(x − cx, y − cy, 1)`:
  - `k2 = ((m1×m4)·m3) / ((m2×m4)·m3)` and `k3 = ((m1×m4)·m2) / ((m3×m4)·m2)`
  - `n2 = k2·m2 − m1` and `n3 = k3·m3 − m1`
- Focal length (eq. 21 with the centre at the origin): `f² = −(n2x·n3x + n2y·n3y) / (n2z·n3z)`
- Aspect ratio (eq. 20): `(w/h)² = (n2x² + n2y² + f²·n2z²) / (n3x² + n3y² + f²·n3z²)`

Their Table 1 measured 1.4–5.7 % error on real photos with hand-clicked corners, against up to 30.8 % for the bounding box.

**The catch: estimating `f` per photo fails for the most common phone pose.** The paper's §3.2.3 shows `f` is undefined when either pair of opposite sides is parallel in the image. That's exactly what you get by holding a phone above a sheet on a table and tilting it straight toward the sheet. I simulated a Letter sheet (true w/h 0.774) at a phone-like focal length (3100 px on a 4032 px-wide image), with ±4 px of corner-click noise and 200 trials:

| Pose (tilt / yaw / roll, degrees) | Side averaging | Zhang, `f` estimated | Zhang, fixed `f` prior 10 % off (p95 with noise) |
|---|---|---|---|
| 20 / 0 / 0 | 6.0 % | 6.4 % (no `f`) | 1.1–1.2 % (1.7 %) |
| 35 / 0 / 0 | 20.4 % | 22 % (no `f`) | 3.2 % (3.8 %) |
| 45 / 0 / 0 | 37.5 % | 41 % (no `f`) | 5.0 % (5.8 %) |
| 35 / 0 / 2 | 20.3 % | 0 %, but 12 % p95 with noise | 3.2 % (3.8 %) |
| 35 / 10 / −8 | 13.6 % | 0 %, 1 % p95 with noise | 2.2 % (2.8 %) |
| 45 / 15 / 10 | 38.3 % | 0 %, 2 % p95 with noise | 4.9 % (5.7 %) |

With the correct `f` the error was under 1 % (p95, with noise) in every pose. So:

1. **Use eq. (20) with a fixed focal-length prior, not an estimated one.** For a phone's main camera, 24–26 mm equivalent, `f ≈ 0.69–0.75 ×` the photo's long side in pixels (`f_px = f35 × diagonal_px / 43.27`). If the photo's EXIF has `FocalLengthIn35mmFilm`, use that instead. Reading it means parsing the JPEG's APP1 segment, since `createImageBitmap` doesn't expose it. Whether a file picked on iOS keeps that tag wasn't checked.
2. **Compute it on the full, uncropped photo.** The formula needs the image centre. Corners picked inside an earlier crop shifted the centre and gave 16–18 % error in the simulation.
3. **Offer presets and snap.** Letter is 0.773 and A4 is 0.707, 9 % apart, so the estimate (within about 5 %) can usually tell them apart. Snap to a preset when within about 3 %, otherwise use the estimate. Also offer Square, plus a way to override.
4. If the corners aren't a real rectangle (say the carver framed just the drawing), no formula helps. The presets and the override cover that.

Scale needs no answer here. The design gets sized on the pumpkin later, so only the ratio matters. Pick the output size as Zhang and He do (§3.3): keep the longer of each pair of opposite sides, so no source detail is lost, then cap it at the 2000 px trace limit.

## 4. Automatic corner detection

It's feasible, but not worth it for v1.

- Zhang and He (§3.1) find a whiteboard with Sobel edges, an oriented Hough transform, quadrangle scoring and line refinement. It worked on more than 90 % of 50 whiteboard photos, and failed on poor boundary contrast or noisy edges.
- Dropbox ([Ying Xiong, 2016](https://dropbox.tech/machine-learning/fast-and-accurate-document-detection-for-scanning)) found Canny edges "not very promising" because the text inside the document dominates. They replaced it with a machine-learned edge detector before the Hough step and quad scoring, reaching 8–10 fps on phones.
- jscanify (MIT, the most-downloaded JS option) is Canny plus Otsu plus the largest contour, all through OpenCV.js ([source](https://github.com/puffinsoft/jscanify/blob/master/src/jscanify.js)). That's the 13 MB dependency again.

The failure cases are the common case here: white paper on a light table or a kitchen counter, and pencil lines that compete with the paper edge. Even when detection works, the carver still has to check and drag the corners. So v1 should:

- start the four handles at an inset of the photo's corners
- make dragging precise with a magnifier loupe (the same need as point placement in #5 and #14)

A cheap later step would snap a released corner to the strongest nearby edge intersection, within a small radius. That's a refinement, not detection.

## 5. Brightness and contrast (for #13)

`CanvasRenderingContext2D.filter` (the canvas version of CSS `brightness()`/`contrast()`) is **only behind a flag in Safari** ([browser-compat-data](https://github.com/mdn/browser-compat-data/blob/main/api/CanvasRenderingContext2D.json): Safari 18 with the "Canvas Filters" preference). So it can't be relied on to change pixels on iPhones.

- For **display** only, CSS `filter` on the shown canvas works everywhere and costs nothing.
- If the adjusted pixels are needed, for auto-trace, apply a 256-entry lookup table inside the warp loop. It's essentially free there.

## Recommendation

1. **`src/core`-style pure module** (no DOM): `squareToQuad`, `invert3`, `applyH`, `aspectFromCorners(corners, imageSize, focalPx)`, and `warpBilinear(src, H, outW, outH)` on `Uint8ClampedArray`s, unit-tested in Vitest.
2. **Decode** with `createImageBitmap(file, { resizeWidth/Height, resizeQuality: "high" })`, keeping the full-size dimensions for the aspect formula.
3. **Warp** in the worker on corner release, at most 2000 px on the long side, so auto-trace and hand-trace share one corrected image. While dragging, show the quad over the original, and optionally a small live preview.
4. **Aspect:** Zhang's eq. (20) with `f = 0.72 × long side` (or EXIF), snapping to Letter, A4 or Square, with an override.
5. **No auto-detect in v1**: inset handles and a loupe.
6. If phone timing turns out too slow in the prototype, move only the warp to a WebGL2 shader. The maths and the module boundary stay the same.

## What this changes for other tickets

- **#13 photo cleanup:**
  - Crop and free rotation are special cases of the four-corner quad. One `H` covers crop, rotate and perspective, and 90° turns are just a relabelling of which corner is top-left. A separate crop step *before* perspective also breaks the aspect estimate, which needs the uncropped image centre. So the geometric cleanup can be a single quad on the full photo, followed by tone.
  - `ctx.filter` can't be used for tone on iPhones (section 5).
- **#10 path model:**
  - Points can follow a cleanup change exactly: remap them through `H_new · H_old⁻¹`, or keep them in original-photo space and project. Straight segments stay exactly straight.
  - **Future Bézier handles will not:** a projective remap of control points gives a different curve from the projective image of the old one. If points live in photo space, curves drawn in corrected space will change shape slightly whenever the corners move. This is an argument for storing points in corrected (design) space, and for treating a corner change after drawing as a remap that's exact for v1's straight segments but approximate for curves.
  - Corrected space changes size whenever the corners or aspect change. A unit-square-plus-aspect coordinate frame avoids rescaling stored points.

## Not covered

- Timing on real phones: measured in Node on a desktop only.
- Lens distortion. Phone main cameras correct most of it in software, and Zhang and He name it as their second error source.
- Whether iOS's photo picker keeps the EXIF focal-length tag.
- A visual comparison of bilinear warp quality against supersampled or WebGL-mipmapped warps on real pencil photos.
