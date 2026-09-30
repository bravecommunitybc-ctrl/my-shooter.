import type { BlockDef, MapDef, MatId, WaypointDef } from '../MapDef';

/**
 * "Quarry" — abandoned stone quarry.
 *
 *   north (z-)  defenders (Wardens) spawn, CT strip
 *     A site (west)      courtyard / CT house       B site (east)
 *        |  A short gap ← mid-top crates → B short gap  |
 *     A long (x≈-42)          Mid (x≈0)          B tunnel (x≈42, roofed)
 *        |   ← cut (z≈12) →      ← connector (z≈24) →   |
 *   south (z+)  attackers (Strikers) spawn
 */

const H = 7; // inner wall height

function box(x0: number, z0: number, x1: number, z1: number, h: number, mat: MatId, y0 = 0): BlockDef {
  return {
    min: [Math.min(x0, x1), y0, Math.min(z0, z1)],
    max: [Math.max(x0, x1), y0 + h, Math.max(z0, z1)],
    mat,
  };
}

const crate = (x0: number, z0: number, x1: number, z1: number, h: number) => box(x0, z0, x1, z1, h, 'crate');

const blocks: BlockDef[] = [
  // ground
  { min: [-48, -1, -58], max: [48, 0, 58], mat: 'sand' },
  // outer walls
  box(-48, -58, 48, -57, 10, 'wall'),
  box(-48, 57, 48, 58, 10, 'wall'),
  box(-48, -57, -47, 57, 10, 'wall'),
  box(47, -57, 48, 57, 10, 'wall'),

  // west block between A long and mid, split by "the cut" (z 10..15)
  box(-38, -12, -7, 10, H, 'wall'),
  box(-38, 15, -7, 40, H, 'wall'),
  // east block between mid and B tunnel, split by the connector (z 22..27)
  box(7, -12, 38, 22, H, 'wall'),
  box(7, 27, 38, 40, H, 'wall'),

  // long doors (3 m choke)
  box(-47, 0, -44, 2, H, 'metal'),
  box(-41, 0, -38, 2, H, 'metal'),
  box(-44, 0, -41, 2, H - 3.2, 'metal', 3.2),
  // B tunnel: doors + roof
  box(38, 10, 41, 12, H, 'metal'),
  box(44, 10, 47, 12, H, 'metal'),
  box(38, 4, 47, 30, 0.6, 'concrete', 3.6),
  // mid doors
  box(-7, -6, -2.5, -4, H, 'metal'),
  box(2.5, -6, 7, -4, H, 'metal'),
  box(-2.5, -6, 2.5, -4, H - 4.2, 'metal', 4.2),

  // A east wall with the A-short gap (z -18..-14) and CT strip gap (z < -50)
  box(-23, -50, -21, -18, H, 'wall'),
  box(-23, -14, -21, -12, H, 'wall'),
  // B west wall with the B-short gap (z -44..-40)
  box(21, -50, 23, -44, H, 'wall'),
  box(21, -40, 23, -12, H, 'wall'),

  // CT house in the courtyard
  box(-12, -42, 12, -28, 5, 'concrete'),
  box(-12.5, -42.5, 12.5, -27.5, 0.4, 'trim', 5),
  // mid-top crates (split so you can peek through)
  crate(-4, -19, -1, -16, 2.4),
  crate(1, -19, 4, -16, 2.4),

  // A site cover
  crate(-38, -38, -35, -35, 2.4),
  crate(-37.5, -37.5, -35.5, -35.5, 1.2),
  crate(-32, -30, -30, -28, 1.2),
  crate(-46.9, -28, -44, -24, 1.2),
  box(-30, -46, -26, -42, 2.4, 'concrete'),
  // B site cover
  crate(35, -36, 38, -33, 2.4),
  crate(28, -42, 31, -40, 1.2),
  crate(40, -28, 43, -26, 1.2),
  box(31, -30, 33, -28, 4, 'concrete'),

  // lanes
  crate(-1, 5, 1, 7, 1.1), // mid crate
  crate(-46.9, 20, -45, 22, 1.2), // long cover
  crate(45, 32, 46.9, 34, 1.2), // tunnel entrance cover
  // attacker spawn: two haul trucks
  box(-20, 46, -14, 50, 2.5, 'metal'),
  box(14, 44, 20, 48, 2.5, 'metal'),
  // defender spawn cover
  crate(-18, -56.9, -16, -55, 1.2),

  // painted site pads (0.04 high, stepped over automatically)
  { min: [-44, 0, -44], max: [-26, 0.04, -24], mat: 'pad' },
  { min: [26, 0, -46], max: [45, 0.04, -24], mat: 'pad' },
];

const W = (x: number, z: number, tags?: string[], look?: [number, number]): WaypointDef => ({ pos: [x, z], tags, look });

const waypoints: WaypointDef[] = [
  // attacker spawn
  W(0, 50), W(-10, 48), W(10, 50), W(-28, 48), W(28, 48), W(-42.5, 48), W(42.5, 48),
  // A long
  W(-42.5, 36), W(-42.5, 26), W(-42.5, 17), W(-42.5, 12.5), W(-42.5, 6), W(-42.5, 1), W(-42.5, -4), W(-42.5, -12, ['A']),
  // the cut
  W(-32, 12.5), W(-20, 12.5), W(-10, 12.5),
  // mid
  W(0, 38), W(0, 28), W(0, 20), W(0, 12.5), W(0, 2), W(0, -5), W(0, -10),
  // east connector
  W(10, 24.5), W(22, 24.5), W(34, 24.5),
  // B tunnel
  W(42.5, 36), W(42.5, 24.5), W(42.5, 16), W(42.5, 11), W(42.5, 6), W(42.5, -4), W(42.5, -12, ['B']),
  // courtyard
  W(-8, -14), W(8, -14), W(-16, -16), W(16, -16),
  W(0, -23, ['holdMid'], [0, -2]),
  W(-16, -24, ['holdMid'], [-22, -16]),
  W(16, -24), W(-16, -35), W(16, -35), W(-16, -46), W(16, -46),
  // A short + A site
  W(-22, -16, ['A']), W(-28, -16, ['A']), W(-36, -18, ['A']), W(-44, -18, ['A']), W(-30, -24, ['A']),
  W(-35, -31, ['A', 'plantA']),
  W(-41, -41, ['A', 'holdA'], [-42.5, -12]),
  W(-27, -36, ['A']),
  W(-26, -30, ['A', 'holdA'], [-22, -16]),
  W(-44, -32, ['A']), W(-34, -47, ['A']), W(-40, -53, ['A']), W(-30, -53),
  // CT strip & spawn
  W(-22, -53), W(-12, -53), W(0, -53), W(12, -53), W(22, -53),
  // B short + B site
  W(22, -42, ['B']), W(27, -37, ['B', 'holdB'], [22, -42]),
  W(34, -39, ['B', 'plantB']),
  W(40, -36, ['B', 'holdB'], [42.5, -12]),
  W(36, -44, ['B']), W(28, -20, ['B']), W(35, -18, ['B']), W(43, -18, ['B']), W(36, -26, ['B']), W(44, -44, ['B']),
  W(30, -53, ['B']), W(40, -53, ['B']),
];

export const QUARRY: MapDef = {
  name: 'Quarry',
  bounds: { min: [-47, -57], max: [47, 57] },
  blocks,
  labels: [
    { text: 'A', pos: [-23.02, 3.2, -32], rotY: -Math.PI / 2, size: 4, color: '#f2c14e' },
    { text: 'A', pos: [-38.02, 3.8, -6], rotY: -Math.PI / 2, size: 2.5, color: '#f2c14e' },
    { text: 'B', pos: [23.02, 3.2, -32], rotY: Math.PI / 2, size: 4, color: '#4ec3f2' },
    { text: 'B', pos: [38.02, 2.2, 36], rotY: Math.PI / 2, size: 2.5, color: '#4ec3f2' },
    { text: 'MID', pos: [0, 5.5, -3.98], rotY: 0, size: 2.2, color: '#e8e1d0' },
  ],
  sites: [
    { name: 'A', min: [-44, -44], max: [-26, -24] },
    { name: 'B', min: [26, -46], max: [45, -24] },
  ],
  spawns: {
    attack: [
      { pos: [0, 0, 53], yaw: 0 }, { pos: [-3, 0, 54], yaw: 0 }, { pos: [3, 0, 54], yaw: 0 },
      { pos: [-6, 0, 52], yaw: 0 }, { pos: [6, 0, 52], yaw: 0 },
    ],
    defend: [
      { pos: [0, 0, -54], yaw: Math.PI }, { pos: [-4, 0, -54], yaw: Math.PI }, { pos: [4, 0, -54], yaw: Math.PI },
      { pos: [-8, 0, -52], yaw: Math.PI }, { pos: [8, 0, -52], yaw: Math.PI },
    ],
  },
  buyZones: {
    attack: { min: [-47, 41], max: [47, 57] },
    defend: { min: [-21, -57], max: [21, -49] },
  },
  waypoints,
};
