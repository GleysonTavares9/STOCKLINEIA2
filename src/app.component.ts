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
    // Attempt to manually parse hash for tokens to handle "Double Hash" issue
    // where Angular Router + Supabase OAuth redirect creates /#/auth/callback#access_token=...
    this.handleHashSession();

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
        if (primaryAngularHash !== '/' && primaryAngularHash !== '/auth' && primaryAngularHash !== '/auth/callback') { // If no user and not on root, auth, or callback
          // Navigate to root (login) page, preserving query params
          this.router.navigate(['/'], { queryParams: currentQueryParams, replaceUrl: true });
        }
      }
    });
  }

  private async handleHashSession() {
    const hash = window.location.hash;
    // Check if we have access_token in the hash. 
    // It might be plain #access_token=... (if redirected to root) 
    // or #/auth/callback#access_token=... (if redirected to callback route)
    if (hash && hash.includes('access_token=')) {
        console.log('AppComponent: Detected OAuth tokens in hash. Attempting manual session recovery...');
        
        // We need to extract the part starting from access_token=
        // Regex is robust enough to find it anywhere in the string
        const accessTokenMatch = hash.match(/access_token=([^&]+)/);
        const refreshTokenMatch = hash.match(/refresh_token=([^&]+)/);
        
        if (accessTokenMatch && refreshTokenMatch) {
            const accessToken = accessTokenMatch[1];
            const refreshToken = refreshTokenMatch[1];
            
            console.log('AppComponent: Tokens extracted. Calling setSession manually.');
            
            // Manually set the session. This bypasses the need for the router 
            // or supabase-js auto-detection to perfectly match the URL structure.
            const { error } = await this.supabaseService.setSession(accessToken, refreshToken);
            
            if (error) {
                console.error('AppComponent: Failed to set session manually', error);
            } else {
                console.log('AppComponent: Session set successfully manually.');
                // We don't need to manually navigate here; 
                // the onAuthStateChange in SupabaseService will fire, updating currentUser signal,
                // which triggers the effect above to redirect to /feed.
            }
        } else {
          console.warn('AppComponent: access_token detected but failed to parse with regex.');
        }
    }
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