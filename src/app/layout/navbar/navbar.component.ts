import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../core/services/auth';
import { hasRole } from '../../core/utils/role.util';
import { environment } from '../../../environments/environment';
import { PremiumService } from '../../core/services/premium.service';

@Component({
  selector: 'app-navbar',
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule]
})
export class NavbarComponent {
  user: any = null;
  profileImageUrl = '';
  isPremiumUser = false;
  private readonly apiOrigin = environment.apiUrl.replace(/\/api\/v1$/, '');

  constructor(
    private authService: AuthService,
    private premiumService: PremiumService
  ) {
    this.authService.currentUser$.subscribe((user) => {
      this.user = user;
      this.refreshProfileImage();
    });
    this.premiumService.status$.subscribe((status) => {
      this.isPremiumUser = !!status?.isPremium;
    });
  }

  logout(): void {
    this.authService.logout().subscribe({
      error: () => {
        // Logout cleanup is already handled in AuthService on error as well.
      }
    });
  }

  get displayName(): string {
    const byDisplayName = String(this.user?.displayName ?? '').trim();
    if (byDisplayName) {
      return byDisplayName;
    }

    const byFullName = String(this.user?.fullName ?? '').trim();
    if (byFullName) {
      return byFullName;
    }

    return String(this.user?.username ?? 'User');
  }

  get profileLink(): string {
    if (hasRole(this.user, 'ARTIST')) {
      return '/creator-studio/profile';
    }
    return '/profile';
  }

  onAvatarLoadError(): void {
    this.profileImageUrl = '';
  }

  private refreshProfileImage(): void {
    if (!this.user) {
      this.profileImageUrl = '';
      return;
    }

    const directImage = this.resolveProfileImage(
      this.user?.profilePictureUrl ??
      this.user?.profileImageUrl ??
      this.user?.avatarUrl ??
      ''
    );
    if (directImage) {
      this.profileImageUrl = directImage;
      return;
    }
    this.profileImageUrl = '';
  }

  private resolveProfileImage(rawValue: any): string {
    const value = String(rawValue ?? '').trim();
    if (!value) {
      return '';
    }

    if (value.startsWith('http://') || value.startsWith('https://')) {
      return value;
    }

    if (value.startsWith('/api/v1/')) {
      return `${this.apiOrigin}${value}`;
    }

    if (value.startsWith('/files/images/')) {
      return `${this.apiOrigin}/api/v1${value}`;
    }

    if (value.startsWith('files/images/')) {
      return `${this.apiOrigin}/api/v1/${value}`;
    }

    if (!value.includes('/')) {
      return `${environment.apiUrl}/files/images/${encodeURIComponent(value)}`;
    }

    return value;
  }
}
