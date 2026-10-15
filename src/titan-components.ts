import { createComponent, Types } from '@iwsdk/core';

export const PartKinds = {
  Wheels: 'wheels',
  Motor: 'motor',
  Arm: 'arm',
  Gripper: 'gripper',
} as const;

/** A machine part the player can pick up and snap onto a socket. */
export const Part = createComponent('Part', {
  kind: { type: Types.Enum, enum: PartKinds, default: PartKinds.Wheels },
  socket: { type: Types.Entity, default: null },
});

/** An attachment point on the rover (or on another part) that accepts one part kind. */
export const PartSocket = createComponent('PartSocket', {
  accepts: { type: Types.Enum, enum: PartKinds, default: PartKinds.Wheels },
  occupant: { type: Types.Entity, default: null },
});

export const LeverSides = { Left: 'left', Right: 'right' } as const;

/** A drive lever knob. `value` runs from -1 (pulled back) to 1 (pushed forward). */
export const DriveLever = createComponent('DriveLever', {
  side: { type: Types.Enum, enum: LeverSides, default: LeverSides.Left },
  value: { type: Types.Float32, default: 0 },
});
