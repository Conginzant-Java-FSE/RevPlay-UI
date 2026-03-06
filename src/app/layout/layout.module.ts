import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LayoutRoutingModule } from './layout-routing.module';
import { MainLayoutComponent } from './main-layout/main-layout.component';
import { SidebarComponent } from './sidebar/sidebar.component';
import { NavbarComponent } from './navbar/navbar.component';
import { PlayerComponent } from './player/player.component';

@NgModule({
    imports: [
        CommonModule,
        LayoutRoutingModule,
        MainLayoutComponent,
        SidebarComponent,
        NavbarComponent,
        PlayerComponent
    ],
    exports: [
        MainLayoutComponent
    ]
})
export class LayoutModule { }
