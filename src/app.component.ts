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
    // Effect to ensure redirection to auth page if user logs out or is not authenticated
    effect(() => {
      console.log('AppComponent Effect: Auth state changed. authReady:', this.authReady(), 'currentUser:', this.currentUser()?.id);
      // Only act if Supabase auth state has been initially checked
      if (this.authReady() && !this.currentUser()) {
        console.log('AppComponent Effect: User is NOT authenticated, considering redirect.');
        // Fix: Use 'exact' for paths to match the full path '/auth' correctly.
        if (!this.router.isActive('/auth', { paths: 'exact', queryParams: 'subset', fragment: 'ignored', matrixParams: 'ignored' })) {
          console.log('AppComponent Effect: Not currently on /auth page, navigating to /auth.');
          this.router.navigate(['/auth']);
        } else {
          console.log('AppComponent Effect: Already on /auth page, no navigation needed.');
        }
      } else if (this.authReady() && this.currentUser()) {
        console.log('AppComponent Effect: User is authenticated. Current user ID:', this.currentUser()?.id);
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
    // The effect in the constructor should handle the navigation,
    // but an explicit navigate here ensures immediate redirection.
    // However, the effect is generally preferred for state-driven navigation.
    // Explicitly navigating might create a race condition or redundant navigation if the effect also triggers.
    // For robustness, if the effect is not triggering fast enough, this can act as a fallback.
    // Let's keep it here for now as a double-check, but monitor for double navigations.
    console.log('AppComponent: signOut() completed from SupabaseService. Navigating to /auth directly.');
    this.router.navigate(['/auth']); 
  }
}