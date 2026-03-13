import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ActivatedRoute } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';

import { SearchComponent } from './search.component';

import { HttpClientTestingModule } from '@angular/common/http/testing';
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

describe('SearchComponent', () => {
  let component: SearchComponent;
  let fixture: ComponentFixture<SearchComponent>;

  beforeEach(async () => {
    const emptyPage = { content: [], totalElements: 0, totalPages: 0 };

    const authSpy = jasmine.createSpyObj('AuthService', ['getCurrentUserSnapshot', 'updateCurrentUser']);
    authSpy.getCurrentUserSnapshot.and.returnValue(null);

    const apiSpy = jasmine.createSpyObj('ApiService', ['get']);
    apiSpy.get.and.returnValue(of(emptyPage));

    const playerSpy = jasmine.createSpyObj('PlayerService', ['playTrack', 'addToQueue']);

    const stateSpy = jasmine.createSpyObj('StateService', ['setSearchQuery', 'getArtistIdForUser', 'setArtistIdForUser']);
    stateSpy.getArtistIdForUser.and.returnValue(null);
    stateSpy.artistId = null;

    const genreSpy = jasmine.createSpyObj('GenreService', ['clearCache', 'getAllGenres']);
    genreSpy.getAllGenres.and.returnValue(of([]));

    const playlistSpy = jasmine.createSpyObj('PlaylistService', ['getUserPlaylists', 'addSongToPlaylist']);
    playlistSpy.getUserPlaylists.and.returnValue(of(emptyPage));
    playlistSpy.addSongToPlaylist.and.returnValue(of({}));

    const likesSpy = jasmine.createSpyObj('LikesService', ['getUserLikes', 'getSongLikeId', 'likeSong', 'unlikeByLikeId']);
    likesSpy.getUserLikes.and.returnValue(of([]));
    likesSpy.getSongLikeId.and.returnValue(of(null));
    likesSpy.likeSong.and.returnValue(of(null));
    likesSpy.unlikeByLikeId.and.returnValue(of(null));

    const premiumSpy: any = { isPremiumUser: false };

    const artistSpy: any = jasmine.createSpyObj('ArtistService', [
      'getPodcastEpisodes',
      'getArtistProfile',
      'getArtistSongs',
      'getArtistAlbums',
      'getArtistPodcasts',
      'findArtistByUsername',
      'getAlbum',
      'getCachedSongImage',
      'getCachedAlbumImage',
      'resolveImageUrl'
    ]);
    artistSpy.getPodcastEpisodes.and.returnValue(of(emptyPage));
    artistSpy.getArtistProfile.and.returnValue(of({}));
    artistSpy.getArtistSongs.and.returnValue(of(emptyPage));
    artistSpy.getArtistAlbums.and.returnValue(of(emptyPage));
    artistSpy.getArtistPodcasts.and.returnValue(of(emptyPage));
    artistSpy.findArtistByUsername.and.returnValue(of(null));
    artistSpy.getAlbum.and.returnValue(of(null));
    artistSpy.getCachedSongImage.and.returnValue(null);
    artistSpy.getCachedAlbumImage.and.returnValue(null);
    artistSpy.resolveImageUrl.and.returnValue('');

    const browseSpy = jasmine.createSpyObj('BrowseService', [
      'getSongById',
      'getBrowseSongs',
      'getTopArtists',
      'getPopularPodcasts',
      'getRecommendedPodcasts',
      'getArtistById'
    ]);
    browseSpy.getSongById.and.returnValue(of(null));
    browseSpy.getBrowseSongs.and.returnValue(of(emptyPage));
    browseSpy.getTopArtists.and.returnValue(of(emptyPage));
    browseSpy.getPopularPodcasts.and.returnValue(of(emptyPage));
    browseSpy.getRecommendedPodcasts.and.returnValue(of(emptyPage));
    browseSpy.getArtistById.and.returnValue(of(null));

    const followingSpy: any = jasmine.createSpyObj('FollowingService', [
      'toggleArtist',
      'togglePodcast',
      'isArtistFollowed',
      'isPodcastFollowed'
    ]);
    followingSpy.toggleArtist.and.returnValue(of({}));
    followingSpy.togglePodcast.and.returnValue(of({}));
    followingSpy.isArtistFollowed.and.returnValue(false);
    followingSpy.isPodcastFollowed.and.returnValue(false);

    await TestBed.configureTestingModule({
      imports: [SearchComponent, HttpClientTestingModule, RouterTestingModule],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null }, paramMap: { get: () => null }, data: {} }, queryParamMap: of({ get: () => null }), paramMap: of({ get: () => null }), queryParams: of({}), params: of({}), data: of({}) } }
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SearchComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});










