import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { distinctUntilChanged, filter, map } from 'rxjs/operators';
import { PlayerService } from '../core/services/player.service';
import { AuthService } from '../core/services/auth';

export interface RecentlyPlayedItem {
  songId: number;
  title: string;
  artist: string;
  imageUrl: string;
  isActive?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class RecentlyPlayedService {
  private readonly storageKey = 'revplay_recently_played';
  private readonly maxItems = 10;
  private readonly itemsSubject = new BehaviorSubject<RecentlyPlayedItem[]>(this.readFromStorage());
  readonly items$ = this.itemsSubject.asObservable();

  constructor(
    private playerService: PlayerService,
    private authService: AuthService
  ) {
    this.authService.currentUser$.subscribe(() => {
      this.itemsSubject.next(this.readFromStorage());
    });

    this.playerService.state$.pipe(
      map((state) => (state.isPlaying ? state.currentItem : null)),
      filter((track): track is any => !!track),
      map((track) => this.toRecentlyPlayedItem(track)),
      filter((item) => item.songId > 0 && item.isActive !== false),
      distinctUntilChanged((a, b) => a.songId === b.songId)
    ).subscribe((item) => this.add(item));
  }

  getSnapshot(): RecentlyPlayedItem[] {
    return this.itemsSubject.value;
  }

  add(item: RecentlyPlayedItem): void {
    const normalized = this.normalizeItem(item);
    if (normalized.songId <= 0 || normalized.isActive === false) {
      return;
    }

    const filtered = this.itemsSubject.value.filter((entry) => entry.songId !== normalized.songId);
    const next = [normalized, ...filtered].slice(0, this.maxItems);
    this.itemsSubject.next(next);
    this.writeToStorage(next);
  }

  private toRecentlyPlayedItem(track: any): RecentlyPlayedItem {
    return this.normalizeItem({
      songId: Number(track?.songId ?? track?.id ?? track?.contentId ?? 0),
      title: String(track?.title ?? track?.name ?? 'Unknown Song').trim(),
      artist: String(track?.artistName ?? track?.artist ?? track?.subtitle ?? 'Unknown Artist').trim(),
      imageUrl: String(track?.imageUrl ?? track?.coverUrl ?? '').trim(),
      isActive: track?.isActive
    });
  }

  private normalizeItem(item: RecentlyPlayedItem): RecentlyPlayedItem {
    return {
      songId: Number(item?.songId ?? 0),
      title: String(item?.title ?? 'Unknown Song').trim() || 'Unknown Song',
      artist: String(item?.artist ?? 'Unknown Artist').trim() || 'Unknown Artist',
      imageUrl: String(item?.imageUrl ?? '').trim(),
      isActive: item?.isActive
    };
  }

  private readFromStorage(): RecentlyPlayedItem[] {
    try {
      const raw = localStorage.getItem(this.resolveStorageKey());
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : [];
      return list
        .map((item) => this.normalizeItem(item))
        .filter((item) => item.songId > 0 && item.isActive !== false)
        .slice(0, this.maxItems);
    } catch {
      return [];
    }
  }

  private writeToStorage(items: RecentlyPlayedItem[]): void {
    try {
      localStorage.setItem(this.resolveStorageKey(), JSON.stringify(items));
    } catch {
      // Ignore storage errors.
    }
  }

  private resolveStorageKey(): string {
    const userId = Number(this.authService.getCurrentUserId() ?? 0);
    if (userId > 0) {
      return `${this.storageKey}:${userId}`;
    }
    return this.storageKey;
  }
}
