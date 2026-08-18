// Vážené losování z libovolné množiny klíčů podle číselných vah (viz tree-placement.ts,
// vegetation-placement.ts) - váhy nemusí sečíst na 1, jen na sebe navzájem poměrově.
export function pickWeightedVariant<TVariant extends string>(weights: Record<TVariant, number>): TVariant {
  const entries = Object.entries(weights) as Array<[TVariant, number]>;
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = Math.random() * total;
  for (const [variant, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return variant;
  }
  return entries[entries.length - 1][0];
}
