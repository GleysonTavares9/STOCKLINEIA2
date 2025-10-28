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
      // Only act if Supabase auth state has been initially checked
      if (this.authReady() && !this.currentUser()) {
        // Fix: Use 'exact' for paths to match the full path '/auth' correctly.
        if (!this.router.isActive('/auth', { paths: 'exact', queryParams: 'subset', fragment: 'ignored', matrixParams: 'ignored' })) {
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
    await this.supabaseService.signOut();
    // The effect in the constructor will now handle the navigation, making this explicit navigate call redundant but harmless.
    // this.router.navigate(['/auth']); 
  }
}