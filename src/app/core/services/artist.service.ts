import { Injectable } from '@angular/core';
import { ApiService } from '../../core/services/api';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

@Injectable({
    providedIn: 'root',
})
export class ArtistService {
    private artistId: number | null = null;
    private readonly apiOrigin = environment.apiUrl.replace(/\/api\/v1$/, '');
    private readonly songImageCacheKey = 'revplay_song_image_cache_v1';
    private readonly albumImageCacheKey = 'revplay_album_image_cache_v1';

    constructor(private apiService: ApiService) { }

    setArtistId(id: number) {
        this.artistId = id;
    }

    getArtistId(): number | null {
        return this.artistId;
    }

    getArtistStats(artistId: number): Observable<any> {
        return this.apiService.get<any>(`/analytics/artists/${artistId}/dashboard`);
    }

    getArtistDashboard(artistId: number): Observable<any> {
        return this.apiService.get<any>(`/analytics/artists/${artistId}/dashboard`);
    }

    getArtistTrends(artistId: number, from?: string, to?: string): Observable<any> {
        const query = new URLSearchParams();
        if (from) query.set('from', from);
        if (to) query.set('to', to);
        const suffix = query.toString() ? `?${query.toString()}` : '';
        return this.apiService.get<any>(`/analytics/artists/${artistId}/trends${suffix}`);
    }

    getArtistSongsPopularity(artistId: number): Observable<any[]> {
        return this.apiService.get<any[]>(`/analytics/artists/${artistId}/songs/popularity`);
    }

    getMyUploads(artistId: number): Observable<any> {
        return this.apiService.get<any>(`/analytics/artists/${artistId}/songs/popularity`);
    }

    getMyAlbums(artistId: number): Observable<any> {
        return this.getArtistAlbums(artistId, 0, 100).pipe(
            map((response) => response?.content ?? [])
        );
    }

    getArtistProfile(artistId: number): Observable<any> {
        return this.apiService.get<any>(`/artists/${artistId}`).pipe(
            map((artist) => ({
                ...artist,
                id: Number(artist?.artistId ?? artist?.id ?? 0)
            }))
        );
    }

    updateArtistProfile(artistId: number, payload: {
        displayName: string;
        bio?: string;
        bannerImageUrl?: string;
        artistType: 'MUSIC' | 'PODCAST' | 'BOTH';
    }): Observable<any> {
        return this.apiService.put<any>(`/artists/${artistId}`, payload);
    }

    getArtistSummary(artistId: number): Observable<any> {
        return this.apiService.get<any>(`/artists/${artistId}/summary`);
    }

    getArtistAlbums(artistId: number, page = 0, size = 100): Observable<any> {
        return this.apiService.get<any>(`/artists/${artistId}/albums?page=${page}&size=${size}`).pipe(
            map((response) => ({
                ...response,
                content: this.normalizeAlbumList(response?.content ?? [])
            }))
        );
    }

    getArtistSongs(artistId: number, page = 0, size = 100): Observable<any> {
        return this.apiService.get<any>(`/artists/${artistId}/songs?page=${page}&size=${size}`).pipe(
            map((response) => ({
                ...response,
                content: this.normalizeSongList(response?.content ?? [])
            }))
        );
    }

    getArtistPodcasts(artistId: number, page = 0, size = 100): Observable<any> {
        return this.apiService.get<any>(`/artists/${artistId}/podcasts?page=${page}&size=${size}`).pipe(
            map((response) => ({
                ...response,
                content: this.normalizePodcastList(response?.content ?? [])
            }))
        );
    }

    createPodcast(payload: {
        categoryId: number;
        title: string;
        description?: string;
        coverImageUrl?: string;
        visibility?: 'PUBLIC' | 'UNLISTED';
    }): Observable<any> {
        return this.apiService.post<any>('/podcasts', payload).pipe(
            map((podcast) => this.normalizePodcast(podcast))
        );
    }

    getPodcast(podcastId: number): Observable<any> {
        return this.apiService.get<any>(`/podcasts/${podcastId}`).pipe(
            map((podcast) => this.normalizePodcast(podcast))
        );
    }

    updatePodcast(podcastId: number, payload: {
        categoryId: number;
        title: string;
        description?: string;
        coverImageUrl?: string;
        visibility?: 'PUBLIC' | 'UNLISTED';
    }): Observable<any> {
        return this.apiService.put<any>(`/podcasts/${podcastId}`, payload).pipe(
            map((podcast) => this.normalizePodcast(podcast))
        );
    }

    deletePodcast(podcastId: number): Observable<any> {
        return this.apiService.delete<any>(`/podcasts/${podcastId}`);
    }

    getPodcastEpisodes(podcastId: number, page = 0, size = 50): Observable<any> {
        return this.apiService.get<any>(`/podcasts/${podcastId}/episodes?page=${page}&size=${size}`).pipe(
            map((response) => ({
                ...response,
                content: this.normalizeEpisodeList(response?.content ?? [])
            }))
        );
    }

    createPodcastEpisode(podcastId: number, metadata: {
        title: string;
        durationSeconds: number;
        releaseDate?: string;
    }, file: File): Observable<any> {
        const formData = new FormData();
        formData.append('metadata', JSON.stringify(metadata));
        formData.append('file', file);
        return this.apiService.postMultipart(`/podcasts/${podcastId}/episodes`, formData);
    }

    getPodcastEpisode(podcastId: number, episodeId: number): Observable<any> {
        return this.apiService.get<any>(`/podcasts/${podcastId}/episodes/${episodeId}`).pipe(
            map((episode) => this.normalizeEpisode(episode))
        );
    }

    updatePodcastEpisode(podcastId: number, episodeId: number, payload: {
        title: string;
        durationSeconds: number;
        releaseDate?: string;
    }): Observable<any> {
        return this.apiService.put<any>(`/podcasts/${podcastId}/episodes/${episodeId}`, payload).pipe(
            map((episode) => this.normalizeEpisode(episode))
        );
    }

    deletePodcastEpisode(podcastId: number, episodeId: number): Observable<any> {
        return this.apiService.delete<any>(`/podcasts/${podcastId}/episodes/${episodeId}`);
    }

    replacePodcastEpisodeAudio(podcastId: number, episodeId: number, file: File): Observable<any> {
        const formData = new FormData();
        formData.append('file', file);
        return this.apiService.putMultipart(`/podcasts/${podcastId}/episodes/${episodeId}/audio`, formData);
    }

    getPodcastCategories(): Observable<any[]> {
        return this.apiService.get<any>('/podcast-categories').pipe(
            map((response) => {
                const categories = Array.isArray(response) ? response : response?.content ?? [];
                return (categories ?? []).map((category: any) => ({
                    ...category,
                    id: Number(category?.categoryId ?? category?.id ?? 0)
                }));
            })
        );
    }

    createPodcastCategory(payload: { name: string; description?: string }): Observable<any> {
        return this.apiService.post<any>('/podcast-categories', payload).pipe(
            map((category) => ({
                ...category,
                id: Number(category?.categoryId ?? category?.id ?? 0)
            }))
        );
    }

    getPodcastStreamUrl(fileName: string): string {
        if (!fileName) {
            return '';
        }
        return `${environment.apiUrl}/files/podcasts/${fileName}`;
    }

    verifyArtist(artistId: number, verified: boolean): Observable<any> {
        return this.apiService.patch<any>(`/artists/${artistId}/verify`, { verified });
    }

    getArtistSocialLinks(artistId: number): Observable<any[]> {
        return this.apiService.get<any[]>(`/artists/${artistId}/social-links`).pipe(
            map((links) => (links ?? []).map((link: any) => ({
                ...link,
                id: Number(link?.linkId ?? link?.id ?? 0)
            })))
        );
    }

    createArtistSocialLink(artistId: number, payload: { platform: string; url: string }): Observable<any> {
        return this.apiService.post<any>(`/artists/${artistId}/social-links`, payload);
    }

    updateArtistSocialLink(artistId: number, linkId: number, payload: { platform: string; url: string }): Observable<any> {
        return this.apiService.put<any>(`/artists/${artistId}/social-links/${linkId}`, payload);
    }

    deleteArtistSocialLink(artistId: number, linkId: number): Observable<any> {
        return this.apiService.delete<any>(`/artists/${artistId}/social-links/${linkId}`);
    }

    createAlbum(albumData: any): Observable<any> {
        return this.apiService.post<any>('/albums', albumData);
    }

    getAlbum(albumId: number): Observable<any> {
        return this.apiService.get<any>(`/albums/${albumId}`).pipe(
            map((album) => {
                const normalizedAlbumId = Number(album?.albumId ?? album?.id ?? 0);
                const resolvedAlbumImage = this.resolveImageUrl(
                    album?.coverArtUrl ??
                    album?.coverImageUrl ??
                    album?.imageUrl ??
                    album?.image ??
                    album?.cover?.imageUrl ??
                    album?.cover?.fileName ??
                    ''
                );
                if (normalizedAlbumId > 0 && resolvedAlbumImage) {
                    this.cacheAlbumImage(normalizedAlbumId, resolvedAlbumImage);
                }

                return {
                    ...album,
                    id: normalizedAlbumId,
                    coverArtUrl: album?.coverArtUrl ?? album?.coverImageUrl ?? album?.imageUrl ?? '',
                    imageUrl: resolvedAlbumImage || this.getCachedAlbumImage(normalizedAlbumId),
                    songs: (album?.songs ?? []).map((song: any) => ({
                        ...song,
                        id: Number(song?.songId ?? song?.id ?? 0),
                        songId: Number(song?.songId ?? song?.id ?? 0),
                        fileUrl: song?.fileUrl ?? '',
                        fileName: song?.fileName ?? '',
                        imageUrl: this.resolveImageUrl(
                            song?.imageUrl ??
                            song?.coverUrl ??
                            song?.coverArtUrl ??
                            song?.coverImageUrl ??
                            song?.cover?.imageUrl ??
                            song?.cover?.fileName ??
                            album?.coverArtUrl ??
                            album?.coverImageUrl ??
                            ''
                        ) || this.getCachedSongImage(Number(song?.songId ?? song?.id ?? 0)) || this.getCachedAlbumImage(normalizedAlbumId)
                    }))
                };
            })
        );
    }

    updateAlbum(albumId: number, payload: {
        title: string;
        description?: string;
        coverArtUrl?: string;
        releaseDate?: string;
    }): Observable<any> {
        return this.apiService.put<any>(`/albums/${albumId}`, payload);
    }

    deleteAlbum(albumId: number): Observable<any> {
        return this.apiService.delete<any>(`/albums/${albumId}`);
    }

    addSongToAlbum(albumId: number, songId: number): Observable<any> {
        return this.apiService.put<any>(`/albums/${albumId}/songs/${songId}`, null);
    }

    removeSongFromAlbum(albumId: number, songId: number): Observable<any> {
        return this.apiService.delete<any>(`/albums/${albumId}/songs/${songId}`);
    }

    uploadSong(formData: FormData): Observable<any> {
        return this.apiService.postMultipart('/songs', formData);
    }

    getSong(songId: number): Observable<any> {
        return this.apiService.get<any>(`/songs/${songId}`).pipe(
            map((song) => ({
                ...song,
                id: Number(song?.songId ?? song?.id ?? 0),
                songId: Number(song?.songId ?? song?.id ?? 0)
            }))
        );
    }

    updateSong(songId: number, payload: {
        title: string;
        durationSeconds: number;
        albumId?: number;
        releaseDate?: string;
    }): Observable<any> {
        return this.apiService.put<any>(`/songs/${songId}`, payload);
    }

    deleteSong(songId: number): Observable<any> {
        return this.apiService.delete<any>(`/songs/${songId}`);
    }

    replaceSongAudio(songId: number, file: File): Observable<any> {
        const formData = new FormData();
        formData.append('file', file);
        return this.apiService.putMultipart(`/songs/${songId}/audio`, formData);
    }

    updateSongVisibility(songId: number, visibility: 'PUBLIC' | 'UNLISTED', isActive = true): Observable<any> {
        return this.apiService.patch<any>(`/songs/${songId}/visibility`, { visibility, isActive });
    }

    replaceSongGenres(songId: number, genreIds: number[]): Observable<any> {
        return this.apiService.put<any>(`/songs/${songId}/genres`, { genreIds });
    }

    addSongGenres(songId: number, genreIds: number[]): Observable<any> {
        return this.apiService.post<any>(`/songs/${songId}/genres`, { genreIds });
    }

    uploadImage(file: File): Observable<any> {
        return this.uploadImageRequest('/files/images', file, 'file').pipe(
            catchError((err) => this.tryUploadImageFallback(
                file,
                err,
                [
                    { path: '/files/images', field: 'image' },
                    { path: '/files/images', field: 'coverImage' },
                    { path: '/files/images/upload', field: 'file' }
                ]
            ))
        );
    }

    resolveUploadedImageUrl(uploadResponse: any): string {
        const payload = uploadResponse?.body ?? uploadResponse ?? {};
        const directUrl = String(
            payload?.data?.imageUrl ??
            payload?.imageUrl ??
            payload?.data?.url ??
            payload?.url ??
            ''
        ).trim();

        if (directUrl && !this.isImageCollectionEndpoint(directUrl)) {
            return directUrl;
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

        return this.getImageUrlByFileName(fileName);
    }

    resolveImageUrl(imageUrlOrFileName: string): string {
        const value = String(imageUrlOrFileName ?? '').trim();
        if (!value) {
            return '';
        }

        if (this.isImageCollectionEndpoint(value)) {
            return '';
        }

        if (value.startsWith('data:image/')) {
            return value;
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

        if (value.startsWith('/files/')) {
            return `${this.apiOrigin}/api/v1${value}`;
        }

        if (value.startsWith('files/images/')) {
            return `${this.apiOrigin}/api/v1/${value}`;
        }

        if (value.startsWith('files/')) {
            return `${this.apiOrigin}/api/v1/${value}`;
        }

        if (value.startsWith('/uploads/') || value.startsWith('uploads/')) {
            const fileName = this.extractFileName(value);
            return fileName ? this.getImageUrlByFileName(fileName) : '';
        }

        if (value.startsWith('/images/') || value.startsWith('images/')) {
            const fileName = this.extractFileName(value);
            return fileName ? this.getImageUrlByFileName(fileName) : '';
        }

        if (!value.includes('/')) {
            return this.getImageUrlByFileName(value);
        }

        const fileName = this.extractFileName(value);
        if (fileName) {
            return this.getImageUrlByFileName(fileName);
        }

        return '';
    }

    getImageUrlByFileName(fileName: string): string {
        const normalized = String(fileName ?? '').trim().split('?')[0];
        const segments = normalized.split(/[\\/]/).filter(Boolean);
        const safeName = segments[segments.length - 1] ?? '';
        if (!safeName) {
            return '';
        }

        return `${environment.apiUrl}/files/images/${encodeURIComponent(safeName)}`;
    }

    cacheSongImage(songId: number, imageUrlOrFileName: string): void {
        const normalizedSongId = Number(songId ?? 0);
        const raw = String(imageUrlOrFileName ?? '').trim();
        if (normalizedSongId <= 0 || !raw || this.isImageCollectionEndpoint(raw)) {
            return;
        }

        try {
            const stored = localStorage.getItem(this.songImageCacheKey);
            const parsed = stored ? JSON.parse(stored) : {};
            const map = parsed && typeof parsed === 'object' ? parsed : {};
            map[String(normalizedSongId)] = raw;
            localStorage.setItem(this.songImageCacheKey, JSON.stringify(map));
        } catch {
            // Cache writes are best-effort.
        }
    }

    getCachedSongImage(songId: number): string {
        const normalizedSongId = Number(songId ?? 0);
        if (normalizedSongId <= 0) {
            return '';
        }

        try {
            const stored = localStorage.getItem(this.songImageCacheKey);
            if (!stored) {
                return '';
            }

            const parsed = JSON.parse(stored);
            if (!parsed || typeof parsed !== 'object') {
                return '';
            }

            const raw = String((parsed as any)[String(normalizedSongId)] ?? '').trim();
            if (!raw) {
                return '';
            }

            return this.resolveImageUrl(raw);
        } catch {
            return '';
        }
    }

    cacheAlbumImage(albumId: number, imageUrlOrFileName: string): void {
        const normalizedAlbumId = Number(albumId ?? 0);
        const raw = String(imageUrlOrFileName ?? '').trim();
        if (normalizedAlbumId <= 0 || !raw || this.isImageCollectionEndpoint(raw)) {
            return;
        }

        try {
            const stored = localStorage.getItem(this.albumImageCacheKey);
            const parsed = stored ? JSON.parse(stored) : {};
            const map = parsed && typeof parsed === 'object' ? parsed : {};
            map[String(normalizedAlbumId)] = raw;
            localStorage.setItem(this.albumImageCacheKey, JSON.stringify(map));
        } catch {
            // Cache writes are best-effort.
        }
    }

    getCachedAlbumImage(albumId: number): string {
        const normalizedAlbumId = Number(albumId ?? 0);
        if (normalizedAlbumId <= 0) {
            return '';
        }

        try {
            const stored = localStorage.getItem(this.albumImageCacheKey);
            if (!stored) {
                return '';
            }

            const parsed = JSON.parse(stored);
            if (!parsed || typeof parsed !== 'object') {
                return '';
            }

            const raw = String((parsed as any)[String(normalizedAlbumId)] ?? '').trim();
            if (!raw) {
                return '';
            }

            return this.resolveImageUrl(raw);
        } catch {
            return '';
        }
    }

    private extractFileName(rawPath: string): string {
        const path = String(rawPath ?? '').trim().split('?')[0];
        if (!path) {
            return '';
        }
        const segments = path.split(/[\\/]/).filter(Boolean);
        return segments[segments.length - 1] ?? '';
    }

    private isImageCollectionEndpoint(rawValue: string): boolean {
        const normalized = String(rawValue ?? '')
            .trim()
            .split('?')[0]
            .replace(/\/+$/, '')
            .toLowerCase();

        if (!normalized) {
            return false;
        }

        return normalized.endsWith('/api/v1/files/images') ||
            normalized.endsWith('/files/images') ||
            normalized === 'files/images';
    }

    private uploadImageRequest(path: string, file: File, fieldName: string): Observable<any> {
        const formData = new FormData();
        formData.append(fieldName, file, file.name);
        return this.apiService.postMultipart(path, formData);
    }

    private tryUploadImageFallback(
        file: File,
        initialError: any,
        attempts: Array<{ path: string; field: string }>
    ): Observable<any> {
        const status = Number(initialError?.status ?? 0);
        const canFallback = [400, 404, 415, 422].includes(status);
        if (!canFallback || attempts.length === 0) {
            return throwError(() => initialError);
        }

        const [current, ...remaining] = attempts;
        return this.uploadImageRequest(current.path, file, current.field).pipe(
            catchError((nextError) => this.tryUploadImageFallback(file, nextError, remaining))
        );
    }

    createArtist(artistData: any): Observable<any> {
        return this.apiService.post<any>('/artists', artistData);
    }

    // This is a helper since backend lacks /me
    findArtistByUsername(username: string): Observable<any> {
        return this.apiService.get<any>(`/search?q=${encodeURIComponent(username)}&type=ARTIST`);
    }

    private normalizeAlbumList(albums: any[]): any[] {
        return (albums ?? []).map((album: any) => ({
            ...album,
            id: Number(album?.albumId ?? album?.id ?? 0),
            coverArtUrl: album?.coverArtUrl ?? album?.coverImageUrl ?? album?.imageUrl ?? '',
            imageUrl: (() => {
                const albumId = Number(album?.albumId ?? album?.id ?? 0);
                const resolved = this.resolveImageUrl(
                    album?.coverArtUrl ??
                    album?.coverImageUrl ??
                    album?.imageUrl ??
                    album?.image ??
                    album?.cover?.imageUrl ??
                    album?.cover?.fileName ??
                    ''
                );
                if (albumId > 0 && resolved) {
                    this.cacheAlbumImage(albumId, resolved);
                }
                return resolved || this.getCachedAlbumImage(albumId);
            })()
        }));
    }

    private normalizeSongList(songs: any[]): any[] {
        return (songs ?? []).map((song: any) => {
            const songId = Number(song?.songId ?? song?.id ?? 0);
            const albumId = Number(song?.albumId ?? song?.album?.albumId ?? song?.album?.id ?? 0);
            const resolvedImage = this.resolveImageUrl(
                song?.imageUrl ??
                song?.coverUrl ??
                song?.coverArtUrl ??
                song?.coverImageUrl ??
                song?.cover?.imageUrl ??
                song?.cover?.url ??
                song?.cover?.fileName ??
                song?.artworkUrl ??
                song?.image ??
                song?.thumbnailUrl ??
                song?.imageFileName ??
                song?.coverFileName ??
                song?.coverImageFileName ??
                song?.imageName ??
                song?.album?.coverArtUrl ??
                song?.album?.coverImageUrl ??
                song?.album?.cover?.imageUrl ??
                song?.album?.cover?.fileName ??
                song?.album?.coverFileName ??
                song?.albumImageUrl ??
                ''
            );

            const resolvedArtistName = String(
                song?.artistName ??
                song?.artistDisplayName ??
                song?.artist?.displayName ??
                song?.artist?.name ??
                song?.uploaderName ??
                song?.createdByName ??
                song?.username ??
                ''
            ).trim();

            if (albumId > 0 && resolvedImage) {
                this.cacheAlbumImage(albumId, resolvedImage);
            }

            return {
                ...song,
                id: songId,
                songId,
                albumId,
                artistName: resolvedArtistName,
                durationSeconds: Number(song?.durationSeconds ?? 0),
                imageUrl: resolvedImage || this.getCachedSongImage(songId) || this.getCachedAlbumImage(albumId)
            };
        });
    }

    private normalizePodcastList(podcasts: any[]): any[] {
        return (podcasts ?? []).map((podcast: any) => this.normalizePodcast(podcast));
    }

    private normalizePodcast(podcast: any): any {
        return {
            ...podcast,
            id: Number(podcast?.podcastId ?? podcast?.id ?? 0),
            podcastId: Number(podcast?.podcastId ?? podcast?.id ?? 0)
        };
    }

    private normalizeEpisodeList(episodes: any[]): any[] {
        return (episodes ?? []).map((episode: any) => this.normalizeEpisode(episode));
    }

    private normalizeEpisode(episode: any): any {
        return {
            ...episode,
            id: Number(episode?.episodeId ?? episode?.id ?? 0),
            episodeId: Number(episode?.episodeId ?? episode?.id ?? 0),
            podcastId: Number(episode?.podcastId ?? 0),
            durationSeconds: Number(episode?.durationSeconds ?? 0)
        };
    }
}
