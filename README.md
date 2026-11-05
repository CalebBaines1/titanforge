# Dungeon Table: Lantern Valley

A tabletop RPG for Meta Quest, built as a WebXR app on the Immersive Web SDK (IWSDK).
A small valley sits on your real table in mixed reality. You walk your hero around it,
sneak past or fight bandits with fire, water, earth and air cards, and fuse two cards
into stronger moves.

## Play

- `npm install`, then `npm run dev` (the IWSDK CLI starts Vite and a managed browser).
- On a Quest, open the network URL from `npx @iwsdk/cli dev status` in the browser,
  accept the local certificate warning, and press **Enter XR**.
- Point at the ground and pinch to walk (click on desktop). The hero takes the bridge
  to cross the river.
- Bandits have sight cones. Walk into one and you are spotted: a battle ring rises
  where you stand. Or sneak up and play a card first for a 1.5x ambush.
- Cards: Fire, Water, Earth, Air (keys 1 to 4). Fire beats air, air beats earth,
  earth beats water, water beats fire (2x, or 0.5x the other way).
- Fuse (key F), then two different cards: Lava, Storm, Steam (heal), Mud (slows),
  Blaze, Dust devil.
- Leave the ring to run away. Get knocked out and you wake up at home.
- Quest: clear the road, clear the bandit camp, go home.

## Code

- `src/valley-system.ts` runs the game: walking, patrols and sight, fights, the HUD.
- `src/valley-meshes.ts` builds the valley, characters and effects in code.
- `src/valley-components.ts` holds the `Hero` and `Foe` ECS components.
- `public/ui/hud.uikitml` is the quest and card panel.

Not in this first version yet: mounts, first person riding, fishing and other
minigames, the house interior, character creation, the world boss and realm gates.
