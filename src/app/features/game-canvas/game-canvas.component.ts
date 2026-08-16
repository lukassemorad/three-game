import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild
} from '@angular/core';
import { ThreeSceneService } from '../../core/engine/three-scene.service';

@Component({
  selector: 'app-game-canvas',
  templateUrl: './game-canvas.component.html',
  styleUrl: './game-canvas.component.scss'
})
export class GameCanvasComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas', { static: true })
  private canvasRef!: ElementRef<HTMLCanvasElement>;

  constructor(private readonly threeScene: ThreeSceneService) {}

  ngAfterViewInit(): void {
    this.threeScene.init(this.canvasRef.nativeElement);
  }

  ngOnDestroy(): void {
    this.threeScene.dispose();
  }

  @HostListener('window:resize')
  onResize(): void {
    const canvas = this.canvasRef.nativeElement;
    this.threeScene.resize(canvas.clientWidth, canvas.clientHeight);
  }
}
