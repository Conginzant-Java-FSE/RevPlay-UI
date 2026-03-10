import { Injectable } from '@angular/core';
import { Observable, interval, of } from 'rxjs';
import { map, take } from 'rxjs/operators';
import { ApiService } from './api';

export interface RevPlayAd {
    adId: number | null;
    title: string;
    mediaUrl: string;
    durationSeconds: number;
    active: boolean;
}

@Injectable({
    providedIn: 'root'
})
export class AdService {
    constructor(private apiService: ApiService) { }

    loadAds(): Observable<RevPlayAd[]> {
        return this.apiService.get<any>('/ads/audio').pipe(
            map((response) => {
                const items = Array.isArray(response)
                    ? response
                    : Array.isArray(response?.content)
                        ? response.content
                        : response
                            ? [response]
                            : [];
                return items
                    .map((item: any) => this.normalizeAd(item))
                    .filter((item: RevPlayAd) => !!item.mediaUrl);
            })
        );
    }

    fetchNextAd(userId: number, songId: number): Observable<RevPlayAd | null> {
        return this.apiService.get<any>(`/ads/next?userId=${encodeURIComponent(String(userId))}&songId=${encodeURIComponent(String(songId))}`).pipe(
            map((response) => {
                const candidate = Array.isArray(response) ? response[0] : response;
                const normalized = this.normalizeAd(candidate);
                return normalized.mediaUrl ? normalized : null;
            })
        );
    }

    fadeOutMusic(audio: HTMLAudioElement, durationMs = 320): Observable<number> {
        return this.fadeVolume(audio, Number(audio.volume ?? 1), 0, durationMs);
    }

    fadeInMusic(audio: HTMLAudioElement, targetVolume: number, durationMs = 420): Observable<number> {
        return this.fadeVolume(audio, Number(audio.volume ?? 0), targetVolume, durationMs);
    }

    normalizeAd(ad: any): RevPlayAd {
        const durationValue = Number(
            ad?.durationSeconds ??
            ad?.duration ??
            ad?.lengthSeconds ??
            0
        );

        return {
            adId: this.resolveAdId(ad),
            title: String(ad?.title ?? ad?.name ?? 'Sponsored Audio').trim() || 'Sponsored Audio',
            mediaUrl: String(ad?.mediaUrl ?? ad?.audioUrl ?? ad?.fileUrl ?? '').trim(),
            durationSeconds: durationValue > 0 ? Math.max(5, Math.min(20, Math.floor(durationValue))) : 0,
            active: ad?.active !== false && ad?.enabled !== false
        };
    }

    private fadeVolume(audio: HTMLAudioElement, startVolume: number, endVolume: number, durationMs: number): Observable<number> {
        const safeStart = Math.max(0, Math.min(1, startVolume));
        const safeEnd = Math.max(0, Math.min(1, endVolume));
        const steps = Math.max(1, Math.round(durationMs / 40));
        const delta = (safeEnd - safeStart) / steps;

        audio.volume = safeStart;
        if (steps === 1 || Math.abs(safeEnd - safeStart) < 0.01) {
            audio.volume = safeEnd;
            return of(safeEnd);
        }

        return interval(Math.max(16, Math.floor(durationMs / steps))).pipe(
            take(steps),
            map((tick) => {
                const nextVolume = tick >= steps - 1
                    ? safeEnd
                    : Math.max(0, Math.min(1, safeStart + (delta * (tick + 1))));
                audio.volume = nextVolume;
                return nextVolume;
            })
        );
    }

    private resolveAdId(ad: any): number | null {
        const value = Number(ad?.adId ?? ad?.id ?? ad?.audioAdId ?? 0);
        return value > 0 ? value : null;
    }
}
