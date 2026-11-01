import * as THREE from "three";
import { ARENA } from "@spitfin/shared";
import { convexHull, placeLeaves, rectPerimeter, rimLeaves, type Leaf, type Pt } from "./foregroundLayout";

const MAX_LEAVES = 320;
const LEAF_DEPTH = 6; // in front of the camera, so leaves are always drawn over the pond
const SEED = 1234;
const CLEAR_MARGIN = 0.2; // world units around the arena that stay clear of leaf centres
const CLEAR_HEIGHT = 2; // bugs fly up to here; leaves avoid the area above the arena up to this height
const GRID_REACH = 0.5; // how far scattered leaves may overlap the clear area (0 to 1)
const RIM_STEP = 1.1; // spacing of the leaves that cover the pond edge
const PALETTE = [0x2f7d3f, 0x3f9a4c, 0x58b05a, 0x1f6a3a, 0x72c06a].map((c) => new THREE.Color(c));

function leafGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, -1);
  s.bezierCurveTo(0.9, -0.6, 0.8, 0.5, 0, 1);
  s.bezierCurveTo(-0.8, 0.5, -0.9, -0.6, 0, -1);
  return new THREE.ShapeGeometry(s, 4);
}

/**
 * Leaves in front of the pond: one InstancedMesh attached to the camera. A ring of leaves covers the
 * pond's edge (the floor border outside the arena), and scattered leaves fill the rest of the view
 * outside the arena. Call `layout()` when the camera frustum changes and `update(now)` every frame.
 */
export function createForeground(camera: THREE.OrthographicCamera, scene: THREE.Scene, floorY: number) {
  scene.add(camera); // the camera's children are only drawn if the camera is in the scene
  const mesh = new THREE.InstancedMesh(
    leafGeometry(),
    new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
    MAX_LEAVES,
  );
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.position.z = -LEAF_DEPTH;
  camera.add(mesh);

  const dummy = new THREE.Object3D();
  const v = new THREE.Vector3();
  const reduceMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  let leaves: Leaf[] = [];

  function update(nowMs: number) {
    const t = reduceMotion ? 0 : nowMs / 1000;
    for (let i = 0; i < leaves.length; i++) {
      const l = leaves[i]!;
      dummy.position.set(l.x, l.y, l.z);
      dummy.rotation.set(l.tx, l.ty, l.rot + Math.sin(t * 0.6 + l.phase) * 0.06);
      dummy.scale.setScalar(l.size);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  function layout() {
    camera.updateMatrixWorld(true);
    const toView = (x: number, y: number, z: number): Pt => {
      v.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
      return { x: v.x, y: v.y };
    };

    // The play area as seen from the camera: the arena floor and the space bugs fly in.
    const cx = ARENA.w / 2 + CLEAR_MARGIN;
    const cz = ARENA.h / 2 + CLEAR_MARGIN;
    const clear: Pt[] = [];
    for (const y of [0, CLEAR_HEIGHT]) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) clear.push(toView(sx * cx, y, sz * cz));
    }
    const hull = convexHull(clear);
    const center: Pt = {
      x: hull.reduce((s, p) => s + p.x, 0) / hull.length,
      y: hull.reduce((s, p) => s + p.y, 0) / hull.length,
    };

    // The pond edge is the border of the floor, one unit outside the arena.
    const edge = rectPerimeter(ARENA.w / 2 + 1, ARENA.h / 2 + 1, RIM_STEP).map((p) => toView(p.x, floorY, p.z));
    const rim = rimLeaves(edge, center, SEED);
    const scattered = placeLeaves(
      hull,
      { left: camera.left, right: camera.right, bottom: camera.bottom, top: camera.top },
      SEED,
      Math.max(0, MAX_LEAVES - rim.length),
      GRID_REACH,
    );
    leaves = rim.concat(scattered);
    for (let i = 0; i < leaves.length; i++) mesh.setColorAt(i, PALETTE[leaves[i]!.color]!);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.count = leaves.length;
    update(performance.now());
  }

  return { layout, update };
}
