// Sdílené bucketování 2D souřadnic do čtvercových chunků - stejná myšlenka jako
// SpatialGrid, ale bez jeho registru položek (SpatialGrid slouží nearest-neighbor
// dotazům pro kolize/placement, tohle jen odvozuje klíč/střed chunku pro renderovací
// dávky - viz TreeService, případně budoucí tráva).

// Sdíleno mezi TreeService (dělení instancovaných dávek) a ThreeSceneService
// (rozšíření prefiltru v filterNearbyInteractables) - jedna konstanta, ne dvě
// duplicity, které by se časem mohly rozejít.
export const TREE_CHUNK_SIZE = 40;

export function getChunkKey(x: number, z: number, chunkSize: number): string {
  const cx = Math.floor(x / chunkSize);
  const cz = Math.floor(z / chunkSize);
  return `${cx},${cz}`;
}

export function getChunkCenter(chunkKey: string, chunkSize: number): { x: number; z: number } {
  const [cx, cz] = chunkKey.split(',').map(Number);
  return { x: (cx + 0.5) * chunkSize, z: (cz + 0.5) * chunkSize };
}
