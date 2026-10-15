import {
  BackSide,
  BoxGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
} from '@iwsdk/core';

// Low-poly procedural art for the first expedition. All sizes are in metres at
// tabletop scale: the rover chassis is 8 cm long.

function mat(color: number, extra: Partial<{ emissive: number; emissiveIntensity: number; metalness: number; roughness: number; transparent: boolean; opacity: number }> = {}) {
  return new MeshStandardMaterial({
    color,
    flatShading: true,
    roughness: extra.roughness ?? 0.8,
    metalness: extra.metalness ?? 0.1,
    emissive: new Color(extra.emissive ?? 0x000000),
    emissiveIntensity: extra.emissiveIntensity ?? 1,
    transparent: extra.transparent ?? false,
    opacity: extra.opacity ?? 1,
  });
}

export const Mats = {
  ground: mat(0xc9774a),
  groundDark: mat(0x8e4b2f),
  rock: mat(0x6e4a3c),
  rockLight: mat(0x9a6a52),
  metal: mat(0xb8c2cc, { metalness: 0.6, roughness: 0.4 }),
  metalDark: mat(0x4a5560, { metalness: 0.5, roughness: 0.5 }),
  hazard: mat(0xf2b134),
  rubber: mat(0x23262b),
  motor: mat(0x3d7bd9, { metalness: 0.3, roughness: 0.5 }),
  arm: mat(0xe0a020, { metalness: 0.3, roughness: 0.5 }),
  gripper: mat(0x2fb59a, { metalness: 0.3, roughness: 0.5 }),
  ancient: mat(0x4c4f6b, { roughness: 0.9 }),
  ancientGlowOff: mat(0x2a2c40, { emissive: 0x111133, emissiveIntensity: 0.4 }),
  ancientGlowOn: mat(0x7fe7ff, { emissive: 0x39d8ff, emissiveIntensity: 2.2 }),
  cell: mat(0x9cff6a, { emissive: 0x63ff2e, emissiveIntensity: 1.6 }),
  socketFree: mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.6, transparent: true, opacity: 0.45 }),
  socketReady: mat(0x5cff8a, { emissive: 0x5cff8a, emissiveIntensity: 1.5, transparent: true, opacity: 0.8 }),
  beam: mat(0x7fe7ff, { emissive: 0x7fe7ff, emissiveIntensity: 2, transparent: true, opacity: 0.35 }),
  console: mat(0x30363e, { metalness: 0.4, roughness: 0.6 }),
  knobLeft: mat(0xff7a3d, { emissive: 0x401800, emissiveIntensity: 1 }),
  knobRight: mat(0x3dc5ff, { emissive: 0x002a40, emissiveIntensity: 1 }),
  tray: mat(0x5a6470, { metalness: 0.4, roughness: 0.6 }),
};

function box(w: number, h: number, d: number, m: MeshStandardMaterial, x = 0, y = 0, z = 0): Mesh {
  const mesh = new Mesh(new BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
}

function cyl(rTop: number, rBot: number, h: number, m: MeshStandardMaterial, seg = 8): Mesh {
  return new Mesh(new CylinderGeometry(rTop, rBot, h, seg), m);
}

function rock(size: number, x: number, z: number, seed: number): Mesh {
  const mesh = new Mesh(new DodecahedronGeometry(size, 0), seed % 2 ? Mats.rock : Mats.rockLight);
  mesh.position.set(x, size * 0.55, z);
  mesh.rotation.set(seed * 0.7, seed * 1.3, seed * 0.4);
  mesh.scale.set(1, 0.75 + (seed % 3) * 0.15, 1);
  return mesh;
}

/** A rectangular rock wall block whose footprint is [x0,x1] x [z0,z1]. */
export function rockWall(x0: number, x1: number, z0: number, z1: number, height: number, seed: number): Object3D {
  const g = new Group();
  g.add(box(x1 - x0, height, z1 - z0, Mats.rock, (x0 + x1) / 2, height / 2, (z0 + z1) / 2));
  // Rubble on top so the walls read as rock, not boxes.
  const nx = Math.max(1, Math.round((x1 - x0) / 0.035));
  const nz = Math.max(1, Math.round((z1 - z0) / 0.035));
  let s = seed;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      s++;
      const r = rock(0.018 + (s % 3) * 0.004, x0 + ((i + 0.5) * (x1 - x0)) / nx, z0 + ((j + 0.5) * (z1 - z0)) / nz, s);
      r.position.y += height - 0.012;
      g.add(r);
    }
  }
  return g;
}

export function buildTerrain(): Object3D {
  const g = new Group();
  // Main plateau slab.
  g.add(box(0.9, 0.03, 0.52, Mats.ground, 0, -0.015, 0));
  g.add(box(0.92, 0.02, 0.54, Mats.groundDark, 0, -0.035, 0));
  // Front workshop lip, a slightly darker strip.
  g.add(box(0.9, 0.002, 0.07, Mats.groundDark, 0, 0.001, 0.225));
  // Far plateau, across the chasm, where the Titan Gate stands.
  g.add(box(0.5, 0.03, 0.16, Mats.ground, -0.05, -0.015, -0.42));
  g.add(box(0.52, 0.02, 0.18, Mats.groundDark, -0.05, -0.035, -0.42));
  // Scattered boulders for silhouette.
  const scatter: [number, number, number][] = [
    [0.4, -0.22, 0.03], [0.41, 0.0, 0.022], [-0.41, -0.2, 0.026], [0.05, -0.2, 0.018],
    [0.1, 0.04, 0.012], [-0.08, -0.05, 0.014], [0.38, 0.12, 0.018], [-0.14, 0.15, 0.012],
  ];
  scatter.forEach(([x, z, s], i) => g.add(rock(s, x, z, i + 3)));
  // Crashed landing pod.
  const pod = new Group();
  const shell = new Mesh(new SphereGeometry(0.035, 8, 6), Mats.metal);
  shell.scale.set(1, 0.8, 1.4);
  pod.add(shell);
  const fin = box(0.004, 0.03, 0.03, Mats.hazard, 0, 0.025, 0.03);
  pod.add(fin);
  pod.position.set(-0.39, 0.02, 0.06);
  pod.rotation.set(0.3, 0.8, 0.5);
  g.add(pod);
  return g;
}

export function buildWorkbenchPad(): Object3D {
  const g = new Group();
  const pad = cyl(0.06, 0.065, 0.006, Mats.metalDark, 12);
  pad.position.y = 0.003;
  g.add(pad);
  const ring = new Mesh(new TorusGeometry(0.058, 0.003, 4, 24), Mats.hazard);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.006;
  g.add(ring);
  return g;
}

export function buildTray(): Object3D {
  const g = new Group();
  g.add(box(0.26, 0.012, 0.09, Mats.tray, 0, 0.006, 0));
  g.add(box(0.26, 0.012, 0.004, Mats.metalDark, 0, 0.012, 0.045));
  g.add(box(0.26, 0.012, 0.004, Mats.metalDark, 0, 0.012, -0.045));
  return g;
}

/** Rover chassis. Forward is -Z. Origin at the ground contact point. */
export function buildChassis(): Object3D {
  const g = new Group();
  g.add(box(0.05, 0.012, 0.08, Mats.metal, 0, 0.024, 0));
  g.add(box(0.052, 0.003, 0.02, Mats.hazard, 0, 0.031, 0.03));
  g.add(box(0.01, 0.01, 0.01, Mats.metalDark, 0.018, 0.034, -0.03));
  // Small "eye" light at the front.
  const eye = new Mesh(new SphereGeometry(0.004, 6, 4), Mats.cell);
  eye.position.set(0, 0.026, -0.041);
  g.add(eye);
  return g;
}

/** Wheel module: two axles, four wheels. Returns the group; wheels are named "wheel". */
export function buildWheels(): Object3D {
  const g = new Group();
  for (const z of [-0.026, 0.026]) {
    g.add(box(0.06, 0.004, 0.006, Mats.metalDark, 0, 0.012, z));
    for (const x of [-0.031, 0.031]) {
      const w = cyl(0.012, 0.012, 0.01, Mats.rubber, 8);
      w.rotation.z = Math.PI / 2;
      w.position.set(x, 0.012, z);
      w.name = 'wheel';
      g.add(w);
    }
  }
  return g;
}

export function buildMotor(): Object3D {
  const g = new Group();
  const body = cyl(0.011, 0.011, 0.022, Mats.motor, 8);
  body.rotation.z = Math.PI / 2;
  body.position.y = 0.011;
  g.add(body);
  g.add(box(0.026, 0.004, 0.018, Mats.metalDark, 0, 0.002, 0));
  const cap = cyl(0.006, 0.006, 0.026, Mats.metal, 6);
  cap.rotation.z = Math.PI / 2;
  cap.position.y = 0.011;
  g.add(cap);
  return g;
}

/** Arm: 10 cm boom pointing -Z. Its tip socket lives at (0, 0.01, -0.1). */
export function buildArm(): Object3D {
  const g = new Group();
  g.add(box(0.016, 0.01, 0.014, Mats.metalDark, 0, 0.005, 0));
  g.add(box(0.008, 0.008, 0.1, Mats.arm, 0, 0.01, -0.05));
  const joint = new Mesh(new SphereGeometry(0.007, 6, 4), Mats.metal);
  joint.position.set(0, 0.01, -0.1);
  g.add(joint);
  return g;
}

/** Gripper: two jaws opening toward -Z. A child named "tip" marks the grab point. */
export function buildGripper(): Object3D {
  const g = new Group();
  g.add(box(0.016, 0.01, 0.01, Mats.gripper, 0, 0, 0));
  g.add(box(0.003, 0.008, 0.018, Mats.gripper, -0.007, 0, -0.012));
  g.add(box(0.003, 0.008, 0.018, Mats.gripper, 0.007, 0, -0.012));
  const tip = new Object3D();
  tip.name = 'tip';
  tip.position.set(0, 0, -0.016);
  g.add(tip);
  return g;
}

export function buildSocketMarker(): Mesh {
  const ring = new Mesh(new TorusGeometry(0.009, 0.0018, 4, 16), Mats.socketFree);
  ring.rotation.x = Math.PI / 2;
  return ring;
}

export function buildPowerCell(): Object3D {
  const g = new Group();
  const core = new Mesh(new OctahedronGeometry(0.011, 0), Mats.cell);
  core.scale.set(0.8, 1.3, 0.8);
  g.add(core);
  const band = cyl(0.009, 0.009, 0.004, Mats.metalDark, 6);
  g.add(band);
  return g;
}

/** Ancient relay pylon. Its socket faces +Z at (0, 0.03, 0.046). */
export function buildRelay(): { root: Object3D; glow: Mesh[]; beam: Mesh } {
  const g = new Group();
  g.add(box(0.1, 0.012, 0.09, Mats.ancient, 0, 0.006, 0));
  const pylon = cyl(0.018, 0.032, 0.11, Mats.ancient, 6);
  pylon.position.y = 0.067;
  g.add(pylon);
  const crown = new Mesh(new OctahedronGeometry(0.02, 0), Mats.ancientGlowOff);
  crown.position.y = 0.135;
  g.add(crown);
  const slot = box(0.03, 0.03, 0.02, Mats.ancientGlowOff, 0, 0.03, 0.036);
  g.add(slot);
  const beam = cyl(0.006, 0.006, 0.6, Mats.beam, 8);
  beam.position.y = 0.45;
  beam.visible = false;
  g.add(beam);
  return { root: g, glow: [crown, slot], beam };
}

/** Folding bridge plank. Pivot is at its near (+Z) end; it starts raised. */
export function buildBridge(): { root: Object3D; deck: Object3D } {
  const root = new Group();
  const deck = new Group();
  deck.add(box(0.1, 0.008, 0.1, Mats.ancient, 0, -0.004, -0.05));
  deck.add(box(0.006, 0.012, 0.1, Mats.ancientGlowOff, -0.047, 0.004, -0.05));
  deck.add(box(0.006, 0.012, 0.1, Mats.ancientGlowOff, 0.047, 0.004, -0.05));
  root.add(deck);
  return { root, deck };
}

export function buildTitanGate(): { root: Object3D; glow: Mesh[] } {
  const g = new Group();
  const left = box(0.05, 0.32, 0.05, Mats.ancient, -0.11, 0.16, 0);
  const right = box(0.05, 0.32, 0.05, Mats.ancient, 0.11, 0.16, 0);
  const lintel = box(0.3, 0.05, 0.06, Mats.ancient, 0, 0.345, 0);
  g.add(left, right, lintel);
  const eye = new Mesh(new OctahedronGeometry(0.03, 0), Mats.ancientGlowOff);
  eye.position.set(0, 0.2, 0);
  g.add(eye);
  const spireL = new Mesh(new ConeGeometry(0.03, 0.08, 4), Mats.ancient);
  spireL.position.set(-0.11, 0.4, 0);
  const spireR = spireL.clone();
  spireR.position.x = 0.11;
  g.add(spireL, spireR);
  return { root: g, glow: [eye] };
}

/** Driver console: a low box with two lever slots, sitting on the front lip. */
export function buildConsole(): Object3D {
  const g = new Group();
  g.add(box(0.16, 0.03, 0.06, Mats.console, 0, 0.015, 0));
  for (const x of [-0.04, 0.04]) {
    g.add(box(0.012, 0.002, 0.09, Mats.metalDark, x, 0.031, 0));
  }
  g.add(box(0.16, 0.002, 0.004, Mats.hazard, 0, 0.031, 0.028));
  return g;
}

export function buildLeverKnob(side: 'left' | 'right'): Object3D {
  const g = new Group();
  const stick = cyl(0.003, 0.003, 0.05, Mats.metal, 6);
  stick.position.y = -0.025;
  g.add(stick);
  const knob = new Mesh(new SphereGeometry(0.014, 10, 8), side === 'left' ? Mats.knobLeft : Mats.knobRight);
  g.add(knob);
  return g;
}

/** Inside-out sky for cockpit mode: dusty horizon fading to a violet zenith. */
export function buildSkyDome(): Mesh {
  const geo = new SphereGeometry(80, 24, 12);
  const pos = geo.getAttribute('position');
  const colors: number[] = [];
  const horizon = new Color(0xe39a6b);
  const zenith = new Color(0x2b1d4a);
  const ground = new Color(0x5a2e1d);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / 80;
    if (t >= 0) c.copy(horizon).lerp(zenith, Math.pow(t, 0.6));
    else c.copy(horizon).lerp(ground, Math.min(1, -t * 4));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const sky = new Mesh(geo, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false }));
  sky.name = 'SkyDome';
  return sky;
}

/** Canyon floor far below the plateau, only shown in cockpit mode (diorama units). */
export function buildCanyonFloor(): Object3D {
  const g = new Group();
  const floor = new Mesh(new CircleGeometry(3, 24), Mats.groundDark);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.3;
  g.add(floor);
  // Distant mesas for a sense of scale.
  const mesas: [number, number, number, number][] = [
    [-1.4, -1.6, 0.35, 0.3], [1.2, -1.9, 0.5, 0.45], [2.0, -0.4, 0.3, 0.25],
    [-2.1, 0.3, 0.4, 0.35], [0.3, -2.4, 0.6, 0.5], [-0.9, 1.8, 0.3, 0.2],
  ];
  mesas.forEach(([x, z, r, h], i) => {
    const m = new Mesh(new CylinderGeometry(r * 0.8, r, h, 7), i % 2 ? Mats.rock : Mats.ground);
    m.position.set(x, -0.3 + h / 2, z);
    g.add(m);
  });
  return g;
}

/** Fixed cockpit frame around a seated player. Gives the eyes a stable reference while the world moves. */
export function buildCockpitFrame(): Object3D {
  const g = new Group();
  const frameMat = Mats.console;
  for (const x of [-0.85, 0.85]) {
    const pillar = box(0.04, 0.9, 0.04, frameMat, x, 1.05, -0.5);
    pillar.rotation.z = x < 0 ? -0.15 : 0.15;
    g.add(pillar);
  }
  g.add(box(1.6, 0.04, 0.05, frameMat, 0, 1.52, -0.5));
  g.add(box(1.2, 0.06, 0.3, frameMat, 0, 0.66, -0.3));
  g.add(box(1.2, 0.01, 0.01, Mats.hazard, 0, 0.695, -0.15));
  return g;
}

/** Head-locked black shell used to fade between table and cockpit views. */
export function buildFadeShell(): Mesh {
  const mat = new MeshBasicMaterial({ color: 0x000000, side: BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
  const shell = new Mesh(new SphereGeometry(0.25, 12, 8), mat);
  shell.renderOrder = 999;
  shell.frustumCulled = false;
  shell.visible = false;
  return shell;
}
