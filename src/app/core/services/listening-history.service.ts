import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from './api';

@Injectable({
    providedIn: 'root'
})
export class ListeningHistoryService {
    constructor(private apiService: ApiService) { }

    getRecentlyPlayed(userId: number): Observable<any[]> {
        return this.apiService.get<any>(`/recently-played/${userId}`).pipe(
            map((response) => this.normalizeList(response))
        );
    }

    getPlayHistory(userId: number): Observable<any[]> {
        return this.apiService.get<any>(`/play-history/${userId}`).pipe(
            map((response) => this.normalizeList(response))
        );
    }

    clearPlayHistory(userId: number): Observable<any> {
        return this.apiService.delete<any>(`/play-history/${userId}`);
    }

    private normalizeList(response: any): any[] {
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
}
