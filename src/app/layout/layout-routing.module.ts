import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { MainLayoutComponent } from './main-layout/main-layout.component';
import { RoleGuard } from '../core/guards/role.guard';

const routes: Routes = [
  {
    path: '',
    component: MainLayoutComponent,
    children: [
      {
        path: 'creator-studio',
        canActivate: [RoleGuard],
        data: { roles: ['ARTIST'] },
        loadChildren: () => import('../artist/artist-module').then((m) => m.ArtistModule)
      },
      {
        path: 'artist',
        canActivate: [RoleGuard],
        data: { roles: ['ARTIST'] },
        loadChildren: () => import('../artist/artist-module').then((m) => m.ArtistModule)
      },
      {
        path: 'admin-studio',
        canActivate: [RoleGuard],
        data: { roles: ['ADMIN'] },
        loadChildren: () => import('../admin/admin-module').then((m) => m.AdminModule)
      },
      {
        path: 'admin',
        canActivate: [RoleGuard],
        data: { roles: ['ADMIN'] },
        loadChildren: () => import('../admin/admin-module').then((m) => m.AdminModule)
      },
      {
        path: 'settings',
        loadComponent: () => import('./settings/settings.component').then((m) => m.SettingsComponent)
      },
      {
        path: 'premium',
        loadComponent: () => import('./premium/premium.component').then((m) => m.PremiumComponent)
      },
      {
        path: '',
        loadChildren: () => import('../listener/listener-module').then((m) => m.ListenerModule)
      }
    ]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class LayoutRoutingModule {}
