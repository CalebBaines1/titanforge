# TITANFORGE

A mixed-reality engineering expedition for Meta Quest, built with the
[Immersive Web SDK](https://iwsdk.dev) for the Meta VR Start Developer
Competition 2026.

You are stranded on a strange planet that sits on your real table. Build a
rover from modular parts with your hands, drive it with two physical levers,
and invent your way past each obstacle toward the Titan Gate.

## Play it

Open the GitHub Pages URL on a Quest 3 / 3S browser and press **Enter XR**.
Sit at a table; the diorama appears at tabletop height in front of you.

- **Build:** pinch a part on the tray and drop it on a glowing ring on the
  chassis. Wheels and a motor make it drive. The arm carries the gripper further.
- **Drive:** pinch the orange (left) and blue (right) levers and push them
  forward. Push one more than the other to turn. Let go to stop.
- **Expedition 1:** recover the power cell from the crevice, power the relay,
  and cross the bridge to the Titan Gate.

Desktop testing: `W`/`S` drive and `A`/`D` turn.

## Develop

```bash
npm install
npm run dev        # managed dev server + Quest 3 emulator (IWER)
npm run typecheck
npm run build      # static site in dist/
```

Pushing to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`.

## Code map

- `src/titan-system.ts` — game loop: snapping, levers, driving, collisions, objectives
- `src/titan-meshes.ts` — low-poly procedural art
- `src/titan-components.ts` — ECS components (`Part`, `PartSocket`, `DriveLever`)
- `public/ui/objective.uikitml` — objective panel
- `iwsdk.config.json` — XR features (passthrough, hand tracking, pinch-to-grab)
