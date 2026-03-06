import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observable } from 'rxjs';
import { AppTheme, ThemeService } from '../../core/services/theme.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss']
})
export class SettingsComponent {
  readonly theme$: Observable<AppTheme>;

  constructor(private readonly themeService: ThemeService) {
    this.theme$ = this.themeService.theme$;
  }

  setTheme(theme: AppTheme): void {
    this.themeService.setTheme(theme);
  }
}
