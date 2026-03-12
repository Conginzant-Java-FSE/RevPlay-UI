import { Injectable } from '@angular/core';
import { ApiService } from './api';
import { Observable, forkJoin, of, shareReplay } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

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
            switchMap((response) => this.normalizeSongsResponse(response, page, size)),
            catchError(() =>
                this.apiService.get<any>(fallbackEndpoint).pipe(
                    switchMap((response) => this.normalizeSongsResponse(response, page, size)),
                    catchError(() =>
                        of(this.buildPagedSongs([], page, size))
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

    private normalizeSongsResponse(response: any, page: number, size: number): Observable<any> {
        const content = Array.isArray(response) ? response : response?.content ?? [];
        const mappedContent = content.map((song: any) => ({
            ...song,
            id: Number(song?.songId ?? song?.contentId ?? song?.id ?? 0),
            songId: Number(song?.songId ?? song?.contentId ?? song?.id ?? 0),
            artistName: song?.artistName ?? ''
        }));

        if (mappedContent.length === 0) {
            return of(this.buildPagedSongs([], Number(response?.page ?? page), Number(response?.size ?? size), Number(response?.totalElements ?? 0), Number(response?.totalPages ?? 0)));
        }

        return forkJoin<any[]>(
            mappedContent.map((song: any) => this.resolveGenreSong(song))
        ).pipe(
            map((songs) => this.buildPagedSongs(
                songs,
                Number(response?.page ?? page),
                Number(response?.size ?? size),
                Number(response?.totalElements ?? songs.length),
                Number(response?.totalPages ?? 1)
            ))
        );
    }

    private resolveGenreSong(song: any): Observable<any> {
        const songId = Number(song?.songId ?? song?.contentId ?? song?.id ?? 0);
        if (!songId) {
            return of({
                ...song,
                id: 0,
                songId: 0,
                durationSeconds: 0,
                fileUrl: '',
                audioUrl: '',
                streamUrl: ''
            });
        }

        return this.apiService.get<any>(`/songs/${songId}`).pipe(
            map((response) => {
                const detail = response?.data ?? response ?? {};
                return {
                    ...song,
                    ...detail,
                    id: songId,
                    songId,
                    title: String(detail?.title ?? song?.title ?? `Song #${songId}`).trim(),
                    artistId: Number(detail?.artistId ?? song?.artistId ?? 0) || undefined,
                    artistName: String(song?.artistName ?? detail?.artistName ?? '').trim(),
                    durationSeconds: Number(detail?.durationSeconds ?? song?.durationSeconds ?? 0),
                    fileUrl: String(detail?.fileUrl ?? song?.fileUrl ?? '').trim(),
                    audioUrl: String(detail?.audioUrl ?? detail?.fileUrl ?? song?.audioUrl ?? song?.fileUrl ?? '').trim(),
                    streamUrl: String(detail?.streamUrl ?? detail?.audioUrl ?? detail?.fileUrl ?? song?.streamUrl ?? song?.audioUrl ?? song?.fileUrl ?? '').trim()
                };
            }),
            catchError(() => of({
                ...song,
                id: songId,
                songId,
                durationSeconds: Number(song?.durationSeconds ?? 0),
                fileUrl: String(song?.fileUrl ?? '').trim(),
                audioUrl: String(song?.audioUrl ?? song?.fileUrl ?? '').trim(),
                streamUrl: String(song?.streamUrl ?? song?.audioUrl ?? song?.fileUrl ?? '').trim()
            }))
        );
    }

    private buildPagedSongs(content: any[], page: number, size: number, totalElements?: number, totalPages?: number): any {
        return {
            content,
            page,
            size,
            totalElements: Number(totalElements ?? content.length),
            totalPages: Number(totalPages ?? (content.length > 0 ? 1 : 0))
        };
    }
}
