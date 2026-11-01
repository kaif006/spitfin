import * as THREE from "three";

type ColorFn = (x: number, y: number, z: number) => THREE.Color;
type Part = { geo: THREE.BufferGeometry; color: THREE.ColorRepresentation | ColorFn };

/** Joins parts into one flat-shaded, vertex-coloured geometry. */
function merge(parts: Part[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const fixed = new THREE.Color();
  for (const p of parts) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    const a = g.getAttribute("position");
    const fn = typeof p.color === "function" ? p.color : null;
    if (!fn) fixed.set(p.color as THREE.ColorRepresentation);
    for (let i = 0; i < a.count; i++) {
      const x = a.getX(i);
      const y = a.getY(i);
      const z = a.getZ(i);
      pos.push(x, y, z);
      const c = fn ? fn(x, y, z) : fixed;
      col.push(c.r, c.g, c.b);
    }
    if (g !== p.geo) g.dispose();
    p.geo.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  out.computeVertexNormals(); // not indexed, so every face keeps its own normal
  return out;
}

const light = new THREE.Color(1, 1, 1);
const fin = new THREE.Color(0.85, 0.85, 0.85);
const bar = new THREE.Color(0.5, 0.5, 0.5);

// ---- fish: faces +Z, about 1.7 long. The material colour tints it per player. ----
function buildFishBody(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(1, 12, 8).scale(0.36, 0.34, 0.66);
  // Three dark bars across the middle of the body, like an archer fish.
  const bars: ColorFn = (_x, _y, z) => {
    const k = Math.floor((z + 0.66) / 0.22);
    return z > -0.4 && z < 0.4 && k % 2 === 1 ? bar : light;
  };
  const tail = new THREE.ConeGeometry(0.3, 0.42, 4).rotateX(Math.PI / 2).scale(0.15, 1, 1).translate(0, 0, -0.8);
  const dorsal = new THREE.ConeGeometry(0.12, 0.36, 4).translate(0, 0.36, -0.1);
  const finR = new THREE.ConeGeometry(0.1, 0.34, 4).rotateZ(-Math.PI / 2).translate(0.38, -0.08, 0.1);
  const finL = new THREE.ConeGeometry(0.1, 0.34, 4).rotateZ(Math.PI / 2).translate(-0.38, -0.08, 0.1);
  return merge([
    { geo: body, color: bars },
    { geo: tail, color: fin },
    { geo: dorsal, color: fin },
    { geo: finR, color: fin },
    { geo: finL, color: fin },
  ]);
}

function buildFishEyes(): THREE.BufferGeometry {
  const eye = (x: number) => new THREE.SphereGeometry(0.1, 8, 6).translate(x, 0.16, 0.42);
  const pupil = (x: number) => new THREE.SphereGeometry(0.05, 6, 4).translate(x * 1.2, 0.17, 0.49);
  return merge([
    { geo: eye(0.22), color: 0xffffff },
    { geo: eye(-0.22), color: 0xffffff },
    { geo: pupil(0.22), color: 0x111111 },
    { geo: pupil(-0.22), color: 0x111111 },
  ]);
}

export const fishBodyGeo = buildFishBody();
export const fishEyeGeo = buildFishEyes();
const eyeMat = new THREE.MeshLambertMaterial({ vertexColors: true });

/** One fish: a body tinted by `bodyMat` (create it with vertexColors: true) plus fixed eyes. */
export function makeFish(bodyMat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(fishBodyGeo, bodyMat), new THREE.Mesh(fishEyeGeo, eyeMat));
  return g;
}

// ---- bugs: flying ones are dark with wings, floating ones are gold with folded wings ----
function bugBody(color: number): Part[] {
  return [
    { geo: new THREE.SphereGeometry(1, 8, 6).scale(0.2, 0.18, 0.3), color },
    { geo: new THREE.SphereGeometry(0.12, 6, 4).translate(0, 0.02, 0.3), color },
  ];
}

export const bugFlyingGeo = merge([
  ...bugBody(0x2b2118),
  { geo: new THREE.SphereGeometry(1, 6, 4).scale(0.28, 0.02, 0.16).translate(0.26, 0.16, 0.02), color: 0xcfe9f2 },
  { geo: new THREE.SphereGeometry(1, 6, 4).scale(0.28, 0.02, 0.16).translate(-0.26, 0.16, 0.02), color: 0xcfe9f2 },
]);
export const bugFloatingGeo = merge(bugBody(0xd6a02e));
export const bugMat = new THREE.MeshLambertMaterial({ vertexColors: true });

// ---- swimming: a sine wave travels down the body and swings the tail ----
export type FishSkin = {
  material: THREE.MeshLambertMaterial;
  /** `phase` grows over time (faster when swimming faster); `amp` is 0 (still) to 1 (full swing). */
  setSwim(phase: number, amp: number): void;
};

export function makeFishSkin(color: number): FishSkin {
  const uPhase = { value: 0 };
  const uAmp = { value: 0.4 };
  const material = new THREE.MeshLambertMaterial({ color, vertexColors: true });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPhase = uPhase;
    shader.uniforms.uAmp = uAmp;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uPhase;\nuniform float uAmp;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        float tailW = 1.0 - smoothstep(-0.9, 0.35, position.z);
        transformed.x += sin(uPhase - position.z * 5.0) * 0.16 * tailW * tailW * uAmp;`,
      );
  };
  return {
    material,
    setSwim(phase, amp) {
      uPhase.value = phase;
      uAmp.value = amp;
    },
  };
}
