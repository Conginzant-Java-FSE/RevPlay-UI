import { ChangeDetectorRef, Component, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpEventType } from '@angular/common/http';
import { AuthService } from '../../core/services/auth';
import { ApiService } from '../../core/services/api';
import { environment } from '../../../environments/environment';
import { forkJoin, of } from 'rxjs';
import { catchError, map, switchMap, timeout } from 'rxjs/operators';
import { Router } from '@angular/router';
import { hasRole } from '../../core/utils/role.util';
import { ListeningHistoryService } from '../../core/services/listening-history.service';
import { LikesService } from '../../core/services/likes.service';

@Component({
    selector: 'app-profile',
    templateUrl: './profile.component.html',
    styleUrls: ['./profile.component.scss'],
    standalone: true,
    imports: [CommonModule, RouterModule, FormsModule]
})
export class ProfileComponent implements OnDestroy {
    readonly apiOrigin = environment.apiUrl.replace(/\/api\/v1$/, '');
    user: any = null;
    profile: any = {
        fullName: '',
        bio: '',
        profilePictureUrl: '',
        country: ''
    };
    isLoading = true;
    isSaving = false;
    isUploadingImage = false;
    selectedImageName = '';
    localPreviewUrl = '';
    imageLoadError = false;
    error: string | null = null;
    successMessage: string | null = null;
    historyError: string | null = null;
    isHistoryLoading = false;
    isClearingHistory = false;
    isDeletingOwnData = false;
    recentlyPlayed: any[] = [];
    playHistory: any[] = [];
    historyStats = {
        totalPlays: 0,
        songPlays: 0,
        podcastPlays: 0,
        totalDurationSeconds: 0,
        lastPlayedAt: null as string | null
    };
    private lastLoadedProfileKey: string | null = null;
    private lastLoadedUserId: number | null = null;
    private localObjectUrl: string | null = null;

    constructor(
        private authService: AuthService,
        private apiService: ApiService,
        private listeningHistoryService: ListeningHistoryService,
        private likesService: LikesService,
        private router: Router,
        private cdr: ChangeDetectorRef
    ) {
        this.authService.currentUser$.subscribe((user) => {
            this.user = user;
            if (!user) {
                this.lastLoadedProfileKey = null;
                this.lastLoadedUserId = null;
                this.isLoading = false;
                this.cdr.markForCheck();
                return;
            }
            if (hasRole(user, 'ARTIST')) {
                this.router.navigate(['/creator-studio/profile']);
                return;
            }
            const profileKey = this.buildProfileKey(user);
            if (profileKey && this.lastLoadedProfileKey !== profileKey) {
                this.lastLoadedProfileKey = profileKey;
                this.loadProfile();
            }
            const userId = Number(user?.userId ?? 0);
            if (userId) {
                if (this.lastLoadedUserId !== userId) {
                    this.lastLoadedUserId = userId;
                    this.loadListeningHistory(userId);
                }
            } else {
                this.lastLoadedUserId = null;
                this.cdr.markForCheck();
            }
        });
    }

    clearListeningHistory(): void {
        const userId = Number(this.user?.userId ?? this.lastLoadedUserId ?? 0);
        if (!userId || this.isClearingHistory) {
            return;
        }

        if (!confirm('Are you sure you want to clear your play history?')) {
            return;
        }

        this.isClearingHistory = true;
        this.historyError = null;
        this.successMessage = null;
        this.cdr.markForCheck();

        this.listeningHistoryService.clearPlayHistory(userId).subscribe({
            next: () => {
                this.isClearingHistory = false;
                this.successMessage = 'Play history cleared successfully.';
                this.loadListeningHistory(userId);
                this.cdr.markForCheck();
            },
            error: () => {
                this.isClearingHistory = false;
                this.historyError = 'Failed to clear play history.';
                this.cdr.markForCheck();
            }
        });
    }

    deleteMyData(): void {
        const userId = Number(this.user?.userId ?? this.lastLoadedUserId ?? 0);
        if (!userId || this.isDeletingOwnData) {
            return;
        }

        if (!confirm('Delete your personal data (likes + play history)? This action cannot be undone.')) {
            return;
        }

        this.isDeletingOwnData = true;
        this.error = null;
        this.historyError = null;
        this.successMessage = null;
        this.cdr.markForCheck();

        this.likesService.getUserLikes(userId).pipe(
            catchError(() => of([])),
            map((likes) => (likes ?? [])
                .map((item) => this.extractLikeId(item))
                .filter((likeId): likeId is number => typeof likeId === 'number' && likeId > 0)),
            switchMap((likeIds) => {
                const likeDeleteRequests = likeIds.map((likeId) =>
                    this.likesService.unlikeByLikeId(likeId).pipe(catchError(() => of(null)))
                );
                const clearLikes$ = likeDeleteRequests.length > 0 ? forkJoin(likeDeleteRequests) : of([]);

                return forkJoin({
                    likes: clearLikes$,
                    history: this.listeningHistoryService.clearPlayHistory(userId).pipe(catchError(() => of(null)))
                });
            })
        ).subscribe({
            next: () => {
                this.isDeletingOwnData = false;
                this.successMessage = 'Your personal data was deleted successfully.';
                this.loadListeningHistory(userId);
                this.cdr.markForCheck();
            },
            error: () => {
                this.isDeletingOwnData = false;
                this.error = 'Failed to delete your personal data.';
                this.cdr.markForCheck();
            }
        });
    }

    getHistoryTitle(item: any): string {
        const title = String(item?.title ?? '').trim();
        if (title) {
            return title;
        }

        if (item?.type === 'PODCAST') {
            const episodeTitle = String(item?.episodeTitle ?? '').trim();
            return episodeTitle || 'Podcast Episode';
        }

        return 'Song';
    }

    getHistoryArtist(item: any): string {
        const artist = String(item?.artistName ?? '').trim();
        if (artist) {
            return artist;
        }
        return item?.type === 'PODCAST' ? 'Podcast' : 'Artist';
    }

    formatDuration(totalSeconds: number): string {
        const safe = Math.max(0, Number(totalSeconds ?? 0));
        if (!safe) {
            return '0m';
        }

        const hours = Math.floor(safe / 3600);
        const minutes = Math.floor((safe % 3600) / 60);
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    }

    loadProfile(): void {
        const userId = Number(this.user?.userId ?? this.user?.id ?? this.lastLoadedUserId ?? 0);
        if (userId <= 0) {
            this.isLoading = false;
            this.error = 'User session not found. Please sign in again.';
            this.cdr.markForCheck();
            return;
        }

        this.isLoading = true;
        this.error = null;
        this.apiService.get<any>(`/profile/${userId}`).pipe(
            timeout(10000)
        ).subscribe({
            next: (profile) => {
                const profileData = profile ?? {};
                this.profile = {
                    fullName: profileData.fullName ?? '',
                    bio: profileData.bio ?? '',
                    profilePictureUrl: profileData.profilePictureUrl ?? '',
                    country: profileData.country ?? ''
                };
                this.authService.updateCurrentUser({
                    fullName: this.profile.fullName,
                    profilePictureUrl: this.profile.profilePictureUrl
                });
                this.clearLocalPreview();
                this.imageLoadError = false;
                this.isLoading = false;
                this.cdr.markForCheck();
            },
            error: () => {
                this.error = 'Failed to load your profile.';
                this.isLoading = false;
                this.cdr.markForCheck();
            }
        });
    }

    saveProfile(): void {
        if (!this.profile.fullName?.trim()) {
            return;
        }
        const userId = Number(this.user?.userId ?? this.user?.id ?? this.lastLoadedUserId ?? 0);
        if (userId <= 0) {
            this.error = 'User session not found. Please sign in again.';
            this.cdr.markForCheck();
            return;
        }

        this.isSaving = true;
        this.successMessage = null;
        this.error = null;

        this.apiService.put<any>(`/profile/${userId}`, this.profile).pipe(
            timeout(10000)
        ).subscribe({
            next: (updatedProfile) => {
                this.profile = updatedProfile ?? this.profile;
                this.authService.updateCurrentUser({
                    fullName: this.profile?.fullName ?? '',
                    profilePictureUrl: this.profile?.profilePictureUrl ?? ''
                });
                this.isSaving = false;
                this.successMessage = 'Profile updated successfully.';
                this.cdr.markForCheck();
            },
            error: () => {
                this.isSaving = false;
                this.error = 'Failed to update profile.';
                this.cdr.markForCheck();
            }
        });
    }

    onProfileImageSelected(event: Event): void {
        const input = event.target as HTMLInputElement;
        const file = input?.files?.[0] ?? null;
        if (!file) {
            return;
        }

        if (!file.type.startsWith('image/')) {
            this.error = 'Please select a valid image file.';
            this.cdr.markForCheck();
            return;
        }

        this.isUploadingImage = true;
        this.selectedImageName = file.name;
        this.error = null;
        this.successMessage = null;
        this.cdr.markForCheck();

        const formData = new FormData();
        formData.append('file', file);
        this.setLocalPreview(file);

        this.apiService.postMultipart('/files/images', formData).subscribe({
            next: (eventData: any) => {
                if (eventData.type === HttpEventType.Response) {
                    const imageUrl = this.resolveUploadedImageUrl(eventData);
                    if (!imageUrl) {
                        this.isUploadingImage = false;
                        this.error = 'Image uploaded but URL was not returned.';
                        this.cdr.markForCheck();
                        return;
                    }

                    this.profile.profilePictureUrl = imageUrl;
                    this.imageLoadError = false;
                    this.isUploadingImage = false;
                    this.authService.updateCurrentUser({ profilePictureUrl: imageUrl });
                    this.successMessage = 'Profile image uploaded. Click Save Profile to persist.';
                    this.cdr.markForCheck();
                }
            },
            error: () => {
                this.isUploadingImage = false;
                this.error = 'Failed to upload profile image.';
                this.cdr.markForCheck();
            }
        });
    }

    getProfileImageUrl(): string {
        if (this.localPreviewUrl) {
            return this.localPreviewUrl;
        }

        const url = this.profile?.profilePictureUrl ?? '';
        if (!url) {
            return '';
        }

        if (!url.includes('/')) {
            return `${environment.apiUrl}/files/images/${encodeURIComponent(url)}`;
        }

        if (url.startsWith('http://') || url.startsWith('https://')) {
            return url;
        }
        if (url.startsWith('/api/v1/')) {
            return `${this.apiOrigin}${url}`;
        }
        if (url.startsWith('/files/images/')) {
            return `${this.apiOrigin}/api/v1${url}`;
        }
        if (url.startsWith('/files/')) {
            return `${this.apiOrigin}/api/v1${url}`;
        }
        if (url.startsWith('files/images/')) {
            return `${this.apiOrigin}/api/v1/${url}`;
        }
        if (url.startsWith('files/')) {
            return `${this.apiOrigin}/api/v1/${url}`;
        }
        if (url.startsWith('/uploads/') || url.startsWith('uploads/')) {
            const fileName = this.extractFileName(url);
            return fileName ? `${environment.apiUrl}/files/images/${encodeURIComponent(fileName)}` : '';
        }
        return url;
    }

    onProfileImageLoadError(): void {
        this.imageLoadError = true;
        this.cdr.markForCheck();
    }

    hasProfileImage(): boolean {
        return !!this.getProfileImageUrl() && !this.imageLoadError;
    }

    ngOnDestroy(): void {
        this.clearLocalPreview();
    }

    private resolveUploadedImageUrl(uploadEvent: any): string {
        const payload = uploadEvent?.body ?? uploadEvent ?? {};
        const direct = String(
            payload?.data?.imageUrl ??
            payload?.imageUrl ??
            payload?.data?.url ??
            payload?.url ??
            ''
        ).trim();
        if (direct) {
            return direct;
        }

        const fileName = String(
            payload?.data?.fileName ??
            payload?.fileName ??
            payload?.data?.name ??
            payload?.name ??
            ''
        ).trim();
        if (!fileName) {
            return '';
        }
        return `/api/v1/files/images/${encodeURIComponent(fileName)}`;
    }

    private setLocalPreview(file: File): void {
        this.clearLocalPreview();
        this.localObjectUrl = URL.createObjectURL(file);
        this.localPreviewUrl = this.localObjectUrl;
        this.imageLoadError = false;
    }

    private clearLocalPreview(): void {
        if (this.localObjectUrl) {
            URL.revokeObjectURL(this.localObjectUrl);
            this.localObjectUrl = null;
        }
        this.localPreviewUrl = '';
    }

    private extractFileName(value: string): string {
        const raw = String(value ?? '').trim().split('?')[0];
        if (!raw) {
            return '';
        }
        const parts = raw.split('/').filter(Boolean);
        return parts[parts.length - 1] ?? '';
    }

    private loadListeningHistory(userId: number): void {
        if (!userId) {
            return;
        }

        this.isHistoryLoading = true;
        this.historyError = null;
        this.cdr.markForCheck();

        forkJoin({
            recent: this.listeningHistoryService.getRecentlyPlayed(userId).pipe(
                catchError(() => of([]))
            ),
            history: this.listeningHistoryService.getPlayHistory(userId).pipe(
                catchError(() => of([]))
            )
        }).subscribe({
            next: ({ recent, history }) => {
                this.recentlyPlayed = this.normalizeHistoryItems(recent).slice(0, 8);
                this.playHistory = this.normalizeHistoryItems(history);
                this.computeHistoryStats();
                this.isHistoryLoading = false;
                this.cdr.markForCheck();
            },
            error: () => {
                this.recentlyPlayed = [];
                this.playHistory = [];
                this.computeHistoryStats();
                this.isHistoryLoading = false;
                this.historyError = 'Failed to load listening history.';
                this.cdr.markForCheck();
            }
        });
    }

    private normalizeHistoryItems(items: any[]): any[] {
        return (items ?? [])
            .map((item) => {
                const song = item?.song ?? item?.track ?? item?.content ?? {};
                const episode = item?.episode ?? item?.podcastEpisode ?? {};

                const type = String(
                    item?.type ??
                    item?.contentType ??
                    (item?.episodeId || episode?.episodeId ? 'PODCAST' : 'SONG')
                ).toUpperCase();

                const title = String(
                    item?.title ??
                    song?.title ??
                    episode?.title ??
                    ''
                ).trim();

                const artistName = String(
                    item?.artistName ??
                    song?.artistName ??
                    episode?.podcastName ??
                    episode?.creatorName ??
                    ''
                ).trim();

                const playedAt = item?.playedAt ?? item?.timestamp ?? item?.createdAt ?? null;
                const playDurationSeconds = Number(item?.playDurationSeconds ?? item?.durationSeconds ?? 0);

                return {
                    ...item,
                    type: type === 'PODCAST' ? 'PODCAST' : 'SONG',
                    title,
                    artistName,
                    playedAt,
                    playDurationSeconds: Number.isFinite(playDurationSeconds) && playDurationSeconds > 0
                        ? Math.floor(playDurationSeconds)
                        : 0,
                    completed: Boolean(item?.completed)
                };
            })
            .sort((a, b) => {
                const aTime = new Date(a?.playedAt ?? 0).getTime();
                const bTime = new Date(b?.playedAt ?? 0).getTime();
                return bTime - aTime;
            });
    }

    private computeHistoryStats(): void {
        const list = this.playHistory ?? [];
        const songPlays = list.filter((item) => item?.type !== 'PODCAST').length;
        const podcastPlays = list.filter((item) => item?.type === 'PODCAST').length;
        const totalDurationSeconds = list.reduce((sum, item) => {
            const value = Number(item?.playDurationSeconds ?? 0);
            return sum + (Number.isFinite(value) && value > 0 ? value : 0);
        }, 0);
        const lastPlayedAt = list.length > 0 ? (list[0]?.playedAt ?? null) : null;

        this.historyStats = {
            totalPlays: list.length,
            songPlays,
            podcastPlays,
            totalDurationSeconds: Math.floor(totalDurationSeconds),
            lastPlayedAt
        };
    }

    private extractLikeId(item: any): number | null {
        const candidates = [
            item?.id,
            item?.likeId,
            item?.like_id,
            item?.like?.id
        ];

        for (const candidate of candidates) {
            const value = Number(candidate ?? 0);
            if (Number.isFinite(value) && value > 0) {
                return Math.floor(value);
            }
        }

        return null;
    }

    private buildProfileKey(user: any): string {
        const username = String(user?.username ?? '').trim().toLowerCase();
        const email = String(user?.email ?? '').trim().toLowerCase();
        const fallbackId = String(user?.id ?? user?.userId ?? '').trim();
        return username || email || fallbackId;
    }
}
