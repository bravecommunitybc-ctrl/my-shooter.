# Vantage — tactical 5v5 browser FPS

Original round-based shooter (plant/defuse, economy) vs bots on the map **Quarry**.
Three.js + TypeScript (strict) + Vite. No physics engine: own swept AABB collision and ray casts.
Only original names and assets: textures are procedural canvases, all audio is synthesised with Web Audio.

## Commands
- `npm install && npm run dev`: dev server at http://localhost:5173
- `npm run build`: `tsc --noEmit` + production build. **Must pass after every change.**
- `npm run typecheck`: types only
- Deploy: `.github/workflows/deploy.yml` builds PRs and publishes `main` to GitHub Pages.
  `vite.config.ts` reads `base` from `BASE_PATH` (CI sets `/<repo-name>/`); keep asset
  URLs relative to the Vite pipeline (no hard-coded `/…` paths) so the subpath works.

## Layout
```
src/
  main.ts                 entry; exposes window.game in dev
  config.ts               ALL balance numbers (weapons, movement, economy, round, bomb, bots, audio)
  core/
    Game.ts               owns renderer + systems, fixed-step loop, match lifecycle, HUD glue
    EventBus.ts           typed pub/sub
    events.ts             GameEvents: the contract between systems
    Settings.ts           user settings (localStorage, try/catch)
  input/Input.ts          keys/mouse, pointer lock, bindings, press counting (`consume`)
  physics/
    AABB.ts               box type + slab ray test
    CollisionWorld.ts     static boxes: raycast, segmentClear, overlaps, sweepAxis
  world/
    MapDef.ts             map data types (blocks, sites, spawns, buy zones, waypoints, labels)
    maps/quarry.ts        the map: blocks + waypoints (nav links are generated)
    MapBuilder.ts         blocks → merged meshes per material + collision; sky/lights
    Textures.ts           procedural canvas textures
  entities/
    Actor.ts              shared state for player & bots (transform, hp/armour, loadout, intents, hitboxes)
    Movement.ts           Source-like accel/friction, jump, crouch(-jump), step-up, actor separation
    Player.ts             human controller: mouse look, keys → intents, camera
    ActorModel.ts         blocky third-person model (walk/crouch/aim/death)
  weapons/
    Weapon.ts             per-instance state (ammo, timers, recoil accumulators)
    WeaponSystem.ts       switching, reload, spread, spray pattern, hitscan, melee
    Damage.ts             zone/armour damage, kills
    Effects.ts            pooled tracers / decals (InstancedMesh) / particles / lights / explosion
    ViewModel.ts          first-person weapon in a second render pass
  ai/
    NavGraph.ts           waypoint graph, auto-linking, A* with route jitter
    Perception.ts         FOV + line-of-sight helpers
    BotBrain.ts           per-bot perception, reaction, aim error, bursts, path following
    BotManager.ts         team plans: site choice, posts, rotations, plant/defuse/pickup orders
  round/
    RoundManager.ts       buy → live → post, win conditions, halftime, match end
    Bomb.ts               Pulse Charge state machine (carry/drop/plant/defuse/explode)
    Economy.ts            rewards, loss bonus, shop, bot buying
  audio/Sfx.ts            synthesised positional sounds driven by events
  ui/                     DOM overlay: Hud, Crosshair, Menu, BuyMenu, KillFeed, Scoreboard, styles.css
```

## Core rules
- **Balance lives in `src/config.ts`.** Never hard-code a tunable in a system.
- Units: metres, seconds, radians. Suffix `Deg` when a value is in degrees.
- Simulation runs at a fixed 60 Hz in `Game.tick`; rendering interpolates `prevPos → pos`.
  Mouse look is applied per frame (not per tick) for latency.
- Tick order: player intent / bots → movement → hitboxes → weapons → round & bomb → spectator.
- Controllers (Player, BotBrain) only write `actor.intent` and `actor.weaponIntent`;
  systems read them. Bots and the player share Movement, WeaponSystem and Damage.
- Systems talk through `EventBus<GameEvents>` (UI, audio, economy, bot hearing subscribe).
  Vectors in event payloads are shared temporaries: copy them if you keep them.
- Friendly fire is off: traces skip teammates.
- No per-frame allocations in hot paths: reuse module-level `_tmp` vectors.

## Performance notes (target 60+ FPS on a mid laptop)
- Map geometry is merged per material (about 7 draw calls). Shadows are rendered once
  (`shadowMap.autoUpdate = false`); actors do not cast shadows.
- The collision world is brute force over ~50 boxes: faster than a grid at this size.
  If maps grow past a few hundred boxes, add a uniform grid in `CollisionWorld`.
- Bots think at 10 Hz (staggered); orders refresh at 4 Hz.
- Pixel ratio is capped (`CONFIG.render.maxPixelRatio`).

## Testing / debugging
- In dev, `window.game` is exposed. `game.simulate(seconds)` advances the simulation
  without rendering; handy for soak tests (a full match simulates in about a second).
- The nav graph logs a warning in dev if waypoints form disconnected groups.
- Headless Chromium (SwiftShader) renders at ~10 FPS; judge real performance on a GPU.

## Extending
- **Weapon**: add an id to `WeaponId`, stats to `WEAPONS`, a viewmodel in `ViewModel.ts`,
  a sound profile in `Sfx.gunshot`, and a shop entry in `Economy.SHOP`.
- **Map**: new `MapDef` in `world/maps/`; keep waypoints ≤ 17 m apart with clear corridors,
  tag `A`/`B`, `plantA`/`plantB`, `holdA`/`holdB`/`holdMid` (+ `look`), and site `entrances`.
