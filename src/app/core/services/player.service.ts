import { Injectable, NgZone } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, Subject, forkJoin, from, of, throwError } from 'rxjs';
import { catchError, concatMap, finalize, map, switchMap, toArray } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { ApiService } from './api';
import { hasAnyRole } from '../utils/role.util';
import { PremiumService } from './premium.service';
import { ArtistService } from './artist.service';
import { AdService, RevPlayAd } from './ad.service';
import { AdAnalyticsService } from './ad-analytics.service';

export interface PlayerState {
    currentItem: any | null;
    queue: any[];
    currentIndex: number;
    isPlaying: boolean;
    repeatMode: 'OFF' | 'ONE' | 'ALL';
    isShuffle: boolean;
    volume: number;
    duration: number;
    currentTime: number;
    bufferedPercent: number;
    isLoading: boolean;
    isQueueSyncing: boolean;
    autoplayEnabled: boolean;
    autoplayMessage: string | null;
    songsPlayedCount: number;
    isAdPlaying: boolean;
}

@Injectable({
    providedIn: 'root'
})
export class PlayerService {
    private readonly LAST_PLAYBACK_KEY = 'revplay_last_song';
    private readonly playbackSaveIntervalMs = 3000;
    private audio = new Audio();
    private queueSyncVersion = 0;
    private mutedVolume = 50;
    private playbackRequestVersion = 0;
    private activeObjectUrl: string | null = null;
    private autoplayApiBlocked = false;
    private autoplayCycleTracks: any[] = [];
    private autoplayCycleCursor = -1;
    private queueApiBlocked = false;
    private localQueueIdSeed = -1;
    private progressTicker: ReturnType<typeof setInterval> | null = null;
    private startupFallbackTimer: ReturnType<typeof setTimeout> | null = null;
    private pendingResumeTime: number | null = null;
    private lastPlaybackPersistedAt = 0;
    private nextAdSongCheckpoint = this.generateNextAdSongCheckpoint(0);
    private resumeAfterAdAction: (() => void) | null = null;
    private pendingMusicFadeIn = false;
    private lastPlaybackWasAd = false;
    private pendingSkipAfterAdTracking = false;
    private activeAdContext: RevPlayAd | null = null;
    private lastCompletedAdContext: RevPlayAd | null = null;

    private initialState: PlayerState = {
        currentItem: null,
        queue: [],
        currentIndex: -1,
        isPlaying: false,
        repeatMode: 'OFF',
        isShuffle: false,
        volume: 50,
        duration: 0,
        currentTime: 0,
        bufferedPercent: 0,
        isLoading: false,
        isQueueSyncing: false,
        autoplayEnabled: true,
        autoplayMessage: null,
        songsPlayedCount: 0,
        isAdPlaying: false
    };

    private stateSubject = new BehaviorSubject<PlayerState>(this.initialState);
    private nowPlayingOpenRequestSubject = new Subject<void>();
    public state$ = this.stateSubject.asObservable();
    public nowPlayingOpenRequest$ = this.nowPlayingOpenRequestSubject.asObservable();

    constructor(
        private apiService: ApiService,
        private http: HttpClient,
        private ngZone: NgZone,
        private premiumService: PremiumService,
        private artistService: ArtistService,
        private adService: AdService,
        private adAnalyticsService: AdAnalyticsService
    ) {
        this.audio.preload = 'auto';
        this.initAudioListeners();

        const savedVolume = Number(localStorage.getItem('revplay_volume') ?? 50);
        if (!Number.isNaN(savedVolume)) {
            this.updateState({ volume: savedVolume });
            this.audio.volume = savedVolume / 100;
            this.mutedVolume = savedVolume || 50;
        }

        if (this.isQueueEnabledForCurrentRole()) {
            this.refreshQueueFromServer();
        }

        this.restoreLastPlaybackState();
    }

    playTrack(track: any, queue: any[] = [track]): void {
        this.requestNowPlayingOpen();
        const normalizedQueue = (queue ?? []).map((item) => this.normalizeTrack(item));
        const normalizedTrack = this.normalizeTrack(track);
        const currentIndex = this.resolveQueueIndex(normalizedQueue, normalizedTrack);
        const trackFromQueue = normalizedQueue[currentIndex >= 0 ? currentIndex : 0] ?? null;
        const effectiveTrack = this.mergeTrackData(normalizedTrack, trackFromQueue);
        this.playResolvedTrack(effectiveTrack, normalizedQueue, currentIndex, true, true);
    }

    playQueueItem(track: any): void {
        this.requestNowPlayingOpen();
        const state = this.getState();
        const queue = (state.queue.length > 0 ? state.queue : [track]).map((item) => this.normalizeTrack(item));
        const normalizedTrack = this.normalizeTrack(track);
        const currentIndex = this.resolveQueueIndex(queue, normalizedTrack);
        const trackFromQueue = queue[currentIndex >= 0 ? currentIndex : 0] ?? null;
        const effectiveTrack = this.mergeTrackData(normalizedTrack, trackFromQueue);
        this.playResolvedTrack(effectiveTrack, queue, currentIndex, false, true);
    }

    addToQueue(track: any): void {
        const userId = this.getCurrentQueueUserId();
        if (!userId || this.queueApiBlocked) {
            this.appendToLocalQueue(track);
            return;
        }

        const body = this.buildQueueAddBody(track, userId);
        if (!body) {
            return;
        }

        this.apiService.post<any>('/queue', body).subscribe({
            next: (queueItem) => {
                this.appendToLocalQueue(track, Number(queueItem?.queueId ?? 0));
            },
            error: (err) => {
                if (this.isQueueApiForbidden(err)) {
                    this.queueApiBlocked = true;
                    this.appendToLocalQueue(track);
                }
            }
        });
    }

    refreshQueueFromServer(): void {
        if (this.queueApiBlocked) {
            return;
        }

        const userId = this.getCurrentQueueUserId();
        if (!userId) {
            return;
        }

        this.apiService.get<any[]>(`/queue/${userId}`).pipe(
            switchMap((queueItems) => this.resolveQueueTracks(queueItems ?? [])),
            catchError((err) => {
                if (this.isQueueApiForbidden(err)) {
                    this.queueApiBlocked = true;
                    return of(null);
                }
                return of([]);
            })
        ).subscribe((queueTracks) => {
            if (!queueTracks) {
                return;
            }
            const activeQueueTracks = this.filterInactiveTracks(queueTracks);
            const state = this.getState();
            const isCurrentInactive = this.isInactiveTrack(state.currentItem);
            const currentTrackId = this.getTrackId(state.currentItem);
            const nextIndex = activeQueueTracks.findIndex((item) => this.getTrackId(item) === currentTrackId);
            this.updateState({
                queue: activeQueueTracks,
                currentIndex: nextIndex >= 0 ? nextIndex : (isCurrentInactive ? -1 : state.currentIndex)
            });
            if (!isCurrentInactive) {
                return;
            }
            if (activeQueueTracks.length === 0) {
                this.audio.pause();
                this.audio.currentTime = 0;
                this.updateState({
                    currentItem: null,
                    currentIndex: -1,
                    isPlaying: false,
                    isLoading: false,
                    currentTime: 0,
                    duration: 0,
                    bufferedPercent: 0
                });
                return;
            }
            this.playNextLocal();
        });
    }

    removeFromQueue(queueId: number): void {
        if (!queueId) {
            return;
        }

        if (this.queueApiBlocked) {
            this.applyQueueRemoval(queueId);
            return;
        }

        this.apiService.delete<any>(`/queue/${queueId}`).subscribe({
            next: () => this.applyQueueRemoval(queueId),
            error: (err) => {
                if (this.isQueueApiForbidden(err)) {
                    this.queueApiBlocked = true;
                    this.applyQueueRemoval(queueId);
                }
            }
        });
    }

    reorderQueue(queueId: number, direction: 'UP' | 'DOWN'): void {
        const state = this.getState();
        const currentIndex = state.queue.findIndex((item) => Number(item?.queueId ?? 0) === queueId);
        if (currentIndex < 0) {
            return;
        }

        const targetIndex = direction === 'UP' ? currentIndex - 1 : currentIndex + 1;
        if (targetIndex < 0 || targetIndex >= state.queue.length) {
            return;
        }

        const nextQueue = [...state.queue];
        const temp = nextQueue[currentIndex];
        nextQueue[currentIndex] = nextQueue[targetIndex];
        nextQueue[targetIndex] = temp;

        const userId = this.getCurrentUserId();
        if (!this.isQueueEnabledForCurrentRole() || this.queueApiBlocked) {
            const playingTrackId = this.getTrackId(state.currentItem);
            const nextPlayingIndex = nextQueue.findIndex((item) => this.getTrackId(item) === playingTrackId);
            this.updateState({ queue: nextQueue, currentIndex: nextPlayingIndex });
            return;
        }
        const queueIdsInOrder = nextQueue.map((item) => Number(item?.queueId ?? 0)).filter((id) => id > 0);
        if (!userId || queueIdsInOrder.length !== nextQueue.length) {
            const playingTrackId = this.getTrackId(state.currentItem);
            const nextPlayingIndex = nextQueue.findIndex((item) => this.getTrackId(item) === playingTrackId);
            this.updateState({ queue: nextQueue, currentIndex: nextPlayingIndex });
            return;
        }

        this.apiService.put<any[]>('/queue/reorder', {
            userId,
            queueIdsInOrder
        }).pipe(
            catchError((err) => {
                if (this.isQueueApiForbidden(err)) {
                    this.queueApiBlocked = true;
                }
                return of([]);
            })
        ).subscribe(() => {
            const playingTrackId = this.getTrackId(state.currentItem);
            const nextPlayingIndex = nextQueue.findIndex((item) => this.getTrackId(item) === playingTrackId);
            this.updateState({ queue: nextQueue, currentIndex: nextPlayingIndex });
        });
    }

    togglePlay(): void {
        const state = this.getState();
        if (!state.currentItem) {
            return;
        }
        if (this.isInactiveTrack(state.currentItem)) {
            const activeQueue = this.filterInactiveTracks(state.queue);
            this.updateState({
                queue: activeQueue,
                currentIndex: -1
            });
            if (activeQueue.length > 0) {
                this.playNextLocal();
            }
            return;
        }

        if (state.isPlaying) {
            this.audio.pause();
            this.updateState({ isPlaying: false });
            return;
        }

        this.updateState({ isLoading: this.audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA });
        this.updateState({ isPlaying: true });
        this.audio.play().then(() => {
            this.startProgressTicker();
            this.updatePlaybackProgress(true);
            this.updateState({ isPlaying: true, isLoading: false });
        }).catch(() => {
            this.updateState({ isPlaying: false, isLoading: false });
        });
    }

    next(): void {
        if (this.getState().isAdPlaying) {
            return;
        }
        this.trackSkipAfterAd();
        this.playNextLocal();
    }

    previous(): void {
        if (this.getState().isAdPlaying) {
            return;
        }
        if (this.audio.currentTime > 3) {
            this.seek(0);
            return;
        }

        if (this.navigateUsingQueueEndpoint('previous')) {
            return;
        }
        this.trackSkipAfterAd();
        this.playPreviousLocal();
    }

    seek(timeInSeconds: number): void {
        if (this.getState().isAdPlaying) {
            return;
        }
        const value = Number(timeInSeconds);
        this.audio.currentTime = Number.isNaN(value) ? 0 : value;
        this.updatePlaybackProgress(true);
    }

    setVolume(volume: number): void {
        const value = Math.min(100, Math.max(0, Number(volume)));
        this.audio.volume = value / 100;
        if (value > 0) {
            this.mutedVolume = value;
        }
        this.updateState({ volume: value });
        localStorage.setItem('revplay_volume', value.toString());
    }

    toggleMute(): void {
        const currentVolume = this.getState().volume;
        if (currentVolume === 0) {
            this.setVolume(this.mutedVolume || 50);
            return;
        }
        this.mutedVolume = currentVolume;
        this.setVolume(0);
    }

    toggleRepeat(): void {
        const state = this.getState();
        const modes: ('OFF' | 'ONE' | 'ALL')[] = ['OFF', 'ALL', 'ONE'];
        const nextMode = modes[(modes.indexOf(state.repeatMode) + 1) % modes.length];
        this.updateState({ repeatMode: nextMode });
    }

    toggleShuffle(): void {
        const state = this.getState();
        this.updateState({ isShuffle: !state.isShuffle });
    }

    toggleAutoplay(): void {
        const state = this.getState();
        this.updateState({
            autoplayEnabled: !state.autoplayEnabled,
            autoplayMessage: null
        });
    }

    stop(): void {
        this.clearStartupFallbackTimer();
        this.stopProgressTicker();
        this.audio.pause();
        this.audio.currentTime = 0;
        this.clearObjectUrl();
        this.pendingResumeTime = null;
        this.updateState({
            isPlaying: false,
            isLoading: false,
            currentTime: 0,
            duration: 0,
            bufferedPercent: 0,
            isAdPlaying: false
        });
    }

    clearQueue(): void {
        this.updateState({
            queue: [],
            currentIndex: -1
        });
    }

    reset(preserveLastPlayback = false): void {
        this.stop();
        this.autoplayCycleTracks = [];
        this.autoplayCycleCursor = -1;
        this.resumeAfterAdAction = null;
        this.pendingMusicFadeIn = false;
        this.lastPlaybackWasAd = false;
        this.pendingSkipAfterAdTracking = false;
        this.activeAdContext = null;
        this.lastCompletedAdContext = null;
        this.nextAdSongCheckpoint = this.generateNextAdSongCheckpoint(0);
        if (!preserveLastPlayback) {
            const userId = this.getCurrentUserId() ?? 0;
            localStorage.removeItem(this.resolvePlaybackStorageKey(userId));
            localStorage.removeItem(this.LAST_PLAYBACK_KEY);
        }
        this.updateState({
            ...this.initialState,
            volume: this.getState().volume,
            autoplayEnabled: this.getState().autoplayEnabled
        });
    }

    private getState(): PlayerState {
        return this.stateSubject.getValue();
    }

    private updateState(newState: Partial<PlayerState>): void {
        const nextState = { ...this.getState(), ...newState };
        if (NgZone.isInAngularZone()) {
            this.stateSubject.next(nextState);
            return;
        }
        this.ngZone.run(() => this.stateSubject.next(nextState));
    }

    private initAudioListeners(): void {
        this.audio.addEventListener('timeupdate', () => {
            this.updatePlaybackProgress();
        });

        this.audio.addEventListener('loadedmetadata', () => {
            if (this.pendingResumeTime !== null && Number.isFinite(this.pendingResumeTime) && this.pendingResumeTime >= 0) {
                const duration = Number(this.audio.duration ?? 0);
                const target = Number.isFinite(duration) && duration > 0
                    ? Math.min(this.pendingResumeTime, Math.max(0, duration - 0.25))
                    : this.pendingResumeTime;
                this.audio.currentTime = Math.max(0, target);
                this.pendingResumeTime = null;
            }
            this.updatePlaybackProgress(true);
        });

        this.audio.addEventListener('loadeddata', () => {
            this.updatePlaybackProgress(true);
        });

        this.audio.addEventListener('durationchange', () => {
            this.updatePlaybackProgress();
        });

        this.audio.addEventListener('canplay', () => {
            this.updateState({
                bufferedPercent: this.getBufferedPercent(),
                isLoading: false
            });
        });

        this.audio.addEventListener('canplaythrough', () => {
            this.updateState({
                bufferedPercent: this.getBufferedPercent(),
                isLoading: false
            });
        });

        this.audio.addEventListener('progress', () => {
            this.updateState({ bufferedPercent: this.getBufferedPercent() });
        });

        this.audio.addEventListener('play', () => {
            this.clearStartupFallbackTimer();
            this.startProgressTicker();
            this.updatePlaybackProgress(true);
            this.updateState({ isPlaying: true, isLoading: false });
        });

        this.audio.addEventListener('ended', () => {
            this.clearStartupFallbackTimer();
            this.stopProgressTicker();
            this.updatePlaybackProgress();
            this.handleSongEnd();
        });

        this.audio.addEventListener('playing', () => {
            this.clearStartupFallbackTimer();
            this.startProgressTicker();
            this.updatePlaybackProgress(true);
            this.updateState({
                isPlaying: true,
                bufferedPercent: this.getBufferedPercent(),
                isLoading: false
            });
        });

        this.audio.addEventListener('pause', () => {
            this.clearStartupFallbackTimer();
            this.stopProgressTicker();
            this.updatePlaybackProgress();
            this.updateState({ isPlaying: false, isLoading: false });
            this.persistPlaybackState(true);
        });

        this.audio.addEventListener('waiting', () => {
            if (!this.audio.paused) {
                this.updateState({ isLoading: true });
            }
        });

        this.audio.addEventListener('error', () => {
            this.clearStartupFallbackTimer();
            this.stopProgressTicker();
            const state = this.getState();
            if (state.isAdPlaying) {
                this.handleAdPlaybackFailure();
                return;
            }
            this.updateState({ isLoading: false, isPlaying: false });
            if ((state.queue?.length ?? 0) > 1) {
                this.playNextLocal();
            }
        });
    }

    private playResolvedTrack(
        track: any,
        queue: any[],
        currentIndex: number,
        syncQueue: boolean,
        trackHistory: boolean
    ): void {
        const activeQueue = this.filterInactiveTracks(queue);
        const safeIndex = currentIndex >= 0 ? currentIndex : 0;
        const trackFromQueue = queue[safeIndex] ?? null;
        const effectiveTrack = this.mergeTrackData(track, trackFromQueue);
        const activeQueueIndex = activeQueue.findIndex((item) => this.getTrackId(item) === this.getTrackId(effectiveTrack));
        if (!effectiveTrack?.isAutoplay) {
            this.autoplayCycleTracks = [];
            this.autoplayCycleCursor = -1;
        }
        if (this.isInactiveTrack(effectiveTrack)) {
            this.updateState({
                queue: activeQueue,
                currentIndex: -1
            });
            if (activeQueue.length > 0) {
                this.playNextLocal();
                return;
            }
            this.stopProgressTicker();
            this.clearStartupFallbackTimer();
            this.audio.pause();
            this.audio.currentTime = 0;
            this.updateState({
                currentItem: null,
                queue: [],
                currentIndex: -1,
                isLoading: false,
                isPlaying: false,
                currentTime: 0,
                duration: 0,
                bufferedPercent: 0
            });
            return;
        }
        const sourceUrl = this.resolveAudioUrl(effectiveTrack);
        if (!sourceUrl) {
            this.stopProgressTicker();
            this.clearStartupFallbackTimer();
            const songId = Number(effectiveTrack?.songId ?? effectiveTrack?.id ?? 0);
            if (songId > 0 && !effectiveTrack?._playbackResolved) {
                this.apiService.get<any>(`/songs/${songId}`).pipe(
                    map((song) =>
                        this.mergeTrackData(
                            { ...effectiveTrack, _playbackResolved: true },
                            {
                                ...song,
                                id: song?.songId ?? songId,
                                songId: song?.songId ?? songId,
                                type: 'SONG'
                            }
                        )
                    ),
                    catchError(() => of(null))
                ).subscribe((resolvedTrack) => {
                    if (!resolvedTrack) {
                        this.updateState({ isLoading: false, isPlaying: false });
                        return;
                    }
                    this.playResolvedTrack(resolvedTrack, queue, safeIndex, syncQueue, trackHistory);
                });
                return;
            }
            this.updateState({ isLoading: false, isPlaying: false });
            return;
        }

        const requestVersion = ++this.playbackRequestVersion;
        this.stopProgressTicker();
        this.clearStartupFallbackTimer();
        const state = this.getState();
        const knownDuration = this.resolveKnownDuration(effectiveTrack);
        const shouldIncreaseCount = this.shouldIncreaseSongsPlayedCount(effectiveTrack);
        const nextSongsPlayedCount = shouldIncreaseCount ? state.songsPlayedCount + 1 : state.songsPlayedCount;
        const targetVolume = Math.max(0, Math.min(1, Number(state.volume ?? 50) / 100));
        const shouldFadeIn = this.pendingMusicFadeIn && !state.isAdPlaying;
        this.pendingMusicFadeIn = false;
        this.updateState({
            currentItem: effectiveTrack,
            queue: activeQueue,
            currentIndex: activeQueueIndex >= 0 ? activeQueueIndex : safeIndex,
            duration: knownDuration,
            currentTime: 0,
            bufferedPercent: 0,
            isLoading: true,
            songsPlayedCount: nextSongsPlayedCount,
            isAdPlaying: false
        });
        this.resolvePlayableSource(sourceUrl, effectiveTrack).subscribe({
            next: (playableSourceUrl) => {
                if (requestVersion !== this.playbackRequestVersion) {
                    return;
                }
                this.applyAudioSource(playableSourceUrl);
                this.audio.volume = shouldFadeIn ? 0 : targetVolume;
                this.scheduleStartupFallback(requestVersion, playableSourceUrl);
                this.updateState({ isPlaying: true });
                const playRequest = this.audio.play();
                playRequest.then(() => {
                    if (!shouldFadeIn || requestVersion !== this.playbackRequestVersion) {
                        this.audio.volume = targetVolume;
                        return;
                    }
                    this.adService.fadeInMusic(this.audio, targetVolume).subscribe();
                }).catch(() => {
                    if (requestVersion === this.playbackRequestVersion) {
                        this.clearStartupFallbackTimer();
                        this.stopProgressTicker();
                        this.updateState({ isLoading: false, isPlaying: false });
                    }
                });
            },
            error: () => {
                if (requestVersion === this.playbackRequestVersion) {
                    this.clearStartupFallbackTimer();
                    this.stopProgressTicker();
                    this.updateState({ isLoading: false, isPlaying: false });
                }
            }
        });

        if (trackHistory) {
            this.trackPlayHistory(effectiveTrack);
        }

        this.lastPlaybackWasAd = false;
        this.activeAdContext = null;

        if (syncQueue) {
            this.syncQueueWithBackend(activeQueue, this.getTrackId(effectiveTrack));
        }
    }

    private syncQueueWithBackend(queue: any[], currentTrackId: number | null): void {
        if (this.queueApiBlocked) {
            return;
        }

        const userId = this.getCurrentQueueUserId();
        if (!userId || queue.length === 0) {
            return;
        }

        const version = ++this.queueSyncVersion;
        this.updateState({ isQueueSyncing: true });

        this.apiService.get<any[]>(`/queue/${userId}`).pipe(
            catchError((err) => {
                if (this.isQueueApiForbidden(err)) {
                    this.queueApiBlocked = true;
                }
                return of([]);
            }),
            switchMap((existingQueue) => {
                const queueIds = (existingQueue ?? [])
                    .map((item) => Number(item?.queueId ?? 0))
                    .filter((id) => id > 0);

                return from(queueIds).pipe(
                    concatMap((queueId) =>
                        this.apiService.delete<any>(`/queue/${queueId}`).pipe(
                            catchError(() => of(null))
                        )
                    ),
                    toArray()
                );
            }),
            switchMap(() =>
                from(queue).pipe(
                    concatMap((queueTrack) => {
                        const body = this.buildQueueAddBody(queueTrack, userId);
                        if (!body) {
                            return of(null);
                        }
                        return this.apiService.post<any>('/queue', body).pipe(
                            catchError(() => of(null))
                        );
                    }),
                    toArray()
                )
            ),
            finalize(() => {
                if (version === this.queueSyncVersion) {
                    this.updateState({ isQueueSyncing: false });
                }
            })
        ).subscribe((createdQueueItems) => {
            if (version !== this.queueSyncVersion) {
                return;
            }

            const queueWithIds = queue.map((item, index) =>
                this.normalizeTrack({
                    ...item,
                    queueId: Number(createdQueueItems[index]?.queueId ?? item?.queueId ?? 0),
                    position: Number(createdQueueItems[index]?.position ?? index + 1)
                })
            );

            const currentIndex = queueWithIds.findIndex((item) => this.getTrackId(item) === currentTrackId);
            const trackAtIndex = currentIndex >= 0 ? queueWithIds[currentIndex] : queueWithIds[0] ?? null;

            this.updateState({
                queue: queueWithIds,
                currentIndex: currentIndex >= 0 ? currentIndex : 0,
                currentItem: trackAtIndex ?? this.getState().currentItem
            });
        });
    }

    private navigateUsingQueueEndpoint(direction: 'next' | 'previous'): boolean {
        if (this.queueApiBlocked) {
            return false;
        }

        const userId = this.getCurrentQueueUserId();
        const currentQueueId = Number(this.getState().currentItem?.queueId ?? 0);
        if (!userId || !currentQueueId) {
            return false;
        }

        this.apiService.get<any>(`/queue/${userId}/${direction}?currentQueueId=${currentQueueId}`).subscribe({
            next: (queueItem) => this.playQueueResponseItem(queueItem, direction),
            error: (err) => {
                if (this.isQueueApiForbidden(err)) {
                    this.queueApiBlocked = true;
                }
                if (direction === 'next') {
                    this.playNextLocal();
                } else {
                    this.playPreviousLocal();
                }
            }
        });

        return true;
    }

    private playQueueResponseItem(queueItem: any, direction: 'next' | 'previous'): void {
        const state = this.getState();
        const queueId = Number(queueItem?.queueId ?? 0);
        const currentQueueId = Number(state.currentItem?.queueId ?? 0);
        const responseSongId = Number(queueItem?.songId ?? queueItem?.id ?? 0);
        const currentSongId = Number(state.currentItem?.songId ?? state.currentItem?.id ?? 0);

        if (
            direction === 'next' &&
            (
                (queueId > 0 && currentQueueId > 0 && queueId === currentQueueId) ||
                (responseSongId > 0 && currentSongId > 0 && responseSongId === currentSongId)
            )
        ) {
            this.playNextLocal();
            return;
        }

        const existingIndex = state.queue.findIndex((item) => Number(item?.queueId ?? 0) === queueId);
        if (existingIndex >= 0) {
            this.playQueueTrackAtIndex(state.queue, existingIndex, true);
            return;
        }

        const songId = Number(queueItem?.songId ?? 0);
        if (!songId) {
            if (direction === 'next') {
                this.playNextLocal();
            } else {
                this.playPreviousLocal();
            }
            return;
        }

        this.apiService.get<any>(`/songs/${songId}`).pipe(
            map((song) =>
                this.normalizeTrack({
                    ...song,
                    id: song?.songId ?? songId,
                    songId: song?.songId ?? songId,
                    title: song?.title ?? `Song #${songId}`,
                    artistName: song?.artistName ?? '',
                    fileUrl: song?.fileUrl ?? '',
                    queueId,
                    type: 'SONG'
                })
            ),
            catchError(() => of(null))
        ).subscribe((resolvedTrack) => {
            if (!resolvedTrack) {
                return;
            }
            const nextQueue = [...state.queue, resolvedTrack];
            this.playResolvedTrack(resolvedTrack, nextQueue, nextQueue.length - 1, false, true);
        });
    }

    private playNextLocal(): void {
        const state = this.getState();
        if (state.queue.length === 0) {
            if (state.currentItem) {
                this.playAutoplayRecommendation();
            }
            return;
        }

        let nextIndex = state.currentIndex + 1;
        if (state.isShuffle) {
            nextIndex = Math.floor(Math.random() * state.queue.length);
        } else if (nextIndex >= state.queue.length) {
            if (state.repeatMode === 'ALL') {
                nextIndex = 0;
            } else {
                this.playAutoplayRecommendation();
                return;
            }
        }

        this.playQueueTrackAtIndex(state.queue, nextIndex, true);
    }

    private handleSongEnd(): void {
        const state = this.getState();
        if (state.isAdPlaying) {
            this.handleAdEnded();
            return;
        }

        if (state.repeatMode === 'ONE') {
            this.audio.currentTime = 0;
            this.audio.play().catch(() => { });
            return;
        }

        if (this.shouldInsertAdBeforeNextSong(state)) {
            this.playAdvertisementBetweenSongs(() => this.playNextLocal());
            return;
        }

        const isLastSong = state.currentIndex >= state.queue.length - 1;
        if (isLastSong) {
            this.playAutoplayRecommendation();
            return;
        }

        this.playNextLocal();
    }

    private playAutoplayRecommendation(): void {
        const state = this.getState();
        const userId = this.getCurrentUserId();
        const currentSongId = Number(state.currentItem?.songId ?? state.currentItem?.id ?? 0);

        if (this.tryPlayUpcomingTrackFromQueue(state)) {
            this.updateState({ autoplayMessage: null });
            return;
        }

        if (!state.autoplayEnabled) {
            this.updateState({ isLoading: false, isPlaying: false, autoplayMessage: null });
            return;
        }

        if (this.autoplayApiBlocked || !this.isAutoplayEnabledForCurrentRole() || !userId || !currentSongId) {
            this.restartAutoplayCycle();
            return;
        }

        this.updateState({ isLoading: true, autoplayMessage: null });
        this.apiService.get<any>(`/autoplay/next/${encodeURIComponent(String(userId))}/${encodeURIComponent(String(currentSongId))}`).pipe(
            map((response) => this.extractAutoplayTrack(response)),
            map((track) => this.normalizeAutoplayTrack(track, this.getState().queue ?? [], currentSongId)),
            catchError((err) => {
                const status = Number(err?.status ?? 0);
                if (status === 401 || status === 403) {
                    this.autoplayApiBlocked = true;
                }
                return of(null);
            })
        ).subscribe((recommendedTrack) => {
            if (!recommendedTrack) {
                this.restartAutoplayCycle();
                return;
            }

            const latestState = this.getState();
            const nextQueue = [...(latestState.queue ?? []), recommendedTrack];
            const autoplayStartIndex = Math.max(0, nextQueue.length - 1);
            this.autoplayCycleTracks = this.mergeAutoplayCycleTrack(recommendedTrack, this.autoplayCycleTracks);
            this.autoplayCycleCursor = this.autoplayCycleTracks.findIndex((item) => this.getTrackId(item) === this.getTrackId(recommendedTrack));
            this.playResolvedTrack(recommendedTrack, nextQueue, autoplayStartIndex, false, true);
            this.updateState({ autoplayMessage: null });
        });
    }

    private extractAutoplayTrack(response: any): any | null {
        if (!response) {
            return null;
        }
        if (Array.isArray(response)) {
            return response[0] ?? null;
        }
        if (response?.data && !Array.isArray(response.data)) {
            return response.data;
        }
        if (Array.isArray(response?.content)) {
            return response.content[0] ?? null;
        }
        if (Array.isArray(response?.items)) {
            return response.items[0] ?? null;
        }
        if (Array.isArray(response?.data)) {
            return response.data[0] ?? null;
        }
        if (Array.isArray(response?.data?.content)) {
            return response.data.content[0] ?? null;
        }
        if (Array.isArray(response?.data?.items)) {
            return response.data.items[0] ?? null;
        }
        return response;
    }

    private normalizeAutoplayTrack(item: any, existingQueue: any[], currentSongId: number): any | null {
        if (!this.hasPlayableAutoplaySong(item)) {
            return null;
        }

        const existingSongIds = new Set<number>(
            (existingQueue ?? [])
                .map((item: any) => Number(item?.songId ?? item?.id ?? item?.contentId ?? 0))
                .filter((id) => id > 0)
        );

        const songId = Number(item?.songId ?? item?.id ?? item?.contentId ?? 0);
        if (songId > 0 && songId === currentSongId) {
            return null;
        }

        if (songId > 0 && existingSongIds.has(songId)) {
            const existingTrack = (existingQueue ?? []).find((queueItem: any) =>
                Number(queueItem?.songId ?? queueItem?.id ?? queueItem?.contentId ?? 0) === songId
            );
            if (existingTrack?.isAutoplay) {
                return this.normalizeTrack(existingTrack);
            }
        }

        return this.normalizeTrack({
            ...item,
            type: 'SONG',
            isAutoplay: true,
            queueSection: 'AUTOPLAY'
        });
    }

    private mergeAutoplayCycleTrack(track: any, existingTracks: any[]): any[] {
        const normalizedTrack = this.normalizeTrack(track);
        const trackId = this.getTrackId(normalizedTrack);
        if (!trackId) {
            return existingTracks ?? [];
        }

        const dedupedExisting = (existingTracks ?? []).filter((item: any) => this.getTrackId(item) !== trackId);
        return [...dedupedExisting, normalizedTrack];
    }

    private restartAutoplayCycle(): void {
        if ((this.autoplayCycleTracks ?? []).length === 0) {
            this.updateState({ isLoading: false, isPlaying: false, autoplayMessage: null });
            return;
        }

        const nextIndex = this.autoplayCycleCursor >= 0
            ? (this.autoplayCycleCursor + 1) % this.autoplayCycleTracks.length
            : 0;
        const restartTrack = this.autoplayCycleTracks[nextIndex] ?? this.autoplayCycleTracks[0] ?? null;
        if (!restartTrack) {
            this.updateState({ isLoading: false, isPlaying: false, autoplayMessage: null });
            return;
        }

        this.autoplayCycleCursor = nextIndex;
        const nextQueue = [...(this.getState().queue ?? []), restartTrack];
        this.playResolvedTrack(restartTrack, nextQueue, Math.max(0, nextQueue.length - 1), false, true);
    }

    private replayCurrentTrack(state: PlayerState): void {
        const current = state.currentItem;
        if (!current) {
            this.updateState({ isLoading: false, isPlaying: false });
            return;
        }

        const queue = state.queue.length > 0 ? state.queue : [current];
        const index = state.currentIndex >= 0 ? state.currentIndex : this.resolveQueueIndex(queue, current);
        this.playResolvedTrack(current, queue, index >= 0 ? index : 0, false, false);
    }

    private tryPlayUpcomingTrackFromQueue(state: PlayerState): boolean {
        const queue = state.queue ?? [];
        if (queue.length === 0) {
            return false;
        }

        const currentIndex = state.currentIndex >= 0 ? state.currentIndex : this.resolveQueueIndex(queue, state.currentItem);
        let candidateIndex = -1;

        if (state.isShuffle) {
            const upcomingIndexes = queue
                .map((_, index) => index)
                .filter((index) => index !== currentIndex && index > currentIndex);
            if (upcomingIndexes.length > 0) {
                candidateIndex = upcomingIndexes[Math.floor(Math.random() * upcomingIndexes.length)];
            }
        } else {
            const nextSequentialIndex = currentIndex + 1;
            if (nextSequentialIndex >= 0 && nextSequentialIndex < queue.length) {
                candidateIndex = nextSequentialIndex;
            }
        }

        if (candidateIndex < 0 || !queue[candidateIndex]) {
            return false;
        }

        this.playQueueTrackAtIndex(queue, candidateIndex, true);
        return true;
    }

    private playQueueTrackAtIndex(queue: any[], index: number, trackHistory: boolean): void {
        const safeIndex = index >= 0 ? index : 0;
        const queueTrack = this.normalizeTrack(queue[safeIndex] ?? null);
        if (!queueTrack) {
            return;
        }

        const songId = Number(queueTrack?.songId ?? queueTrack?.id ?? 0);
        if (songId > 0) {
            this.apiService.get<any>(`/songs/${songId}`).pipe(
                map((song) =>
                    this.mergeTrackData(
                        {
                            ...song,
                            id: song?.songId ?? songId,
                            songId: song?.songId ?? songId,
                            queueId: queueTrack?.queueId,
                            position: queueTrack?.position,
                            type: 'SONG'
                        },
                        queueTrack
                    )
                ),
                catchError(() => of(queueTrack))
            ).subscribe((resolvedTrack) => {
                this.playResolvedTrack(resolvedTrack, queue, safeIndex, false, trackHistory);
            });
            return;
        }

        this.playResolvedTrack(queueTrack, queue, safeIndex, false, trackHistory);
    }

    private shouldInsertAdBeforeNextSong(state: PlayerState): boolean {
        if (this.isPremiumUser()) {
            return false;
        }
        if (this.lastPlaybackWasAd) {
            return false;
        }
        const playedCount = Number(state.songsPlayedCount ?? 0);
        return playedCount > 0 && playedCount >= this.nextAdSongCheckpoint;
    }

    private playAdvertisementBetweenSongs(onAdFinished: () => void): void {
        const state = this.getState();
        const userId = this.getCurrentUserId();
        const songId = Number(state.currentItem?.songId ?? state.currentItem?.id ?? 0);
        if (!userId || !songId) {
            onAdFinished();
            return;
        }

        this.resumeAfterAdAction = onAdFinished;
        this.updateState({ isLoading: true });
        this.adService.fadeOutMusic(this.audio).subscribe({
            complete: () => {
                this.adService.fetchNextAd(userId, songId).pipe(
                    catchError(() => of(null))
                ).subscribe((adResponse) => {
                    if (!adResponse || !this.isValidAd(adResponse)) {
                        this.handleAdPlaybackFailure();
                        return;
                    }

                    const adMediaUrl = this.resolveAdMediaUrl(String(adResponse?.mediaUrl ?? ''));
                    if (!adMediaUrl) {
                        this.handleAdPlaybackFailure();
                        return;
                    }

                    this.activeAdContext = adResponse;
                    this.adAnalyticsService.trackEvent('ad_impression', adResponse, this.getTrackId(this.getState().currentItem));
                    this.nextAdSongCheckpoint = this.generateNextAdSongCheckpoint(Number(this.getState().songsPlayedCount ?? 0));
                    this.playAdMedia(adMediaUrl, Number(adResponse?.durationSeconds ?? 0));
                });
            }
        });
    }

    private playAdMedia(adMediaUrl: string, adDurationSeconds: number): void {
        const requestVersion = ++this.playbackRequestVersion;
        this.stopProgressTicker();
        this.clearStartupFallbackTimer();
        const targetVolume = Math.max(0, Math.min(1, Number(this.getState().volume ?? 50) / 100));
        this.updateState({
            isAdPlaying: true,
            isLoading: true,
            isPlaying: false,
            duration: Math.max(0, Math.floor(adDurationSeconds || 0)),
            currentTime: 0,
            bufferedPercent: 0
        });

        this.resolvePlayableSource(adMediaUrl).subscribe({
            next: (playableSourceUrl) => {
                if (requestVersion !== this.playbackRequestVersion) {
                    return;
                }
                this.applyAudioSource(playableSourceUrl);
                this.audio.volume = targetVolume;
                this.updateState({ isPlaying: true });
                this.audio.play().then(() => {
                    this.lastPlaybackWasAd = true;
                    this.adAnalyticsService.trackEvent('ad_started', this.activeAdContext);
                }).catch(() => this.handleAdPlaybackFailure());
            },
            error: () => this.handleAdPlaybackFailure()
        });
    }

    private handleAdEnded(): void {
        this.updateState({
            isAdPlaying: false,
            isLoading: false,
            isPlaying: false,
            currentTime: 0,
            duration: 0,
            bufferedPercent: 0
        });

        const resumeAction = this.resumeAfterAdAction;
        this.resumeAfterAdAction = null;
        this.pendingMusicFadeIn = true;
        this.pendingSkipAfterAdTracking = true;
        this.lastCompletedAdContext = this.activeAdContext;
        this.adAnalyticsService.trackEvent('ad_completed', this.activeAdContext);
        if (resumeAction) {
            resumeAction();
            return;
        }
        this.playNextLocal();
    }

    private handleAdPlaybackFailure(): void {
        this.updateState({
            isAdPlaying: false,
            isLoading: false,
            isPlaying: false
        });

        const resumeAction = this.resumeAfterAdAction;
        this.resumeAfterAdAction = null;
        this.pendingMusicFadeIn = true;
        this.pendingSkipAfterAdTracking = false;
        this.activeAdContext = null;
        this.lastCompletedAdContext = null;
        this.lastPlaybackWasAd = false;
        if (resumeAction) {
            resumeAction();
            return;
        }
        this.playAutoplayRecommendation();
    }

    private playPreviousLocal(): void {
        const state = this.getState();
        if (state.queue.length === 0) {
            return;
        }

        let prevIndex = state.currentIndex - 1;
        if (prevIndex < 0) {
            prevIndex = state.repeatMode === 'ALL' ? state.queue.length - 1 : 0;
        }

        this.playQueueTrackAtIndex(state.queue, prevIndex, true);
    }

    private resolveQueueTracks(queueItems: any[]): Observable<any[]> {
        if (!queueItems || queueItems.length === 0) {
            return of([]);
        }

        const requests = queueItems.map((item) => this.resolveTrackFromQueueItem(item));
        return forkJoin(requests).pipe(
            map((tracks) => this.filterInactiveTracks(tracks.filter((track) => !!track)))
        );
    }

    private resolveTrackFromQueueItem(queueItem: any): Observable<any> {
        const songId = Number(queueItem?.songId ?? 0);
        if (songId > 0) {
            return this.apiService.get<any>(`/songs/${songId}`).pipe(
                map((song) =>
                    this.normalizeTrack({
                        ...song,
                        id: song?.songId ?? songId,
                        songId: song?.songId ?? songId,
                        title: song?.title ?? `Song #${songId}`,
                        artistName: song?.artistName ?? '',
                        fileUrl: song?.fileUrl ?? '',
                        queueId: Number(queueItem?.queueId ?? 0),
                        position: Number(queueItem?.position ?? 0),
                        type: 'SONG'
                    })
                ),
                catchError(() =>
                    of(
                        this.normalizeTrack({
                            id: songId,
                            songId,
                            title: `Song #${songId}`,
                            artistName: '',
                            queueId: Number(queueItem?.queueId ?? 0),
                            position: Number(queueItem?.position ?? 0),
                            type: 'SONG'
                        })
                    )
                )
            );
        }

        const episodeId = Number(queueItem?.episodeId ?? 0);
        return of(
            this.normalizeTrack({
                id: episodeId,
                episodeId,
                title: `Episode #${episodeId}`,
                artistName: 'Podcast',
                queueId: Number(queueItem?.queueId ?? 0),
                position: Number(queueItem?.position ?? 0),
                type: 'PODCAST'
            })
        );
    }

    private resolveAudioUrl(track: any): string | null {
        const apiOrigin = environment.apiUrl.replace(/\/api\/v1$/, '');
        const apiBase = environment.apiUrl;
        const normalizedType = this.resolveTrackType(track);
        const isPodcast = normalizedType === 'PODCAST';
        const episodeId = Number(track?.episodeId ?? track?.podcastEpisodeId ?? (isPodcast ? track?.id : 0) ?? 0);
        const podcastId = Number(track?.podcastId ?? track?.podcast?.podcastId ?? track?.podcast?.id ?? 0);
        const extractedFileName = this.extractFileName(String(track?.fileName ?? track?.audioFileName ?? track?.fileUrl ?? track?.audioUrl ?? ''));
        const fileName = this.isLikelyAudioFile(extractedFileName) ? extractedFileName : '';

        const rawCandidates = [
            track?.fileUrl,
            track?.audioUrl,
            fileName ? this.getStreamUrlByFileName(fileName, normalizedType) : '',
            track?.streamUrl,
            episodeId > 0 && podcastId > 0 ? `${environment.apiUrl}/podcasts/${podcastId}/episodes/${episodeId}/stream` : ''
        ];

        for (const candidate of rawCandidates) {
            const rawUrl = String(candidate ?? '').trim();
            if (!rawUrl) {
                continue;
            }

            if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
                return rawUrl;
            }

            if (rawUrl.startsWith('/api/v1/')) {
                return `${apiOrigin}${rawUrl}`;
            }
            if (rawUrl.startsWith('api/v1/')) {
                return `${apiOrigin}/${rawUrl}`;
            }
            if (rawUrl.startsWith('/files/')) {
                return `${apiBase}${rawUrl}`;
            }
            if (rawUrl.startsWith('files/')) {
                return `${apiBase}/${rawUrl}`;
            }

            const fileNameFromUrl = this.extractFileName(rawUrl);
            if (fileNameFromUrl && !rawUrl.includes('/') && this.isLikelyAudioFile(fileNameFromUrl)) {
                return this.getStreamUrlByFileName(fileNameFromUrl, normalizedType);
            }

            if (fileNameFromUrl && this.isLikelyAudioFile(fileNameFromUrl)) {
                return this.getStreamUrlByFileName(fileNameFromUrl, normalizedType);
            }

            if (rawUrl.startsWith('/')) {
                return `${apiOrigin}${rawUrl}`;
            }

            return `${apiOrigin}/${rawUrl}`;
        }

        if (fileName && this.isLikelyAudioFile(fileName)) {
            return this.getStreamUrlByFileName(fileName, normalizedType);
        }

        return null;
    }

    private resolveQueueIndex(queue: any[], track: any): number {
        const trackId = this.getTrackId(track);
        const queueId = Number(track?.queueId ?? 0);

        if (queueId > 0) {
            const queueIndex = queue.findIndex((item) => Number(item?.queueId ?? 0) === queueId);
            if (queueIndex >= 0) {
                return queueIndex;
            }
        }

        const itemIndex = queue.findIndex((item) => this.getTrackId(item) === trackId);
        return itemIndex >= 0 ? itemIndex : 0;
    }

    private buildQueueAddBody(track: any, userId: number): any | null {
        const songId = Number(track?.songId ?? track?.id ?? track?.contentId ?? 0);
        const episodeId = Number(track?.episodeId ?? 0);
        if (!songId && !episodeId) {
            return null;
        }

        const body: any = { userId };
        if (episodeId > 0) {
            body.episodeId = episodeId;
        } else {
            body.songId = songId;
        }
        return body;
    }

    private normalizeTrack(track: any): any {
        const fileUrl = String(track?.fileUrl ?? track?.audioUrl ?? track?.streamUrl ?? '').trim();
        const fileName = this.extractFileName(String(track?.fileName ?? fileUrl));
        const resolvedImageUrl = this.resolveTrackImageUrl(track);
        const resolvedArtistName = this.resolveTrackArtistName(track);
        const normalizedType = this.resolveTrackType(track);
        const isPodcast = normalizedType === 'PODCAST';
        const songId = isPodcast ? 0 : Number(track?.songId ?? track?.id ?? track?.contentId ?? 0);
        const episodeId = Number(track?.episodeId ?? track?.podcastEpisodeId ?? (isPodcast ? track?.id ?? track?.contentId : 0) ?? 0);
        const podcastId = Number(track?.podcastId ?? track?.podcast?.podcastId ?? track?.podcast?.id ?? 0);
        const normalizedId = isPodcast
            ? (episodeId || Number(track?.id ?? track?.contentId ?? 0))
            : (songId || Number(track?.id ?? track?.contentId ?? 0));

        return {
            ...track,
            id: normalizedId,
            songId: songId || undefined,
            episodeId: episodeId || undefined,
            podcastId: podcastId || undefined,
            queueId: Number(track?.queueId ?? 0) || undefined,
            fileUrl: fileUrl || undefined,
            fileName: fileName || undefined,
            title: track?.title ?? 'Untitled',
            artistName: resolvedArtistName,
            imageUrl: resolvedImageUrl,
            type: normalizedType
        };
    }

    private resolveTrackArtistName(track: any): string {
        const candidates = [
            track?.artistName,
            track?.artistDisplayName,
            track?.artist,
            track?.artistTitle,
            track?.artist?.displayName,
            track?.artist?.name,
            track?.artistDetails?.displayName,
            track?.artistDetails?.name,
            track?.uploaderName,
            track?.createdByName,
            track?.createdBy?.fullName,
            track?.createdBy?.name,
            track?.createdBy?.username,
            track?.ownerName,
            track?.username,
            track?.podcastName
        ];

        for (const candidate of candidates) {
            const value = String(candidate ?? '').trim();
            if (value) {
                return value;
            }
        }

        return 'Artist';
    }

    private hasPlayableAutoplaySong(track: any): boolean {
        if (!track || typeof track !== 'object') {
            return false;
        }

        const songId = Number(track?.songId ?? track?.id ?? 0);
        const hasAudioReference = !!String(track?.fileUrl ?? track?.audioUrl ?? track?.streamUrl ?? track?.fileName ?? '').trim();
        return songId > 0 || hasAudioReference;
    }

    private isValidAd(adResponse: any): boolean {
        if (!adResponse || typeof adResponse !== 'object') {
            return false;
        }
        const mediaUrl = String(adResponse?.mediaUrl ?? adResponse?.audioUrl ?? '').trim();
        return mediaUrl.length > 0;
    }

    private resolveAdMediaUrl(rawMediaUrl: string): string | null {
        const raw = String(rawMediaUrl ?? '').trim();
        if (!raw) {
            return null;
        }

        const apiOrigin = environment.apiUrl.replace(/\/api\/v1$/, '');
        if (raw.startsWith('http://') || raw.startsWith('https://')) {
            return raw;
        }
        if (raw.startsWith('/api/v1/')) {
            return `${apiOrigin}${raw}`;
        }
        if (raw.startsWith('api/v1/')) {
            return `${apiOrigin}/${raw}`;
        }
        if (raw.startsWith('/')) {
            return `${apiOrigin}${raw}`;
        }
        return `${apiOrigin}/${raw}`;
    }

    private shouldIncreaseSongsPlayedCount(track: any): boolean {
        const normalizedType = String(track?.type ?? '').trim().toUpperCase();
        if (normalizedType === 'PODCAST' || normalizedType === 'AD') {
            return false;
        }

        const songId = Number(track?.songId ?? track?.id ?? 0);
        return songId > 0;
    }

    private isPremiumUser(): boolean {
        return this.premiumService.isPremiumUser;
    }

    private resolveTrackImageUrl(track: any): string | undefined {
        const apiOrigin = environment.apiUrl.replace(/\/api\/v1$/, '');
        const songId = Number(track?.songId ?? track?.id ?? track?.contentId ?? 0);
        const albumId = Number(track?.albumId ?? track?.album?.albumId ?? track?.album?.id ?? 0);
        const candidates = [
            track?.imageUrl,
            track?.coverUrl,
            track?.coverArtUrl,
            track?.coverImageUrl,
            track?.image,
            track?.thumbnailUrl,
            track?.album?.coverArtUrl,
            track?.album?.coverImageUrl,
            track?.podcast?.coverImageUrl
        ];

        for (const candidate of candidates) {
            const raw = String(candidate ?? '').trim();
            if (!raw) {
                continue;
            }

            const normalized = raw.toLowerCase();
            if (
                normalized.includes('/files/songs/') ||
                normalized.endsWith('.mp3') ||
                normalized.endsWith('.wav') ||
                normalized.endsWith('.m4a') ||
                normalized.endsWith('.aac') ||
                normalized.endsWith('.flac') ||
                normalized.endsWith('.ogg')
            ) {
                continue;
            }

            if (raw.startsWith('http://') || raw.startsWith('https://')) {
                return raw;
            }

            if (raw.startsWith('/api/v1/')) {
                return `${apiOrigin}${raw}`;
            }
            if (raw.startsWith('api/v1/')) {
                return `${apiOrigin}/${raw}`;
            }
            if (raw.startsWith('/files/images/')) {
                return `${environment.apiUrl}${raw}`;
            }
            if (raw.startsWith('files/images/')) {
                return `${environment.apiUrl}/${raw}`;
            }

            const fileName = this.extractFileName(raw);
            if (fileName && !raw.includes('/') && this.isLikelyImageFile(fileName)) {
                return `${environment.apiUrl}/files/images/${encodeURIComponent(fileName)}`;
            }

            if (raw.startsWith('/')) {
                return `${apiOrigin}${raw}`;
            }
            return `${apiOrigin}/${raw}`;
        }

        if (songId > 0) {
            const cachedSong = this.artistService.getCachedSongImage(songId);
            if (cachedSong) {
                return cachedSong;
            }
        }

        if (albumId > 0) {
            const cachedAlbum = this.artistService.getCachedAlbumImage(albumId);
            if (cachedAlbum) {
                return cachedAlbum;
            }
        }

        return undefined;
    }

    private resolvePlayableSource(sourceUrl: string, track?: any): Observable<string> {
        if (!this.requiresAuthenticatedFetch(sourceUrl)) {
            return of(sourceUrl);
        }

        return this.http.get(sourceUrl, { responseType: 'blob' }).pipe(
            map((blob) => {
                this.clearObjectUrl();
                this.activeObjectUrl = URL.createObjectURL(blob);
                return this.activeObjectUrl;
            }),
            catchError(() =>
                this.resolveTrackAudioFallback(track, sourceUrl).pipe(
                    switchMap((fallbackUrl) => fallbackUrl
                        ? of(fallbackUrl)
                        : throwError(() => new Error('No playable media source found'))
                    )
                )
            )
        );
    }

    private resolveTrackAudioFallback(track: any, failedUrl: string): Observable<string | null> {
        const normalizedType = this.resolveTrackType(track);
        const isPodcast = normalizedType === 'PODCAST';
        const episodeId = Number(track?.episodeId ?? track?.podcastEpisodeId ?? (isPodcast ? track?.id : 0) ?? 0);
        const podcastId = Number(track?.podcastId ?? track?.podcast?.podcastId ?? track?.podcast?.id ?? 0);
        const extractedFileName = this.extractFileName(String(track?.fileName ?? track?.audioFileName ?? track?.fileUrl ?? track?.audioUrl ?? ''));
        const fileName = this.isLikelyAudioFile(extractedFileName) ? extractedFileName : '';
        const candidates = [
            fileName ? this.getStreamUrlByFileName(fileName, normalizedType) : '',
            episodeId > 0 && podcastId > 0 ? `${environment.apiUrl}/podcasts/${podcastId}/episodes/${episodeId}/stream` : '',
            episodeId > 0 && podcastId > 0 ? `${environment.apiUrl}/podcasts/${podcastId}/episodes/${episodeId}/audio` : ''
        ]
            .map((value) => String(value ?? '').trim())
            .filter((value) => !!value && value !== String(failedUrl ?? '').trim());

        if (candidates.length === 0) {
            return of(null);
        }

        return from(candidates).pipe(
            concatMap((candidateUrl) =>
                this.http.get(candidateUrl, { responseType: 'blob' }).pipe(
                    map((blob) => ({ candidateUrl, blob })),
                    catchError(() => of(null))
                )
            ),
            toArray(),
            map((results) => {
                const firstValid = (results ?? []).find((item: any) => !!item?.blob);
                if (!firstValid) {
                    return null;
                }
                this.clearObjectUrl();
                this.activeObjectUrl = URL.createObjectURL(firstValid.blob);
                return this.activeObjectUrl;
            })
        );
    }

    private hasDirectPlayableReference(track: any): boolean {
        return !!String(
            track?.fileUrl ??
            track?.audioUrl ??
            track?.streamUrl ??
            track?.fileName ??
            track?.audioFileName ??
            ''
        ).trim();
    }

    private requiresAuthenticatedFetch(sourceUrl: string): boolean {
        const value = String(sourceUrl ?? '').trim();
        if (!value) {
            return false;
        }
        const normalized = value.toLowerCase().split('?')[0];
        const isProtectedFile = normalized.includes('/api/v1/files/') || normalized.includes('/files/');
        const isProtectedSongStream = normalized.includes('/api/v1/songs/') && (
            normalized.includes('/stream') ||
            normalized.endsWith('/audio') ||
            normalized.endsWith('/file')
        );
        const isProtectedPodcastStream = normalized.includes('/api/v1/podcasts/') && (
            normalized.includes('/stream') ||
            normalized.endsWith('/audio')
        );

        return isProtectedFile || isProtectedSongStream || isProtectedPodcastStream;
    }

    private generateNextAdSongCheckpoint(currentSongsPlayed: number): number {
        const interval = Math.random() < 0.5 ? 2 : 3;
        return Math.max(2, currentSongsPlayed + interval);
    }

    private trackSkipAfterAd(): void {
        if (!this.pendingSkipAfterAdTracking) {
            return;
        }
        this.pendingSkipAfterAdTracking = false;
        this.adAnalyticsService.trackEvent('user_skipped_song_after_ad', this.lastCompletedAdContext, this.getTrackId(this.getState().currentItem));
        this.lastCompletedAdContext = null;
    }

    private applyAudioSource(sourceUrl: string): void {
        this.stopProgressTicker();
        this.audio.src = sourceUrl;
        this.audio.load();
    }

    private scheduleStartupFallback(requestVersion: number, sourceUrl: string): void {
        if (!this.requiresAuthenticatedFetch(sourceUrl)) {
            return;
        }

        this.clearStartupFallbackTimer();
        this.startupFallbackTimer = setTimeout(() => {
            if (requestVersion !== this.playbackRequestVersion) {
                return;
            }
            if (this.audio.currentTime > 0 || this.audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
                return;
            }

            this.http.get(sourceUrl, { responseType: 'blob' }).pipe(
                map((blob) => {
                    this.clearObjectUrl();
                    this.activeObjectUrl = URL.createObjectURL(blob);
                    return this.activeObjectUrl;
                }),
                catchError(() => of(null))
            ).subscribe((blobSourceUrl) => {
                if (!blobSourceUrl || requestVersion !== this.playbackRequestVersion) {
                    this.updateState({ isLoading: false });
                    return;
                }

                this.applyAudioSource(blobSourceUrl);
                this.updateState({ isPlaying: true });
                this.audio.play().catch(() => {
                    if (requestVersion === this.playbackRequestVersion) {
                        this.updateState({ isLoading: false, isPlaying: false });
                    }
                });
            });
        }, 3500);
    }

    private updatePlaybackProgress(markReady = false): void {
        const mediaDuration = Number(this.audio.duration ?? 0);
        const currentState = this.getState();
        const fallbackDuration = currentState.duration > 0
            ? currentState.duration
            : this.resolveKnownDuration(currentState.currentItem);
        const safeDuration = Number.isFinite(mediaDuration) && mediaDuration > 0
            ? mediaDuration
            : fallbackDuration;
        const mediaCurrentTime = Number(this.audio.currentTime ?? 0);
        const safeCurrentTime = Number.isFinite(mediaCurrentTime) && mediaCurrentTime >= 0 ? mediaCurrentTime : 0;

        this.updateState({
            duration: safeDuration > 0 ? safeDuration : 0,
            currentTime: safeCurrentTime,
            bufferedPercent: this.getBufferedPercent(),
            isLoading: markReady || safeCurrentTime > 0 ? false : currentState.isLoading
        });

        this.persistPlaybackState(false);
    }

    private resolveKnownDuration(track: any): number {
        const rawDuration = Number(
            track?.durationSeconds ??
            track?.duration ??
            track?.length ??
            0
        );

        if (!Number.isFinite(rawDuration) || rawDuration <= 0) {
            return 0;
        }
        if (rawDuration > 10000) {
            return Math.floor(rawDuration / 1000);
        }
        return Math.floor(rawDuration);
    }

    private startProgressTicker(): void {
        if (this.progressTicker) {
            return;
        }
        this.progressTicker = setInterval(() => {
            if (this.audio.paused || this.audio.ended) {
                return;
            }
            this.updatePlaybackProgress();
        }, 80);
    }

    private stopProgressTicker(): void {
        if (!this.progressTicker) {
            return;
        }
        clearInterval(this.progressTicker);
        this.progressTicker = null;
    }

    private clearStartupFallbackTimer(): void {
        if (!this.startupFallbackTimer) {
            return;
        }
        clearTimeout(this.startupFallbackTimer);
        this.startupFallbackTimer = null;
    }

    private getBufferedPercent(): number {
        const duration = Number(this.audio.duration ?? 0);
        if (!Number.isFinite(duration) || duration <= 0) {
            return 0;
        }

        const buffered = this.audio.buffered;
        if (!buffered || buffered.length === 0) {
            return 0;
        }

        try {
            const end = buffered.end(buffered.length - 1);
            const percent = (end / duration) * 100;
            if (!Number.isFinite(percent)) {
                return 0;
            }
            return Math.max(0, Math.min(100, percent));
        } catch {
            return 0;
        }
    }

    private clearObjectUrl(): void {
        if (!this.activeObjectUrl) {
            return;
        }
        URL.revokeObjectURL(this.activeObjectUrl);
        this.activeObjectUrl = null;
    }

    restoreLastPlayback(): void {
        this.restoreLastPlaybackState();
    }

    private restoreLastPlaybackState(): void {
        const userId = this.getCurrentUserId() ?? 0;
        if (userId <= 0) {
            return;
        }
        const raw = localStorage.getItem(this.resolvePlaybackStorageKey(userId));
        if (!raw) {
            return;
        }

        try {
            const parsed = JSON.parse(raw);
            const songId = Number(parsed?.songId ?? parsed?.id ?? 0);
            const title = String(parsed?.title ?? '').trim();
            const audioUrl = String(parsed?.audioUrl ?? parsed?.fileUrl ?? '').trim();
            const storedFileName = String(parsed?.fileName ?? '').trim();
            const currentTime = Number(parsed?.currentTime ?? 0);
            const artistName = String(parsed?.artistName ?? '').trim();
            const validStoredFileName = this.isLikelyAudioFile(storedFileName) ? storedFileName : '';
            const validAudioUrl = audioUrl && (
                audioUrl.includes('/files/') ||
                this.isLikelyAudioFile(this.extractFileName(audioUrl))
            );
            if (!songId || (!validStoredFileName && !validAudioUrl)) {
                localStorage.removeItem(this.resolvePlaybackStorageKey(userId));
                return;
            }

            const restoredTrack = this.normalizeTrack({
                id: songId,
                songId,
                title: title || 'Last Played Song',
                artistName: artistName || 'Unknown Artist',
                audioUrl: validAudioUrl ? audioUrl : '',
                fileUrl: validAudioUrl ? audioUrl : '',
                fileName: validStoredFileName || (validAudioUrl ? this.extractFileName(audioUrl) : ''),
                type: 'SONG'
            });

            this.pendingResumeTime = Number.isFinite(currentTime) && currentTime > 0 ? currentTime : 0;
            this.updateState({
                currentItem: restoredTrack,
                queue: [restoredTrack],
                currentIndex: 0,
                isPlaying: false,
                isLoading: true,
                currentTime: this.pendingResumeTime,
                bufferedPercent: 0
            });

            const sourceUrl = this.resolveAudioUrl(restoredTrack);
            if (!sourceUrl) {
                localStorage.removeItem(this.resolvePlaybackStorageKey(userId));
                this.updateState({ isLoading: false, currentItem: null, queue: [], currentIndex: -1, currentTime: 0 });
                return;
            }

            this.resolvePlayableSource(sourceUrl, restoredTrack).subscribe({
                next: (sourceUrl) => {
                    this.applyAudioSource(sourceUrl);
                    this.updateState({ isLoading: false });
                },
                error: () => {
                    localStorage.removeItem(this.resolvePlaybackStorageKey(userId));
                    this.updateState({ isLoading: false });
                }
            });
        } catch {
            localStorage.removeItem(this.resolvePlaybackStorageKey(userId));
        }
    }

    private persistPlaybackState(force: boolean): void {
        const state = this.getState();
        if (state.isAdPlaying) {
            return;
        }

        const current = state.currentItem;
        const songId = Number(current?.songId ?? current?.id ?? 0);
        if (!songId) {
            return;
        }

        const now = Date.now();
        if (!force && now - this.lastPlaybackPersistedAt < this.playbackSaveIntervalMs) {
            return;
        }

        const audioUrl = this.resolveAudioUrl(current);
        if (!audioUrl) {
            return;
        }

        const payload = {
            songId,
            title: String(current?.title ?? 'Last Played Song'),
            artistName: String(current?.artistName ?? ''),
            audioUrl,
            fileName: this.isLikelyAudioFile(String(current?.fileName ?? '')) ? String(current?.fileName ?? '').trim() : '',
            currentTime: Number(this.audio.currentTime ?? state.currentTime ?? 0)
        };

        const userId = this.getCurrentUserId() ?? 0;
        if (userId <= 0) {
            return;
        }
        localStorage.setItem(this.resolvePlaybackStorageKey(userId), JSON.stringify(payload));
        this.lastPlaybackPersistedAt = now;
    }

    private mergeTrackData(track: any, fallbackTrack: any): any {
        if (!fallbackTrack) {
            return this.normalizeTrack(track);
        }
        return this.normalizeTrack({
            ...fallbackTrack,
            ...track,
            fileUrl: track?.fileUrl ?? track?.audioUrl ?? track?.streamUrl ?? fallbackTrack?.fileUrl ?? fallbackTrack?.audioUrl ?? fallbackTrack?.streamUrl,
            fileName: track?.fileName ?? fallbackTrack?.fileName,
            imageUrl: track?.imageUrl ?? fallbackTrack?.imageUrl
        });
    }

    private getStreamUrlByFileName(fileName: string, type: string): string {
        const mediaType = String(type ?? '').toUpperCase() === 'PODCAST' ? 'podcasts' : 'songs';
        return `${environment.apiUrl}/files/${mediaType}/${encodeURIComponent(fileName)}`;
    }

    private resolveTrackType(track: any): string {
        const explicitType = String(track?.type ?? '').trim().toUpperCase();
        if (explicitType) {
            return explicitType;
        }
        if (Number(track?.episodeId ?? track?.podcastEpisodeId ?? 0) > 0) {
            return 'PODCAST';
        }
        return 'SONG';
    }

    private isLikelyAudioFile(fileName: string): boolean {
        return /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(String(fileName ?? '').trim());
    }

    private isLikelyImageFile(fileName: string): boolean {
        return /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(String(fileName ?? '').trim());
    }

    private extractFileName(value: string): string {
        const cleaned = String(value ?? '').trim();
        if (!cleaned) {
            return '';
        }

        const withoutQuery = cleaned.split('?')[0].split('#')[0];
        const normalized = withoutQuery.replace(/\\/g, '/');
        const segments = normalized.split('/').filter(Boolean);
        const lastSegment = segments[segments.length - 1] ?? normalized;
        return lastSegment.trim();
    }

    private getTrackId(track: any): number | null {
        const id = Number(track?.id ?? track?.songId ?? track?.episodeId ?? track?.contentId ?? 0);
        return id > 0 ? id : null;
    }

    private isInactiveTrack(track: any): boolean {
        if (!track || this.resolveTrackType(track) !== 'SONG') {
            return false;
        }
        return track?.isActive === false;
    }

    private filterInactiveTracks(tracks: any[]): any[] {
        return (tracks ?? []).filter((track) => !this.isInactiveTrack(track));
    }

    private getCurrentUserId(): number | null {
        const rawUser = localStorage.getItem('revplay_user');
        if (!rawUser) {
            return null;
        }

        try {
            const user = JSON.parse(rawUser);
            const userId = Number(user?.userId ?? user?.id ?? 0);
            return userId > 0 ? userId : null;
        } catch {
            return null;
        }
    }

    private getCurrentQueueUserId(): number | null {
        if (!this.isQueueEnabledForCurrentRole() || this.queueApiBlocked) {
            return null;
        }
        return this.getCurrentUserId();
    }

    private appendToLocalQueue(track: any, queueId?: number): void {
        const normalizedTrack = this.normalizeTrack({
            ...track,
            queueId: queueId && queueId > 0 ? queueId : this.generateLocalQueueId()
        });
        const state = this.getState();
        const nextQueue = [...state.queue, normalizedTrack];
        this.updateState({ queue: nextQueue });
    }

    private applyQueueRemoval(queueId: number): void {
        const state = this.getState();
        const filteredQueue = state.queue.filter((item) => Number(item?.queueId ?? 0) !== queueId);
        if (filteredQueue.length === 0) {
            this.audio.pause();
            this.audio.currentTime = 0;
            this.updateState({
                queue: [],
                currentItem: null,
                currentIndex: -1,
                isPlaying: false,
                currentTime: 0,
                duration: 0,
                bufferedPercent: 0
            });
            return;
        }

        const currentQueueId = Number(state.currentItem?.queueId ?? 0);
        if (currentQueueId === queueId) {
            const nextTrack = filteredQueue[Math.min(state.currentIndex, filteredQueue.length - 1)];
            this.playQueueItem(nextTrack);
            this.updateState({ queue: filteredQueue });
            return;
        }

        const currentTrackId = this.getTrackId(state.currentItem);
        const nextIndex = filteredQueue.findIndex((item) => this.getTrackId(item) === currentTrackId);
        this.updateState({
            queue: filteredQueue,
            currentIndex: nextIndex >= 0 ? nextIndex : Math.min(state.currentIndex, filteredQueue.length - 1)
        });
    }

    private isQueueApiForbidden(err: any): boolean {
        const status = Number(err?.status ?? 0);
        return status === 401 || status === 403;
    }

    private generateLocalQueueId(): number {
        const next = this.localQueueIdSeed;
        this.localQueueIdSeed -= 1;
        return next;
    }

    private isQueueEnabledForCurrentRole(): boolean {
        const rawUser = localStorage.getItem('revplay_user');
        if (!rawUser) {
            return false;
        }

        try {
            const user = JSON.parse(rawUser);
            return hasAnyRole(user, ['LISTENER', 'ARTIST', 'ADMIN']);
        } catch {
            return false;
        }
    }

    private resolvePlaybackStorageKey(userId?: number | null): string {
        const normalized = Number(userId ?? 0);
        if (normalized > 0) {
            return `${this.LAST_PLAYBACK_KEY}:${normalized}`;
        }
        return this.LAST_PLAYBACK_KEY;
    }

    private isAutoplayEnabledForCurrentRole(): boolean {
        const rawUser = localStorage.getItem('revplay_user');
        if (!rawUser) {
            return false;
        }

        try {
            const user = JSON.parse(rawUser);
            return hasAnyRole(user, ['LISTENER', 'ARTIST', 'ADMIN']);
        } catch {
            return false;
        }
    }

    private trackPlayHistory(track: any): void {
        const userId = this.getCurrentUserId();
        if (!userId) {
            return;
        }

        const body: any = {
            userId,
            completed: false,
            playDurationSeconds: Math.floor(this.audio.currentTime || 0),
            playedAt: new Date().toISOString()
        };

        if (track?.type === 'PODCAST' || track?.episodeId) {
            body.episodeId = Number(track?.episodeId ?? track?.id ?? 0);
        } else {
            body.songId = Number(track?.songId ?? track?.id ?? track?.contentId ?? 0);
        }

        this.apiService.post('/play-history/track', body).subscribe({
            error: () => { }
        });
    }

    private requestNowPlayingOpen(): void {
        if (NgZone.isInAngularZone()) {
            this.nowPlayingOpenRequestSubject.next();
            return;
        }

        this.ngZone.run(() => this.nowPlayingOpenRequestSubject.next());
    }
}
