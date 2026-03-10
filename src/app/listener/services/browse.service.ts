import { Injectable } from '@angular/core';
import { ApiService } from '../../core/services/api';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { ArtistService } from '../../core/services/artist.service';
import { AuthService } from '../../core/services/auth';

@Injectable({
    providedIn: 'root',
})
export class BrowseService {
    constructor(
        private apiService: ApiService,
        private artistService: ArtistService,
        private authService: AuthService
    ) { }

    getTrending(type: 'SONG' | 'PODCAST' = 'SONG', period: 'DAILY' | 'WEEKLY' | 'MONTHLY' = 'WEEKLY', limit = 12): Observable<any[]> {
        return this.apiService.get<any[]>(`/analytics/trending?type=${type}&period=${period}&limit=${limit}`);
    }

    getRecommendationsForYou(userId?: number, limit?: number): Observable<any> {
        const resolvedUserId = this.resolveUserId(userId);
        if (resolvedUserId <= 0) {
            return of({ data: { youMightLike: [], popularWithSimilarUsers: [] } });
        }
        const safeUserId = encodeURIComponent(String(resolvedUserId));
        const normalizedLimit = Number(limit);
        const hasLimit = Number.isFinite(normalizedLimit) && normalizedLimit > 0;
        const endpoint = hasLimit
            ? `/recommendations/for-you/${safeUserId}?limit=${normalizedLimit}`
            : `/recommendations/for-you/${safeUserId}`;
        return this.apiService.get<any>(endpoint);
    }

    getDiscoverWeekly(userId?: number, limit = 12): Observable<any> {
        const resolvedUserId = this.resolveUserId(userId);
        if (resolvedUserId <= 0) {
            return of({ data: { discoverWeekly: [] } });
        }
        return this.apiService.get<any>(`/discover/weekly/${resolvedUserId}?limit=${limit}`);
    }

    getDiscoveryFeed(userId?: number, sectionLimit = 8): Observable<any> {
        const resolvedUserId = this.resolveUserId(userId);
        if (resolvedUserId <= 0) {
            return of({ data: { discoverWeekly: [] } });
        }
        return this.apiService.get<any>(`/discover/feed/${resolvedUserId}?sectionLimit=${sectionLimit}`);
    }

    getNewReleases(): Observable<any> {
        return this.apiService.get<any>('/browse/new-releases');
    }

    getTopArtists(): Observable<any> {
        return this.apiService.get<any>('/browse/top-artists');
    }

    getSystemPlaylists(): Observable<any[]> {
        return this.apiService.get<any[]>('/system-playlists');
    }

    getSystemPlaylistSongs(slug: string): Observable<any[]> {
        const normalized = encodeURIComponent(String(slug ?? '').trim());
        return this.apiService.get<any[]>(`/system-playlists/${normalized}/songs`);
    }

    getBrowseSongs(): Observable<any> {
        return this.apiService.get<any>('/browse/songs');
    }

    getPopularPodcasts(): Observable<any> {
        return this.apiService.get<any>('/browse/popular-podcasts');
    }

    getRecommendedPodcasts(page = 0, size = 10): Observable<any> {
        return this.apiService.get<any>(`/podcasts/recommended?page=${page}&size=${size}`);
    }

    getUserLikes(userId: number): Observable<any[]> {
        return this.apiService.get<any[]>(`/likes/${userId}`);
    }

    getGenres(): Observable<any[]> {
        return this.apiService.get<any[]>('/genres');
    }

    getSongById(songId: number): Observable<any> {
        return this.apiService.get<any>(`/songs/${songId}`);
    }

    getArtistById(artistId: number): Observable<any> {
        return this.apiService.get<any>(`/artists/${artistId}`);
    }

    getSystemPlaylistSongDetails(slug: string): Observable<any[]> {
        const normalizedSlug = String(slug ?? '').trim();
        if (!normalizedSlug) {
            return of([]);
        }

        return forkJoin({
            songIdsResponse: this.getSystemPlaylistSongs(normalizedSlug).pipe(catchError(() => of([]))),
            browseSongsResponse: this.getBrowseSongs().pipe(catchError(() => of([])))
        }).pipe(
            switchMap(({ songIdsResponse, browseSongsResponse }) => {
                const songIds = this.extractSongIds(songIdsResponse);
                if (songIds.length === 0) {
                    return of([]);
                }

                const browseSongMap = this.buildBrowseSongMap(browseSongsResponse);

                return forkJoin(
                    songIds.map((songId) =>
                        this.getSongById(songId).pipe(
                            map((response) => this.mapSystemPlaylistSong(response, browseSongMap.get(songId) ?? null, songId)),
                            catchError(() => of(this.mapSystemPlaylistSong(null, browseSongMap.get(songId) ?? null, songId)))
                        )
                    )
                );
            }),
            map((songs) => (songs ?? []).filter((song: any) => !!song)),
            catchError(() => of([]))
        );
    }

    private extractSongIds(response: any): number[] {
        const source = Array.isArray(response)
            ? response
            : (Array.isArray(response?.content)
                ? response.content
                : (Array.isArray(response?.data)
                    ? response.data
                    : (Array.isArray(response?.data?.content) ? response.data.content : [])));

        return (source ?? [])
            .map((item: any) => Number(item?.songId ?? item?.id ?? item))
            .filter((songId: number) => songId > 0);
    }

    private buildBrowseSongMap(response: any): Map<number, any> {
        const map = new Map<number, any>();
        for (const item of this.extractBrowseSongs(response)) {
            const song = this.unwrapPayload(item);
            const songId = Number(song?.songId ?? song?.trackId ?? song?.contentId ?? song?.id ?? 0);
            if (songId > 0 && !map.has(songId)) {
                map.set(songId, song);
            }
        }
        return map;
    }

    private extractBrowseSongs(response: any): any[] {
        if (!response) {
            return [];
        }

        if (Array.isArray(response)) {
            return response;
        }

        if (Array.isArray(response?.content)) {
            return response.content;
        }

        if (Array.isArray(response?.songs)) {
            return response.songs;
        }

        if (Array.isArray(response?.items)) {
            return response.items;
        }

        if (Array.isArray(response?.results)) {
            return response.results;
        }

        if (Array.isArray(response?.data)) {
            return response.data;
        }

        if (Array.isArray(response?.data?.content)) {
            return response.data.content;
        }

        if (Array.isArray(response?.data?.songs)) {
            return response.data.songs;
        }

        if (Array.isArray(response?.data?.items)) {
            return response.data.items;
        }

        if (Array.isArray(response?.data?.results)) {
            return response.data.results;
        }

        return [];
    }

    private mapSystemPlaylistSong(response: any, fallbackSong: any, fallbackSongId: number): any | null {
        const detail = this.unwrapPayload(response);
        const browseFallback = this.unwrapPayload(fallbackSong);
        const song = {
            ...browseFallback,
            ...detail
        };

        const songId = Number(song?.songId ?? song?.id ?? fallbackSongId ?? 0);
        const albumId = Number(song?.albumId ?? song?.album?.albumId ?? song?.album?.id ?? 0);
        if (songId <= 0) {
            return null;
        }

        const image = this.resolveSystemPlaylistSongImage(song, songId, albumId);
        const artist = this.resolveSystemPlaylistSongArtist(song);

        return {
            ...song,
            id: songId,
            songId,
            title: String(song?.title ?? `Song #${songId}`),
            artist,
            artistName: artist,
            artistDisplayName: artist,
            image,
            imageUrl: image,
            coverImageUrl: image,
            coverUrl: image,
            fileUrl: String(song?.fileUrl ?? song?.audioUrl ?? song?.streamUrl ?? ''),
            audioUrl: String(song?.audioUrl ?? song?.fileUrl ?? song?.streamUrl ?? ''),
            streamUrl: String(song?.streamUrl ?? song?.audioUrl ?? song?.fileUrl ?? '')
        };
    }

    private resolveSystemPlaylistSongArtist(song: any): string {
        const candidates = [
            song?.artistName,
            song?.artistDisplayName,
            song?.artist?.displayName,
            song?.artist?.name,
            song?.artistDetails?.displayName,
            song?.artistDetails?.name,
            song?.uploaderName,
            song?.createdByName,
            song?.createdBy?.fullName,
            song?.createdBy?.name,
            song?.createdBy?.displayName,
            song?.createdBy?.username,
            song?.creatorName,
            song?.uploadedByName,
            song?.ownerName,
            song?.displayName,
            song?.user?.fullName,
            song?.user?.name,
            song?.user?.displayName,
            song?.user?.username,
            song?.username
        ];

        for (const candidate of candidates) {
            const value = String(candidate ?? '').trim();
            if (value) {
                return value;
            }
        }

        return 'Unknown Artist';
    }

    private resolveSystemPlaylistSongImage(song: any, songId: number, albumId: number): string {
        const cachedSongImage = this.artistService.getCachedSongImage(songId);
        if (cachedSongImage) {
            return cachedSongImage;
        }

        const cachedAlbumImage = this.artistService.getCachedAlbumImage(albumId);
        if (cachedAlbumImage) {
            return cachedAlbumImage;
        }

        const candidates = [
            song?.imageUrl,
            song?.coverImageUrl,
            song?.coverUrl,
            song?.artworkUrl,
            song?.coverArtUrl,
            song?.thumbnailUrl,
            song?.image,
            song?.artwork,
            song?.imageFileName,
            song?.coverImageFileName,
            song?.coverFileName,
            song?.imageName,
            song?.cover?.imageUrl,
            song?.cover?.url,
            song?.cover?.fileName,
            song?.imageFile?.url,
            song?.imageFile?.fileName,
            song?.album?.coverImageUrl,
            song?.album?.coverArtUrl,
            song?.album?.imageUrl,
            song?.album?.cover?.imageUrl,
            song?.album?.cover?.url,
            song?.album?.cover?.fileName,
            song?.album?.coverFileName,
            song?.album?.coverImageFileName,
            song?.album?.imageFileName
        ];

        for (const candidate of candidates) {
            const resolved = this.resolveSystemPlaylistSongImageCandidate(candidate);
            if (resolved) {
                this.artistService.cacheSongImage(songId, resolved);
                if (albumId > 0) {
                    this.artistService.cacheAlbumImage(albumId, resolved);
                }
                return resolved;
            }
        }

        return 'assets/images/placeholder-album.png';
    }

    private resolveSystemPlaylistSongImageCandidate(candidate: any): string {
        const value = String(candidate ?? '').trim();
        if (value && value !== '[object Object]') {
            const resolved = this.artistService.resolveImageUrl(value);
            if (resolved) {
                return resolved;
            }
        }

        if (!candidate || typeof candidate !== 'object') {
            return '';
        }

        const nestedCandidates = [
            candidate?.url,
            candidate?.fileName,
            candidate?.name,
            candidate?.path,
            candidate?.imageUrl,
            candidate?.downloadUrl,
            candidate?.downloadUri,
            candidate?.fileDownloadUri
        ];

        for (const nested of nestedCandidates) {
            const resolved = this.resolveSystemPlaylistSongImageCandidate(nested);
            if (resolved) {
                return resolved;
            }
        }

        return '';
    }

    private unwrapPayload(payload: any): any {
        if (!payload || typeof payload !== 'object') {
            return payload;
        }

        if (payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
            return payload.data;
        }

        return payload;
    }

    private resolveUserId(fallback?: number): number {
        const currentUserId = this.authService.getCurrentUserId();
        if (currentUserId > 0) {
            return currentUserId;
        }
        const normalizedFallback = Number(fallback ?? 0);
        return normalizedFallback > 0 ? Math.floor(normalizedFallback) : 0;
    }
}
