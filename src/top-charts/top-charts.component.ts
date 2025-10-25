import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { SupabaseService, Song } from '../services/supabase.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-top-charts',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './top-charts.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopChartsComponent {
  private readonly supabase = inject(SupabaseService);
  
  publicSongs = signal<Song[]>([]);

  constructor() {
    this.loadPublicSongs();
  }

  async loadPublicSongs() {
    const songs = await this.supabase.getAllPublicSongs();
    this.publicSongs.set(songs);
  }

  // Helper to mask part of the email for privacy
  maskEmail(email?: string): string {
    if (!email) return 'Anônimo';
    const [user, domain] = email.split('@');
    return `${user.substring(0, 2)}***@${domain}`;
  }
}
