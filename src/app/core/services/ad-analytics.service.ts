import { Injectable } from '@angular/core';

export type AdAnalyticsEventType =
    | 'ad_impression'
    | 'ad_started'
    | 'ad_completed'
    | 'user_skipped_song_after_ad';

export interface AdAnalyticsEvent {
    id: string;
    type: AdAnalyticsEventType;
    adId: number | null;
    adTitle: string;
    songId: number | null;
    occurredAt: string;
}

export interface AdAnalyticsSummary {
    impressions: number;
    starts: number;
    completions: number;
    skippedAfterAd: number;
    latestEvents: AdAnalyticsEvent[];
}

@Injectable({
    providedIn: 'root'
})
export class AdAnalyticsService {
    private readonly storageKey = 'revplay_ad_analytics_events';
    private readonly maxStoredEvents = 100;

    trackEvent(type: AdAnalyticsEventType, ad: any, songId?: number | null): void {
        const nextEvent: AdAnalyticsEvent = {
            id: `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
            type,
            adId: this.resolveAdId(ad),
            adTitle: String(ad?.title ?? ad?.name ?? 'Sponsored Audio').trim() || 'Sponsored Audio',
            songId: Number(songId ?? 0) > 0 ? Number(songId) : null,
            occurredAt: new Date().toISOString()
        };

        const events = this.readEvents();
        events.unshift(nextEvent);
        this.writeEvents(events.slice(0, this.maxStoredEvents));
    }

    getSummary(): AdAnalyticsSummary {
        const events = this.readEvents();
        return {
            impressions: events.filter((event) => event.type === 'ad_impression').length,
            starts: events.filter((event) => event.type === 'ad_started').length,
            completions: events.filter((event) => event.type === 'ad_completed').length,
            skippedAfterAd: events.filter((event) => event.type === 'user_skipped_song_after_ad').length,
            latestEvents: events.slice(0, 8)
        };
    }

    private resolveAdId(ad: any): number | null {
        const value = Number(ad?.adId ?? ad?.id ?? ad?.audioAdId ?? 0);
        return value > 0 ? value : null;
    }

    private readEvents(): AdAnalyticsEvent[] {
        const raw = localStorage.getItem(this.storageKey);
        if (!raw) {
            return [];
        }

        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    private writeEvents(events: AdAnalyticsEvent[]): void {
        localStorage.setItem(this.storageKey, JSON.stringify(events));
    }
}
