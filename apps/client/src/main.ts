import * as THREE from "three";
import { ARENA, TICK_DT, newFish, stepFish, type ServerMsg } from "@spitfin/shared";

// ---------- Renderer & orthographic camera ----------
const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf4e9c9);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
const PITCH = THREE.MathUtils.degToRad(50);
const YAW = Math.PI / 4;
const DIST = 30;
camera.position.set(
  Math.sin(YAW) * Math.cos(PITCH) * DIST,
  Math.sin(PITCH) * DIST,
  Math.cos(YAW) * Math.cos(PITCH) * DIST,
);
camera.lookAt(0, 0, 0);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  const aspect = w / h;
  const size = Math.max(22, 34 / aspect); // fixed world-height frustum, never FOV
  camera.left = (-size * aspect) / 2;
  camera.right = (size * aspect) / 2;
  camera.top = size / 2;
  camera.bottom = -size / 2;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ---------- Scene ----------
scene.add(new THREE.HemisphereLight(0xffffff, 0xc9b27c, 1.2));

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(ARENA.w + 2, ARENA.h + 2).rotateX(-Math.PI / 2),
  new THREE.MeshLambertMaterial({ color: 0xd9c08a }),
);
floor.position.y = -0.6;
scene.add(floor);

const fishGeo = new THREE.ConeGeometry(0.5, 1.4, 6).rotateX(Math.PI / 2); // tip points +Z
const fish = new THREE.Mesh(fishGeo, new THREE.MeshLambertMaterial({ color: 0xf28f3b }));
fish.position.y = -0.25;
scene.add(fish);

// Single translucent water layer on top of the fish (the only large alpha surface).
const water = new THREE.Mesh(
  new THREE.PlaneGeometry(ARENA.w + 2, ARENA.h + 2).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x4fb3c8, transparent: true, opacity: 0.4, depthWrite: false }),
);
water.renderOrder = 1;
scene.add(water);

// ---------- Input: WASD in screen space -> world axes ----------
const keys = new Set<string>();
window.addEventListener("keydown", (e) => keys.add(e.code));
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => keys.clear());

const out = { ax: 0, az: 0 };
function readAxis() {
  const sx = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0); // screen right
  const sy = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0); // screen up
  const k = Math.SQRT1_2; // 45° camera yaw
  out.ax = (sx - sy) * k;
  out.az = (-sy - sx) * k;
}

// ---------- Fixed-timestep loop with render interpolation ----------
const state = newFish();
let px = 0, pz = 0;
let acc = 0, last = performance.now();

function frame(now: number) {
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  while (acc >= TICK_DT) {
    px = state.x; pz = state.z;
    readAxis();
    stepFish(state, out.ax, out.az, TICK_DT);
    acc -= TICK_DT;
  }
  const a = acc / TICK_DT;
  fish.position.x = px + (state.x - px) * a;
  fish.position.z = pz + (state.z - pz) * a;
  if (Math.hypot(state.vx, state.vz) > 0.2) fish.rotation.y = Math.atan2(state.vx, state.vz);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- Network smoke test ----------
const statusEl = document.querySelector<HTMLDivElement>("#status")!;
const proto = location.protocol === "https:" ? "wss" : "ws";
const ws = new WebSocket(`${proto}://${location.host}/ws`);
ws.onopen = () => ws.send(JSON.stringify({ t: "ping", n: 1 }));
ws.onmessage = (e) => {
  const m: ServerMsg = JSON.parse(e.data);
  if (m.t === "welcome") statusEl.textContent = `connected (server ${m.tickHz} Hz)`;
};
ws.onclose = () => (statusEl.textContent = "disconnected");
ws.onerror = () => (statusEl.textContent = "connection error");
