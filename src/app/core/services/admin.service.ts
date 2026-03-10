import { Injectable } from '@angular/core';
import { ApiService } from '../../core/services/api';
import { Observable, forkJoin } from 'rxjs';
import { HttpParams } from '@angular/common/http';
import { catchError, map, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';

export interface AuditLogQuery {
    page?: number;
    size?: number;
    user?: string | number;
    action?: string;
    entity?: string;
    date?: string;
    from?: string;
    to?: string;
    fresh?: boolean;
}

export interface PagedResult<T> {
    content: T[];
    totalElements: number;
    totalPages: number;
    page: number;
    size: number;
}

@Injectable({
    providedIn: 'root',
})
export class AdminService {
    constructor(private apiService: ApiService) { }

    updateUserStatus(userId: number, isActive: boolean): Observable<any> {
        return this.apiService.patch<any>(`/admin/users/${userId}/status`, { isActive });
    }

    updateUserRole(userId: number, role: string): Observable<any> {
        return this.apiService.patch<any>(`/admin/users/${userId}/role`, { role });
    }

    deleteUser(userId: number): Observable<any> {
        return this.apiService.delete<any>(`/admin/users/${userId}`);
    }

    getUserLikes(userId: number): Observable<any[]> {
        return this.apiService.get<any>(`/likes/${userId}`).pipe(
            map((response) => this.normalizeList(response))
        );
    }

    deleteLike(likeId: number): Observable<any> {
        return this.apiService.delete<any>(`/likes/${likeId}`);
    }

    clearUserPlayHistory(userId: number): Observable<any> {
        return this.apiService.delete<any>(`/play-history/${userId}`);
    }

    createGenre(genreData: any): Observable<any> {
        return this.apiService.post<any>('/genres', genreData);
    }

    getSystemPlaylists(): Observable<any[]> {
        return this.apiService.get<any>('/system-playlists').pipe(
            map((response) => this.normalizeList(response))
        );
    }

    addSongsToSystemPlaylist(slug: string, songIds: number[]): Observable<any> {
        const normalized = encodeURIComponent(String(slug ?? '').trim());
        const payload = {
            songIds: (songIds ?? []).map((id) => Number(id)).filter((id) => id > 0)
        };
        return this.apiService.post<any>(`/system-playlists/${normalized}/songs`, payload);
    }

    getAvailableSongs(page = 0, size = 200): Observable<any> {
        return this.apiService.get<any>('/browse/songs').pipe(
            map((response) => this.normalizeList(response)),
            switchMap((songs) => {
                if ((songs ?? []).length > 0) {
                    return of(songs);
                }

                return forkJoin([
                    this.apiService.get<any>('/search?q=a&type=SONG&page=0&size=80').pipe(catchError(() => of([]))),
                    this.apiService.get<any>('/search?q=e&type=SONG&page=0&size=80').pipe(catchError(() => of([]))),
                    this.apiService.get<any>('/search?q=o&type=SONG&page=0&size=80').pipe(catchError(() => of([])))
                ]).pipe(
                    map((responses) => {
                        const merged = responses.flatMap((response: any) => this.normalizeList(response));
                        const unique = new Map<number, any>();
                        for (const song of merged) {
                            const songId = Number(song?.songId ?? song?.trackId ?? song?.contentId ?? song?.id ?? 0);
                            if (songId > 0 && !unique.has(songId)) {
                                unique.set(songId, song);
                            }
                        }
                        return Array.from(unique.values());
                    })
                );
            })
        );
    }

    getSystemPlaylistSongs(slug: string): Observable<any> {
        const normalized = encodeURIComponent(String(slug ?? '').trim());
        return this.apiService.get<any>(`/system-playlists/${normalized}/songs`);
    }

    getSongById(songId: number): Observable<any> {
        const normalizedSongId = Math.max(1, Number(songId ?? 0));
        return this.apiService.get<any>(`/songs/${normalizedSongId}`);
    }

    updateGenre(id: number, genreData: any): Observable<any> {
        return this.apiService.put<any>(`/genres/${id}`, genreData);
    }

    deleteGenre(id: number): Observable<any> {
        return this.apiService.delete<any>(`/genres/${id}`);
    }

    getAuditLogs(query: AuditLogQuery = {}): Observable<PagedResult<any>> {
        const params = new URLSearchParams();
        params.set('page', String(Math.max(0, Number(query.page ?? 0))));
        params.set('size', String(Math.max(1, Number(query.size ?? 50))));

        const userValue = String(query.user ?? '').trim();
        if (userValue) params.set('user', userValue);
        if (query.action?.trim()) params.set('action', query.action.trim());
        if (query.entity?.trim()) params.set('entity', query.entity.trim());

        const from = query.from?.trim() || query.date?.trim();
        const to = query.to?.trim() || query.date?.trim();
        if (from) params.set('from', from);
        if (to) params.set('to', to);

        if (query.fresh !== false) {
            params.set('_ts', String(Date.now()));
        }

        const suffix = params.toString() ? `?${params.toString()}` : '';
        return this.apiService.get<any>(`/audit-logs${suffix}`).pipe(
            map((response) => {
                const content = this.normalizeList(response);
                const fallbackSize = (response?.size ?? query.size ?? content.length);
                const size = Math.max(1, Number(fallbackSize || 1));
                const page = Math.max(0, Number(response?.number ?? response?.page ?? query.page ?? 0));
                const totalElements = Math.max(content.length, Number(response?.totalElements ?? content.length));
                const totalPages = Math.max(1, Number(response?.totalPages ?? Math.ceil(totalElements / size)));
                return { content, totalElements, totalPages, page, size };
            })
        );
    }

    getDashboardMetrics(): Observable<any> {
        return this.apiService.get<any>('/analytics/dashboard-metrics');
    }

    getUsersPage(page = 0, size = 200, search = ''): Observable<PagedResult<any>> {
        const normalizedPage = Math.max(0, Number(page ?? 0));
        const normalizedSize = Math.max(1, Number(size ?? 200));
        const query = String(search ?? '').trim();
        const params = new URLSearchParams();
        params.set('page', String(normalizedPage));
        params.set('size', String(normalizedSize));
        if (query) {
            params.set('search', query);
            params.set('query', query);
            params.set('keyword', query);
        }
        const suffix = `?${params.toString()}`;

        const normalizePaged = (response: any): PagedResult<any> => {
            const content = this.normalizeList(response);
            const fallbackSize = (response?.size ?? normalizedSize ?? content.length);
            const resolvedSize = Math.max(1, Number(fallbackSize || 1));
            const resolvedPage = Math.max(0, Number(response?.number ?? response?.page ?? normalizedPage));
            const totalElements = Math.max(content.length, Number(response?.totalElements ?? content.length));
            const totalPages = Math.max(1, Number(response?.totalPages ?? Math.ceil(totalElements / resolvedSize)));
            return { content, totalElements, totalPages, page: resolvedPage, size: resolvedSize };
        };

        return this.apiService.get<any>(`/admin/users${suffix}`).pipe(
            map((response) => normalizePaged(response)),
            catchError(() =>
                this.apiService.get<any>(`/users${suffix}`).pipe(
                    map((response) => normalizePaged(response))
                )
            )
        );
    }

    getUserById(userId: number): Observable<any> {
        const normalized = Math.max(1, Number(userId ?? 0));
        return this.apiService.get<any>(`/admin/users/${normalized}`).pipe(
            catchError(() =>
                this.apiService.get<any>(`/profile/${normalized}`).pipe(
                    catchError(() => of(null))
                )
            )
        );
    }

    getTopArtists(limit = 10): Observable<any[]> {
        return this.apiService.get<any>(`/analytics/top-artists?limit=${Math.max(1, limit)}`).pipe(
            map((response) => this.normalizeList(response))
        );
    }

    getTopContent(limit = 10, type = 'SONG'): Observable<any[]> {
        const normalizedType = encodeURIComponent(String(type || 'SONG').toUpperCase());
        return this.apiService.get<any>(`/analytics/top-content?type=${normalizedType}&limit=${Math.max(1, limit)}`).pipe(
            map((response) => this.normalizeList(response))
        );
    }

    getBusinessOverview(): Observable<any> {
        return this.apiService.get<any>('/admin/business-analytics/overview');
    }

    getRevenueAnalytics(): Observable<any> {
        return this.apiService.get<any>('/admin/business-analytics/revenue');
    }

    getTopDownloadedSongs(): Observable<any[]> {
        return this.apiService.get<any>('/admin/business-analytics/top-downloads').pipe(
            map((response) => this.normalizeList(response))
        );
    }

    getTopMixes(): Observable<any> {
        return this.apiService.get<any>('/admin/business-analytics/top-mixes').pipe(
            map((response) => this.normalizeList(response))
        );
    }

    getPremiumConversionRate(): Observable<any> {
        return this.apiService.get<any>('/admin/business-analytics/conversion-rate');
    }

    uploadAudioAd(file: File, title: string, durationSeconds?: number): Observable<any> {
        const formData = new FormData();
        formData.append('file', file, file.name);

        let params = new HttpParams();
        const normalizedTitle = String(title ?? '').trim();
        if (normalizedTitle) {
            params = params.set('title', normalizedTitle);
        }

        const normalizedDuration = Number(durationSeconds ?? 0);
        if (normalizedDuration > 0) {
            params = params.set('durationSeconds', String(normalizedDuration));
        }

        return this.apiService.postMultipart('/admin/ads/upload', formData, params);
    }

    activateAudioAd(adId: number): Observable<any> {
        return this.apiService.patch<any>(`/admin/ads/${adId}/activate`, {});
    }

    deactivateAudioAd(adId: number): Observable<any> {
        return this.apiService.patch<any>(`/admin/ads/${adId}/deactivate`, {});
    }

    private normalizeList(response: any): any[] {
        if (Array.isArray(response)) {
            return response;
        }

        if (Array.isArray(response?.content)) {
            return response.content;
        }

        if (Array.isArray(response?.items)) {
            return response.items;
        }

        if (Array.isArray(response?.results)) {
            return response.results;
        }

        if (Array.isArray(response?.users)) {
            return response.users;
        }

        if (Array.isArray(response?.data?.content)) {
            return response.data.content;
        }

        if (Array.isArray(response?.data?.items)) {
            return response.data.items;
        }

        if (Array.isArray(response?.data?.results)) {
            return response.data.results;
        }

        if (Array.isArray(response?.data?.users)) {
            return response.data.users;
        }

        if (Array.isArray(response?.data)) {
            return response.data;
        }

        return [];
    }
}
