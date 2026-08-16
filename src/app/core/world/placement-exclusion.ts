import { RoadNetwork } from './road-network';

export interface ExclusionZone {
  contains(x: number, z: number): boolean;
}

export function createRoadExclusionZone(roads: RoadNetwork, margin: number): ExclusionZone {
  const clearance = roads.width / 2 + margin;
  return {
    contains: (x, z) => roads.distanceToNearest(x, z) <= clearance
  };
}

export function createCircleExclusionZone(center: { x: number; z: number }, radius: number): ExclusionZone {
  return {
    contains: (x, z) => {
      const dx = x - center.x;
      const dz = z - center.z;
      return dx * dx + dz * dz <= radius * radius;
    }
  };
}

export function isExcluded(x: number, z: number, zones: readonly ExclusionZone[]): boolean {
  return zones.some((zone) => zone.contains(x, z));
}
