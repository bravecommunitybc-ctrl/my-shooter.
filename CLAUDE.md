# Vantage — tactical 5v5 browser FPS

Three.js + TypeScript + Vite. No physics engine: own AABB sweeps and ray casts.

## Commands
- `npm install && npm run dev` — dev server (http://localhost:5173)
- `npm run build` — `tsc --noEmit` + production build. Must pass after every change.

## Conventions
- All balance numbers live in `src/config.ts`. Never hard-code tunables in systems.
- Units: metres, seconds, radians (`…Deg` suffix when degrees).
- Simulation runs at a fixed 60 Hz (`Game.tick`); rendering interpolates with `prevPos`.
- Only original names/assets: textures are procedural canvases, sounds are synthesised with Web Audio.

(Architecture section is completed as the stages land.)
