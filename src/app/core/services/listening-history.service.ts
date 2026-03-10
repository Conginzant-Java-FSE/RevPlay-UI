import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from './api';
import { AuthService } from './auth';

@Injectable({
    providedIn: 'root'
})
export class ListeningHistoryService {
    constructor(
        private apiService: ApiService,
        private authService: AuthService
    ) { }

    getRecentlyPlayed(userId?: number): Observable<any[]> {
        const resolvedUserId = this.resolveUserId(userId);
        if (resolvedUserId <= 0) {
            return of([]);
        }
        return this.apiService.get<any>(`/recently-played/${resolvedUserId}`).pipe(
            map((response) => this.normalizeList(response))
        );
    }

    getPlayHistory(userId?: number): Observable<any[]> {
        const resolvedUserId = this.resolveUserId(userId);
        if (resolvedUserId <= 0) {
            return of([]);
        }
        return this.apiService.get<any>(`/play-history/${resolvedUserId}`).pipe(
            map((response) => this.normalizeList(response))
        );
    }

    clearPlayHistory(userId?: number): Observable<any> {
        const resolvedUserId = this.resolveUserId(userId);
        if (resolvedUserId <= 0) {
            return of(null);
        }
        return this.apiService.delete<any>(`/play-history/${resolvedUserId}`);
    }

    private resolveUserId(fallback?: number): number {
        const currentUserId = this.authService.getCurrentUserId();
        if (currentUserId > 0) {
            return currentUserId;
        }
        const normalizedFallback = Number(fallback ?? 0);
        return normalizedFallback > 0 ? Math.floor(normalizedFallback) : 0;
    }

    private normalizeList(response: any): any[] {
        const list = this.extractList(response);
        return list.filter((item) => !this.isInactiveSongHistoryItem(item));
    }

    private extractList(response: any): any[] {
        if (Array.isArray(response)) {
            return response;
        }
        if (Array.isArray(response?.content)) {
            return response.content;
        }
        if (Array.isArray(response?.data?.content)) {
            return response.data.content;
        }
        if (Array.isArray(response?.data)) {
            return response.data;
        }
        return [];
    }

    private isInactiveSongHistoryItem(item: any): boolean {
        const song = item?.song ?? item?.track ?? item?.content ?? null;
        const episode = item?.episode ?? item?.podcastEpisode ?? null;
        if (episode) {
            return false;
        }
        if (song?.isActive === false) {
            return true;
        }
        const type = String(item?.type ?? item?.contentType ?? '').trim().toUpperCase();
        if (type === 'PODCAST') {
            return false;
        }
        return item?.isActive === false;
    }
}
