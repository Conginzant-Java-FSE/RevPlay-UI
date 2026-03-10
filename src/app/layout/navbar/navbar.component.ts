import { Component, EventEmitter, OnDestroy, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { Subscription, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { AuthService } from '../../core/services/auth';
import { hasRole } from '../../core/utils/role.util';
import { PremiumService } from '../../core/services/premium.service';
import { ArtistService } from '../../core/services/artist.service';
import { ApiService } from '../../core/services/api';
import { ProtectedMediaPipe } from '../../core/pipes/protected-media.pipe';
import { StateService } from '../../core/services/state.service';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-navbar',
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, ProtectedMediaPipe]
})
export class NavbarComponent implements OnDestroy {
  private readonly artistProfileImageCacheKey = 'revplay_artist_profile_image_cache_v1';
  user: any = null;
  profileImageUrl = '';
  isPremiumUser = false;
  searchQuery = '';
  @Output() toggleSidebar = new EventEmitter<void>();
  private readonly subscriptions = new Subscription();

  constructor(
    private authService: AuthService,
    private premiumService: PremiumService,
    private artistService: ArtistService,
    private apiService: ApiService,
    private stateService: StateService,
    private router: Router
  ) {
    this.subscriptions.add(this.authService.currentUser$.subscribe((user) => {
      this.user = user;
      this.refreshProfileImage();
    }));
    this.subscriptions.add(this.premiumService.status$.subscribe((status) => {
      this.isPremiumUser = !!status?.isPremium;
    }));
    this.subscriptions.add(this.stateService.artistId$.subscribe(() => {
      this.refreshProfileImage();
    }));
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  logout(): void {
    this.authService.logout().subscribe({
      error: () => {
        // Logout cleanup is already handled in AuthService on error as well.
      }
    });
  }

  onToggleSidebar(): void {
    this.toggleSidebar.emit();
  }

  submitSearch(): void {
    const term = String(this.searchQuery ?? '').trim();
    if (!term) {
      return;
    }
    this.router.navigate(['/search'], {
      queryParams: {
        q: term,
        type: 'ALL'
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

    const isArtistUser = hasRole(this.user, 'ARTIST');
    const userId = Number(this.user?.userId ?? this.user?.id ?? 0);

    const directImage = this.resolveProfileImage(
      this.user?.profilePictureUrl ??
      this.user?.profileImageUrl ??
      this.user?.profilePictureFileName ??
      this.user?.profileImageFileName ??
      this.user?.profilePicture ??
      this.user?.profileImage ??
      this.user?.avatarUrl ??
      this.user?.avatarFileName ??
      this.user?.avatar ??
      this.user?.imageUrl ??
      this.user?.imageFileName ??
      this.user?.imageName ??
      this.user?.image ??
      this.user?.user?.profilePictureUrl ??
      this.user?.user?.profileImageUrl ??
      this.user?.user?.profilePictureFileName ??
      this.user?.user?.profileImageFileName ??
      this.user?.user?.profilePicture ??
      this.user?.user?.profileImage ??
      this.user?.user?.avatarUrl ??
      this.user?.user?.avatarFileName ??
      this.user?.user?.avatar ??
      this.user?.user?.imageUrl ??
      this.user?.artist?.profilePictureUrl ??
      this.user?.artist?.profileImageUrl ??
      this.user?.artist?.profilePictureFileName ??
      this.user?.artist?.profileImageFileName ??
      this.user?.artist?.profilePicture ??
      this.user?.artist?.profileImage ??
      this.user?.artist?.avatarUrl ??
      this.user?.artist?.avatarFileName ??
      this.user?.artist?.avatar ??
      this.user?.artist?.imageUrl ??
      this.user?.artist?.imageFileName ??
      this.user?.artist?.imageName ??
      ''
    );
    if (directImage && !(isArtistUser && this.isProtectedFileUrl(directImage))) {
      this.cacheProfileImage(userId, directImage);
      this.profileImageUrl = directImage;
      return;
    }

    const cachedImage = this.getCachedProfileImage(userId);
    if (cachedImage) {
      this.profileImageUrl = cachedImage;
      return;
    }

    const artistId = Number(
      this.user?.artistId ??
      this.user?.artist?.artistId ??
      this.user?.artist?.id ??
      this.stateService.getArtistIdForUser(userId) ??
      this.stateService.artistId ??
      0
    );

    const profileImage$ = !isArtistUser && userId > 0
      ? this.apiService.get<any>(`/profile/${userId}`).pipe(
          map((profile) => this.resolveProfileImage(
            profile?.profilePictureUrl ??
            profile?.profileImageUrl ??
            profile?.profilePictureFileName ??
            profile?.profileImageFileName ??
            profile?.profilePicture ??
            profile?.profileImage ??
            profile?.avatarUrl ??
            profile?.avatarFileName ??
            profile?.avatar ??
            profile?.imageUrl ??
            profile?.imageFileName ??
            profile?.imageName ??
            profile?.image ??
            ''
          )),
          catchError(() => of(''))
        )
      : of('');

    profileImage$.subscribe((profileImage) => {
      if (profileImage) {
        this.cacheProfileImage(userId, profileImage);
        this.profileImageUrl = profileImage;
        this.authService.updateCurrentUser({ profilePictureUrl: profileImage });
        return;
      }

      if (isArtistUser || artistId <= 0) {
        this.profileImageUrl = '';
        return;
      }

      this.artistService.getArtistProfile(artistId).pipe(
        map((artist) => this.resolveProfileImage(
          artist?.profilePictureUrl ??
          artist?.profileImageUrl ??
          artist?.profilePictureFileName ??
          artist?.profileImageFileName ??
          artist?.profilePicture ??
          artist?.profileImage ??
          artist?.avatarUrl ??
          artist?.avatarFileName ??
          artist?.avatar ??
          artist?.imageUrl ??
          artist?.imageFileName ??
          artist?.imageName ??
          artist?.image ??
          artist?.user?.profilePictureUrl ??
          artist?.user?.profilePictureFileName ??
          artist?.user?.profilePicture ??
          ''
        )),
        catchError(() => of(''))
      ).subscribe((artistImage) => {
        this.profileImageUrl = artistImage;
        if (artistImage) {
          this.cacheProfileImage(userId, artistImage);
          this.authService.updateCurrentUser({ profilePictureUrl: artistImage, artistId });
        }
      });
    });
  }

  private resolveProfileImage(rawValue: any): string {
    const value = String(rawValue ?? '').trim();
    if (!value) {
      return '';
    }
    return this.artistService.resolveImageUrl(value);
  }

  private getCachedProfileImage(userId: number): string {
    if (userId <= 0) {
      return '';
    }

    try {
      const raw = localStorage.getItem(this.artistProfileImageCacheKey);
      if (!raw) {
        return '';
      }
      const parsed = JSON.parse(raw);
      return String(parsed?.[String(userId)] ?? '').trim();
    } catch {
      return '';
    }
  }

  private cacheProfileImage(userId: number, imageUrl: string): void {
    const normalizedUserId = Number(userId ?? 0);
    const normalizedImageUrl = String(imageUrl ?? '').trim();
    if (
      normalizedUserId <= 0 ||
      !normalizedImageUrl ||
      this.isProtectedFileUrl(normalizedImageUrl)
    ) {
      return;
    }

    try {
      const raw = localStorage.getItem(this.artistProfileImageCacheKey);
      const parsed = raw ? JSON.parse(raw) : {};
      const next = parsed && typeof parsed === 'object' ? parsed : {};
      next[String(normalizedUserId)] = normalizedImageUrl;
      localStorage.setItem(this.artistProfileImageCacheKey, JSON.stringify(next));
    } catch {
      // Ignore cache write failures.
    }
  }

  private isProtectedFileUrl(value: string): boolean {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    if (normalized.startsWith('data:image/')) {
      return false;
    }
    return normalized.includes('/api/v1/files/') || normalized.includes('/files/');
  }
}
