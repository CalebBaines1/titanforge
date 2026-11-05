import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
} from '@iwsdk/core';

// Low-poly procedural art for Lantern Valley. All sizes are metres at tabletop
// scale: the valley is 90 x 70 cm and the hero is about 4 cm tall.

export const VALLEY_W = 0.9;
export const VALLEY_D = 0.7;

function mat(color: number, extra: { emissive?: number; emissiveIntensity?: number; roughness?: number; transparent?: boolean; opacity?: number } = {}) {
  return new MeshStandardMaterial({
    color,
    flatShading: true,
    roughness: extra.roughness ?? 0.85,
    metalness: 0.05,
    emissive: new Color(extra.emissive ?? 0x000000),
    emissiveIntensity: extra.emissiveIntensity ?? 1,
    transparent: extra.transparent ?? false,
    opacity: extra.opacity ?? 1,
  });
}

export const Mats = {
  base: mat(0x4a3526),
  wood: mat(0x6a4a2c),
  woodDark: mat(0x4a3220),
  plaster: mat(0xe0d2b4),
  roof: mat(0x9a3f2c),
  stone: mat(0x8a8276),
  stoneDark: mat(0x6a645a),
  pine: mat(0x2f6b3a),
  pineDark: mat(0x245a30),
  trunk: mat(0x5a3d24),
  tent: mat(0xa8683a),
  tentDark: mat(0x7a4a28),
  flame: mat(0xffa040, { emissive: 0xff7a20, emissiveIntensity: 2.4 }),
  window: mat(0xffd080, { emissive: 0xffb050, emissiveIntensity: 1.8 }),
  heroCloak: mat(0x2f5f9a),
  heroSkin: mat(0xf0c8a0),
  heroHat: mat(0x6a3a22),
  lantern: mat(0xffe08a, { emissive: 0xffc050, emissiveIntensity: 2.6 }),
  banditCloak: mat(0x7a2a2a),
  banditHood: mat(0x4a1c1c),
  airSash: mat(0xcdeeff, { emissive: 0x6ab8ff, emissiveIntensity: 0.6 }),
  bruteSkin: mat(0x7a6a4a),
  earthSash: mat(0xe0a850, { emissive: 0x804a10, emissiveIntensity: 0.5 }),
  blade: mat(0xd8dde2, { roughness: 0.4 }),
  water: new MeshStandardMaterial({ color: 0x3a8ad8, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.85, flatShading: true }),
};

// ---------------------------------------------------------------- the land

/** River centreline, from the near edge to the far edge (x, z). */
export const RIVER: [number, number][] = [
  [0.0, 0.37], [-0.01, 0.2], [0.04, 0.06], [0.05, 0.0], [0.03, -0.12], [0.08, -0.26], [0.1, -0.37],
];
/** Road from your house, over the bridge, to the bandit camp. */
export const ROAD: [number, number][] = [
  [-0.3, 0.13], [-0.2, 0.08], [-0.08, 0.03], [0.0, 0.0], [0.1, 0.0], [0.18, -0.07], [0.24, -0.16], [0.27, -0.21],
];
export const BRIDGE = { x: 0.05, z: 0.0, half: 0.045 };
export const HOUSE = { x: -0.33, z: 0.16, doorX: -0.3, doorZ: 0.12 };
export const CAMP = { x: 0.29, z: -0.24 };

/** X of the river at depth z. */
export function riverX(z: number): number {
  for (let i = 1; i < RIVER.length; i++) {
    const a = RIVER[i - 1], b = RIVER[i];
    if (z <= a[1] && z >= b[1]) {
      const f = (z - a[1]) / (b[1] - a[1]);
      return a[0] + (b[0] - a[0]) * f;
    }
  }
  return z > RIVER[0][1] ? RIVER[0][0] : RIVER[RIVER.length - 1][0];
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz;
  const t = l > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l)) : 0;
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
function polyDist(px: number, pz: number, pts: [number, number][]): number {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(px, pz, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  return d;
}
const bump = (x: number, z: number, cx: number, cz: number, r: number) => {
  const d = Math.hypot(x - cx, z - cz) / r;
  return d >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d);
};

/** Ground height in valley-local metres. */
export function heightAt(x: number, z: number): number {
  let h = 0.004 * Math.sin(x * 21 + 1.3) * Math.sin(z * 17 + 0.4) + 0.003 * Math.sin(x * 43 + z * 31);
  h += 0.03 * bump(x, z, -0.36, -0.24, 0.16) + 0.022 * bump(x, z, 0.36, 0.2, 0.14) + 0.012 * bump(x, z, -0.12, -0.22, 0.12);
  const r = polyDist(x, z, RIVER);
  if (r < 0.05) h = h * (r / 0.05) - 0.012 * (1 - r / 0.05) * (1 - r / 0.05);
  const road = polyDist(x, z, ROAD);
  if (road < 0.02) h *= 0.4 + 0.6 * (road / 0.02);
  return h;
}

const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** The table-top land: a terrain sheet with a soil base, the river, road colour and the bridge. */
export function buildTerrain(): { root: Group; ground: Mesh } {
  const root = new Group();
  const geo = new PlaneGeometry(VALLEY_W, VALLEY_D, 72, 56);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors: number[] = [];
  const c = new Color(), grass = new Color(0x6a9a4a), grass2 = new Color(0x58884a), dirt = new Color(0xa0805a), bank = new Color(0x8a7a52), hill = new Color(0x7aa055);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    // edge vertices drop to the soil block so the sheet has no open side
    const edge = Math.abs(Math.abs(x) - VALLEY_W / 2) < 1e-5 || Math.abs(Math.abs(z) - VALLEY_D / 2) < 1e-5;
    pos.setY(i, edge ? -0.021 : heightAt(x, z));
    c.copy(hash(i) > 0.5 ? grass : grass2).lerp(hill, Math.min(1, heightAt(x, z) * 30));
    if (polyDist(x, z, ROAD) < 0.016) c.copy(dirt);
    if (polyDist(x, z, RIVER) < 0.04) c.copy(bank);
    if (Math.hypot(x - CAMP.x, z - CAMP.z) < 0.07) c.lerp(dirt, 0.6);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const ground = new Mesh(geo, new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
  ground.name = 'ValleyGround';
  ground.receiveShadow = true;
  root.add(ground);

  // soil block under the sheet; its top sits below the deepest dip so it never pokes through
  const base = new Mesh(new BoxGeometry(VALLEY_W, 0.03, VALLEY_D), Mats.base);
  base.position.y = -0.016 - 0.02;
  root.add(base);

  // the river: a flat ribbon just under the bank tops
  const rv: number[] = [], idx: number[] = [];
  for (let i = 0; i < RIVER.length; i++) {
    const [x, z] = RIVER[i];
    const n = RIVER[Math.min(i + 1, RIVER.length - 1)], p = RIVER[Math.max(i - 1, 0)];
    const dx = n[0] - p[0], dz = n[1] - p[1], l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l * 0.022, nz = dx / l * 0.022;
    rv.push(x - nx, -0.004, z - nz, x + nx, -0.004, z + nz);
    if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const rg = new PlaneGeometry(1, 1);
  rg.setIndex(idx); rg.setAttribute('position', new Float32BufferAttribute(rv, 3)); rg.deleteAttribute('uv'); rg.deleteAttribute('normal'); rg.computeVertexNormals();
  const river = new Mesh(rg, Mats.water);
  river.material.side = DoubleSide;
  root.add(river);

  // the bridge
  const bridge = new Group();
  bridge.position.set(BRIDGE.x, 0.004, BRIDGE.z);
  const deck = new Mesh(new BoxGeometry(BRIDGE.half * 2 + 0.01, 0.004, 0.028), Mats.wood);
  deck.castShadow = true; bridge.add(deck);
  for (const s of [-1, 1]) {
    const rail = new Mesh(new BoxGeometry(BRIDGE.half * 2 + 0.01, 0.003, 0.003), Mats.woodDark);
    rail.position.set(0, 0.009, s * 0.013); bridge.add(rail);
    for (const px of [-1, 0, 1]) {
      const post = new Mesh(new BoxGeometry(0.003, 0.01, 0.003), Mats.woodDark);
      post.position.set(px * BRIDGE.half, 0.005, s * 0.013); bridge.add(post);
    }
  }
  root.add(bridge);
  return { root, ground };
}

/** Pine trees and rocks scattered where nothing else is (instanced: a few draw calls). */
export function buildScatter(): Group {
  const root = new Group();
  const spots: [number, number, number][] = [];
  for (let i = 0; spots.length < 70 && i < 900; i++) {
    const x = (hash(i * 3.1) - 0.5) * (VALLEY_W - 0.04), z = (hash(i * 7.3) - 0.5) * (VALLEY_D - 0.04);
    if (polyDist(x, z, RIVER) < 0.05 || polyDist(x, z, ROAD) < 0.04) continue;
    if (Math.hypot(x - HOUSE.x, z - HOUSE.z) < 0.09 || Math.hypot(x - CAMP.x, z - CAMP.z) < 0.1) continue;
    if (Math.hypot(x - 0.16, z + 0.08) < 0.08) continue; // patrol lane
    if (spots.some((s) => Math.hypot(s[0] - x, s[1] - z) < 0.035)) continue;
    spots.push([x, z, 0.7 + 0.6 * hash(i * 1.7)]);
  }
  const cone = new ConeGeometry(0.014, 0.04, 6), trunk = new CylinderGeometry(0.0025, 0.003, 0.01, 5);
  const crowns = new InstancedMesh(cone, Mats.pine, spots.length), trunks = new InstancedMesh(trunk, Mats.trunk, spots.length);
  const m = new Matrix4(), q = new Quaternion(), s = new Vector3(), p = new Vector3();
  spots.forEach(([x, z, k], i) => {
    const y = heightAt(x, z);
    s.setScalar(k); p.set(x, y + 0.01 * k + 0.02 * k, z); m.compose(p, q, s); crowns.setMatrixAt(i, m);
    p.set(x, y + 0.005 * k, z); m.compose(p, q, s); trunks.setMatrixAt(i, m);
  });
  crowns.castShadow = true;
  root.add(crowns, trunks);
  const rockG = new DodecahedronGeometry(0.008, 0);
  const rocks = new InstancedMesh(rockG, Mats.stone, 18);
  for (let i = 0; i < 18; i++) {
    let x = 0, z = 0;
    for (let j = 0; j < 40; j++) { x = (hash(i * 13.7 + j) - 0.5) * 0.84; z = (hash(i * 5.9 + j * 2) - 0.5) * 0.64; if (polyDist(x, z, ROAD) > 0.03 && polyDist(x, z, RIVER) > 0.04) break; }
    s.set(1 + hash(i), 0.6 + 0.4 * hash(i + 4), 1 + hash(i + 8)); p.set(x, heightAt(x, z) + 0.002, z);
    q.setFromAxisAngle(new Vector3(0, 1, 0), hash(i) * 6); m.compose(p, q, s); rocks.setMatrixAt(i, m);
  }
  root.add(rocks);
  return root;
}

/** Your house on the edge of Lanternfall. */
export function buildHouse(): Group {
  const g = new Group();
  const walls = new Mesh(new BoxGeometry(0.06, 0.035, 0.045), Mats.plaster); walls.position.y = 0.0175; walls.castShadow = true; g.add(walls);
  for (const s of [-1, 1]) {
    const r = new Mesh(new BoxGeometry(0.068, 0.004, 0.032), Mats.roof);
    r.position.set(0, 0.045, s * 0.0115); r.rotation.x = s * 0.62; r.castShadow = true; g.add(r);
  }
  const chim = new Mesh(new BoxGeometry(0.008, 0.02, 0.008), Mats.stone); chim.position.set(0.018, 0.052, -0.008); g.add(chim);
  const door = new Mesh(new BoxGeometry(0.01, 0.018, 0.002), Mats.woodDark); door.position.set(0.012, 0.009, 0.0232); g.add(door);
  for (const x of [-0.015, 0.0]) { const w = new Mesh(new BoxGeometry(0.008, 0.008, 0.002), Mats.window); w.position.set(x - 0.005, 0.022, 0.0232); g.add(w); }
  const post = new Mesh(new CylinderGeometry(0.0012, 0.0012, 0.03, 5), Mats.woodDark); post.position.set(0.04, 0.015, 0.03); g.add(post);
  const lamp = new Mesh(new BoxGeometry(0.006, 0.007, 0.006), Mats.window); lamp.position.set(0.04, 0.032, 0.03); g.add(lamp);
  return g;
}

/** The bandit camp: tents, a fire and a banner. */
export function buildCamp(): { root: Group; flame: Mesh } {
  const g = new Group();
  const tents: [number, number, number][] = [[-0.045, -0.03, 0.4], [0.04, -0.035, -0.5], [0.05, 0.035, 2.4]];
  for (const [x, z, r] of tents) {
    const t = new Mesh(new ConeGeometry(0.024, 0.032, 4), Mats.tent); t.position.set(x, 0.016, z); t.rotation.y = r; t.castShadow = true; g.add(t);
    const flap = new Mesh(new BoxGeometry(0.008, 0.016, 0.002), Mats.tentDark); flap.position.set(x + Math.sin(r) * 0.012, 0.008, z + Math.cos(r) * 0.012); flap.rotation.y = r; g.add(flap);
  }
  for (let i = 0; i < 3; i++) { const l = new Mesh(new CylinderGeometry(0.0018, 0.0018, 0.016, 5), Mats.trunk); l.rotation.set(Math.PI / 2, i * 1.05, 0); l.position.y = 0.002; g.add(l); }
  const flame = new Mesh(new ConeGeometry(0.0055, 0.014, 5), Mats.flame); flame.position.y = 0.008; g.add(flame);
  const pole = new Mesh(new CylinderGeometry(0.001, 0.001, 0.05, 4), Mats.woodDark); pole.position.set(-0.02, 0.025, 0.04); g.add(pole);
  const flag = new Mesh(new BoxGeometry(0.016, 0.01, 0.001), Mats.banditCloak); flag.position.set(-0.012, 0.044, 0.04); g.add(flag);
  return { root: g, flame };
}

// ---------------------------------------------------------------- figures

export interface Figure {
  root: Group;
  body: Group;
  armL: Group;
  armR: Group;
}

/** The hero: blue cloak, wide hat and a glowing lantern in the left hand. About 4 cm tall. */
export function buildHero(): Figure & { lantern: Mesh } {
  const root = new Group(), body = new Group(); root.add(body);
  const cloak = new Mesh(new CylinderGeometry(0.006, 0.0105, 0.022, 8), Mats.heroCloak); cloak.position.y = 0.011; cloak.castShadow = true; body.add(cloak);
  const head = new Mesh(new SphereGeometry(0.0065, 10, 8), Mats.heroSkin); head.position.y = 0.028; body.add(head);
  const brim = new Mesh(new CylinderGeometry(0.011, 0.011, 0.0015, 10), Mats.heroHat); brim.position.y = 0.032; body.add(brim);
  const top = new Mesh(new ConeGeometry(0.006, 0.01, 8), Mats.heroHat); top.position.y = 0.0375; body.add(top);
  const mkArm = (s: number) => {
    const a = new Group(); a.position.set(s * 0.0075, 0.02, 0); body.add(a);
    const m = new Mesh(new CylinderGeometry(0.0018, 0.0018, 0.012, 5), Mats.heroCloak); m.position.y = -0.006; a.add(m);
    return a;
  };
  const armL = mkArm(-1), armR = mkArm(1);
  const lantern = new Mesh(new BoxGeometry(0.0045, 0.006, 0.0045), Mats.lantern); lantern.position.set(0, -0.0135, 0.002); armL.add(lantern);
  armL.rotation.x = -0.5;
  return { root, body, armL, armR, lantern };
}

/** A bandit: hooded, with a sash in its element colour. `brute` builds the bigger earth bandit. */
export function buildBandit(brute: boolean): Figure {
  const k = brute ? 1.35 : 1;
  const root = new Group(), body = new Group(); root.add(body); body.scale.setScalar(k);
  const cloak = new Mesh(new CylinderGeometry(0.0055, 0.0095, 0.02, 7), brute ? Mats.bruteSkin : Mats.banditCloak); cloak.position.y = 0.01; cloak.castShadow = true; body.add(cloak);
  const sash = new Mesh(new CylinderGeometry(0.0078, 0.0082, 0.003, 7), brute ? Mats.earthSash : Mats.airSash); sash.position.y = 0.012; body.add(sash);
  const head = new Mesh(new SphereGeometry(0.006, 8, 6), Mats.banditHood); head.position.y = 0.025; body.add(head);
  const hood = new Mesh(new ConeGeometry(0.0062, 0.009, 7), Mats.banditHood); hood.position.y = 0.031; body.add(hood);
  const mkArm = (s: number) => {
    const a = new Group(); a.position.set(s * 0.007, 0.018, 0); body.add(a);
    const m = new Mesh(new CylinderGeometry(0.0017, 0.0017, 0.011, 5), brute ? Mats.bruteSkin : Mats.banditCloak); m.position.y = -0.0055; a.add(m);
    return a;
  };
  const armL = mkArm(-1), armR = mkArm(1);
  const blade = new Mesh(brute ? new BoxGeometry(0.006, 0.006, 0.014) : new BoxGeometry(0.0012, 0.0012, 0.016), brute ? Mats.stoneDark : Mats.blade);
  blade.position.set(0, -0.011, 0.007); armR.add(blade);
  return { root, body, armL, armR };
}

// ---------------------------------------------------------------- effects and markers

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d')!; draw(g);
  return new CanvasTexture(cv);
}
let glowTexture: CanvasTexture | null = null;
export function glowTex(): CanvasTexture {
  if (glowTexture == null) glowTexture = canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  });
  return glowTexture;
}
export function glowSprite(color: number, size: number): Sprite {
  const s = new Sprite(new SpriteMaterial({ map: glowTex(), color, transparent: true, depthWrite: false, blending: AdditiveBlending }));
  s.scale.setScalar(size);
  return s;
}

/** A flat wedge on the ground showing what a foe can see. Points along +Z. */
export function buildSightCone(radius: number, half: number): Mesh {
  const geo = new CircleGeometry(radius, 18, -Math.PI / 2 - half, half * 2);
  geo.rotateX(-Math.PI / 2);
  const m = new Mesh(geo, new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2, depthWrite: false, side: DoubleSide }));
  m.renderOrder = 2;
  return m;
}

/** The battle ring: a glowing wall that rises around a fight, plus its floor circle. Unit radius and height. */
export function buildBattleRing(): { root: Group; wall: Mesh; floor: Mesh } {
  const root = new Group();
  const tex = canvasTex(4, 64, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 64);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0.95)');
    g.fillStyle = gr; g.fillRect(0, 0, 4, 64);
  });
  const geo = new CylinderGeometry(1, 1, 1, 64, 1, true); geo.translate(0, 0.5, 0);
  const wall = new Mesh(geo, new MeshBasicMaterial({ map: tex, color: 0xffc860, transparent: true, depthWrite: false, side: DoubleSide, blending: AdditiveBlending }));
  const floor = new Mesh(new RingGeometry(0.95, 1, 64).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0xffc860, transparent: true, depthWrite: false, blending: AdditiveBlending }));
  wall.renderOrder = floor.renderOrder = 3;
  root.add(wall, floor);
  return { root, wall, floor };
}

/** A ground ring that marks where you sent the hero. */
export function buildTargetMarker(): Mesh {
  const m = new Mesh(new RingGeometry(0.007, 0.0105, 24).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0xffe08a, transparent: true, depthWrite: false }));
  m.renderOrder = 2;
  return m;
}

/** A two-part health bar that faces the viewer. Fill is scaled from the left. */
export function buildBar(color: number, width = 0.03): { root: Group; fill: Sprite } {
  const root = new Group();
  const bg = new Sprite(new SpriteMaterial({ color: 0x1a1418, transparent: true, opacity: 0.8, depthWrite: false }));
  bg.scale.set(width + 0.002, 0.0045, 1);
  const fill = new Sprite(new SpriteMaterial({ color, depthWrite: false }));
  fill.center.set(0, 0.5); fill.position.x = -width / 2; fill.scale.set(width, 0.003, 1);
  bg.renderOrder = 10; fill.renderOrder = 11;
  root.add(bg, fill);
  return { root, fill };
}

const textCache = new Map<string, CanvasTexture>();
/** A cached text texture for floating numbers, icons and alerts. */
export function textTex(text: string, color: string): CanvasTexture {
  const key = text + color;
  let t = textCache.get(key);
  if (t == null) {
    t = canvasTex(256, 96, (g) => {
      g.font = 'bold 64px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,0.75)'; g.strokeText(text, 128, 50);
      g.fillStyle = color; g.fillText(text, 128, 50);
    });
    textCache.set(key, t);
  }
  return t;
}
export function textSprite(): Sprite {
  const s = new Sprite(new SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false }));
  s.renderOrder = 20; s.visible = false;
  return s;
}

/** The projectile for a cast: a bright core inside a coloured glow. */
export function buildBolt(): { root: Object3D; glow: Sprite; core: Sprite } {
  const root = new Group();
  const glow = glowSprite(0xff8a30, 0.03), core = glowSprite(0xffffff, 0.012);
  root.add(glow, core); root.visible = false;
  return { root, glow, core };
}

export const ELEMENT_COLORS: Record<string, number> = { fire: 0xff7a30, water: 0x4ab8ff, earth: 0xd8a050, air: 0xdff6ff };

/** Card art: element name, a simple glyph and the energy cost, on the element's colour. */
const CARD_GLYPHS: Record<string, (g: CanvasRenderingContext2D) => void> = {
  fire: (g) => { g.beginPath(); g.moveTo(80, 70); g.bezierCurveTo(130, 120, 120, 170, 80, 180); g.bezierCurveTo(40, 170, 30, 125, 62, 100); g.bezierCurveTo(66, 125, 78, 128, 80, 70); g.fill(); },
  water: (g) => { g.beginPath(); g.moveTo(80, 70); g.bezierCurveTo(115, 120, 120, 145, 110, 160); g.arc(80, 150, 32, 0.3, Math.PI - 0.3); g.bezierCurveTo(40, 145, 45, 120, 80, 70); g.fill(); },
  earth: (g) => { g.beginPath(); g.moveTo(30, 175); g.lineTo(70, 90); g.lineTo(90, 125); g.lineTo(105, 105); g.lineTo(135, 175); g.closePath(); g.fill(); },
  air: (g) => { g.lineWidth = 9; g.lineCap = 'round'; for (const [y, w] of [[100, 70], [128, 90], [156, 60]] as const) { g.beginPath(); g.moveTo(40, y); g.lineTo(40 + w, y); g.arc(40 + w, y - 12, 12, Math.PI / 2, -Math.PI / 2, true); g.stroke(); } },
  fuse: (g) => { g.lineWidth = 9; g.beginPath(); g.arc(64, 125, 30, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(96, 125, 30, 0, Math.PI * 2); g.stroke(); },
};
export function cardTex(kind: string, label: string, color: string, cost: string): CanvasTexture {
  return canvasTex(160, 240, (g) => {
    const r = 16;
    g.fillStyle = '#1c1a22'; g.beginPath(); g.roundRect(0, 0, 160, 240, r); g.fill();
    g.fillStyle = color; g.beginPath(); g.roundRect(8, 8, 144, 224, r - 4); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); g.roundRect(16, 52, 128, 148, 10); g.fill();
    g.fillStyle = '#fff'; g.strokeStyle = '#fff';
    g.font = 'bold 26px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, 80, 30);
    CARD_GLYPHS[kind]?.(g);
    g.font = 'bold 20px system-ui, sans-serif'; g.fillText(cost, 80, 216);
  });
}
/** A playing card you tap or pinch. Pivot at its bottom edge so it can lift and tilt. */
export function buildCard(kind: string, label: string, color: string, cost: string): { root: Group; face: Mesh; glow: Mesh } {
  const root = new Group();
  const geo = new PlaneGeometry(0.04, 0.06); geo.translate(0, 0.03, 0);
  const face = new Mesh(geo, new MeshBasicMaterial({ map: cardTex(kind, label, color, cost), transparent: true, side: DoubleSide }));
  face.name = `Card-${kind}`;
  const glowGeo = new PlaneGeometry(0.048, 0.068); glowGeo.translate(0, 0.03, -0.0005);
  const glow = new Mesh(glowGeo, new MeshBasicMaterial({ color: 0xfff0a0, transparent: true, opacity: 0, depthWrite: false }));
  root.add(glow, face);
  return { root, face, glow };
}
