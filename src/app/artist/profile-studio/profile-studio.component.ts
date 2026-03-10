import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HttpEventType } from '@angular/common/http';
import { forkJoin, of } from 'rxjs';
import { catchError, switchMap, take, timeout } from 'rxjs/operators';
import { ArtistService } from '../../core/services/artist.service';
import { StateService } from '../../core/services/state.service';
import { AuthService } from '../../core/services/auth';
import { resolveHttpErrorMessage } from '../../core/utils/error-message.util';
import { ApiService } from '../../core/services/api';
import { hasRole } from '../../core/utils/role.util';

type ArtistType = 'MUSIC' | 'PODCAST' | 'BOTH';
type SocialPlatform = 'INSTAGRAM' | 'TWITTER' | 'YOUTUBE' | 'SPOTIFY' | 'WEBSITE' | 'OTHER';

@Component({
  selector: 'app-profile-studio',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './profile-studio.component.html',
  styleUrls: ['./profile-studio.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ProfileStudioComponent implements OnInit {
  private readonly artistProfileImageCacheKey = 'revplay_artist_profile_image_cache_v1';
  artistId: number | null = null;
  currentUserId: number | null = null;
  isLoading = true;
  isSaving = false;
  isUploadingBanner = false;
  isUploadingProfileImage = false;
  bannerUploadProgress = 0;
  profileImageUploadProgress = 0;
  profileImageLoadError = false;
  profilePictureUrl = '';

  error: string | null = null;
  successMessage: string | null = null;

  profileForm: {
    displayName: string;
    bio: string;
    bannerImageUrl: string;
    artistType: ArtistType;
  } = {
      displayName: '',
      bio: '',
      bannerImageUrl: '',
      artistType: 'BOTH'
    };

  summary: any = null;
  songs: any[] = [];
  albums: any[] = [];
  podcasts: any[] = [];
  socialLinks: any[] = [];
  isVerified = false;

  newLink: { platform: SocialPlatform; url: string } = {
    platform: 'INSTAGRAM',
    url: ''
  };
  editingLinkId: number | null = null;
  editLink: { platform: SocialPlatform; url: string } = {
    platform: 'INSTAGRAM',
    url: ''
  };

  readonly artistTypes: ArtistType[] = ['MUSIC', 'PODCAST', 'BOTH'];
  readonly socialPlatforms: SocialPlatform[] = ['INSTAGRAM', 'TWITTER', 'YOUTUBE', 'SPOTIFY', 'WEBSITE', 'OTHER'];

  constructor(
    private artistService: ArtistService,
    private stateService: StateService,
    private authService: AuthService,
    private apiService: ApiService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.initializeUserProfileContext();
    this.bootstrapArtistContext();
  }

  onProfileImageSelected(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0] ?? null;
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      this.error = 'Please select a valid image file.';
      this.cdr.markForCheck();
      return;
    }

    this.isUploadingProfileImage = true;
    this.profileImageUploadProgress = 0;
    this.clearMessages();
    this.cdr.markForCheck();

    this.artistService.uploadImage(file).pipe(
      switchMap((uploadEvent: any) => {
        if (uploadEvent.type === HttpEventType.UploadProgress && uploadEvent.total) {
          this.profileImageUploadProgress = Math.round((uploadEvent.loaded / uploadEvent.total) * 100);
          this.cdr.markForCheck();
          return of(null);
        }

        if (uploadEvent.type !== HttpEventType.Response) {
          return of(null);
        }

        const imageUrl = this.artistService.resolveUploadedImageUrl(uploadEvent);
        if (!imageUrl) {
          this.isUploadingProfileImage = false;
          this.error = 'Image uploaded but URL is missing in response.';
          this.cdr.markForCheck();
          return of(null);
        }

        const currentUser = this.authService.getCurrentUserSnapshot();
        const userId = Number(this.currentUserId ?? 0);
        if (userId <= 0) {
          return of({
            profilePictureUrl: imageUrl,
            fullName: this.resolveCurrentDisplayName() || 'Artist',
            bio: '',
            country: ''
          });
        }

        if (hasRole(currentUser, 'ARTIST')) {
          return of({
            profilePictureUrl: imageUrl,
            fullName: this.resolveCurrentDisplayName() || 'Artist',
            bio: '',
            country: ''
          });
        }

        return this.apiService.get<any>(`/profile/${userId}`).pipe(
          catchError(() => of({})),
          switchMap((profilePayload: any) => {
            const profile = profilePayload ?? {};
            const payload = {
              fullName: String(profile?.fullName ?? this.resolveCurrentDisplayName()).trim() || 'Artist',
              bio: String(profile?.bio ?? ''),
              country: String(profile?.country ?? ''),
              profilePictureUrl: imageUrl
            };
            return this.apiService.put<any>(`/profile/${userId}`, payload).pipe(
              catchError(() => of({ ...payload }))
            );
          })
        );
      })
    ).subscribe({
      next: (updatedProfile: any) => {
        if (!updatedProfile) {
          return;
        }
        const persisted = String(updatedProfile?.profilePictureUrl ?? '').trim() || this.profilePictureUrl;
        this.profilePictureUrl = persisted || this.profilePictureUrl;
        this.profileImageLoadError = false;
        this.isUploadingProfileImage = false;
        this.profileImageUploadProgress = 100;
        this.cacheProfileImageForCurrentUser(this.profilePictureUrl, file);
        this.authService.updateCurrentUser({ profilePictureUrl: this.profilePictureUrl });
        this.successMessage = 'Profile image uploaded.';
        this.cdr.markForCheck();
      },
      error: () => {
        this.isUploadingProfileImage = false;
        this.error = 'Failed to upload profile image.';
        this.cdr.markForCheck();
      }
    });
  }

  onBannerImageSelected(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0] ?? null;
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      this.error = 'Please select a valid image file.';
      this.cdr.markForCheck();
      return;
    }

    this.isUploadingBanner = true;
    this.bannerUploadProgress = 0;
    this.clearMessages();
    this.cdr.markForCheck();

    this.artistService.uploadImage(file).subscribe({
      next: (uploadEvent: any) => {
        if (uploadEvent.type === HttpEventType.UploadProgress && uploadEvent.total) {
          this.bannerUploadProgress = Math.round((uploadEvent.loaded / uploadEvent.total) * 100);
          this.cdr.markForCheck();
          return;
        }

        if (uploadEvent.type === HttpEventType.Response) {
          const imageUrl = this.artistService.resolveUploadedImageUrl(uploadEvent);
          if (!imageUrl) {
            this.isUploadingBanner = false;
            this.error = 'Image uploaded but URL is missing in response.';
            this.cdr.markForCheck();
            return;
          }

          this.profileForm.bannerImageUrl = imageUrl;
          this.isUploadingBanner = false;
          this.bannerUploadProgress = 100;
          this.successMessage = 'Banner uploaded. Click Save Profile to persist.';
          this.cdr.markForCheck();
        }
      },
      error: () => {
        this.isUploadingBanner = false;
        this.error = 'Failed to upload banner image.';
        this.cdr.markForCheck();
      }
    });
  }

  getBannerPreviewUrl(): string {
    return this.artistService.resolveImageUrl(this.profileForm.bannerImageUrl);
  }

  getProfileImagePreviewUrl(): string {
    if (!this.profilePictureUrl) {
      return '';
    }
    return this.artistService.resolveImageUrl(this.profilePictureUrl);
  }

  onProfileImageLoadError(): void {
    this.profileImageLoadError = true;
    this.cdr.markForCheck();
  }

  saveProfile(): void {
    if (this.isUploadingBanner) {
      this.error = 'Banner upload is still in progress. Please wait a moment.';
      this.cdr.markForCheck();
      return;
    }

    if (!this.profileForm.displayName.trim()) {
      this.error = 'Display name is required.';
      this.cdr.markForCheck();
      return;
    }

    this.withResolvedArtistId((artistId) => {
      this.isSaving = true;
      this.clearMessages();
      const payload = {
        displayName: this.profileForm.displayName.trim(),
        bio: this.profileForm.bio?.trim() ?? '',
        bannerImageUrl: this.profileForm.bannerImageUrl?.trim() ?? '',
        artistType: this.profileForm.artistType
      };

      this.artistService.updateArtistProfile(artistId, payload).pipe(
        timeout(10000)
      ).subscribe({
        next: (updatedProfile) => {
          this.isSaving = false;
          this.successMessage = 'Profile updated successfully.';
          const resolvedDisplayName = String(updatedProfile?.displayName ?? payload.displayName).trim();
          if (resolvedDisplayName) {
            this.authService.updateCurrentUser({ displayName: resolvedDisplayName });
          }
          this.loadStudioData(true);
        },
        error: (err) => {
          this.isSaving = false;
          this.error = this.extractBackendMessage(err, 'Failed to update artist profile.');
          this.cdr.markForCheck();
        }
      });
    });
  }

  toggleVerify(): void {
    this.withResolvedArtistId((artistId) => {
      this.isSaving = true;
      this.clearMessages();
      const target = !this.isVerified;

      this.artistService.verifyArtist(artistId, target).subscribe({
        next: () => {
          this.isVerified = target;
          this.isSaving = false;
          this.successMessage = target ? 'Artist marked as verified.' : 'Artist marked as unverified.';
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.isSaving = false;
          this.error = this.extractBackendMessage(err, 'Verify action failed. This action may require admin access.');
          this.cdr.markForCheck();
        }
      });
    });
  }

  addSocialLink(): void {
    if (!this.newLink.url.trim()) {
      return;
    }

    this.withResolvedArtistId((artistId) => {
      this.isSaving = true;
      this.clearMessages();

      this.artistService.createArtistSocialLink(artistId, {
        platform: this.newLink.platform,
        url: this.newLink.url.trim()
      }).subscribe({
        next: () => {
          this.newLink = { platform: 'INSTAGRAM', url: '' };
          this.isSaving = false;
          this.successMessage = 'Social link added.';
          this.loadSocialLinks();
        },
        error: (err) => {
          this.isSaving = false;
          this.error = this.extractBackendMessage(err, 'Failed to add social link.');
          this.cdr.markForCheck();
        }
      });
    });
  }

  startEditLink(link: any): void {
    this.editingLinkId = Number(link?.linkId ?? link?.id ?? 0);
    this.editLink = {
      platform: (link?.platform ?? 'INSTAGRAM') as SocialPlatform,
      url: link?.url ?? ''
    };
  }

  cancelEditLink(): void {
    this.editingLinkId = null;
    this.editLink = { platform: 'INSTAGRAM', url: '' };
  }

  saveLinkEdit(): void {
    if (!this.editingLinkId || !this.editLink.url.trim()) {
      return;
    }

    this.withResolvedArtistId((artistId) => {
      this.isSaving = true;
      this.clearMessages();

      this.artistService.updateArtistSocialLink(artistId, this.editingLinkId!, {
        platform: this.editLink.platform,
        url: this.editLink.url.trim()
      }).subscribe({
        next: () => {
          this.isSaving = false;
          this.successMessage = 'Social link updated.';
          this.cancelEditLink();
          this.loadSocialLinks();
        },
        error: (err) => {
          this.isSaving = false;
          this.error = this.extractBackendMessage(err, 'Failed to update social link.');
          this.cdr.markForCheck();
        }
      });
    });
  }

  deleteSocialLink(link: any): void {
    const linkId = Number(link?.linkId ?? link?.id ?? 0);
    if (!linkId) {
      return;
    }

    this.withResolvedArtistId((artistId) => {
      this.isSaving = true;
      this.clearMessages();

      this.artistService.deleteArtistSocialLink(artistId, linkId).subscribe({
        next: () => {
          this.isSaving = false;
          this.successMessage = 'Social link deleted.';
          this.loadSocialLinks();
        },
        error: (err) => {
          this.isSaving = false;
          this.error = this.extractBackendMessage(err, 'Failed to delete social link.');
          this.cdr.markForCheck();
        }
      });
    });
  }

  private bootstrapArtistContext(): void {
    const existingArtistId = this.stateService.artistId;
    if (existingArtistId) {
      this.artistId = existingArtistId;
      this.loadStudioData();
      return;
    }

      this.withResolvedArtistId(() => this.loadStudioData());
  }

  private initializeUserProfileContext(): void {
    const currentUser = this.authService.getCurrentUserSnapshot();
    this.currentUserId = Number(currentUser?.userId ?? currentUser?.id ?? 0) || null;
    this.profilePictureUrl = this.resolveArtistProfileImage(currentUser);
    this.profileImageLoadError = false;

    if (!this.currentUserId || this.currentUserId <= 0) {
      this.cdr.markForCheck();
      return;
    }

    if (hasRole(currentUser, 'ARTIST')) {
      this.cdr.markForCheck();
      return;
    }

    this.apiService.get<any>(`/profile/${this.currentUserId}`).pipe(
      catchError(() => of(null))
    ).subscribe((profile) => {
      const fromProfile = this.resolveArtistProfileImage(profile);
      if (fromProfile) {
        this.profilePictureUrl = fromProfile;
        this.profileImageLoadError = false;
        this.cacheProfileImageForCurrentUser(fromProfile);
        this.authService.updateCurrentUser({ profilePictureUrl: fromProfile });
      }
      this.cdr.markForCheck();
    });
  }

  private retryResolveArtist(username: string, retries: number, onResolved?: (artistId: number) => void): void {
    this.artistService.findArtistByUsername(username).subscribe({
      next: (retryResponse) => {
        const retryItems = retryResponse?.content ?? [];
        const retryFound = this.findBestArtistSearchResult(retryItems, username);
        const retryId = Number(retryFound?.artistId ?? retryFound?.contentId ?? 0);

        if (retryId > 0) {
          this.artistId = retryId;
          this.stateService.setArtistId(retryId);
          if (onResolved) {
            onResolved(retryId);
          } else {
            this.loadStudioData();
          }
          return;
        }

        if (retries > 0) {
          setTimeout(() => this.retryResolveArtist(username, retries - 1, onResolved), 600);
          return;
        }

        this.isLoading = false;
        this.error = 'Unable to resolve artist profile. Please re-login once.';
        this.cdr.markForCheck();
      },
      error: () => {
        if (retries > 0) {
          setTimeout(() => this.retryResolveArtist(username, retries - 1, onResolved), 600);
          return;
        }

        this.isLoading = false;
        this.error = 'Unable to resolve artist profile. Please re-login once.';
        this.cdr.markForCheck();
      }
    });
  }

  private loadStudioData(keepMessages = false): void {
    if (!this.artistId) {
      return;
    }

    this.isLoading = true;
    if (!keepMessages) {
      this.clearMessages();
    }
    let hasPermissionDenied = false;
    const onLoadError = (err: any, fallback: any) => {
      if (Number(err?.status ?? 0) === 403) {
        hasPermissionDenied = true;
      }
      return of(fallback);
    };

    forkJoin({
      profile: this.artistService.getArtistProfile(this.artistId).pipe(catchError((err) => onLoadError(err, null))),
      summary: this.artistService.getArtistSummary(this.artistId).pipe(catchError((err) => onLoadError(err, null))),
      albumsRes: this.artistService.getArtistAlbums(this.artistId, 0, 8).pipe(catchError((err) => onLoadError(err, { content: [] }))),
      songsRes: this.artistService.getArtistSongs(this.artistId, 0, 8).pipe(catchError((err) => onLoadError(err, { content: [] }))),
      podcastsRes: this.artistService.getArtistPodcasts(this.artistId, 0, 8).pipe(catchError((err) => onLoadError(err, { content: [] }))),
      socialLinks: this.artistService.getArtistSocialLinks(this.artistId).pipe(catchError((err) => onLoadError(err, [])))
    }).subscribe({
      next: ({ profile, summary, albumsRes, songsRes, podcastsRes, socialLinks }) => {
        this.isLoading = false;

        if (profile) {
          this.profileForm = {
            displayName: profile?.displayName ?? '',
            bio: profile?.bio ?? '',
            bannerImageUrl: profile?.bannerImageUrl ?? '',
            artistType: (profile?.artistType ?? 'BOTH') as ArtistType
          };
          this.isVerified = !!profile?.verified;
          const resolvedProfileImage = this.resolveArtistProfileImage(profile);
          if (resolvedProfileImage) {
            this.profilePictureUrl = resolvedProfileImage;
            this.profileImageLoadError = false;
            this.cacheProfileImageForCurrentUser(resolvedProfileImage);
            this.authService.updateCurrentUser({ profilePictureUrl: resolvedProfileImage, artistId: this.artistId });
          }
        }

        this.summary = summary;
        this.albums = albumsRes?.content ?? [];
        this.songs = songsRes?.content ?? [];
        this.podcasts = podcastsRes?.content ?? [];
        this.socialLinks = socialLinks ?? [];
        if (hasPermissionDenied) {
          this.error = 'You do not have access to this artist profile. Please log in with the correct artist account.';
          this.stateService.setArtistId(null);
        }
        this.cdr.markForCheck();
      },
      error: () => {
        this.isLoading = false;
        this.error = 'Failed to load creator profile data.';
        this.cdr.markForCheck();
      }
    });
  }

  private loadSocialLinks(): void {
    if (!this.artistId) {
      return;
    }

    this.artistService.getArtistSocialLinks(this.artistId).subscribe({
      next: (links) => {
        this.socialLinks = links ?? [];
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Failed to reload social links.';
        this.cdr.markForCheck();
      }
    });
  }

  private clearMessages(): void {
    this.error = null;
    this.successMessage = null;
  }

  private resolveCurrentDisplayName(): string {
    const user = this.authService.getCurrentUserSnapshot() ?? {};
    const candidates = [
      user?.fullName,
      user?.displayName,
      user?.username,
      this.profileForm.displayName
    ];

    for (const value of candidates) {
      const text = String(value ?? '').trim();
      if (text) {
        return text;
      }
    }

    return 'Artist';
  }

  private withResolvedArtistId(onResolved: (artistId: number) => void): void {
    if (this.artistId) {
      onResolved(this.artistId);
      return;
    }

    this.authService.currentUser$.pipe(take(1)).subscribe((user) => {
      const username = String(user?.username ?? '').trim();
      const userId = Number(user?.userId ?? user?.id ?? 0);
      if (!username) {
        this.error = 'Artist identity not found. Please log in again.';
        this.isLoading = false;
        this.cdr.markForCheck();
        return;
      }

      this.isLoading = true;
      this.cdr.markForCheck();

      const cachedArtistId = this.stateService.getArtistIdForUser(userId);
      if (cachedArtistId) {
        this.artistId = cachedArtistId;
        this.stateService.setArtistId(cachedArtistId);
        this.isLoading = false;
        this.cdr.markForCheck();
        onResolved(cachedArtistId);
        return;
      }

        this.artistService.findArtistByUsername(username).pipe(
          timeout(10000)
        ).subscribe({
          next: (searchResponse) => {
            const items = searchResponse?.content ?? [];
            const found = this.findBestArtistSearchResult(items, username);
            const foundId = Number(found?.artistId ?? found?.contentId ?? 0);

          if (foundId > 0) {
            this.artistId = foundId;
            this.stateService.setArtistId(foundId);
            this.stateService.setArtistIdForUser(userId, foundId);
            this.isLoading = false;
            this.cdr.markForCheck();
            onResolved(foundId);
            return;
          }

          this.artistService.createArtist({
            displayName: username,
            bio: '',
            artistType: 'BOTH'
          }).pipe(
            timeout(10000)
          ).subscribe({
            next: (created) => {
              const createdId = Number(created?.artistId ?? created?.id ?? 0);
              if (createdId > 0) {
                this.artistId = createdId;
                this.stateService.setArtistId(createdId);
                this.stateService.setArtistIdForUser(userId, createdId);
                this.isLoading = false;
                this.cdr.markForCheck();
                onResolved(createdId);
                return;
              }

              this.isLoading = false;
              this.error = 'Unable to initialize artist profile.';
              this.cdr.markForCheck();
            },
            error: (err) => {
              if (Number(err?.status ?? 0) === 409) {
                this.retryResolveArtist(username, 8, (artistId) => {
                  this.stateService.setArtistIdForUser(userId, artistId);
                  this.isLoading = false;
                  this.cdr.markForCheck();
                  onResolved(artistId);
                });
                return;
              }

              this.isLoading = false;
              this.error = this.extractBackendMessage(err, 'Failed to initialize artist profile.');
              this.cdr.markForCheck();
            }
          });
        },
        error: (err) => {
          this.isLoading = false;
          this.error = this.extractBackendMessage(err, 'Failed to resolve artist profile.');
          this.cdr.markForCheck();
        }
      });
    });
  }

  private extractBackendMessage(err: any, fallback: string): string {
    const status = Number(err?.status ?? 0);
    const message = String(err?.error?.userMessage ?? err?.error?.message ?? err?.error?.error ?? err?.message ?? '').trim();
    const normalized = message.toLowerCase();

    if (status === 401) {
      return 'Session expired. Please login again.';
    }

    if (status === 403) {
      return 'You do not have permission to access this artist profile.';
    }

    if (status === 404) {
      return 'Artist profile not found. Complete profile setup first.';
    }

    if (normalized.includes('duplicate') || normalized.includes('already exists') || normalized.includes('already')) {
      return 'This item already exists.';
    }

    return message || resolveHttpErrorMessage(err) || fallback;
  }

  private findBestArtistSearchResult(items: any[], username: string): any {
    const artistItems = (items ?? []).filter((item: any) => {
      const type = String(item?.type ?? '').trim().toUpperCase();
      if (['ARTIST', 'BOTH', 'MUSIC', 'CREATOR'].includes(type)) {
        return true;
      }
      return Number(item?.artistId ?? 0) > 0;
    });
    const normalizedUsername = String(username ?? '').trim().toLowerCase();
    return artistItems.find((item: any) => {
      const candidates = [item?.username, item?.title, item?.artistName, item?.displayName, item?.name];
      return candidates.some((value) => String(value ?? '').trim().toLowerCase() === normalizedUsername);
    }) ?? artistItems[0] ?? null;
  }

  private resolveArtistProfileImage(value: any): string {
    const candidates = [
      value?.profilePictureUrl,
      value?.profileImageUrl,
      value?.profilePictureFileName,
      value?.profileImageFileName,
      value?.profilePicture,
      value?.profileImage,
      value?.avatarUrl,
      value?.avatarFileName,
      value?.avatar,
      value?.imageUrl,
      value?.imageFileName,
      value?.imageName,
      value?.image,
      value?.user?.profilePictureUrl,
      value?.user?.profileImageUrl,
      value?.user?.profilePictureFileName,
      value?.user?.profileImageFileName,
      value?.user?.profilePicture,
      value?.user?.profileImage,
      value?.user?.avatarUrl,
      value?.user?.avatarFileName,
      value?.user?.avatar,
      value?.user?.imageUrl
    ];

    for (const candidate of candidates) {
      const raw = String(candidate ?? '').trim();
      if (!raw) {
        continue;
      }
      const resolved = this.artistService.resolveImageUrl(raw);
      if (resolved) {
        return resolved;
      }
    }

    return '';
  }

  private cacheProfileImageForCurrentUser(imageUrl: string, file: File | null = null): void {
    const userId = Number(this.currentUserId ?? 0);
    const normalizedImageUrl = String(imageUrl ?? '').trim();
    if (userId <= 0 && !file) {
      return;
    }

    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result ?? '').trim();
        if (!result.startsWith('data:image/')) {
          return;
        }
        this.writeProfileImageCache(userId, result);
      };
      reader.readAsDataURL(file);
    }

    if (normalizedImageUrl) {
      this.writeProfileImageCache(userId, normalizedImageUrl);
    }
  }

  private writeProfileImageCache(userId: number, imageUrl: string): void {
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
