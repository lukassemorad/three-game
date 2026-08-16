export type InteractionKind = 'choppable';

export type TreeLifecycle = 'standing' | 'falling' | 'fallen';

export interface Choppable {
  readonly kind: 'choppable';
  readonly sectorCount: number;
  readonly choppedSectors: Set<number>;
  lastHitSector: number | null;
  lifecycle: TreeLifecycle;
  fallProgress: number;
  readonly resource: { readonly type: 'wood'; readonly amount: number };
}
