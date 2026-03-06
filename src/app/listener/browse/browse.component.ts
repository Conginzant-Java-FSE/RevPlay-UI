import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
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
import { ApiService } from '../../core/services/api';
import { forkJoin, Observable, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { hasAnyRole } from '../../core/utils/role.util';
import { shareSongWithFallback } from '../../core/utils/song-share.util';
import { environment } from '../../../environments/environment';

@Component({
    selector: 'app-browse',
    templateUrl: './browse.component.html',
    styleUrls: ['./browse.component.scss'],
    standalone: true,
    imports: [CommonModule, RouterModule, FormsModule],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class BrowseComponent implements OnInit {
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
    showAddToPlaylistPicker = false;
    songForPlaylistAdd: any | null = null;
    targetPlaylistIdForSongAdd = '';
    playlistTargets: any[] = [];
    isActionSaving = false;
    private userId: number | null = null;
    private currentArtistId: number | null = null;
    private readonly apiOrigin = environment.apiUrl.replace(/\/api\/v1$/, '');

    constructor(
        private browseService: BrowseService,
        private playerService: PlayerService,
        private authService: AuthService,
        private artistService: ArtistService,
        private stateService: StateService,
        private followingService: FollowingService,
        private playlistService: PlaylistService,
        private likesService: LikesService,
        private apiService: ApiService,
        private router: Router,
        private cdr: ChangeDetectorRef
    ) { }

    ngOnInit(): void {
        this.userId = this.resolveUserId();
        this.currentArtistId = this.resolveCurrentArtistId();
        this.loadData();
    }

    loadData(): void {
        this.isLoading = true;
        this.error = null;
        this.notice = null;
        this.actionMessage = null;
        const currentUser = this.authService.getCurrentUserSnapshot();
        const canUseListenerFeatures = hasAnyRole(currentUser, ['LISTENER']);

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
            trending: this.browseService.getTrending('SONG', 'WEEKLY', 12).pipe(catchError((err) => {
                this.noteAccessIssue(err, 'trending');
                return of([]);
            })),
            releases: this.browseService.getNewReleases().pipe(catchError((err) => {
                this.noteAccessIssue(err, 'new releases');
                return of({ content: [] });
            })),
            artists: this.browseService.getTopArtists().pipe(catchError((err) => {
                this.noteAccessIssue(err, 'top artists');
                return of({ content: [] });
            })),
            songs: this.browseService.getBrowseSongs().pipe(catchError((err) => {
                this.noteAccessIssue(err, 'browse songs');
                return of({ content: [] });
            })),
            popularPodcasts: this.browseService.getPopularPodcasts().pipe(catchError((err) => {
                this.noteAccessIssue(err, 'popular podcasts');
                return of({ content: [] });
            })),
            recommendedPodcasts: this.browseService.getRecommendedPodcasts(0, 10).pipe(catchError((err) => {
                this.noteAccessIssue(err, 'recommended podcasts');
                return of({ content: [] });
            })),
            systemPlaylists: this.browseService.getSystemPlaylists().pipe(catchError(() => of([]))),
            personalized: personalized$,
            creatorCatalog: this.loadCreatorFallbackCatalog()
        }).subscribe({
            next: ({ trending, releases, artists, songs, popularPodcasts, recommendedPodcasts, systemPlaylists, personalized, creatorCatalog }) => {
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

                const baseTrending = this.mergeSongCards(mappedTrending, creatorSongs);
                const baseNewReleases = this.mergeSongCards(mappedNewReleases, creatorSongs);
                this.topArtists = this.mergeArtistCards(mappedTopArtists, creatorArtists, this.deriveArtistsFromSongs(baseTrending));
                const baseBrowseSongs = this.mergeSongCards(mappedBrowseSongs, creatorSongs);
                this.popularPodcasts = this.mergePodcastCards(mappedPopularPodcasts, creatorPodcasts);
                this.recommendedPodcasts = this.mergePodcastCards(mappedRecommendedPodcasts, creatorPodcasts);
                this.mixPlaylists = this.normalizeSystemPlaylists(systemPlaylists);

                const baseRecommendedForYou = this.mapSongCards(this.buildForYouList(personalized.recommendations));
                const baseMadeForYou = this.mapSongCards(personalized?.weekly?.items ?? []);
                const baseDiscoveryFeed = this.mapSongCards(this.buildDiscoveryFeedList(personalized.feed));

                this.trendingNow = baseTrending;
                this.newReleases = baseNewReleases;
                this.browseSongs = baseBrowseSongs;
                this.recommendedForYou = baseRecommendedForYou;
                this.madeForYou = baseMadeForYou;
                this.discoveryFeed = baseDiscoveryFeed;

                this.enrichSongCardsWithSongDetails(baseTrending).subscribe((enrichedTrending) => {
                    this.trendingNow = enrichedTrending;
                    this.topArtists = this.mergeArtistCards(mappedTopArtists, creatorArtists, this.deriveArtistsFromSongs(this.trendingNow));
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

                this.enrichTopArtistsWithProfileImages(this.topArtists).subscribe((enrichedArtists) => {
                    this.topArtists = enrichedArtists;
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

    playTrack(track: any): void {
        const songId = Number(track.songId ?? track.contentId ?? track.id);
        if (!songId) {
            return;
        }

        this.browseService.getSongById(songId).subscribe({
            next: (song) => {
                this.playerService.playTrack(
                    {
                        id: song.songId ?? song.id,
                        title: song.title ?? track.title,
                        artistName: this.resolveSongArtistName(song, this.resolveSongArtistName(track)),
                        fileUrl: String(song?.fileUrl ?? song?.audioUrl ?? song?.streamUrl ?? track?.fileUrl ?? '').trim(),
                        audioUrl: String(song?.audioUrl ?? song?.fileUrl ?? track?.audioUrl ?? '').trim(),
                        streamUrl: String(song?.streamUrl ?? song?.fileUrl ?? track?.streamUrl ?? '').trim(),
                        fileName: String(song?.fileName ?? track?.fileName ?? '').trim(),
                        type: 'SONG',
                        imageUrl: track.coverUrl
                    },
                    [song]
                );
            },
            error: () => {
                this.error = 'Unable to play this track right now.';
                this.cdr.markForCheck();
            }
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
        const songId = Number(song?.songId ?? song?.contentId ?? song?.id ?? 0);
        if (!songId || !this.userId) {
            this.error = 'User session not found.';
            this.cdr.markForCheck();
            return;
        }

        this.error = null;
        this.actionMessage = null;
        this.likesService.getSongLikeId(this.userId, songId).subscribe({
            next: (existingLikeId) => {
                if (existingLikeId) {
                    this.actionMessage = 'Song is already in your liked songs.';
                    this.cdr.markForCheck();
                    return;
                }

                this.likesService.likeSong(songId).subscribe({
                    next: () => {
                        this.actionMessage = 'Added to liked songs.';
                        this.cdr.markForCheck();
                    },
                    error: () => {
                        this.error = 'Failed to add this song to liked songs.';
                        this.cdr.markForCheck();
                    }
                });
            },
            error: () => {
                this.error = 'Failed to verify liked songs state.';
                this.cdr.markForCheck();
            }
        });
    }

    addSongToQueue(song: any): void {
        this.playerService.addToQueue(song);
        this.actionMessage = 'Added to queue.';
        this.cdr.markForCheck();
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

    hideSongInCurrentList(song: any): void {
        const songId = Number(song?.songId ?? song?.contentId ?? song?.id ?? 0);
        if (!songId) {
            return;
        }

        this.trendingNow = this.filterOutSongById(this.trendingNow, songId);
        this.recommendedForYou = this.filterOutSongById(this.recommendedForYou, songId);
        this.madeForYou = this.filterOutSongById(this.madeForYou, songId);
        this.discoveryFeed = this.filterOutSongById(this.discoveryFeed, songId);
        this.newReleases = this.filterOutSongById(this.newReleases, songId);
        this.browseSongs = this.filterOutSongById(this.browseSongs, songId);
        this.actionMessage = 'Song hidden from current lists.';
        this.cdr.markForCheck();
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
        const artistId = Number(this.currentArtistId ?? 0);
        if (artistId <= 0) {
            return of({ songs: [], albums: [], podcasts: [], artists: [] });
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
            catchError(() => of({ songs: [], albums: [], podcasts: [], artists: [] }))
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

    private buildDiscoveryFeedList(response: any): any[] {
        const weekly = response?.discoverWeekly ?? [];
        const releases = response?.newReleases ?? [];
        return [...weekly, ...releases];
    }

    private mapSongCards(items: any[]): any[] {
        return (items ?? [])
            .map((item: any) => ({
                id: Number(item.songId ?? item.contentId ?? item.id ?? 0),
                songId: Number(item.songId ?? item.contentId ?? item.id ?? 0),
                albumId: Number(item.albumId ?? item.album?.albumId ?? item.album?.id ?? 0),
                artistId: Number(item.artistId ?? 0),
                title: item.title ?? 'Untitled',
                artistName: this.resolveSongArtistName(item),
                fileUrl: String(item?.fileUrl ?? item?.audioUrl ?? item?.streamUrl ?? '').trim(),
                audioUrl: String(item?.audioUrl ?? item?.fileUrl ?? '').trim(),
                streamUrl: String(item?.streamUrl ?? item?.fileUrl ?? '').trim(),
                fileName: String(item?.fileName ?? '').trim(),
                coverUrl: this.resolveMediaImage(item) ||
                    this.artistService.getCachedSongImage(Number(item.songId ?? item.contentId ?? item.id ?? 0)) ||
                    this.artistService.getCachedAlbumImage(Number(item.albumId ?? item.album?.albumId ?? item.album?.id ?? 0)),
                subtitle: item.playCount ? `${item.playCount} plays` : item.releaseDate ?? ''
            }))
            .filter((item: any) => item.songId > 0 && !this.isSmokeTestName(item?.title));
    }

    private filterOutSongById(items: any[], songId: number): any[] {
        return (items ?? []).filter((item) => Number(item?.songId ?? item?.id ?? 0) !== songId);
    }

    private mapArtistCards(items: any[]): any[] {
        return (items ?? []).map((item: any) => ({
            id: Number(item.artistId ?? item.id ?? 0),
            name: item.displayName ?? item.artistName ?? item.name ?? item.title ?? 'Artist',
            imageUrl: this.resolveArtistImage(item),
            playCount: item.playCount ?? 0,
            isFollowed: this.followingService.isArtistFollowed(Number(item.artistId ?? item.id ?? 0))
        })).filter((item: any) => item.id > 0);
    }

    private mapPodcastCards(items: any[]): any[] {
        return (items ?? [])
            .map((item: any) => ({
                id: Number(item.podcastId ?? item.id ?? 0),
                title: item.title ?? 'Podcast',
                description: item.description ?? '',
                coverUrl: this.resolveMediaImage(item) ||
                    this.artistService.getCachedAlbumImage(Number(item?.albumId ?? item?.id ?? 0)),
                playCount: item.playCount ?? 0,
                isFollowed: this.followingService.isPodcastFollowed(Number(item.podcastId ?? item.id ?? 0))
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

        if (missingArtistIds.length === 0) {
            return of(source.map((song) => ({
                ...song,
                artistName: this.normalizeArtistLabel(song?.artistName)
            })));
        }

        const requests = missingArtistIds.map((artistId) =>
            this.browseService.getArtistById(artistId).pipe(
                map((artist) => ({ artistId, artistName: this.resolveArtistDisplayName(artist) })),
                catchError(() => of({ artistId, artistName: '' }))
            )
        );

        return forkJoin(requests).pipe(
            map((rows) => {
                const artistMap = new Map<number, string>();
                for (const row of rows) {
                    const id = Number(row?.artistId ?? 0);
                    const name = String(row?.artistName ?? '').trim();
                    if (id > 0 && name) {
                        artistMap.set(id, name);
                    }
                }

                return source.map((song) => {
                    const currentName = String(song?.artistName ?? '').trim();
                    if (currentName && currentName.toLowerCase() !== 'unknown artist') {
                        return song;
                    }
                    const artistId = Number(song?.artistId ?? 0);
                    const resolvedArtistName = artistMap.get(artistId) ?? '';
                    if (!resolvedArtistName) {
                        return song;
                    }
                    return { ...song, artistName: resolvedArtistName };
                });
            }),
            map((songsList) => songsList.map((song) => ({
                ...song,
                artistName: this.normalizeArtistLabel(song?.artistName)
            })))
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
        const requests = uniqueSongIds.map((songId) =>
            this.browseService.getSongById(songId).pipe(
                catchError(() => of(null)),
                map((song) => ({ songId, song }))
            )
        );

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

                return this.enrichSongCardsWithArtistNames(merged);
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
        const seen = new Set<number>();
        for (const group of groups) {
            for (const song of group ?? []) {
                const songId = Number(song?.songId ?? song?.id ?? 0);
                if (songId <= 0 || seen.has(songId)) {
                    continue;
                }
                seen.add(songId);
                merged.push(song);
            }
        }
        return merged;
    }

    private mergeArtistCards(...groups: any[][]): any[] {
        const merged: any[] = [];
        const seen = new Set<number>();
        for (const group of groups) {
            for (const artist of group ?? []) {
                const artistId = Number(artist?.id ?? artist?.artistId ?? 0);
                if (artistId <= 0 || seen.has(artistId)) {
                    continue;
                }
                seen.add(artistId);
                merged.push({
                    ...artist,
                    id: artistId,
                    name: artist?.name ?? artist?.displayName ?? artist?.artistName ?? 'Artist',
                    imageUrl: String(artist?.imageUrl ?? '').trim() || this.resolveArtistImage(artist),
                    isFollowed: this.followingService.isArtistFollowed(artistId)
                });
            }
        }
        return merged;
    }

    private deriveArtistsFromSongs(songs: any[]): any[] {
        const byArtist = new Map<number, any>();
        for (const song of songs ?? []) {
            const artistId = Number(song?.artistId ?? 0);
            const artistName = String(song?.artistName ?? '').trim();
            if (artistId > 0 && artistName && !byArtist.has(artistId)) {
                byArtist.set(artistId, {
                    id: artistId,
                    name: artistName,
                    imageUrl: '',
                    playCount: 0
                });
            }
        }
        return Array.from(byArtist.values());
    }

    private resolveArtistImage(item: any): string {
        const candidates = [
            item?.profilePictureUrl,
            item?.profileImageUrl,
            item?.profilePicture,
            item?.profileImage,
            item?.avatarUrl,
            item?.avatar,
            item?.imageUrl,
            item?.image,
            item?.coverImageUrl,
            item?.coverArtUrl,
            item?.thumbnailUrl,
            item?.artist?.profilePictureUrl,
            item?.artist?.profileImageUrl,
            item?.artist?.avatarUrl,
            item?.artist?.imageUrl
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

    private enrichTopArtistsWithProfileImages(artists: any[]) {
        const source = Array.isArray(artists) ? artists : [];
        if (source.length === 0) {
            return of([]);
        }

        const requests = source.map((artist) => {
            const existingImage = this.resolveArtistImage(artist);
            if (existingImage) {
                return of({ ...artist, imageUrl: existingImage });
            }

            const artistId = Number(artist?.id ?? artist?.artistId ?? 0);
            if (artistId <= 0) {
                return of(artist);
            }

            return this.browseService.getArtistById(artistId).pipe(
                catchError(() => of(null)),
                switchMap((artistProfile) => {
                    const profileImage = this.resolveArtistImage(artistProfile);
                    if (profileImage) {
                        return of({ ...artist, imageUrl: profileImage });
                    }

                    const artistName = String(artist?.name ?? artist?.displayName ?? '').trim();
                    if (!artistName) {
                        return of(artist);
                    }

                    return this.apiService.get<any>(`/search?q=${encodeURIComponent(artistName)}&type=ARTIST&page=0&size=5`).pipe(
                        map((response) => {
                            const list = Array.isArray(response?.content) ? response.content : (Array.isArray(response) ? response : []);
                            const best = (list ?? []).find((item: any) =>
                                String(item?.displayName ?? item?.artistName ?? item?.name ?? item?.title ?? '').trim().toLowerCase() === artistName.toLowerCase()
                            ) ?? list?.[0] ?? null;

                            const imageUrl = this.resolveArtistImage(best);
                            return imageUrl ? { ...artist, imageUrl } : artist;
                        }),
                        catchError(() => of(artist))
                    );
                })
            );
        });

        return forkJoin(requests);
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
            item?.coverFileName,
            item?.coverImageFileName,
            item?.album?.coverArtUrl,
            item?.album?.coverImageUrl,
            item?.album?.cover?.imageUrl,
            item?.album?.cover?.fileName
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

        if (!value.includes('/')) {
            return `${environment.apiUrl}/files/images/${encodeURIComponent(value)}`;
        }

        if (value.startsWith('/')) {
            return `${this.apiOrigin}${value}`;
        }

        return value;
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
