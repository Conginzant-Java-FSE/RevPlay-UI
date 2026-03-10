import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { AppTheme, ThemeService } from '../../core/services/theme.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss']
})
export class SettingsComponent {
  readonly supportEmail = 'revplay.support@gmail.com';
  readonly theme$: Observable<AppTheme>;
  activeSection: 'theme' | 'support' = 'theme';
  supportForm = {
    name: '',
    email: '',
    problem: ''
  };

  constructor(private readonly themeService: ThemeService) {
    this.theme$ = this.themeService.theme$;
  }

  setTheme(theme: AppTheme): void {
    this.themeService.setTheme(theme);
  }

  showSection(section: 'theme' | 'support'): void {
    this.activeSection = section;
  }

  sendEmail(): void {
    const name = this.supportForm.name.trim();
    const email = this.supportForm.email.trim();
    const problem = this.supportForm.problem.trim();
    const subject = 'RevPlay Support Request';
    const body = `Name: ${name}\nEmail: ${email}\nProblem: ${problem}`;
    const gmailUrl =
      'https://mail.google.com/mail/?view=cm' +
      `&to=${encodeURIComponent(this.supportEmail)}` +
      `&su=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(body)}`;

    window.open(gmailUrl, '_blank');
  }
}
