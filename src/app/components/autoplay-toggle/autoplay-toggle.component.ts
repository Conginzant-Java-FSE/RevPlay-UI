import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AutoplayService } from '../../services/autoplay.service';

@Component({
  selector: 'app-autoplay-toggle',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './autoplay-toggle.component.html',
  styleUrl: './autoplay-toggle.component.scss'
})
export class AutoplayToggleComponent {
  readonly enabled$;

  constructor(private autoplayService: AutoplayService) {
    this.enabled$ = this.autoplayService.enabled$;
  }

  toggle(): void {
    this.autoplayService.toggle();
  }
}
