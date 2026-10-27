import * as THREE from "three";
import {
  ARENA,
  BUG_HIT_RADIUS,
  MATCH_DURATION,
  NOT_EATEN,
  REED_HEIGHT,
  ROCK_HEIGHT,
  SPIT_ORIGIN_Y,
  SPIT_PITCH_MAX,
  SPIT_PITCH_MIN,
  TICK_DT,
  bugPosition,
  fallingBugPhase,
  fallingBugPosition,
  isDashing,
  makeSimInput,
  newSim,
  simRanking,
  stepSim,
  type ServerMsg,
  type ShotBug,
  type SimEvent,
  type SimInput,
  type SimPlayer,
  type SimState,
  type Vec3,
} from "@spitfin/shared";
import { pickAim } from "./Picking";

// ---------- Renderer & orthographic camera ----------
const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
canvas.style.cursor = "crosshair";
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

// ---------- Static scene ----------
const FLOOR_Y = -0.6;
scene.add(new THREE.HemisphereLight(0xffffff, 0xc9b27c, 1.2));

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(ARENA.w + 2, ARENA.h + 2).rotateX(-Math.PI / 2),
  new THREE.MeshLambertMaterial({ color: 0xd9c08a }),
);
floor.position.y = FLOOR_Y;
scene.add(floor);

// Single translucent water layer (the only large alpha surface). Drawn after the opaque objects.
const water = new THREE.Mesh(
  new THREE.PlaneGeometry(ARENA.w + 2, ARENA.h + 2).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x4fb3c8, transparent: true, opacity: 0.4, depthWrite: false }),
);
water.renderOrder = 1;
scene.add(water);

// ---------- Shared meshes and materials ----------
const fishGeo = new THREE.ConeGeometry(0.5, 1.4, 6).rotateX(Math.PI / 2); // tip points +Z
const fishMat = new THREE.MeshLambertMaterial({ color: 0xf28f3b });
const bugGeo = new THREE.SphereGeometry(BUG_HIT_RADIUS, 10, 8);
const flyingMat = new THREE.MeshLambertMaterial({ color: 0x2b2118 });
const floatingMat = new THREE.MeshLambertMaterial({ color: 0xd6a02e });
const reedMat = new THREE.MeshLambertMaterial({ color: 0x5f8f3e });
const rockMat = new THREE.MeshLambertMaterial({ color: 0x8c8c86 });

const obstacleGroup = new THREE.Group();
const bugGroup = new THREE.Group();
scene.add(obstacleGroup, bugGroup);

// The spit jet: a thin cylinder from the mouth, pointing along +Z, scaled to the jet length.
const jet = new THREE.Mesh(
  new THREE.CylinderGeometry(0.05, 0.05, 1, 6).rotateX(Math.PI / 2).translate(0, 0, 0.5),
  new THREE.MeshBasicMaterial({ color: 0x9be7ff }),
);
jet.visible = false;
scene.add(jet);
const jetStart = new THREE.Vector3();
const jetEnd = new THREE.Vector3();
let jetUntil = 0;

// ---------- HUD ----------
const hud = document.createElement("div");
hud.style.cssText =
  "position:fixed;top:8px;left:50%;transform:translateX(-50%);padding:6px 14px;background:rgba(30,30,30,.55);" +
  "color:#fff;font:600 14px/1.5 system-ui,sans-serif;border-radius:8px;pointer-events:none;text-align:center;white-space:pre;";
document.body.appendChild(hud);

const banner = document.createElement("div");
banner.style.cssText =
  "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);padding:20px 32px;background:rgba(20,20,20,.8);" +
  "color:#fff;font:600 18px/1.6 system-ui,sans-serif;border-radius:12px;pointer-events:none;text-align:center;white-space:pre;display:none;";
document.body.appendChild(banner);

// ---------- Input ----------
const keys = new Set<string>();
let mouseDown = false;
let pendingSpit = false; // a click shorter than one tick must still fire
let pendingNip = false;
let pointerX = window.innerWidth / 2;
let pointerY = window.innerHeight / 2;

window.addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (e.code === "Space") {
    pendingNip = true;
    e.preventDefault();
  }
  if (e.code === "KeyR" && sim.over) startMatch(randomSeed());
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => {
  keys.clear();
  mouseDown = false;
});
window.addEventListener("pointermove", (e) => {
  pointerX = e.clientX;
  pointerY = e.clientY;
});
window.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  pointerX = e.clientX;
  pointerY = e.clientY;
  mouseDown = true;
  pendingSpit = true;
});
window.addEventListener("pointerup", (e) => {
  if (e.button === 0) mouseDown = false;
});

const out = { ax: 0, az: 0 };
function readAxis() {
  const sx = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0); // screen right
  const sy = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0); // screen up
  const k = Math.SQRT1_2; // 45° camera yaw
  out.ax = (sx - sy) * k;
  out.az = (-sy - sx) * k;
}

// ---------- Match state ----------
const TAU = Math.PI * 2;
const randomSeed = () => (Math.random() * 0x100000000) >>> 0;
const urlSeed = new URLSearchParams(location.search).get("seed");

let sim: SimState;
let seed = 0;
let bannerShown = false;
let fishMeshes: THREE.Mesh[] = [];
let meshYaw: number[] = [];
let prevX: number[] = [];
let prevZ: number[] = [];
let bugMeshes: THREE.Mesh[] = [];
const shotById = new Map<number, ShotBug>();
let shotSeen = 0;

const input: SimInput = makeSimInput();
const inputs: SimInput[] = [input];
const events: SimEvent[] = [];
const candidates: Vec3[] = [];
const candidatePool: Vec3[] = [];
const scratch: Vec3 = { x: 0, y: 0, z: 0 };

function buildObstacles(s: SimState) {
  for (const m of obstacleGroup.children) (m as THREE.Mesh).geometry.dispose();
  obstacleGroup.clear();
  for (const o of s.obstacles) {
    const top = o.kind === "reed" ? REED_HEIGHT : ROCK_HEIGHT;
    const h = top - FLOOR_Y;
    const geo =
      o.kind === "reed"
        ? new THREE.CylinderGeometry(o.radius, o.radius, h, 8)
        : new THREE.CylinderGeometry(o.radius * 0.8, o.radius, h, 7);
    const m = new THREE.Mesh(geo, o.kind === "reed" ? reedMat : rockMat);
    m.position.set(o.x, FLOOR_Y + h / 2, o.z);
    obstacleGroup.add(m);
  }
}

function startMatch(newSeed: number) {
  seed = newSeed;
  sim = newSim(seed, [0]);
  shotById.clear();
  shotSeen = 0;

  for (const m of fishMeshes) scene.remove(m);
  fishMeshes = sim.players.map(() => {
    const m = new THREE.Mesh(fishGeo, fishMat);
    m.position.y = -0.25;
    scene.add(m);
    return m;
  });
  meshYaw = sim.players.map((p) => Math.PI / 2 - p.facing);
  prevX = sim.players.map((p) => p.x);
  prevZ = sim.players.map((p) => p.z);

  for (const m of bugMeshes) bugGroup.remove(m);
  bugMeshes = [];
  buildObstacles(sim);

  pendingSpit = false;
  pendingNip = false;
  jet.visible = false;
  jetUntil = 0;
  banner.style.display = "none";
  bannerShown = false;
  acc = 0;
}

/** Remember which bugs have been shot, so rendering and aiming can look them up by id. */
function syncShot() {
  while (shotSeen < sim.shot.length) {
    const sb = sim.shot[shotSeen++];
    shotById.set(sb.fall.bugId, sb);
  }
}

/** Positions of every bug that a spit fired at time `t` could still hit. */
function collectTargets(t: number) {
  candidates.length = 0;
  for (let i = 0; i < sim.bugs.length; i++) {
    const b = sim.bugs[i];
    if (t < b.spawnTime || t >= b.despawnTime) continue;
    if (shotById.has(b.id)) continue;
    let v = candidatePool[candidates.length];
    if (!v) {
      v = { x: 0, y: 0, z: 0 };
      candidatePool[candidates.length] = v;
    }
    bugPosition(b, t, v);
    candidates.push(v);
  }
}

/** Fill `input` for the next tick. Clicks and key presses are consumed here. */
function buildInput(p: SimPlayer) {
  readAxis();
  input.ax = out.ax;
  input.az = out.az;
  input.spit = false;
  if (mouseDown || pendingSpit) {
    collectTargets(sim.time + TICK_DT); // the spit is resolved at the next tick's time
    const aim = pickAim(pointerX, pointerY, canvas, camera, p.x, p.z, candidates);
    if (aim) {
      input.spit = true;
      input.yaw = aim.yaw;
      input.pitch = aim.pitch;
    }
  }
  input.nip = pendingNip;
  pendingSpit = false;
  pendingNip = false;
}

function handleEvents(p: SimPlayer) {
  for (const e of events) {
    if (e.type !== "spit" || e.playerId !== p.id) continue;
    const pitch = Math.min(SPIT_PITCH_MAX, Math.max(SPIT_PITCH_MIN, input.pitch));
    const cp = Math.cos(pitch);
    jetStart.set(p.x, SPIT_ORIGIN_Y, p.z);
    jetEnd.set(
      p.x + cp * Math.cos(input.yaw) * e.length,
      SPIT_ORIGIN_Y + Math.sin(pitch) * e.length,
      p.z + cp * Math.sin(input.yaw) * e.length,
    );
    jetUntil = performance.now() + 140;
  }
}

function updateBugs(renderTime: number) {
  while (bugMeshes.length < sim.bugs.length) {
    const m = new THREE.Mesh(bugGeo, flyingMat);
    m.visible = false;
    bugGroup.add(m);
    bugMeshes.push(m);
  }
  for (let i = 0; i < sim.bugs.length; i++) {
    const spec = sim.bugs[i];
    const m = bugMeshes[i];
    const sb = shotById.get(spec.id);
    if (sb) {
      if (sb.eatenBy !== NOT_EATEN) {
        m.visible = false;
        continue;
      }
      const phase = fallingBugPhase(sb.fall, renderTime);
      if (phase === "expired") {
        m.visible = false;
        continue;
      }
      fallingBugPosition(sb.fall, renderTime, scratch);
      m.material = phase === "floating" ? floatingMat : flyingMat;
    } else {
      if (renderTime < spec.spawnTime || renderTime >= spec.despawnTime) {
        m.visible = false;
        continue;
      }
      bugPosition(spec, renderTime, scratch);
      m.material = flyingMat;
    }
    m.visible = true;
    m.position.set(scratch.x, scratch.y, scratch.z);
  }
}

const fmtCooldown = (t: number) => (t <= 0 ? "ready" : `${t.toFixed(1)}s`);
let lastHud = "";
function updateHud(p: SimPlayer) {
  const secs = Math.ceil(Math.max(0, MATCH_DURATION - sim.time));
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const text =
    `${clock}   stash ${p.stash}   eaten ${p.bugsEaten}   spit ${p.hits}/${p.shots}\n` +
    `spit ${fmtCooldown(p.nextSpitTime - sim.time)}   nip ${fmtCooldown(p.nipReadyTime - sim.time)}   seed ${seed}`;
  if (text !== lastHud) {
    hud.textContent = text;
    lastHud = text;
  }
}

function showBanner() {
  const rows = simRanking(sim).map(
    (r) => `#${r.rank}  stash ${r.stash}, eaten ${r.bugsEaten}, nips ${r.nipsUsed}`,
  );
  banner.textContent = `Time!\n${rows.join("\n")}\nPress R to play again`;
  banner.style.display = "block";
  bannerShown = true;
}

/** Shortest signed angle from a to b. */
function angleDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

// ---------- Fixed-timestep loop with render interpolation ----------
let acc = 0;
let last = performance.now();
startMatch(urlSeed !== null && Number.isFinite(Number(urlSeed)) ? Number(urlSeed) >>> 0 : randomSeed());

function frame(now: number) {
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  const p = sim.players[0];

  while (acc >= TICK_DT) {
    for (let i = 0; i < sim.players.length; i++) {
      prevX[i] = sim.players[i].x;
      prevZ[i] = sim.players[i].z;
    }
    if (!sim.over) {
      events.length = 0;
      buildInput(p);
      stepSim(sim, inputs, events);
      syncShot();
      handleEvents(p);
    }
    acc -= TICK_DT;
  }

  // Render between the previous and the current tick, so fish and bugs share the same moment.
  const a = sim.over ? 1 : acc / TICK_DT;
  const renderTime = Math.max(0, sim.time - (1 - a) * TICK_DT);

  for (let i = 0; i < sim.players.length; i++) {
    const pl = sim.players[i];
    const m = fishMeshes[i];
    m.position.x = prevX[i] + (pl.x - prevX[i]) * a;
    m.position.z = prevZ[i] + (pl.z - prevZ[i]) * a;
    meshYaw[i] += angleDiff(meshYaw[i], Math.PI / 2 - pl.facing) * 0.35;
    m.rotation.y = meshYaw[i];
    m.scale.setScalar(isDashing(pl, sim.time) ? 1.3 : 1);
  }

  updateBugs(renderTime);

  if (now < jetUntil) {
    jet.visible = true;
    jet.position.copy(jetStart);
    jet.lookAt(jetEnd);
    jet.scale.set(1, 1, Math.max(0.01, jetStart.distanceTo(jetEnd)));
  } else {
    jet.visible = false;
  }

  updateHud(p);
  if (sim.over && !bannerShown) showBanner();

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
