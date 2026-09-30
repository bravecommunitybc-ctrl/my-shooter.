import type { V3 } from '../physics/AABB';

export type MatId = 'sand' | 'concrete' | 'wall' | 'crate' | 'metal' | 'trim' | 'pad';

export interface BlockDef {
  min: V3;
  max: V3;
  mat: MatId;
  /** visual only */
  noCollide?: boolean;
}

/** xz rectangle */
export interface Rect {
  min: [number, number];
  max: [number, number];
}

export interface SiteDef extends Rect {
  name: 'A' | 'B';
}

export interface WaypointDef {
  pos: [number, number];
  /** 'A' / 'B' area, 'plantA'… plant spots, 'holdA'… defender posts */
  tags?: string[];
  /** where a bot holding this node should look (xz) */
  look?: [number, number];
}

export interface LabelDef {
  text: string;
  pos: V3;
  /** rotation around Y so the label faces its normal */
  rotY: number;
  size: number;
  color: string;
}

export interface SpawnDef {
  pos: V3;
  yaw: number;
}

export interface MapDef {
  name: string;
  bounds: { min: [number, number]; max: [number, number] };
  blocks: BlockDef[];
  labels: LabelDef[];
  sites: SiteDef[];
  spawns: { attack: SpawnDef[]; defend: SpawnDef[] };
  /** xz rectangles where buying is allowed */
  buyZones: { attack: Rect; defend: Rect };
  waypoints: WaypointDef[];
}
