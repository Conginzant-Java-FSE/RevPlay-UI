import { Injectable } from '@angular/core';
import { ApiService } from '../../core/services/api';
import { Observable } from 'rxjs';

@Injectable({
    providedIn: 'root',
})
export class BrowseService {
    constructor(private apiService: ApiService) { }

    getTrending(type: 'SONG' | 'PODCAST' = 'SONG', period: 'DAILY' | 'WEEKLY' | 'MONTHLY' = 'WEEKLY', limit = 12): Observable<any[]> {
        return this.apiService.get<any[]>(`/analytics/trending?type=${type}&period=${period}&limit=${limit}`);
    }

    getRecommendationsForYou(userId: number, limit = 12): Observable<any> {
        return this.apiService.get<any>(`/recommendations/for-you/${userId}?limit=${limit}`);
    }

    getDiscoverWeekly(userId: number, limit = 12): Observable<any> {
        return this.apiService.get<any>(`/discover/weekly/${userId}?limit=${limit}`);
    }

    getDiscoveryFeed(userId: number, sectionLimit = 8): Observable<any> {
        return this.apiService.get<any>(`/discover/feed/${userId}?sectionLimit=${sectionLimit}`);
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
}
