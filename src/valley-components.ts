import { createComponent, Types } from '@iwsdk/core';

/** The four element families. Each beats the next one around the wheel: fire > air > earth > water > fire. */
export const Elements = {
  Fire: 'fire',
  Water: 'water',
  Earth: 'earth',
  Air: 'air',
} as const;

export const FoeStates = {
  Patrol: 'patrol',
  Alert: 'alert',
  Fight: 'fight',
  Down: 'down',
} as const;

/** The player's hero: a small lantern-bearer who walks the table. */
export const Hero = createComponent('Hero', {
  hp: { type: Types.Float32, default: 100 },
  maxHp: { type: Types.Float32, default: 100 },
  energy: { type: Types.Float32, default: 100 },
  xp: { type: Types.Float32, default: 0 },
  level: { type: Types.Int16, default: 1 },
  gold: { type: Types.Int16, default: 0 },
});

/** An enemy in the valley. Foes that share a `group` are spotted and fought together. */
export const Foe = createComponent('Foe', {
  group: { type: Types.Int16, default: 0 },
  element: { type: Types.Enum, enum: Elements, default: Elements.Air },
  state: { type: Types.Enum, enum: FoeStates, default: FoeStates.Patrol },
  hp: { type: Types.Float32, default: 50 },
  maxHp: { type: Types.Float32, default: 50 },
  homeX: { type: Types.Float32, default: 0 },
  homeZ: { type: Types.Float32, default: 0 },
  /** Half-length of the patrol walk along X; 0 means the foe stands and looks around. */
  patrol: { type: Types.Float32, default: 0 },
  /** Base facing in radians (for foes that stand still). */
  facing: { type: Types.Float32, default: 0 },
  damage: { type: Types.Float32, default: 7 },
  attackEvery: { type: Types.Float32, default: 2.2 },
  xp: { type: Types.Float32, default: 40 },
});
