// Jediný zdroj pravdy pro rozměry mapy - dřív duplikováno zvlášť v ThreeSceneService
// (vizuální mesh), PhysicsService (fyzikální heightfield) a GameCanvasComponent
// (WORLD_BOUNDS pro umisťování stromů), s rizikem že se při změně velikosti mapy
// rozejdou. Změna velikosti mapy je teď editace jen tohoto souboru.
export const TERRAIN_WIDTH = 220;
export const TERRAIN_DEPTH = 300;
export const TERRAIN_SEGMENTS_X = 220;
export const TERRAIN_SEGMENTS_Z = 300;

export interface WorldBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export const WORLD_BOUNDS: WorldBounds = {
  minX: -TERRAIN_WIDTH / 2,
  maxX: TERRAIN_WIDTH / 2,
  minZ: -TERRAIN_DEPTH / 2,
  maxZ: TERRAIN_DEPTH / 2
};
