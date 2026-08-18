// Deterministický pseudo-náhodný hash z world pozice ([0,1)) - stejná pozice dá vždy
// stejnou hodnotu. Díky tomu je vizuální variace (rotace/škála/tón) stabilní i po
// znovunačtení a IDENTICKÁ mezi instancovanou dávkou a jakoukoliv "povýšenou" reprezentací
// stejného objektu na stejné pozici (viz tree.entity.ts, instanced-vegetation-batch.ts).
export function positionHash(x: number, z: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

export interface VisualVariationRange {
  readonly scaleMin: number;
  readonly scaleRange: number;
  readonly tintMin: number;
  readonly tintRange: number;
}

export interface VisualVariation {
  readonly rotationY: number;
  readonly scale: number;
  readonly tint: number;
}

// Offsety (+71.3/-13.7, -45.2/+88.9) jen posouvají vzorkovací bod v hashovaném poli, aby
// škála a tón nebyly odvozené ze stejné hodnoty jako rotace (jinak by spolu perfektně
// korelovaly - vyšší rotace by vždy znamenala stejnou škálu).
export function getVisualVariation(x: number, z: number, range: VisualVariationRange): VisualVariation {
  return {
    rotationY: positionHash(x, z) * Math.PI * 2,
    scale: range.scaleMin + positionHash(x + 71.3, z - 13.7) * range.scaleRange,
    tint: range.tintMin + positionHash(x - 45.2, z + 88.9) * range.tintRange
  };
}
