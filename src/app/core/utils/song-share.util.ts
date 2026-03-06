export interface SongShareInput {
    songId?: number | null;
    title?: string | null;
    artistName?: string | null;
}

export type SongShareStatus = 'shared' | 'copied' | 'cancelled' | 'unsupported' | 'failed';

export interface SongShareResult {
    status: SongShareStatus;
}

export type SongSharePlatform = 'WHATSAPP' | 'TELEGRAM';

export interface SongSharePayload {
    shareUrl: string;
    shareText: string;
}

export function buildSongSharePayload(input: SongShareInput): SongSharePayload {
    const songId = Number(input?.songId ?? 0);
    const title = String(input?.title ?? 'Song').trim() || 'Song';
    const artistName = String(input?.artistName ?? '').trim();
    const lookupText = [title, artistName].filter((part) => !!part).join(' ').trim();

    const params = new URLSearchParams();
    if (lookupText) {
        params.set('q', lookupText);
        params.set('type', 'SONG');
    }
    if (songId > 0) {
        params.set('songId', String(songId));
    }

    const searchPath = `/search${params.toString() ? `?${params.toString()}` : ''}`;
    const origin = typeof window !== 'undefined'
        ? String(window.location?.origin ?? '').replace(/\/$/, '')
        : '';
    const shareUrl = origin ? `${origin}${searchPath}` : searchPath;
    const shareText = artistName ? `${title} - ${artistName}` : title;
    return { shareUrl, shareText };
}

export async function shareSongWithFallback(input: SongShareInput): Promise<SongShareResult> {
    const { shareUrl, shareText } = buildSongSharePayload(input);

    const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;
    if (nav?.share) {
        try {
            await nav.share({
                title: 'RevPlay Song',
                text: shareText,
                url: shareUrl
            });
            return { status: 'shared' };
        } catch (error: any) {
            if (String(error?.name ?? '') === 'AbortError') {
                return { status: 'cancelled' };
            }
            return { status: 'failed' };
        }
    }

    if (nav?.clipboard?.writeText) {
        try {
            await nav.clipboard.writeText(shareUrl);
            return { status: 'copied' };
        } catch {
            return { status: 'failed' };
        }
    }

    return { status: 'unsupported' };
}

export function shareSongToPlatform(input: SongShareInput, platform: SongSharePlatform): SongShareResult {
    if (typeof window === 'undefined') {
        return { status: 'unsupported' };
    }

    const { shareUrl, shareText } = buildSongSharePayload(input);
    const encodedText = encodeURIComponent(`${shareText} ${shareUrl}`.trim());
    const encodedUrl = encodeURIComponent(shareUrl);
    const encodedCaption = encodeURIComponent(shareText);

    const shareTarget = platform === 'WHATSAPP'
        ? `https://wa.me/?text=${encodedText}`
        : `https://t.me/share/url?url=${encodedUrl}&text=${encodedCaption}`;

    const handle = window.open(shareTarget, '_blank', 'noopener,noreferrer');
    if (!handle) {
        return { status: 'failed' };
    }
    return { status: 'shared' };
}
