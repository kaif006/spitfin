import * as THREE from "three";
import { SPIT_ORIGIN_Y, spitAim, type Vec3 } from "@spitfin/shared";

/** A bug whose screen position is within this many pixels of the cursor is aimed at directly. */
export const PICK_RADIUS_PX = 56;

const raycaster = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -SPIT_ORIGIN_Y); // the horizontal plane at mouth height
const ndc = new THREE.Vector2();
const hit = new THREE.Vector3();
const proj = new THREE.Vector3();

export interface Aim {
  yaw: number;
  pitch: number;
}

/**
 * Turn a cursor position into a spit aim for a fish at (fx, fz).
 * 1. If a candidate bug is on screen near the cursor, aim at the closest one (its real 3D position).
 * 2. Otherwise aim flat along the water toward the point under the cursor.
 * Returns null only if the cursor ray never meets the water plane.
 */
export function pickAim(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  fx: number,
  fz: number,
  candidates: readonly Vec3[],
): Aim | null {
  camera.updateMatrixWorld();
  const rect = canvas.getBoundingClientRect();
  ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);

  let best = -1;
  let bestD2 = PICK_RADIUS_PX * PICK_RADIUS_PX;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    proj.set(c.x, c.y, c.z).project(camera);
    const dx = (proj.x - ndc.x) * (rect.width / 2);
    const dy = (proj.y - ndc.y) * (rect.height / 2);
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      best = i;
      bestD2 = d2;
    }
  }
  if (best >= 0) {
    const c = candidates[best];
    return spitAim(fx, fz, c.x, c.y, c.z);
  }

  raycaster.setFromCamera(ndc, camera);
  if (!raycaster.ray.intersectPlane(plane, hit)) return null;
  return spitAim(fx, fz, hit.x, SPIT_ORIGIN_Y, hit.z);
}
