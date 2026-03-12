import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { BrowseService } from '../services/browse.service';
import { PlayerService } from '../../core/services/player.service';
import { AuthService } from '../../core/services/auth';
import { ArtistService } from '../../core/services/artist.service';
import { StateService } from '../../core/services/state.service';
import { FollowingService } from '../../core/services/following.service';
import { PlaylistService } from '../../core/services/playlist.service';
import { LikesService } from '../../core/services/likes.service';
import { PremiumService } from '../../core/services/premium.service';
import { ApiService } from '../../core/services/api';
import { forkJoin, Observable, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { hasAnyRole, hasRole } from '../../core/utils/role.util';
import { shareSongWithFallback } from '../../core/utils/song-share.util';
import { environment } from '../../../environments/environment';
import { ProtectedMediaPipe } from '../../core/pipes/protected-media.pipe';
import { RecentlyPlayedComponent } from '../../components/recently-played/recently-played.component';

@Component({
    selector: 'app-browse',
    templateUrl: './browse.component.html',
    styleUrls: ['./browse.component.scss'],
    standalone: true,
    imports: [CommonModule, RouterModule, FormsModule, ProtectedMediaPipe, RecentlyPlayedComponent],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class BrowseComponent implements OnInit {
    private readonly recentUploadsCacheKey = 'revplay_artist_recent_uploads_cache';
    private readonly dashboardCacheKey = 'revplay_artist_dashboard_cache';
    private readonly artistProfileImageCacheKey = 'revplay_artist_profile_image_cache_v1';
    private readonly podcastPlayCountStorageKey = 'revplay_podcast_play_count_cache_v1';
    trendingNow: any[] = [];
    recommendedForYou: any[] = [];
    madeForYou: any[] = [];
    discoveryFeed: any[] = [];
    mixPlaylists: Array<{ id: number; name: string; slug: string }> = [];

    topArtists: any[] = [];
    newReleases: any[] = [];
    browseSongs: any[] = [];
    popularPodcasts: any[] = [];
    recommendedPodcasts: any[] = [];

    isLoading = true;
    error: string | null = null;
    notice: string | null = null;
    actionMessage: string | null = null;
    isDownloadingSongId: number | null = null;
    showAddToPlaylistPicker = false;
    songForPlaylistAdd: any | null = null;
    targetPlaylistIdForSongAdd = '';
    playlistTargets: any[] = [];
    isActionSaving = false;
    private userId: number | null = null;
    private currentArtistId: number | null = null;
    private hasListenerBackendAccess = false;
    private readonly apiOrigin = environment.apiUrl.replace(/\/api\/v1$/, '');
    private likedSongIds = new Set<number>();
    private likeIdBySongId = new Map<number, number>();
    private playlistIdsBySongId = new Map<number, Set<number>>();
    private lastPlaylistIdBySongId = new Map<number, number>();
    constructor(
        private browseService: BrowseService,
        private playerService: PlayerService,
        private authService: AuthService,
        private artistService: ArtistService,
        private stateService: StateService,
        private followingService: FollowingService,
        private playlistService: PlaylistService,
        private likesService: LikesService,
        private premiumService: PremiumService,
        private http: HttpClient,
        private apiService: ApiService,
        private router: Router,
        private cdr: ChangeDetectorRef
    ) { }

    ngOnInit(): void {
        this.userId = this.resolveUserId();
        this.currentArtistId = this.resolveCurrentArtistId();
        this.loadLikedSongs();
        this.loadData();
    }

    loadData(): void {
        this.isLoading = true;
        this.error = null;
        this.notice = null;
        this.actionMessage = null;
        const currentUser = this.authService.getCurrentUserSnapshot();
        const canUseListenerFeatures = this.canUseListenerBackend(currentUser);
        this.hasListenerBackendAccess = canUseListenerFeatures;

        const personalized$ = this.userId && canUseListenerFeatures
            ? forkJoin({
                recommendations: this.browseService.getRecommendationsForYou(this.userId).pipe(
                    catchError((err) => {
                        this.noteAccessIssue(err, 'recommendations');
                        return of({ youMightLike: [], popularWithSimilarUsers: [] });
                    })
                ),
                weekly: this.browseService.getDiscoverWeekly(this.userId).pipe(
                    catchError((err) => {
                        this.noteAccessIssue(err, 'weekly picks');
                        return of({ items: [] });
                    })
                ),
                feed: this.browseService.getDiscoveryFeed(this.userId).pipe(
                    catchError((err) => {
                        this.noteAccessIssue(err, 'discovery feed');
                        return of({ discoverWeekly: [] });
                    })
                )
            })
            : of({
                recommendations: { youMightLike: [], popularWithSimilarUsers: [] },
                weekly: { items: [] },
                feed: { discoverWeekly: [] }
            });

        forkJoin({
            trending: canUseListenerFeatures
                ? this.browseService.getTrending('SONG', 'WEEKLY', 12).pipe(catchError((err) => {
                this.noteAccessIssue(err, 'trending');
                return of([]);
            }))
                : of([]),
            releases: canUseListenerFeatures
                ? this.browseService.getNewReleases().pipe(catchError((err) => {
                this.noteAccessIssue(err, 'new releases');
                return of({ content: [] });
            }))
                : of({ content: [] }),
            artists: canUseListenerFeatures
                ? this.browseService.getTopArtists().pipe(catchError((err) => {
                this.noteAccessIssue(err, 'top artists');
                return of({ content: [] });
            }))
                : of({ content: [] }),
            songs: canUseListenerFeatures
                ? this.browseService.getBrowseSongs().pipe(catchError((err) => {
                this.noteAccessIssue(err, 'browse songs');
                return of({ content: [] });
            }))
                : of({ content: [] }),
            popularPodcasts: canUseListenerFeatures
                ? this.browseService.getPopularPodcasts().pipe(catchError((err) => {
                this.noteAccessIssue(err, 'popular podcasts');
                return of({ content: [] });
            }))
                : of({ content: [] }),
            recommendedPodcasts: canUseListenerFeatures
                ? this.browseService.getRecommendedPodcasts(0, 10).pipe(catchError((err) => {
                this.noteAccessIssue(err, 'recommended podcasts');
                return of({ content: [] });
            }))
                : of({ content: [] }),
            seededSongs: canUseListenerFeatures
                ? this.apiService.get<any>('/search?q=a&type=SONG&page=0&size=80').pipe(catchError(() => of({ content: [] })))
                : of({ content: [] }),
            seededArtists: canUseListenerFeatures
                ? this.apiService.get<any>('/search?q=a&type=ARTIST&page=0&size=80').pipe(catchError(() => of({ content: [] })))
                : of({ content: [] }),
            seededPodcasts: canUseListenerFeatures
                ? this.apiService.get<any>('/search?q=a&type=PODCAST&page=0&size=80').pipe(catchError(() => of({ content: [] })))
                : of({ content: [] }),
            systemPlaylists: canUseListenerFeatures
                ? this.browseService.getSystemPlaylists().pipe(catchError(() => of([])))
                : of([]),
            personalized: personalized$,
            creatorCatalog: this.loadCreatorFallbackCatalog()
        }).subscribe({
            next: ({ trending, releases, artists, songs, popularPodcasts, recommendedPodcasts, seededSongs, seededArtists, seededPodcasts, systemPlaylists, personalized, creatorCatalog }) => {
                const creator = this.toCreatorCatalog(creatorCatalog);
                const creatorSongs = this.mapSongCards(creator.songs);
                const creatorPodcasts = this.mapPodcastCards(creator.podcasts);
                const creatorArtists = this.mapArtistCards(creator.artists);

                const mappedTrending = this.mapSongCards(this.extractContentArray(trending));
                const mappedNewReleases = this.mapSongCards(this.extractContentArray(releases));
                const mappedBrowseSongs = this.mapSongCards(this.extractContentArray(songs));
                const mappedTopArtists = this.mapArtistCards(this.extractContentArray(artists));
                const mappedPopularPodcasts = this.mapPodcastCards(this.extractContentArray(popularPodcasts));
                const mappedRecommendedPodcasts = this.mapPodcastCards(this.extractContentArray(recommendedPodcasts));
                const mappedSeededSongs = this.mapSongCards(this.extractContentArray(seededSongs));
                const mappedSeededArtists = this.mapArtistCards(this.extractContentArray(seededArtists));
                const mappedSeededPodcasts = this.mapPodcastCards(this.extractContentArray(seededPodcasts));

                const baseTrending = this.mergeSongCards(mappedTrending, creatorSongs);
                const baseBrowseSongs = this.mergeSongCards(mappedBrowseSongs, mappedSeededSongs, creatorSongs);
                const baseNewReleases = this.mergeSongCards(mappedNewReleases, baseBrowseSongs, creatorSongs).slice(0, 12);
                this.refreshTopArtists(
                    mappedTopArtists,
                    mappedSeededArtists,
                    creatorArtists,
                    this.deriveArtistsFromSongs(baseBrowseSongs),
                    this.deriveArtistsFromSongs(baseTrending)
                );
                this.popularPodcasts = this.mergePodcastCards(mappedPopularPodcasts, mappedSeededPodcasts, creatorPodcasts);
                this.recommendedPodcasts = this.mergePodcastCards(mappedRecommendedPodcasts, creatorPodcasts);
                this.mixPlaylists = this.normalizeSystemPlaylists(systemPlaylists);

                const personalizedRecommended = this.mapSongCards(this.buildForYouList(personalized.recommendations));
                const personalizedWeekly = this.mapSongCards(personalized?.weekly?.items ?? []);
                const baseRecommendedForYou = personalizedRecommended.length > 0
                    ? personalizedRecommended
                    : this.buildHomeSongFallback(baseTrending, baseBrowseSongs, baseNewReleases);
                const baseMadeForYou = personalizedWeekly.length > 0
                    ? personalizedWeekly
                    : this.buildHomeSongFallback(baseNewReleases, baseBrowseSongs, baseTrending, baseRecommendedForYou);
                const baseDiscoveryFeed = this.mapSongCards(
                    this.buildDiscoveryFeedList(
                        personalized.feed,
                        baseBrowseSongs,
                        baseNewReleases,
                        baseTrending,
                        baseRecommendedForYou
                    )
                );

                this.trendingNow = baseTrending;
                this.newReleases = baseNewReleases;
                this.browseSongs = baseBrowseSongs;
                this.recommendedForYou = baseRecommendedForYou;
                this.madeForYou = baseMadeForYou;
                this.discoveryFeed = baseDiscoveryFeed;

                this.enrichSongCardsWithSongDetails(baseTrending).subscribe((enrichedTrending) => {
                    this.trendingNow = enrichedTrending;
                    this.refreshTopArtists(
                        mappedTopArtists,
                        mappedSeededArtists,
                        creatorArtists,
                        this.deriveArtistsFromSongs(baseBrowseSongs),
                        this.deriveArtistsFromSongs(this.trendingNow)
                    );
                    this.cdr.markForCheck();
                });
                this.enrichSongCardsWithSongDetails(baseNewReleases).subscribe((enrichedNewReleases) => {
                    this.newReleases = enrichedNewReleases;
                    this.cdr.markForCheck();
                });
                this.enrichSongCardsWithSongDetails(baseBrowseSongs).subscribe((enrichedBrowseSongs) => {
                    this.browseSongs = enrichedBrowseSongs;
                    this.cdr.markForCheck();
                });
                this.enrichSongCardsWithSongDetails(baseRecommendedForYou).subscribe((enrichedRecommendedForYou) => {
                    this.recommendedForYou = enrichedRecommendedForYou;
                    this.cdr.markForCheck();
                });
                this.enrichSongCardsWithSongDetails(baseMadeForYou).subscribe((enrichedMadeForYou) => {
                    this.madeForYou = enrichedMadeForYou;
                    this.cdr.markForCheck();
                });
                this.enrichSongCardsWithSongDetails(baseDiscoveryFeed).subscribe((enrichedDiscoveryFeed) => {
                    this.discoveryFeed = enrichedDiscoveryFeed;
                    this.cdr.markForCheck();
                });

                if (!canUseListenerFeatures && this.trendingNow.length === 0 && this.browseSongs.length === 0) {
                    this.notice = 'Showing creator catalog because listener endpoints are restricted for this account.';
                }

                this.isLoading = false;
                this.cdr.markForCheck();
                this.enrichPodcastCardsWithDetails(this.popularPodcasts).subscribe((enrichedPodcasts) => {
                    this.popularPodcasts = enrichedPodcasts;
                    this.cdr.markForCheck();
                });
                this.enrichPodcastCardsWithDetails(this.recommendedPodcasts).subscribe((enrichedPodcasts) => {
                    this.recommendedPodcasts = enrichedPodcasts;
                    this.cdr.markForCheck();
                });
            },
            error: () => {
                this.error = 'Failed to load discovery content. Please check backend connection.';
                this.isLoading = false;
                this.cdr.markForCheck();
            }
        });
    }

    private clearBrowseData(): void {
        this.trendingNow = [];
        this.recommendedForYou = [];
        this.madeForYou = [];
        this.discoveryFeed = [];
        this.mixPlaylists = [];
        this.topArtists = [];
        this.newReleases = [];
        this.browseSongs = [];
        this.popularPodcasts = [];
        this.recommendedPodcasts = [];
    }

    private canUseListenerBackend(user: any): boolean {
        return hasAnyRole(user, ['LISTENER', 'ARTIST', 'ADMIN']);
    }

    playTrack(track: any): void {
        const songId = Number(track.songId ?? track.contentId ?? track.id);
        if (!songId && !this.hasPlayableSongReference(track)) {
            return;
        }

        this.resolveSongDetailsWithFallback(track).subscribe({
            next: (resolvedTrack) => {
                if (!resolvedTrack) {
                    this.error = 'Unable to play this track right now.';
                    this.cdr.markForCheck();
                    return;
                }
                const playbackTrack = this.buildSongPlayerTrack(resolvedTrack, track);
                const queue = this.buildPlaybackQueueForTrack(track, playbackTrack);
                this.playerService.playTrack(playbackTrack, queue.length > 0 ? queue : [playbackTrack]);
            },
            error: () => {
                this.error = 'Unable to play this track right now.';
                this.cdr.markForCheck();
            }
        });
    }

    playPodcast(podcast: any): void {
        const podcastId = Number(podcast?.id ?? podcast?.podcastId ?? 0);
        if (podcastId <= 0) {
            return;
        }

        this.error = null;
        this.actionMessage = null;
        this.artistService.getPodcastEpisodes(podcastId, 0, 100).pipe(
            map((response) => Array.isArray(response?.content) ? response.content : []),
            catchError(() => of([]))
        ).subscribe((episodes) => {
            const queue = (episodes ?? [])
                .map((episode: any) => this.buildPodcastPlayerTrack(episode, podcast))
                .filter((item: any) => this.hasPlayablePodcastReference(item));

            if (queue.length === 0) {
                this.error = 'No playable episodes found for this podcast.';
                this.cdr.markForCheck();
                return;
            }

            this.playerService.playTrack(queue[0], queue);
            this.incrementPodcastPlayCount(podcastId);
        });
    }

    openAddToPlaylistPicker(song: any): void {
        const songId = Number(song?.songId ?? song?.contentId ?? song?.id ?? 0);
        if (!songId) {
            return;
        }

        this.songForPlaylistAdd = song;
        this.targetPlaylistIdForSongAdd = '';
        this.showAddToPlaylistPicker = true;
        this.error = null;
        this.actionMessage = null;

        if (this.playlistTargets.length > 0) {
            this.cdr.markForCheck();
            return;
        }

        this.playlistService.getUserPlaylists(0, 100).subscribe({
            next: (response) => {
                this.playlistTargets = (response?.content ?? [])
                    .map((playlist: any) => ({
                        ...playlist,
                        id: Number(playlist?.id ?? playlist?.playlistId ?? 0)
                    }))
                    .filter((playlist: any) => Number(playlist?.id ?? 0) > 0);
                this.cdr.markForCheck();
            },
            error: () => {
                this.error = 'Unable to load your playlists right now.';
                this.playlistTargets = [];
                this.cdr.markForCheck();
            }
        });
    }

    closeAddToPlaylistPicker(): void {
        this.showAddToPlaylistPicker = false;
        this.songForPlaylistAdd = null;
        this.targetPlaylistIdForSongAdd = '';
        this.cdr.markForCheck();
    }

    addCurrentSongToSelectedPlaylist(): void {
        const songId = Number(this.songForPlaylistAdd?.songId ?? this.songForPlaylistAdd?.contentId ?? this.songForPlaylistAdd?.id ?? 0);
        const playlistId = Number(this.targetPlaylistIdForSongAdd ?? 0);
        if (!songId || !playlistId) {
            this.error = 'Please select a playlist.';
            this.cdr.markForCheck();
            return;
        }

        this.isActionSaving = true;
        this.error = null;
        this.actionMessage = null;
        this.playlistService.addSongToPlaylist(playlistId, songId).subscribe({
            next: () => {
                this.isActionSaving = false;
                this.actionMessage = 'Song added to playlist.';
                this.markSongInPlaylist(songId, playlistId);
                this.closeAddToPlaylistPicker();
                this.cdr.markForCheck();
            },
            error: () => {
                this.isActionSaving = false;
                this.error = 'Failed to add song to selected playlist.';
                this.cdr.markForCheck();
            }
        });
    }

    addSongToLikedSongs(song: any): void {
        this.toggleSongLike(song);
    }


    addSongToQueue(song: any): void {
        this.playerService.addToQueue(song);
        this.actionMessage = 'Added to queue.';
        this.cdr.markForCheck();
    }

    downloadSong(song: any): void {
        const songId = Number(song?.songId ?? song?.contentId ?? song?.id ?? 0);
        if (!songId || !this.userId) {
            this.error = 'Unable to download this song right now.';
            this.actionMessage = null;
            this.cdr.markForCheck();
            return;
        }

        if (!this.premiumService.isPremiumUser) {
            this.error = 'Song downloads are available for Premium users.';
            this.actionMessage = null;
            this.cdr.markForCheck();
            return;
        }

        this.isDownloadingSongId = songId;
        this.error = null;
        this.actionMessage = null;

        const endpoint = `${environment.apiUrl}/download/song/${songId}?userId=${this.userId}`;
        this.http.get(endpoint, { responseType: 'blob' }).subscribe({
            next: (blob) => {
                this.isDownloadingSongId = null;
                this.triggerSongDownload(blob, song);
                this.actionMessage = 'Download started.';
                this.cdr.markForCheck();
            },
            error: () => {
                this.isDownloadingSongId = null;
                this.error = 'Unable to download this song right now.';
                this.cdr.markForCheck();
            }
        });
    }

    onCoverLoadError(event: Event): void {
        const image = event.target as HTMLImageElement | null;
        if (!image) {
            return;
        }
        image.src = 'assets/images/placeholder-album.png';
    }

    onArtistImageLoadError(event: Event): void {
        const image = event.target as HTMLImageElement | null;
        if (!image) {
            return;
        }
        image.src = 'assets/images/placeholder-artist.png';
    }

    async shareSong(song: any): Promise<void> {
        const result = await shareSongWithFallback({
            songId: Number(song?.songId ?? song?.contentId ?? song?.id ?? 0),
            title: String(song?.title ?? 'Song'),
            artistName: String(song?.artistName ?? '')
        });

        this.error = null;
        this.actionMessage = null;

        if (result.status === 'shared') {
            this.actionMessage = 'Song share dialog opened.';
            this.cdr.markForCheck();
            return;
        }

        if (result.status === 'copied') {
            this.actionMessage = 'Song link copied.';
            this.cdr.markForCheck();
            return;
        }

        if (result.status === 'cancelled') {
            this.cdr.markForCheck();
            return;
        }

        this.error = result.status === 'unsupported'
            ? 'Sharing is not supported in this browser.'
            : 'Failed to share this song.';
        this.cdr.markForCheck();
    }


    isSongLiked(song: any): boolean {
        const songId = this.getSongId(song);
        return songId > 0 && this.likedSongIds.has(songId);
    }

    toggleSongLike(song: any): void {
        const songId = this.getSongId(song);
        if (!songId || !this.userId) {
            this.error = 'User session not found.';
            this.cdr.markForCheck();
            return;
        }

        this.error = null;
        this.actionMessage = null;

        if (this.isSongLiked(song)) {
            const cachedLikeId = this.likeIdBySongId.get(songId);
            if (cachedLikeId) {
                this.unlikeSong(songId, cachedLikeId);
                return;
            }

            this.likesService.getSongLikeId(this.userId, songId).subscribe({
                next: (resolvedLikeId) => {
                    if (!resolvedLikeId) {
                        this.likedSongIds.delete(songId);
                        this.likeIdBySongId.delete(songId);
                        this.actionMessage = 'Removed from liked songs.';
                        this.cdr.markForCheck();
                        return;
                    }
                    this.unlikeSong(songId, resolvedLikeId);
                },
                error: () => {
                    this.error = 'Failed to verify liked songs state.';
                    this.cdr.markForCheck();
                }
            });
            return;
        }

        this.likesService.likeSong(songId).subscribe({
            next: (response) => {
                const likeId = Number(response?.id ?? response?.likeId ?? 0);
                this.likedSongIds.add(songId);
                if (likeId > 0) {
                    this.likeIdBySongId.set(songId, likeId);
                }
                this.actionMessage = 'Added to liked songs.';
                this.cdr.markForCheck();
            },
            error: () => {
                this.error = 'Failed to add this song to liked songs.';
                this.cdr.markForCheck();
            }
        });
    }

    removeFromPlaylistForSong(song: any): void {
        const songId = Number(song?.songId ?? song?.contentId ?? song?.id ?? 0);
        if (!songId) {
            return;
        }
        const playlistId = this.lastPlaylistIdBySongId.get(songId);
        if (!playlistId) {
            this.error = 'No playlist selected for removal.';
            this.cdr.markForCheck();
            return;
        }

        this.playlistService.removeSongFromPlaylist(playlistId, songId).subscribe({
            next: () => {
                this.actionMessage = 'Song removed from playlist.';
                this.unmarkSongInPlaylist(songId, playlistId);
                this.cdr.markForCheck();
            },
            error: () => {
                this.error = 'Failed to remove song from playlist.';
                this.cdr.markForCheck();
            }
        });
    }

    isSongInPlaylist(song: any): boolean {
        const songId = Number(song?.songId ?? song?.contentId ?? song?.id ?? 0);
        if (!songId) {
            return false;
        }
        const set = this.playlistIdsBySongId.get(songId);
        return !!set && set.size > 0;
    }

    private markSongInPlaylist(songId: number, playlistId: number): void {
        if (!songId || !playlistId) {
            return;
        }
        const existing = this.playlistIdsBySongId.get(songId) ?? new Set<number>();
        existing.add(playlistId);
        this.playlistIdsBySongId.set(songId, existing);
        this.lastPlaylistIdBySongId.set(songId, playlistId);
    }

    private unmarkSongInPlaylist(songId: number, playlistId: number): void {
        if (!songId || !playlistId) {
            return;
        }
        const existing = this.playlistIdsBySongId.get(songId);
        if (!existing) {
            return;
        }
        existing.delete(playlistId);
        if (existing.size === 0) {
            this.playlistIdsBySongId.delete(songId);
            this.lastPlaylistIdBySongId.delete(songId);
            return;
        }
        this.playlistIdsBySongId.set(songId, existing);
        if (this.lastPlaylistIdBySongId.get(songId) === playlistId) {
            this.lastPlaylistIdBySongId.set(songId, Array.from(existing.values())[0]);
        }
    }

    goToAlbum(song: any): void {
        const openByAlbumId = (albumId: number) => {
            if (albumId <= 0) {
                this.error = 'Album details are not available for this song.';
                this.cdr.markForCheck();
                return;
            }
            this.router.navigate(['/search'], {
                queryParams: { type: 'ALBUM', albumId }
            });
        };

        const albumId = Number(song?.albumId ?? 0);
        if (albumId > 0) {
            openByAlbumId(albumId);
            return;
        }

        const fallbackSongId = Number(song?.songId ?? song?.id ?? 0);
        if (!fallbackSongId) {
            this.error = 'Album details are not available for this song.';
            this.cdr.markForCheck();
            return;
        }

        this.browseService.getSongById(fallbackSongId).pipe(
            catchError(() => of(null))
        ).subscribe((resolved) => openByAlbumId(Number(resolved?.albumId ?? 0)));
    }

    goToArtist(song: any): void {
        const openByArtistName = (artistName: string) => {
            const value = String(artistName ?? '').trim();
            if (!value) {
                this.error = 'Artist details are not available for this song.';
                this.cdr.markForCheck();
                return;
            }
            this.router.navigate(['/search'], {
                queryParams: { q: value, type: 'ARTIST' }
            });
        };

        const artistName = this.resolveSongArtistName(song, '');
        if (artistName) {
            openByArtistName(artistName);
            return;
        }

        const fallbackSongId = Number(song?.songId ?? song?.id ?? 0);
        if (!fallbackSongId) {
            this.error = 'Artist details are not available for this song.';
            this.cdr.markForCheck();
            return;
        }

        this.browseService.getSongById(fallbackSongId).pipe(
            catchError(() => of(null))
        ).subscribe((resolved) => openByArtistName(this.resolveSongArtistName(resolved, '')));
    }

    toggleArtistFollow(artist: any): void {
        const artistId = Number(artist?.id ?? 0);
        if (!artistId) {
            return;
        }

        const nextState = this.followingService.toggleArtist({
            id: artistId,
            name: artist?.name ?? `Artist #${artistId}`,
            subtitle: artist?.playCount ? `${artist.playCount} plays` : ''
        });
        artist.isFollowed = nextState;
        this.actionMessage = nextState
            ? `Now following ${artist?.name ?? 'artist'}.`
            : `Unfollowed ${artist?.name ?? 'artist'}.`;
        this.cdr.markForCheck();
    }

    togglePodcastFollow(podcast: any): void {
        const podcastId = Number(podcast?.id ?? 0);
        if (!podcastId) {
            return;
        }

        const nextState = this.followingService.togglePodcast({
            id: podcastId,
            name: podcast?.title ?? `Podcast #${podcastId}`,
            subtitle: podcast?.description ?? ''
        });
        podcast.isFollowed = nextState;
        this.actionMessage = nextState
            ? `Now following ${podcast?.title ?? 'podcast'}.`
            : `Unfollowed ${podcast?.title ?? 'podcast'}.`;
        this.cdr.markForCheck();
    }

    openMixPlaylist(playlist: any): void {
        const slug = String(playlist?.slug ?? '').trim();
        if (!slug) {
            return;
        }
        this.router.navigate(['/mix', slug]);
    }

    getMixGradient(playlist: any, index: number): string {
        const gradients = [
            'linear-gradient(135deg, #2756f0 0%, #6f8cff 100%)',
            'linear-gradient(135deg, #0d7f66 0%, #34c759 100%)',
            'linear-gradient(135deg, #8b3f0e 0%, #f5b54d 100%)',
            'linear-gradient(135deg, #6a1fa3 0%, #a855f7 100%)',
            'linear-gradient(135deg, #2f2f2f 0%, #737373 100%)'
        ];
        const name = String(playlist?.name ?? '').toLowerCase();
        if (name.includes('telugu')) return gradients[0];
        if (name.includes('tamil')) return gradients[1];
        if (name.includes('hindi')) return gradients[2];
        if (name.includes('english')) return gradients[3];
        if (name.includes('dj')) return gradients[4];
        return gradients[index % gradients.length];
    }

    private resolveUserId(): number | null {
        const snapshotUser = this.authService.getCurrentUserSnapshot();
        const snapshotUserId = Number(snapshotUser?.userId ?? snapshotUser?.id ?? 0);
        if (snapshotUserId) {
            return snapshotUserId;
        }

        const rawUser = localStorage.getItem('revplay_user');
        if (!rawUser) {
            return null;
        }

        try {
            const user = JSON.parse(rawUser);
            const userId = Number(user?.userId ?? user?.id ?? 0);
            return userId || null;
        } catch {
            return null;
        }
    }

    private resolveCurrentArtistId(): number | null {
        const snapshot = this.authService.getCurrentUserSnapshot();
        const userId = Number(snapshot?.userId ?? snapshot?.id ?? this.userId ?? 0);
        const directArtistId = Number(
            snapshot?.artistId ??
            snapshot?.artist?.artistId ??
            snapshot?.artist?.id ??
            snapshot?.artistProfileId ??
            0
        );
        if (directArtistId > 0) {
            return directArtistId;
        }

        const mapped = this.stateService.getArtistIdForUser(userId);
        if (mapped) {
            return mapped;
        }

        return this.stateService.artistId;
    }

    private loadCreatorFallbackCatalog(): any {
        const currentUser = this.authService.getCurrentUserSnapshot() ?? this.getStoredUser();
        if (!hasRole(currentUser, 'ARTIST')) {
            return of({ songs: [], albums: [], podcasts: [], artists: [] });
        }

        const artistId = Number(this.currentArtistId ?? 0);
        const cachedUploads = this.getCachedRecentUploadsForCurrentUser();
        const cachedArtists = this.deriveArtistsFromRecentUploads(cachedUploads);
        if (artistId <= 0 || !this.hasListenerBackendAccess) {
            return of({ songs: cachedUploads, albums: [], podcasts: [], artists: cachedArtists });
        }

        return forkJoin({
            songs: this.artistService.getArtistSongs(artistId, 0, 200).pipe(
                map((response: any) => this.extractContentArray(response)),
                catchError(() => of([]))
            ),
            albums: this.artistService.getArtistAlbums(artistId, 0, 200).pipe(
                map((response: any) => this.extractContentArray(response)),
                catchError(() => of([]))
            ),
            podcasts: this.artistService.getArtistPodcasts(artistId, 0, 120).pipe(
                map((response: any) => this.extractContentArray(response)),
                catchError(() => of([]))
            ),
            artists: this.browseService.getArtistById(artistId).pipe(
                map((artist: any) => artist ? [artist] : []),
                catchError(() => of([]))
            )
        }).pipe(
            map((catalog) => ({
                songs: [...cachedUploads, ...(Array.isArray(catalog?.songs) ? catalog.songs : [])],
                albums: Array.isArray(catalog?.albums) ? catalog.albums : [],
                podcasts: Array.isArray(catalog?.podcasts) ? catalog.podcasts : [],
                artists: [...cachedArtists, ...(Array.isArray(catalog?.artists) ? catalog.artists : [])]
            })),
            catchError(() => of({ songs: cachedUploads, albums: [], podcasts: [], artists: cachedArtists }))
        );
    }

    private toCreatorCatalog(value: any): { songs: any[]; albums: any[]; podcasts: any[]; artists: any[] } {
        return {
            songs: Array.isArray(value?.songs) ? value.songs : [],
            albums: Array.isArray(value?.albums) ? value.albums : [],
            podcasts: Array.isArray(value?.podcasts) ? value.podcasts : [],
            artists: Array.isArray(value?.artists) ? value.artists : []
        };
    }

    private getStoredUser(): any | null {
        const rawUser = localStorage.getItem('revplay_user');
        if (!rawUser) {
            return null;
        }

        try {
            return JSON.parse(rawUser);
        } catch {
            return null;
        }
    }

    private getCachedRecentUploadsForCurrentUser(): any[] {
        const userId = Number(this.userId ?? 0);
        if (userId <= 0) {
            return [];
        }

        try {
            const raw = localStorage.getItem(this.recentUploadsCacheKey);
            if (!raw) {
                return [];
            }

            const parsed = JSON.parse(raw);
            const scoped = Array.isArray(parsed?.[String(userId)]) ? parsed[String(userId)] : [];
            return scoped
                .map((item: any, index: number) => {
                    const songId = Number(item?.songId ?? item?.id ?? 0);
                    const trustedFileUrl = this.resolveTrustedCachedAudioUrl(item?.fileUrl ?? item?.audioUrl);
                    const trustedStreamUrl = this.resolveTrustedCachedAudioUrl(item?.streamUrl);
                    const fileName = trustedFileUrl || trustedStreamUrl ? this.extractAudioFileName(item) : '';
                    const coverUrl = this.resolveMediaImage(item) || String(item?.imageUrl ?? '').trim();
                    return {
                        ...item,
                        songId,
                        id: songId,
                        title: String(item?.title ?? '').trim() || `Track #${index + 1}`,
                        artistName: String(item?.artistName ?? '').trim() || 'Artist',
                        fileName,
                        audioFileName: fileName,
                        fileUrl: trustedFileUrl,
                        audioUrl: trustedFileUrl,
                        streamUrl: trustedStreamUrl,
                        coverUrl,
                        imageUrl: coverUrl,
                        playCount: this.resolvePlayCount(item)
                    };
                })
                .filter((song: any) => Number(song?.songId ?? 0) > 0);
        } catch {
            return [];
        }
    }

    private resolveTrustedCachedAudioUrl(value: any): string {
        const raw = String(value ?? '').trim();
        if (!raw) {
            return '';
        }
        if (
            raw.startsWith('http://') ||
            raw.startsWith('https://') ||
            raw.startsWith('/api/v1/') ||
            raw.startsWith('api/v1/') ||
            raw.startsWith('/files/') ||
            raw.startsWith('files/')
        ) {
            return raw;
        }
        return '';
    }

    private deriveArtistsFromRecentUploads(items: any[]): any[] {
        const artists = new Map<string, any>();
        const currentUser = this.authService.getCurrentUserSnapshot() ?? {};
        const currentUserId = Number(currentUser?.userId ?? currentUser?.id ?? this.userId ?? 0);
        const currentUserImage = this.resolveArtistImage(currentUser) || this.getCachedProfileImage(currentUserId);
        const uniqueArtistCount = new Set(
            (items ?? [])
                .map((item: any) => String(item?.artistName ?? '').trim().toLowerCase())
                .filter((value: string) => !!value)
        ).size;
        const currentUserNames = [
            currentUser?.displayName,
            currentUser?.artistName,
            currentUser?.username,
            currentUser?.name,
            currentUser?.fullName,
            currentUser?.user?.fullName,
            currentUser?.user?.displayName,
            currentUser?.artist?.displayName,
            currentUser?.artist?.name
        ]
            .map((value: any) => String(value ?? '').trim().toLowerCase())
            .filter((value: string) => !!value);
        for (const item of items ?? []) {
            const artistName = String(item?.artistName ?? '').trim();
            if (!artistName) {
                continue;
            }
            const key = artistName.toLowerCase();
            const existing = artists.get(key);
            const cachedDashboardPlays = (currentUserNames.includes(key) || uniqueArtistCount === 1)
                ? this.getCachedCurrentUserArtistPlayCount()
                : 0;
            const itemPlayCount = this.resolvePlayCount(item);

            if (!existing) {
                artists.set(key, {
                    id: this.syntheticArtistId(artistName),
                    name: artistName,
                    imageUrl: (currentUserNames.includes(key) || uniqueArtistCount === 1) ? currentUserImage : '',
                    playCount: Math.max(itemPlayCount, cachedDashboardPlays)
                });
                continue;
            }

            artists.set(key, {
                ...existing,
                imageUrl: String(existing?.imageUrl ?? '').trim() || ((currentUserNames.includes(key) || uniqueArtistCount === 1) ? currentUserImage : ''),
                playCount: Math.max(Number(existing?.playCount ?? 0) + itemPlayCount, cachedDashboardPlays)
            });
        }
        return Array.from(artists.values());
    }

    private syntheticArtistId(name: string): number {
        let hash = 0;
        for (const char of String(name ?? '').trim().toLowerCase()) {
            hash = ((hash << 5) - hash) + char.charCodeAt(0);
            hash |= 0;
        }
        return Math.abs(hash) || 1;
    }

    private extractContentArray(response: any): any[] {
        if (!response) {
            return [];
        }
        if (Array.isArray(response)) {
            return response;
        }
        if (Array.isArray(response.data)) {
            return response.data;
        }
        if (Array.isArray(response.content)) {
            return response.content;
        }
        if (Array.isArray(response.data?.content)) {
            return response.data.content;
        }
        if (Array.isArray(response.items)) {
            return response.items;
        }
        if (Array.isArray(response.data?.items)) {
            return response.data.items;
        }
        if (Array.isArray(response.results)) {
            return response.results;
        }
        if (Array.isArray(response.data?.results)) {
            return response.data.results;
        }
        if (Array.isArray(response.artists)) {
            return response.artists;
        }
        if (Array.isArray(response.data?.artists)) {
            return response.data.artists;
        }
        if (Array.isArray(response.songs)) {
            return response.songs;
        }
        if (Array.isArray(response.data?.songs)) {
            return response.data.songs;
        }
        if (Array.isArray(response.podcasts)) {
            return response.podcasts;
        }
        if (Array.isArray(response.data?.podcasts)) {
            return response.data.podcasts;
        }
        const nestedDataArrays = Object.values(response?.data ?? {}).filter((value: any) => Array.isArray(value));
        if (nestedDataArrays.length > 0) {
            return nestedDataArrays[0] as any[];
        }
        const directArrays = Object.values(response).filter((value: any) => Array.isArray(value));
        if (directArrays.length > 0) {
            return directArrays[0] as any[];
        }
        return [];
    }

    private buildForYouList(response: any): any[] {
        const first = response?.youMightLike ?? [];
        const second = response?.popularWithSimilarUsers ?? [];
        const dedupe = new Map<number, any>();

        [...first, ...second].forEach((item) => {
            const id = Number(item?.songId ?? item?.contentId ?? item?.id ?? 0);
            if (id && !dedupe.has(id)) {
                dedupe.set(id, item);
            }
        });

        return Array.from(dedupe.values());
    }

    private normalizeSystemPlaylists(items: any[]): Array<{ id: number; name: string; slug: string }> {
        return (Array.isArray(items) ? items : [])
            .map((item: any) => ({
                id: Number(item?.id ?? 0),
                name: String(item?.name ?? '').trim(),
                slug: String(item?.slug ?? '').trim()
            }))
            .filter((item) => item.id > 0 && !!item.name && !!item.slug);
    }

    private buildDiscoveryFeedList(response: any, ...fallbackGroups: any[][]): any[] {
        const weekly = response?.discoverWeekly ?? [];
        const releases = response?.newReleases ?? [];
        const combined = [...weekly, ...releases];
        if (combined.length > 0) {
            return combined;
        }

        const fallback = this.mergeSongCards(...fallbackGroups);
        return fallback.slice(0, 12);
    }

    private buildHomeSongFallback(...groups: any[][]): any[] {
        return this.mergeSongCards(...groups).slice(0, 12);
    }

    private mapSongCards(items: any[]): any[] {
        return (items ?? [])
            .map((item: any) => {
                const songId = Number(item?.songId ?? item?.trackId ?? item?.contentId ?? item?.id ?? 0);
                const albumId = Number(item.albumId ?? item.album?.albumId ?? item.album?.id ?? 0);
                const fileName = this.extractAudioFileName(item);
                const fallbackFileUrl = this.buildSongFileUrl(fileName);
                const playCount = this.resolvePlayCount(item);
                return {
                    id: songId,
                    songId,
                    albumId,
                    contentId: songId,
                    artistId: Number(item?.artistId ?? item?.artist?.artistId ?? item?.artist?.id ?? item?.creatorId ?? 0),
                    title: item?.title ?? item?.name ?? item?.contentName ?? 'Untitled',
                    artistName: this.resolveSongArtistName(item),
                    fileUrl: String(item?.fileUrl || item?.audioUrl || item?.streamUrl || fallbackFileUrl).trim(),
                    audioUrl: String(item?.audioUrl || item?.fileUrl || item?.streamUrl || fallbackFileUrl).trim(),
                    streamUrl: String(item?.streamUrl || this.buildSongStreamUrl(songId) || fallbackFileUrl).trim(),
                    fileName,
                    isActive: item?.isActive,
                    coverUrl: this.resolveMediaImage(item) ||
                        this.artistService.getCachedSongImage(songId) ||
                        this.artistService.getCachedAlbumImage(albumId),
                    playCount,
                    subtitle: playCount > 0 ? `${playCount} plays` : item.releaseDate ?? ''
                };
            })
            .filter((item: any) => item.songId > 0 && item?.isActive !== false && !this.isSmokeTestName(item?.title));
    }

    private filterOutSongById(items: any[], songId: number): any[] {
        return (items ?? []).filter((item) => Number(item?.songId ?? item?.id ?? 0) !== songId);
    }

    private mapArtistCards(items: any[]): any[] {
        return (items ?? []).map((item: any) => ({
            id: Number(item?.artistId ?? item?.id ?? item?.contentId ?? item?.artist?.artistId ?? item?.artist?.id ?? 0),
            artistId: Number(item?.artistId ?? item?.id ?? item?.contentId ?? item?.artist?.artistId ?? item?.artist?.id ?? 0),
            displayName: item?.displayName ?? item?.artistName ?? item?.name ?? item?.title ?? item?.artist?.displayName ?? item?.artist?.name ?? 'Artist',
            name: item?.displayName ?? item?.artistName ?? item?.name ?? item?.title ?? item?.artist?.displayName ?? item?.artist?.name ?? 'Artist',
            image: this.resolveArtistImage(item),
            imageUrl: this.resolveArtistImage(item),
            playCount: this.resolvePlayCount(item),
            isFollowed: this.followingService.isArtistFollowed(Number(item?.artistId ?? item?.id ?? item?.contentId ?? item?.artist?.artistId ?? item?.artist?.id ?? 0))
        })).filter((item: any) => item.id > 0);
    }

    private refreshTopArtists(...sources: any[][]): void {
        const mergedArtists = this.mergeArtistCards(...sources);
        this.topArtists = mergedArtists;
        this.cdr.markForCheck();

        this.enrichTopArtistsWithProfileImages(mergedArtists).subscribe((enrichedArtists) => {
            this.topArtists = enrichedArtists;
            this.cdr.markForCheck();
        });
    }

    private mapPodcastCards(items: any[]): any[] {
        return (items ?? [])
            .map((item: any) => ({
                id: Number(item?.podcastId ?? item?.id ?? item?.contentId ?? 0),
                podcastId: Number(item?.podcastId ?? item?.id ?? item?.contentId ?? 0),
                title: item?.title ?? item?.name ?? 'Podcast',
                description: item?.description ?? item?.subtitle ?? '',
                coverUrl: this.resolveMediaImage(item) ||
                    this.artistService.getCachedAlbumImage(Number(item?.albumId ?? item?.id ?? 0)),
                playCount: this.resolveMergedPodcastPlayCount(item),
                isFollowed: this.followingService.isPodcastFollowed(Number(item?.podcastId ?? item?.id ?? item?.contentId ?? 0))
            }))
            .filter((item: any) => item.id > 0 && !this.isSmokeTestName(item?.title));
    }

    private resolveSongArtistName(item: any, fallback = 'Unknown Artist'): string {
        const candidates = [
            item?.artistName,
            item?.artistDisplayName,
            item?.artist,
            item?.artistTitle,
            item?.artist?.displayName,
            item?.artist?.name,
            item?.artistDetails?.displayName,
            item?.artistDetails?.name,
            item?.uploaderName,
            item?.createdByName,
            item?.createdBy?.fullName,
            item?.createdBy?.name,
            item?.createdBy?.displayName,
            item?.createdBy?.username,
            item?.createdByUserName,
            item?.creatorName,
            item?.creatorDisplayName,
            item?.uploadedByName,
            item?.uploadedBy,
            item?.uploader,
            item?.ownerName,
            item?.displayName,
            item?.user?.fullName,
            item?.user?.name,
            item?.user?.displayName,
            item?.user?.username,
            item?.username
        ];
        for (const candidate of candidates) {
            const value = String(candidate ?? '').trim();
            if (value) {
                return value;
            }
        }
        return fallback;
    }

    private enrichSongCardsWithArtistNames(songs: any[]): Observable<any[]> {
        const source = Array.isArray(songs) ? songs : [];
        const missingArtistIds = Array.from(
            new Set(
                source
                    .filter((song) => {
                        const currentName = String(song?.artistName ?? '').trim().toLowerCase();
                        return (!currentName || currentName === 'unknown artist') && Number(song?.artistId ?? 0) > 0;
                    })
                    .map((song) => Number(song?.artistId ?? 0))
                    .filter((artistId) => artistId > 0)
            )
        );

        const missingByTitle = source
            .filter((song) => {
                const currentName = String(song?.artistName ?? '').trim().toLowerCase();
                const title = String(song?.title ?? '').trim();
                return (!currentName || currentName === 'unknown artist') && !Number(song?.artistId ?? 0) && !!title;
            })
            .map((song) => String(song?.title ?? '').trim())
            .filter(Boolean);

        if (missingArtistIds.length === 0 && missingByTitle.length === 0) {
            return of(source.map((song) => ({
                ...song,
                artistName: this.normalizeArtistLabel(song?.artistName)
            })));
        }

        const requests: Array<Observable<{ key: string; artistName: string }>> = [
            ...missingArtistIds.map((artistId) =>
                this.browseService.getArtistById(artistId).pipe(
                    map((artist) => ({ key: `id:${artistId}`, artistName: this.resolveArtistDisplayName(artist) })),
                    catchError(() => of({ key: `id:${artistId}`, artistName: '' }))
                )
            ),
            ...missingByTitle.map((title) =>
                this.apiService.get<any>(`/search?q=${encodeURIComponent(title)}&type=SONG&page=0&size=5`).pipe(
                    map((response) => {
                        const items = Array.isArray(response?.content) ? response.content : [];
                        const normalizedTitle = title.toLowerCase();
                        const match = items.find((item: any) => String(item?.title ?? '').trim().toLowerCase() === normalizedTitle)
                            ?? items[0];
                        return { key: `title:${normalizedTitle}`, artistName: String(match?.artistName ?? '').trim() };
                    }),
                    catchError(() => of({ key: `title:${title.toLowerCase()}`, artistName: '' }))
                )
            )
        ];

        return forkJoin(requests).pipe(
            map((rows) => {
                const artistMap = new Map<number, string>();
                const titleMap = new Map<string, string>();

                for (const row of rows) {
                    const key = String(row?.key ?? '');
                    const name = String(row?.artistName ?? '').trim();
                    if (!name) {
                        continue;
                    }
                    if (key.startsWith('id:')) {
                        const id = Number(key.replace('id:', '')) || 0;
                        if (id > 0) {
                            artistMap.set(id, name);
                        }
                    } else if (key.startsWith('title:')) {
                        const titleKey = key.replace('title:', '');
                        if (titleKey) {
                            titleMap.set(titleKey, name);
                        }
                    }
                }

                return source.map((song) => {
                    const currentName = String(song?.artistName ?? '').trim();
                    if (currentName && currentName.toLowerCase() !== 'unknown artist') {
                        return { ...song, artistName: this.normalizeArtistLabel(currentName) };
                    }
                    const artistId = Number(song?.artistId ?? 0);
                    const resolvedById = artistId > 0 ? (artistMap.get(artistId) ?? '') : '';
                    if (resolvedById) {
                        return { ...song, artistName: resolvedById };
                    }
                    const titleKey = String(song?.title ?? '').trim().toLowerCase();
                    const resolvedByTitle = titleMap.get(titleKey) ?? '';
                    if (resolvedByTitle) {
                        return { ...song, artistName: resolvedByTitle };
                    }
                    return { ...song, artistName: this.normalizeArtistLabel(song?.artistName) };
                });
            })
        );
    }

    private enrichSongCardsWithSongDetails(songs: any[]): Observable<any[]> {
        const source = Array.isArray(songs) ? songs : [];
        const needsSongLookup = source
            .filter((song) => {
                const songId = Number(song?.songId ?? song?.id ?? 0);
                if (songId <= 0) {
                    return false;
                }
                const hasUnknownArtist = String(song?.artistName ?? '').trim().toLowerCase() === 'unknown artist';
                const hasNoArtist = !String(song?.artistName ?? '').trim();
                const hasNoCover = !String(song?.coverUrl ?? '').trim();
                return hasUnknownArtist || hasNoArtist || hasNoCover;
            })
            .map((song) => Number(song?.songId ?? song?.id ?? 0));

        if (needsSongLookup.length === 0) {
            return this.enrichSongCardsWithArtistNames(source);
        }

        const uniqueSongIds = Array.from(new Set(needsSongLookup)).filter((songId) => songId > 0);
        const requests = uniqueSongIds.map((songId) => {
            const sourceSong = source.find((song) => Number(song?.songId ?? song?.id ?? 0) === songId) ?? { songId };
            return this.resolveSongDetailsWithFallback(sourceSong).pipe(
                map((song) => ({ songId, song }))
            );
        });

        return forkJoin(requests).pipe(
            switchMap((rows) => {
                const songMap = new Map<number, any>();
                for (const row of rows) {
                    const songId = Number(row?.songId ?? 0);
                    if (songId > 0 && row?.song) {
                        songMap.set(songId, row.song);
                    }
                }

                const merged = source.map((song) => {
                    const songId = Number(song?.songId ?? song?.id ?? 0);
                    const resolved = songMap.get(songId);
                    if (!resolved) {
                        return song;
                    }

                    const fallbackArtist = String(song?.artistName ?? '').trim();
                    const resolvedArtistName = this.resolveSongArtistName(
                        resolved,
                        fallbackArtist || 'Unknown Artist'
                    );
                    const resolvedCover = this.resolveMediaImage(resolved) || String(song?.coverUrl ?? '').trim();
                    const resolvedFileUrl = String(
                        resolved?.fileUrl ??
                        resolved?.audioUrl ??
                        resolved?.streamUrl ??
                        song?.fileUrl ??
                        ''
                    ).trim();
                    const resolvedAudioUrl = String(
                        resolved?.audioUrl ??
                        resolved?.fileUrl ??
                        song?.audioUrl ??
                        ''
                    ).trim();
                    const resolvedStreamUrl = String(
                        resolved?.streamUrl ??
                        resolved?.fileUrl ??
                        song?.streamUrl ??
                        ''
                    ).trim();
                    const resolvedFileName = String(resolved?.fileName ?? song?.fileName ?? '').trim();
                    if (songId > 0 && resolvedCover) {
                        this.artistService.cacheSongImage(songId, resolvedCover);
                    }

                    return {
                        ...song,
                        artistId: Number(song?.artistId ?? resolved?.artistId ?? 0) || song?.artistId,
                        artistName: resolvedArtistName,
                        coverUrl: resolvedCover || song?.coverUrl,
                        fileUrl: resolvedFileUrl || song?.fileUrl,
                        audioUrl: resolvedAudioUrl || song?.audioUrl,
                        streamUrl: resolvedStreamUrl || song?.streamUrl,
                        fileName: resolvedFileName || song?.fileName
                    };
                });

                return this.enrichSongCardsWithArtistNames(
                    merged.filter((song) => song?.isActive !== false)
                );
            }),
            catchError(() => this.enrichSongCardsWithArtistNames(source))
        );
    }

    private normalizeArtistLabel(value: any): string {
        const text = String(value ?? '').trim();
        if (!text || text.toLowerCase() === 'unknown artist') {
            return 'Artist';
        }
        return text;
    }

    private resolveArtistDisplayName(artist: any): string {
        const candidates = [
            artist?.displayName,
            artist?.artistName,
            artist?.name,
            artist?.title,
            artist?.user?.fullName,
            artist?.user?.name,
            artist?.user?.username,
            artist?.username
        ];

        for (const candidate of candidates) {
            const value = String(candidate ?? '').trim();
            if (value) {
                return value;
            }
        }

        return '';
    }

    private mergeSongCards(...groups: any[][]): any[] {
        const merged: any[] = [];
        const byId = new Map<number, any>();
        for (const group of groups) {
            for (const song of group ?? []) {
                const songId = Number(song?.songId ?? song?.id ?? 0);
                if (songId <= 0) {
                    continue;
                }

                const existing = byId.get(songId);
                if (!existing) {
                    byId.set(songId, song);
                    merged.push(song);
                    continue;
                }

                const mergedSong = {
                    ...existing,
                    ...song,
                    coverUrl: String(existing?.coverUrl ?? '').trim() || String(song?.coverUrl ?? '').trim(),
                    imageUrl: String(existing?.imageUrl ?? '').trim() || String(song?.imageUrl ?? '').trim(),
                    artistName: this.normalizeArtistLabel(existing?.artistName) !== 'Artist'
                        ? existing?.artistName
                        : (song?.artistName ?? existing?.artistName),
                    playCount: Math.max(this.resolvePlayCount(existing), this.resolvePlayCount(song)),
                    fileUrl: String(existing?.fileUrl ?? '').trim() || String(song?.fileUrl ?? '').trim(),
                    audioUrl: String(existing?.audioUrl ?? '').trim() || String(song?.audioUrl ?? '').trim(),
                    streamUrl: String(existing?.streamUrl ?? '').trim() || String(song?.streamUrl ?? '').trim(),
                    fileName: String(existing?.fileName ?? '').trim() || String(song?.fileName ?? '').trim(),
                    subtitle: this.resolvePlayCount(song) > this.resolvePlayCount(existing)
                        ? (song?.subtitle ?? existing?.subtitle)
                        : (existing?.subtitle ?? song?.subtitle)
                };

                byId.set(songId, mergedSong);
                const index = merged.findIndex((item) => Number(item?.songId ?? item?.id ?? 0) === songId);
                if (index >= 0) {
                    merged[index] = mergedSong;
                }
            }
        }
        return merged;
    }

    private mergeArtistCards(...groups: any[][]): any[] {
        const merged: any[] = [];
        const byId = new Map<number, any>();
        for (const group of groups) {
            for (const artist of group ?? []) {
                const artistId = Number(artist?.id ?? artist?.artistId ?? 0);
                if (artistId <= 0) {
                    continue;
                }

                const normalizedArtist = {
                    ...artist,
                    id: artistId,
                    name: artist?.name ?? artist?.displayName ?? artist?.artistName ?? 'Artist',
                    imageUrl: String(artist?.imageUrl ?? '').trim() || this.resolveArtistImage(artist),
                    isFollowed: this.followingService.isArtistFollowed(artistId)
                };

                const nameKey = String(normalizedArtist?.name ?? '').trim().toLowerCase();
                const existingByNameIndex = nameKey
                    ? merged.findIndex((item) => String(item?.name ?? '').trim().toLowerCase() === nameKey)
                    : -1;
                const existingByName = existingByNameIndex >= 0 ? merged[existingByNameIndex] : null;
                const existing = byId.get(artistId);
                if (!existing && !existingByName) {
                    byId.set(artistId, normalizedArtist);
                    merged.push(normalizedArtist);
                    continue;
                }

                const baseArtist = existingByName ?? existing;
                const mergedArtist = this.combineArtistCards(baseArtist, normalizedArtist);

                byId.set(artistId, mergedArtist);
                byId.set(Number(baseArtist?.id ?? baseArtist?.artistId ?? 0), mergedArtist);
                const index = existingByNameIndex >= 0
                    ? existingByNameIndex
                    : merged.findIndex((item) => Number(item?.id ?? item?.artistId ?? 0) === artistId);
                if (index >= 0) {
                    merged[index] = mergedArtist;
                }
            }
        }
        return merged;
    }

    private deriveArtistsFromSongs(songs: any[]): any[] {
        const byArtist = new Map<number, any>();
        for (const song of songs ?? []) {
            const artistId = Number(song?.artistId ?? 0);
            const artistName = String(song?.artistName ?? '').trim();
            const songPlayCount = this.resolvePlayCount(song);
            if (artistId > 0 && artistName) {
                const existing = byArtist.get(artistId);
                byArtist.set(artistId, {
                    id: artistId,
                    name: artistName,
                    imageUrl: String(existing?.imageUrl ?? '').trim() || this.resolveArtistImage(song) || this.resolveCurrentUserArtistImage(artistName),
                    playCount: Number(existing?.playCount ?? 0) + (songPlayCount > 0 ? songPlayCount : 0)
                });
            }
        }
        return Array.from(byArtist.values());
    }

    private resolvePlayCount(item: any): number {
        return Number(
            item?.playCount ??
            item?.podcastPlayCount ??
            item?.episodePlayCount ??
            item?.totalPodcastPlays ??
            item?.totalEpisodePlays ??
            item?.totalEpisodePlayCount ??
            item?.podcastStreams ??
            item?.episodeStreams ??
            item?.totalListeners ??
            item?.totalPlays ??
            item?.artistPlayCount ??
            item?.totalStreams ??
            item?.totalStreamCount ??
            item?.streamsCount ??
            item?.plays ??
            item?.streams ??
            item?.streamCount ??
            item?.listenCount ??
            item?.listenerCount ??
            item?.play_count ??
            item?.total_plays ??
            item?.artist_play_count ??
            item?.total_streams ??
            item?.stream_count ??
            item?.listen_count ??
            item?.count ??
            item?.analytics?.playCount ??
            item?.analytics?.podcastPlayCount ??
            item?.analytics?.episodePlayCount ??
            item?.analytics?.totalPlays ??
            item?.stats?.playCount ??
            item?.stats?.podcastPlayCount ??
            item?.stats?.episodePlayCount ??
            item?.stats?.totalPlays ??
            item?.stats?.streams ??
            0
        );
    }

    private resolveArtistImage(item: any): string {
        const candidates = [
            item?.profilePictureUrl,
            item?.profileImageUrl,
            item?.profilePicture?.url,
            item?.profilePicture?.fileName,
            item?.profileImage?.url,
            item?.profileImage?.fileName,
            item?.profilePictureFileName,
            item?.profileImageFileName,
            item?.profilePicture,
            item?.profileImage,
            item?.avatarUrl,
            item?.avatarFileName,
            item?.avatar?.url,
            item?.avatar?.fileName,
            item?.avatar,
            item?.artistImageUrl,
            item?.imageUrl,
            item?.image,
            item?.imageFileName,
            item?.imageName,
            item?.user?.profilePicture?.url,
            item?.user?.profilePicture?.fileName,
            item?.user?.profileImage?.url,
            item?.user?.profileImage?.fileName,
            item?.user?.profilePictureUrl,
            item?.user?.profileImageUrl,
            item?.user?.avatarUrl,
            item?.user?.avatar?.url,
            item?.user?.avatar?.fileName,
            item?.user?.avatar,
            item?.user?.imageUrl,
            item?.user?.image,
            item?.artist?.profilePicture?.url,
            item?.artist?.profilePicture?.fileName,
            item?.artist?.profileImage?.url,
            item?.artist?.profileImage?.fileName,
            item?.artist?.profilePictureUrl,
            item?.artist?.profileImageUrl,
            item?.artist?.profilePictureFileName,
            item?.artist?.profileImageFileName,
            item?.artist?.avatarUrl,
            item?.artist?.avatarFileName,
            item?.artist?.avatar?.url,
            item?.artist?.avatar?.fileName,
            item?.artist?.avatar,
            item?.artist?.imageUrl,
            item?.artist?.image,
            item?.artist?.imageFileName,
            item?.artist?.imageName,
            item?.artist?.user?.profilePicture?.url,
            item?.artist?.user?.profilePicture?.fileName,
            item?.artist?.user?.profileImage?.url,
            item?.artist?.user?.profileImage?.fileName,
            item?.artist?.user?.profilePictureUrl,
            item?.artist?.user?.profileImageUrl,
            item?.artist?.user?.avatarUrl,
            item?.artist?.user?.avatar?.url,
            item?.artist?.user?.avatar?.fileName,
            item?.artist?.user?.avatar,
            item?.artist?.user?.imageUrl,
            item?.artist?.user?.image
        ];

        for (const candidate of candidates) {
            const resolved = this.resolveImageCandidate(candidate);
            if (resolved) {
                return resolved;
            }
        }

        return '';
    }

    private resolveImageCandidate(candidate: any): string {
        const directValue = String(candidate ?? '').trim();
        if (directValue && directValue !== '[object Object]') {
            return this.resolveImage(directValue);
        }

        if (!candidate || typeof candidate !== 'object') {
            return '';
        }

        const nestedCandidates = [
            candidate?.url,
            candidate?.fileName,
            candidate?.name,
            candidate?.path,
            candidate?.imageUrl,
            candidate?.avatarUrl,
            candidate?.profileImageUrl,
            candidate?.profilePictureUrl,
            candidate?.downloadUrl,
            candidate?.downloadURI,
            candidate?.downloadUri,
            candidate?.fileDownloadUrl,
            candidate?.fileDownloadURI,
            candidate?.fileDownloadUri
        ];

        for (const nested of nestedCandidates) {
            const resolved = this.resolveImage(String(nested ?? '').trim());
            if (resolved) {
                return resolved;
            }
        }

        return '';
    }

    private combineArtistCards(existing: any, candidate: any): any {
        const preferred = this.preferArtistCard(existing, candidate);
        const secondary = preferred === existing ? candidate : existing;
        const preferredName = String(preferred?.name ?? '').trim() || String(secondary?.name ?? '').trim() || 'Artist';
        const currentUserPlayCount = this.resolveCurrentUserArtistPlayCount(preferredName);

        return {
            ...secondary,
            ...preferred,
            id: Number(preferred?.id ?? preferred?.artistId ?? secondary?.id ?? secondary?.artistId ?? 0),
            artistId: Number(preferred?.id ?? preferred?.artistId ?? secondary?.id ?? secondary?.artistId ?? 0),
            name: preferredName,
            imageUrl: String(preferred?.imageUrl ?? '').trim() ||
                String(secondary?.imageUrl ?? '').trim() ||
                this.resolveCurrentUserArtistImage(preferredName),
            playCount: Math.max(Number(existing?.playCount ?? 0), Number(candidate?.playCount ?? 0), currentUserPlayCount),
            isFollowed: !!(existing?.isFollowed || candidate?.isFollowed)
        };
    }

    private preferArtistCard(existing: any, candidate: any): any {
        const existingId = Number(existing?.id ?? existing?.artistId ?? 0);
        const candidateId = Number(candidate?.id ?? candidate?.artistId ?? 0);
        const targetArtistId = Number(this.currentArtistId ?? 0);
        if (targetArtistId > 0) {
            if (candidateId === targetArtistId && existingId !== targetArtistId) {
                return candidate;
            }
            if (existingId === targetArtistId && candidateId !== targetArtistId) {
                return existing;
            }
        }

        const existingHasImage = !!String(existing?.imageUrl ?? '').trim();
        const candidateHasImage = !!String(candidate?.imageUrl ?? '').trim();
        if (candidateHasImage && !existingHasImage) {
            return candidate;
        }
        if (existingHasImage && !candidateHasImage) {
            return existing;
        }

        const existingSynthetic = this.isSyntheticArtistId(existingId, existing?.name);
        const candidateSynthetic = this.isSyntheticArtistId(candidateId, candidate?.name);
        if (existingSynthetic && !candidateSynthetic) {
            return candidate;
        }
        if (!existingSynthetic && candidateSynthetic) {
            return existing;
        }

        return existing;
    }

    private isSyntheticArtistId(artistId: number, name: any): boolean {
        const normalizedId = Number(artistId ?? 0);
        const normalizedName = String(name ?? '').trim();
        if (normalizedId <= 0 || !normalizedName) {
            return false;
        }
        return normalizedId === this.syntheticArtistId(normalizedName);
    }

    private resolveCurrentUserArtistImage(artistName: string): string {
        const currentUser = this.authService.getCurrentUserSnapshot() ?? {};
        const currentUserId = Number(currentUser?.userId ?? currentUser?.id ?? this.userId ?? 0);
        const currentUserImage = this.resolveArtistImage(currentUser) || this.getCachedProfileImage(currentUserId);
        if (!currentUserImage) {
            return '';
        }

        const normalizedArtistName = String(artistName ?? '').trim().toLowerCase();
        const currentUserNames = [
            currentUser?.displayName,
            currentUser?.artistName,
            currentUser?.username,
            currentUser?.name,
            currentUser?.fullName,
            currentUser?.user?.fullName,
            currentUser?.user?.displayName,
            currentUser?.artist?.displayName,
            currentUser?.artist?.name
        ]
            .map((value: any) => String(value ?? '').trim().toLowerCase())
            .filter((value: string) => !!value);

        return currentUserNames.includes(normalizedArtistName) ? currentUserImage : '';
    }

    private resolveCurrentUserArtistPlayCount(artistName: string): number {
        const normalizedArtistName = String(artistName ?? '').trim().toLowerCase();
        if (!normalizedArtistName) {
            return 0;
        }

        const currentUser = this.authService.getCurrentUserSnapshot() ?? {};
        const currentUserNames = [
            currentUser?.displayName,
            currentUser?.artistName,
            currentUser?.username,
            currentUser?.name,
            currentUser?.fullName,
            currentUser?.user?.fullName,
            currentUser?.user?.displayName,
            currentUser?.artist?.displayName,
            currentUser?.artist?.name
        ]
            .map((value: any) => String(value ?? '').trim().toLowerCase())
            .filter((value: string) => !!value);

        return currentUserNames.includes(normalizedArtistName) ? this.getCachedCurrentUserArtistPlayCount() : 0;
    }

    private getCachedCurrentUserArtistPlayCount(): number {
        const userId = Number(this.userId ?? 0);
        if (userId <= 0) {
            return 0;
        }

        try {
            const raw = localStorage.getItem(this.dashboardCacheKey);
            if (!raw) {
                return 0;
            }

            const parsed = JSON.parse(raw);
            const scoped = parsed?.[String(userId)];
            if (!scoped || typeof scoped !== 'object') {
                return 0;
            }

            return this.resolvePlayCount(scoped?.stats);
        } catch {
            return 0;
        }
    }

    private loadCurrentUserProfileImage(): Observable<string> {
        const currentUser = this.authService.getCurrentUserSnapshot() ?? {};
        const directImage = this.resolveArtistImage(currentUser);
        if (directImage) {
            this.cacheProfileImage(Number(currentUser?.userId ?? currentUser?.id ?? this.userId ?? 0), directImage);
            return of(directImage);
        }

        const currentUserId = Number(currentUser?.userId ?? currentUser?.id ?? this.userId ?? 0);
        const cachedImage = this.getCachedProfileImage(currentUserId);
        if (cachedImage) {
            return of(cachedImage);
        }
        const artistId = Number(
            currentUser?.artistId ??
            currentUser?.artist?.artistId ??
            currentUser?.artist?.id ??
            this.stateService.getArtistIdForUser(currentUserId) ??
            this.currentArtistId ??
            0
        );
        if (!this.hasListenerBackendAccess) {
            return of('');
        }
        if (artistId > 0) {
            return this.artistService.getArtistProfile(artistId).pipe(
                map((artist) => {
                    const image = this.resolveArtistImage(artist);
                    if (image) {
                        this.cacheProfileImage(currentUserId, image);
                        this.authService.updateCurrentUser({ profilePictureUrl: image, artistId });
                    }
                    return image;
                }),
                catchError(() => of(''))
            );
        }

        if (currentUserId <= 0) {
            return of('');
        }

        return this.apiService.get<any>(`/profile/${currentUserId}`).pipe(
            map((profile) => {
                const image = this.resolveArtistImage(profile) || this.resolveImage(
                    profile?.profilePictureUrl ??
                    profile?.profileImageUrl ??
                    profile?.avatarUrl ??
                    profile?.imageUrl ??
                    ''
                );
                if (image) {
                    this.cacheProfileImage(currentUserId, image);
                    this.authService.updateCurrentUser({ profilePictureUrl: image });
                }
                return image;
            }),
            catchError(() => of(''))
        );
    }

    private enrichTopArtistsWithProfileImages(artists: any[]) {
        const source = Array.isArray(artists) ? artists : [];
        if (source.length === 0) {
            return of([]);
        }
        if (!this.hasListenerBackendAccess) {
            return of(source);
        }

        const requests = source.map((artist) => {
            const artistId = Number(artist?.artistId ?? artist?.id ?? 0);
            const existingImage = this.resolveTopArtistImage(artist);

            if (artistId <= 0) {
                return of({
                    ...artist,
                    image: existingImage || 'assets/images/placeholder-artist.png',
                    imageUrl: existingImage || 'assets/images/placeholder-artist.png'
                });
            }

            return forkJoin({
                profile: this.artistService.getArtistProfile(artistId).pipe(catchError(() => of(null))),
                stats: this.artistService.getArtistDashboard(artistId).pipe(catchError(() => of(null)))
            }).pipe(
                map(({ profile, stats }) => {
                    const profileImage = this.resolveTopArtistImage(profile) || existingImage || 'assets/images/placeholder-artist.png';
                    const playCount = Math.max(
                        this.resolvePlayCount(artist),
                        this.resolvePlayCount(profile),
                        this.resolvePlayCount(stats),
                        0
                    );
                    return {
                        ...artist,
                        id: artistId,
                        artistId,
                        displayName: String(profile?.displayName ?? artist?.displayName ?? artist?.name ?? 'Artist'),
                        name: String(profile?.displayName ?? artist?.name ?? artist?.displayName ?? 'Artist'),
                        playCount,
                        image: profileImage,
                        imageUrl: profileImage,
                        bannerImageUrl: String(profile?.bannerImageUrl ?? '').trim()
                    };
                }),
                catchError(() => of({
                    ...artist,
                    image: existingImage || 'assets/images/placeholder-artist.png',
                    imageUrl: existingImage || 'assets/images/placeholder-artist.png'
                }))
            );
        });

        return forkJoin(requests);
    }

    private resolveTopArtistImage(item: any): string {
        const bannerImage = this.resolveImage(
            String(
                item?.bannerImageUrl ??
                item?.bannerImage ??
                item?.banner?.url ??
                item?.banner?.fileName ??
                ''
            ).trim()
        );
        if (bannerImage) {
            return bannerImage;
        }

        return this.resolveArtistImage(item);
    }

    private enrichPodcastCardsWithDetails(podcasts: any[]): Observable<any[]> {
        const source = Array.isArray(podcasts) ? podcasts : [];
        if (source.length === 0) {
            return of([]);
        }

        const requests = source.map((podcast) => {
            const podcastId = Number(podcast?.id ?? podcast?.podcastId ?? 0);
            if (podcastId <= 0) {
                return of(podcast);
            }

                return this.artistService.getPodcast(podcastId).pipe(
                    map((detail) => ({
                        ...podcast,
                        ...detail,
                        id: podcastId,
                        podcastId,
                        title: detail?.title ?? podcast?.title ?? `Podcast #${podcastId}`,
                        description: detail?.description ?? podcast?.description ?? '',
                        coverUrl: this.resolveMediaImage(detail) || String(podcast?.coverUrl ?? '').trim(),
                        playCount: Math.max(
                            this.resolvePlayCount(detail),
                            Number(podcast?.playCount ?? 0),
                            this.getPersistedPodcastPlayCount(podcastId)
                        )
                    })),
                    catchError(() => of(podcast))
                );
            });

        return forkJoin(requests);
    }

    private incrementPodcastPlayCount(podcastId: number): void {
        this.persistPodcastPlayCountIncrement(podcastId);

        const bump = (items: any[]) =>
            (items ?? []).map((item: any) => {
                const id = Number(item?.podcastId ?? item?.id ?? 0);
                if (id !== podcastId) {
                    return item;
                }
                return {
                    ...item,
                    playCount: Number(item?.playCount ?? 0) + 1
                };
            });

        this.popularPodcasts = bump(this.popularPodcasts);
        this.recommendedPodcasts = bump(this.recommendedPodcasts);
        this.cdr.markForCheck();
    }

    private resolveMergedPodcastPlayCount(item: any): number {
        const podcastId = Number(item?.podcastId ?? item?.id ?? item?.contentId ?? 0);
        return Math.max(
            this.resolvePlayCount(item),
            this.getPersistedPodcastPlayCount(podcastId)
        );
    }

    private persistPodcastPlayCountIncrement(podcastId: number): void {
        const userId = Number(this.userId ?? 0);
        if (userId <= 0 || podcastId <= 0) {
            return;
        }

        const cache = this.getPodcastPlayCountCache();
        const scoped = cache[String(userId)] ?? {};
        const current = Number(scoped[String(podcastId)] ?? 0);
        scoped[String(podcastId)] = current + 1;
        cache[String(userId)] = scoped;
        localStorage.setItem(this.podcastPlayCountStorageKey, JSON.stringify(cache));
    }

    private getPersistedPodcastPlayCount(podcastId: number): number {
        const userId = Number(this.userId ?? 0);
        if (userId <= 0 || podcastId <= 0) {
            return 0;
        }

        const cache = this.getPodcastPlayCountCache();
        return Number(cache[String(userId)]?.[String(podcastId)] ?? 0);
    }

    private getPodcastPlayCountCache(): Record<string, Record<string, number>> {
        try {
            const raw = localStorage.getItem(this.podcastPlayCountStorageKey);
            if (!raw) {
                return {};
            }
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    }

    private mergePodcastCards(...groups: any[][]): any[] {
        const merged: any[] = [];
        const seen = new Set<number>();
        for (const group of groups) {
            for (const podcast of group ?? []) {
                const podcastId = Number(podcast?.id ?? podcast?.podcastId ?? 0);
                if (podcastId <= 0 || seen.has(podcastId)) {
                    continue;
                }
                seen.add(podcastId);
                merged.push({
                    ...podcast,
                    id: podcastId,
                    isFollowed: this.followingService.isPodcastFollowed(podcastId)
                });
            }
        }
        return merged;
    }

    private resolveSongDetailsWithFallback(song: any): Observable<any | null> {
        const songId = Number(song?.songId ?? song?.id ?? 0);
        const artistId = Number(song?.artistId ?? song?.artist?.artistId ?? song?.artist?.id ?? 0);
        const baseSong = { ...song };
        const normalizedTitle = String(baseSong?.title ?? '').trim().toLowerCase();

        const artistCatalog$ = artistId > 0
            ? this.artistService.getArtistSongs(artistId, 0, 200).pipe(
                map((response) => {
                    const items = Array.isArray(response?.content) ? response.content : [];
                    const byId = items.find((item: any) => Number(item?.songId ?? item?.id ?? 0) === songId);
                    const byTitle = normalizedTitle
                        ? items.find((item: any) => String(item?.title ?? '').trim().toLowerCase() === normalizedTitle)
                        : null;
                    return byId ?? byTitle ?? null;
                }),
                catchError(() => of(null))
            )
            : of(null);

        return artistCatalog$.pipe(
            switchMap((artistSong) => {
                const merged = artistSong
                    ? { ...baseSong, ...artistSong, songId: Number(artistSong?.songId ?? songId) || songId }
                    : baseSong;
                const hasPlayableRef = this.hasPlayableSongReference(merged);
                const hasCover = !!(this.resolveMediaImage(merged) || String(merged?.coverUrl ?? '').trim());
                const hasArtist = !!this.resolveSongArtistName(merged, '').trim();
                if ((hasPlayableRef && hasCover && hasArtist) || songId <= 0) {
                    return of(merged);
                }

                return this.browseService.getSongById(songId).pipe(
                    map((detail) => detail
                        ? { ...merged, ...detail, songId: Number(detail?.songId ?? songId) || songId }
                        : merged
                    ),
                    catchError(() => of(merged))
                );
            })
        );
    }

    private buildSongPlayerTrack(primary: any, fallback: any = null): any {
        const merged = { ...(fallback ?? {}), ...(primary ?? {}) };
        const songId = Number(merged?.songId ?? merged?.id ?? merged?.contentId ?? 0);
        const fileName = this.extractAudioFileName(merged, fallback);
        const fallbackFileUrl = this.buildSongFileUrl(fileName);
        return {
            id: songId,
            songId,
            title: merged?.title ?? 'Untitled',
            artistName: this.resolveSongArtistName(merged, this.resolveSongArtistName(fallback, 'Artist')),
            fileUrl: String(merged?.fileUrl || merged?.audioUrl || merged?.streamUrl || fallbackFileUrl).trim(),
            audioUrl: String(merged?.audioUrl || merged?.streamUrl || merged?.fileUrl || fallbackFileUrl).trim(),
            streamUrl: String(merged?.streamUrl || this.buildSongStreamUrl(songId) || merged?.audioUrl || merged?.fileUrl || fallbackFileUrl).trim(),
            fileName,
            isActive: merged?.isActive,
            type: 'SONG',
            imageUrl: this.resolveMediaImage(merged) || String(fallback?.coverUrl ?? merged?.coverUrl ?? '').trim()
        };
    }

    private buildPlaybackQueueForTrack(sourceTrack: any, resolvedTrack: any): any[] {
        const targetSongId = Number(sourceTrack?.songId ?? sourceTrack?.contentId ?? sourceTrack?.id ?? resolvedTrack?.songId ?? resolvedTrack?.id ?? 0);
        const groups = [
            this.trendingNow,
            this.recommendedForYou,
            this.madeForYou,
            this.discoveryFeed,
            this.newReleases,
            this.browseSongs
        ];

        const sourceGroup = groups.find((group) =>
            (group ?? []).some((item: any) => Number(item?.songId ?? item?.contentId ?? item?.id ?? 0) === targetSongId)
        ) ?? [];

        return (sourceGroup ?? [])
            .map((item: any) => {
                const itemSongId = Number(item?.songId ?? item?.contentId ?? item?.id ?? 0);
                return itemSongId === targetSongId
                    ? resolvedTrack
                    : this.buildSongPlayerTrack(item, item);
            })
            .filter((item: any) => item?.isActive !== false)
            .filter((item: any) => Number(item?.songId ?? item?.id ?? 0) > 0);
    }

    private buildPodcastPlayerTrack(episode: any, podcast: any): any {
        return {
            id: Number(episode?.episodeId ?? episode?.id ?? 0),
            episodeId: Number(episode?.episodeId ?? episode?.id ?? 0),
            podcastId: Number(podcast?.id ?? podcast?.podcastId ?? episode?.podcastId ?? 0),
            title: String(episode?.title ?? podcast?.title ?? 'Podcast Episode').trim(),
            artistName: String(podcast?.title ?? podcast?.podcastName ?? 'Podcast').trim(),
            podcastName: String(podcast?.title ?? podcast?.podcastName ?? 'Podcast').trim(),
            fileUrl: String(episode?.fileUrl ?? episode?.audioUrl ?? episode?.streamUrl ?? '').trim(),
            audioUrl: String(episode?.audioUrl ?? episode?.fileUrl ?? episode?.streamUrl ?? '').trim(),
            streamUrl: String(episode?.streamUrl ?? episode?.audioUrl ?? episode?.fileUrl ?? '').trim(),
            fileName: String(episode?.fileName ?? episode?.audioFileName ?? '').trim(),
            durationSeconds: Number(episode?.durationSeconds ?? 0),
            imageUrl: this.resolveMediaImage(podcast) || String(podcast?.coverUrl ?? '').trim(),
            type: 'PODCAST'
        };
    }

    private hasPlayableSongReference(song: any): boolean {
        return !!String(song?.fileUrl ?? song?.audioUrl ?? song?.streamUrl ?? song?.fileName ?? '').trim();
    }

    private hasPlayablePodcastReference(item: any): boolean {
        return !!String(item?.fileUrl ?? item?.audioUrl ?? item?.streamUrl ?? item?.fileName ?? '').trim();
    }

    private resolveMediaImage(item: any): string {
        const candidates = [
            item?.coverUrl,
            item?.coverArtUrl,
            item?.coverImageUrl,
            item?.imageUrl,
            item?.image,
            item?.thumbnailUrl,
            item?.artworkUrl,
            item?.cover?.imageUrl,
            item?.cover?.url,
            item?.cover?.fileName,
            item?.imageFileName,
            item?.imageName,
            item?.coverFileName,
            item?.coverImageFileName,
            item?.album?.coverArtUrl,
            item?.album?.coverImageUrl,
            item?.album?.cover?.imageUrl,
            item?.album?.cover?.fileName,
            item?.album?.coverFileName,
            item?.album?.coverImageFileName,
            item?.album?.imageFileName,
            item?.album?.imageName
        ];

        for (const candidate of candidates) {
            const raw = String(candidate ?? '').trim();
            if (!raw) {
                continue;
            }
            const resolved = this.resolveImage(raw);
            if (resolved) {
                return resolved;
            }
        }
        return '';
    }

    private resolveImage(rawUrl: string): string {
        const value = String(rawUrl ?? '').trim();
        if (!value) {
            return '';
        }

        const lower = value.toLowerCase();
        if (
            lower.includes('/files/songs/') ||
            lower.endsWith('.mp3') ||
            lower.endsWith('.wav') ||
            lower.endsWith('.m4a') ||
            lower.endsWith('.aac') ||
            lower.endsWith('.flac') ||
            lower.endsWith('.ogg')
        ) {
            return '';
        }

        const normalized = value.split('?')[0].replace(/\/+$/, '').toLowerCase();
        if (
            normalized.endsWith('/api/v1/files/images') ||
            normalized.endsWith('/files/images') ||
            normalized === 'files/images'
        ) {
            return '';
        }

        if (value.startsWith('data:image/')) {
            return value;
        }

        if (
            !this.hasListenerBackendAccess &&
            (
                lower.includes('/api/v1/files/') ||
                lower.includes('/files/')
            )
        ) {
            return '';
        }

        const resolvedByArtistService = this.artistService.resolveImageUrl(value);
        if (resolvedByArtistService) {
            return resolvedByArtistService;
        }

        if (value.startsWith('http://') || value.startsWith('https://')) {
            return value;
        }

        if (value.startsWith('/api/v1/')) {
            return `${this.apiOrigin}${value}`;
        }

        if (value.startsWith('/files/')) {
            return `${environment.apiUrl}${value}`;
        }

        if (value.startsWith('files/')) {
            return `${environment.apiUrl}/${value}`;
        }

        if (!value.includes('/') && this.isLikelyImageFile(value)) {
            return `${environment.apiUrl}/files/images/${encodeURIComponent(value)}`;
        }

        if (value.startsWith('/')) {
            return `${this.apiOrigin}${value}`;
        }

        return value;
    }

    private extractAudioFileName(...items: any[]): string {
        for (const item of items) {
            const raw = String(
                item?.fileName ??
                item?.audioFileName ??
                item?.fileUrl ??
                item?.audioUrl ??
                item?.streamUrl ??
                ''
            ).trim();
            if (!raw) {
                continue;
            }

            const normalized = raw.split('?')[0];
            const segments = normalized.split(/[\\/]/).filter(Boolean);
            const fileName = String(segments[segments.length - 1] ?? '').trim();
            if (fileName) {
                return fileName;
            }
        }

        return '';
    }

    private buildSongStreamUrl(songId: number): string {
        return songId > 0 ? `${environment.apiUrl}/songs/${songId}/stream` : '';
    }

    private loadLikedSongs(): void {
        if (!this.userId) {
            return;
        }

        this.likesService.getUserLikes(this.userId, 'SONG', 0, 400).subscribe({
            next: (likes) => {
                const nextLikedIds = new Set<number>();
                const nextLikeIds = new Map<number, number>();
                for (const like of likes ?? []) {
                    const songId = Number(like?.likeableId ?? 0);
                    if (songId <= 0) {
                        continue;
                    }
                    nextLikedIds.add(songId);
                    const likeId = Number(like?.id ?? 0);
                    if (likeId > 0) {
                        nextLikeIds.set(songId, likeId);
                    }
                }
                this.likedSongIds = nextLikedIds;
                this.likeIdBySongId = nextLikeIds;
                this.cdr.markForCheck();
            },
            error: () => {
                // Ignore like preload failures.
            }
        });
    }

    private unlikeSong(songId: number, likeId: number): void {
        this.likesService.unlikeByLikeId(likeId).subscribe({
            next: () => {
                this.likedSongIds.delete(songId);
                this.likeIdBySongId.delete(songId);
                this.actionMessage = 'Removed from liked songs.';
                this.cdr.markForCheck();
            },
            error: () => {
                this.error = 'Failed to remove this song from liked songs.';
                this.cdr.markForCheck();
            }
        });
    }

    private getSongId(song: any): number {
        return Number(song?.songId ?? song?.contentId ?? song?.id ?? 0);
    }

    private getCachedProfileImage(userId: number): string {
        if (userId <= 0) {
            return '';
        }

        try {
            const raw = localStorage.getItem(this.artistProfileImageCacheKey);
            if (!raw) {
                return '';
            }
            const parsed = JSON.parse(raw);
            return String(parsed?.[String(userId)] ?? '').trim();
        } catch {
            return '';
        }
    }

    private cacheProfileImage(userId: number, imageUrl: string): void {
        const normalizedUserId = Number(userId ?? 0);
        const normalizedImageUrl = String(imageUrl ?? '').trim();
        if (
            normalizedUserId <= 0 ||
            !normalizedImageUrl ||
            this.isProtectedFileUrl(normalizedImageUrl)
        ) {
            return;
        }

        try {
            const raw = localStorage.getItem(this.artistProfileImageCacheKey);
            const parsed = raw ? JSON.parse(raw) : {};
            const next = parsed && typeof parsed === 'object' ? parsed : {};
            next[String(normalizedUserId)] = normalizedImageUrl;
            localStorage.setItem(this.artistProfileImageCacheKey, JSON.stringify(next));
        } catch {
            // Ignore cache write failures.
        }
    }

    private isProtectedFileUrl(value: string): boolean {
        const normalized = String(value ?? '').trim().toLowerCase();
        if (!normalized) {
            return false;
        }
        if (normalized.startsWith('data:image/')) {
            return false;
        }
        return normalized.includes('/api/v1/files/') || normalized.includes('/files/');
    }

    private buildSongFileUrl(fileName: string): string {
        return fileName ? `${environment.apiUrl}/files/songs/${encodeURIComponent(fileName)}` : '';
    }

    private isLikelyImageFile(fileName: string): boolean {
        return /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(String(fileName ?? '').trim());
    }

    private triggerSongDownload(blob: Blob, song: any): void {
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const title = this.sanitizeFileName(String(song?.title ?? 'song'));
        link.href = objectUrl;
        link.download = `${title}.mp3`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(objectUrl);
    }

    private sanitizeFileName(rawValue: string): string {
        const cleaned = String(rawValue ?? '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');

        return cleaned || 'song';
    }

    private isSmokeTestName(value: any): boolean {
        const text = String(value ?? '').trim();
        if (!text) {
            return false;
        }
        return /^(smoke|endpoint)/i.test(text);
    }

    private noteAccessIssue(err: any, feature: string): void {
        const status = Number(err?.status ?? 0);
        if (status === 401) {
            this.notice = 'Sign in again to load all personalized content.';
            return;
        }
        if (status === 403) {
            this.notice = `Some sections are unavailable for your account role (for example: ${feature}).`;
        }
    }

}
