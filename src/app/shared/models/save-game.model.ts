import { TreeLifecycle } from './interactable.model';
import { TreeVariant } from './tree.model';

export const SAVE_SCHEMA_VERSION = 1;

export interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface QuatLike {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export interface TreeSectorHit {
  readonly sector: number;
  readonly hitY: number;
}

export interface TreeSaveState {
  readonly position: Vec3Like;
  readonly rotation: QuatLike;
  readonly variant: TreeVariant;
  readonly sectorCount: number;
  readonly woodYield: number;
  readonly choppedSectorHits: readonly TreeSectorHit[];
  readonly lifecycle: TreeLifecycle;
  readonly fallProgress: number;
  readonly fallAxis: Vec3Like | null;
}

export interface PlayerSaveState {
  readonly money: number;
  readonly treesChoppedCount: number;
  readonly position: Vec3Like;
  readonly rotation: QuatLike;
}

export interface IntactTreeSaveState {
  readonly position: Vec3Like;
  readonly variant: TreeVariant;
}

export interface SaveGame {
  readonly schemaVersion: number;
  readonly savedAt: string;
  readonly player: PlayerSaveState;
  // Nedotčené (nikdy zasažené) stromy nesou jen pozici+variantu - vykreslují se
  // instancovaně (viz InstancedTreeBatch) a žádný jiný stav nemají.
  readonly intactTrees: readonly IntactTreeSaveState[];
  // Stromy, které už dostaly aspoň jeden zásah (rozsekané/padající/ležící) - povýšené
  // na plnohodnotnou TreeEntity, nesou plný stav pro přesnou obnovu.
  readonly trees: readonly TreeSaveState[];
}
