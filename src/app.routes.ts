import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    // Carrega o componente de autenticação na raiz para usuários desconectados.
    loadComponent: () => import('./auth/auth.component').then(m => m.AuthComponent)
  },
  {
    path: 'auth',
    loadComponent: () => import('./auth/auth.component').then(m => m.AuthComponent)
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
    path: 'feed',
    loadComponent: () => import('./feed/feed.component').then(m => m.FeedComponent)
  },
  {
    path: 'subscribe',
    loadComponent: () => import('./subscribe/subscribe.component').then(m => m.SubscribeComponent)
  },
  {
    path: 'account',
    loadComponent: () => import('./account/account.component').then(m => m.AccountComponent)
  },
  {
    path: 'shortcuts',
    loadComponent: () => import('./shortcuts/shortcuts.component').then(m => m.ShortcutsComponent)
  },
  {
    path: 'usage',
    loadComponent: () => import('./usage/usage.component').then(m => m.UsageComponent)
  }
];