import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class StateService {
    private readonly ARTIST_ID_KEY = 'revplay_artist_id';
    private readonly ARTIST_ID_MAP_KEY = 'revplay_artist_id_map';
    private artistIdSubject = new BehaviorSubject<number | null>(this.getStoredArtistId());
    public artistId$ = this.artistIdSubject.asObservable();

    setArtistId(id: number | null) {
        const normalized = Number(id ?? 0);
        if (normalized > 0) {
            localStorage.setItem(this.ARTIST_ID_KEY, String(normalized));
            this.artistIdSubject.next(normalized);
            return;
        }

        localStorage.removeItem(this.ARTIST_ID_KEY);
        this.artistIdSubject.next(null);
    }

    get artistId(): number | null {
        return this.artistIdSubject.value;
    }

    setArtistIdForUser(userId: number | null | undefined, artistId: number | null): void {
        const uid = Number(userId ?? 0);
        if (uid <= 0) {
            return;
        }

        const map = this.getStoredArtistMap();
        const normalizedArtistId = Number(artistId ?? 0);
        if (normalizedArtistId > 0) {
            map[String(uid)] = normalizedArtistId;
        } else {
            delete map[String(uid)];
        }
        localStorage.setItem(this.ARTIST_ID_MAP_KEY, JSON.stringify(map));
    }

    getArtistIdForUser(userId: number | null | undefined): number | null {
        const uid = Number(userId ?? 0);
        if (uid <= 0) {
            return null;
        }

        const map = this.getStoredArtistMap();
        const artistId = Number(map[String(uid)] ?? 0);
        return artistId > 0 ? artistId : null;
    }

    private getStoredArtistId(): number | null {
        const raw = localStorage.getItem(this.ARTIST_ID_KEY);
        const id = Number(raw ?? 0);
        return id > 0 ? id : null;
    }

    private getStoredArtistMap(): Record<string, number> {
        const raw = localStorage.getItem(this.ARTIST_ID_MAP_KEY);
        if (!raw) {
            return {};
        }

        try {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') {
                return {};
            }

            const normalized: Record<string, number> = {};
            for (const [key, value] of Object.entries(parsed)) {
                const numericKey = Number(key);
                const numericValue = Number(value ?? 0);
                if (numericKey > 0 && numericValue > 0) {
                    normalized[String(numericKey)] = numericValue;
                }
            }
            return normalized;
        } catch {
            localStorage.removeItem(this.ARTIST_ID_MAP_KEY);
            return {};
        }
    }
}
