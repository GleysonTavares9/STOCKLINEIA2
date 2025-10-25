import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
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

  isSupabaseConfigured = this.supabaseService.isConfigured;
  currentUser = this.supabaseService.currentUser;
  currentUserProfile = this.supabaseService.currentUserProfile;
  isProfileMenuOpen = signal(false);

  toggleProfileMenu(): void {
    this.isProfileMenuOpen.update(v => !v);
  }

  async signOut() {
    this.isProfileMenuOpen.set(false);
    await this.supabaseService.signOut();
    this.router.navigate(['/auth']);
  }
}
