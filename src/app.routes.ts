import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'create',
    pathMatch: 'full'
  },
  {
    path: 'create',
    loadComponent: () => import('./create/create.component').then(m => m.CreateComponent)
  },
  {
    path: 'library',
    loadComponent: () => import('./library/library.component').then(m => m.LibraryComponent)
  },
  {
    path: 'top-charts',
    loadComponent: () => import('./top-charts/top-charts.component').then(m => m.TopChartsComponent)
  }
];
