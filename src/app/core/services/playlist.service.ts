import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from '../../core/services/api';

@Injectable({
    providedIn: 'root'
})
export class PlaylistService {
    constructor(private apiService: ApiService) { }

    getUserPlaylists(page = 0, size = 20): Observable<any> {
        return this.apiService.get<any>(`/playlists/me?page=${page}&size=${size}`).pipe(
            map((response) => ({
                ...response,
                content: (response?.content ?? []).map((playlist: any) => ({
                    ...playlist,
                    id: Number(playlist?.id ?? playlist?.playlistId ?? 0)
                }))
            }))
        );
    }

    getPublicPlaylists(page = 0, size = 20): Observable<any> {
        return this.apiService.get<any>(`/playlists/public?page=${page}&size=${size}`).pipe(
            map((response) => ({
                ...response,
                content: (response?.content ?? []).map((playlist: any) => ({
                    ...playlist,
                    id: Number(playlist?.id ?? playlist?.playlistId ?? 0)
                }))
            }))
        );
    }

    getPlaylistById(playlistId: number): Observable<any> {
        return this.apiService.get<any>(`/playlists/${playlistId}`).pipe(
            map((playlist) => ({
                ...playlist,
                id: Number(playlist?.id ?? playlist?.playlistId ?? 0),
                songs: (playlist?.songs ?? []).map((song: any) => ({
                    ...song,
                    id: Number(song?.id ?? song?.songId ?? 0),
                    songId: Number(song?.songId ?? song?.id ?? 0),
                    position: Number(song?.position ?? 0)
                }))
            }))
        );
    }

    createPlaylist(payload: { name: string; description?: string; isPublic?: boolean }): Observable<any> {
        return this.apiService.post<any>('/playlists', {
            name: payload.name,
            description: payload.description ?? '',
            isPublic: payload.isPublic ?? true
        });
    }

    updatePlaylist(playlistId: number, payload: { name?: string; description?: string; isPublic?: boolean }): Observable<any> {
        return this.apiService.put<any>(`/playlists/${playlistId}`, payload);
    }

    deletePlaylist(playlistId: number): Observable<any> {
        return this.apiService.delete<any>(`/playlists/${playlistId}`);
    }

    addSongToPlaylist(playlistId: number, songId: number, position?: number): Observable<any> {
        const body: any = { songId: Number(songId) };
        if (position !== undefined && position > 0) {
            body.position = Number(position);
        }
        return this.apiService.post<any>(`/playlists/${playlistId}/songs`, body);
    }

    removeSongFromPlaylist(playlistId: number, songId: number): Observable<any> {
        return this.apiService.delete<any>(`/playlists/${playlistId}/songs/${songId}`);
    }

    reorderPlaylistSongs(playlistId: number, songs: Array<{ songId: number; position: number }>): Observable<any> {
        return this.apiService.put<any>(`/playlists/${playlistId}/songs/reorder`, { songs });
    }

    followPlaylist(playlistId: number): Observable<any> {
        return this.apiService.post<any>(`/playlists/${playlistId}/follow`, {});
    }

    unfollowPlaylist(playlistId: number): Observable<any> {
        return this.apiService.delete<any>(`/playlists/${playlistId}/unfollow`);
    }

    getSongById(songId: number): Observable<any> {
        return this.apiService.get<any>(`/songs/${songId}`);
    }
}
