import { Component, ChangeDetectionStrategy, inject, signal, effect, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterOutlet, RouterLink, RouterLinkActive, NavigationStart, NavigationEnd, NavigationCancel, NavigationError } from '@angular/router';
import { SupabaseService } from './services/supabase.service';
import { MusicPlayerService } from './services/music-player.service';
import { MusicPlayerComponent } from './library/music-player/music-player.component';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, MusicPlayerComponent],
  host: {
    '(window:keydown)': 'handleKeyDown($event)'
  }
})
export class AppComponent {
  private readonly supabaseService = inject(SupabaseService);
  private readonly router: Router = inject(Router);
  readonly musicPlayerService = inject(MusicPlayerService);

  authReady = this.supabaseService.authReady;
  isSupabaseConfigured = this.supabaseService.isConfigured;
  currentUser = this.supabaseService.currentUser;
  currentUserProfile = this.supabaseService.currentUserProfile;
  isProfileMenuOpen = signal(false);

  currentMusic = this.musicPlayerService.currentMusic;
  unreadNotificationsCount = this.supabaseService.unreadNotificationsCount;

  userInitial = computed(() => {
    const profile = this.currentUserProfile();
    const name = profile?.display_name;
    if (name && name.trim().length > 0) {
      return name.trim().charAt(0).toUpperCase();
    }
    const email = profile?.email || this.currentUser()?.email;
    if (email) {
      return email.charAt(0).toUpperCase();
    }
    return '?';
  });

  avatarColor = computed(() => {
    const userId = this.currentUser()?.id;
    if (!userId) {
      return 'bg-zinc-700'; // Fallback color
    }
    return 'bg-teal-500';
  });

  isCreateActive = computed(() => this.router.isActive('/create', {
    paths: 'exact',
    queryParams: 'subset',
    fragment: 'ignored',
    matrixParams: 'ignored'
  }));

  constructor() {
    effect(() => {
      const user = this.currentUser();
      const ready = this.authReady();
    
      if (!ready) return;
    
      // Capture current query params, especially 'play_music_id'
      const currentUrlTree = this.router.parseUrl(this.router.url);
      const currentQueryParams = currentUrlTree.queryParams;

      // Extract the primary Angular hash route (e.g., '/auth', '/feed', '/auth/callback')
      // This ignores any subsequent hash fragments from Supabase (e.g., #access_token=...)
      const pathSegments = this.router.url.split('#');
      const primaryAngularHash = pathSegments.length > 1 ? `/${pathSegments[1].split('?')[0].split('#')[0]}` : '/';

      const onAuthRelatedRoute = 
        primaryAngularHash === '/auth' || 
        primaryAngularHash === '/auth/callback' || 
        primaryAngularHash === '/';

      if (user) {
        if (primaryAngularHash !== '/feed') { // If user is logged in and not on feed
          // Redirect to /feed, preserving existing query parameters
          this.router.navigate(['/feed'], { queryParams: currentQueryParams, replaceUrl: true });
        }
      } else {
        if (primaryAngularHash !== '/' && primaryAngularHash !== '/auth') { // If no user and not on root or auth page
          // Navigate to root (login) page, preserving query params
          this.router.navigate(['/'], { queryParams: currentQueryParams, replaceUrl: true });
        }
      }
    });
  }

  handleKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (['INPUT', 'TEXTAREA'].includes(target.tagName)) return;

    if (event.key === 'Escape' && this.isProfileMenuOpen()) {
      this.isProfileMenuOpen.set(false);
      return;
    }

    switch (event.key.toUpperCase()) {
      case 'C': this.router.navigate(['/create']); break;
      case 'L': this.router.navigate(['/library']); break;
      case 'H': this.router.navigate(['/feed']); break;
      case 'S': this.router.navigate(['/subscribe']); break;
    }

    if (this.currentMusic()) {
      switch (event.key) {
        case ' ': event.preventDefault(); this.musicPlayerService.togglePlayPause(); break;
        case 'ArrowRight': this.musicPlayerService.playNext(); break;
        case 'ArrowLeft': this.musicPlayerService.playPrev(); break;
      }
    }
  }

  toggleProfileMenu(): void {
    this.isProfileMenuOpen.update(v => !v);
  }

  async signOut() {
    this.isProfileMenuOpen.set(false);
    this.musicPlayerService.closePlayer();
    await this.supabaseService.signOut();
  }

  getCoverArt(title: string): string {
    return `https://picsum.photos/seed/art-${title}/1280/720`;
  }
}