export type AnimalVariant = 'frog' | 'stag';

export interface BiomeAnimalConfig {
  readonly density: number;
  readonly weights: Record<AnimalVariant, number>;
  readonly minSpacing: number;
}
