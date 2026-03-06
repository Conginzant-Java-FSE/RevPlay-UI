import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../core/services/auth';
import { hasAnyRole, hasRole } from '../../core/utils/role.util';

@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SidebarComponent implements OnInit {
  user: any = null;

  constructor(
    private authService: AuthService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.authService.currentUser$.subscribe(user => {
      this.user = user;
      this.cdr.markForCheck();
    });
  }

  get isArtist(): boolean {
    return hasAnyRole(this.user, ['ARTIST']);
  }

  get isListener(): boolean {
    return hasAnyRole(this.user, ['LISTENER']);
  }

  get isAdmin(): boolean {
    return hasRole(this.user, 'ADMIN');
  }

  get profileLink(): string {
    if (hasRole(this.user, 'ARTIST')) {
      return '/creator-studio/profile';
    }
    return '/profile';
  }
}
