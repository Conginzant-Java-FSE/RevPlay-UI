import { Injectable } from '@angular/core';

export type FollowType = 'ARTIST' | 'PODCAST';

export interface FollowItem {
  id: number;
  name: string;
  subtitle?: string;
  type: FollowType;
}

interface FollowingStore {
  artists: FollowItem[];
  podcasts: FollowItem[];
}

@Injectable({
  providedIn: 'root'
})
export class FollowingService {
  private readonly storageKey = 'revplay_following_v1';

  getFollowedArtists(): FollowItem[] {
    return [...this.readStore().artists];
  }

  getFollowedPodcasts(): FollowItem[] {
    return [...this.readStore().podcasts];
  }

  isArtistFollowed(artistId: number): boolean {
    const id = Number(artistId ?? 0);
    if (id <= 0) {
      return false;
    }
    return this.readStore().artists.some((item) => Number(item?.id ?? 0) === id);
  }

  isPodcastFollowed(podcastId: number): boolean {
    const id = Number(podcastId ?? 0);
    if (id <= 0) {
      return false;
    }
    return this.readStore().podcasts.some((item) => Number(item?.id ?? 0) === id);
  }

  toggleArtist(item: Partial<FollowItem>): boolean {
    const normalized = this.normalizeItem(item, 'ARTIST');
    if (!normalized) {
      return false;
    }

    const store = this.readStore();
    const exists = store.artists.some((entry) => entry.id === normalized.id);
    if (exists) {
      store.artists = store.artists.filter((entry) => entry.id !== normalized.id);
      this.writeStore(store);
      return false;
    }

    store.artists = [normalized, ...store.artists.filter((entry) => entry.id !== normalized.id)];
    this.writeStore(store);
    return true;
  }

  togglePodcast(item: Partial<FollowItem>): boolean {
    const normalized = this.normalizeItem(item, 'PODCAST');
    if (!normalized) {
      return false;
    }

    const store = this.readStore();
    const exists = store.podcasts.some((entry) => entry.id === normalized.id);
    if (exists) {
      store.podcasts = store.podcasts.filter((entry) => entry.id !== normalized.id);
      this.writeStore(store);
      return false;
    }

    store.podcasts = [normalized, ...store.podcasts.filter((entry) => entry.id !== normalized.id)];
    this.writeStore(store);
    return true;
  }

  unfollowArtist(artistId: number): void {
    const id = Number(artistId ?? 0);
    if (id <= 0) {
      return;
    }

    const store = this.readStore();
    store.artists = store.artists.filter((entry) => entry.id !== id);
    this.writeStore(store);
  }

  unfollowPodcast(podcastId: number): void {
    const id = Number(podcastId ?? 0);
    if (id <= 0) {
      return;
    }

    const store = this.readStore();
    store.podcasts = store.podcasts.filter((entry) => entry.id !== id);
    this.writeStore(store);
  }

  private normalizeItem(item: Partial<FollowItem>, type: FollowType): FollowItem | null {
    const id = Number(item?.id ?? 0);
    if (id <= 0) {
      return null;
    }

    const name = String(item?.name ?? '').trim() || (type === 'ARTIST' ? `Artist #${id}` : `Podcast #${id}`);
    const subtitle = String(item?.subtitle ?? '').trim();
    return {
      id,
      name,
      subtitle,
      type
    };
  }

  private readStore(): FollowingStore {
    const raw = localStorage.getItem(this.storageKey);
    if (!raw) {
      return { artists: [], podcasts: [] };
    }

    try {
      const parsed = JSON.parse(raw);
      const artists = this.normalizeList(parsed?.artists, 'ARTIST');
      const podcasts = this.normalizeList(parsed?.podcasts, 'PODCAST');
      return { artists, podcasts };
    } catch {
      localStorage.removeItem(this.storageKey);
      return { artists: [], podcasts: [] };
    }
  }

  private writeStore(store: FollowingStore): void {
    localStorage.setItem(this.storageKey, JSON.stringify({
      artists: this.normalizeList(store.artists, 'ARTIST'),
      podcasts: this.normalizeList(store.podcasts, 'PODCAST')
    }));
  }

  private normalizeList(items: any[], type: FollowType): FollowItem[] {
    const unique = new Map<number, FollowItem>();
    for (const raw of items ?? []) {
      const normalized = this.normalizeItem(raw, type);
      if (!normalized) {
        continue;
      }
      unique.set(normalized.id, normalized);
    }
    return Array.from(unique.values());
  }
}
