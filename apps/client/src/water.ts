import * as THREE from "three";
import { MAX_RIPPLES, RipplePool } from "./ripples";

const VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vP = w.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uCalm;
uniform vec4 uRip[${MAX_RIPPLES}];
uniform vec3 uView;
uniform vec3 uBase;
varying vec2 vP;

float height(vec2 p) {
  float h = (sin(p.x * 1.1 + uTime * 0.7) + sin(p.y * 1.5 - uTime * 0.55) + sin((p.x + p.y) * 0.8 + uTime * 0.4)) * 0.035 * uCalm;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec4 r = uRip[i];
    if (r.w <= 0.0) continue;
    float age = uTime - r.z;
    float d = length(p - r.xy);
    float front = age * 2.6;
    float env = exp(-abs(d - front) * 1.6) * exp(-age * 0.8) * smoothstep(0.0, 0.08, age);
    h += sin((d - front) * 11.0) * env * 0.12 * r.w;
  }
  return h;
}

void main() {
  const float e = 0.06;
  float h = height(vP);
  float dx = (height(vP + vec2(e, 0.0)) - h) / e;
  float dz = (height(vP + vec2(0.0, e)) - h) / e;
  vec3 n = normalize(vec3(-dx, 1.0, -dz));
  vec3 V = normalize(uView);
  float ndv = clamp(dot(n, V), 0.0, 1.0);
  float fres = 0.2 + 0.8 * pow(1.0 - ndv, 2.0);
  vec3 R = reflect(-V, n);
  vec3 sky = mix(vec3(0.75, 0.88, 0.95), vec3(0.35, 0.62, 0.85), clamp(R.y, 0.0, 1.0));
  float sun = pow(max(dot(R, normalize(vec3(-0.4, 0.75, 0.35))), 0.0), 90.0);
  vec3 col = mix(uBase, sky, fres * 0.8);
  col += vec3(1.0, 0.96, 0.85) * sun * 0.9;
  col += vec3(0.6, 0.8, 0.9) * clamp(abs(h) * 2.0, 0.0, 0.3);
  float a = clamp(0.4 + fres * 0.3 + sun * 0.5 + abs(h) * 1.2, 0.0, 0.85);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

/**
 * The pond surface: the one translucent layer. It fakes a reflection (sky colour that grows towards
 * the edges of each wave, plus a sun glint) and draws rings from `addRipple`. Wave motion stops for
 * reduced-motion users; ripples still show.
 */
export function createWater(camera: THREE.Camera, width: number, depth: number) {
  const pool = new RipplePool();
  const rip = new Float32Array(MAX_RIPPLES * 4);
  const t0 = performance.now();
  const seconds = () => (performance.now() - t0) / 1000;
  const reduceMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uCalm: { value: reduceMotion ? 0 : 1 },
      uRip: { value: rip },
      uView: { value: camera.position.clone().normalize() },
      uBase: { value: new THREE.Color(0x4fb3c8) },
    },
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth).rotateX(-Math.PI / 2), material);
  mesh.renderOrder = 1;

  return {
    mesh,
    /** A ring spreading from a world position. Strength is about 0.3 (small) to 1 (splash). */
    addRipple(x: number, z: number, strength: number) {
      pool.add(x, z, seconds(), strength);
    },
    update() {
      const now = seconds();
      material.uniforms.uTime!.value = now;
      pool.fill(rip, now);
    },
  };
}
