import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { DashboardComponent } from './dashboard/dashboard.component';
import { ProfileStudioComponent } from './profile-studio/profile-studio.component';
import { UploadSongComponent } from './upload-song/upload-song.component';
import { UploadPodcastComponent } from './upload-podcast/upload-podcast.component';
import { ManageAlbumsComponent } from './manage-albums/manage-albums.component';
import { ManageSongsComponent } from './manage-songs/manage-songs.component';

const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'dashboard', component: DashboardComponent },
  { path: 'profile', component: ProfileStudioComponent },
  { path: 'upload-song', component: UploadSongComponent },
  { path: 'songs', component: ManageSongsComponent },
  { path: 'podcasts', component: UploadPodcastComponent },
  { path: 'upload-podcast', component: UploadPodcastComponent },
  { path: 'manage-albums', component: ManageAlbumsComponent }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ArtistRoutingModule { }
