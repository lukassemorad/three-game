// Ground-cover = hustý "koberec" pokrývající celou plochu biomu (dominantní tráva + pár
// řídce přimíchaných variant). Accent = řídké, rozestupem hlídané kusy navrch (květiny,
// keře, houby) - viz vegetation-placement.ts.
export type GroundCoverVariant = 'grassPatch' | 'tuftOfGrass';
export type AccentVariant = 'dandelions' | 'tulip' | 'bush' | 'bushFlowers' | 'mushroom';
export type VegetationVariant = GroundCoverVariant | AccentVariant;

export interface BiomeVegetationConfig {
  readonly groundCoverDensity: number;
  readonly groundCoverWeights: Record<GroundCoverVariant, number>;
  readonly accentDensity: number;
  readonly accentWeights: Record<AccentVariant, number>;
  readonly accentMinSpacing: number;
}
