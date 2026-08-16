import { TreeVariant } from './tree.model';

export type BiomeId = 'meadow' | 'highlands' | 'mountains';

export interface RareTreeEntry {
  readonly variant: TreeVariant;
  readonly count: number;
  readonly minSpacing?: number;
}

export interface BiomeDefinition {
  readonly id: BiomeId;
  readonly treeWeights: Record<TreeVariant, number>;
  readonly treeDensity: number;
  readonly rareTrees?: readonly RareTreeEntry[];
}
