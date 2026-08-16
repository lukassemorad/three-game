import { TreeVariant } from './tree.model';

export type BiomeId = 'meadow' | 'highlands' | 'mountains';

export interface BiomeDefinition {
  readonly id: BiomeId;
  readonly treeWeights: Record<TreeVariant, number>;
  readonly treeDensity: number;
}
