import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ThreeSceneService } from '../../core/engine/three-scene.service';
import { InventoryService } from '../../core/state/inventory.service';

@Component({
  selector: 'app-hotbar',
  templateUrl: './hotbar.component.html',
  styleUrl: './hotbar.component.scss'
})
export class HotbarComponent implements OnInit, OnDestroy {
  private readonly threeScene = inject(ThreeSceneService);
  private readonly inventory = inject(InventoryService);

  protected readonly slots = this.inventory.slots;
  protected readonly activeIndex = this.inventory.activeIndex;

  private readonly onScroll = (direction: 1 | -1) => this.inventory.cycle(direction);

  ngOnInit(): void {
    this.threeScene.onScroll(this.onScroll);
  }

  ngOnDestroy(): void {
    this.threeScene.offScroll(this.onScroll);
  }
}
