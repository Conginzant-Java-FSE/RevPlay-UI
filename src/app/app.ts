import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './core/services/theme.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('revplay-frontend');

  constructor(private readonly themeService: ThemeService) {
    // Ensure persisted theme is applied as early as possible.
    this.themeService.setTheme(this.themeService.theme);
  }
}
