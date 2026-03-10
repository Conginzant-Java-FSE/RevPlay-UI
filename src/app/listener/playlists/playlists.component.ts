import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription, combineLatest, forkJoin, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, switchMap } from 'rxjs/operators';
import { ApiService } from '../../core/services/api';
import { PlaylistService } from '../../core/services/playlist.service';
import { PlayerService } from '../../core/services/player.service';
import { FollowingService } from '../../core/services/following.service';
import { LikesService } from '../../core/services/likes.service';
import { shareSongWithFallback } from '../../core/utils/song-share.util';
import { ProtectedMediaPipe } from '../../core/pipes/protected-media.pipe';
import { environment } from '../../../environments/environment';
import { ArtistService } from '../../core/services/artist.service';

type LibraryTab = 'MY' | 'PUBLIC';

@Component({
    selector: 'app-playlists',
    templateUrl: './playlists.component.html',
    styleUrls: ['./playlists.component.scss'],
    standalone: true,
    imports: [CommonModule, RouterModule, FormsModule, ProtectedMediaPipe],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class PlaylistsComponent implements OnInit, OnDestroy {
    activeTab: LibraryTab = 'MY';
    selectedPlaylist: any = null;
    playlistSongsDetailed: any[] = [];
    selectedPlaylistCollageSongs: any[] = [];
    isOwner = false;

    myPlaylists: any[] = [];
    publicPlaylists: any[] = [];

    myPage = 0;
    myTotalPages = 0;
    publicPage = 0;
    publicTotalPages = 0;
    readonly pageSize = 20;

    createForm = {
        name: '',
        description: '',
        isPublic: true
    };
    editForm = {
        name: '',
        description: '',
        isPublic: true
    };

    showCreateForm = false;
    showEditForm = false;
    showFollowedArtists = true;
    showFollowedPodcasts = true;
    isLoading = false;
    isSaving = false;
    isDeleting = false;
    isSongSearchLoading = false;
    error: string | null = null;
    successMessage: string | null = null;

    songSearchQuery = '';
    songSearchResults: any[] = [];
    private songSearchTerms = new Subject<string>();
    private songSearchSub?: Subscription;
    private routeSub?: Subscription;

    private currentUserId: number | null = null;
    private followingByPlaylistId: Record<number, boolean> = {};
    followedArtists: any[] = [];
    followedPodcasts: any[] = [];
    showAddToPlaylistPicker = false;
    songForPlaylistAdd: any | null = null;
    targetPlaylistIdForSongAdd = '';
    playlistTargets: any[] = [];
    private likedSongIds = new Set<number>();
    private likeIdBySongId = new Map<number, number>();

    constructor(
        private playlistService: PlaylistService,
        private playerService: PlayerService,
        private apiService: ApiService,
        private followingService: FollowingService,
        private likesService: LikesService,
        private artistService: ArtistService,
        private route: ActivatedRoute,
        private router: Router,
        private cdr: ChangeDetectorRef
    ) { }

    ngOnInit(): void {
        this.currentUserId = this.resolveCurrentUserId();
        this.loadLikedSongs();
        this.refreshFollowing();
        this.setupSongSearch();

        this.routeSub = combineLatest([this.route.paramMap, this.route.queryParamMap]).subscribe(([params, query]) => {
            const id = Number(params.get('id') ?? 0);
            if (id > 0) {
                this.showCreateForm = false;
                this.loadPlaylist(id);
                return;
            }

            const createParam = (query.get('create') ?? '').toLowerCase();
            this.showCreateForm = createParam === '1' || createParam === 'true';
            this.selectedPlaylist = null;
            this.playlistSongsDetailed = [];
            this.refreshFollowing();
            this.loadLibraryTab(this.activeTab);
        });
    }

    ngOnDestroy(): void {
        this.songSearchSub?.unsubscribe();
        this.routeSub?.unsubscribe();
    }

    openTab(tab: LibraryTab): void {
        if (this.activeTab === tab && !this.selectedPlaylist) {
            return;
        }
        this.activeTab = tab;
        this.clearStatusMessages();

        if (this.selectedPlaylist) {
            this.router.navigate(['/library']);
            return;
        }
        this.loadLibraryTab(tab);
    }

    previousPage(): void {
        if (this.activeTab === 'MY') {
            if (this.myPage <= 0) {
                return;
            }
            this.myPage -= 1;
            this.loadMyPlaylists();
            return;
        }

        if (this.publicPage <= 0) {
            return;
        }
        this.publicPage -= 1;
        this.loadPublicPlaylists();
    }

    nextPage(): void {
        if (this.activeTab === 'MY') {
            if (this.myPage >= this.myTotalPages - 1) {
                return;
            }
            this.myPage += 1;
            this.loadMyPlaylists();
            return;
        }

        if (this.publicPage >= this.publicTotalPages - 1) {
            return;
        }
        this.publicPage += 1;
        this.loadPublicPlaylists();
    }

    openPlaylist(playlist: any): void {
        const playlistId = Number(playlist?.id ?? playlist?.playlistId ?? 0);
        if (!playlistId) {
            return;
        }
        this.router.navigate(['/library', playlistId]);
    }

    isPlaylistOwner(playlist: any): boolean {
        const ownerId = this.resolvePlaylistOwnerId(playlist);
        return !!ownerId && Number(ownerId) === Number(this.currentUserId ?? -1);
    }

    toggleFollowPlaylistFromCard(playlist: any): void {
        const playlistId = Number(playlist?.id ?? 0);
        if (!playlistId || this.isPlaylistOwner(playlist)) {
            return;
        }

        const isFollowing = this.resolvePlaylistFollowState(playlist);
        this.isSaving = true;
        this.clearStatusMessages();
        const request$ = isFollowing
            ? this.playlistService.unfollowPlaylist(playlistId)
            : this.playlistService.followPlaylist(playlistId);

        request$.subscribe({
            next: () => {
                this.isSaving = false;
                this.followingByPlaylistId[playlistId] = !isFollowing;
                playlist.followedByCurrentUser = !isFollowing;
                this.successMessage = isFollowing ? 'Unfollowed playlist.' : 'Followed playlist.';
                this.cdr.markForCheck();
            },
            error: () => {
                this.isSaving = false;
                this.error = isFollowing ? 'Failed to unfollow playlist.' : 'Failed to follow playlist.';
                this.cdr.markForCheck();
            }
        });
    }

    deletePlaylistFromCard(playlist: any): void {
        const playlistId = Number(playlist?.id ?? 0);
        if (!playlistId || !this.isPlaylistOwner(playlist)) {
            return;
        }

        this.isDeleting = true;
        this.clearStatusMessages();
        this.playlistService.deletePlaylist(playlistId).subscribe({
            next: () => {
                this.isDeleting = false;
                this.successMessage = 'Playlist deleted successfully.';
                this.myPlaylists = this.myPlaylists.filter((item) => Number(item?.id ?? 0) !== playlistId);
                this.cdr.markForCheck();
            },
            error: () => {
                this.isDeleting = false;
                this.error = 'Failed to delete playlist.';
                this.cdr.markForCheck();
            }
        });
    }

    backToLibrary(): void {
        this.router.navigate(['/library']);
    }

    toggleCreateForm(): void {
        this.showCreateForm = !this.showCreateForm;
        this.showEditForm = false;
        this.clearStatusMessages();
    }

    toggleFollowedArtistsPanel(): void {
        this.showFollowedArtists = !this.showFollowedArtists;
    }

    toggleFollowedPodcastsPanel(): void {
        this.showFollowedPodcasts = !this.showFollowedPodcasts;
    }

    unfollowArtist(item: any): void {
        const artistId = Number(item?.id ?? 0);
        if (!artistId) {
            return;
        }
        this.followingService.unfollowArtist(artistId);
        this.successMessage = `Unfollowed ${item?.name ?? 'artist'}.`;
        this.refreshFollowing();
        this.cdr.markForCheck();
    }

    unfollowPodcast(item: any): void {
        const podcastId = Number(item?.id ?? 0);
        if (!podcastId) {
            return;
        }
        this.followingService.unfollowPodcast(podcastId);
        this.successMessage = `Unfollowed ${item?.name ?? 'podcast'}.`;
        this.refreshFollowing();
        this.cdr.markForCheck();
    }

    createPlaylist(): void {
        if (!this.createForm.name.trim()) {
            return;
        }

        this.isSaving = true;
        this.clearStatusMessages();
        this.playlistService.createPlaylist(this.createForm).subscribe({
            next: (created) => {
                this.isSaving = false;
                this.showCreateForm = false;
                this.createForm = { name: '', description: '', isPublic: true };
                this.successMessage = 'Playlist created successfully.';
                this.activeTab = 'MY';
                this.myPage = 0;
                this.loadMyPlaylists();

                const createdId = Number(created?.id ?? created?.playlistId ?? 0);
                if (createdId) {
                    this.router.navigate(['/library', createdId]);
                }
                this.cdr.markForCheck();
            },
            error: () => {
                this.isSaving = false;
                this.error = 'Failed to create playlist.';
                this.cdr.markForCheck();
            }
        });
    }

    toggleEditForm(): void {
        if (!this.selectedPlaylist || !this.isOwner) {
            return;
        }
        this.showEditForm = !this.showEditForm;
        this.showCreateForm = false;
        this.clearStatusMessages();
    }

    updatePlaylist(): void {
        const playlistId = Number(this.selectedPlaylist?.id ?? 0);
        if (!playlistId || !this.isOwner || !this.editForm.name.trim()) {
            return;
        }

        this.isSaving = true;
        this.clearStatusMessages();

        this.playlistService.updatePlaylist(playlistId, this.editForm).subscribe({
            next: () => {
                this.isSaving = false;
                this.showEditForm = false;
                this.successMessage = 'Playlist updated successfully.';
                this.selectedPlaylist = {
                    ...this.selectedPlaylist,
                    name: this.editForm.name,
                    description: this.editForm.description,
                    isPublic: this.editForm.isPublic
                };
                this.loadMyPlaylists();
                this.loadPublicPlaylists();
                this.cdr.markForCheck();
            },
            error: () => {
                this.isSaving = false;
                this.error = 'Failed to update playlist.';
                this.cdr.markForCheck();
            }
        });
    }

    deletePlaylist(): void {
        const playlistId = Number(this.selectedPlaylist?.id ?? 0);
        if (!playlistId || !this.isOwner) {
            return;
        }

        this.isDeleting = true;
        this.clearStatusMessages();

        this.playlistService.deletePlaylist(playlistId).subscribe({
            next: () => {
                this.isDeleting = false;
                this.successMessage = 'Playlist deleted successfully.';
                this.router.navigate(['/library']);
                this.loadMyPlaylists();
                this.loadPublicPlaylists();
                this.cdr.markForCheck();
            },
            error: () => {
                this.isDeleting = false;
                this.error = 'Failed to delete playlist.';
                this.cdr.markForCheck();
            }
        });
    }

    playPlaylist(): void {
        if (this.playlistSongsDetailed.length === 0) {
            return;
        }
        this.playerService.playTrack(this.playlistSongsDetailed[0], this.playlistSongsDetailed);
    }

    playTrack(song: any): void {
        this.playerService.playTrack(song, this.playlistSongsDetailed);
    }

    addTrackToQueue(song: any): void {
        this.playerService.addToQueue(song);
    }

    async shareSong(song: any): Promise<void> {
        const result = await shareSongWithFallback({
            songId: Number(song?.songId ?? song?.contentId ?? song?.id ?? 0),
            title: String(song?.title ?? 'Song'),
            artistName: String(song?.artistName ?? '')
        });

        this.clearStatusMessages();

        if (result.status === 'shared') {
            this.successMessage = 'Song share dialog opened.';
            this.cdr.markForCheck();
            return;
        }

        if (result.status === 'copied') {
            this.successMessage = 'Song link copied.';
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

    openAddToPlaylistPicker(song: any): void {
        const songId = Number(song?.songId ?? song?.id ?? 0);
        if (!songId) {
            return;
        }

        this.songForPlaylistAdd = song;
        this.targetPlaylistIdForSongAdd = '';
        this.showAddToPlaylistPicker = true;
        this.clearStatusMessages();

        if (this.playlistTargets.length > 0) {
            this.cdr.markForCheck();
            return;
        }

        this.playlistService.getUserPlaylists(0, 100).subscribe({
            next: (response) => {
                this.playlistTargets = (response?.content ?? []).map((playlist: any) => ({
                    ...playlist,
                    id: Number(playlist?.id ?? playlist?.playlistId ?? 0)
                })).filter((playlist: any) => Number(playlist?.id ?? 0) > 0);
                this.cdr.markForCheck();
            },
            error: () => {
                this.playlistTargets = [];
                this.error = 'Unable to load your playlists for adding this song.';
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
        const songId = Number(this.songForPlaylistAdd?.songId ?? this.songForPlaylistAdd?.id ?? 0);
        const playlistId = Number(this.targetPlaylistIdForSongAdd ?? 0);
        if (!songId || !playlistId) {
            this.error = 'Please select a playlist.';
            this.cdr.markForCheck();
            return;
        }

        this.isSaving = true;
        this.clearStatusMessages();
        this.playlistService.addSongToPlaylist(playlistId, songId).subscribe({
            next: () => {
                this.isSaving = false;
                this.successMessage = 'Song added to playlist.';
                this.closeAddToPlaylistPicker();
                this.cdr.markForCheck();
            },
            error: () => {
                this.isSaving = false;
                this.error = 'Failed to add song to selected playlist.';
                this.cdr.markForCheck();
            }
        });
    }

    addSongToLikedSongs(song: any): void {
        this.toggleSongLike(song);
    }



    isSongLiked(song: any): boolean {
        const songId = Number(song?.songId ?? song?.id ?? 0);
        return songId > 0 && this.likedSongIds.has(songId);
    }

    toggleSongLike(song: any): void {
        const songId = Number(song?.songId ?? song?.id ?? 0);
        if (!songId || !this.currentUserId) {
            this.error = 'User session not found.';
            this.cdr.markForCheck();
            return;
        }

        this.clearStatusMessages();

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
                        this.successMessage = 'Removed from liked songs.';
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
                this.successMessage = 'Added to liked songs.';
                this.cdr.markForCheck();
            },
            error: () => {
                this.error = 'Failed to add this song to liked songs.';
                this.cdr.markForCheck();
            }
        });
    }

    goToAlbum(song: any): void {
        const albumId = Number(song?.albumId ?? 0);
        if (albumId > 0) {
            this.router.navigate(['/search'], {
                queryParams: {
                    type: 'ALBUM',
                    albumId
                }
            });
            return;
        }

        this.error = 'Album details are not available for this song.';
        this.cdr.markForCheck();
    }

    goToArtist(song: any): void {
        const artistName = String(song?.artistName ?? '').trim();
        if (!artistName) {
            this.error = 'Artist details are not available for this song.';
            this.cdr.markForCheck();
            return;
        }

        this.router.navigate(['/search'], {
            queryParams: {
                q: artistName,
                type: 'ARTIST'
            }
        });
    }

    onSongSearchInput(value: string): void {
        this.songSearchQuery = value;
        this.songSearchTerms.next(value);
    }

    addSongToPlaylist(song: any): void {
        const playlistId = Number(this.selectedPlaylist?.id ?? 0);
        const songId = Number(song?.songId ?? song?.contentId ?? song?.id ?? 0);
        if (!playlistId || !songId || !this.isOwner) {
            return;
        }

        this.isSaving = true;
        this.clearStatusMessages();
        this.playlistService.addSongToPlaylist(playlistId, songId).subscribe({
            next: () => {
                this.isSaving = false;
                this.songSearchQuery = '';
                this.songSearchResults = [];
                this.successMessage = 'Song added to playlist.';
                this.reloadCurrentPlaylist();
            },
            error: () => {
                this.isSaving = false;
                this.error = 'Failed to add song to playlist.';
                this.cdr.markForCheck();
            }
        });
    }

    removeSongFromPlaylist(song: any): void {
        const playlistId = Number(this.selectedPlaylist?.id ?? 0);
        const songId = Number(song?.songId ?? song?.id ?? 0);
        if (!playlistId || !songId || !this.isOwner) {
            return;
        }

        this.playlistService.removeSongFromPlaylist(playlistId, songId).subscribe({
            next: () => {
                this.successMessage = 'Song removed from playlist.';
                this.reloadCurrentPlaylist();
            },
            error: () => {
                this.error = 'Failed to remove song from playlist.';
                this.cdr.markForCheck();
            }
        });
    }

    isSongInCurrentPlaylist(song: any): boolean {
        const songId = Number(song?.songId ?? song?.id ?? 0);
        if (!songId) {
            return false;
        }
        return (this.playlistSongsDetailed ?? []).some((item) => Number(item?.songId ?? item?.id ?? 0) === songId);
    }

    reorderSong(index: number, direction: 'UP' | 'DOWN'): void {
        if (!this.isOwner || !this.selectedPlaylist) {
            return;
        }

        const targetIndex = direction === 'UP' ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= this.playlistSongsDetailed.length) {
            return;
        }

        const reordered = [...this.playlistSongsDetailed];
        const temp = reordered[index];
        reordered[index] = reordered[targetIndex];
        reordered[targetIndex] = temp;

        this.playlistSongsDetailed = reordered;
        this.persistSongOrder();
    }

    followOrUnfollow(): void {
        if (!this.selectedPlaylist || this.isOwner) {
            return;
        }

        const playlistId = Number(this.selectedPlaylist?.id ?? 0);
        const isFollowing = this.isFollowing(playlistId);
        this.isSaving = true;
        this.clearStatusMessages();

        const request$ = isFollowing
            ? this.playlistService.unfollowPlaylist(playlistId)
            : this.playlistService.followPlaylist(playlistId);

        request$.subscribe({
            next: () => {
                this.isSaving = false;
                this.followingByPlaylistId[playlistId] = !isFollowing;
                const delta = isFollowing ? -1 : 1;
                this.selectedPlaylist = {
                    ...this.selectedPlaylist,
                    followerCount: Math.max(0, Number(this.selectedPlaylist?.followerCount ?? 0) + delta)
                };
                this.successMessage = isFollowing ? 'Playlist unfollowed.' : 'Playlist followed.';
                this.cdr.markForCheck();
            },
            error: () => {
                this.isSaving = false;
                this.error = isFollowing ? 'Failed to unfollow playlist.' : 'Failed to follow playlist.';
                this.cdr.markForCheck();
            }
        });
    }

    isFollowing(playlistId: number): boolean {
        return !!this.followingByPlaylistId[playlistId];
    }

    formatDuration(seconds?: number): string {
        if (!seconds || seconds < 1) {
            return '0:00';
        }
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    private loadLibraryTab(tab: LibraryTab): void {
        if (tab === 'MY') {
            this.loadMyPlaylists();
            return;
        }
        this.loadPublicPlaylists();
    }

    private loadMyPlaylists(): void {
        this.isLoading = true;
        this.playlistService.getUserPlaylists(this.myPage, this.pageSize).subscribe({
            next: (response) => {
                this.myPlaylists = response?.content ?? [];
                this.hydratePlaylistCovers(this.myPlaylists);
                this.myPage = Number(response?.page ?? this.myPage);
                this.myTotalPages = Number(response?.totalPages ?? 0);
                this.isLoading = false;
                this.cdr.markForCheck();
            },
            error: () => {
                this.isLoading = false;
                this.error = 'Failed to load your playlists.';
                this.cdr.markForCheck();
            }
        });
    }

    private loadPublicPlaylists(): void {
        this.isLoading = true;
        this.playlistService.getPublicPlaylists(this.publicPage, this.pageSize).subscribe({
            next: (response) => {
                this.publicPlaylists = response?.content ?? [];
                this.hydratePlaylistCovers(this.publicPlaylists);
                this.publicPage = Number(response?.page ?? this.publicPage);
                this.publicTotalPages = Number(response?.totalPages ?? 0);
                this.isLoading = false;
                this.cdr.markForCheck();
            },
            error: () => {
                this.isLoading = false;
                this.error = 'Failed to load public playlists.';
                this.cdr.markForCheck();
            }
        });
    }

    private loadPlaylist(playlistId: number): void {
        this.isLoading = true;
        this.clearStatusMessages();
        this.playlistService.getPlaylistById(playlistId).subscribe({
            next: (playlist) => {
                this.selectedPlaylist = playlist;
                this.isOwner = Number(playlist?.userId ?? 0) === Number(this.currentUserId ?? -1);
                this.followingByPlaylistId[playlistId] = this.resolvePlaylistFollowState(playlist);
                this.editForm = {
                    name: playlist?.name ?? '',
                    description: playlist?.description ?? '',
                    isPublic: !!playlist?.isPublic
                };

                const songs = playlist?.songs ?? [];
                if (songs.length === 0) {
                    this.playlistSongsDetailed = [];
                    this.selectedPlaylistCollageSongs = [];
                    this.isLoading = false;
                    this.cdr.markForCheck();
                    return;
                }
                this.selectedPlaylistCollageSongs = this.buildCollageSongs(songs);

                const requests = songs.map((playlistSong: any) =>
                    this.playlistService.getSongById(Number(playlistSong?.songId ?? 0)).pipe(
                        map((song) => ({
                            ...song,
                            id: Number(song?.songId ?? playlistSong?.songId ?? 0),
                            songId: Number(song?.songId ?? playlistSong?.songId ?? 0),
                            title: song?.title ?? `Song #${playlistSong?.songId}`,
                            artistName: song?.artistName ?? `Artist #${song?.artistId ?? ''}`,
                            artistId: Number(song?.artistId ?? 0),
                            albumId: Number(song?.albumId ?? 0),
                            durationSeconds: Number(song?.durationSeconds ?? 0),
                            fileUrl: song?.fileUrl ?? '',
                            imageFileName: song?.imageFileName ?? playlistSong?.imageFileName ?? null,
                            coverImageFileName: song?.coverImageFileName ?? playlistSong?.coverImageFileName ?? null,
                            coverImageUrl: song?.coverImageUrl ?? playlistSong?.coverImageUrl ?? playlistSong?.imageUrl ?? null,
                            position: Number(playlistSong?.position ?? 0)
                        })),
                        catchError(() =>
                            of({
                                id: Number(playlistSong?.songId ?? 0),
                                songId: Number(playlistSong?.songId ?? 0),
                                title: `Song #${playlistSong?.songId}`,
                                artistName: '',
                                artistId: 0,
                                albumId: 0,
                                durationSeconds: 0,
                                position: Number(playlistSong?.position ?? 0)
                            })
                        )
                    )
                );

                forkJoin(requests).subscribe({
                    next: (songsDetailed) => {
                        const resolvedSongs = (songsDetailed as any[]).filter((song) => !!song);
                        this.playlistSongsDetailed = [...resolvedSongs]
                            .sort((a, b) => a.position - b.position);
                        this.selectedPlaylistCollageSongs = this.buildCollageSongs(this.playlistSongsDetailed);
                        this.loadAlbumCoverFallback(this.playlistSongsDetailed);
                        this.isLoading = false;
                        this.cdr.markForCheck();
                    },
                    error: () => {
                        this.playlistSongsDetailed = [];
                        this.selectedPlaylistCollageSongs = [];
                        this.isLoading = false;
                        this.cdr.markForCheck();
                    }
                });
            },
            error: () => {
                this.isLoading = false;
                this.error = 'Failed to load playlist.';
                this.cdr.markForCheck();
            }
        });
    }

    private reloadCurrentPlaylist(): void {
        const playlistId = Number(this.selectedPlaylist?.id ?? 0);
        if (!playlistId) {
            this.cdr.markForCheck();
            return;
        }
        this.loadPlaylist(playlistId);
    }

    private persistSongOrder(): void {
        const playlistId = Number(this.selectedPlaylist?.id ?? 0);
        if (!playlistId || !this.isOwner) {
            return;
        }

        const songs = this.playlistSongsDetailed.map((song, idx) => ({
            songId: Number(song?.songId ?? song?.id ?? 0),
            position: idx + 1
        }));

        this.playlistService.reorderPlaylistSongs(playlistId, songs).subscribe({
            next: () => {
                this.successMessage = 'Playlist order updated.';
                this.cdr.markForCheck();
            },
            error: () => {
                this.error = 'Failed to reorder songs.';
                this.reloadCurrentPlaylist();
            }
        });
    }

    private setupSongSearch(): void {
        this.songSearchSub = this.songSearchTerms.pipe(
            debounceTime(350),
            distinctUntilChanged(),
            switchMap((query) => {
                const term = query.trim();
                if (!term || !this.selectedPlaylist || !this.isOwner) {
                    this.songSearchResults = [];
                    this.isSongSearchLoading = false;
                    this.cdr.markForCheck();
                    return of([]);
                }

                this.isSongSearchLoading = true;
                this.cdr.markForCheck();
                return this.apiService.get<any>(
                    `/search?q=${encodeURIComponent(term)}&type=SONG&page=0&size=8`
                ).pipe(
                    map((response) => (response?.content ?? []).map((item: any) => ({
                        id: Number(item?.contentId ?? item?.songId ?? item?.id ?? 0),
                        songId: Number(item?.contentId ?? item?.songId ?? item?.id ?? 0),
                        title: item?.title ?? 'Untitled',
                        artistName: item?.artistName ?? ''
                    }))),
                    catchError(() => of([]))
                );
            })
        ).subscribe((results) => {
            this.songSearchResults = results;
            this.isSongSearchLoading = false;
            this.cdr.markForCheck();
        });
    }

    private clearStatusMessages(): void {
        this.error = null;
        this.successMessage = null;
    }

    private refreshFollowing(): void {
        this.followedArtists = this.followingService.getFollowedArtists();
        this.followedPodcasts = this.followingService.getFollowedPodcasts();
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

    private unlikeSong(songId: number, likeId: number): void {
        this.likesService.unlikeByLikeId(likeId).subscribe({
            next: () => {
                this.likedSongIds.delete(songId);
                this.likeIdBySongId.delete(songId);
                this.successMessage = 'Removed from liked songs.';
                this.cdr.markForCheck();
            },
            error: () => {
                this.error = 'Failed to remove this song from liked songs.';
                this.cdr.markForCheck();
            }
        });
    }


    private resolveCurrentUserId(): number | null {
        const rawUser = localStorage.getItem('revplay_user');
        if (!rawUser) {
            return null;
        }

        try {
            const user = JSON.parse(rawUser);
            const id = Number(user?.userId ?? user?.id ?? 0);
            return id > 0 ? id : null;
        } catch {
            return null;
        }
    }

    resolvePlaylistFollowState(playlist: any): boolean {
        const candidates = [
            playlist?.isFollowing,
            playlist?.following,
            playlist?.followedByCurrentUser
        ];
        for (const candidate of candidates) {
            if (typeof candidate === 'boolean') {
                return candidate;
            }
        }
        return !!this.followingByPlaylistId[Number(playlist?.id ?? 0)];
    }

    private resolvePlaylistOwnerId(playlist: any): number {
        const candidates = [
            playlist?.userId,
            playlist?.ownerId,
            playlist?.createdById,
            playlist?.createdBy,
            playlist?.user?.id,
            playlist?.user?.userId
        ];
        for (const value of candidates) {
            const id = Number(value ?? 0);
            if (id > 0) {
                return id;
            }
        }
        return 0;
    }

    private hydratePlaylistCovers(playlists: any[]): void {
        if (!Array.isArray(playlists) || playlists.length === 0) {
            return;
        }

        const targets = playlists.filter((playlist) => {
            if (!playlist) {
                return false;
            }
            const count = Number(playlist?.songCount ?? playlist?.songs?.length ?? 0);
            return count > 0;
        });

        if (targets.length === 0) {
            return;
        }

        const requests = targets.map((playlist) =>
            this.loadPlaylistCollageSongs(playlist).pipe(
                catchError(() => of({ playlistId: Number(playlist?.id ?? 0), songs: [] }))
            )
        );

        forkJoin(requests).subscribe((results) => {
            for (const result of results ?? []) {
                const playlistId = Number(result?.playlistId ?? 0);
                if (!playlistId) {
                    continue;
                }
                const match = playlists.find((playlist) => Number(playlist?.id ?? 0) === playlistId);
                if (!match) {
                    continue;
                }
                const songs = Array.isArray(result?.songs) ? result.songs : [];
                if (songs.length > 0) {
                    match.collageSongs = songs;
                }
                if (!this.resolvePlaylistImage(match) && songs.length > 0) {
                    match.coverImageUrl = songs[0]?.coverImage ?? '';
                }
            }
            this.cdr.markForCheck();
        });
    }

    private loadPlaylistCollageSongs(playlist: any) {
        const playlistId = Number(playlist?.id ?? 0);
        if (!playlistId) {
            return of({ playlistId, songs: [] as any[] });
        }

        const baseSongs = Array.isArray(playlist?.songs) ? playlist.songs : null;
        const source$ = baseSongs
            ? of(baseSongs)
            : this.playlistService.getPlaylistById(playlistId).pipe(
                map((details) => (details?.songs ?? [])),
                catchError(() => of([]))
            );

        return source$.pipe(
            switchMap((songs) => {
                const ordered = [...(songs ?? [])].sort((a, b) => Number(a?.position ?? 0) - Number(b?.position ?? 0));
                const orderedTop = ordered.slice(0, 4);
                const fallbackCovers = orderedTop
                    .map((song) => ({
                        id: Number(song?.songId ?? song?.id ?? 0),
                        coverImage: this.resolveSongImage(song)
                    }))
                    .filter((item) => item.id > 0 && !!item.coverImage);

                if (fallbackCovers.length > 0) {
                    return of({ playlistId, songs: fallbackCovers });
                }

                const songIds = orderedTop
                    .map((song) => Number(song?.songId ?? song?.id ?? 0))
                    .filter((id) => id > 0);

                if (songIds.length === 0) {
                    return of({ playlistId, songs: [] as any[] });
                }

                const sourceById = new Map<number, any>(
                    orderedTop.map((song) => [Number(song?.songId ?? song?.id ?? 0), song])
                );

                return forkJoin(
                    songIds.map((songId) =>
                        this.playlistService.getSongById(songId).pipe(
                            map((song) => {
                                const coverImage = this.resolveSongImage(song) || this.resolveSongImage(sourceById.get(songId));
                                return {
                                    id: Number(song?.songId ?? songId),
                                    albumId: Number(song?.albumId ?? 0),
                                    coverImage
                                };
                            }),
                            catchError(() => of(null))
                        )
                    )
                ).pipe(
                    switchMap((items) => {
                        const resolved = (items ?? []).filter((item) => !!item) as Array<{ id: number; albumId: number; coverImage: string }>;
                        const covers = resolved.filter((item) => !!item.coverImage);
                        if (covers.length > 0) {
                            return of({
                                playlistId,
                                songs: covers
                            });
                        }

                        const albumIds = Array.from(new Set(resolved.map((item) => item.albumId).filter((id) => id > 0))).slice(0, 4);
                        if (albumIds.length === 0) {
                            return of({ playlistId, songs: [] as any[] });
                        }

                        return forkJoin(
                            albumIds.map((albumId) =>
                                this.artistService.getAlbum(albumId).pipe(
                                    map((album) => ({
                                        albumId,
                                        cover: this.artistService.resolveImageUrl(
                                            album?.coverArtUrl ??
                                            album?.coverImageUrl ??
                                            album?.imageUrl ??
                                            ''
                                        )
                                    })),
                                    catchError(() => of({ albumId, cover: '' }))
                                )
                            )
                        ).pipe(
                            map((results) => ({
                                playlistId,
                                songs: (results ?? [])
                                    .filter((item) => !!item.cover)
                                    .slice(0, 4)
                                    .map((item) => ({
                                        id: Number(item.albumId),
                                        coverImage: item.cover
                                    }))
                            }))
                        );
                    })
                );
            })
        );
    }

    private getPlaylistCoverSongId(playlist: any) {
        const directSongId = this.resolveFirstSongId(playlist);
        if (directSongId) {
            return of(directSongId);
        }

        const count = Number(playlist?.songCount ?? 0);
        const playlistId = Number(playlist?.id ?? 0);
        if (count <= 0 || !playlistId) {
            return of(0);
        }

        return this.playlistService.getPlaylistById(playlistId).pipe(
            map((playlistDetails) => this.resolveFirstSongId(playlistDetails)),
            catchError(() => of(0))
        );
    }

    private resolveFirstSongId(playlist: any): number {
        const direct = Number(playlist?.firstSongId ?? playlist?.songId ?? 0);
        if (direct > 0) {
            return direct;
        }

        const songs = Array.isArray(playlist?.songs) ? playlist.songs : [];
        if (songs.length === 0) {
            return 0;
        }

        const ordered = [...songs].sort((a, b) => Number(a?.position ?? 0) - Number(b?.position ?? 0));
        const candidate = ordered[0];
        return Number(candidate?.songId ?? candidate?.id ?? 0);
    }

    private resolvePlaylistImage(playlist: any): string {
        return String(
            playlist?.coverImageUrl ??
            playlist?.imageUrl ??
            playlist?.coverUrl ??
            playlist?.thumbnailUrl ??
            ''
        ).trim();
    }

    private resolveSongImage(song: any): string {
        const candidates = [
            song?.imageUrl,
            song?.coverImageUrl,
            song?.coverUrl,
            song?.coverArtUrl,
            song?.thumbnailUrl,
            song?.image,
            song?.artworkUrl,
            song?.imageFileName,
            song?.coverImageFileName,
            song?.coverFileName,
            song?.imageName,
            song?.album?.coverImageUrl,
            song?.album?.coverArtUrl,
            song?.album?.imageUrl,
            song?.album?.cover?.imageUrl,
            song?.album?.cover?.fileName,
            song?.album?.coverFileName,
            song?.album?.coverImageFileName,
            song?.album?.imageFileName
        ];

        for (const candidate of candidates) {
            const resolved = this.resolveSongImageCandidate(candidate);
            if (resolved) {
                return resolved;
            }
        }

        return '';
    }

    private resolveImageFileUrl(fileName: string): string {
        const safeName = String(fileName ?? '').trim();
        if (!safeName) {
            return '';
        }
        return this.artistService.getImageUrlByFileName(safeName);
    }

    private resolveSongImageCandidate(candidate: any): string {
        const value = String(candidate ?? '').trim();
        if (value && value !== '[object Object]') {
            const resolved = this.artistService.resolveImageUrl(value);
            if (resolved) {
                return resolved;
            }
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
            candidate?.downloadUrl,
            candidate?.downloadUri,
            candidate?.fileDownloadUri
        ];

        for (const nested of nestedCandidates) {
            const resolved = this.resolveSongImageCandidate(nested);
            if (resolved) {
                return resolved;
            }
        }

        return '';
    }

    private buildCollageSongs(songs: any[]): any[] {
        if (!Array.isArray(songs) || songs.length === 0) {
            return [];
        }
        const ordered = [...songs].sort((a, b) => Number(a?.position ?? 0) - Number(b?.position ?? 0));
        const selected = ordered.slice(0, 4);
        return selected
            .map((song) => ({
                id: Number(song?.songId ?? song?.id ?? 0),
                coverImage: this.resolveSongImage(song)
            }))
            .filter((item) => item.id > 0 && !!item.coverImage);
    }

    private loadAlbumCoverFallback(songs: any[]): void {
        if (this.selectedPlaylistCollageSongs.length > 0) {
            return;
        }

        const albumIds = Array.from(
            new Set(
                (songs ?? [])
                    .map((song) => Number(song?.albumId ?? 0))
                    .filter((id) => id > 0)
            )
        ).slice(0, 4);

        if (albumIds.length === 0) {
            return;
        }

        forkJoin(
            albumIds.map((albumId) =>
                this.artistService.getAlbum(albumId).pipe(
                    map((album) => ({
                        albumId,
                        cover: this.artistService.resolveImageUrl(
                            album?.coverArtUrl ??
                            album?.coverImageUrl ??
                            album?.imageUrl ??
                            ''
                        )
                    })),
                    catchError(() => of({ albumId, cover: '' }))
                )
            )
        ).subscribe((results) => {
            const covers = (results ?? [])
                .filter((item) => !!item.cover)
                .slice(0, 4)
                .map((item) => ({
                    id: Number(item.albumId),
                    coverImage: item.cover
                }));

            if (covers.length > 0) {
                this.selectedPlaylistCollageSongs = covers;
                this.cdr.markForCheck();
            }
        });
    }
}
