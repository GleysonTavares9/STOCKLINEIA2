import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { SupabaseService, Music } from '../services/supabase.service';
import { CommonModule } from '@angular/common';
import { MusicPlayerService } from '../services/music-player.service';

@Component({
  selector: 'app-feed',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './feed.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeedComponent {
  private readonly supabase = inject(SupabaseService);
  private readonly playerService = inject(MusicPlayerService);
  
  publicMusic = signal<Music[]>([]);
  likedSongs = this.supabase.userLikes; // Use signal from the service for persistence
  expandedLyricsId = signal<string | null>(null);
  expandedStyles = signal(new Set<string>());
  
  trendingMusic = computed(() => this.publicMusic().slice(0, 4));

  groupedMusic = computed(() => {
    const music = this.publicMusic().slice(4); // Use the rest of the music
    if (!music.length) return [];
    
    const groups: { [style: string]: Music[] } = {};
    const styleOrder: string[] = [];

    music.forEach(song => {
        // Simple grouping by first tag, with fallback
        const mainStyleRaw = (song.style || 'Sem Categoria').split(',')[0].trim();
        const capitalizedStyle = mainStyleRaw.charAt(0).toUpperCase() + mainStyleRaw.slice(1);
        
        if (!groups[capitalizedStyle]) {
            groups[capitalizedStyle] = [];
            styleOrder.push(capitalizedStyle);
        }
        groups[capitalizedStyle].push(song);
    });
    
    styleOrder.sort((a, b) => a.localeCompare(b));
    
    return styleOrder.map(style => ({ style, songs: groups[style] }));
  });

  playlist = computed(() => this.publicMusic().filter(m => m.status === 'succeeded' && m.audio_url)); // All public music as a playlist

  constructor() {
    this.loadPublicMusic();
  }

  async loadPublicMusic() {
    const songs = await this.supabase.getAllPublicMusic();
    this.publicMusic.set(songs);
  }

  public maskEmail(email?: string, displayName?: string): string {
    if (displayName && displayName.trim().length > 0) {
      return displayName; // Prefer display name if available
    }
    if (!email) return 'Anônimo';
    const [user, domain] = email.split('@');
    return `${user.substring(0, 2)}***@${domain}`;
  }

  selectMusic(music: Music): void {
    if (music.status === 'succeeded' && music.audio_url) {
      this.playerService.selectMusicAndPlaylist(music, this.playlist());
    }
  }

  // Method to toggle the like status of a song
  async toggleLike(songId: string): Promise<void> {
    const user = this.supabase.currentUser();
    if (!user) {
      console.log('FeedComponent: User must be logged in to like songs.');
      // Optionally, you can redirect to login or show a toast message.
      return;
    }

    try {
      if (this.likedSongs().has(songId)) {
        await this.supabase.removeLike(songId);
      } else {
        await this.supabase.addLike(songId);
      }
    } catch (error) {
      console.error('FeedComponent: Failed to toggle like state.', error);
      // Optionally show an error to the user
    }
  }

  toggleLyrics(musicId: string): void {
    this.expandedLyricsId.update(currentId => currentId === musicId ? null : musicId);
  }

  formatLyrics(lyrics: string | undefined): string {
    if (!lyrics) return '';
    // Replace newline characters with <br> tags for HTML rendering
    return lyrics.replace(/\n/g, '<br>');
  }

  // Method to share a song using the Web Share API or clipboard fallback
  async shareMusic(song: Music): Promise<void> {
    const shareData = {
      title: `STOCKLINE AI Music: ${song.title}`,
      text: `A próxima grande música pode ser sua. 🎶 Criei "${song.title}" com a IA da STOCKLINE. Experimente de graça e libere sua criatividade!`,
      url: `${window.location.origin}`,
    };

    // SVG do logo com cor embutida para compartilhamento
    const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" fill="#14b8a6"><path d="M224,160V96a16,16,0,0,0-16-16H48A16,16,0,0,0,32,96v64a16,16,0,0,0,16,16H208A16,16,0,0,0,224,160ZM48,96H208l-32,32L144,96H112l32,32L112,160h32l32-32,32,32H48Z"></path></svg>`;
    const blob = new Blob([logoSvg], { type: 'image/svg+xml' });
    const logoFile = new File([blob], 'stockline-logo.svg', { type: 'image/svg+xml' });

    try {
      // Usa a Web Share API se disponível
      if (navigator.share) {
        // Tenta compartilhar com o arquivo do logo se o navegador suportar
        if (navigator.canShare && navigator.canShare({ files: [logoFile] })) {
          await navigator.share({
            ...shareData,
            files: [logoFile],
          });
        } else {
          // Fallback para compartilhar apenas texto e URL
          await navigator.share(shareData);
        }
      } else {
        // Fallback para área de transferência se a Web Share API não for suportada
        await navigator.clipboard.writeText(`${shareData.text}\n\n${shareData.url}`);
        alert('Link copiado para a área de transferência!');
      }
    } catch (error) {
      // Ignora o erro se o usuário cancelar o compartilhamento
      if ((error as DOMException)?.name !== 'AbortError') {
        console.error('Sharing failed:', error);
        // Tenta a área de transferência como último recurso
        try {
          await navigator.clipboard.writeText(`${shareData.text}\n\n${shareData.url}`);
          alert('O compartilhamento falhou. O link foi copiado para a área de transferência!');
        } catch (copyError) {
          console.error('Clipboard fallback failed:', copyError);
          alert('Falha ao compartilhar e ao copiar o link.');
        }
      }
    }
  }

  toggleStyleExpansion(style: string): void {
    this.expandedStyles.update(currentSet => {
      const newSet = new Set(currentSet);
      if (newSet.has(style)) {
        newSet.delete(style);
      } else {
        newSet.add(style);
      }
      return newSet;
    });
  }
}