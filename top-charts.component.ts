import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
// FIX: Corrected import path for SupabaseService. The component is at root, so we need to go into `src`.
import { SupabaseService, Music } from './src/services/supabase.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-top-charts',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './src/top-charts/top-charts.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopChartsComponent {
  private readonly supabase = inject(SupabaseService);
  
  publicMusic = signal<Music[]>([]);

  constructor() {
    this.loadPublicMusic();
  }

  async loadPublicMusic() {
    const songs = await this.supabase.getAllPublicMusic();
    this.publicMusic.set(songs);
  }

  // Helper to mask part of the email for privacy
  maskEmail(email?: string): string {
    if (!email) return 'Anônimo';
    const [user, domain] = email.split('@');
    return `${user.substring(0, 2)}***@${domain}`;
  }
}