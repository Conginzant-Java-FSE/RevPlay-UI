import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { BrowseComponent } from './browse/browse.component';
import { SearchComponent } from './search/search.component';
import { PlaylistsComponent } from './playlists/playlists.component';
import { ProfileComponent } from './profile/profile.component';
import { LikedSongsComponent } from './liked-songs/liked-songs.component';
import { PodcastsComponent } from './podcasts/podcasts.component';
import { MadeForYouComponent } from './made-for-you/made-for-you.component';
import { GenresComponent } from './genres/genres.component';
import { MixPlaylistComponent } from './mix-playlist/mix-playlist.component';

const routes: Routes = [
  { path: '', redirectTo: 'home', pathMatch: 'full' },
  { path: 'home', component: BrowseComponent },
  { path: 'browse', redirectTo: 'home', pathMatch: 'full' },
  { path: 'search', component: SearchComponent },
  { path: 'library', component: PlaylistsComponent },
  { path: 'library/:id', component: PlaylistsComponent },
  { path: 'playlists', redirectTo: 'library', pathMatch: 'full' },
  { path: 'playlists/:id', component: PlaylistsComponent },
  { path: 'liked-songs', component: LikedSongsComponent },
  { path: 'podcasts', component: PodcastsComponent },
  { path: 'made-for-you', component: MadeForYouComponent },
  { path: 'mix/:slug', component: MixPlaylistComponent },
  { path: 'genres', component: GenresComponent },
  { path: 'profile', component: ProfileComponent }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ListenerRoutingModule { }
