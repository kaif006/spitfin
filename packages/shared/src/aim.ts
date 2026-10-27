import { SPIT_ORIGIN_Y } from "./constants";

/**
 * The yaw and pitch that point a jet from a fish at (fx, fz) toward the point (tx, ty, tz).
 * Uses the same convention as trySpit: yaw = atan2(dz, dx), pitch = upward angle from the mouth.
 * trySpit clamps the pitch itself, so a target below the mouth just gives a flat shot.
 */
export function spitAim(
  fx: number, fz: number,
  tx: number, ty: number, tz: number,
): { yaw: number; pitch: number } {
  const dx = tx - fx;
  const dz = tz - fz;
  return { yaw: Math.atan2(dz, dx), pitch: Math.atan2(ty - SPIT_ORIGIN_Y, Math.hypot(dx, dz)) };
}
