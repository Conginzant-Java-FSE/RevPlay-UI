import { Injectable } from '@angular/core';
import { ApiService } from './api';
import { Observable, of, shareReplay } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

@Injectable({
    providedIn: 'root',
})
export class GenreService {
    private genres$: Observable<any[]> | null = null;

    constructor(private apiService: ApiService) { }

    getAllGenres(): Observable<any[]> {
        if (!this.genres$) {
            this.genres$ = this.apiService.get<any>('/genres').pipe(
                map((response) => {
                    const genres = Array.isArray(response) ? response : response?.content ?? [];
                    return genres
                        .map((genre: any) => ({
                            ...genre,
                            id: genre.genreId ?? genre.id
                        }))
                        .filter((genre: any) => !this.isSmokeGenreName(genre?.name));
                }),
                shareReplay(1)
            );
        }
        return this.genres$;
    }

    getGenreSongs(genreId: number, page = 0, size = 20): Observable<any> {
        const pagedEndpoint = `/browse/genres/${genreId}/songs?page=${page}&size=${size}`;
        const fallbackEndpoint = `/browse/genres/${genreId}/songs`;

        return this.apiService.get<any>(pagedEndpoint).pipe(
            map((response) => this.normalizeSongsResponse(response, page, size)),
            catchError(() =>
                this.apiService.get<any>(fallbackEndpoint).pipe(
                    map((response) => this.normalizeSongsResponse(response, page, size)),
                    catchError(() =>
                        of(this.normalizeSongsResponse([], page, size))
                    )
                )
            )
        );
    }

    clearCache(): void {
        this.genres$ = null;
    }

    private isSmokeGenreName(name: any): boolean {
        const value = String(name ?? '').trim();
        if (!value) {
            return false;
        }
        return /^(smoke|endpoint)/i.test(value);
    }

    private normalizeSongsResponse(response: any, page: number, size: number): any {
        const content = Array.isArray(response) ? response : response?.content ?? [];
        const mappedContent = content.map((song: any) => ({
            ...song,
            id: Number(song?.songId ?? song?.id ?? 0),
            songId: Number(song?.songId ?? song?.id ?? 0),
            artistName: song?.artistName ?? '',
            durationSeconds: Number(song?.durationSeconds ?? 0),
            fileUrl: song?.fileUrl ?? ''
        }));

        return {
            content: mappedContent,
            page: Number(response?.page ?? page),
            size: Number(response?.size ?? size),
            totalElements: Number(response?.totalElements ?? mappedContent.length),
            totalPages: Number(response?.totalPages ?? (mappedContent.length > 0 ? 1 : 0))
        };
    }
}
