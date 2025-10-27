
import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { SupabaseService, Music } from '../services/supabase.service';
import { CommonModule } from '@angular/common';
import { MusicPlayerComponent } from '../library/music-player/music-player.component'; // Import the music player

@Component({
  selector: 'app-feed',
  standalone: true,
  imports: [CommonModule, MusicPlayerComponent], // Add MusicPlayerComponent to imports
  templateUrl: './feed.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeedComponent {
  private readonly supabase = inject(SupabaseService);
  
  publicMusic = signal<Music[]>([]);
  
  trendingMusic = computed(() => this.publicMusic().slice(0, 4));

  groupedMusic = computed(() => {
    const music = this.publicMusic().slice(4); // Use the rest of the music
    if (!music.length) return [];
    
    const groups: { [style: string]: Music[] } = {};
    const styleOrder: string[] = [];

    music.forEach(song => {
        // Simple grouping by first tag
        const mainStyleRaw = song.style.split(',')[0].trim();
        if (!mainStyleRaw) return;
        
        const mainStyle = mainStyleRaw.toLowerCase();
        const capitalizedStyle = mainStyle.charAt(0).toUpperCase() + mainStyle.slice(1);
        
        if (!groups[capitalizedStyle]) {
            groups[capitalizedStyle] = [];
            styleOrder.push(capitalizedStyle);
        }
        groups[capitalizedStyle].push(song);
    });
    
    return styleOrder.map(style => ({ style, songs: groups[style] }));
  });

  selectedMusic = signal<Music | null>(null); // New signal to track selected public music
  playlist = computed(() => this.publicMusic().filter(m => m.status === 'succeeded' && m.audio_url)); // All public music as a playlist

  constructor() {
    this.loadPublicMusic();
  }

  async loadPublicMusic() {
    const songs = await this.supabase.getAllPublicMusic();
    this.publicMusic.set(songs);
  }

  maskEmail(email?: string): string {
    if (!email) return 'Anônimo';
    const [user, domain] = email.split('@');
    return `${user.substring(0, 2)}***@${domain}`;
  }

  selectMusic(music: Music): void {
    if (music.status === 'succeeded' && music.audio_url) {
      this.selectedMusic.set(music);
    }
  }

  closePlayer(): void {
    this.selectedMusic.set(null);
  }
}
