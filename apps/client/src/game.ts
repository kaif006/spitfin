import * as THREE from "three";
import {
  ARENA,
  BUG_HIT_RADIUS,
  BUG_SPAWN_INTERVAL,
  MATCH_DURATION,
  REED_HEIGHT,
  ROCK_HEIGHT,
  SPIT_ORIGIN_Y,
  SPIT_RANGE,
  SPIT_COOLDOWN,
  SPIT_PITCH_MAX,
  SPIT_PITCH_MIN,
  TICK_DT,
  TICK_HZ,
  LAG_REWIND_MAX,
  bugPosition,
  fallingBugPhase,
  fallingBugPosition,
  generateObstacles,
  makeBugSpec,
  makeFallingBug,
  type BugSpec,
  type FallingBug,
  type Obstacle,
  type Vec3,
  type WireEvent,
} from "@spitfin/shared";
import { pickAim } from "./Picking";
import { match, net } from "./net/match";
import type { MatchState } from "./net/matchStore";
import { angleDiff, sampleFrames, type Frame, type Shown } from "./net/snapshots";
import { Predictor } from "./net/predict";
import { createForeground } from "./foreground";
import { bugFlyingGeo, bugFloatingGeo, bugMat, makeFish, makeFishSkin } from "./models";
import { createWater } from "./water";
import { audio } from "./audio";

// ---------- Renderer & orthographic camera ----------
const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
canvas.style.cursor = "crosshair";
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2d5f3f);

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
const FLOOR_Y = -0.6;
const foreground = createForeground(camera, scene, FLOOR_Y);

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
  foreground.layout();
}
window.addEventListener("resize", resize);
resize();

// ---------- Static scene ----------
scene.add(new THREE.HemisphereLight(0xffffff, 0xc9b27c, 1.2));

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(ARENA.w + 2, ARENA.h + 2).rotateX(-Math.PI / 2),
  new THREE.MeshLambertMaterial({ color: 0xd9c08a }),
);
floor.position.y = FLOOR_Y;
scene.add(floor);

// Single translucent water layer (the only large alpha surface). Drawn after the opaque objects.
const water = createWater(camera, ARENA.w + 2, ARENA.h + 2);
scene.add(water.mesh);

// ---------- Shared meshes and materials ----------
const FISH_COLORS = [0xf28f3b, 0x4f86f7, 0xe05d9c, 0x7bc74d]; // your own fish is always the first (orange)
const fishSkins = FISH_COLORS.map((c) => makeFishSkin(c));
const reedMat = new THREE.MeshLambertMaterial({ color: 0x5f8f3e });
const rockMat = new THREE.MeshLambertMaterial({ color: 0x8c8c86 });

const obstacleGroup = new THREE.Group();
const fishGroup = new THREE.Group();
const bugGroup = new THREE.Group();
scene.add(obstacleGroup, fishGroup, bugGroup);
obstacleGroup.visible = fishGroup.visible = bugGroup.visible = false;

// One spit jet per player: a thin cylinder from the mouth, pointing along +Z, scaled to the jet length.
const jetGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 6).rotateX(Math.PI / 2).translate(0, 0, 0.5);
const jetMat = new THREE.MeshBasicMaterial({ color: 0x9be7ff });
const jets = [0, 1, 2, 3].map(() => {
  const m = new THREE.Mesh(jetGeo, jetMat);
  m.visible = false;
  scene.add(m);
  return m;
});
const jetStart = jets.map(() => new THREE.Vector3());
const jetEnd = jets.map(() => new THREE.Vector3());
const jetUntil = jets.map(() => 0);

// ---------- HUD ----------
const hud = document.createElement("div");
hud.style.cssText =
  "position:fixed;top:8px;left:50%;transform:translateX(-50%);padding:6px 14px;background:rgba(30,30,30,.55);" +
  "color:#fff;font:600 14px/1.5 system-ui,sans-serif;border-radius:8px;pointer-events:none;text-align:center;white-space:pre;display:none;";
document.body.appendChild(hud);

// ---------- Match state ----------
/** Fish and bugs are drawn this far behind the newest snapshot (two snapshot intervals at 15 Hz). */
const INTERP_DELAY = 2 / 15;
const MAX_FRAMES = 40;

type SpitEvent = Extract<WireEvent, { type: "spit" }>;

let active = false;
let seed = 0;
let you = -1;
let roster: MatchState["roster"] = [];
let specs: BugSpec[] = [];
let hits = new Map<number, { fall: FallingBug; eatTime: number }>();
let frames: Frame[] = [];
let latestArrival = 0;
let renderT = -1;
let fx: SpitEvent[] = [];
let fishMeshes: THREE.Object3D[] = [];
let bugMeshes: THREE.Mesh[] = [];
let acc = 0;
let obstacles: Obstacle[] = [];
let predictor: Predictor | null = null;
let prevPX = 0;
let prevPZ = 0;
let errX = 0; // a correction from the server, eased out over a few frames
let errZ = 0;
let ownYaw = 0;
/** The match time at which the server will test a spit sent now (bugs are drawn and aimed at this time). */
let bugT = 0;
const shown: Shown[] = [];
const lastAim = { yaw: 0, pitch: 0 };
let spitReadyAt = 0; // performance.now() time at which the local spit is off cooldown
const localJets: number[] = []; // times of locally drawn jets whose server event has not arrived yet
const rippled = new Set<number>(); // bugs that have already made a splash ring
const ate = new Set<number>(); // bugs whose eat sound has played
const nipTicks: number[] = []; // server ticks of nip events not yet reached on screen
const swim = [0, 1, 2, 3].map(() => ({ x: 0, z: 0, sp: 0, phase: 0, wake: 0, init: false }));

// ---------- Input ----------
const keys = new Set<string>();
let mouseDown = false;
let pendingSpit = false; // a click shorter than one tick must still fire
let pendingNip = false;
let pointerX = window.innerWidth / 2;
let pointerY = window.innerHeight / 2;

window.addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (e.code === "Space" && active) {
    pendingNip = true;
    e.preventDefault();
  }
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
  if (e.button !== 0 || e.target !== canvas) return;
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

// ---------- Building the match ----------
const candidates: Vec3[] = [];
const candidatePool: Vec3[] = [];
const scratch: Vec3 = { x: 0, y: 0, z: 0 };

/** Your fish is colour 0; the others take the rest in id order. */
const colorIndex = (id: number) => (id === you ? 0 : id < you ? id + 1 : id);

function buildObstacles(list: readonly Obstacle[]) {
  for (const m of obstacleGroup.children) (m as THREE.Mesh).geometry.dispose();
  obstacleGroup.clear();
  for (const o of list) {
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

function beginMatch(s: MatchState) {
  seed = s.seed;
  you = s.you;
  roster = s.roster;
  specs = [];
  hits = new Map();
  frames = [];
  fx = [];
  renderT = -1;
  latestArrival = 0;
  acc = 0;
  shown.length = 0;
  pendingSpit = false;
  pendingNip = false;
  spitReadyAt = 0;
  localJets.length = 0;
  rippled.clear();
  ate.clear();
  nipTicks.length = 0;
  for (const w of swim) w.init = false;

  obstacles = generateObstacles(seed);
  buildObstacles(obstacles);
  predictor = null;
  errX = 0;
  errZ = 0;
  bugT = 0;
  fishGroup.clear();
  fishMeshes = roster.map((r) => {
    const m = makeFish(fishSkins[colorIndex(r.id)]!.material);
    m.position.y = -0.25;
    fishGroup.add(m);
    return m;
  });
  for (const m of bugMeshes) bugGroup.remove(m);
  bugMeshes = [];
  for (let i = 0; i < jets.length; i++) {
    jets[i]!.visible = false;
    jetUntil[i] = 0;
  }
  hud.style.display = "block";
  active = true;
}

let lastPhase = match.state.phase;
function onMatchState() {
  const s = match.state;
  if (s.phase === "playing" && lastPhase !== "playing") beginMatch(s);
  if (s.phase === "ended" && lastPhase !== "ended") audio.play("end");
  if (s.phase !== "playing") {
    active = false;
    hud.style.display = "none";
    keys.clear();
    mouseDown = false;
  }
  const show = s.phase === "playing" || s.phase === "ended";
  obstacleGroup.visible = fishGroup.visible = bugGroup.visible = show;
  lastPhase = s.phase;
}
match.subscribe(onMatchState);
onMatchState();

// ---------- Snapshots in ----------
function ingest(e: WireEvent) {
  const t = e.tick / TICK_HZ;
  if (e.type === "spit") {
    if (e.hit) hits.set(e.hit.bugId, { fall: makeFallingBug(seed, e.hit.bugId, t, e.hit), eatTime: Infinity });
    fx.push(e);
  } else if (e.type === "eat") {
    const h = hits.get(e.bugId);
    if (h) h.eatTime = t;
  } else if (e.type === "nip") {
    nipTicks.push(e.tick);
  }
}

match.onSnap((s) => {
  if (!active) return;
  const newest = frames[frames.length - 1];
  if (newest && s.tick <= newest.tick) return;
  frames.push({ tick: s.tick, t: s.tick / TICK_HZ, players: s.players });
  if (frames.length > MAX_FRAMES) frames.shift();
  latestArrival = performance.now();
  for (const e of s.events) ingest(e);

  const me = s.players[you];
  if (!me) return;
  if (!predictor) {
    predictor = new Predictor(obstacles);
    predictor.reset(me);
    prevPX = me.x;
    prevPZ = me.z;
    ownYaw = Math.PI / 2 - me.facing;
  } else {
    const d = predictor.reconcile(me, s.ack);
    prevPX += d.dx;
    prevPZ += d.dz;
    errX -= d.dx;
    errZ -= d.dz;
    if (Math.hypot(errX, errZ) > 3) {
      errX = 0;
      errZ = 0;
    }
  }
});

// ---------- Input out ----------
/** Positions of every bug that a spit could still hit, as seen on screen at time `t`. */
function collectTargets(t: number) {
  candidates.length = 0;
  for (let i = 0; i < specs.length; i++) {
    const b = specs[i]!;
    if (t < b.spawnTime || t >= b.despawnTime) continue;
    if (hits.has(b.id)) continue;
    let v = candidatePool[candidates.length];
    if (!v) {
      v = { x: 0, y: 0, z: 0 };
      candidatePool[candidates.length] = v;
    }
    bugPosition(b, t, v);
    candidates.push(v);
  }
}

function sendTick() {
  const pr = predictor;
  if (!pr || net.status !== "open") {
    pendingSpit = false;
    pendingNip = false;
    return;
  }
  readAxis();
  const move = { ax: out.ax, az: out.az, nip: pendingNip };
  prevPX = pr.body.x;
  prevPZ = pr.body.z;
  pr.step(move); // the server moves first and spits from the new position

  let spit = false;
  let yaw = 0;
  let pitch = 0;
  if (mouseDown || pendingSpit) {
    collectTargets(bugT);
    const aim = pickAim(pointerX, pointerY, canvas, camera, pr.body.x, pr.body.z, candidates);
    if (aim) {
      spit = true;
      yaw = aim.yaw;
      pitch = aim.pitch;
      lastAim.yaw = yaw;
      lastAim.pitch = pitch;
      const nowMs = performance.now();
      if (nowMs >= spitReadyAt) {
        spitReadyAt = nowMs + SPIT_COOLDOWN * 1000;
        localJets.push(nowMs);
        audio.play("spit");
        const p = Math.min(SPIT_PITCH_MAX, Math.max(SPIT_PITCH_MIN, pitch));
        const cp = Math.cos(p);
        jetStart[you]!.set(pr.body.x, SPIT_ORIGIN_Y, pr.body.z);
        jetEnd[you]!.set(
          pr.body.x + cp * Math.cos(yaw) * SPIT_RANGE,
          SPIT_ORIGIN_Y + Math.sin(p) * SPIT_RANGE,
          pr.body.z + cp * Math.sin(yaw) * SPIT_RANGE,
        );
        jetUntil[you] = nowMs + 140;
      }
    }
  }
  const seq = net.sendInput({ ax: move.ax, az: move.az, spit, yaw, pitch, nip: move.nip });
  if (seq > 0) pr.commit(seq, move);
  pendingSpit = false;
  pendingNip = false;
}

// ---------- Drawing ----------
function syncClock(lf: Frame, dt: number, now: number) {
  const target = Math.min(lf.t, lf.t + (now - latestArrival) / 1000 - INTERP_DELAY);
  if (renderT < 0 || Math.abs(target - renderT) > 0.5) {
    renderT = target;
  } else {
    renderT += dt;
    renderT += (target - renderT) * 0.1;
  }
  renderT = Math.max(0, Math.min(renderT, lf.t));
}

function ensureSpecs(t: number) {
  while (specs.length * BUG_SPAWN_INTERVAL < MATCH_DURATION && specs.length * BUG_SPAWN_INTERVAL <= t + 1e-9) {
    specs.push(makeBugSpec(seed, specs.length, obstacles));
  }
}

/** The match time at which the server will test a spit sent now: when it arrives, minus the lag rewind. */
function bugClock(lf: Frame, now: number): number {
  const rtt = net.rtt / 1000;
  const rewind = Math.min(LAG_REWIND_MAX, rtt / 2);
  const age = Math.min(0.5, (now - latestArrival) / 1000);
  return Math.max(0, lf.t + age + rtt + TICK_DT - rewind);
}

function updateBugs(t: number, tb: number) {
  while (bugMeshes.length < specs.length) {
    const m = new THREE.Mesh(bugFlyingGeo, bugMat);
    m.visible = false;
    bugGroup.add(m);
    bugMeshes.push(m);
  }
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]!;
    const m = bugMeshes[i]!;
    const h = hits.get(spec.id);
    if (h && t >= h.fall.hitTime) {
      const phase = fallingBugPhase(h.fall, t);
      if (t >= h.eatTime || phase === "expired") {
        if (t >= h.eatTime && !ate.has(spec.id)) {
          ate.add(spec.id);
          audio.play("eat");
        }
        m.visible = false;
        continue;
      }
      fallingBugPosition(h.fall, t, scratch);
      if (phase === "floating" && !rippled.has(spec.id)) {
        rippled.add(spec.id);
        water.addRipple(scratch.x, scratch.z, 0.9);
        audio.play("splash");
      } m.geometry = phase === "floating" ? bugFloatingGeo : bugFlyingGeo;
    } else {
      if (tb < spec.spawnTime || tb >= spec.despawnTime) {
        m.visible = false;
        continue;
      }
      bugPosition(spec, tb, scratch);
      m.geometry = bugFlyingGeo;
    }
    m.visible = true;
    m.position.set(scratch.x, scratch.y, scratch.z);
  }
}

/** Starts the jet of every spit whose moment has been reached on screen. */
function runFx(t: number, now: number) {
  while (nipTicks.length > 0 && nipTicks[0]! / TICK_HZ <= t) {
    nipTicks.shift();
    audio.play("nip");
  }
  while (fx.length > 0 && fx[0]!.tick / TICK_HZ <= t) {
    const e = fx.shift()!;
    const id = e.playerId;
    const f = shown[id];
    if (!f || id >= jets.length) continue;
    if (e.hit) audio.play("hit");
    if (id === you) {
      while (localJets.length > 0 && now - localJets[0]! > 1500) localJets.shift();
      if (localJets.length > 0) {
        localJets.shift(); // already drawn and heard when you clicked
        continue;
      }
    }
    jetStart[id]!.set(f.x, SPIT_ORIGIN_Y, f.z);
    if (e.hit) {
      jetEnd[id]!.set(e.hit.x, e.hit.y, e.hit.z);
    } else {
      // The wire carries no aim, so other players' misses point the way they face.
      const own = id === you;
      const yaw = own ? lastAim.yaw : f.facing;
      const pitch = own ? Math.min(SPIT_PITCH_MAX, Math.max(SPIT_PITCH_MIN, lastAim.pitch)) : 0;
      const cp = Math.cos(pitch);
      jetEnd[id]!.set(
        f.x + cp * Math.cos(yaw) * e.length,
        SPIT_ORIGIN_Y + Math.sin(pitch) * e.length,
        f.z + cp * Math.sin(yaw) * e.length,
      );
    }
    jetUntil[id] = now + 140;
    audio.play("spit");
  }
}


const fmtCooldown = (t: number) => (t <= 0 ? "ready" : `${t.toFixed(1)}s`);
let lastHud = "";
function updateHud(lf: Frame, now: number) {
  const me = lf.players[you];
  if (!me) return;
  const age = (now - latestArrival) / 1000;
  const secs = Math.ceil(Math.max(0, MATCH_DURATION - lf.t));
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const board = roster.map((r) => `${r.name} ${lf.players[r.id]?.stash ?? 0}`).join("   ");
  const nipCd = predictor ? predictor.nipCdLeft / TICK_HZ : me.nipCd - age;
  const text =
    `${clock}   stash ${me.stash}   eaten ${me.eaten}   spit ${me.hits}/${me.shots}\n` +
    `spit ${fmtCooldown(me.spitCd - age)}   nip ${fmtCooldown(nipCd)}   ping ${Math.round(net.rtt)} ms\n` +
    board;
  if (text !== lastHud) {
    hud.textContent = text;
    lastHud = text;
  }
}

// ---------- Frame loop ----------
let last = performance.now();

function frame(now: number) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  const lf = frames[frames.length - 1];

  if (active && lf) {
    syncClock(lf, dt, now);
    sampleFrames(frames, renderT, shown);
    bugT = bugClock(lf, now);
    ensureSpecs(bugT);

    acc = Math.min(acc + dt, 0.1);
    while (acc >= TICK_DT) {
      sendTick();
      acc -= TICK_DT;
    }

    // Your own fish comes from the prediction, with the server's correction eased out.
    const pr = predictor;
    const own = shown[you];
    if (pr && own) {
      const a = acc / TICK_DT;
      const k = Math.exp(-dt * 12);
      errX *= k;
      errZ *= k;
      own.x = prevPX + (pr.body.x - prevPX) * a + errX;
      own.z = prevPZ + (pr.body.z - prevPZ) * a + errZ;
      own.facing = pr.body.facing;
      own.dash = pr.dashLeft > 0;
    }

    for (let i = 0; i < shown.length; i++) {
      const f = shown[i]!;
      const m = fishMeshes[i];
      if (!m) continue;
      const w = swim[i]!;
      if (!w.init) {
        w.x = f.x;
        w.z = f.z;
        w.init = true;
      }
      const inst = Math.hypot(f.x - w.x, f.z - w.z) / Math.max(dt, 1e-3);
      w.x = f.x;
      w.z = f.z;
      w.sp += (Math.min(inst, 8) - w.sp) * Math.min(1, dt * 6);
      w.phase += dt * (4 + w.sp * 2.2);
      fishSkins[colorIndex(i)]!.setSwim(w.phase, 0.35 + Math.min(1, w.sp / 4) * 0.65);
      if (w.sp > 1.2 && now > w.wake) {
        water.addRipple(f.x, f.z, 0.3);
        w.wake = now + 300;
      }
      m.position.x = f.x;
      m.position.z = f.z;
      if (i === you) {
        ownYaw += angleDiff(ownYaw, Math.PI / 2 - f.facing) * 0.35;
        m.rotation.y = ownYaw;
      } else {
        m.rotation.y = Math.PI / 2 - f.facing;
      }
      m.scale.setScalar(f.dash ? 1.3 : 1);
    }

    updateBugs(renderT, bugT);
    runFx(renderT, now);
    updateHud(lf, now);
  }

  for (let i = 0; i < jets.length; i++) {
    const j = jets[i]!;
    if (now < jetUntil[i]!) {
      j.visible = true;
      j.position.copy(jetStart[i]!);
      j.lookAt(jetEnd[i]!);
      j.scale.set(1, 1, Math.max(0.01, jetStart[i]!.distanceTo(jetEnd[i]!)));
    } else {
      j.visible = false;
    }
  }

  foreground.update(now);
  water.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
