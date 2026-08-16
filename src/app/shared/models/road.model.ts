export interface RoadPoint {
  readonly x: number;
  readonly z: number;
}

export interface RoadDefinition {
  readonly points: readonly RoadPoint[];
  readonly width: number;
  readonly surfaceColor: string | number;
}
