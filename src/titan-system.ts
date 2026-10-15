import {
  createSystem,
  Entity,
  Grabbed,
  Group,
  Mesh,
  Object3D,
  OneHandGrabbable,
  UIKit,
  UIKitMLAsset,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import {
  DriveLever,
  LeverSides,
  Part,
  PartKinds,
  PartSocket,
} from './titan-components.js';
import {
  buildArm,
  buildBridge,
  buildChassis,
  buildConsole,
  buildGripper,
  buildLeverKnob,
  buildMotor,
  buildPowerCell,
  buildRelay,
  buildSocketMarker,
  buildTerrain,
  buildTitanGate,
  buildTray,
  buildWheels,
  buildWorkbenchPad,
  Mats,
  rockWall,
} from './titan-meshes.js';

type PartKind = (typeof PartKinds)[keyof typeof PartKinds];

/** Axis-aligned rectangle in diorama-local XZ space. */
interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Where the diorama sits in the room: a seated player's tabletop, in front of them. */
const DIORAMA_ORIGIN = new Vector3(0, 0.72, -0.5);

const ROVER_RADIUS = 0.035;
const ROVER_SPEED = 0.09; // m/s at full throttle
const ROVER_TURN = 2.4; // rad/s at full differential
const SNAP_DISTANCE = 0.07;
const PICKUP_DISTANCE = 0.04;
const DELIVER_DISTANCE = 0.05;
const LEVER_TRAVEL = 0.04;
const LEVER_HEIGHT = 0.08;
const PAD_POSITION = new Vector3(-0.28, 0, 0.12);
const CELL_POSITION = new Vector3(0.265, 0.014, -0.17);
const CREVICE_MOUTH = new Vector3(0.265, 0, -0.03);
const BRIDGE_X = -0.05;
const GOAL_Z = -0.37;

const OBSTACLES: Rect[] = [
  { x0: 0.17, x1: 0.24, z0: -0.25, z1: -0.06 }, // crevice west wall
  { x0: 0.29, x1: 0.36, z0: -0.25, z1: -0.06 }, // crevice east wall
  { x0: 0.17, x1: 0.36, z0: -0.26, z1: -0.235 }, // crevice back wall
  { x0: -0.27, x1: -0.17, z0: -0.205, z1: -0.115 }, // relay plinth
  { x0: 0.14, x1: 0.4, z0: 0.125, z1: 0.26 }, // parts tray
  { x0: -0.44, x1: -0.34, z0: 0.01, z1: 0.11 }, // crashed pod
  { x0: -0.2, x1: -0.14, z0: -0.45, z1: -0.39 }, // gate pillar
  { x0: 0.04, x1: 0.1, z0: -0.45, z1: -0.39 }, // gate pillar
];

const MAIN_GROUND: Rect = { x0: -0.45 + ROVER_RADIUS, x1: 0.45 - ROVER_RADIUS, z0: -0.26 + ROVER_RADIUS, z1: 0.19 };
const BRIDGE_LANE: Rect = { x0: BRIDGE_X - 0.035, x1: BRIDGE_X + 0.035, z0: -0.37, z1: -0.2 };
const FAR_GROUND: Rect = { x0: -0.3 + ROVER_RADIUS, x1: 0.2 - ROVER_RADIUS, z0: -0.5 + ROVER_RADIUS, z1: -0.34 };

const enum Stage {
  Build,
  Retrieve,
  Deliver,
  Cross,
  Complete,
}

const OBJECTIVES: Record<Stage, [string, string]> = {
  [Stage.Build]: [
    'BUILD YOUR ROVER',
    'Pinch a part from the tray and drop it on a glowing ring on the chassis. A rover needs wheels and a motor to move.',
  ],
  [Stage.Retrieve]: [
    'RECOVER THE POWER CELL',
    'Push both levers forward to drive. Steer by pushing one lever more than the other. The glowing cell is deep in the crevice.',
  ],
  [Stage.Deliver]: [
    'POWER THE RELAY',
    'You have the cell. Drive it to the ancient relay and touch it to the slot.',
  ],
  [Stage.Cross]: [
    'THE PATH IS OPEN',
    'The relay woke the bridge. Drive across the chasm to the Titan Gate.',
  ],
  [Stage.Complete]: [
    'EXPEDITION 1 COMPLETE',
    'You reached the Titan Gate. Beyond it lies a canyon your rover cannot cross. What will you build next?',
  ],
};

const REACH_HINT =
  'The cell is too deep for the gripper to reach from the mouth of the crevice. Could a longer reach help? Try rebuilding.';

interface PartInfo {
  entity: Entity;
  kind: PartKind;
  home: Vector3;
}

export class TitanSystem extends createSystem({
  parts: { required: [Part] },
  heldParts: { required: [Part, Grabbed] },
  sockets: { required: [PartSocket] },
  levers: { required: [DriveLever] },
}) {
  private root!: Entity;
  private rootObj!: Object3D;
  private rover!: Entity;
  private roverYaw = 0;
  private cell!: Object3D;
  private cellState: 'crevice' | 'held' | 'installed' = 'crevice';
  private relaySocket!: Object3D;
  private relayGlow: Mesh[] = [];
  private relayBeam!: Mesh;
  private bridgeDeck!: Object3D;
  private bridgeProgress = 0;
  private gateGlow: Mesh[] = [];
  private partInfos: PartInfo[] = [];
  private markers = new Map<Entity, Mesh>();
  private stage = Stage.Build;
  private hintTimer = 0;
  private showingHint = false;
  private titleText?: UIKit.Text;
  private bodyText?: UIKit.Text;

  // Scratch values, allocated once.
  private v1 = new Vector3();
  private v2 = new Vector3();
  private candidate = new Vector3();
  private wheelAxis = new Vector3(0, 1, 0);

  init(): void {
    this.buildWorld();
    this.bindPanel();

    this.cleanupFuncs.push(
      this.queries.heldParts.subscribe('qualify', (e) => this.onPartGrabbed(e)),
      this.queries.heldParts.subscribe('disqualify', (e) => this.onPartReleased(e)),
    );
    this.setStage(Stage.Build);
  }

  // ---------------------------------------------------------------- world setup

  private buildWorld(): void {
    const rootObj = new Group();
    rootObj.name = 'Diorama';
    rootObj.position.copy(DIORAMA_ORIGIN);
    this.root = this.world.createTransformEntity(rootObj);
    this.rootObj = rootObj;

    const add = (obj: Object3D, x = 0, y = 0, z = 0): Object3D => {
      obj.position.set(x, y, z);
      rootObj.add(obj);
      return obj;
    };

    add(buildTerrain());
    add(buildWorkbenchPad(), PAD_POSITION.x, 0, PAD_POSITION.z);
    add(buildTray(), 0.27, 0, 0.17);
    add(rockWall(0.17, 0.24, -0.25, -0.06, 0.07, 11));
    add(rockWall(0.29, 0.36, -0.25, -0.06, 0.075, 23));
    add(rockWall(0.17, 0.36, -0.26, -0.235, 0.08, 37));

    const relay = buildRelay();
    add(relay.root, -0.22, 0, -0.16);
    this.relayGlow = relay.glow;
    this.relayBeam = relay.beam;
    this.relaySocket = new Object3D();
    this.relaySocket.position.set(0, 0.03, 0.05);
    relay.root.add(this.relaySocket);

    const bridge = buildBridge();
    add(bridge.root, BRIDGE_X, 0, -0.26);
    this.bridgeDeck = bridge.deck;

    const gate = buildTitanGate();
    add(gate.root, -0.05, 0, -0.42);
    this.gateGlow = gate.glow;

    this.cell = buildPowerCell();
    rootObj.add(this.cell);

    // Driver console with two drive levers, right at the front edge where
    // seated hands rest.
    const consoleObj = buildConsole();
    consoleObj.position.set(0, 0, 0.225);
    const consoleEntity = this.world.createTransformEntity(consoleObj, { parent: this.root });
    for (const side of [LeverSides.Left, LeverSides.Right]) {
      const knob = buildLeverKnob(side);
      knob.name = side === LeverSides.Left ? 'LeverLeft' : 'LeverRight';
      const x = side === LeverSides.Left ? -0.04 : 0.04;
      knob.position.set(x, LEVER_HEIGHT, 0);
      const lever = this.world.createTransformEntity(knob, { parent: consoleEntity });
      lever.addComponent(DriveLever, { side });
      lever.addComponent(OneHandGrabbable, {
        rotate: false,
        translate: true,
        translateMin: [x, LEVER_HEIGHT, -LEVER_TRAVEL],
        translateMax: [x, LEVER_HEIGHT, LEVER_TRAVEL],
      });
    }

    // Rover chassis with its sockets.
    const chassis = buildChassis();
    chassis.name = 'Rover';
    chassis.position.copy(PAD_POSITION);
    chassis.position.y = 0.006;
    this.rover = this.world.createTransformEntity(chassis, { parent: this.root });
    this.addSocket(this.rover, PartKinds.Wheels, 0, 0, 0);
    this.addSocket(this.rover, PartKinds.Motor, 0, 0.03, 0.022);
    this.addSocket(this.rover, PartKinds.Arm, 0, 0.03, -0.018);
    this.addSocket(this.rover, PartKinds.Gripper, 0, 0.024, -0.047);

    // Parts laid out on the tray.
    this.addPart(PartKinds.Wheels, buildWheels(), new Vector3(0.18, 0.012, 0.17));
    this.addPart(PartKinds.Motor, buildMotor(), new Vector3(0.24, 0.012, 0.17));
    this.addPart(PartKinds.Arm, buildArm(), new Vector3(0.3, 0.012, 0.21));
    this.addPart(PartKinds.Gripper, buildGripper(), new Vector3(0.37, 0.02, 0.17));

    this.resetWorldState();
  }

  private addSocket(parent: Entity, accepts: PartKind, x: number, y: number, z: number): Entity {
    const obj = new Object3D();
    obj.name = `Socket_${accepts}`;
    obj.position.set(x, y, z);
    const marker = buildSocketMarker();
    obj.add(marker);
    const socket = this.world.createTransformEntity(obj, { parent });
    socket.addComponent(PartSocket, { accepts, occupant: null });
    this.markers.set(socket, marker);
    return socket;
  }

  private addPart(kind: PartKind, obj: Object3D, home: Vector3): void {
    obj.name = `Part_${kind}`;
    obj.position.copy(home);
    const entity = this.world.createTransformEntity(obj, { parent: this.root });
    entity.addComponent(Part, { kind, socket: null });
    entity.addComponent(OneHandGrabbable, { rotate: true, translate: true });
    // The arm carries its own socket at its tip, so a gripper can ride on it.
    if (kind === PartKinds.Arm) {
      this.addSocket(entity, PartKinds.Gripper, 0, 0.01, -0.1);
    }
    this.partInfos.push({ entity, kind, home: home.clone() });
  }

  private resetWorldState(): void {
    // Detach every part and send it home to the tray.
    for (const info of this.partInfos) {
      this.detachPart(info.entity);
      const obj = info.entity.object3D!;
      obj.position.copy(info.home);
      obj.quaternion.identity();
    }
    for (const info of this.partInfos) {
      // Second pass: a gripper may have been riding on the arm.
      const obj = info.entity.object3D!;
      if (obj.parent !== this.rootObj) this.rootObj.attach(obj);
      obj.position.copy(info.home);
      obj.quaternion.identity();
    }
    const rover = this.rover.object3D!;
    rover.position.set(PAD_POSITION.x, 0.006, PAD_POSITION.z);
    this.roverYaw = 0;
    rover.rotation.set(0, 0, 0);

    this.rootObj.add(this.cell);
    this.cell.position.copy(CELL_POSITION);
    this.cell.rotation.set(0, 0, 0);
    this.cellState = 'crevice';

    this.relayGlow.forEach((m) => (m.material = Mats.ancientGlowOff));
    this.gateGlow.forEach((m) => (m.material = Mats.ancientGlowOff));
    this.relayBeam.visible = false;
    this.bridgeProgress = 0;
    this.bridgeDeck.rotation.x = Math.PI / 2;
    this.hintTimer = 0;
    this.showingHint = false;
    this.setStage(Stage.Build);
  }

  private bindPanel(): void {
    const panel = this.world.getSceneObject<UIKitMLAsset>('objective-panel');
    if (panel == null) return;
    this.titleText = panel.getElementById<UIKit.Text>('objective-title') ?? undefined;
    this.bodyText = panel.getElementById<UIKit.Text>('objective-body') ?? undefined;
    const restart = panel.getElementById('restart-button');
    if (restart != null) {
      const onRestart = () => this.resetWorldState();
      restart.addEventListener('click', onRestart);
      this.cleanupFuncs.push(() => restart.removeEventListener('click', onRestart));
    }
  }

  // ---------------------------------------------------------------- parts

  private socketOf(part: Entity): Entity | null {
    return (part.getValue(Part, 'socket') as Entity | null) ?? null;
  }

  private detachPart(part: Entity): void {
    const socket = this.socketOf(part);
    if (socket == null) return;
    socket.setValue(PartSocket, 'occupant', null);
    part.setValue(Part, 'socket', null);
    const marker = this.markers.get(socket);
    if (marker) marker.visible = true;
    this.rootObj.attach(part.object3D!);
  }

  private onPartGrabbed(part: Entity): void {
    this.detachPart(part);
  }

  private onPartReleased(part: Entity): void {
    const socket = this.findSnapSocket(part);
    for (const marker of this.markers.values()) marker.material = Mats.socketFree;
    if (socket == null) {
      // Not near a socket: float back to the tray so nothing gets lost.
      const info = this.partInfos.find((p) => p.entity === part);
      if (info) {
        const obj = part.object3D!;
        this.rootObj.attach(obj);
        obj.position.copy(info.home);
        obj.quaternion.identity();
      }
      return;
    }
    const obj = part.object3D!;
    socket.object3D!.add(obj);
    obj.position.set(0, 0, 0);
    obj.quaternion.identity();
    socket.setValue(PartSocket, 'occupant', part);
    part.setValue(Part, 'socket', socket);
    const marker = this.markers.get(socket);
    if (marker) marker.visible = false;
  }

  /** Nearest free socket that accepts this part and is not on the part itself. */
  private findSnapSocket(part: Entity): Entity | null {
    const kind = part.getValue(Part, 'kind') as PartKind;
    const partObj = part.object3D!;
    partObj.getWorldPosition(this.v1);
    let best: Entity | null = null;
    let bestDist = SNAP_DISTANCE;
    for (const socket of this.queries.sockets.entities) {
      if (socket.getValue(PartSocket, 'accepts') !== kind) continue;
      if (socket.getValue(PartSocket, 'occupant') != null) continue;
      const sObj = socket.object3D!;
      if (isDescendant(sObj, partObj)) continue;
      sObj.getWorldPosition(this.v2);
      const d = this.v1.distanceTo(this.v2);
      if (d < bestDist) {
        bestDist = d;
        best = socket;
      }
    }
    return best;
  }

  private hasOnRover(kind: PartKind): boolean {
    const roverObj = this.rover.object3D!;
    for (const info of this.partInfos) {
      if (info.kind !== kind) continue;
      if (this.socketOf(info.entity) != null && isDescendant(info.entity.object3D!, roverObj)) return true;
    }
    return false;
  }

  private gripperTip(): Object3D | null {
    const info = this.partInfos.find((p) => p.kind === PartKinds.Gripper);
    if (info == null || !this.hasOnRover(PartKinds.Gripper)) return null;
    return info.entity.object3D!.getObjectByName('tip') ?? null;
  }

  // ---------------------------------------------------------------- frame update

  update(delta: number, time: number): void {
    if (this.world.visibilityState.peek() === VisibilityState.VisibleBlurred) return;
    const dt = Math.min(delta, 0.05);

    // Highlight the socket a held part would snap to.
    for (const marker of this.markers.values()) marker.material = Mats.socketFree;
    for (const part of this.queries.heldParts.entities) {
      const socket = this.findSnapSocket(part);
      if (socket) {
        const marker = this.markers.get(socket);
        if (marker) marker.material = Mats.socketReady;
      }
    }
    // Free sockets pulse gently so new players notice them.
    const pulse = 1 + Math.sin(time * 4) * 0.15;
    for (const marker of this.markers.values()) marker.scale.setScalar(pulse);

    const [left, right] = this.readLevers(dt);
    const drivable = this.hasOnRover(PartKinds.Wheels) && this.hasOnRover(PartKinds.Motor);
    if (drivable) this.driveRover(left, right, dt);

    this.updateCell(dt);
    this.updateBridge(dt);
    this.updateStage(drivable, dt);
    this.cell.rotation.y += dt * 1.5;
  }

  private readLevers(dt: number): [number, number] {
    let left = 0;
    let right = 0;
    for (const lever of this.queries.levers.entities) {
      const obj = lever.object3D!;
      if (!lever.hasComponent(Grabbed)) {
        // Spring back to neutral, like a dead-man's handle.
        obj.position.z += (0 - obj.position.z) * Math.min(1, dt * 12);
      }
      const value = Math.max(-1, Math.min(1, -obj.position.z / LEVER_TRAVEL));
      const v = Math.abs(value) < 0.12 ? 0 : value;
      lever.setValue(DriveLever, 'value', v);
      if (lever.getValue(DriveLever, 'side') === LeverSides.Left) left = v;
      else right = v;
    }
    // Keyboard fallback for desktop testing: W/S drive, A/D turn.
    const kb = this.world.input.keyboard;
    const fwd = (kb.getKeyPressed('KeyW') ? 1 : 0) - (kb.getKeyPressed('KeyS') ? 1 : 0);
    const turn = (kb.getKeyPressed('KeyD') ? 1 : 0) - (kb.getKeyPressed('KeyA') ? 1 : 0);
    if (fwd !== 0 || turn !== 0) {
      left = clamp(fwd + turn * 0.6);
      right = clamp(fwd - turn * 0.6);
    }
    return [left, right];
  }

  private driveRover(left: number, right: number, dt: number): void {
    const speed = ((left + right) / 2) * ROVER_SPEED;
    const turn = ((right - left) / 2) * ROVER_TURN;
    if (speed === 0 && turn === 0) return;
    const obj = this.rover.object3D!;
    this.roverYaw += turn * dt;
    const step = speed * dt;
    const dx = -Math.sin(this.roverYaw) * step;
    const dz = -Math.cos(this.roverYaw) * step;
    const p = obj.position;
    // Try the full move, then slide along each axis.
    if (this.isFree(p.x + dx, p.z + dz)) {
      p.x += dx;
      p.z += dz;
    } else if (this.isFree(p.x + dx, p.z)) {
      p.x += dx;
    } else if (this.isFree(p.x, p.z + dz)) {
      p.z += dz;
    }
    obj.rotation.set(0, this.roverYaw, 0);

    // Spin the wheels with the distance travelled.
    const spin = (step / 0.012) * 1;
    const turnSpin = turn * dt * 2.5;
    obj.traverse((child) => {
      if (child.name === 'wheel') {
        const side = child.position.x < 0 ? 1 : -1;
        child.rotateOnAxis(this.wheelAxis, -(spin + side * turnSpin));
      }
    });
  }

  private isFree(x: number, z: number): boolean {
    const onGround =
      inRect(MAIN_GROUND, x, z) ||
      inRect(FAR_GROUND, x, z) ||
      (this.bridgeProgress >= 1 && inRect(BRIDGE_LANE, x, z));
    if (!onGround) return false;
    for (const r of OBSTACLES) {
      const cx = Math.max(r.x0, Math.min(x, r.x1));
      const cz = Math.max(r.z0, Math.min(z, r.z1));
      const ddx = x - cx;
      const ddz = z - cz;
      if (ddx * ddx + ddz * ddz < ROVER_RADIUS * ROVER_RADIUS) return false;
    }
    return true;
  }

  private updateCell(dt: number): void {
    if (this.cellState === 'crevice') {
      const tip = this.gripperTip();
      if (tip == null) return;
      tip.getWorldPosition(this.v1);
      this.cell.getWorldPosition(this.v2);
      if (this.v1.distanceTo(this.v2) < PICKUP_DISTANCE) {
        tip.add(this.cell);
        this.cell.position.set(0, 0, -0.004);
        this.cellState = 'held';
      }
    } else if (this.cellState === 'held') {
      if (this.gripperTip() == null) {
        // Gripper was pulled off the rover: drop the cell where it is.
        this.rootObj.attach(this.cell);
        this.cell.position.y = CELL_POSITION.y;
        this.cellState = 'crevice';
        return;
      }
      this.cell.getWorldPosition(this.v1);
      this.relaySocket.getWorldPosition(this.v2);
      if (this.v1.distanceTo(this.v2) < DELIVER_DISTANCE) {
        this.relaySocket.add(this.cell);
        this.cell.position.set(0, 0, 0);
        this.cellState = 'installed';
        this.relayGlow.forEach((m) => (m.material = Mats.ancientGlowOn));
        this.relayBeam.visible = true;
      }
    }
    void dt;
  }

  private updateBridge(dt: number): void {
    if (this.cellState !== 'installed' || this.bridgeProgress >= 1) return;
    this.bridgeProgress = Math.min(1, this.bridgeProgress + dt / 2.2);
    const t = this.bridgeProgress;
    const eased = t < 1 ? 1 - Math.pow(1 - t, 3) : 1;
    // A small overshoot "thunk" at the end sells the weight.
    const bounce = t > 0.85 ? Math.sin(((t - 0.85) / 0.15) * Math.PI) * 0.04 : 0;
    this.bridgeDeck.rotation.x = (Math.PI / 2) * (1 - eased) - bounce;
  }

  private updateStage(drivable: boolean, dt: number): void {
    let next = this.stage;
    if (this.stage === Stage.Complete) return;
    if (this.cellState === 'installed') {
      next = this.rover.object3D!.position.z < GOAL_Z ? Stage.Complete : Stage.Cross;
    } else if (this.cellState === 'held') {
      next = Stage.Deliver;
    } else {
      next = drivable ? Stage.Retrieve : Stage.Build;
    }
    if (next !== this.stage) this.setStage(next);
    if (next === Stage.Complete) {
      this.gateGlow.forEach((m) => (m.material = Mats.ancientGlowOn));
    }

    // If the player is stuck at the crevice mouth without an arm, nudge them.
    if (this.stage === Stage.Retrieve) {
      const p = this.rover.object3D!.position;
      const near = Math.hypot(p.x - CREVICE_MOUTH.x, p.z - CREVICE_MOUTH.z) < 0.07;
      this.hintTimer = near && !this.hasOnRover(PartKinds.Arm) ? this.hintTimer + dt : 0;
      const show = this.hintTimer > 2;
      if (show !== this.showingHint) {
        this.showingHint = show;
        this.bodyText?.setProperties({ text: show ? REACH_HINT : OBJECTIVES[Stage.Retrieve][1] });
      }
    }
  }

  private setStage(stage: Stage): void {
    this.stage = stage;
    this.showingHint = false;
    const [title, body] = OBJECTIVES[stage];
    this.titleText?.setProperties({ text: title });
    this.bodyText?.setProperties({ text: body });
  }
}

function inRect(r: Rect, x: number, z: number): boolean {
  return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
}

function clamp(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

function isDescendant(obj: Object3D, ancestor: Object3D): boolean {
  let o: Object3D | null = obj;
  while (o) {
    if (o === ancestor) return true;
    o = o.parent;
  }
  return false;
}
