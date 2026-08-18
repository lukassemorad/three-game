import { BiomeAnimalConfig } from './animal.model';
import { TreeVariant } from './tree.model';
import { BiomeVegetationConfig } from './vegetation.model';

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
  readonly vegetation?: BiomeVegetationConfig;
  readonly animals?: BiomeAnimalConfig;
}
