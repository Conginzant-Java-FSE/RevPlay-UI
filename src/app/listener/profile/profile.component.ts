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
import { BrowseService } from '../services/browse.service';
import { ArtistService } from '../../core/services/artist.service';
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
    private historySongCache = new Map<number, any>();
    private historyPodcastCache = new Map<number, any>();
    private historyEpisodeCache = new Map<string, any>();

    constructor(
        private authService: AuthService,
        private apiService: ApiService,
        private listeningHistoryService: ListeningHistoryService,
        private likesService: LikesService,
        private browseService: BrowseService,
        private artistService: ArtistService,
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
                this.enrichHistoryItems(this.recentlyPlayed, 'recent');
                this.enrichHistoryItems(this.playHistory, 'history');
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

                const songId = Number(
                    item?.songId ??
                    item?.trackId ??
                    item?.contentId ??
                    item?.id ??
                    song?.songId ??
                    song?.trackId ??
                    song?.contentId ??
                    song?.id ??
                    0
                );

                const podcastId = Number(
                    item?.podcastId ??
                    episode?.podcastId ??
                    item?.showId ??
                    item?.seriesId ??
                    0
                );

                const episodeId = Number(
                    item?.episodeId ??
                    episode?.episodeId ??
                    item?.podcastEpisodeId ??
                    item?.contentEpisodeId ??
                    0
                );

                const title = this.firstNonEmpty(
                    item?.title,
                    item?.songTitle,
                    item?.trackTitle,
                    item?.contentTitle,
                    item?.name,
                    item?.episodeTitle,
                    item?.podcastTitle,
                    song?.title,
                    song?.name,
                    song?.trackTitle,
                    song?.songTitle,
                    episode?.title,
                    episode?.name,
                    episode?.episodeTitle
                );

                const artistName = this.firstNonEmpty(
                    item?.artistName,
                    item?.artist,
                    item?.artistDisplayName,
                    item?.creatorName,
                    item?.uploaderName,
                    item?.podcastName,
                    item?.showName,
                    song?.artistName,
                    song?.artist,
                    song?.artistDisplayName,
                    song?.creatorName,
                    song?.uploaderName,
                    song?.artist?.name,
                    song?.artist?.displayName,
                    episode?.podcastName,
                    episode?.creatorName,
                    episode?.showName,
                    episode?.podcastTitle
                );

                const playedAt = item?.playedAt ?? item?.timestamp ?? item?.createdAt ?? null;
                const playDurationSeconds = this.resolvePlayDurationSeconds(item, song, episode);

                return {
                    ...item,
                    type: type === 'PODCAST' ? 'PODCAST' : 'SONG',
                    songId: songId > 0 ? songId : null,
                    podcastId: podcastId > 0 ? podcastId : null,
                    episodeId: episodeId > 0 ? episodeId : null,
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

    private firstNonEmpty(...values: any[]): string {
        for (const value of values) {
            const text = String(value ?? '').trim();
            if (text) {
                return text;
            }
        }
        return '';
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

    private resolvePlayDurationSeconds(item: any, song: any, episode: any): number {
        const raw = [
            item?.playDurationSeconds,
            item?.listenDurationSeconds,
            item?.listenedSeconds,
            item?.playedSeconds,
            item?.progressSeconds,
            item?.positionSeconds,
            item?.elapsedSeconds,
            item?.playTimeSeconds,
            item?.durationSeconds,
            item?.duration,
            song?.durationSeconds,
            song?.duration,
            episode?.durationSeconds,
            episode?.duration
        ].map((value) => Number(value ?? 0)).find((value) => Number.isFinite(value) && value > 0);

        if (raw) {
            return Math.floor(raw);
        }

        if (item?.completed) {
            const completedDuration = Number(
                song?.durationSeconds ??
                episode?.durationSeconds ??
                item?.durationSeconds ??
                0
            );
            return completedDuration > 0 ? Math.floor(completedDuration) : 0;
        }

        return 0;
    }

    private enrichHistoryItems(items: any[], scope: 'recent' | 'history'): void {
        const source = Array.isArray(items) ? items : [];
        const targets = source.filter((item) => this.isHistoryDetailsMissing(item));
        if (targets.length === 0) {
            return;
        }

        const requests = targets.map((item) => this.resolveHistoryItemDetails(item));
        forkJoin(requests).subscribe((results) => {
            const patchMap = new Map<string, any>();
            for (const patch of results) {
                if (patch?.key) {
                    patchMap.set(patch.key, patch.data);
                }
            }

            const updated = source.map((item) => {
                const key = this.getHistoryKey(item);
                const patch = key ? patchMap.get(key) : null;
                return patch ? { ...item, ...patch } : item;
            });

            if (scope === 'recent') {
                this.recentlyPlayed = updated;
            } else {
                this.playHistory = updated;
                this.computeHistoryStats();
            }
            this.cdr.markForCheck();
        });
    }

    private isHistoryDetailsMissing(item: any): boolean {
        const title = String(item?.title ?? '').trim();
        const artistName = String(item?.artistName ?? '').trim();
        if (title && !/^(song|podcast episode)$/i.test(title) && artistName && artistName !== 'Artist' && artistName !== 'Podcast') {
            return false;
        }
        return true;
    }

    private resolveHistoryItemDetails(item: any) {
        const key = this.getHistoryKey(item);
        if (!key) {
            return of({ key: '', data: null });
        }

        if (item?.type === 'PODCAST') {
            return this.resolvePodcastHistoryDetails(item).pipe(
                map((data) => ({ key, data })),
                catchError(() => of({ key, data: null }))
            );
        }

        return this.resolveSongHistoryDetails(item).pipe(
            map((data) => ({ key, data })),
            catchError(() => of({ key, data: null }))
        );
    }

    private resolveSongHistoryDetails(item: any) {
        const songId = Number(item?.songId ?? 0);
        if (songId <= 0) {
            return of(null);
        }

        if (this.historySongCache.has(songId)) {
            return of(this.historySongCache.get(songId));
        }

        return this.browseService.getSongById(songId).pipe(
            map((song) => {
                const title = this.firstNonEmpty(song?.title, song?.name, item?.title);
                const artistName = this.firstNonEmpty(
                    song?.artistName,
                    song?.artist?.displayName,
                    song?.artist?.name,
                    song?.createdByName,
                    song?.uploaderName,
                    item?.artistName
                );
                const patch = {
                    title: title || item?.title,
                    artistName: artistName || item?.artistName,
                    playDurationSeconds: this.resolvePlayDurationSeconds(item, song, null)
                };
                this.historySongCache.set(songId, patch);
                return patch;
            }),
            catchError(() => of(null))
        );
    }

    private resolvePodcastHistoryDetails(item: any) {
        const podcastId = Number(item?.podcastId ?? 0);
        const episodeId = Number(item?.episodeId ?? 0);
        const episodeKey = `${podcastId}:${episodeId}`;

        if (episodeId > 0 && this.historyEpisodeCache.has(episodeKey)) {
            return of(this.historyEpisodeCache.get(episodeKey));
        }

        if (episodeId > 0 && podcastId > 0) {
            return forkJoin({
                episode: this.artistService.getPodcastEpisode(podcastId, episodeId).pipe(catchError(() => of(null))),
                podcast: this.resolvePodcastInfo(podcastId)
            }).pipe(
                map(({ episode, podcast }) => {
                    const title = this.firstNonEmpty(
                        episode?.title,
                        episode?.name,
                        item?.title,
                        item?.episodeTitle
                    );
                    const artistName = this.firstNonEmpty(
                        podcast?.title,
                        podcast?.name,
                        podcast?.podcastName,
                        item?.artistName,
                        item?.podcastName
                    );
                    const patch = {
                        title: title || item?.title,
                        artistName: artistName || item?.artistName,
                        playDurationSeconds: this.resolvePlayDurationSeconds(item, null, episode)
                    };
                    this.historyEpisodeCache.set(episodeKey, patch);
                    return patch;
                })
            );
        }

        if (podcastId > 0) {
            return this.resolvePodcastInfo(podcastId).pipe(
                map((podcast) => {
                    const artistName = this.firstNonEmpty(
                        podcast?.title,
                        podcast?.name,
                        podcast?.podcastName,
                        item?.artistName,
                        item?.podcastName
                    );
                    const patch = {
                        artistName: artistName || item?.artistName
                    };
                    this.historyPodcastCache.set(podcastId, patch);
                    return patch;
                })
            );
        }

        return of(null);
    }

    private resolvePodcastInfo(podcastId: number) {
        if (this.historyPodcastCache.has(podcastId)) {
            return of(this.historyPodcastCache.get(podcastId));
        }

        return this.artistService.getPodcast(podcastId).pipe(
            map((podcast) => {
                const patch = {
                    title: this.firstNonEmpty(podcast?.title, podcast?.name, podcast?.podcastName),
                    artistName: this.firstNonEmpty(podcast?.title, podcast?.name, podcast?.podcastName)
                };
                this.historyPodcastCache.set(podcastId, patch);
                return patch;
            }),
            catchError(() => of(null))
        );
    }

    private getHistoryKey(item: any): string {
        const type = String(item?.type ?? '').toUpperCase();
        if (type === 'PODCAST') {
            const episodeId = Number(item?.episodeId ?? 0);
            const podcastId = Number(item?.podcastId ?? 0);
            if (episodeId > 0) {
                return `PODCAST:${episodeId}`;
            }
            if (podcastId > 0) {
                return `PODCAST:${podcastId}`;
            }
            return '';
        }
        const songId = Number(item?.songId ?? 0);
        return songId > 0 ? `SONG:${songId}` : '';
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
