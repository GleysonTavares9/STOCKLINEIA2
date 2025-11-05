import { Component, ChangeDetectionStrategy, inject, signal, effect, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { SupabaseService } from './services/supabase.service';
import { MusicPlayerService } from './services/music-player.service';
import { MusicPlayerComponent } from './library/music-player/music-player.component';

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
  // Fix: Explicitly type the injected Router to resolve type inference issues.
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
    // Return a consistent color to match the application's theme.
    return 'bg-teal-500';
  });

  isCreateActive = computed(() => this.router.isActive('/create', {
    paths: 'exact',
    queryParams: 'subset',
    fragment: 'ignored',
    matrixParams: 'ignored'
  }));

  constructor() {
    // Centralized effect to handle routing based on authentication state.
    // This is the single source of truth for auth-based navigation.
    effect(() => {
      const user = this.currentUser();
      const ready = this.authReady();
    
      // Don't do anything until Supabase has checked the initial auth state.
      if (!ready) {
        return;
      }
    
      // An authentication route is any page that a logged-in user should not see,
      // like the login/signup page. The root '/' now also serves the auth component
      // to correctly handle the Google OAuth redirect hash fragment.
      // FIX: The `isActive` method requires a complete `IsActiveMatchOptions` object.
      // Added `queryParams`, `fragment`, and `matrixParams` properties to satisfy the method signature for an exact path match.
      const onAuthRoute = this.router.isActive('/auth', { paths: 'exact', queryParams: 'ignored', fragment: 'ignored', matrixParams: 'ignored' }) 
        || this.router.isActive('/', { paths: 'exact', queryParams: 'ignored', fragment: 'ignored', matrixParams: 'ignored' });
    
      if (user) {
        // User is LOGGED IN
        if (onAuthRoute) {
          // If they are on an authentication page, they shouldn't be. Redirect them to the main feed.
          console.log('AppComponent Effect: User is authenticated, but on an auth page. Redirecting to /feed.');
          this.router.navigate(['/feed']);
        }
      } else {
        // User is LOGGED OUT
        if (!onAuthRoute) {
          // If they are on any other page, they shouldn't be. Redirect them to the main auth page at the root.
          console.log(`AppComponent Effect: User not authenticated and not on an auth page. URL: "${this.router.url}". Redirecting to /. `);
          this.router.navigate(['/']);
        }
      }
    });
  }

  handleKeyDown(event: KeyboardEvent): void {
    // Prevent shortcuts from firing when typing in inputs or textareas
    const target = event.target as HTMLElement;
    if (['INPUT', 'TEXTAREA'].includes(target.tagName)) {
      return;
    }

    // Allow Escape key to close profile menu
    if (event.key === 'Escape' && this.isProfileMenuOpen()) {
      this.isProfileMenuOpen.set(false);
      return;
    }

    // Navigation shortcuts
    switch (event.key.toUpperCase()) {
      case 'C':
        this.router.navigate(['/create']);
        break;
      case 'L':
        this.router.navigate(['/library']);
        break;
      case 'H':
        this.router.navigate(['/feed']);
        break;
      case 'S':
        this.router.navigate(['/subscribe']);
        break;
    }

    // Player controls (only if a song is loaded)
    if (this.currentMusic()) {
      switch (event.key) {
        case ' ': // Space bar
          event.preventDefault(); // Prevent page scroll
          this.musicPlayerService.togglePlayPause();
          break;
        case 'ArrowRight':
          this.musicPlayerService.playNext();
          break;
        case 'ArrowLeft':
          this.musicPlayerService.playPrev();
          break;
      }
    }
  }

  toggleProfileMenu(): void {
    this.isProfileMenuOpen.update(v => !v);
  }

  async signOut() {
    this.isProfileMenuOpen.set(false);
    console.log('AppComponent: Initiating signOut process.');
    this.musicPlayerService.closePlayer();
    await this.supabaseService.signOut();
    // The effect in the constructor will handle navigation to the auth page.
    console.log('AppComponent: signOut() completed. The effect will now handle redirection.');
  }

  getCoverArt(title: string): string {
    // Using a higher resolution for the background
    return `https://picsum.photos/seed/art-${title}/1280/720`;
  }
}