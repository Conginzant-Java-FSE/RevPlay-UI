import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from './api';

type LikeableType = 'SONG' | 'PODCAST';

@Injectable({
  providedIn: 'root'
})
export class LikesService {
  constructor(private apiService: ApiService) { }

  likeContent(likeableId: number, likeableType: LikeableType): Observable<any> {
    return this.apiService.post<any>('/likes', {
      likeableId: Number(likeableId),
      likeableType
    });
  }

  likeSong(songId: number): Observable<any> {
    return this.likeContent(songId, 'SONG');
  }

  getUserLikes(userId: number, likeableType?: LikeableType, page = 0, size = 100): Observable<any[]> {
    const uid = Number(userId ?? 0);
    if (!uid) {
      return of([]);
    }

    let path = `/likes/${uid}?page=${page}&size=${size}`;
    if (likeableType) {
      path += `&likeableType=${encodeURIComponent(likeableType)}`;
    }

    return this.apiService.get<any>(path).pipe(
      map((response) => {
        if (Array.isArray(response)) {
          return response;
        }
        if (Array.isArray(response?.content)) {
          return response.content;
        }
        return [];
      })
    );
  }

  getSongLikeId(userId: number, songId: number): Observable<number | null> {
    const uid = Number(userId ?? 0);
    const sid = Number(songId ?? 0);
    if (!uid || !sid) {
      return of(null);
    }

    return this.getUserLikes(uid, 'SONG').pipe(
      map((likes) => {
        const like = (likes ?? []).find((item: any) =>
          String(item?.likeableType ?? '').toUpperCase() === 'SONG' &&
          Number(item?.likeableId ?? 0) === sid
        );
        const likeId = Number(like?.id ?? 0);
        return likeId > 0 ? likeId : null;
      })
    );
  }

  unlikeByLikeId(likeId: number): Observable<any> {
    return this.apiService.delete<any>(`/likes/${Number(likeId ?? 0)}`);
  }
}
