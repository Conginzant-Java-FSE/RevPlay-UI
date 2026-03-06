import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { forkJoin, of, Subject } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, switchMap } from 'rxjs/operators';
import { ApiService } from '../../core/services/api';
import { GenreService } from '../../core/services/genre.service';
import { PlayerService } from '../../core/services/player.service';
import { PlaylistService } from '../../core/services/playlist.service';
import { LikesService } from '../../core/services/likes.service';
import { AuthService } from '../../core/services/auth';
import { ArtistService } from '../../core/services/artist.service';
import { StateService } from '../../core/services/state.service';
import { BrowseService } from '../services/browse.service';
import { FollowingService } from '../../core/services/following.service';
import { environment } from '../../../environments/environment';
import { shareSongWithFallback } from '../../core/utils/song-share.util';

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
    imports: [CommonModule, RouterModule, FormsModule],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class SearchComponent implements OnInit, OnDestroy {
    private readonly albumSongMapKey = 'revplay_album_song_map';
    genres: any[] = [];
    searchQuery = '';
    selectedFilter: SearchFilter = 'ALL';
    isLoading = false;
    error: string | null = null;
    selectedAlbum: any | null = null;
    selectedAlbumSongs: any[] = [];
    isAlbumLoading = false;
    albumError: string | null = null;
    actionMessage: string | null = null;
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
    private searchApiBlocked = false;
    private speechRecognition: SpeechRecognitionLike | null = null;

    constructor(
        private apiService: ApiService,
        private genreService: GenreService,
        private playerService: PlayerService,
        private playlistService: PlaylistService,
        private likesService: LikesService,
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
        this.initializeVoiceSearch();
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
        if (!songId) {
            return;
        }

        this.error = null;
        this.browseService.getSongById(songId).subscribe({
            next: (resolvedSong) => {
                if (this.isUnplayableSong(resolvedSong)) {
                    this.removeSongFromResults(songId);
                    this.cdr.markForCheck();
                    return;
                }

                this.playerService.playTrack(
                    {
                        id: resolvedSong?.songId ?? songId,
                        songId: resolvedSong?.songId ?? songId,
                        title: resolvedSong?.title ?? song?.title,
                        artistName: resolvedSong?.artistName ?? song?.artistName ?? '',
                        fileUrl: resolvedSong?.fileUrl ?? '',
                        type: 'SONG'
                    },
                    [resolvedSong]
                );
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
        const songId = Number(song?.songId ?? song?.contentId ?? song?.id ?? 0);
        if (!songId || !this.currentUserId) {
            this.error = 'User session not found.';
            this.cdr.markForCheck();
            return;
        }

        this.error = null;
        this.actionMessage = null;
        this.likesService.getSongLikeId(this.currentUserId, songId).subscribe({
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

    hideSongInCurrentResults(song: any): void {
        const songId = Number(song?.songId ?? song?.contentId ?? song?.id ?? 0);
        if (!songId) {
            return;
        }

        this.removeSongFromResults(songId);
        this.selectedAlbumSongs = (this.selectedAlbumSongs ?? [])
            .filter((item) => Number(item?.songId ?? item?.id ?? 0) !== songId);
        this.actionMessage = 'Song hidden from current results.';
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
        this.selectedAlbumSongs = [];
        this.isAlbumLoading = true;
        this.albumError = null;
        this.cdr.markForCheck();

        this.apiService.get<any>(`/albums/${albumId}`).pipe(
            map((albumDetail) => {
                const normalizedId = this.getAlbumId(albumDetail) || albumId;
                return {
                    ...albumDetail,
                    id: normalizedId,
                    coverArtUrl: this.resolveImage(
                        albumDetail?.coverArtUrl ?? albumDetail?.coverImageUrl ?? albumDetail?.imageUrl ?? albumDetail?.image ?? fallbackCover
                    )
                };
            }),
            catchError(() => of(null))
        ).subscribe((albumDetail) => {
            if (!albumDetail) {
                this.loadAlbumSongsFallback(albumId, true);
                return;
            }

            const songs = this.normalizeAlbumSongs(albumDetail?.songs ?? [], albumDetail);
            this.selectedAlbum = {
                ...this.selectedAlbum,
                ...albumDetail,
                id: this.getAlbumId(albumDetail) || albumId,
                title: albumDetail?.title ?? this.selectedAlbum?.title ?? `Album #${albumId}`,
                coverArtUrl: albumDetail?.coverArtUrl ?? this.selectedAlbum?.coverArtUrl ?? ''
            };
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
        const term = this.searchQuery.trim();
        if (!term) {
            this.fetchDefaultResultsByFilter();
            return;
        }

        this.isLoading = true;
        this.error = null;
        this.cdr.markForCheck();

        if (this.selectedFilter === 'PLAYLIST') {
            this.searchPlaylistsOnly(term);
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
                    .filter((item) => item.type === 'PODCAST' || item.type === 'EPISODE');
                this.groupedResults = {
                    songs: [],
                    artists: [],
                    albums: [],
                    podcasts: normalizedPodcasts,
                    playlists: []
                };
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
                ]).filter((item) => item.type === 'PODCAST' || item.type === 'EPISODE');

                this.groupedResults = {
                    songs: normalizedSongs,
                    artists: normalizedArtists,
                    albums: [],
                    podcasts: normalizedPodcasts,
                    playlists: []
                };

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
                        ...this.normalizeSearchItems(podcasts?.content ?? [], 'PODCAST').filter((item) => item.type === 'PODCAST' || item.type === 'EPISODE'),
                        ...broadItems.filter((item) => item.type === 'PODCAST' || item.type === 'EPISODE'),
                        ...this.normalizeSearchItems(fallbackPodcasts ?? [], 'PODCAST').filter((item) => item.type === 'PODCAST' || item.type === 'EPISODE'),
                        ...this.normalizeSearchItems(creator.podcasts, 'PODCAST').filter((item) => item.type === 'PODCAST' || item.type === 'EPISODE')
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
                        ...this.normalizeSearchItems(typed?.content ?? [], 'PODCAST').filter((item) => item.type === 'PODCAST' || item.type === 'EPISODE'),
                        ...this.normalizeSearchItems(broad?.content ?? []).filter((item) => item.type === 'PODCAST' || item.type === 'EPISODE'),
                        ...this.normalizeSearchItems(fallbackPodcasts ?? [], 'PODCAST').filter((item) => item.type === 'PODCAST' || item.type === 'EPISODE'),
                        ...this.normalizeSearchItems(creator.podcasts, 'PODCAST').filter((item) => item.type === 'PODCAST' || item.type === 'EPISODE')
                    ]);

                    this.groupedResults = {
                        songs: [],
                        artists: [],
                        albums: [],
                        podcasts: this.rankByTerm(mergedPodcasts, term, ['title', 'subtitle']),
                        playlists: []
                    };
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
        const songsReq = this.browseService.getBrowseSongs().pipe(
            map((response) => this.mapBrowseSongsAsSearchItems(this.extractContentArray(response))),
            catchError(() => of([]))
        );
        const artistsReq = this.browseService.getTopArtists().pipe(
            map((response) => this.mapTopArtistsAsSearchItems(this.extractContentArray(response))),
            catchError(() => of([]))
        );
        const podcastsReq = forkJoin({
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
                    ]).filter((item) => item.type === 'PODCAST' || item.type === 'EPISODE'),
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
            podcasts: this.rankByTerm(normalizedItems.filter((item) => item.type === 'PODCAST' || item.type === 'EPISODE'), term, ['title', 'subtitle']),
            playlists: this.rankByTerm(normalizedPlaylists, term, ['name', 'description'])
        };
    }

    private mergeSearchItems(items: any[]): any[] {
        const seen = new Set<string>();
        const merged: any[] = [];
        for (const item of items ?? []) {
            const type = this.resolveSearchItemType(item);
            const id = this.resolveSearchItemId(item, type);
            if (!type || id <= 0) {
                continue;
            }
            const key = `${type}:${id}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            merged.push(item);
        }
        return merged;
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
            subtitle: item?.artistType ?? (item?.playCount ? `${item.playCount} plays` : '')
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
            coverArtUrl: this.resolveSearchItemCover(item)
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

        return {
            type: 'ARTIST',
            id: resolvedId,
            artistId: resolvedId,
            contentId: resolvedId,
            title,
            subtitle: String(item?.artistType ?? item?.category ?? '').trim(),
            artistName: title
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
        if (['SONG', 'ARTIST', 'ALBUM', 'PODCAST', 'EPISODE', 'PLAYLIST'].includes(rawType)) {
            return rawType;
        }

        if (
            Number(item?.songId ?? item?.trackId ?? 0) > 0 ||
            item?.audioUrl ||
            item?.fileUrl ||
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
        const songId = Number(item?.songId ?? item?.trackId ?? item?.contentId ?? item?.id ?? 0);
        const albumId = Number(item?.albumId ?? item?.album?.albumId ?? item?.album?.id ?? 0);

        const candidates = [
            item?.coverArtUrl,
            item?.coverImageUrl,
            item?.coverUrl,
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
            item?.album?.cover?.fileName,
            item?.album?.coverFileName
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

        return '';
    }

    private normalizeSearchItems(items: any[], preferredType: string = ''): any[] {
        return (items ?? [])
            .map((item) => {
                const type = this.resolveSearchItemType(item, preferredType);
                const id = this.resolveSearchItemId(item, type);
                return {
                    ...item,
                    id,
                    type,
                    songId: type === 'SONG' ? id : Number(item?.songId ?? 0),
                    contentId: Number(item?.contentId ?? id),
                    title: item?.title ?? item?.name ?? 'Untitled',
                    artistName: this.resolveSearchItemSubtitle(item, type),
                    subtitle: this.resolveSearchItemSubtitle(item, type),
                    coverArtUrl: this.resolveSearchItemCover(item),
                    isFollowed: this.resolveFollowState(type, id)
                };
            })
            .filter((item) => Number(item?.id ?? 0) > 0)
            .filter((item) => !this.isSmokeTestContent(item?.title) && !this.isSmokeTestContent(item?.subtitle))
            .filter((item) => !this.isUnplayableSong(item));
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
    }

    private getAlbumId(album: any): number {
        return Number(album?.id ?? album?.albumId ?? album?.contentId ?? 0);
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

            const normalizedAlbumId = this.getAlbumId(albumDetail) || albumId;
            const songs = this.normalizeAlbumSongs(albumDetail?.songs ?? [], albumDetail);
            this.selectedAlbum = {
                ...albumDetail,
                id: normalizedAlbumId,
                title: albumDetail?.title ?? `Album #${normalizedAlbumId}`,
                coverArtUrl: this.resolveImage(
                    albumDetail?.coverArtUrl ?? albumDetail?.coverImageUrl ?? albumDetail?.imageUrl ?? albumDetail?.image ?? ''
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

    private loadAlbumSongsFallback(albumId: number, fromAlbumError: boolean): void {
        forkJoin({
            creatorCatalog: this.loadCreatorFallbackCatalog().pipe(
                catchError(() => of({ songs: [] }))
            ),
            browseSongs: this.browseService.getBrowseSongs().pipe(
                map((response) => this.extractContentArray(response)),
                catchError(() => of([]))
            ),
            seededSongs: this.apiService.get<any>(
                `/search?q=${encodeURIComponent(this.defaultSeedTerm)}&type=SONG&page=0&size=200`
            ).pipe(
                map((response) => this.extractContentArray(response)),
                catchError(() => of([]))
            )
        }).subscribe(({ creatorCatalog, browseSongs, seededSongs }) => {
            if (Number(this.getAlbumId(this.selectedAlbum) ?? 0) !== Number(albumId ?? 0)) {
                return;
            }

            const creator = this.toCreatorCatalog(creatorCatalog);
            const candidates = [
                ...this.normalizeSearchItems(creator.songs ?? [], 'SONG'),
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
        const resolvedArtistId = Number(this.currentArtistId ?? this.resolveCurrentArtistId() ?? 0);
        if (resolvedArtistId > 0) {
            this.currentArtistId = resolvedArtistId;
            return this.fetchCreatorCatalogByArtistId(resolvedArtistId);
        }

        const sessionUser = this.authService.getCurrentUserSnapshot() ?? this.getStoredUser();
        const username = String(sessionUser?.username ?? '').trim();
        if (!username) {
            return of(this.emptyCreatorCatalog());
        }

        return this.artistService.findArtistByUsername(username).pipe(
            map((response: any) => this.pickArtistIdFromSearchResponse(response?.content ?? [], username)),
            catchError(() => of(0)),
            switchMap((artistId: number) => {
                if (artistId <= 0) {
                    return of(this.emptyCreatorCatalog());
                }
                this.currentArtistId = artistId;
                this.stateService.setArtistIdForUser(this.currentUserId, artistId);
                return this.fetchCreatorCatalogByArtistId(artistId);
            }),
            catchError(() => of(this.emptyCreatorCatalog()))
        );
    }

    private fetchCreatorCatalogByArtistId(artistId: number): any {
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
            catchError(() => of(this.emptyCreatorCatalog()))
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

    private emptyCreatorCatalog(): { songs: any[]; albums: any[]; podcasts: any[]; artists: any[] } {
        return { songs: [], albums: [], podcasts: [], artists: [] };
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

        if (!value.includes('/')) {
            return `${environment.apiUrl}/files/images/${encodeURIComponent(value)}`;
        }

        if (value.startsWith('/')) {
            return `${this.apiOrigin}${value}`;
        }

        return value;
    }
}
