import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { forkJoin, of, Subject } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, switchMap } from 'rxjs/operators';
import { ApiService } from '../../core/services/api';
import { GenreService } from '../../core/services/genre.service';
import { PlayerService } from '../../core/services/player.service';
import { PlaylistService } from '../../core/services/playlist.service';
import { LikesService } from '../../core/services/likes.service';
import { PremiumService } from '../../core/services/premium.service';
import { AuthService } from '../../core/services/auth';
import { ArtistService } from '../../core/services/artist.service';
import { StateService } from '../../core/services/state.service';
import { BrowseService } from '../services/browse.service';
import { FollowingService } from '../../core/services/following.service';
import { environment } from '../../../environments/environment';
import { shareSongWithFallback } from '../../core/utils/song-share.util';
import { ProtectedMediaPipe } from '../../core/pipes/protected-media.pipe';
import { hasAnyRole, hasRole } from '../../core/utils/role.util';

type SearchFilter = 'ALL' | 'SONG' | 'ARTIST' | 'ALBUM' | 'PODCAST' | 'PLAYLIST';

interface PaginationState {
    page: number;
    size: number;
    totalElements: number;
    totalPages: number;
}

type SpeechRecognitionLike = {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    maxAlternatives: number;
    start: () => void;
    stop: () => void;
    onresult: ((event: any) => void) | null;
    onerror: ((event: any) => void) | null;
    onend: (() => void) | null;
};

@Component({
    selector: 'app-search',
    templateUrl: './search.component.html',
    styleUrls: ['./search.component.scss'],
    standalone: true,
    imports: [CommonModule, RouterModule, FormsModule, ProtectedMediaPipe],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class SearchComponent implements OnInit, OnDestroy {
    private readonly albumSongMapKey = 'revplay_album_song_map';
    private readonly recentUploadsCacheKey = 'revplay_artist_recent_uploads_cache';
    private readonly artistSearchImageCache = new Map<number, string>();
    private readonly pendingArtistSearchImageIds = new Set<number>();
    genres: any[] = [];
    searchQuery = '';
    selectedFilter: SearchFilter = 'ALL';
    isLoading = false;
    error: string | null = null;
    selectedAlbum: any | null = null;
    selectedAlbumSongs: any[] = [];
    isAlbumLoading = false;
    albumError: string | null = null;
    selectedPodcast: any | null = null;
    selectedPodcastEpisodes: any[] = [];
    isPodcastLoading = false;
    podcastError: string | null = null;
    actionMessage: string | null = null;
    isDownloadingSongId: number | null = null;
    showAddToPlaylistPicker = false;
    songForPlaylistAdd: any | null = null;
    targetPlaylistIdForSongAdd = '';
    playlistTargets: any[] = [];
    isActionSaving = false;
    isVoiceSearchSupported = false;
    isVoiceListening = false;

    groupedResults = {
        songs: [] as any[],
        artists: [] as any[],
        albums: [] as any[],
        podcasts: [] as any[],
        playlists: [] as any[]
    };

    pagination: PaginationState = {
        page: 0,
        size: 20,
        totalElements: 0,
        totalPages: 0
    };

    readonly filters: Array<{ id: SearchFilter; label: string }> = [
        { id: 'ALL', label: 'All' },
        { id: 'SONG', label: 'Songs' },
        { id: 'ARTIST', label: 'Artists' },
        { id: 'ALBUM', label: 'Albums' },
        { id: 'PODCAST', label: 'Podcasts' },
        { id: 'PLAYLIST', label: 'Playlists' }
    ];

    private searchTerms = new Subject<string>();
    private readonly defaultSeedTerm = 'a';
    private readonly apiOrigin = environment.apiUrl.replace(/\/api\/v1$/, '');
    private currentUserId: number | null = null;
    private currentArtistId: number | null = null;
    private currentArtistProfileImageUrl = '';
    private searchApiBlocked = false;
    private hasListenerBackendAccess = false;
    private likedSongIds = new Set<number>();
    private likeIdBySongId = new Map<number, number>();
    private speechRecognition: SpeechRecognitionLike | null = null;

    constructor(
        private apiService: ApiService,
        private genreService: GenreService,
        private playerService: PlayerService,
        private playlistService: PlaylistService,
        private likesService: LikesService,
        private premiumService: PremiumService,
        private http: HttpClient,
        private authService: AuthService,
        private artistService: ArtistService,
        private stateService: StateService,
        private browseService: BrowseService,
        private followingService: FollowingService,
        private route: ActivatedRoute,
        private router: Router,
        private cdr: ChangeDetectorRef
    ) { }

    ngOnInit(): void {
        this.currentUserId = this.resolveCurrentUserId();
        this.currentArtistId = this.resolveCurrentArtistId();
        this.preloadCurrentArtistProfileImage();
        this.hasListenerBackendAccess = this.canUseListenerBackend(this.authService.getCurrentUserSnapshot());
        this.searchApiBlocked = !this.hasListenerBackendAccess;
        this.initializeVoiceSearch();
        this.loadLikedSongs();
        this.genreService.clearCache();
        this.setupSearchStream();

        this.route.queryParamMap.subscribe((params) => {
            const q = (params.get('q') ?? '').trim();
            const type = String(params.get('type') ?? '').trim().toUpperCase() as SearchFilter;
            const albumId = Number(params.get('albumId') ?? 0);

            const hasValidType = this.filters.some((filter) => filter.id === type);
            if (hasValidType && type !== this.selectedFilter) {
                this.selectedFilter = type;
            }

            if (q !== this.searchQuery) {
                this.searchQuery = q;
            }

            this.fetchSearchResults();

            if (albumId > 0) {
                this.openAlbumById(albumId);
            }
        });

        this.fetchSearchResults();
    }

    ngOnDestroy(): void {
        this.disposeVoiceSearch();
    }

    get hasResults(): boolean {
        return this.groupedResults.songs.length > 0 ||
            this.groupedResults.artists.length > 0 ||
            this.groupedResults.albums.length > 0 ||
            this.groupedResults.podcasts.length > 0 ||
            this.groupedResults.playlists.length > 0;
    }

    get noResultsMessage(): string {
        const term = this.searchQuery.trim();
        return term ? `No results found for "${term}".` : 'No results found.';
    }

    onSearchInput(term: string): void {
        this.error = null;
        this.searchTerms.next(term);
    }

    toggleVoiceSearch(): void {
        if (!this.isVoiceSearchSupported || !this.speechRecognition) {
            this.error = 'Voice search is not supported in this browser.';
            this.cdr.markForCheck();
            return;
        }

        if (this.isVoiceListening) {
            this.stopVoiceSearch();
            return;
        }

        this.error = null;
        this.actionMessage = null;

        try {
            this.speechRecognition.start();
            this.isVoiceListening = true;
        } catch {
            this.isVoiceListening = false;
            this.error = 'Unable to start voice search.';
        }

        this.cdr.markForCheck();
    }

    onFilterChange(filter: SearchFilter): void {
        if (this.selectedFilter === filter) {
            return;
        }
        this.selectedFilter = filter;
        this.pagination.page = 0;
        this.error = null;
        this.resetSelectedAlbumState();
        this.fetchSearchResults();
    }

    previousPage(): void {
        if (this.pagination.page <= 0) {
            return;
        }
        this.pagination.page -= 1;
        this.fetchSearchResults();
    }

    nextPage(): void {
        if (this.pagination.page >= this.pagination.totalPages - 1) {
            return;
        }
        this.pagination.page += 1;
        this.fetchSearchResults();
    }

    playSong(song: any): void {
        const songId = Number(song?.songId ?? song?.contentId ?? song?.id ?? 0);
        if (!songId && !this.hasPlayableSongReference(song)) {
            return;
        }

        this.error = null;
        this.resolveSongPlaybackSource(song).subscribe({
            next: (resolvedSong) => {
                if (!resolvedSong || this.isUnplayableSong(resolvedSong)) {
                    this.removeSongFromResults(songId);
                    this.cdr.markForCheck();
                    return;
                }

                const playbackTrack = this.buildSongPlayerTrack(resolvedSong, song);
                const queue = this.buildSearchResultsQueue(song, playbackTrack);
                this.playerService.playTrack(playbackTrack, queue.length > 0 ? queue : [playbackTrack]);
            },
            error: () => {
                this.removeSongFromResults(songId);
                this.cdr.markForCheck();
            }
        });
    }

    onSongThumbError(event: Event): void {
        const image = event.target as HTMLImageElement | null;
        if (!image) {
            return;
        }
        image.src = 'assets/images/placeholder-album.png';
    }

    onMediaThumbError(event: Event): void {
        this.onSongThumbError(event);
    }

    onArtistThumbError(event: Event): void {
        const image = event.target as HTMLImageElement | null;
        if (!image) {
            return;
        }
        image.src = 'assets/images/placeholder-artist.png';
    }

    addSongToQueue(song: any): void {
        this.playerService.addToQueue(song);
        this.actionMessage = 'Added to queue.';
        this.cdr.markForCheck();
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
        this.toggleSongLike(song);
    }

    downloadSong(song: any): void {
        const songId = Number(song?.songId ?? song?.contentId ?? song?.id ?? 0);
        if (!songId || !this.currentUserId) {
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

        const endpoint = `${environment.apiUrl}/download/song/${songId}?userId=${this.currentUserId}`;
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


    isSongLiked(song: any): boolean {
        const songId = this.getSongId(song);
        return songId > 0 && this.likedSongIds.has(songId);
    }

    toggleSongLike(song: any): void {
        const songId = this.getSongId(song);
        if (!songId || !this.currentUserId) {
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

            this.likesService.getSongLikeId(this.currentUserId, songId).subscribe({
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

        const fallbackSongId = Number(song?.songId ?? song?.contentId ?? song?.id ?? 0);
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

        const artistName = String(song?.artistName ?? '').trim();
        if (artistName) {
            openByArtistName(artistName);
            return;
        }

        const fallbackSongId = Number(song?.songId ?? song?.contentId ?? song?.id ?? 0);
        if (!fallbackSongId) {
            this.error = 'Artist details are not available for this song.';
            this.cdr.markForCheck();
            return;
        }

        this.browseService.getSongById(fallbackSongId).pipe(
            catchError(() => of(null))
        ).subscribe((resolved) => openByArtistName(String(resolved?.artistName ?? '')));
    }

    async shareSong(song: any): Promise<void> {
        const result = await shareSongWithFallback({
            songId: Number(song?.songId ?? song?.contentId ?? song?.id ?? 0),
            title: String(song?.title ?? 'Song'),
            artistName: String(song?.artistName ?? song?.subtitle ?? '')
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

    selectAlbum(album: any): void {
        const albumId = this.getAlbumId(album);
        if (!albumId) {
            return;
        }

        const fallbackCover = this.resolveImage(album?.coverArtUrl ?? album?.coverImageUrl ?? album?.imageUrl ?? album?.image ?? '');
        this.selectedAlbum = {
            ...album,
            id: albumId,
            title: album?.title ?? album?.name ?? `Album #${albumId}`,
            coverArtUrl: fallbackCover
        };
        this.syncAlbumCoverInResults(albumId, fallbackCover);
        this.selectedAlbumSongs = [];
        this.isAlbumLoading = true;
        this.albumError = null;
        this.cdr.markForCheck();

        this.apiService.get<any>(`/albums/${albumId}`).pipe(
            map((albumDetail) => {
                const resolvedAlbum = this.unwrapAlbumPayload(albumDetail);
                const normalizedId = this.getAlbumId(resolvedAlbum) || albumId;
                return {
                    ...resolvedAlbum,
                    id: normalizedId,
                    coverArtUrl: this.resolveImage(
                        resolvedAlbum?.coverArtUrl ?? resolvedAlbum?.coverImageUrl ?? resolvedAlbum?.imageUrl ?? resolvedAlbum?.image ?? fallbackCover
                    )
                };
            }),
            catchError(() => of(null))
        ).subscribe((albumDetail) => {
            if (!albumDetail) {
                this.loadAlbumSongsFallback(albumId, true);
                return;
            }

            const songs = this.normalizeAlbumSongs(this.extractAlbumSongs(albumDetail), albumDetail);
            this.selectedAlbum = {
                ...this.selectedAlbum,
                ...albumDetail,
                id: this.getAlbumId(albumDetail) || albumId,
                title: albumDetail?.title ?? this.selectedAlbum?.title ?? `Album #${albumId}`,
                coverArtUrl: albumDetail?.coverArtUrl ?? this.selectedAlbum?.coverArtUrl ?? ''
            };
            this.syncAlbumCoverInResults(
                this.getAlbumId(this.selectedAlbum) || albumId,
                String(this.selectedAlbum?.coverArtUrl ?? '').trim()
            );
            if (songs.length > 0) {
                this.selectedAlbumSongs = songs;
                this.isAlbumLoading = false;
                this.albumError = null;
                this.cdr.markForCheck();
                return;
            }

            this.loadAlbumSongsFallback(albumId, false);
        });
    }

    playSelectedAlbum(): void {
        const queue = this.buildAlbumQueue();
        if (queue.length === 0) {
            this.albumError = 'No playable songs found in this album.';
            this.cdr.markForCheck();
            return;
        }

        this.playerService.playTrack(queue[0], queue);
    }

    playAlbumSong(song: any): void {
        const track = this.toPlayerTrack(song);
        if (!track || !track.songId) {
            return;
        }

        const queue = this.buildAlbumQueue();
        this.playerService.playTrack(track, queue.length > 0 ? queue : [track]);
    }

    toggleArtistFollow(artist: any): void {
        const artistId = Number(artist?.id ?? 0);
        if (!artistId) {
            return;
        }

        const nextState = this.followingService.toggleArtist({
            id: artistId,
            name: artist?.title ?? artist?.name ?? `Artist #${artistId}`,
            subtitle: artist?.subtitle ?? ''
        });
        artist.isFollowed = nextState;
        this.actionMessage = nextState
            ? `Now following ${artist?.title ?? artist?.name ?? 'artist'}.`
            : `Unfollowed ${artist?.title ?? artist?.name ?? 'artist'}.`;
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
            subtitle: podcast?.subtitle ?? podcast?.description ?? ''
        });
        podcast.isFollowed = nextState;
        this.actionMessage = nextState
            ? `Now following ${podcast?.title ?? 'podcast'}.`
            : `Unfollowed ${podcast?.title ?? 'podcast'}.`;
        this.cdr.markForCheck();
    }

    playPodcast(podcast: any): void {
        const podcastId = Number(podcast?.podcastId ?? podcast?.id ?? 0);
        const episodeId = Number(podcast?.episodeId ?? podcast?.podcastEpisodeId ?? 0);

        if (episodeId > 0) {
            const track = this.buildPodcastPlayerTrack(podcast, podcast);
            if (!this.hasPlayablePodcastReference(track)) {
                this.error = 'No playable episode found for this podcast.';
                this.cdr.markForCheck();
                return;
            }
            this.playerService.playTrack(track, [track]);
            return;
        }

        if (podcastId <= 0) {
            return;
        }

        this.error = null;
        this.selectedPodcast = this.normalizePodcastCard(podcast);
        this.selectedPodcastEpisodes = [];
        this.isPodcastLoading = true;
        this.podcastError = null;
        this.artistService.getPodcastEpisodes(podcastId, 0, 100).pipe(
            map((response) => Array.isArray(response?.content) ? response.content : []),
            catchError(() => of([]))
        ).subscribe((episodes) => {
            const normalizedEpisodes = this.normalizePodcastEpisodes(episodes);
            this.selectedPodcastEpisodes = normalizedEpisodes;
            const fallbackCover = this.resolvePodcastEpisodeFallbackCover(normalizedEpisodes[0], this.selectedPodcast);
            if (fallbackCover) {
                this.selectedPodcast = {
                    ...this.selectedPodcast,
                    coverArtUrl: fallbackCover,
                    imageUrl: fallbackCover
                };
                this.syncPodcastCoverInResults(podcastId, fallbackCover);
            }
            this.isPodcastLoading = false;

            const queue = normalizedEpisodes
                .map((episode: any) => this.buildPodcastPlayerTrack(episode, podcast))
                .filter((item: any) => this.hasPlayablePodcastReference(item));

            if (queue.length === 0) {
                this.podcastError = 'No playable episodes found for this podcast.';
                this.cdr.markForCheck();
                return;
            }

            this.playerService.playTrack(queue[0], queue);
            this.cdr.markForCheck();
        });
    }

    selectPodcast(podcast: any): void {
        const podcastId = Number(podcast?.podcastId ?? podcast?.id ?? 0);
        if (podcastId <= 0) {
            return;
        }

        this.selectedPodcast = this.normalizePodcastCard(podcast);
        this.selectedPodcastEpisodes = [];
        this.isPodcastLoading = true;
        this.podcastError = null;
        this.cdr.markForCheck();

        this.artistService.getPodcastEpisodes(podcastId, 0, 100).pipe(
            map((response) => Array.isArray(response?.content) ? response.content : []),
            catchError(() => of([]))
        ).subscribe((episodes) => {
            this.selectedPodcastEpisodes = this.normalizePodcastEpisodes(episodes);
            const fallbackCover = this.resolvePodcastEpisodeFallbackCover(this.selectedPodcastEpisodes[0], this.selectedPodcast);
            if (fallbackCover) {
                this.selectedPodcast = {
                    ...this.selectedPodcast,
                    coverArtUrl: fallbackCover,
                    imageUrl: fallbackCover
                };
                this.syncPodcastCoverInResults(podcastId, fallbackCover);
            }
            this.isPodcastLoading = false;
            this.podcastError = this.selectedPodcastEpisodes.length === 0
                ? 'No episodes found for this podcast.'
                : null;
            this.cdr.markForCheck();
        });
    }

    playSelectedPodcast(): void {
        if (!this.selectedPodcast) {
            return;
        }

        const queue = this.selectedPodcastEpisodes
            .map((episode: any) => this.buildPodcastPlayerTrack(episode, this.selectedPodcast))
            .filter((item: any) => this.hasPlayablePodcastReference(item));

        if (queue.length === 0) {
            this.podcastError = 'No playable episodes found for this podcast.';
            this.cdr.markForCheck();
            return;
        }

        this.playerService.playTrack(queue[0], queue);
    }

    playPodcastEpisode(episode: any): void {
        if (!this.selectedPodcast) {
            return;
        }

        const track = this.buildPodcastPlayerTrack(episode, this.selectedPodcast);
        if (!this.hasPlayablePodcastReference(track)) {
            this.podcastError = 'This episode is not playable.';
            this.cdr.markForCheck();
            return;
        }

        const queue = this.selectedPodcastEpisodes
            .map((item: any) => this.buildPodcastPlayerTrack(item, this.selectedPodcast))
            .filter((item: any) => this.hasPlayablePodcastReference(item));

        this.playerService.playTrack(track, queue.length > 0 ? queue : [track]);
    }

    private setupSearchStream(): void {
        this.searchTerms.pipe(
            debounceTime(220),
            distinctUntilChanged()
        ).subscribe((term) => {
            this.searchQuery = term;
            this.pagination.page = 0;
            this.fetchSearchResults();
        });
    }

    private initializeVoiceSearch(): void {
        const browserWindow = typeof window !== 'undefined' ? (window as any) : null;
        const speechRecognitionCtor = browserWindow?.SpeechRecognition ?? browserWindow?.webkitSpeechRecognition;
        if (!speechRecognitionCtor) {
            this.isVoiceSearchSupported = false;
            this.speechRecognition = null;
            return;
        }

        const recognition = new speechRecognitionCtor() as SpeechRecognitionLike;
        recognition.lang = typeof navigator !== 'undefined' ? String(navigator.language ?? 'en-US') : 'en-US';
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        recognition.onresult = (event: any) => {
            const transcript = String(event?.results?.[0]?.[0]?.transcript ?? '').trim();
            this.isVoiceListening = false;
            if (transcript) {
                this.searchQuery = transcript;
                this.onSearchInput(transcript);
            }
            this.cdr.markForCheck();
        };

        recognition.onerror = (event: any) => {
            this.isVoiceListening = false;
            const code = String(event?.error ?? '');
            if (code === 'not-allowed') {
                this.error = 'Microphone permission denied. Enable mic access and retry.';
            } else if (code && code !== 'aborted') {
                this.error = 'Voice search failed. Try again.';
            }
            this.cdr.markForCheck();
        };

        recognition.onend = () => {
            if (!this.isVoiceListening) {
                return;
            }
            this.isVoiceListening = false;
            this.cdr.markForCheck();
        };

        this.speechRecognition = recognition;
        this.isVoiceSearchSupported = true;
    }

    private stopVoiceSearch(): void {
        if (!this.speechRecognition) {
            this.isVoiceListening = false;
            this.cdr.markForCheck();
            return;
        }

        try {
            this.speechRecognition.stop();
        } catch {
            // Stop can throw if recognition is not active.
        }
        this.isVoiceListening = false;
        this.cdr.markForCheck();
    }

    private disposeVoiceSearch(): void {
        if (!this.speechRecognition) {
            return;
        }

        this.speechRecognition.onresult = null;
        this.speechRecognition.onerror = null;
        this.speechRecognition.onend = null;
        try {
            this.speechRecognition.stop();
        } catch {
            // Ignore stop failures on cleanup.
        }
        this.speechRecognition = null;
        this.isVoiceListening = false;
    }

    private loadGenres(): void {
        this.genreService.getAllGenres().subscribe({
            next: (data) => {
                this.genres = data ?? [];
                this.cdr.markForCheck();
            },
            error: () => {
                this.genres = [];
                this.cdr.markForCheck();
            }
        });
    }

    private fetchSearchResults(): void {
        this.resetSelectedAlbumState();
        this.hasListenerBackendAccess = this.canUseListenerBackend(this.authService.getCurrentUserSnapshot());
        if (!this.hasListenerBackendAccess) {
            this.searchApiBlocked = true;
        }

        const term = this.searchQuery.trim();
        if (!term) {
            if (!this.hasListenerBackendAccess) {
                this.loadFallbackOnlyResults();
                return;
            }
            this.fetchDefaultResultsByFilter();
            return;
        }

        this.isLoading = true;
        this.error = null;
        this.cdr.markForCheck();

        if (this.selectedFilter === 'PLAYLIST') {
            if (!this.hasListenerBackendAccess) {
                this.setEmptyPlaylistResults();
                return;
            }
            this.searchPlaylistsOnly(term);
            return;
        }

        if (!this.hasListenerBackendAccess) {
            this.searchUsingFallbackCatalog(term, this.selectedFilter === 'ALL' ? 'ALL' : this.selectedFilter);
            return;
        }

        if (this.selectedFilter === 'ALL') {
            this.searchAllGrouped(term);
            return;
        }

        this.searchBySingleType(term, this.selectedFilter);
    }

    private fetchDefaultResultsByFilter(): void {
        this.isLoading = true;
        this.error = null;
        this.cdr.markForCheck();

        if (this.selectedFilter === 'SONG') {
            forkJoin({
                browse: this.browseService.getBrowseSongs().pipe(
                    map((response) => this.mapBrowseSongsAsSearchItems(this.extractContentArray(response))),
                    catchError(() => of([]))
                ),
                fallbackSearch: this.apiService.get<any>(
                    `/search?q=${encodeURIComponent(this.defaultSeedTerm)}&type=SONG&page=0&size=${this.pagination.size}`
                ).pipe(
                    map((response) => this.extractContentArray(response)),
                    catchError(() => of([]))
                )
            }).subscribe({
                next: ({ browse, fallbackSearch }) => {
                    const normalizedSongs = this.mergeSearchItems([
                        ...this.normalizeSearchItems(browse, 'SONG'),
                        ...this.normalizeSearchItems(fallbackSearch, 'SONG')
                    ]).filter((item) => item.type === 'SONG');

                    this.groupedResults = {
                        songs: normalizedSongs,
                        artists: [],
                        albums: [],
                        podcasts: [],
                        playlists: []
                    };
                    this.enrichSongAndAlbumSearchResults();
                    this.pagination = {
                        page: 0,
                        size: this.pagination.size,
                        totalElements: normalizedSongs.length,
                        totalPages: normalizedSongs.length > 0 ? 1 : 0
                    };
                    this.isLoading = false;
                    this.cdr.markForCheck();
                },
                error: () => {
                    this.isLoading = false;
                    this.error = 'Failed to load default songs.';
                    this.cdr.markForCheck();
                }
            });
            return;
        }

        if (this.selectedFilter === 'PLAYLIST') {
            this.groupedResults = {
                songs: [],
                artists: [],
                albums: [],
                podcasts: [],
                playlists: []
            };
            this.pagination = {
                page: 0,
                size: this.pagination.size,
                totalElements: 0,
                totalPages: 0
            };
            this.isLoading = false;
            this.cdr.markForCheck();
            return;
        }

        if (this.selectedFilter === 'ARTIST') {
            forkJoin({
                artists: this.browseService.getTopArtists().pipe(
                    map((response) => this.mapTopArtistsAsSearchItems(this.extractContentArray(response))),
                    catchError(() => of([]))
                ),
                songs: forkJoin({
                    browse: this.browseService.getBrowseSongs().pipe(
                        map((response) => this.mapBrowseSongsAsSearchItems(this.extractContentArray(response))),
                        catchError(() => of([]))
                    ),
                    seeded: this.apiService.get<any>(
                        `/search?q=${encodeURIComponent(this.defaultSeedTerm)}&type=SONG&page=0&size=${this.pagination.size}`
                    ).pipe(
                        map((response) => this.extractContentArray(response)),
                        catchError(() => of([]))
                    )
                }).pipe(
                    map(({ browse, seeded }) => this.mergeSearchItems([
                        ...this.normalizeSearchItems(browse, 'SONG').filter((item) => item.type === 'SONG'),
                        ...this.normalizeSearchItems(seeded, 'SONG').filter((item) => item.type === 'SONG')
                    ])),
                    catchError(() => of([]))
                ),
                creatorCatalog: this.loadCreatorFallbackCatalog().pipe(
                    catchError(() => of({ artists: [], songs: [], podcasts: [] }))
                )
            }).subscribe(({ artists, songs, creatorCatalog }) => {
                const creator = this.toCreatorCatalog(creatorCatalog);
                const normalizedArtists = this.mergeSearchItems([
                    ...this.normalizeSearchItems(artists, 'ARTIST').filter((item) => item.type === 'ARTIST'),
                    ...this.normalizeSearchItems(creator.artists, 'ARTIST').filter((item) => item.type === 'ARTIST'),
                    ...this.normalizeSearchItems(this.deriveArtistsFromContent([
                        ...(songs ?? []),
                        ...(creator.songs ?? []),
                        ...(creator.podcasts ?? [])
                    ]), 'ARTIST').filter((item) => item.type === 'ARTIST')
                ]);
                this.groupedResults = {
                    songs: [],
                    artists: normalizedArtists,
                    albums: [],
                    podcasts: [],
                    playlists: []
                };
                this.enrichArtistSearchResults();
                this.pagination = {
                    page: 0,
                    size: this.pagination.size,
                    totalElements: normalizedArtists.length,
                    totalPages: normalizedArtists.length > 0 ? 1 : 0
                };
                this.isLoading = false;
                this.cdr.markForCheck();
            });
            return;
        }

        if (this.selectedFilter === 'PODCAST') {
            forkJoin({
                popular: this.browseService.getPopularPodcasts().pipe(catchError(() => of({ content: [] }))),
                recommended: this.browseService.getRecommendedPodcasts(0, this.pagination.size).pipe(catchError(() => of({ content: [] })))
            }).pipe(
                map(({ popular, recommended }) => this.mapPodcastsAsSearchItems([
                    ...this.extractContentArray(popular),
                    ...this.extractContentArray(recommended)
                ])),
                catchError(() => of([]))
            ).subscribe((podcasts) => {
                const normalizedPodcasts = this.normalizeSearchItems(podcasts, 'PODCAST')
                    .filter((item) => item.type === 'PODCAST');
                this.groupedResults = {
                    songs: [],
                    artists: [],
                    albums: [],
                    podcasts: normalizedPodcasts,
                    playlists: []
                };
                this.enrichPodcastSearchResults();
                this.pagination = {
                    page: 0,
                    size: this.pagination.size,
                    totalElements: normalizedPodcasts.length,
                    totalPages: normalizedPodcasts.length > 0 ? 1 : 0
                };
                this.isLoading = false;
                this.cdr.markForCheck();
            });
            return;
        }

        if (this.selectedFilter === 'ALBUM') {
            forkJoin({
                fallbackAlbums: this.loadCreatorFallbackCatalog().pipe(
                    map((catalog: any) => catalog?.albums ?? []),
                    catchError(() => of([]))
                ),
                seededSearch: this.apiService.get<any>(
                    `/search?q=${encodeURIComponent(this.defaultSeedTerm)}&type=ALBUM&page=0&size=${this.pagination.size}`
                ).pipe(
                    map((response) => this.extractContentArray(response)),
                    catchError(() => of([]))
                )
            }).subscribe({
                next: ({ fallbackAlbums, seededSearch }) => {
                    const creatorAlbums = Array.isArray(fallbackAlbums) ? fallbackAlbums : [];
                    const normalizedAlbums = this.rankByTerm(
                        this.mergeSearchItems([
                            ...this.normalizeSearchItems(seededSearch ?? [], 'ALBUM'),
                            ...this.normalizeSearchItems(creatorAlbums, 'ALBUM')
                        ]),
                        '',
                        ['title', 'subtitle']
                    );
                    this.groupedResults = {
                        songs: [],
                        artists: [],
                        albums: normalizedAlbums,
                        podcasts: [],
                        playlists: []
                    };
                    this.enrichSongAndAlbumSearchResults();
                    this.pagination = {
                        page: 0,
                        size: this.pagination.size,
                        totalElements: normalizedAlbums.length,
                        totalPages: normalizedAlbums.length > 0 ? 1 : 0
                    };
                    this.isLoading = false;
                    this.cdr.markForCheck();
                },
                error: () => {
                    this.groupedResults = {
                        songs: [],
                        artists: [],
                        albums: [],
                        podcasts: [],
                        playlists: []
                    };
                    this.pagination = {
                        page: 0,
                        size: this.pagination.size,
                        totalElements: 0,
                        totalPages: 0
                    };
                    this.isLoading = false;
                    this.cdr.markForCheck();
                }
            });
            return;
        }

        forkJoin({
            songs: forkJoin({
                browse: this.browseService.getBrowseSongs().pipe(
                    map((response) => this.mapBrowseSongsAsSearchItems(this.extractContentArray(response))),
                    catchError(() => of([]))
                ),
                fallbackSearch: this.apiService.get<any>(
                    `/search?q=${encodeURIComponent(this.defaultSeedTerm)}&type=SONG&page=0&size=${this.pagination.size}`
                ).pipe(
                    map((response) => this.extractContentArray(response)),
                    catchError(() => of([]))
                )
            }).pipe(
                map(({ browse, fallbackSearch }) => this.mergeSearchItems([
                    ...this.normalizeSearchItems(browse, 'SONG'),
                    ...this.normalizeSearchItems(fallbackSearch, 'SONG')
                ])),
                catchError(() => of([]))
            ),
            artists: this.browseService.getTopArtists().pipe(
                map((response) => this.mapTopArtistsAsSearchItems(this.extractContentArray(response))),
                catchError(() => of([]))
            ),
            podcasts: forkJoin({
                popular: this.browseService.getPopularPodcasts().pipe(catchError(() => of({ content: [] }))),
                recommended: this.browseService.getRecommendedPodcasts(0, this.pagination.size).pipe(catchError(() => of({ content: [] })))
            }).pipe(
                map(({ popular, recommended }) => this.mapPodcastsAsSearchItems([
                    ...this.extractContentArray(popular),
                    ...this.extractContentArray(recommended)
                ])),
                catchError(() => of([]))
            ),
            creatorCatalog: this.loadCreatorFallbackCatalog()
        }).subscribe({
            next: ({ songs, artists, podcasts, creatorCatalog }) => {
                const creator = this.toCreatorCatalog(creatorCatalog);
                const normalizedSongs = this.mergeSearchItems([
                    ...this.normalizeSearchItems(songs ?? [], 'SONG'),
                    ...this.normalizeSearchItems(creator.songs, 'SONG')
                ]).filter((item) => item.type === 'SONG');

                const normalizedArtists = this.mergeSearchItems([
                    ...this.normalizeSearchItems(artists ?? [], 'ARTIST'),
                    ...this.normalizeSearchItems(creator.artists, 'ARTIST'),
                    ...this.normalizeSearchItems((creator.songs ?? []).map((song: any) => ({
                        artistId: song?.artistId,
                        id: song?.artistId,
                        title: song?.artistName ?? song?.artistDisplayName ?? '',
                        artistName: song?.artistName ?? song?.artistDisplayName ?? '',
                        type: 'ARTIST'
                    })), 'ARTIST'),
                    ...this.normalizeSearchItems(this.deriveArtistsFromContent([
                        ...normalizedSongs,
                        ...creator.songs,
                        ...creator.podcasts
                    ]), 'ARTIST')
                ]).filter((item) => item.type === 'ARTIST');

                const normalizedPodcasts = this.mergeSearchItems([
                    ...this.normalizeSearchItems(podcasts ?? [], 'PODCAST'),
                    ...this.normalizeSearchItems(creator.podcasts, 'PODCAST')
                ]).filter((item) => item.type === 'PODCAST');

                this.groupedResults = {
                    songs: normalizedSongs,
                    artists: normalizedArtists,
                    albums: [],
                    podcasts: normalizedPodcasts,
                    playlists: []
                };
                this.enrichSongAndAlbumSearchResults();
                this.enrichArtistSearchResults();
                this.enrichPodcastSearchResults();

                this.pagination = {
                    page: 0,
                    size: this.pagination.size,
                    totalElements: normalizedSongs.length + normalizedArtists.length + normalizedPodcasts.length,
                    totalPages: (normalizedSongs.length + normalizedArtists.length + normalizedPodcasts.length) > 0 ? 1 : 0
                };
                this.isLoading = false;
                this.cdr.markForCheck();
            },
            error: () => {
                this.isLoading = false;
                this.error = 'Failed to load default discovery results.';
                this.cdr.markForCheck();
            }
        });
    }

    private searchAllGrouped(term: string): void {
        if (this.searchApiBlocked) {
            this.searchUsingFallbackCatalog(term, 'ALL');
            return;
        }

        const encodedTerm = encodeURIComponent(term);
        const page = this.pagination.page;
        const size = this.pagination.size;

        const broadReq = this.apiService.get<any>(
            `/search?q=${encodedTerm}&page=${page}&size=${size}`
        ).pipe(catchError((err) => this.handleSearchEndpointError(err, page, size)));

        const songsReq = this.apiService.get<any>(
            `/search?q=${encodedTerm}&type=SONG&page=${page}&size=${size}`
        ).pipe(catchError((err) => this.handleSearchEndpointError(err, page, size)));

        const artistsReq = this.apiService.get<any>(
            `/search?q=${encodedTerm}&type=ARTIST&page=${page}&size=${size}`
        ).pipe(catchError((err) => this.handleSearchEndpointError(err, page, size)));

        const albumsReq = this.apiService.get<any>(
            `/search?q=${encodedTerm}&type=ALBUM&page=${page}&size=${size}`
        ).pipe(catchError((err) => this.handleSearchEndpointError(err, page, size)));

        const podcastsReq = this.apiService.get<any>(
            `/search?q=${encodedTerm}&type=PODCAST&page=${page}&size=${size}`
        ).pipe(catchError((err) => this.handleSearchEndpointError(err, page, size)));

        const playlistsReq = this.apiService.get<any>(
            `/search/playlists?keyword=${encodedTerm}&page=${page}&size=${size}`
        ).pipe(catchError((err) => this.handleSearchEndpointError(err, page, size)));

        const fallbackSongsReq = this.browseService.getBrowseSongs().pipe(
            map((response) => this.mapBrowseSongsAsSearchItems(this.extractContentArray(response))),
            catchError(() => of([]))
        );

        const fallbackArtistsReq = this.browseService.getTopArtists().pipe(
            map((response) => this.mapTopArtistsAsSearchItems(this.extractContentArray(response))),
            catchError(() => of([]))
        );

        const fallbackPodcastsReq = forkJoin({
            popular: this.browseService.getPopularPodcasts().pipe(catchError(() => of({ content: [] }))),
            recommended: this.browseService.getRecommendedPodcasts(0, size).pipe(catchError(() => of({ content: [] })))
        }).pipe(
            map(({ popular, recommended }) => this.mapPodcastsAsSearchItems([
                ...this.extractContentArray(popular),
                ...this.extractContentArray(recommended)
            ])),
            catchError(() => of([]))
        );
        const creatorCatalogReq = this.loadCreatorFallbackCatalog().pipe(
            catchError(() => of({ songs: [], artists: [], albums: [], podcasts: [] }))
        );

        forkJoin({
            broad: broadReq,
            songs: songsReq,
            artists: artistsReq,
            albums: albumsReq,
            podcasts: podcastsReq,
            playlists: playlistsReq,
            fallbackSongs: fallbackSongsReq,
            fallbackArtists: fallbackArtistsReq,
            fallbackPodcasts: fallbackPodcastsReq,
            creatorCatalog: creatorCatalogReq
        }).subscribe({
            next: ({ broad, songs, artists, albums, podcasts, playlists, fallbackSongs, fallbackArtists, fallbackPodcasts, creatorCatalog }) => {
                const creator = this.toCreatorCatalog(creatorCatalog);
                const broadItems = this.normalizeSearchItems(broad?.content ?? []);

                const normalizedSongs = this.rankByTerm(
                    this.mergeSearchItems([
                        ...this.normalizeSearchItems(songs?.content ?? [], 'SONG').filter((item) => item.type === 'SONG'),
                        ...broadItems.filter((item) => item.type === 'SONG'),
                        ...this.normalizeSearchItems(fallbackSongs ?? [], 'SONG').filter((item) => item.type === 'SONG'),
                        ...this.normalizeSearchItems(creator.songs, 'SONG').filter((item) => item.type === 'SONG')
                    ]),
                    term,
                    ['title', 'subtitle', 'artistName']
                );
                const normalizedArtists = this.rankByTerm(
                    this.mergeSearchItems([
                        ...this.normalizeSearchItems(artists?.content ?? [], 'ARTIST').filter((item) => item.type === 'ARTIST'),
                        ...broadItems.filter((item) => item.type === 'ARTIST'),
                        ...this.normalizeSearchItems(fallbackArtists ?? [], 'ARTIST').filter((item) => item.type === 'ARTIST'),
                        ...this.normalizeSearchItems(creator.artists, 'ARTIST').filter((item) => item.type === 'ARTIST'),
                        ...this.normalizeSearchItems(this.deriveArtistsFromContent([
                            ...normalizedSongs,
                            ...this.normalizeSearchItems(broad?.content ?? []).filter((item) => item.type === 'SONG' || item.type === 'PODCAST' || item.type === 'EPISODE'),
                            ...creator.songs,
                            ...creator.podcasts
                        ]), 'ARTIST').filter((item) => item.type === 'ARTIST')
                    ]),
                    term,
                    ['title', 'subtitle']
                );
                const normalizedAlbums = this.rankByTerm(
                    this.mergeSearchItems([
                        ...this.normalizeSearchItems(albums?.content ?? [], 'ALBUM').filter((item) => item.type === 'ALBUM'),
                        ...broadItems.filter((item) => item.type === 'ALBUM'),
                        ...this.normalizeSearchItems(creator.albums, 'ALBUM').filter((item) => item.type === 'ALBUM')
                    ]),
                    term,
                    ['title', 'subtitle']
                );
                const normalizedPodcasts = this.rankByTerm(
                    this.mergeSearchItems([
                        ...this.normalizeSearchItems(podcasts?.content ?? [], 'PODCAST').filter((item) => item.type === 'PODCAST'),
                        ...broadItems.filter((item) => item.type === 'PODCAST'),
                        ...this.normalizeSearchItems(fallbackPodcasts ?? [], 'PODCAST').filter((item) => item.type === 'PODCAST'),
                        ...this.normalizeSearchItems(creator.podcasts, 'PODCAST').filter((item) => item.type === 'PODCAST')
                    ]),
                    term,
                    ['title', 'subtitle']
                );
                const normalizedPlaylists = this.rankByTerm(
                    this.mapPlaylists(playlists?.content ?? []),
                    term,
                    ['name', 'description']
                );

                this.groupedResults = {
                    songs: normalizedSongs,
                    artists: normalizedArtists,
                    albums: normalizedAlbums,
                    podcasts: normalizedPodcasts,
                    playlists: normalizedPlaylists
                };
                this.enrichSongAndAlbumSearchResults();
                this.enrichArtistSearchResults();
                this.enrichPodcastSearchResults();
                this.pagination = {
                    page,
                    size,
                    totalElements: normalizedSongs.length + normalizedArtists.length + normalizedAlbums.length + normalizedPodcasts.length + normalizedPlaylists.length,
                    totalPages: Math.max(
                        Number(broad?.totalPages ?? 0),
                        Number(songs?.totalPages ?? 0),
                        Number(artists?.totalPages ?? 0),
                        Number(albums?.totalPages ?? 0),
                        Number(podcasts?.totalPages ?? 0),
                        Number(playlists?.totalPages ?? 0),
                        (normalizedSongs.length + normalizedArtists.length + normalizedAlbums.length + normalizedPodcasts.length + normalizedPlaylists.length) > 0 ? 1 : 0
                    )
                };
                this.isLoading = false;
                this.cdr.markForCheck();
            },
            error: () => {
                this.isLoading = false;
                this.error = 'Search failed. Please try again.';
                this.cdr.markForCheck();
            }
        });
    }

    private searchBySingleType(term: string, filter: Exclude<SearchFilter, 'ALL' | 'PLAYLIST'>): void {
        if (this.searchApiBlocked) {
            this.searchUsingFallbackCatalog(term, filter);
            return;
        }

        const page = this.pagination.page;
        const size = this.pagination.size;
        const encodedTerm = encodeURIComponent(term);

        const typedReq = this.apiService.get<any>(
            `/search?q=${encodedTerm}&type=${filter}&page=${page}&size=${size}`
        ).pipe(catchError((err) => this.handleSearchEndpointError(err, page, size)));

        const broadReq = this.apiService.get<any>(
            `/search?q=${encodedTerm}&page=${page}&size=${size}`
        ).pipe(catchError((err) => this.handleSearchEndpointError(err, page, size)));

        if (filter === 'SONG') {
            const fallbackSongsReq = this.browseService.getBrowseSongs().pipe(
                map((response) => this.mapBrowseSongsAsSearchItems(this.extractContentArray(response))),
                catchError(() => of([]))
            );
            const creatorCatalogReq = this.loadCreatorFallbackCatalog().pipe(
                catchError(() => of({ songs: [] }))
            );

            forkJoin({ typed: typedReq, broad: broadReq, fallbackSongs: fallbackSongsReq, creatorCatalog: creatorCatalogReq }).subscribe({
                next: ({ typed, broad, fallbackSongs, creatorCatalog }) => {
                    const creator = this.toCreatorCatalog(creatorCatalog);
                    const mergedSongs = this.mergeSearchItems([
                        ...this.normalizeSearchItems(typed?.content ?? [], 'SONG').filter((item) => item.type === 'SONG'),
                        ...this.normalizeSearchItems(broad?.content ?? []).filter((item) => item.type === 'SONG'),
                        ...this.normalizeSearchItems(fallbackSongs ?? [], 'SONG').filter((item) => item.type === 'SONG'),
                        ...this.normalizeSearchItems(creator.songs, 'SONG').filter((item) => item.type === 'SONG')
                    ]);

                    this.groupedResults = {
                        songs: this.rankByTerm(mergedSongs, term, ['title', 'subtitle', 'artistName']),
                        artists: [],
                        albums: [],
                        podcasts: [],
                        playlists: []
                    };
                    this.enrichSongAndAlbumSearchResults();
                    this.pagination = {
                        page,
                        size,
                        totalElements: this.groupedResults.songs.length,
                        totalPages: this.groupedResults.songs.length > 0 ? 1 : 0
                    };
                    this.isLoading = false;
                    this.cdr.markForCheck();
                },
                error: () => {
                    this.isLoading = false;
                    this.error = 'Search failed. Please try again.';
                    this.cdr.markForCheck();
                }
            });
            return;
        }

        if (filter === 'ARTIST') {
            const fallbackArtistsReq = this.browseService.getTopArtists().pipe(
                map((response) => this.mapTopArtistsAsSearchItems(this.extractContentArray(response))),
                catchError(() => of([]))
            );
            const creatorCatalogReq = this.loadCreatorFallbackCatalog().pipe(
                catchError(() => of({ artists: [], songs: [] }))
            );

            forkJoin({ typed: typedReq, broad: broadReq, fallbackArtists: fallbackArtistsReq, creatorCatalog: creatorCatalogReq }).subscribe({
                next: ({ typed, broad, fallbackArtists, creatorCatalog }) => {
                    const creator = this.toCreatorCatalog(creatorCatalog);
                    const mergedArtists = this.mergeSearchItems([
                        ...this.normalizeSearchItems(typed?.content ?? [], 'ARTIST').filter((item) => item.type === 'ARTIST'),
                        ...this.normalizeSearchItems(broad?.content ?? []).filter((item) => item.type === 'ARTIST'),
                        ...this.normalizeSearchItems(fallbackArtists ?? [], 'ARTIST').filter((item) => item.type === 'ARTIST'),
                        ...this.normalizeSearchItems(creator.artists, 'ARTIST').filter((item) => item.type === 'ARTIST'),
                        ...this.normalizeSearchItems((creator.songs ?? []).map((song: any) => ({
                            artistId: song?.artistId,
                            id: song?.artistId,
                            title: song?.artistName ?? song?.artistDisplayName ?? '',
                            artistName: song?.artistName ?? song?.artistDisplayName ?? '',
                            type: 'ARTIST'
                        })), 'ARTIST').filter((item) => item.type === 'ARTIST'),
                        ...this.normalizeSearchItems(this.deriveArtistsFromContent([
                            ...this.normalizeSearchItems(typed?.content ?? []).filter((item) => item.type === 'SONG' || item.type === 'PODCAST' || item.type === 'EPISODE'),
                            ...this.normalizeSearchItems(broad?.content ?? []).filter((item) => item.type === 'SONG' || item.type === 'PODCAST' || item.type === 'EPISODE'),
                            ...creator.songs,
                            ...creator.podcasts
                        ]), 'ARTIST').filter((item) => item.type === 'ARTIST')
                    ]);

                    this.groupedResults = {
                        songs: [],
                        artists: this.rankByTerm(mergedArtists, term, ['title', 'subtitle']),
                        albums: [],
                        podcasts: [],
                        playlists: []
                    };
                    this.enrichArtistSearchResults();
                    this.pagination = {
                        page,
                        size,
                        totalElements: this.groupedResults.artists.length,
                        totalPages: this.groupedResults.artists.length > 0 ? 1 : 0
                    };
                    this.isLoading = false;
                    this.cdr.markForCheck();
                },
                error: () => {
                    this.isLoading = false;
                    this.error = 'Search failed. Please try again.';
                    this.cdr.markForCheck();
                }
            });
            return;
        }

        if (filter === 'PODCAST') {
            const fallbackPodcastsReq = forkJoin({
                popular: this.browseService.getPopularPodcasts().pipe(catchError(() => of({ content: [] }))),
                recommended: this.browseService.getRecommendedPodcasts(0, size).pipe(catchError(() => of({ content: [] })))
            }).pipe(
                map(({ popular, recommended }) => this.mapPodcastsAsSearchItems([
                    ...this.extractContentArray(popular),
                    ...this.extractContentArray(recommended)
                ])),
                catchError(() => of([]))
            );
            const creatorCatalogReq = this.loadCreatorFallbackCatalog().pipe(
                catchError(() => of({ podcasts: [] }))
            );

            forkJoin({ typed: typedReq, broad: broadReq, fallbackPodcasts: fallbackPodcastsReq, creatorCatalog: creatorCatalogReq }).subscribe({
                next: ({ typed, broad, fallbackPodcasts, creatorCatalog }) => {
                    const creator = this.toCreatorCatalog(creatorCatalog);
                    const mergedPodcasts = this.mergeSearchItems([
                        ...this.normalizeSearchItems(typed?.content ?? [], 'PODCAST').filter((item) => item.type === 'PODCAST'),
                        ...this.normalizeSearchItems(broad?.content ?? []).filter((item) => item.type === 'PODCAST'),
                        ...this.normalizeSearchItems(fallbackPodcasts ?? [], 'PODCAST').filter((item) => item.type === 'PODCAST'),
                        ...this.normalizeSearchItems(creator.podcasts, 'PODCAST').filter((item) => item.type === 'PODCAST')
                    ]);

                    this.groupedResults = {
                        songs: [],
                        artists: [],
                        albums: [],
                        podcasts: this.rankByTerm(mergedPodcasts, term, ['title', 'subtitle']),
                        playlists: []
                    };
                    this.enrichPodcastSearchResults();
                    this.pagination = {
                        page,
                        size,
                        totalElements: this.groupedResults.podcasts.length,
                        totalPages: this.groupedResults.podcasts.length > 0 ? 1 : 0
                    };
                    this.isLoading = false;
                    this.cdr.markForCheck();
                },
                error: () => {
                    this.isLoading = false;
                    this.error = 'Search failed. Please try again.';
                    this.cdr.markForCheck();
                }
            });
            return;
        }

        const creatorCatalogReq = this.loadCreatorFallbackCatalog().pipe(
            catchError(() => of({ albums: [] }))
        );
        forkJoin({ typed: typedReq, broad: broadReq, creatorCatalog: creatorCatalogReq }).subscribe({
            next: ({ typed, broad, creatorCatalog }) => {
                const creator = this.toCreatorCatalog(creatorCatalog);
                const mergedAlbums = this.mergeSearchItems([
                    ...this.normalizeSearchItems(typed?.content ?? [], 'ALBUM').filter((item) => item.type === 'ALBUM'),
                    ...this.normalizeSearchItems(broad?.content ?? []).filter((item) => item.type === 'ALBUM'),
                    ...this.normalizeSearchItems(creator.albums, 'ALBUM').filter((item) => item.type === 'ALBUM')
                ]);
                this.groupedResults = {
                    songs: [],
                    artists: [],
                    albums: this.rankByTerm(mergedAlbums, term, ['title', 'subtitle']),
                    podcasts: [],
                    playlists: []
                };
                this.enrichSongAndAlbumSearchResults();
                this.pagination = {
                    page,
                    size,
                    totalElements: this.groupedResults.albums.length,
                    totalPages: this.groupedResults.albums.length > 0 ? 1 : 0
                };
                this.isLoading = false;
                this.cdr.markForCheck();
            },
            error: () => {
                this.isLoading = false;
                this.error = 'Search failed. Please try again.';
                this.cdr.markForCheck();
            }
        });
    }

    private searchPlaylistsOnly(term: string): void {
        if (this.searchApiBlocked) {
            this.groupedResults = {
                songs: [],
                artists: [],
                albums: [],
                podcasts: [],
                playlists: []
            };
            this.pagination = {
                page: 0,
                size: this.pagination.size,
                totalElements: 0,
                totalPages: 0
            };
            this.isLoading = false;
            this.cdr.markForCheck();
            return;
        }

        this.apiService.get<any>(
            `/search/playlists?keyword=${encodeURIComponent(term)}&page=${this.pagination.page}&size=${this.pagination.size}`
        ).subscribe({
            next: (response) => {
                this.groupedResults = {
                    songs: [],
                    artists: [],
                    albums: [],
                    podcasts: [],
                    playlists: this.rankByTerm(this.mapPlaylists(response?.content ?? []), term, ['name', 'description'])
                };
                this.pagination = {
                    page: Number(response?.page ?? this.pagination.page ?? 0),
                    size: Number(response?.size ?? this.pagination.size),
                    totalElements: Number(response?.totalElements ?? 0),
                    totalPages: Number(response?.totalPages ?? 0)
                };
                this.isLoading = false;
                this.cdr.markForCheck();
            },
            error: () => {
                this.searchApiBlocked = true;
                this.isLoading = false;
                this.error = 'Playlist search failed. Please try again.';
                this.cdr.markForCheck();
            }
        });
    }

    private searchUsingFallbackCatalog(term: string, filter: Exclude<SearchFilter, 'PLAYLIST'>): void {
        const size = this.pagination.size;
        const songsReq = this.hasListenerBackendAccess
            ? this.browseService.getBrowseSongs().pipe(
                map((response) => this.mapBrowseSongsAsSearchItems(this.extractContentArray(response))),
                catchError(() => of([]))
            )
            : of([]);
        const artistsReq = this.hasListenerBackendAccess
            ? this.browseService.getTopArtists().pipe(
                map((response) => this.mapTopArtistsAsSearchItems(this.extractContentArray(response))),
                catchError(() => of([]))
            )
            : of([]);
        const podcastsReq = this.hasListenerBackendAccess
            ? forkJoin({
                popular: this.browseService.getPopularPodcasts().pipe(catchError(() => of({ content: [] }))),
                recommended: this.browseService.getRecommendedPodcasts(0, size).pipe(catchError(() => of({ content: [] })))
            }).pipe(
                map(({ popular, recommended }) => this.mapPodcastsAsSearchItems([
                    ...this.extractContentArray(popular),
                    ...this.extractContentArray(recommended)
                ])),
                catchError(() => of([]))
            )
            : of([]);
        const creatorCatalogReq = this.loadCreatorFallbackCatalog().pipe(
            catchError(() => of({ songs: [], artists: [], albums: [], podcasts: [] }))
        );

        forkJoin({ songs: songsReq, artists: artistsReq, podcasts: podcastsReq, creatorCatalog: creatorCatalogReq }).subscribe({
            next: ({ songs, artists, podcasts, creatorCatalog }) => {
                const creator = this.toCreatorCatalog(creatorCatalog);
                const normalizedSongs = this.rankByTerm(
                    this.mergeSearchItems([
                        ...this.normalizeSearchItems(songs, 'SONG'),
                        ...this.normalizeSearchItems(creator.songs, 'SONG')
                    ]).filter((item) => item.type === 'SONG'),
                    term,
                    ['title', 'subtitle', 'artistName']
                );
                const normalizedPodcasts = this.rankByTerm(
                    this.mergeSearchItems([
                        ...this.normalizeSearchItems(podcasts, 'PODCAST'),
                        ...this.normalizeSearchItems(creator.podcasts, 'PODCAST')
                    ]).filter((item) => item.type === 'PODCAST'),
                    term,
                    ['title', 'subtitle']
                );
                const normalizedArtists = this.rankByTerm(
                    this.mergeSearchItems([
                        ...this.normalizeSearchItems(artists, 'ARTIST'),
                        ...this.normalizeSearchItems(creator.artists, 'ARTIST'),
                        ...this.normalizeSearchItems((creator.songs ?? []).map((song: any) => ({
                            artistId: song?.artistId,
                            id: song?.artistId,
                            title: song?.artistName ?? song?.artistDisplayName ?? '',
                            artistName: song?.artistName ?? song?.artistDisplayName ?? '',
                            type: 'ARTIST'
                        })), 'ARTIST'),
                        ...this.normalizeSearchItems(this.deriveArtistsFromContent([
                            ...normalizedSongs,
                            ...normalizedPodcasts,
                            ...creator.songs,
                            ...creator.podcasts
                        ]), 'ARTIST')
                    ]).filter((item) => item.type === 'ARTIST'),
                    term,
                    ['title', 'subtitle']
                );
                const normalizedAlbums = this.rankByTerm(
                    this.mergeSearchItems([
                        ...this.normalizeSearchItems(creator.albums, 'ALBUM')
                    ]).filter((item) => item.type === 'ALBUM'),
                    term,
                    ['title', 'subtitle']
                );

                this.groupedResults = {
                    songs: filter === 'ALL' || filter === 'SONG' ? normalizedSongs : [],
                    artists: filter === 'ALL' || filter === 'ARTIST' ? normalizedArtists : [],
                    albums: filter === 'ALL' || filter === 'ALBUM' ? normalizedAlbums : [],
                    podcasts: filter === 'ALL' || filter === 'PODCAST' ? normalizedPodcasts : [],
                    playlists: []
                };
                this.enrichArtistSearchResults();
                this.enrichPodcastSearchResults();
                this.pagination = {
                    page: 0,
                    size: this.pagination.size,
                    totalElements:
                        this.groupedResults.songs.length +
                        this.groupedResults.artists.length +
                        this.groupedResults.albums.length +
                        this.groupedResults.podcasts.length,
                    totalPages:
                        (this.groupedResults.songs.length +
                            this.groupedResults.artists.length +
                            this.groupedResults.albums.length +
                            this.groupedResults.podcasts.length) > 0 ? 1 : 0
                };
                this.isLoading = false;
                this.cdr.markForCheck();
            },
            error: () => {
                this.isLoading = false;
                this.error = 'Search failed. Please try again.';
                this.cdr.markForCheck();
            }
        });
    }

    private loadFallbackOnlyResults(): void {
        if (this.selectedFilter === 'PLAYLIST') {
            this.setEmptyPlaylistResults();
            return;
        }

        this.isLoading = true;
        this.error = null;
        this.searchUsingFallbackCatalog('', this.selectedFilter === 'ALL' ? 'ALL' : this.selectedFilter);
    }

    private setEmptyPlaylistResults(): void {
        this.groupedResults = {
            songs: [],
            artists: [],
            albums: [],
            podcasts: [],
            playlists: []
        };
        this.pagination = {
            page: 0,
            size: this.pagination.size,
            totalElements: 0,
            totalPages: 0
        };
        this.isLoading = false;
        this.cdr.markForCheck();
    }

    private canUseListenerBackend(user: any): boolean {
        return hasAnyRole(user, ['LISTENER', 'ARTIST', 'ADMIN']);
    }

    private handleSearchEndpointError(err: any, page: number, size: number): any {
        if (this.isForbiddenError(err)) {
            this.searchApiBlocked = true;
        }
        return of({ content: [], totalElements: 0, totalPages: 0, page, size });
    }

    private isForbiddenError(err: any): boolean {
        const status = Number(err?.status ?? 0);
        return status === 401 || status === 403;
    }

    private buildGroupedResults(items: any[], playlists: any[], term: string = ''): any {
        const normalizedItems = this.normalizeSearchItems(items);
        const normalizedPlaylists = this.mapPlaylists(playlists);

        return {
            songs: this.rankByTerm(normalizedItems.filter((item) => item.type === 'SONG'), term, ['title', 'subtitle', 'artistName']),
            artists: this.rankByTerm(normalizedItems.filter((item) => item.type === 'ARTIST'), term, ['title', 'subtitle']),
            albums: this.rankByTerm(normalizedItems.filter((item) => item.type === 'ALBUM'), term, ['title', 'subtitle']),
            podcasts: this.rankByTerm(normalizedItems.filter((item) => item.type === 'PODCAST'), term, ['title', 'subtitle']),
            playlists: this.rankByTerm(normalizedPlaylists, term, ['name', 'description'])
        };
    }

    private mergeSearchItems(items: any[]): any[] {
        const merged: any[] = [];
        const byKey = new Map<string, any>();
        for (const item of items ?? []) {
            const type = this.resolveSearchItemType(item);
            const id = this.resolveSearchItemId(item, type);
            if (!type || id <= 0) {
                continue;
            }
            const key = `${type}:${id}`;
            const existing = byKey.get(key);
            if (!existing) {
                byKey.set(key, item);
                merged.push(item);
                continue;
            }

            const mergedItem = {
                ...existing,
                ...item,
                title: String(existing?.title ?? '').trim() || String(item?.title ?? '').trim() || 'Untitled',
                subtitle: String(existing?.subtitle ?? '').trim() || String(item?.subtitle ?? '').trim(),
                artistName: String(existing?.artistName ?? '').trim() || String(item?.artistName ?? '').trim(),
                coverArtUrl: this.resolveSearchItemDisplayImage(existing, type) || this.resolveSearchItemDisplayImage(item, type),
                imageUrl:
                    this.resolveSearchItemDisplayImage(existing, type) ||
                    this.resolveSearchItemDisplayImage(item, type) ||
                    String(existing?.imageUrl ?? '').trim() ||
                    String(item?.imageUrl ?? '').trim()
            };

            byKey.set(key, mergedItem);
            const index = merged.findIndex((candidate) => {
                const candidateType = this.resolveSearchItemType(candidate);
                const candidateId = this.resolveSearchItemId(candidate, candidateType);
                return `${candidateType}:${candidateId}` === key;
            });
            if (index >= 0) {
                merged[index] = mergedItem;
            }
        }
        return this.dedupeArtistSearchItems(merged);
    }

    private dedupeArtistSearchItems(items: any[]): any[] {
        const artists = (items ?? []).filter((item: any) => this.resolveSearchItemType(item) === 'ARTIST');
        if (artists.length === 0) {
            return items ?? [];
        }

        const others = (items ?? []).filter((item: any) => this.resolveSearchItemType(item) !== 'ARTIST');
        const preferredByName = new Map<string, any>();
        const unnamedArtists: any[] = [];
        const orderedNames: string[] = [];

        for (const artist of artists) {
            const nameKey = this.getArtistResultNameKey(artist);
            if (!nameKey) {
                unnamedArtists.push(artist);
                continue;
            }

            const existing = preferredByName.get(nameKey);
            if (!existing) {
                preferredByName.set(nameKey, artist);
                orderedNames.push(nameKey);
                continue;
            }

            preferredByName.set(nameKey, this.pickPreferredArtistResult(existing, artist));
        }

        const namedArtists = orderedNames
            .map((nameKey) => preferredByName.get(nameKey))
            .filter((item) => !!item);
        const namedImageKeys = new Set(
            namedArtists
                .map((artist) => this.getArtistResultImageKey(artist))
                .filter((value) => !!value)
        );

        const filteredUnnamed = unnamedArtists.filter((artist) => {
            const imageKey = this.getArtistResultImageKey(artist);
            if (imageKey && namedImageKeys.has(imageKey)) {
                return false;
            }

            return namedArtists.length === 0;
        });

        return [...others, ...namedArtists, ...filteredUnnamed];
    }

    private pickPreferredArtistResult(existing: any, candidate: any): any {
        return this.getArtistResultScore(candidate) > this.getArtistResultScore(existing)
            ? { ...existing, ...candidate }
            : { ...candidate, ...existing };
    }

    private getArtistResultScore(item: any): number {
        const title = String(item?.title ?? item?.name ?? '').trim();
        const subtitle = String(item?.subtitle ?? '').trim().toLowerCase();
        const id = Number(item?.artistId ?? item?.id ?? item?.contentId ?? 0);
        let score = 0;

        if (!this.isGenericArtistResultTitle(title)) {
            score += 100;
        }
        if (subtitle === 'artist') {
            score += 20;
        }
        if (id > 0 && id < 900000000) {
            score += 15;
        }
        if (this.getArtistResultImageKey(item)) {
            score += 10;
        }

        return score;
    }

    private getArtistResultNameKey(item: any): string {
        const label = String(
            item?.title ??
            item?.displayName ??
            item?.name ??
            item?.artistName ??
            ''
        ).trim().toLowerCase();

        return this.isGenericArtistResultTitle(label) ? '' : label;
    }

    private getArtistResultImageKey(item: any): string {
        return String(item?.coverArtUrl ?? this.resolveSearchArtistImage(item) ?? '')
            .trim()
            .toLowerCase();
    }

    private isGenericArtistResultTitle(value: any): boolean {
        const label = String(value ?? '').trim().toLowerCase();
        return !label || label === 'untitled' || label === 'artist' || label === 'unknown artist' || label === 'both';
    }

    private mapBrowseSongsAsSearchItems(items: any[]): any[] {
        return (items ?? []).map((item: any) => ({
            ...item,
            type: 'SONG',
            contentId: Number(item?.songId ?? item?.contentId ?? item?.id ?? 0),
            id: Number(item?.songId ?? item?.contentId ?? item?.id ?? 0),
            title: item?.title ?? item?.name ?? 'Untitled',
            artistName: item?.artistName ?? '',
            subtitle: item?.artistName ?? item?.artistDisplayName ?? '',
            coverArtUrl: this.resolveSearchItemCover(item)
        }));
    }

    private mapTopArtistsAsSearchItems(items: any[]): any[] {
        return (items ?? []).map((item: any) => ({
            ...item,
            type: 'ARTIST',
            contentId: Number(item?.artistId ?? item?.id ?? 0),
            id: Number(item?.artistId ?? item?.id ?? 0),
            title: item?.displayName ?? item?.name ?? 'Artist',
            subtitle: item?.artistType ?? (item?.playCount ? `${item.playCount} plays` : ''),
            coverArtUrl: this.resolveSearchArtistCardImage(item)
        }));
    }

    private mapPodcastsAsSearchItems(items: any[]): any[] {
        return (items ?? []).map((item: any) => ({
            ...item,
            type: 'PODCAST',
            contentId: Number(item?.podcastId ?? item?.id ?? 0),
            id: Number(item?.podcastId ?? item?.id ?? 0),
            title: item?.title ?? item?.name ?? 'Podcast',
            subtitle: item?.description ?? '',
            coverArtUrl: this.resolvePodcastCardCover(item)
        }));
    }

    private deriveArtistsFromContent(items: any[]): any[] {
        const artists: any[] = [];
        for (const item of items ?? []) {
            const derived = this.toDerivedArtistSearchItem(item);
            if (!derived) {
                continue;
            }
            artists.push(derived);
        }
        return artists;
    }

    private toDerivedArtistSearchItem(item: any): any | null {
        const nameCandidates = [
            item?.artistName,
            item?.artistDisplayName,
            item?.artist?.displayName,
            item?.artist?.name,
            item?.uploaderName,
            item?.createdByName,
            item?.authorName,
            item?.creatorName,
            item?.ownerName,
            item?.username,
            item?.subtitle
        ];
        const title = nameCandidates
            .map((value) => String(value ?? '').trim())
            .find((value) => !!value);

        if (!title || this.isSmokeTestContent(title)) {
            return null;
        }

        const idCandidates = [
            item?.artistId,
            item?.artist?.artistId,
            item?.artist?.id,
            item?.ownerArtistId,
            item?.userId,
            item?.createdBy
        ];
        const resolvedId = idCandidates
            .map((value) => Number(value ?? 0))
            .find((value) => value > 0) ?? this.syntheticArtistId(title);
        const coverArtUrl = this.resolveSearchArtistCardImage(item, title);

        return {
            type: 'ARTIST',
            id: resolvedId,
            artistId: resolvedId,
            contentId: resolvedId,
            title,
            subtitle: String(item?.artistType ?? item?.category ?? '').trim(),
            artistName: title,
            coverArtUrl
        };
    }

    private syntheticArtistId(name: string): number {
        let hash = 0;
        for (const char of String(name ?? '')) {
            hash = ((hash * 31) + char.charCodeAt(0)) % 1000000;
        }
        return 900000000 + Math.abs(hash);
    }

    private rankByTerm<T>(items: T[], term: string, fields: string[]): T[] {
        const query = String(term ?? '').trim().toLowerCase();
        if (!query) {
            return items ?? [];
        }

        return [...(items ?? [])]
            .filter((item: any) => this.matchesTerm(item, query, fields))
            .sort((a: any, b: any) => {
                const aScore = this.getBestMatchIndex(a, query, fields);
                const bScore = this.getBestMatchIndex(b, query, fields);
                if (aScore !== bScore) {
                    return aScore - bScore;
                }
                const aLabel = String(a?.title ?? a?.name ?? '').toLowerCase();
                const bLabel = String(b?.title ?? b?.name ?? '').toLowerCase();
                return aLabel.localeCompare(bLabel);
            });
    }

    private matchesTerm(item: any, query: string, fields: string[]): boolean {
        return fields.some((field) => String(item?.[field] ?? '').toLowerCase().includes(query));
    }

    private getBestMatchIndex(item: any, query: string, fields: string[]): number {
        let best = Number.MAX_SAFE_INTEGER;
        for (const field of fields) {
            const value = String(item?.[field] ?? '').toLowerCase();
            const index = value.indexOf(query);
            if (index >= 0 && index < best) {
                best = index;
            }
        }
        return best;
    }

    private resolveSearchItemType(item: any, preferredType: string = ''): string {
        const forced = String(preferredType ?? '').trim().toUpperCase();
        if (forced && forced !== 'ALL') {
            return forced;
        }

        const rawType = String(
            item?.type ??
            item?.contentType ??
            item?.entityType ??
            item?.resultType ??
            item?.mediaType ??
            ''
        ).trim().toUpperCase();

        if (rawType === 'TRACK' || rawType === 'MUSIC_TRACK' || rawType === 'SONGS' || rawType === 'MUSIC' || rawType === 'AUDIO') {
            return 'SONG';
        }
        if (rawType === 'PODCAST_EPISODE' || rawType === 'PODCASTEPISODE') {
            return 'EPISODE';
        }
        if (['SONG', 'ARTIST', 'ALBUM', 'PODCAST', 'EPISODE', 'PLAYLIST'].includes(rawType)) {
            return rawType;
        }

        if (
            Number(item?.songId ?? item?.trackId ?? 0) > 0 ||
            item?.audioUrl ||
            item?.fileUrl ||
            item?.audioFileName ||
            item?.fileName ||
            (Number(item?.contentId ?? 0) > 0 && Number(item?.albumId ?? 0) > 0)
        ) {
            return 'SONG';
        }
        if (
            (Number(item?.artistId ?? 0) > 0 &&
                Number(item?.songId ?? item?.trackId ?? 0) <= 0 &&
                Number(item?.albumId ?? 0) <= 0 &&
                Number(item?.podcastId ?? 0) <= 0 &&
                Number(item?.contentId ?? 0) <= 0) ||
            (item?.artistType &&
                Number(item?.albumId ?? 0) <= 0 &&
                Number(item?.songId ?? item?.trackId ?? 0) <= 0 &&
                !item?.fileUrl &&
                !item?.audioUrl)
        ) {
            return 'ARTIST';
        }
        if (Number(item?.albumId ?? 0) > 0) {
            return 'ALBUM';
        }
        if (Number(item?.podcastId ?? 0) > 0) {
            return 'PODCAST';
        }
        if (Number(item?.episodeId ?? item?.podcastEpisodeId ?? 0) > 0) {
            return 'EPISODE';
        }
        if (Number(item?.playlistId ?? 0) > 0) {
            return 'PLAYLIST';
        }

        return rawType;
    }

    private resolveSearchItemId(item: any, type: string): number {
        const normalizedType = String(type ?? '').toUpperCase();
        const byType: Record<string, any[]> = {
            SONG: [item?.songId, item?.trackId, item?.contentId, item?.id],
            ARTIST: [item?.artistId, item?.contentId, item?.id],
            ALBUM: [item?.albumId, item?.contentId, item?.id],
            PODCAST: [item?.podcastId, item?.contentId, item?.id],
            EPISODE: [item?.episodeId, item?.podcastEpisodeId, item?.contentId, item?.id],
            PLAYLIST: [item?.playlistId, item?.id, item?.contentId]
        };

        const candidates = byType[normalizedType] ?? [
            item?.contentId,
            item?.songId,
            item?.artistId,
            item?.albumId,
            item?.podcastId,
            item?.episodeId,
            item?.playlistId,
            item?.id
        ];

        for (const candidate of candidates) {
            const id = Number(candidate ?? 0);
            if (id > 0) {
                return id;
            }
        }

        return 0;
    }

    private resolveSearchItemSubtitle(item: any, type: string): string {
        const normalizedType = String(type ?? '').toUpperCase();
        if (normalizedType === 'SONG') {
            return String(
                item?.artistName ??
                item?.artistDisplayName ??
                item?.artist?.displayName ??
                item?.artist?.name ??
                item?.uploaderName ??
                item?.createdByName ??
                item?.subtitle ??
                ''
            ).trim();
        }
        return String(item?.subtitle ?? item?.artistName ?? item?.artistType ?? item?.releaseDate ?? '').trim();
    }

    private resolveSearchItemCover(item: any): string {
        const isPodcastLike = Number(item?.podcastId ?? 0) > 0 || Number(item?.episodeId ?? item?.podcastEpisodeId ?? 0) > 0;
        const songId = isPodcastLike
            ? Number(item?.songId ?? item?.trackId ?? 0)
            : Number(item?.songId ?? item?.trackId ?? item?.contentId ?? item?.id ?? 0);
        const albumId = Number(item?.albumId ?? item?.album?.albumId ?? item?.album?.id ?? 0);

        const candidates = [
            item?.coverArtUrl,
            item?.coverImageUrl,
            item?.coverUrl,
            item?.profilePictureUrl,
            item?.profileImageUrl,
            item?.profilePictureFileName,
            item?.profileImageFileName,
            item?.profilePicture,
            item?.profileImage,
            item?.avatarUrl,
            item?.avatarFileName,
            item?.avatar,
            item?.artistImageUrl,
            item?.imageUrl,
            item?.image,
            item?.imageFileName,
            item?.imageName,
            item?.albumImageUrl,
            item?.thumbnailUrl,
            item?.artworkUrl,
            item?.song?.coverUrl,
            item?.song?.coverArtUrl,
            item?.song?.coverImageUrl,
            item?.song?.imageUrl,
            item?.song?.image,
            item?.song?.thumbnailUrl,
            item?.song?.artworkUrl,
            item?.content?.coverUrl,
            item?.content?.coverArtUrl,
            item?.content?.coverImageUrl,
            item?.content?.imageUrl,
            item?.content?.image,
            item?.content?.thumbnailUrl,
            item?.track?.coverUrl,
            item?.track?.coverArtUrl,
            item?.track?.coverImageUrl,
            item?.track?.imageUrl,
            item?.cover?.imageUrl,
            item?.cover?.url,
            item?.cover?.fileName,
            item?.user?.profilePictureUrl,
            item?.user?.profileImageUrl,
            item?.user?.avatarUrl,
            item?.user?.avatar,
            item?.user?.imageUrl,
            item?.artist?.profilePictureUrl,
            item?.artist?.profileImageUrl,
            item?.artist?.profilePictureFileName,
            item?.artist?.profileImageFileName,
            item?.artist?.avatarUrl,
            item?.artist?.avatarFileName,
            item?.artist?.avatar,
            item?.artist?.imageUrl,
            item?.artist?.imageFileName,
            item?.artist?.imageName,
            item?.artist?.user?.profilePictureUrl,
            item?.artist?.user?.profileImageUrl,
            item?.artist?.user?.avatarUrl,
            item?.artist?.user?.avatar,
            item?.artist?.user?.imageUrl,
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
            const value = String(candidate ?? '').trim();
            if (!value) {
                continue;
            }
            const resolved = this.resolveImage(value);
            if (resolved) {
                return resolved;
            }
        }

        if (!isPodcastLike && songId > 0) {
            const cachedSong = this.artistService.getCachedSongImage(songId);
            if (cachedSong) {
                return cachedSong;
            }
        }

        if (!isPodcastLike && albumId > 0) {
            const cachedAlbum = this.artistService.getCachedAlbumImage(albumId);
            if (cachedAlbum) {
                return cachedAlbum;
            }
        }

        return '';
    }

    private resolveSearchArtistImage(item: any): string {
        const candidates = [
            item?.bannerImageUrl,
            item?.bannerImage,
            item?.banner?.url,
            item?.banner?.fileName,
            item?.profileImageUrl,
            item?.profileImage,
            item?.profileImage?.url,
            item?.profileImage?.fileName,
            item?.avatarUrl,
            item?.imageUrl,
            item?.image,
            item?.avatar,
            item?.profilePictureUrl,
            item?.profilePictureFileName,
            item?.profileImageFileName,
            item?.profilePicture,
            item?.profilePicture?.url,
            item?.profilePicture?.fileName,
            item?.avatarFileName,
            item?.avatar?.url,
            item?.avatar?.fileName,
            item?.artistImageUrl,
            item?.imageFileName,
            item?.imageName,
            item?.user?.profileImageUrl,
            item?.user?.profileImage,
            item?.user?.profileImage?.url,
            item?.user?.profileImage?.fileName,
            item?.user?.avatarUrl,
            item?.user?.imageUrl,
            item?.user?.image,
            item?.user?.avatar,
            item?.artist?.profileImageUrl,
            item?.artist?.profileImage,
            item?.artist?.profileImage?.url,
            item?.artist?.profileImage?.fileName,
            item?.artist?.avatarUrl,
            item?.artist?.imageUrl,
            item?.artist?.image,
            item?.artist?.avatar,
            item?.artist?.profilePictureUrl,
            item?.artist?.profilePictureFileName,
            item?.artist?.profileImageFileName,
            item?.artist?.avatarFileName,
            item?.artist?.profilePicture?.url,
            item?.artist?.profilePicture?.fileName,
            item?.artist?.avatar?.url,
            item?.artist?.avatar?.fileName,
            item?.artist?.imageFileName,
            item?.artist?.imageName,
            item?.artist?.user?.profileImageUrl,
            item?.artist?.user?.profileImage,
            item?.artist?.user?.profileImage?.url,
            item?.artist?.user?.profileImage?.fileName,
            item?.artist?.user?.avatarUrl,
            item?.artist?.user?.imageUrl,
            item?.artist?.user?.image,
            item?.artist?.user?.avatar,
            item?.user?.profilePictureUrl,
            item?.artist?.user?.profilePictureUrl
        ];

        for (const candidate of candidates) {
            const resolved = this.resolveSearchImageCandidate(candidate);
            if (resolved) {
                return resolved;
            }
        }

        return '';
    }

    private resolveSearchImageCandidate(candidate: any): string {
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

    private resolveSearchArtistCardImage(item: any, explicitName: any = ''): string {
        const direct = this.resolveSearchTopArtistImage(item);
        if (direct) {
            return direct;
        }
        if (this.isCurrentArtistSearchMatch(item, explicitName)) {
            const currentUser = this.authService.getCurrentUserSnapshot() ?? {};
            return this.currentArtistProfileImageUrl || this.resolveSearchTopArtistImage(currentUser);
        }

        return '';
    }

    private resolveSearchTopArtistImage(item: any): string {
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

        return this.resolveSearchArtistImage(item);
    }

    private enrichArtistSearchResults(): void {
        const source = this.groupedResults.artists ?? [];
        if (source.length === 0) {
            return;
        }

        let changed = false;
        const withCache = source.map((artist: any) => {
            const artistId = Number(artist?.artistId ?? artist?.id ?? 0);
            const existing = String(artist?.coverArtUrl ?? '').trim() || this.resolveSearchArtistImage(artist);
            const cached = artistId > 0 ? String(this.artistSearchImageCache.get(artistId) ?? '').trim() : '';
            const currentArtistImage = this.isCurrentArtistSearchMatch(artist, artist?.title ?? artist?.name ?? artist?.artistName ?? '')
                ? (this.currentArtistProfileImageUrl || this.resolveSearchArtistImage(this.authService.getCurrentUserSnapshot() ?? {}))
                : '';
            if (!existing && currentArtistImage) {
                changed = true;
                return { ...artist, coverArtUrl: currentArtistImage };
            }
            if (!existing && cached) {
                changed = true;
                return { ...artist, coverArtUrl: cached };
            }
            return artist;
        });

        if (changed) {
            this.groupedResults = {
                ...this.groupedResults,
                artists: withCache
            };
        }

        const requests = withCache
            .map((artist: any) => {
                const artistId = Number(artist?.artistId ?? artist?.id ?? 0);
                const existing = String(artist?.coverArtUrl ?? '').trim() || this.resolveSearchArtistImage(artist);
                if (artistId <= 0 || existing || this.pendingArtistSearchImageIds.has(artistId)) {
                    return null;
                }

                this.pendingArtistSearchImageIds.add(artistId);
                return this.artistService.getArtistProfile(artistId).pipe(
                    map((profile) => ({
                        artistId,
                        imageUrl: this.resolveSearchTopArtistImage(profile)
                    })),
                    catchError(() => of({ artistId, imageUrl: '' }))
                );
            })
            .filter((request: any) => !!request);

        if (requests.length === 0) {
            if (changed) {
                this.cdr.markForCheck();
            }
            return;
        }

        forkJoin(requests).subscribe((rows: any[]) => {
            const imageByArtistId = new Map<number, string>();
            for (const row of rows ?? []) {
                const artistId = Number(row?.artistId ?? 0);
                const imageUrl = String(row?.imageUrl ?? '').trim();
                if (artistId > 0) {
                    this.pendingArtistSearchImageIds.delete(artistId);
                    if (imageUrl) {
                        this.artistSearchImageCache.set(artistId, imageUrl);
                        imageByArtistId.set(artistId, imageUrl);
                    }
                }
            }

            if (imageByArtistId.size === 0) {
                return;
            }

            let updated = false;
            const nextArtists = (this.groupedResults.artists ?? []).map((artist: any) => {
                const artistId = Number(artist?.artistId ?? artist?.id ?? 0);
                const existing = String(artist?.coverArtUrl ?? '').trim() || this.resolveSearchArtistImage(artist);
                const resolved = imageByArtistId.get(artistId) ?? '';
                if (existing || !resolved) {
                    return artist;
                }
                updated = true;
                return { ...artist, coverArtUrl: resolved };
            });

            if (!updated) {
                return;
            }

            this.groupedResults = {
                ...this.groupedResults,
                artists: nextArtists
            };
            this.cdr.markForCheck();
        });
    }

    private isCurrentArtistSearchMatch(item: any, explicitName: any = ''): boolean {
        const currentUser = this.authService.getCurrentUserSnapshot() ?? {};
        const currentUserNames = [
            currentUser?.displayName,
            currentUser?.artistName,
            currentUser?.username,
            currentUser?.name,
            currentUser?.fullName,
            currentUser?.user?.displayName,
            currentUser?.user?.fullName,
            currentUser?.artist?.displayName,
            currentUser?.artist?.name
        ]
            .map((value: any) => String(value ?? '').trim().toLowerCase())
            .filter((value: string) => !!value);

        const targetName = String(
            explicitName ??
            item?.title ??
            item?.displayName ??
            item?.name ??
            item?.artistName ??
            ''
        ).trim().toLowerCase();

        return !!targetName && currentUserNames.includes(targetName);
    }

    private preloadCurrentArtistProfileImage(): void {
        const currentUser = this.authService.getCurrentUserSnapshot() ?? {};
        const directImage = this.resolveSearchArtistImage(currentUser);
        if (directImage) {
            this.currentArtistProfileImageUrl = directImage;
            return;
        }

        const artistId = Number(currentUser?.artistId ?? currentUser?.artist?.artistId ?? currentUser?.artist?.id ?? this.currentArtistId ?? 0);
        if (artistId <= 0) {
            return;
        }

        this.artistService.getArtistProfile(artistId).pipe(
            map((artist) => this.resolveSearchArtistImage(artist)),
            catchError(() => of(''))
        ).subscribe((imageUrl) => {
            if (!imageUrl) {
                return;
            }
            this.currentArtistProfileImageUrl = imageUrl;
            this.authService.updateCurrentUser({ profilePictureUrl: imageUrl, artistId });
            if ((this.groupedResults.artists ?? []).length > 0) {
                this.groupedResults = {
                    ...this.groupedResults,
                    artists: (this.groupedResults.artists ?? []).map((artist: any) => ({
                        ...artist,
                        coverArtUrl: String(artist?.coverArtUrl ?? '').trim()
                            || this.resolveSearchArtistCardImage(artist, artist?.title ?? artist?.name ?? '')
                    }))
                };
                this.cdr.markForCheck();
            }
        });
    }

    private enrichSongAndAlbumSearchResults(): void {
        const songs = this.groupedResults.songs ?? [];
        const albums = this.groupedResults.albums ?? [];
        const needsSongImages = songs.some((item: any) => !String(item?.coverArtUrl ?? item?.imageUrl ?? '').trim());
        const needsAlbumImages = albums.some((item: any) => !String(item?.coverArtUrl ?? item?.imageUrl ?? '').trim());

        if (!needsSongImages && !needsAlbumImages) {
            return;
        }

        this.browseService.getBrowseSongs().pipe(
            map((response) => this.extractContentArray(response)),
            catchError(() => of([]))
        ).subscribe((browseSongs: any[]) => {
            const songCoverById = new Map<number, string>();
            const albumCoverById = new Map<number, string>();
            const albumCoverByTitle = new Map<string, string>();

            for (const browseSong of browseSongs ?? []) {
                const songId = Number(browseSong?.songId ?? browseSong?.id ?? browseSong?.contentId ?? 0);
                const albumId = Number(browseSong?.albumId ?? browseSong?.album?.albumId ?? browseSong?.album?.id ?? 0);
                const songCover = this.resolveSearchItemCover(browseSong);
                const albumCover = this.resolveAlbumCardCover(browseSong?.album ?? browseSong);
                const albumTitle = String(
                    browseSong?.album?.title ??
                    browseSong?.album?.name ??
                    browseSong?.albumTitle ??
                    ''
                ).trim().toLowerCase();

                if (songId > 0 && songCover && !songCoverById.has(songId)) {
                    songCoverById.set(songId, songCover);
                }

                if (albumId > 0 && albumCover && !albumCoverById.has(albumId)) {
                    albumCoverById.set(albumId, albumCover);
                }

                if (albumTitle && albumCover && !albumCoverByTitle.has(albumTitle)) {
                    albumCoverByTitle.set(albumTitle, albumCover);
                }
            }

            let changed = false;
            const nextSongs = songs.map((item: any) => {
                const existing = String(item?.coverArtUrl ?? item?.imageUrl ?? '').trim();
                if (existing) {
                    return item;
                }

                const songId = Number(item?.songId ?? item?.id ?? item?.contentId ?? 0);
                const fallbackCover = songCoverById.get(songId) ?? '';
                if (!fallbackCover) {
                    return item;
                }

                changed = true;
                return {
                    ...item,
                    coverArtUrl: fallbackCover,
                    imageUrl: fallbackCover
                };
            });

            const nextAlbums = albums.map((item: any) => {
                const existing = String(item?.coverArtUrl ?? item?.imageUrl ?? '').trim();
                if (existing) {
                    return item;
                }

                const albumId = Number(item?.albumId ?? item?.id ?? item?.contentId ?? 0);
                const albumTitle = String(item?.title ?? item?.name ?? '').trim().toLowerCase();
                const fallbackCover = albumCoverById.get(albumId) ?? albumCoverByTitle.get(albumTitle) ?? '';
                if (!fallbackCover) {
                    return item;
                }

                changed = true;
                return {
                    ...item,
                    coverArtUrl: fallbackCover,
                    imageUrl: fallbackCover
                };
            });

            if (!changed) {
                if (needsAlbumImages) {
                    this.enrichAlbumCardsFromAlbumDetails();
                }
                return;
            }

            this.groupedResults = {
                ...this.groupedResults,
                songs: nextSongs,
                albums: nextAlbums
            };
            this.cdr.markForCheck();

            if (nextAlbums.some((item: any) => !String(item?.coverArtUrl ?? item?.imageUrl ?? '').trim())) {
                this.enrichAlbumCardsFromAlbumDetails();
            }
        });
    }

    private enrichAlbumCardsFromAlbumDetails(): void {
        const albums = this.groupedResults.albums ?? [];
        const requests = albums
            .map((album: any) => {
                const albumId = Number(album?.albumId ?? album?.id ?? album?.contentId ?? 0);
                const existing = this.resolveAlbumCardCover(album)
                    || this.artistService.getCachedAlbumImage(albumId);
                if (albumId <= 0 || existing) {
                    return null;
                }

                return this.artistService.getAlbum(albumId).pipe(
                    map((detail: any) => ({
                        albumId,
                        coverArtUrl: this.resolveAlbumCardCover(detail) || this.artistService.getCachedAlbumImage(albumId) || ''
                    })),
                    catchError(() => of({ albumId, coverArtUrl: '' }))
                );
            })
            .filter((request: any) => !!request);

        if (requests.length === 0) {
            return;
        }

        forkJoin(requests).subscribe((rows: any[]) => {
            const coverByAlbumId = new Map<number, string>();
            for (const row of rows ?? []) {
                const albumId = Number(row?.albumId ?? 0);
                const coverArtUrl = String(row?.coverArtUrl ?? '').trim();
                if (albumId > 0 && coverArtUrl) {
                    coverByAlbumId.set(albumId, coverArtUrl);
                }
            }

            if (coverByAlbumId.size === 0) {
                return;
            }

            let changed = false;
            const nextAlbums = albums.map((album: any) => {
                const albumId = Number(album?.albumId ?? album?.id ?? album?.contentId ?? 0);
                const existing = this.resolveAlbumCardCover(album)
                    || this.artistService.getCachedAlbumImage(albumId);
                const fallbackCover = coverByAlbumId.get(albumId) ?? '';
                if (existing || !fallbackCover) {
                    return album;
                }

                changed = true;
                return {
                    ...album,
                    coverArtUrl: fallbackCover,
                    imageUrl: fallbackCover
                };
            });

            if (!changed) {
                return;
            }

            this.groupedResults = {
                ...this.groupedResults,
                albums: nextAlbums
            };
            this.cdr.markForCheck();
        });
    }

    private normalizeSearchItems(items: any[], preferredType: string = ''): any[] {
        const normalizedItems = (items ?? [])
            .map((item) => {
                const type = this.resolveSearchItemType(item, preferredType);
                const id = this.resolveSearchItemId(item, type);
                const resolvedCover = this.resolveSearchItemDisplayImage(item, type);
                return {
                    ...item,
                    id,
                    type,
                    songId: type === 'SONG' ? id : Number(item?.songId ?? 0),
                    artistId: Number(item?.artistId ?? item?.artist?.artistId ?? item?.artist?.id ?? 0),
                    albumId: Number(item?.albumId ?? item?.album?.albumId ?? item?.album?.id ?? 0),
                    contentId: Number(item?.contentId ?? id),
                    title: item?.title ?? item?.name ?? 'Untitled',
                    artistName: this.resolveSearchItemSubtitle(item, type),
                    subtitle: this.resolveSearchItemSubtitle(item, type),
                    coverArtUrl: resolvedCover,
                    imageUrl: resolvedCover || String(item?.imageUrl ?? '').trim(),
                    isFollowed: this.resolveFollowState(type, id)
                };
            })
            .filter((item) => Number(item?.id ?? 0) > 0)
            .filter((item) => !this.isSmokeTestContent(item?.title) && !this.isSmokeTestContent(item?.subtitle))
            .filter((item) => !this.isUnplayableSong(item));

        return this.applyAlbumAndPodcastCoverFallbacks(normalizedItems);
    }

    private applyAlbumAndPodcastCoverFallbacks(items: any[]): any[] {
        const withAlbumCovers = this.applyAlbumSongCoverFallback(items);
        return this.applyPodcastEpisodeCoverFallback(withAlbumCovers);
    }

    private applyAlbumSongCoverFallback(items: any[]): any[] {
        const songs = (items ?? []).filter((item: any) => item?.type === 'SONG');
        if (songs.length === 0) {
            return items ?? [];
        }

        const coverByAlbumId = new Map<number, string>();
        for (const song of songs) {
            const albumId = Number(song?.albumId ?? song?.album?.albumId ?? song?.album?.id ?? 0);
            if (albumId <= 0 || coverByAlbumId.has(albumId)) {
                continue;
            }

            const fallbackCover =
                this.resolveAlbumCardCover(song?.album) ||
                this.resolveSearchItemCover(song);
            if (fallbackCover) {
                coverByAlbumId.set(albumId, fallbackCover);
            }
        }

        if (coverByAlbumId.size === 0) {
            return items ?? [];
        }

        return (items ?? []).map((item: any) => {
            if (item?.type !== 'ALBUM') {
                return item;
            }

            const existingCover = this.resolveAlbumCardCover(item) || String(item?.imageUrl ?? '').trim();
            if (existingCover) {
                return item;
            }

            const albumId = Number(item?.albumId ?? item?.id ?? item?.contentId ?? 0);
            const fallbackCover = coverByAlbumId.get(albumId) ?? '';
            if (!fallbackCover) {
                return item;
            }

            return {
                ...item,
                coverArtUrl: fallbackCover,
                imageUrl: fallbackCover
            };
        });
    }

    private applyPodcastEpisodeCoverFallback(items: any[]): any[] {
        const episodes = (items ?? []).filter((item: any) => item?.type === 'EPISODE');
        if (episodes.length === 0) {
            return items ?? [];
        }

        const coverByPodcastId = new Map<number, string>();
        for (const episode of episodes) {
            const podcastId = Number(
                episode?.podcastId ??
                episode?.podcast?.podcastId ??
                episode?.podcast?.id ??
                0
            );
            if (podcastId <= 0 || coverByPodcastId.has(podcastId)) {
                continue;
            }

            const fallbackCover = this.resolvePodcastEpisodeFallbackCover(episode);
            if (fallbackCover) {
                coverByPodcastId.set(podcastId, fallbackCover);
            }
        }

        if (coverByPodcastId.size === 0) {
            return items ?? [];
        }

        return (items ?? []).map((item: any) => {
            if (item?.type !== 'PODCAST') {
                return item;
            }

            const existingCover = this.resolvePodcastCardCover(item) || String(item?.imageUrl ?? '').trim();
            if (existingCover) {
                return item;
            }

            const podcastId = Number(item?.podcastId ?? item?.id ?? item?.contentId ?? 0);
            const fallbackCover = coverByPodcastId.get(podcastId) ?? '';
            if (!fallbackCover) {
                return item;
            }

            return {
                ...item,
                coverArtUrl: fallbackCover,
                imageUrl: fallbackCover
            };
        });
    }

    private enrichPodcastSearchResults(): void {
        const podcasts = this.groupedResults.podcasts ?? [];
        const requests = podcasts
            .map((podcast: any) => {
                const podcastId = Number(podcast?.podcastId ?? podcast?.id ?? podcast?.contentId ?? 0);
                const existingCover = this.resolvePodcastCardCover(podcast) || String(podcast?.imageUrl ?? '').trim();
                if (podcastId <= 0 || existingCover) {
                    return null;
                }

                return this.artistService.getPodcastEpisodes(podcastId, 0, 1).pipe(
                    map((response: any) => {
                        const episodes = Array.isArray(response?.content) ? response.content : [];
                        const firstEpisode = episodes[0] ?? null;
                        return {
                            podcastId,
                            coverArtUrl: this.resolvePodcastEpisodeFallbackCover(firstEpisode, podcast)
                        };
                    }),
                    catchError(() => of({ podcastId, coverArtUrl: '' }))
                );
            })
            .filter((request: any) => !!request);

        if (requests.length === 0) {
            return;
        }

        forkJoin(requests).subscribe((rows: any[]) => {
            const coverByPodcastId = new Map<number, string>();
            for (const row of rows ?? []) {
                const podcastId = Number(row?.podcastId ?? 0);
                const coverArtUrl = String(row?.coverArtUrl ?? '').trim();
                if (podcastId > 0 && coverArtUrl) {
                    coverByPodcastId.set(podcastId, coverArtUrl);
                }
            }

            if (coverByPodcastId.size === 0) {
                return;
            }

            let changed = false;
            const nextPodcasts = podcasts.map((podcast: any) => {
                const podcastId = Number(podcast?.podcastId ?? podcast?.id ?? podcast?.contentId ?? 0);
                const existingCover = this.resolvePodcastCardCover(podcast) || String(podcast?.imageUrl ?? '').trim();
                const fallbackCover = coverByPodcastId.get(podcastId) ?? '';
                if (existingCover || !fallbackCover) {
                    return podcast;
                }

                changed = true;
                return {
                    ...podcast,
                    coverArtUrl: fallbackCover,
                    imageUrl: fallbackCover
                };
            });

            if (!changed) {
                return;
            }

            this.groupedResults = {
                ...this.groupedResults,
                podcasts: nextPodcasts
            };

            if (this.selectedPodcast) {
                const selectedPodcastId = Number(this.selectedPodcast?.podcastId ?? this.selectedPodcast?.id ?? 0);
                const selectedCover = coverByPodcastId.get(selectedPodcastId) ?? '';
                if (selectedCover) {
                    this.selectedPodcast = {
                        ...this.selectedPodcast,
                        coverArtUrl: selectedCover,
                        imageUrl: selectedCover
                    };
                }
            }

            this.cdr.markForCheck();
        });
    }

    private resolvePodcastEpisodeFallbackCover(episode: any, podcast: any = null): string {
        const candidates = [
            episode?.coverArtUrl,
            episode?.coverImageUrl,
            episode?.coverUrl,
            episode?.imageUrl,
            episode?.image,
            episode?.thumbnailUrl,
            episode?.artworkUrl,
            episode?.cover?.imageUrl,
            episode?.cover?.url,
            episode?.cover?.fileName,
            episode?.podcast?.coverArtUrl,
            episode?.podcast?.coverImageUrl,
            episode?.podcast?.coverUrl,
            episode?.podcast?.imageUrl,
            episode?.podcast?.image,
            episode?.podcast?.thumbnailUrl,
            episode?.podcast?.cover?.imageUrl,
            episode?.podcast?.cover?.url,
            episode?.podcast?.cover?.fileName
        ];

        for (const candidate of candidates) {
            const resolved = this.resolveImage(candidate);
            if (resolved) {
                return resolved;
            }
        }

        return this.resolvePodcastCardCover(podcast);
    }

    private syncPodcastCoverInResults(podcastId: number, coverArtUrl: string): void {
        const normalizedPodcastId = Number(podcastId ?? 0);
        const normalizedCover = String(coverArtUrl ?? '').trim();
        if (normalizedPodcastId <= 0 || !normalizedCover) {
            return;
        }

        let changed = false;
        const nextPodcasts = (this.groupedResults.podcasts ?? []).map((podcast: any) => {
            const currentPodcastId = Number(podcast?.podcastId ?? podcast?.id ?? podcast?.contentId ?? 0);
            if (currentPodcastId !== normalizedPodcastId) {
                return podcast;
            }

            const existing = String(podcast?.coverArtUrl ?? podcast?.imageUrl ?? '').trim();
            if (existing === normalizedCover) {
                return podcast;
            }

            changed = true;
            return {
                ...podcast,
                coverArtUrl: normalizedCover,
                imageUrl: normalizedCover
            };
        });

        if (!changed) {
            return;
        }

        this.groupedResults = {
            ...this.groupedResults,
            podcasts: nextPodcasts
        };
    }

    private resolveSearchItemDisplayImage(item: any, type: string): string {
        if (type === 'ARTIST') {
            return this.resolveSearchArtistCardImage(item, item?.title ?? item?.name ?? item?.artistName ?? '');
        }
        if (type === 'PODCAST') {
            return this.resolvePodcastCardCover(item);
        }
        if (type === 'ALBUM') {
            return this.resolveAlbumCardCover(item);
        }
        return this.resolveSearchItemCover(item);
    }

    private resolveAlbumCardCover(album: any): string {
        const directBackendImage = this.resolveAlbumBackendImage(album);
        if (directBackendImage) {
            return directBackendImage;
        }

        const candidates = [
            album?.coverArtUrl,
            album?.coverImageUrl,
            album?.coverUrl,
            album?.imageUrl,
            album?.image,
            album?.artworkUrl,
            album?.cover?.imageUrl,
            album?.cover?.url,
            album?.cover?.fileName,
            album?.imageFileName,
            album?.imageName,
            album?.coverFileName,
            album?.coverImageFileName
        ];

        for (const candidate of candidates) {
            const resolved = this.resolveImage(candidate);
            if (resolved) {
                return resolved;
            }
        }

        return '';
    }

    private resolveAlbumBackendImage(album: any): string {
        const candidates = [
            album?.imageUrl,
            album?.image,
            album?.imageFileName,
            album?.imageName,
            album?.coverFileName,
            album?.coverImageFileName
        ];

        for (const candidate of candidates) {
            const value = String(candidate ?? '').trim();
            if (!value) {
                continue;
            }

            if (
                value.startsWith('http://') ||
                value.startsWith('https://') ||
                value.startsWith('/api/v1/') ||
                value.startsWith('/files/') ||
                value.startsWith('files/')
            ) {
                const resolved = this.resolveImage(value);
                if (resolved) {
                    return resolved;
                }
            }

            if (!value.includes('/')) {
                return `${environment.apiUrl}/files/images/${encodeURIComponent(value)}`;
            }
        }

        return '';
    }

    private resolvePodcastCardCover(podcast: any): string {
        const candidates = [
            podcast?.coverArtUrl,
            podcast?.coverImageUrl,
            podcast?.coverUrl,
            podcast?.imageUrl,
            podcast?.image,
            podcast?.thumbnailUrl,
            podcast?.cover?.imageUrl,
            podcast?.cover?.url,
            podcast?.cover?.fileName,
            podcast?.imageFileName,
            podcast?.imageName
        ];

        for (const candidate of candidates) {
            const resolved = this.resolveImage(candidate);
            if (resolved) {
                return resolved;
            }
        }

        return '';
    }

    private mapPlaylists(playlists: any[]): any[] {
        return (playlists ?? []).map((playlist) => ({
            id: Number(playlist?.id ?? playlist?.playlistId ?? 0),
            name: playlist?.name ?? 'Playlist',
            description: playlist?.description ?? '',
            songCount: Number(playlist?.songCount ?? 0),
            followerCount: Number(playlist?.followerCount ?? 0)
        }));
    }

    private resolveFollowState(type: string, id: number): boolean {
        if (id <= 0) {
            return false;
        }
        if (type === 'ARTIST') {
            return this.followingService.isArtistFollowed(id);
        }
        if (type === 'PODCAST' || type === 'EPISODE') {
            return this.followingService.isPodcastFollowed(id);
        }
        return false;
    }

    private resolveSongPlaybackSource(song: any) {
        const songId = Number(song?.songId ?? song?.contentId ?? song?.id ?? 0);
        const artistId = Number(song?.artistId ?? song?.artist?.artistId ?? song?.artist?.id ?? 0);
        const normalizedTitle = String(song?.title ?? '').trim().toLowerCase();
        const directTrack = this.buildSongPlayerTrack(song, song);
        if (this.hasPlayableSongReference(directTrack)) {
            return of(directTrack);
        }

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
                const mergedFromArtist = artistSong ? { ...song, ...artistSong } : { ...song };
                const artistTrack = this.buildSongPlayerTrack(mergedFromArtist, song);
                if (this.hasPlayableSongReference(artistTrack) || songId <= 0) {
                    return of(artistTrack);
                }

                return this.browseService.getSongById(songId).pipe(
                    map((resolvedSong) => this.buildSongPlayerTrack(resolvedSong ? { ...mergedFromArtist, ...resolvedSong } : mergedFromArtist, song)),
                    catchError(() => of(artistTrack))
                );
            })
        );
    }

    private buildSongPlayerTrack(primary: any, fallback: any = null): any {
        const merged = { ...(fallback ?? {}), ...(primary ?? {}) };
        const songId = Number(merged?.songId ?? merged?.contentId ?? merged?.id ?? 0);
        const fileName = this.extractAudioFileName(merged, fallback);
        const fallbackFileUrl = this.buildSongFileUrl(fileName);
        const cover = this.resolveSearchItemCover(merged) || this.resolveSearchItemCover(fallback);
        return {
            id: songId,
            songId,
            title: merged?.title ?? 'Untitled',
            artistName: String(merged?.artistName ?? merged?.subtitle ?? fallback?.artistName ?? '').trim(),
            fileUrl: String(merged?.fileUrl || merged?.audioUrl || merged?.streamUrl || fallbackFileUrl).trim(),
            audioUrl: String(merged?.audioUrl || merged?.streamUrl || merged?.fileUrl || fallbackFileUrl).trim(),
            streamUrl: String(merged?.streamUrl || this.buildSongStreamUrl(songId) || merged?.audioUrl || merged?.fileUrl || fallbackFileUrl).trim(),
            fileName,
            imageUrl: this.resolveImage(cover),
            type: 'SONG'
        };
    }

    private buildPodcastPlayerTrack(episode: any, podcast: any): any {
        return {
            id: Number(episode?.episodeId ?? episode?.id ?? 0),
            episodeId: Number(episode?.episodeId ?? episode?.id ?? 0),
            podcastId: Number(podcast?.podcastId ?? podcast?.id ?? episode?.podcastId ?? 0),
            title: String(episode?.title ?? podcast?.title ?? 'Podcast Episode').trim(),
            artistName: String(podcast?.title ?? 'Podcast').trim(),
            podcastName: String(podcast?.title ?? 'Podcast').trim(),
            fileUrl: String(episode?.fileUrl ?? episode?.audioUrl ?? episode?.streamUrl ?? '').trim(),
            audioUrl: String(episode?.audioUrl ?? episode?.fileUrl ?? episode?.streamUrl ?? '').trim(),
            streamUrl: String(episode?.streamUrl ?? episode?.audioUrl ?? episode?.fileUrl ?? '').trim(),
            fileName: String(episode?.fileName ?? episode?.audioFileName ?? '').trim(),
            imageUrl: this.resolveImage(
                podcast?.coverArtUrl ??
                podcast?.coverImageUrl ??
                podcast?.coverUrl ??
                podcast?.imageUrl ??
                podcast?.image ??
                ''
            ),
            durationSeconds: Number(episode?.durationSeconds ?? 0),
            type: 'PODCAST'
        };
    }

    private hasPlayableSongReference(song: any): boolean {
        return !!String(song?.fileUrl ?? song?.audioUrl ?? song?.streamUrl ?? song?.fileName ?? '').trim();
    }

    private hasPlayablePodcastReference(item: any): boolean {
        return !!String(item?.fileUrl ?? item?.audioUrl ?? item?.streamUrl ?? item?.fileName ?? '').trim();
    }

    private resetResults(): void {
        this.isLoading = false;
        this.error = null;
        this.groupedResults = {
            songs: [],
            artists: [],
            albums: [],
            podcasts: [],
            playlists: []
        };
        this.pagination = {
            page: 0,
            size: 20,
            totalElements: 0,
            totalPages: 0
        };
    }

    private resetSelectedAlbumState(): void {
        this.selectedAlbum = null;
        this.selectedAlbumSongs = [];
        this.isAlbumLoading = false;
        this.albumError = null;
        this.selectedPodcast = null;
        this.selectedPodcastEpisodes = [];
        this.isPodcastLoading = false;
        this.podcastError = null;
    }

    private getAlbumId(album: any): number {
        return Number(album?.id ?? album?.albumId ?? album?.contentId ?? 0);
    }

    private unwrapAlbumPayload(payload: any): any {
        if (!payload || typeof payload !== 'object') {
            return payload;
        }

        if (payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
            return payload.data;
        }

        return payload;
    }

    private extractAlbumSongs(album: any): any[] {
        const source = this.unwrapAlbumPayload(album);
        if (Array.isArray(source?.songs)) {
            return source.songs;
        }
        if (Array.isArray(source?.tracks)) {
            return source.tracks;
        }
        if (Array.isArray(source?.content)) {
            return source.content;
        }
        if (Array.isArray(source?.data?.songs)) {
            return source.data.songs;
        }
        if (Array.isArray(source?.data?.tracks)) {
            return source.data.tracks;
        }
        if (Array.isArray(source?.data?.content)) {
            return source.data.content;
        }
        return [];
    }

    private openAlbumById(albumId: number): void {
        if (albumId <= 0) {
            return;
        }

        this.isAlbumLoading = true;
        this.albumError = null;
        this.cdr.markForCheck();

        this.apiService.get<any>(`/albums/${albumId}`).pipe(
            catchError(() => of(null))
        ).subscribe((albumDetail) => {
            if (!albumDetail) {
                this.loadAlbumSongsFallback(albumId, true);
                return;
            }

            const resolvedAlbum = this.unwrapAlbumPayload(albumDetail);
            const normalizedAlbumId = this.getAlbumId(resolvedAlbum) || albumId;
            const songs = this.normalizeAlbumSongs(this.extractAlbumSongs(resolvedAlbum), resolvedAlbum);
            this.selectedAlbum = {
                ...resolvedAlbum,
                id: normalizedAlbumId,
                title: resolvedAlbum?.title ?? `Album #${normalizedAlbumId}`,
                coverArtUrl: this.resolveImage(
                    resolvedAlbum?.coverArtUrl ?? resolvedAlbum?.coverImageUrl ?? resolvedAlbum?.imageUrl ?? resolvedAlbum?.image ?? ''
                )
            };
            if (songs.length > 0) {
                this.selectedAlbumSongs = songs;
                this.isAlbumLoading = false;
                this.albumError = null;
                this.cdr.markForCheck();
                return;
            }

            this.loadAlbumSongsFallback(normalizedAlbumId, false);
        });
    }

    private normalizeAlbumSongs(items: any[], albumCandidate: any = null): any[] {
        return (items ?? [])
            .map((song: any) => {
                const songId = Number(song?.songId ?? song?.id ?? song?.contentId ?? 0);
                return {
                    ...song,
                    id: songId,
                    songId,
                    title: song?.title ?? `Song #${songId}`,
                    artistName: this.resolveAlbumSongArtistName(song, albumCandidate),
                    fileUrl: song?.fileUrl ?? song?.audioUrl ?? '',
                    fileName: song?.fileName ?? '',
                    type: 'SONG'
                };
            })
            .filter((song: any) => Number(song?.songId ?? 0) > 0)
            .filter((song: any) => !this.isSmokeTestContent(song?.title) && !this.isUnplayableSong(song));
    }

    private normalizePodcastCard(podcast: any): any {
        const podcastId = Number(podcast?.podcastId ?? podcast?.id ?? podcast?.contentId ?? 0);
        return {
            ...podcast,
            id: podcastId,
            podcastId,
            title: String(podcast?.title ?? `Podcast #${podcastId}`).trim(),
            subtitle: String(podcast?.subtitle ?? podcast?.description ?? 'Podcast').trim(),
            coverArtUrl: this.resolvePodcastCardCover(podcast)
        };
    }

    private normalizePodcastEpisodes(items: any[]): any[] {
        return (items ?? [])
            .map((episode: any, index: number) => {
                const episodeId = Number(episode?.episodeId ?? episode?.podcastEpisodeId ?? episode?.id ?? 0);
                const rawTitle = String(episode?.title ?? '').trim();
                return {
                    ...episode,
                    id: episodeId,
                    episodeId,
                    title: rawTitle || this.defaultEpisodeTitle(index),
                    releaseDate: String(episode?.releaseDate ?? '').trim(),
                    durationSeconds: Number(episode?.durationSeconds ?? 0)
                };
            })
            .filter((episode: any) => Number(episode?.episodeId ?? episode?.id ?? 0) > 0)
            .sort((a: any, b: any) => Number(b?.episodeId ?? 0) - Number(a?.episodeId ?? 0));
    }

    private defaultEpisodeTitle(index: number): string {
        const labels = ['Episode One', 'Episode Two', 'Episode Three', 'Episode Four'];
        return labels[index] ?? `Episode ${index + 1}`;
    }

    podcastEpisodeMeta(episode: any): string {
        const duration = this.formatPodcastDuration(Number(episode?.durationSeconds ?? 0));
        const date = String(episode?.releaseDate ?? '').trim();
        if (duration && date) {
            return `${duration} • ${date}`;
        }
        return duration || date || 'Episode';
    }

    private formatPodcastDuration(totalSeconds: number): string {
        const value = Number(totalSeconds ?? 0);
        if (!Number.isFinite(value) || value <= 0) {
            return '';
        }

        const hours = Math.floor(value / 3600);
        const minutes = Math.floor((value % 3600) / 60);
        const seconds = Math.floor(value % 60);
        if (hours > 0) {
            return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }
        return `${minutes}:${String(seconds).padStart(2, '0')}`;
    }

    getAlbumCardImage(album: any): string {
        const albumId = this.getAlbumId(album);
        const selectedAlbumId = this.getAlbumId(this.selectedAlbum);
        if (albumId > 0 && albumId === selectedAlbumId) {
            const selectedCover = this.resolveAlbumCardCover(this.selectedAlbum);
            if (selectedCover) {
                return selectedCover;
            }
        }

        return this.resolveAlbumCardCover(album)
            || this.artistService.getCachedAlbumImage(albumId)
            || String(album?.imageUrl ?? '').trim()
            || '';
    }

    private loadAlbumSongsFallback(albumId: number, fromAlbumError: boolean): void {
        const fallbackArtistId = this.resolveAlbumArtistId(this.selectedAlbum);
        forkJoin({
            creatorCatalog: this.loadCreatorFallbackCatalog().pipe(
                catchError(() => of({ songs: [] }))
            ),
            artistSongs: fallbackArtistId > 0
                ? this.artistService.getArtistSongs(fallbackArtistId, 0, 220).pipe(
                    map((response) => this.extractContentArray(response)),
                    catchError(() => of([]))
                )
                : of([]),
            browseSongs: this.browseService.getBrowseSongs().pipe(
                map((response) => this.extractContentArray(response)),
                catchError(() => of([]))
            ),
            seededSongs: this.apiService.get<any>(
                `/search?q=${encodeURIComponent(this.defaultSeedTerm)}&type=SONG&page=0&size=${this.pagination.size}`
            ).pipe(
                map((response) => this.extractContentArray(response)),
                catchError(() => of([]))
            )
        }).subscribe(({ creatorCatalog, artistSongs, browseSongs, seededSongs }) => {
            if (Number(this.getAlbumId(this.selectedAlbum) ?? 0) !== Number(albumId ?? 0)) {
                return;
            }

            const creator = this.toCreatorCatalog(creatorCatalog);
            const candidates = [
                ...this.normalizeSearchItems(creator.songs ?? [], 'SONG'),
                ...this.normalizeSearchItems(artistSongs ?? [], 'SONG'),
                ...this.normalizeSearchItems(browseSongs ?? [], 'SONG'),
                ...this.normalizeSearchItems(seededSongs ?? [], 'SONG')
            ];
            const songsByAlbumId = this.filterSongsByAlbumId(candidates, albumId);
            const localMappedIds = this.getLocalAlbumSongIds(albumId);
            const songsByLocalMap = (candidates ?? [])
                .filter((item: any) => localMappedIds.includes(Number(item?.songId ?? item?.id ?? item?.contentId ?? 0)))
                .map((item: any) => ({ ...item, albumId }));
            const songs = this.normalizeAlbumSongs(
                this.mergeSongCandidates(songsByAlbumId, songsByLocalMap),
                this.selectedAlbum
            );
            const fallbackCover = this.resolveAlbumFallbackCover(this.selectedAlbum, songs, candidates, albumId);

            this.selectedAlbum = this.selectedAlbum
                ? {
                    ...this.selectedAlbum,
                    coverArtUrl: fallbackCover || this.selectedAlbum?.coverArtUrl || ''
                }
                : this.selectedAlbum;
            this.syncAlbumCoverInResults(
                Number(this.getAlbumId(this.selectedAlbum) ?? albumId),
                String(this.selectedAlbum?.coverArtUrl ?? '').trim()
            );
            this.selectedAlbumSongs = songs;
            this.isAlbumLoading = false;
            if (songs.length > 0) {
                this.albumError = null;
            } else {
                this.albumError = fromAlbumError ? 'Album details could not be loaded.' : 'No songs found in this album.';
            }
            this.cdr.markForCheck();
        });
    }

    private resolveAlbumFallbackCover(album: any, songs: any[], candidates: any[], albumId: number): string {
        const directAlbumCover = this.resolveAlbumCardCover(album);
        if (directAlbumCover) {
            return directAlbumCover;
        }

        for (const song of songs ?? []) {
            const songCover = this.resolveSearchItemCover(song) || this.resolveAlbumCardCover(song?.album);
            if (songCover) {
                return songCover;
            }
        }

        for (const item of candidates ?? []) {
            const itemAlbumId = Number(item?.albumId ?? item?.album?.albumId ?? item?.album?.id ?? 0);
            if (itemAlbumId !== Number(albumId ?? 0)) {
                continue;
            }

            const candidateCover = this.resolveAlbumCardCover(item?.album) || this.resolveSearchItemCover(item);
            if (candidateCover) {
                return candidateCover;
            }
        }

        return '';
    }

    private syncAlbumCoverInResults(albumId: number, coverArtUrl: string): void {
        const normalizedAlbumId = Number(albumId ?? 0);
        const normalizedCover = String(coverArtUrl ?? '').trim();
        if (normalizedAlbumId <= 0 || !normalizedCover) {
            return;
        }

        let changed = false;
        const nextAlbums = (this.groupedResults.albums ?? []).map((album: any) => {
            const currentAlbumId = Number(album?.albumId ?? album?.id ?? album?.contentId ?? 0);
            if (currentAlbumId !== normalizedAlbumId) {
                return album;
            }

            const existing = String(album?.coverArtUrl ?? album?.imageUrl ?? '').trim();
            if (existing === normalizedCover) {
                return album;
            }

            changed = true;
            return {
                ...album,
                coverArtUrl: normalizedCover,
                imageUrl: normalizedCover
            };
        });

        if (!changed) {
            return;
        }

        this.groupedResults = {
            ...this.groupedResults,
            albums: nextAlbums
        };
    }

    private resolveAlbumArtistId(album: any): number {
        return Number(
            album?.artistId ??
            album?.artist?.artistId ??
            album?.artist?.id ??
            album?.createdByArtistId ??
            album?.user?.artistId ??
            0
        );
    }

    private filterSongsByAlbumId(items: any[], albumId: number): any[] {
        const targetAlbumId = Number(albumId ?? 0);
        if (targetAlbumId <= 0) {
            return [];
        }

        const seen = new Set<number>();
        const matched: any[] = [];

        for (const item of items ?? []) {
            const songId = Number(item?.songId ?? item?.id ?? item?.contentId ?? 0);
            if (songId <= 0 || seen.has(songId)) {
                continue;
            }

            const itemAlbumId = Number(item?.albumId ?? item?.album?.albumId ?? item?.album?.id ?? 0);
            if (itemAlbumId !== targetAlbumId) {
                continue;
            }

            seen.add(songId);
            matched.push(item);
        }

        return matched;
    }

    private mergeSongCandidates(primary: any[], secondary: any[]): any[] {
        const merged = [...(primary ?? []), ...(secondary ?? [])];
        const seen = new Set<number>();
        const unique: any[] = [];
        for (const song of merged) {
            const songId = Number(song?.songId ?? song?.id ?? song?.contentId ?? 0);
            if (songId <= 0 || seen.has(songId)) {
                continue;
            }
            seen.add(songId);
            unique.push(song);
        }
        return unique;
    }

    private getLocalAlbumSongIds(albumId: number): number[] {
        const userId = Number(this.currentUserId ?? 0);
        const targetAlbumId = Number(albumId ?? 0);
        if (userId <= 0 || targetAlbumId <= 0) {
            return [];
        }

        try {
            const raw = localStorage.getItem(this.albumSongMapKey);
            const parsed = raw ? JSON.parse(raw) : {};
            const byUser = parsed?.[String(userId)] ?? {};
            const ids = Array.isArray(byUser?.[String(targetAlbumId)]) ? byUser[String(targetAlbumId)] : [];
            return ids.map((id: any) => Number(id ?? 0)).filter((id: number) => id > 0);
        } catch {
            return [];
        }
    }

    private resolveAlbumSongArtistName(song: any, albumCandidate: any = null): string {
        const fallbackArtist = String(
            albumCandidate?.artistName ??
            albumCandidate?.subtitle ??
            albumCandidate?.username ??
            this.selectedAlbum?.artistName ??
            this.selectedAlbum?.subtitle ??
            ''
        ).trim();
        const directArtist = String(
            song?.artistName ??
            song?.artistDisplayName ??
            song?.artist?.displayName ??
            song?.artist?.name ??
            song?.uploaderName ??
            song?.createdByName ??
            song?.username ??
            ''
        ).trim();
        return directArtist || fallbackArtist || 'Unknown Artist';
    }

    private toPlayerTrack(song: any): any {
        const songId = Number(song?.songId ?? song?.id ?? 0);
        return {
            id: songId,
            songId,
            title: song?.title ?? `Song #${songId}`,
            artistName: this.resolveAlbumSongArtistName(song, this.selectedAlbum),
            fileUrl: song?.fileUrl ?? song?.audioUrl ?? '',
            fileName: song?.fileName ?? '',
            type: 'SONG',
            imageUrl: this.selectedAlbum?.coverArtUrl ?? ''
        };
    }

    private buildAlbumQueue(): any[] {
        return (this.selectedAlbumSongs ?? [])
            .map((song) => this.toPlayerTrack(song))
            .filter((song) => Number(song?.songId ?? 0) > 0);
    }

    private buildSearchResultsQueue(sourceSong: any, resolvedTrack: any): any[] {
        const targetSongId = Number(sourceSong?.songId ?? sourceSong?.contentId ?? sourceSong?.id ?? resolvedTrack?.songId ?? resolvedTrack?.id ?? 0);
        return (this.groupedResults.songs ?? [])
            .map((song: any) => {
                const songId = Number(song?.songId ?? song?.contentId ?? song?.id ?? 0);
                return songId === targetSongId
                    ? resolvedTrack
                    : this.toPlayerTrack(song);
            })
            .filter((song: any) => Number(song?.songId ?? song?.id ?? 0) > 0);
    }

    private isSmokeTestContent(title: any): boolean {
        const value = String(title ?? '').trim();
        if (!value) {
            return false;
        }
        return /(smoke|endpoint)/i.test(value);
    }

    private isUnplayableSong(song: any): boolean {
        return song?.isActive === false ||
            String(song?.availabilityStatus ?? '').toUpperCase() === 'UNAVAILABLE';
    }

    private removeSongFromResults(songId: number): void {
        const filtered = (this.groupedResults.songs ?? []).filter((song) => Number(song?.id ?? song?.songId ?? 0) !== songId);
        this.groupedResults = {
            ...this.groupedResults,
            songs: filtered
        };
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

    private resolveCurrentUserId(): number | null {
        const snapshot = this.authService.getCurrentUserSnapshot();
        const snapshotId = Number(snapshot?.userId ?? snapshot?.id ?? 0);
        if (snapshotId > 0) {
            return snapshotId;
        }

        const stored = this.getStoredUser();
        const id = Number(stored?.userId ?? stored?.id ?? 0);
        return id > 0 ? id : null;
    }

    private loadLikedSongs(): void {
        if (!this.currentUserId) {
            return;
        }

        this.likesService.getUserLikes(this.currentUserId, 'SONG', 0, 400).subscribe({
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


    private resolveCurrentArtistId(): number | null {
        const snapshot = this.authService.getCurrentUserSnapshot() ?? this.getStoredUser();
        const userId = Number(snapshot?.userId ?? snapshot?.id ?? this.currentUserId ?? 0);
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

        const mappedArtistId = this.stateService.getArtistIdForUser(userId);
        if (mappedArtistId) {
            return mappedArtistId;
        }

        return this.stateService.artistId;
    }

    private loadCreatorFallbackCatalog(): any {
        const currentUser = this.authService.getCurrentUserSnapshot() ?? this.getStoredUser();
        if (!hasRole(currentUser, 'ARTIST')) {
            return of(this.emptyCreatorCatalog([], []));
        }

        const cachedUploads = this.getCachedRecentUploadsForCurrentUser();
        const cachedArtists = this.deriveArtistsFromRecentUploads(cachedUploads);
        const resolvedArtistId = Number(this.currentArtistId ?? this.resolveCurrentArtistId() ?? 0);
        if (resolvedArtistId > 0) {
            this.currentArtistId = resolvedArtistId;
            return this.fetchCreatorCatalogByArtistId(resolvedArtistId, cachedUploads, cachedArtists);
        }

        const username = String(currentUser?.username ?? '').trim();
        if (!username) {
            return of(this.emptyCreatorCatalog(cachedUploads, cachedArtists));
        }

        return this.artistService.findArtistByUsername(username).pipe(
            map((response: any) => this.pickArtistIdFromSearchResponse(response?.content ?? [], username)),
            catchError(() => of(0)),
            switchMap((artistId: number) => {
                if (artistId <= 0) {
                    return of(this.emptyCreatorCatalog(cachedUploads, cachedArtists));
                }
                this.currentArtistId = artistId;
                this.stateService.setArtistIdForUser(this.currentUserId, artistId);
                return this.fetchCreatorCatalogByArtistId(artistId, cachedUploads, cachedArtists);
            }),
            catchError(() => of(this.emptyCreatorCatalog(cachedUploads, cachedArtists)))
        );
    }

    private fetchCreatorCatalogByArtistId(artistId: number, cachedUploads: any[] = [], cachedArtists: any[] = []): any {
        return forkJoin({
            songs: this.artistService.getArtistSongs(artistId, 0, 220).pipe(
                map((response: any) => this.extractContentArray(response)),
                catchError(() => of([]))
            ),
            albums: this.artistService.getArtistAlbums(artistId, 0, 180).pipe(
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
            catchError(() => of(this.emptyCreatorCatalog(cachedUploads, cachedArtists)))
        );
    }

    private pickArtistIdFromSearchResponse(items: any[], username: string): number {
        const normalizedUsername = String(username ?? '').trim().toLowerCase();
        const artistItems = (items ?? []).filter((item: any) => {
            const rawType = String(item?.type ?? '').trim().toUpperCase();
            if (['SONG', 'ALBUM', 'PODCAST', 'PLAYLIST', 'GENRE'].includes(rawType)) {
                return false;
            }
            return rawType === 'ARTIST' || rawType === 'BOTH' || Number(item?.artistId ?? item?.contentId ?? item?.id ?? 0) > 0;
        });

        const exact = artistItems.find((item: any) => {
            const candidates = [item?.username, item?.title, item?.artistName, item?.displayName, item?.name];
            return candidates.some((value) => String(value ?? '').trim().toLowerCase() === normalizedUsername);
        }) ?? artistItems[0];

        return Number(exact?.artistId ?? exact?.contentId ?? exact?.id ?? 0);
    }

    private getCachedRecentUploadsForCurrentUser(): any[] {
        const userId = Number(this.currentUserId ?? 0);
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
                    const coverUrl = this.resolveSearchItemCover(item);
                    return {
                        ...item,
                        songId,
                        id: songId,
                        contentId: songId,
                        title: String(item?.title ?? '').trim() || `Track #${index + 1}`,
                        artistName: String(item?.artistName ?? '').trim() || 'Artist',
                        subtitle: String(item?.artistName ?? '').trim() || 'Artist',
                        fileName,
                        audioFileName: fileName,
                        fileUrl: trustedFileUrl,
                        audioUrl: trustedFileUrl,
                        streamUrl: trustedStreamUrl,
                        coverUrl,
                        imageUrl: coverUrl,
                        type: 'SONG'
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
        const artists: any[] = [];
        const seen = new Set<string>();
        for (const item of items ?? []) {
            const artistName = String(item?.artistName ?? '').trim();
            if (!artistName) {
                continue;
            }
            const key = artistName.toLowerCase();
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            artists.push({
                type: 'ARTIST',
                id: this.syntheticArtistId(artistName),
                artistId: this.syntheticArtistId(artistName),
                contentId: this.syntheticArtistId(artistName),
                title: artistName,
                artistName,
                subtitle: ''
            });
        }
        return artists;
    }

    private emptyCreatorCatalog(songs: any[] = [], artists: any[] = []): { songs: any[]; albums: any[]; podcasts: any[]; artists: any[] } {
        return { songs, albums: [], podcasts: [], artists };
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

    resolveImage(rawUrl: any): string {
        const value = String(rawUrl ?? '').trim();
        if (!value) {
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
}
