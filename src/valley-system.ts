import {
  createSystem,
  Entity,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  RayInteractable,
  Sprite,
  SpriteMaterial,
  UIKit,
  UIKitMLAsset,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { music } from './music.js';
import { Elements, Foe, FoeStates, Hero } from './valley-components.js';
import {
  BRIDGE,
  buildBandit,
  buildBar,
  buildBattleRing,
  buildBolt,
  buildCamp,
  buildHero,
  buildHouse,
  buildScatter,
  buildSightCone,
  buildTargetMarker,
  buildTerrain,
  CAMP,
  ELEMENT_COLORS,
  Figure,
  heightAt,
  HOUSE,
  riverX,
  textSprite,
  textTex,
  VALLEY_D,
  VALLEY_W,
} from './valley-meshes.js';

type Element = (typeof Elements)[keyof typeof Elements];

/** Where the valley sits in the room: a seated player's tabletop, in front of them. */
const VALLEY_ORIGIN = new Vector3(0, 0.72, -0.5);
const HERO_SPEED = 0.07; // m/s on the table
const FOE_SPEED = 0.05;
const SIGHT_RANGE = 0.11;
const SIGHT_HALF_ANGLE = 0.5;
const AMBUSH_RANGE = 0.2;
const MELEE_RANGE = 0.045;
const ALERT_TIME = 0.8;
const RING_HEIGHT = 0.05;
const CAST_COST = 12;
const FUSION_COST = 30;
const CAST_COOLDOWN = 0.5;
const ENERGY_REGEN = 7;
const BOLT_TIME = 0.35;
const CARD_DAMAGE = 22;

/** fire > air > earth > water > fire */
const BEATS: Record<Element, Element> = { fire: 'air', air: 'earth', earth: 'water', water: 'fire' };

interface Fusion {
  name: string;
  element: Element;
  damage: number;
  aoe: boolean;
  heal?: number;
  slow?: number;
}
/** Two different element cards fused together. Keys are the two elements in alphabetical order. */
const FUSIONS: Record<string, Fusion> = {
  'earth+fire': { name: 'Lava', element: 'fire', damage: 20, aoe: true },
  'air+water': { name: 'Storm', element: 'air', damage: 18, aoe: true },
  'fire+water': { name: 'Steam', element: 'water', damage: 0, aoe: false, heal: 35 },
  'earth+water': { name: 'Mud', element: 'earth', damage: 12, aoe: true, slow: 2.5 },
  'air+fire': { name: 'Blaze', element: 'fire', damage: 48, aoe: false },
  'air+earth': { name: 'Dust devil', element: 'air', damage: 40, aoe: false },
};
const fusionKey = (a: Element, b: Element) => (a < b ? `${a}+${b}` : `${b}+${a}`);

const QUESTS: [string, string][] = [
  ['CLEAR THE ROAD', 'Two air bandits patrol past the bridge. Point and pinch (or click) the ground to walk. Get spotted, or sneak up and strike first.'],
  ['CLEAR THE BANDIT CAMP', 'The camp at the far end of the road has two air bandits and an earth brute. Fire beats air; air beats earth. Try Fuse: earth + fire makes Lava.'],
  ['GO HOME', 'The valley road is safe. Walk back to your house by the lantern post.'],
  ['THE VALLEY IS SAFE', 'For now. More of Lantern Valley is coming: mounts, fishing, the world boss and the realm gates.'],
];

interface FoeView {
  fig: Figure;
  cone: Mesh;
  coneMat: MeshBasicMaterial;
  bar: { root: Group; fill: Sprite };
  icon: Sprite;
  phase: number;
  attackT: number;
  swing: number;
  fall: number;
  facing: number;
}
interface Bolt {
  root: Object3D;
  glow: Sprite;
  active: boolean;
  t: number;
  from: Vector3;
  to: Vector3;
  target: Entity | null;
  aoe: boolean;
  damage: number;
  element: Element;
  ambush: boolean;
}
interface Floater {
  sprite: Sprite;
  t: number;
  pos: Vector3;
}

export class ValleySystem extends createSystem({
  heroes: { required: [Hero] },
  foes: { required: [Foe] },
}) {
  private rootObj!: Group;
  private rootEntity!: Entity;
  private hero!: Entity;
  private heroFig!: ReturnType<typeof buildHero>;
  private heroBar!: { root: Group; fill: Sprite };
  private heroPos = new Vector3();
  private heroDir = 0;
  private path: Vector3[] = [new Vector3(), new Vector3(), new Vector3()];
  private pathLen = 0;
  private pathIndex = 0;
  private walking = false;
  private marker!: Mesh;
  private markerT = 0;
  private views = new Map<Entity, FoeView>();
  private ring!: ReturnType<typeof buildBattleRing>;
  private ringCenter = new Vector3();
  private ringRadius = 0.1;
  private ringUp = 0;
  private fightGroup = -1;
  private alertGroup = -1;
  private alertT = 0;
  private cleared = new Set<number>();
  private flame!: Mesh;
  private bolts: Bolt[] = [];
  private floaters: Floater[] = [];
  private floaterIndex = 0;
  private cooldown = 0;
  private hurtT = 0;
  private fuseArmed = false;
  private fuseFirst: Element | null = null;
  private learned = new Set<string>();
  private quest = 0;
  private status = '';
  private hudTimer = 0;
  private lastStats = '';
  private time = 0;
  /** Simulation steps per frame; the test hook raises it on slow software-rendered browsers. */
  private timeScale = 1;
  private questTitle?: UIKit.Text;
  private questBody?: UIKit.Text;
  private statsText?: UIKit.Text;
  private statusText?: UIKit.Text;
  private fuseLabel?: UIKit.Text;
  private v1 = new Vector3();
  private v2 = new Vector3();

  init(): void {
    this.buildWorld();
    this.bindPanel();
    this.setQuest(0);
    this.say('Bandits patrol past the bridge. Stay out of their sight cones, or fight.');
    if (!this.world.xrEnabled || this.world.visibilityState.peek() === VisibilityState.NonImmersive) {
      // On a flat screen, look down at the table the way a seated player would.
      this.world.camera.rotation.set(-0.62, 0, 0);
    }
    // A small test hook for the desktop and the CLI: walk, cast, fuse.
    (window as unknown as { valley: unknown }).valley = {
      walkTo: (x: number, z: number) => this.walkTo(x, z),
      cast: (e: Element) => this.onCard(e),
      fuse: () => this.toggleFuse(),
      setTimeScale: (n: number) => { this.timeScale = Math.max(1, Math.min(40, Math.round(n))); },
      state: () => ({ hero: this.heroPos.toArray(), hp: this.hero.getValue(Hero, 'hp'), quest: this.quest, fight: this.fightGroup, alert: this.alertGroup, status: this.status }),
    };
  }

  // ---------------------------------------------------------------- world setup

  private buildWorld(): void {
    const rootObj = new Group();
    rootObj.name = 'LanternValley';
    rootObj.position.copy(VALLEY_ORIGIN);
    const root = this.world.createTransformEntity(rootObj);
    this.rootObj = rootObj;
    this.rootEntity = root;

    const { root: land, ground } = buildTerrain();
    land.remove(ground);
    this.world.createTransformEntity(land, { parent: root });
    const groundEntity = this.world.createTransformEntity(ground, { parent: root });
    groundEntity.addComponent(RayInteractable);
    const onGround = (e: { point: Vector3 }) => {
      this.v1.copy(e.point); this.rootObj.worldToLocal(this.v1);
      this.walkTo(this.v1.x, this.v1.z);
    };
    const target = ground as unknown as { addEventListener(t: string, f: (e: { point: Vector3 }) => void): void; removeEventListener(t: string, f: (e: { point: Vector3 }) => void): void };
    target.addEventListener('pointerdown', onGround);
    this.cleanupFuncs.push(() => target.removeEventListener('pointerdown', onGround));

    this.world.createTransformEntity(buildScatter(), { parent: root });
    const house = buildHouse();
    house.position.set(HOUSE.x, heightAt(HOUSE.x, HOUSE.z), HOUSE.z);
    house.rotation.y = 0.5;
    this.world.createTransformEntity(house, { parent: root });
    const camp = buildCamp();
    camp.root.position.set(CAMP.x, heightAt(CAMP.x, CAMP.z), CAMP.z);
    this.flame = camp.flame;
    this.world.createTransformEntity(camp.root, { parent: root });

    this.marker = buildTargetMarker(); this.marker.visible = false; rootObj.add(this.marker);
    this.ring = buildBattleRing(); this.ring.root.visible = false; rootObj.add(this.ring.root);

    // the hero
    this.heroFig = buildHero();
    this.hero = this.world.createTransformEntity(this.heroFig.root, { parent: root });
    this.hero.object3D!.name = 'Hero';
    this.hero.addComponent(Hero, { hp: 100, maxHp: 100, energy: 100, xp: 0, level: 1, gold: 0 });
    this.heroBar = buildBar(0x6adf6a, 0.032); this.heroBar.root.position.y = 0.05; this.heroFig.root.add(this.heroBar.root);
    this.heroPos.set(HOUSE.doorX + 0.03, 0, HOUSE.doorZ - 0.01);

    // the foes: group 0 is the road patrol, group 1 the camp
    this.spawnFoe(0, 'air', 0.16, -0.075, 0.05, 0, 40, 7, 2.2, 40, false);
    this.spawnFoe(0, 'air', 0.19, -0.115, 0.04, 0, 40, 7, 2.4, 40, false);
    this.spawnFoe(1, 'air', CAMP.x - 0.05, CAMP.z + 0.035, 0, 2.4, 45, 8, 2.2, 45, false);
    this.spawnFoe(1, 'air', CAMP.x + 0.05, CAMP.z + 0.025, 0, -2.6, 45, 8, 2.3, 45, false);
    this.spawnFoe(1, 'earth', CAMP.x + 0.0, CAMP.z - 0.045, 0, 0.3, 90, 14, 3.0, 80, true);

    for (let i = 0; i < 6; i++) {
      const b = buildBolt(); rootObj.add(b.root);
      this.bolts.push({ root: b.root, glow: b.glow, active: false, t: 0, from: new Vector3(), to: new Vector3(), target: null, aoe: false, damage: 0, element: 'fire', ambush: false });
    }
    for (let i = 0; i < 10; i++) {
      const s = textSprite(); rootObj.add(s);
      this.floaters.push({ sprite: s, t: 1, pos: new Vector3() });
    }
  }

  private spawnFoe(group: number, element: Element, x: number, z: number, patrol: number, facing: number, hp: number, damage: number, attackEvery: number, xp: number, brute: boolean): void {
    const fig = buildBandit(brute);
    fig.root.position.set(x, heightAt(x, z), z);
    const entity = this.world.createTransformEntity(fig.root, { parent: this.rootEntity });
    entity.addComponent(Foe, { group, element, state: FoeStates.Patrol, hp, maxHp: hp, homeX: x, homeZ: z, patrol, facing, damage, attackEvery, xp });
    fig.root.name = `Foe-${group}-${element}`;
    const cone = buildSightCone(SIGHT_RANGE, SIGHT_HALF_ANGLE);
    this.rootObj.add(cone);
    const bar = buildBar(0xe2504a, brute ? 0.036 : 0.028); bar.root.position.y = brute ? 0.056 : 0.045; bar.root.visible = false; fig.root.add(bar.root);
    const icon = textSprite(); icon.position.y = brute ? 0.07 : 0.058; icon.scale.set(0.03, 0.011, 1); fig.root.add(icon);
    this.views.set(entity, { fig, cone, coneMat: cone.material as MeshBasicMaterial, bar, icon, phase: x * 13 + z * 7, attackT: attackEvery, swing: 0, fall: 0, facing });
  }

  private bindPanel(): void {
    const panel = this.world.getSceneObject<UIKitMLAsset>('hud-panel');
    if (panel == null) return;
    this.questTitle = panel.getElementById<UIKit.Text>('quest-title') ?? undefined;
    this.questBody = panel.getElementById<UIKit.Text>('quest-body') ?? undefined;
    this.statsText = panel.getElementById<UIKit.Text>('stats-text') ?? undefined;
    this.statusText = panel.getElementById<UIKit.Text>('status-text') ?? undefined;
    this.fuseLabel = panel.getElementById<UIKit.Text>('fuse-label') ?? undefined;
    const bind = (id: string, fn: () => void) => {
      const el = panel.getElementById(id);
      if (el == null) return;
      el.name = id;
      el.addEventListener('click', fn);
      this.cleanupFuncs.push(() => el.removeEventListener('click', fn));
    };
    bind('card-fire', () => this.onCard('fire'));
    bind('card-water', () => this.onCard('water'));
    bind('card-earth', () => this.onCard('earth'));
    bind('card-air', () => this.onCard('air'));
    bind('fuse-button', () => this.toggleFuse());
    bind('restart-button', () => this.restart());

    const onFirstGesture = () => music.start();
    window.addEventListener('pointerdown', onFirstGesture, { once: true });
    this.cleanupFuncs.push(
      () => window.removeEventListener('pointerdown', onFirstGesture),
      this.world.visibilityState.subscribe((state) => {
        if (state === VisibilityState.Visible) music.start();
        else if (state === VisibilityState.VisibleBlurred) music.stop();
      }),
    );
    const xrButton = panel.getElementById('xr-button');
    if (xrButton == null) return;
    if (!this.world.xrEnabled) {
      xrButton.setProperties({ display: 'none' });
      return;
    }
    const launchXR = () => {
      music.start();
      this.world.launchXR();
    };
    xrButton.addEventListener('click', launchXR);
    this.cleanupFuncs.push(
      () => xrButton.removeEventListener('click', launchXR),
      this.world.visibilityState.subscribe((state) => {
        xrButton.setProperties({ display: state === VisibilityState.NonImmersive ? 'flex' : 'none' });
      }),
    );
  }

  // ---------------------------------------------------------------- input

  /** Send the hero to a valley-local point, crossing the river by the bridge. */
  walkTo(x: number, z: number): void {
    const hx = VALLEY_W / 2 - 0.02, hz = VALLEY_D / 2 - 0.02;
    x = Math.max(-hx, Math.min(hx, x)); z = Math.max(-hz, Math.min(hz, z));
    const rxT = riverX(z);
    if (Math.abs(x - rxT) < 0.028 && Math.abs(z - BRIDGE.z) > 0.016) x = rxT + Math.sign(x - rxT || 1) * 0.028;
    const sideHero = Math.sign(this.heroPos.x - riverX(this.heroPos.z));
    const sideTarget = Math.sign(x - riverX(z));
    const onBridge = Math.abs(this.heroPos.z - BRIDGE.z) < 0.016 && Math.abs(this.heroPos.x - BRIDGE.x) < BRIDGE.half + 0.005;
    this.pathLen = 0;
    if (sideHero !== sideTarget && !onBridge) {
      this.path[this.pathLen++].set(BRIDGE.x + sideHero * (BRIDGE.half + 0.005), 0, BRIDGE.z);
      this.path[this.pathLen++].set(BRIDGE.x + sideTarget * (BRIDGE.half + 0.005), 0, BRIDGE.z);
    }
    this.path[this.pathLen++].set(x, 0, z);
    this.pathIndex = 0;
    this.walking = true;
    this.marker.position.set(x, heightAt(x, z) + 0.002, z);
    this.markerT = 1;
  }

  private toggleFuse(): void {
    this.fuseArmed = !this.fuseArmed;
    this.fuseFirst = null;
    this.fuseLabel?.setProperties({ text: this.fuseArmed ? 'Pick two' : 'Fuse' });
    if (this.fuseArmed) this.say('Fuse: tap two different element cards.');
  }

  private onCard(element: Element): void {
    if (this.fuseArmed) {
      if (this.fuseFirst == null) { this.fuseFirst = element; this.say(`Fusing ${element} + ...`); return; }
      if (this.fuseFirst === element) { this.toggleFuse(); this.say('Fusion cancelled.'); return; }
      const key = fusionKey(this.fuseFirst, element);
      this.toggleFuse();
      this.castFusion(FUSIONS[key], key);
      return;
    }
    this.castCard(element);
  }

  private canCast(cost: number): boolean {
    if (this.cooldown > 0) return false;
    const energy = this.hero.getValue(Hero, 'energy') ?? 0;
    if (energy < cost) { this.say('Not enough energy. Wait a moment.'); return false; }
    return true;
  }

  /** The foe a cast goes to: the nearest living fighter, or an unaware foe in ambush range. */
  private pickTarget(): { target: Entity | null; ambush: boolean } {
    let best: Entity | null = null, bestD = Infinity, ambush = false;
    for (const e of this.queries.foes.entities) {
      const st = e.getValue(Foe, 'state');
      if (st === FoeStates.Down) continue;
      const g = e.getValue(Foe, 'group') ?? 0;
      const o = this.views.get(e)!.fig.root.position;
      const d = Math.hypot(o.x - this.heroPos.x, o.z - this.heroPos.z);
      if (this.fightGroup >= 0) {
        if (g === this.fightGroup && d < bestD) { best = e; bestD = d; }
      } else if (st === FoeStates.Patrol && d < AMBUSH_RANGE && d < bestD) { best = e; bestD = d; ambush = true; }
    }
    return { target: best, ambush };
  }

  private castCard(element: Element): void {
    if (!this.canCast(CAST_COST)) return;
    const { target, ambush } = this.pickTarget();
    if (target == null) { this.say('No foe in reach. Cards work in a fight, or up close for an ambush.'); return; }
    this.spend(CAST_COST);
    if (ambush) this.startFight(target.getValue(Foe, 'group') ?? 0, true);
    this.fire(target, element, CARD_DAMAGE, false, ambush);
  }

  private castFusion(f: Fusion, key: string): void {
    if (!this.canCast(FUSION_COST)) return;
    const first = !this.learned.has(key);
    if (f.heal) {
      this.spend(FUSION_COST);
      const hp = Math.min(this.hero.getValue(Hero, 'maxHp')!, this.hero.getValue(Hero, 'hp')! + f.heal);
      this.hero.setValue(Hero, 'hp', hp);
      this.float(this.heroPos.x, 0.05, this.heroPos.z, `+${f.heal}`, '#7dff9a');
      this.learned.add(key);
      this.say(first ? `New fusion: ${f.name}! It heals you.` : `${f.name}: healed ${f.heal}.`);
      return;
    }
    const { target, ambush } = this.pickTarget();
    if (target == null) { this.say(`${f.name} needs a foe in reach.`); return; }
    this.spend(FUSION_COST);
    if (ambush) this.startFight(target.getValue(Foe, 'group') ?? 0, true);
    this.learned.add(key);
    this.say(first ? `New fusion: ${f.name}!` : `${f.name}!`);
    if (f.aoe) {
      for (const e of this.queries.foes.entities) {
        if ((e.getValue(Foe, 'group') ?? -1) !== this.fightGroup || e.getValue(Foe, 'state') === FoeStates.Down) continue;
        this.fire(e, f.element, f.damage, true, ambush);
        if (f.slow) this.views.get(e)!.attackT += f.slow;
      }
    } else this.fire(target, f.element, f.damage, false, ambush);
  }

  private spend(cost: number): void {
    this.hero.setValue(Hero, 'energy', (this.hero.getValue(Hero, 'energy') ?? 0) - cost);
    this.cooldown = CAST_COOLDOWN;
    this.heroFig.armL.rotation.x = -2.2;
  }

  private fire(target: Entity, element: Element, damage: number, aoe: boolean, ambush: boolean): void {
    const b = this.bolts.find((x) => !x.active);
    if (b == null) return;
    b.active = true; b.t = 0; b.target = target; b.element = element; b.damage = damage; b.aoe = aoe; b.ambush = ambush;
    b.from.set(this.heroPos.x, heightAt(this.heroPos.x, this.heroPos.z) + 0.02, this.heroPos.z);
    b.glow.material.color.setHex(ELEMENT_COLORS[element]);
    b.root.visible = true;
  }

  private restart(): void {
    for (const e of this.queries.foes.entities) {
      e.setValue(Foe, 'state', FoeStates.Patrol);
      e.setValue(Foe, 'hp', e.getValue(Foe, 'maxHp')!);
      const v = this.views.get(e)!;
      v.fall = 0; v.fig.root.rotation.set(0, 0, 0);
      v.fig.root.position.set(e.getValue(Foe, 'homeX')!, 0, e.getValue(Foe, 'homeZ')!);
    }
    this.hero.setValue(Hero, 'hp', 100); this.hero.setValue(Hero, 'maxHp', 100); this.hero.setValue(Hero, 'energy', 100);
    this.hero.setValue(Hero, 'xp', 0); this.hero.setValue(Hero, 'level', 1); this.hero.setValue(Hero, 'gold', 0);
    this.heroPos.set(HOUSE.doorX + 0.03, 0, HOUSE.doorZ - 0.01);
    this.walking = false; this.fightGroup = -1; this.alertGroup = -1; this.ringUp = 0;
    this.cleared.clear(); this.learned.clear();
    if (this.fuseArmed) this.toggleFuse();
    this.setQuest(0);
    this.say('A new day in Lantern Valley.');
  }

  // ---------------------------------------------------------------- fights

  private startFight(group: number, ambush: boolean): void {
    this.fightGroup = group;
    this.alertGroup = -1;
    let cx = this.heroPos.x, cz = this.heroPos.z, n = 1;
    for (const e of this.queries.foes.entities) {
      if ((e.getValue(Foe, 'group') ?? -1) !== group || e.getValue(Foe, 'state') === FoeStates.Down) continue;
      e.setValue(Foe, 'state', FoeStates.Fight);
      const p = this.views.get(e)!.fig.root.position; cx += p.x; cz += p.z; n++;
      this.views.get(e)!.attackT = (e.getValue(Foe, 'attackEvery') ?? 2) * (ambush ? 1.6 : 1);
    }
    cx /= n; cz /= n;
    let r = 0.08;
    for (const e of this.queries.foes.entities) {
      if ((e.getValue(Foe, 'group') ?? -1) !== group) continue;
      const p = this.views.get(e)!.fig.root.position; r = Math.max(r, Math.hypot(p.x - cx, p.z - cz) + 0.04);
    }
    r = Math.max(r, Math.hypot(this.heroPos.x - cx, this.heroPos.z - cz) + 0.04);
    this.ringCenter.set(cx, heightAt(cx, cz), cz);
    this.ringRadius = Math.min(0.16, r);
    this.walking = false;
    this.say(ambush ? 'Ambush! Your first card hits for 1.5x.' : 'Fight! Walk out of the ring to run away.');
  }

  private endFight(won: boolean): void {
    const group = this.fightGroup;
    this.fightGroup = -1;
    if (won) {
      this.cleared.add(group);
      let xp = 0, gold = 0;
      for (const e of this.queries.foes.entities) if ((e.getValue(Foe, 'group') ?? -1) === group) { xp += e.getValue(Foe, 'xp') ?? 0; gold += 8 + Math.round((e.getValue(Foe, 'maxHp') ?? 0) / 10); }
      this.gainXp(xp, gold);
      if (group === 0 && this.quest === 0) this.setQuest(1);
      else if (group === 1 && this.quest <= 1) this.setQuest(2);
      return;
    }
    // ran away or knocked out: the survivors walk home and heal
    for (const e of this.queries.foes.entities) {
      if ((e.getValue(Foe, 'group') ?? -1) !== group || e.getValue(Foe, 'state') === FoeStates.Down) continue;
      e.setValue(Foe, 'state', FoeStates.Patrol);
      e.setValue(Foe, 'hp', e.getValue(Foe, 'maxHp')!);
    }
  }

  private gainXp(xp: number, gold: number): void {
    let total = (this.hero.getValue(Hero, 'xp') ?? 0) + xp;
    let level = this.hero.getValue(Hero, 'level') ?? 1;
    let leveled = false;
    while (total >= level * 100) { total -= level * 100; level++; leveled = true; }
    this.hero.setValue(Hero, 'xp', total);
    this.hero.setValue(Hero, 'gold', (this.hero.getValue(Hero, 'gold') ?? 0) + gold);
    if (leveled) {
      const maxHp = 100 + (level - 1) * 15;
      this.hero.setValue(Hero, 'level', level); this.hero.setValue(Hero, 'maxHp', maxHp); this.hero.setValue(Hero, 'hp', maxHp);
      this.say(`Victory! +${xp} XP, +${gold} gold. Level ${level}: health up and fully healed.`);
    } else this.say(`Victory! +${xp} XP, +${gold} gold.`);
    this.float(this.heroPos.x, 0.06, this.heroPos.z, `+${xp} XP`, '#9fe0ff');
  }

  private damageFoe(e: Entity, element: Element, base: number, ambush: boolean): void {
    if (e.getValue(Foe, 'state') === FoeStates.Down) return;
    const fe = (e.getValue(Foe, 'element') ?? 'air') as Element;
    const mult = BEATS[element] === fe ? 2 : BEATS[fe] === element ? 0.5 : 1;
    const dmg = Math.round(base * mult * (ambush ? 1.5 : 1));
    const hp = (e.getValue(Foe, 'hp') ?? 0) - dmg;
    e.setValue(Foe, 'hp', Math.max(0, hp));
    const p = this.views.get(e)!.fig.root.position;
    this.float(p.x, p.y + 0.06, p.z, mult > 1 ? `${dmg} x2` : mult < 1 ? `${dmg} weak` : `${dmg}`, mult > 1 ? '#ffb050' : mult < 1 ? '#c0c0c0' : '#ffffff');
    if (hp <= 0) e.setValue(Foe, 'state', FoeStates.Down);
  }

  private hurtHero(dmg: number): void {
    const hp = (this.hero.getValue(Hero, 'hp') ?? 0) - dmg;
    this.hero.setValue(Hero, 'hp', Math.max(0, hp));
    this.hurtT = 0.35;
    this.float(this.heroPos.x, 0.055, this.heroPos.z, `-${dmg}`, '#ff6a60');
    if (hp <= 0) {
      this.endFight(false);
      this.hero.setValue(Hero, 'hp', this.hero.getValue(Hero, 'maxHp')!);
      this.hero.setValue(Hero, 'energy', 100);
      this.heroPos.set(HOUSE.doorX + 0.03, 0, HOUSE.doorZ - 0.01);
      this.walking = false;
      this.say('You were knocked out and woke up at home. Try a card the enemy is weak to.');
    }
  }

  private float(x: number, y: number, z: number, text: string, color: string): void {
    const f = this.floaters[this.floaterIndex++ % this.floaters.length];
    f.t = 0; f.pos.set(x, heightAt(x, z) + y, z);
    (f.sprite.material as SpriteMaterial).map = textTex(text, color);
    (f.sprite.material as SpriteMaterial).needsUpdate = true;
    f.sprite.visible = true;
  }

  // ---------------------------------------------------------------- the frame

  update(delta: number): void {
    if (this.world.visibilityState.peek() === VisibilityState.VisibleBlurred) return;
    const dt = Math.min(delta, 0.05);
    const kb = this.world.input.keyboard;
    if (kb.getKeyDown('Digit1')) this.onCard('fire');
    if (kb.getKeyDown('Digit2')) this.onCard('water');
    if (kb.getKeyDown('Digit3')) this.onCard('earth');
    if (kb.getKeyDown('Digit4')) this.onCard('air');
    if (kb.getKeyDown('KeyF')) this.toggleFuse();
    for (let i = 0; i < this.timeScale; i++) this.tick(dt);
  }

  private tick(dt: number): void {
    this.time += dt;
    const t = this.time;

    this.cooldown = Math.max(0, this.cooldown - dt);
    const maxHp = this.hero.getValue(Hero, 'maxHp') ?? 100;
    this.hero.setValue(Hero, 'energy', Math.min(100, (this.hero.getValue(Hero, 'energy') ?? 0) + ENERGY_REGEN * dt));

    this.updateHero(dt, t);
    this.updateFoes(dt, t);
    this.updateFight(dt);
    this.updateBolts(dt);

    // floaters drift up and fade
    for (const f of this.floaters) {
      if (!f.sprite.visible) continue;
      f.t += dt;
      const k = f.t / 1.1;
      f.sprite.position.set(f.pos.x, f.pos.y + 0.025 * k, f.pos.z);
      f.sprite.scale.set(0.045, 0.017, 1);
      (f.sprite.material as SpriteMaterial).opacity = 1 - Math.max(0, (k - 0.6) / 0.4);
      if (k >= 1) f.sprite.visible = false;
    }
    // the target marker fades
    this.markerT = Math.max(0, this.markerT - dt * 0.8);
    this.marker.visible = this.markerT > 0.01;
    (this.marker.material as MeshBasicMaterial).opacity = this.markerT;
    this.marker.scale.setScalar(1 + 0.3 * (1 - this.markerT));
    // camp fire flicker
    this.flame.scale.set(1, 0.85 + 0.25 * Math.sin(t * 13) * Math.sin(t * 7.3), 1);

    // hero health bar and hurt flash
    const hp = this.hero.getValue(Hero, 'hp') ?? 0;
    this.heroBar.root.visible = this.fightGroup >= 0 || hp < maxHp;
    this.heroBar.fill.scale.x = 0.032 * Math.max(0.001, hp / maxHp);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.heroFig.body.position.x = this.hurtT > 0 ? 0.002 * Math.sin(t * 90) : 0;

    // quest 2: walk home
    if (this.quest === 2 && Math.hypot(this.heroPos.x - HOUSE.doorX, this.heroPos.z - HOUSE.doorZ) < 0.05) {
      this.setQuest(3);
      this.say('Home. The lantern is lit and the valley is quiet.');
    }

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) { this.hudTimer = 0.2; this.refreshStats(); }
  }

  private updateHero(dt: number, t: number): void {
    let moving = false;
    if (this.walking && this.pathIndex < this.pathLen) {
      const tgt = this.path[this.pathIndex];
      const dx = tgt.x - this.heroPos.x, dz = tgt.z - this.heroPos.z, d = Math.hypot(dx, dz);
      const step = HERO_SPEED * dt;
      if (d <= step) {
        this.heroPos.x = tgt.x; this.heroPos.z = tgt.z; this.pathIndex++;
        if (this.pathIndex >= this.pathLen) this.walking = false;
      } else {
        this.heroPos.x += dx / d * step; this.heroPos.z += dz / d * step;
        this.heroDir = Math.atan2(dx, dz);
        moving = true;
      }
    }
    if (this.fightGroup >= 0 && !moving) {
      // face the nearest foe while fighting
      const { target } = this.pickTarget();
      if (target) { const p = this.views.get(target)!.fig.root.position; this.heroDir = Math.atan2(p.x - this.heroPos.x, p.z - this.heroPos.z); }
    }
    const onBridge = Math.abs(this.heroPos.z - BRIDGE.z) < 0.016 && Math.abs(this.heroPos.x - BRIDGE.x) < BRIDGE.half + 0.006;
    const y = onBridge ? 0.006 : heightAt(this.heroPos.x, this.heroPos.z);
    const r = this.heroFig.root;
    r.position.set(this.heroPos.x, y, this.heroPos.z);
    r.rotation.y = this.heroDir;
    this.heroFig.body.position.y = moving ? 0.0015 * Math.abs(Math.sin(t * 14)) : 0;
    this.heroFig.armR.rotation.x = moving ? 0.6 * Math.sin(t * 14) : 0;
    this.heroFig.armL.rotation.x += ((-0.5) - this.heroFig.armL.rotation.x) * Math.min(1, dt * 6);
  }

  private updateFoes(dt: number, t: number): void {
    for (const e of this.queries.foes.entities) {
      const v = this.views.get(e)!;
      const st = e.getValue(Foe, 'state');
      const group = e.getValue(Foe, 'group') ?? 0;
      const homeX = e.getValue(Foe, 'homeX') ?? 0, homeZ = e.getValue(Foe, 'homeZ') ?? 0;
      const patrol = e.getValue(Foe, 'patrol') ?? 0;
      const root = v.fig.root;
      let moving = false;
      if (st === FoeStates.Down) {
        v.fall = Math.min(1, v.fall + dt * 3);
        root.rotation.x = -Math.PI / 2 * v.fall;
        v.bar.root.visible = false; v.cone.visible = false; v.icon.visible = false;
        continue;
      }
      v.fall = 0; root.rotation.x = 0;
      if (st === FoeStates.Fight) {
        // close in on the hero, spread around them, and swing on a timer
        const a = v.phase + Math.atan2(root.position.x - this.heroPos.x, root.position.z - this.heroPos.z) * 0.2;
        const tx = this.heroPos.x + Math.sin(a) * MELEE_RANGE * 0.9, tz = this.heroPos.z + Math.cos(a) * MELEE_RANGE * 0.9;
        const dx = tx - root.position.x, dz = tz - root.position.z, d = Math.hypot(dx, dz);
        if (d > 0.004) { const s = Math.min(d, FOE_SPEED * dt); root.position.x += dx / d * s; root.position.z += dz / d * s; moving = true; }
        v.facing = Math.atan2(this.heroPos.x - root.position.x, this.heroPos.z - root.position.z);
        const dist = Math.hypot(this.heroPos.x - root.position.x, this.heroPos.z - root.position.z);
        if (dist < MELEE_RANGE + 0.015) {
          v.attackT -= dt;
          if (v.attackT <= 0) {
            v.attackT = e.getValue(Foe, 'attackEvery') ?? 2.2;
            v.swing = 1;
            this.hurtHero(e.getValue(Foe, 'damage') ?? 7);
            if (this.fightGroup < 0) continue;
          }
        }
      } else {
        // patrol back and forth, or stand and look around; walk home after a fight
        const px = homeX + patrol * Math.sin(t * 0.55 + v.phase), pz = homeZ;
        const dx = px - root.position.x, dz = pz - root.position.z, d = Math.hypot(dx, dz);
        if (d > 0.003) {
          const s = Math.min(d, FOE_SPEED * dt);
          root.position.x += dx / d * s; root.position.z += dz / d * s; moving = true;
          v.facing = Math.atan2(dx, dz);
        } else if (patrol === 0) v.facing = (e.getValue(Foe, 'facing') ?? 0) + 0.7 * Math.sin(t * 0.45 + v.phase);
        if (st === FoeStates.Alert) v.facing = Math.atan2(this.heroPos.x - root.position.x, this.heroPos.z - root.position.z);
        // can it see the hero?
        if (st === FoeStates.Patrol && this.fightGroup < 0 && this.alertGroup < 0 && !this.cleared.has(group)) {
          const hx = this.heroPos.x - root.position.x, hz = this.heroPos.z - root.position.z, hd = Math.hypot(hx, hz);
          let da = Math.atan2(hx, hz) - v.facing; da = Math.atan2(Math.sin(da), Math.cos(da));
          if (hd < SIGHT_RANGE && Math.abs(da) < SIGHT_HALF_ANGLE) this.spot(group);
        }
      }
      root.position.y = heightAt(root.position.x, root.position.z);
      root.rotation.y = v.facing;
      v.fig.body.position.y = moving ? 0.0012 * Math.abs(Math.sin(t * 15 + v.phase)) : 0;
      v.swing = Math.max(0, v.swing - dt * 3);
      v.fig.armR.rotation.x = -2.2 * Math.sin(Math.PI * v.swing) + (moving ? 0.5 * Math.sin(t * 15) : 0);
      // sight cone, alert icon, health bar
      const showCone = st === FoeStates.Patrol || st === FoeStates.Alert;
      v.cone.visible = showCone && this.fightGroup < 0;
      v.cone.position.set(root.position.x, root.position.y + 0.003, root.position.z);
      v.cone.rotation.y = v.facing;
      v.coneMat.color.setHex(st === FoeStates.Alert ? (this.alertT > ALERT_TIME * 0.5 ? 0xff3a2a : 0xffd23a) : 0xffffff);
      v.coneMat.opacity = st === FoeStates.Alert ? 0.35 : 0.16;
      v.icon.visible = st === FoeStates.Alert;
      if (v.icon.visible) (v.icon.material as SpriteMaterial).map = this.alertT > ALERT_TIME * 0.5 ? textTex('!', '#ff5a4a') : textTex('?', '#ffe27a');
      const fhp = (e.getValue(Foe, 'hp') ?? 0) / (e.getValue(Foe, 'maxHp') ?? 1);
      v.bar.root.visible = st === FoeStates.Fight;
      v.bar.fill.scale.x = (group === 1 && e.getValue(Foe, 'element') === 'earth' ? 0.036 : 0.028) * Math.max(0.001, fhp);
    }
  }

  private spot(group: number): void {
    this.alertGroup = group;
    this.alertT = 0;
    this.walking = false;
    for (const e of this.queries.foes.entities) if ((e.getValue(Foe, 'group') ?? -1) === group && e.getValue(Foe, 'state') === FoeStates.Patrol) e.setValue(Foe, 'state', FoeStates.Alert);
    this.say('Spotted!');
  }

  private updateFight(dt: number): void {
    if (this.alertGroup >= 0) {
      this.alertT += dt;
      if (this.alertT >= ALERT_TIME) this.startFight(this.alertGroup, false);
    }
    if (this.fightGroup >= 0) {
      // won?
      let alive = 0;
      for (const e of this.queries.foes.entities) if ((e.getValue(Foe, 'group') ?? -1) === this.fightGroup && e.getValue(Foe, 'state') !== FoeStates.Down) alive++;
      if (alive === 0) this.endFight(true);
      else if (Math.hypot(this.heroPos.x - this.ringCenter.x, this.heroPos.z - this.ringCenter.z) > this.ringRadius + 0.01) {
        this.endFight(false);
        this.say('You ran out of the ring and got away. They will heal up.');
      }
    }
    const want = this.fightGroup >= 0 ? 1 : 0;
    this.ringUp += (want - this.ringUp) * Math.min(1, dt * 4);
    const ring = this.ring;
    ring.root.visible = this.ringUp > 0.01;
    ring.root.position.copy(this.ringCenter);
    ring.wall.scale.set(this.ringRadius, RING_HEIGHT * this.ringUp, this.ringRadius);
    ring.floor.scale.setScalar(this.ringRadius);
    (ring.wall.material as MeshBasicMaterial).opacity = 0.8 * this.ringUp;
    (ring.floor.material as MeshBasicMaterial).opacity = 0.9 * this.ringUp;
  }

  private updateBolts(dt: number): void {
    for (const b of this.bolts) {
      if (!b.active) continue;
      b.t += dt / BOLT_TIME;
      if (b.target) { const p = this.views.get(b.target)!.fig.root.position; b.to.set(p.x, p.y + 0.018, p.z); }
      const k = Math.min(1, b.t);
      b.root.position.lerpVectors(b.from, b.to, k);
      b.root.position.y += 0.03 * Math.sin(Math.PI * k);
      if (b.t >= 1) {
        b.active = false; b.root.visible = false;
        if (b.target) this.damageFoe(b.target, b.element, b.damage, b.ambush);
      }
    }
  }

  // ---------------------------------------------------------------- HUD

  private setQuest(q: number): void {
    this.quest = q;
    this.questTitle?.setProperties({ text: QUESTS[q][0] });
    this.questBody?.setProperties({ text: QUESTS[q][1] });
  }

  private say(text: string): void {
    this.status = text;
    this.statusText?.setProperties({ text });
  }

  private refreshStats(): void {
    const h = this.hero;
    const level = h.getValue(Hero, 'level') ?? 1;
    const s = `Lv ${level}   HP ${Math.ceil(h.getValue(Hero, 'hp') ?? 0)}/${h.getValue(Hero, 'maxHp')}   Energy ${Math.floor(h.getValue(Hero, 'energy') ?? 0)}   XP ${Math.floor(h.getValue(Hero, 'xp') ?? 0)}/${level * 100}   Gold ${h.getValue(Hero, 'gold')}`;
    if (s !== this.lastStats) { this.lastStats = s; this.statsText?.setProperties({ text: s }); }
  }
}
