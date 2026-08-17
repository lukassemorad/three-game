export interface ItemDef {
  readonly id: string;
  readonly name: string;
  readonly price: number;
  readonly damage: number;
  readonly icon: string; // emoji do hotbar slotu
  // Chybí u ruky (žádný model - kreslí se přímo v PlayerHandEntity) - u koupitelných
  // nástrojů se stejný model použije na poličce v obchodě i připojený na ruku.
  readonly modelUrl?: string;
  readonly targetSize?: number; // metry - škáluje se podle největšího rozměru bbox modelu
  readonly rotationX?: number;
  readonly rotationY?: number;
  readonly rotationZ?: number;
  // Sekundy mezi automatickými zásahy, když hráč drží LMB - bez tohoto pole se drží
  // klasické chování "jeden klik = jeden zásah" (viz ThreeSceneService.tickAutoFire).
  readonly autoFireInterval?: number;
}

export const HAND_ITEM: ItemDef = { id: 'hand', name: 'Ruka', price: 0, damage: 1, icon: '✋' };

// Názvy souborů obsahují mezery - encodeURI, jinak by GLTFLoader posílal neplatnou URL.
export const ITEM_DEFS: Readonly<Record<string, ItemDef>> = {
  hatchet: {
    id: 'hatchet',
    name: 'Sekerka',
    price: 99,
    damage: 2,
    icon: '🪓',
    modelUrl: encodeURI('assets/models/Hatchet by Poly by Google - cu35V2x-P-6.glb'),
    targetSize: 0.45,
    rotationZ: Math.PI / 2,
    rotationY: Math.PI,
    rotationX: Math.PI
  },
  axeDouble: {
    id: 'axeDouble',
    name: 'Dvoubřitá sekera',
    price: 149,
    damage: 3,
    icon: '🪓',
    modelUrl: encodeURI('assets/models/Axe Double by Quaternius - uHXdfMmO8g.glb'),
    targetSize: 0.5,
    rotationY: Math.PI / 2
  },
  chainsaw: {
    id: 'chainsaw',
    name: 'Motorová pila',
    price: 499,
    damage: 6,
    icon: '⚙️',
    modelUrl: encodeURI('assets/models/Chainsaw pole by CreativeTrio - 2E38b8bNfm.glb'),
    targetSize: 0.65,
    rotationZ: Math.PI / 2,
    autoFireInterval: 0.2
  }
};

export const SHOP_ITEM_IDS: readonly string[] = ['hatchet', 'axeDouble', 'chainsaw'];
