import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { ITEM_DEFS } from '../../shared/models/item.model';
import { CollisionService } from '../engine/collision.service';
import { ThreeSceneService } from '../engine/three-scene.service';
import { PhysicsService } from '../engine/physics.service';
import { InventoryService } from '../state/inventory.service';
import { PlayerStateService } from '../state/player-state.service';
import { ShopConfig, ShopEntity } from './shop.entity';

@Injectable({ providedIn: 'root' })
export class ShopService {
  private readonly shops = new Map<string, ShopEntity>();

  constructor(
    private readonly scene: ThreeSceneService,
    private readonly collision: CollisionService,
    private readonly physics: PhysicsService,
    private readonly playerState: PlayerStateService,
    private readonly inventory: InventoryService
  ) {}

  spawnShop(config: ShopConfig): void {
    const shop = new ShopEntity(config, new Set(this.inventory.ownedIds()));
    this.shops.set(shop.id, shop);
    this.scene.addToScene(shop.group);

    for (const wall of shop.wallBoxColliders) {
      this.physics.createStaticBoxCollider(
        shop.group.position.x + wall.center.x,
        shop.group.position.y + wall.center.y,
        shop.group.position.z + wall.center.z,
        wall.halfExtents
      );
    }

    this.collision.registerBoxes(
      shop.id,
      shop.wallBoxColliders.map((wall) => ({
        center: {
          x: shop.group.position.x + wall.center.x,
          y: shop.group.position.y + wall.center.y,
          z: shop.group.position.z + wall.center.z
        },
        halfExtents: wall.halfExtents
      }))
    );

    for (let i = 0; i < shop.groundWallSegments.length; i++) {
      const segment = shop.groundWallSegments[i];
      this.registerGroundSegmentColliders(shop, segment, i);
    }

    for (const { itemId, anchor } of shop.purchasableItems) {
      const item = ITEM_DEFS[itemId];
      this.scene.registerInteractable(anchor, {
        id: `${shop.id}-item-${itemId}`,
        label: item.name,
        interactPrompt: `Stiskni E pro koupi (🪙 ${item.price})`,
        onUse: () => this.tryBuy(shop, itemId)
      });
    }
  }

  dispose(): void {
    for (const shop of this.shops.values()) {
      for (const { anchor } of shop.purchasableItems) this.scene.unregisterInteractable(anchor);
    }
    this.shops.clear();
  }

  private tryBuy(shop: ShopEntity, itemId: string): void {
    if (this.inventory.owns(itemId)) return;
    const item = ITEM_DEFS[itemId];
    const anchor = shop.purchasableItems.find((entry) => entry.itemId === itemId)?.anchor;
    if (!this.playerState.spendMoney(item.price)) return;
    this.inventory.acquire(itemId);
    shop.removeItem(itemId);
    if (anchor) this.scene.unregisterInteractable(anchor);
  }

  private registerGroundSegmentColliders(
    shop: ShopEntity,
    segment: { start: THREE.Vector2; end: THREE.Vector2; radius: number },
    segmentIndex: number
  ): void {
    const length = segment.start.distanceTo(segment.end);
    const count = Math.max(2, Math.ceil(length / segment.radius));
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const point = segment.start.clone().lerp(segment.end, t);
      this.collision.register(`${shop.id}-wall-${segmentIndex}-${i}`, {
        x: shop.group.position.x + point.x,
        z: shop.group.position.z + point.y,
        radius: segment.radius
      });
    }
  }
}
