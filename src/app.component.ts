import { Component, ChangeDetectionStrategy, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { SupabaseService } from './services/supabase.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive]
})
export class AppComponent {
  private readonly supabaseService = inject(SupabaseService);
  private readonly router = inject(Router);

  authReady = this.supabaseService.authReady;
  isSupabaseConfigured = this.supabaseService.isConfigured;
  currentUser = this.supabaseService.currentUser;
  currentUserProfile = this.supabaseService.currentUserProfile;
  isProfileMenuOpen = signal(false);

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

      const onAuthPage = this.router.isActive('/auth', {
        paths: 'exact',
        queryParams: 'subset',
        fragment: 'ignored',
        matrixParams: 'ignored'
      });

      if (user) {
        // User is LOGGED IN
        if (onAuthPage) {
          // If they are on the auth page, they shouldn't be. Redirect them to the main feed.
          console.log('AppComponent Effect: User is authenticated, but on /auth page. Redirecting to /feed.');
          this.router.navigate(['/feed']);
        }
      } else {
        // User is LOGGED OUT
        if (!onAuthPage) {
          // If they are on any other page, they shouldn't be. Redirect them to the auth page.
          console.log('AppComponent Effect: User is not authenticated and not on /auth page. Redirecting to /auth.');
          this.router.navigate(['/auth']);
        }
      }
    });
  }

  toggleProfileMenu(): void {
    this.isProfileMenuOpen.update(v => !v);
  }

  async signOut() {
    this.isProfileMenuOpen.set(false);
    console.log('AppComponent: Initiating signOut process.');
    await this.supabaseService.signOut();
    // The effect in the constructor will handle navigation to the auth page.
    console.log('AppComponent: signOut() completed. The effect will now handle redirection.');
  }
}
