import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { DashboardComponent } from './dashboard/dashboard.component';
import { ManageUsersComponent } from './manage-users/manage-users.component';
import { ManageGenresComponent } from './manage-genres/manage-genres.component';
import { AuditLogsComponent } from './audit-logs/audit-logs.component';
import { AdminAnalyticsComponent } from './analytics/analytics.component';
import { AdsUploadComponent } from './ads-upload/ads-upload.component';
import { SystemPlaylistsComponent } from './system-playlists/system-playlists.component';

const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'dashboard', component: DashboardComponent },
  { path: 'manage-users', component: ManageUsersComponent },
  { path: 'manage-genres', component: ManageGenresComponent },
  { path: 'audit-logs', component: AuditLogsComponent },
  { path: 'analytics', component: AdminAnalyticsComponent },
  { path: 'ads', component: AdsUploadComponent },
  { path: 'ads-upload', component: AdsUploadComponent },
  { path: 'system-playlists', component: SystemPlaylistsComponent }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class AdminRoutingModule { }
