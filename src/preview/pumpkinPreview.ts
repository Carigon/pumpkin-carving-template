import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { ProjectedDesign, StretchMap, SurfaceParameters } from "../core";
import { STRETCH_MAX_ALPHA, stretchTint } from "../stretchTint";

const FRONT_LIMIT_DEGREES = 60;
const COLOR_OK = new THREE.Color(0x1b1b1b);
const COLOR_PAST_LIMIT = new THREE.Color(0xd4a017);
const COLOR_STRETCH = new THREE.Color(0xb0004a);

export interface PumpkinPreview {
  /** Show the given surface and projected design; call on every input change. Clears the stretch tint. */
  update(surface: SurfaceParameters | null, design: ProjectedDesign | null): void;
  /** Tint the surface where the paper stretches (null: no tint), once the flat template for the shown design is built. */
  setStretch(stretch: StretchMap | null): void;
}

/**
 * Three.js preview: the fitted pumpkin (the builder's surface mesh) plus the projected design lines, orbitable.
 * Holds no geometry logic: it only draws what the builder returned.
 * Axes match the core: x right, y up (stem), +z toward the viewer.
 */
export function mountPumpkinPreview(canvas: HTMLCanvasElement): PumpkinPreview {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1e1e24);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
  camera.position.set(0, 0, 40);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  scene.add(sun);

  const pumpkin = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshStandardMaterial({
      color: 0xff7518,
      roughness: 0.7,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
  );
  pumpkin.visible = false;
  scene.add(pumpkin);

  const lines = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ vertexColors: true }),
  );
  const missed = new THREE.Points(
    new THREE.BufferGeometry(),
    new THREE.PointsMaterial({ color: 0xff3030, size: 4, sizeAttenuation: false }),
  );
  // Heavily stretched areas of the flattened patch, as a translucent tint just above the skin.
  const tint = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
  );
  scene.add(tint, lines, missed);

  let size = 0;
  let shownMesh: SurfaceParameters["mesh"] | null = null;

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  return {
    update(surface, design) {
      pumpkin.visible = surface !== null;
      lines.visible = missed.visible = surface !== null && design !== null;
      tint.visible = false;
      if (!surface) return;

      const { sideToSide: a, vertical: c, frontToBack: b } = surface.semiAxes;
      if (surface.mesh !== shownMesh) {
        const { positions, normals, triangles } = surface.mesh;
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
        g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(normals), 3));
        g.setIndex(new THREE.BufferAttribute(triangles, 1));
        pumpkin.geometry.dispose();
        pumpkin.geometry = g;
        shownMesh = surface.mesh;
      }
      const newSize = Math.max(a, b, c);
      if (Math.abs(newSize - size) > 1e-6 * newSize) {
        // Keep the orbit direction, refit the distance and clip planes to the pumpkin's size.
        const dir = camera.position.clone().sub(controls.target).normalize();
        camera.position.copy(dir.multiplyScalar(5 * newSize));
        camera.near = 0.01 * newSize;
        camera.far = 100 * newSize;
        camera.updateProjectionMatrix();
        sun.position.set(1, 1, 2).multiplyScalar(newSize);
        size = newSize;
      }

      if (design) setDesign(design, 0.003 * newSize);
    },
    setStretch(stretch) {
      tint.visible = pumpkin.visible && stretch !== null;
      if (tint.visible) setStretch(tint, stretch!, 0.0015 * size);
    },
  };

  function setDesign(design: ProjectedDesign, lift: number): void {
    const pos: number[] = [];
    const col: number[] = [];
    const miss: number[] = [];
    for (const { points } of design.paths) {
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const q = points[(i + 1) % points.length];
        if (!p.surface) miss.push(p.front.x, p.front.y, 0);
        if (!p.surface || !q.surface) continue;
        for (const s of [p, q]) {
          const { point, normal } = s.surface!;
          pos.push(point[0] + normal[0] * lift, point[1] + normal[1] * lift, point[2] + normal[2] * lift);
          const color = s.angleFromFront! > FRONT_LIMIT_DEGREES ? COLOR_PAST_LIMIT : COLOR_OK;
          col.push(color.r, color.g, color.b);
        }
      }
    }
    replaceGeometry(lines, { position: [pos, 3], color: [col, 3] });
    replaceGeometry(missed, { position: [miss, 3] });
  }
}

/**
 * One flat-colored triangle per stretch triangle (no shared vertices, so values don't blur together),
 * each vertex lifted along the surface normal so the chordal triangles clear the curved skin.
 */
function setStretch(tint: THREE.Mesh, stretch: StretchMap, lift: number): void {
  const lifted = stretch.surface.map(([x, y, z], i) => {
    const [nx, ny, nz] = stretch.normals[i];
    return [x + nx * lift, y + ny * lift, z + nz * lift];
  });
  const pos: number[] = [];
  const col: number[] = [];
  stretch.triangles.forEach((tri, t) => {
    const alpha = STRETCH_MAX_ALPHA * stretchTint(stretch.values[t]);
    if (alpha <= 0) return;
    for (const i of tri) {
      pos.push(...lifted[i]);
      col.push(COLOR_STRETCH.r, COLOR_STRETCH.g, COLOR_STRETCH.b, alpha);
    }
  });
  replaceGeometry(tint, { position: [pos, 3], color: [col, 4] });
}

function replaceGeometry(obj: THREE.LineSegments | THREE.Points | THREE.Mesh, attrs: Record<string, [number[], number]>): void {
  obj.geometry.dispose();
  const g = new THREE.BufferGeometry();
  for (const [name, [data, itemSize]] of Object.entries(attrs)) {
    g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(data), itemSize));
  }
  obj.geometry = g;
}
