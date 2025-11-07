import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { SupabaseService, Music } from '../services/supabase.service';
import { CommonModule } from '@angular/common';
import { MusicPlayerService } from '../services/music-player.service';
import { Router, ActivatedRoute, NavigationEnd } from '@angular/router'; // Add NavigationEnd
import { Subscription } from 'rxjs'; // Import Subscription
import { filter } from 'rxjs/operators'; // Import filter

@Component({
  selector: 'app-feed',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './feed.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeedComponent implements OnInit, OnDestroy { // Implement OnInit and OnDestroy
  private readonly supabase = inject(SupabaseService);
  private readonly playerService = inject(MusicPlayerService);
  private readonly router = inject(Router); // Inject Router
  private readonly route = inject(ActivatedRoute); // Inject ActivatedRoute
  private routerSubscription: Subscription; // To manage route param subscription
  
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

    // Listen to router events to catch query params on initial load and navigation
    this.routerSubscription = this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe(() => {
      this.route.queryParams.subscribe(params => {
        const playMusicId = params['play_music_id'];
        if (playMusicId) {
          this.playSharedMusic(playMusicId);
        }
      });
    });
  }

  ngOnInit(): void {
    // This part is handled by the constructor and the routerSubscription for queryParams.
    // Keeping ngOnInit for other potential initialization if needed in the future.
  }

  ngOnDestroy(): void {
    if (this.routerSubscription) {
      this.routerSubscription.unsubscribe();
    }
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
    // Construct the share URL with the music ID
    // Assumes hash-based routing, so the ID is part of the hash fragment
    const shareUrl = `${window.location.origin}/#/?play_music_id=${song.id}`;

    const shareData = {
      title: `🎶 Ouça "${song.title}" na STOCKLINE AI Music!`,
      text: `🚀 Criei uma música incrível com IA na STOCKLINE! Ouça "${song.title}" agora e comece a criar suas próprias faixas gratuitamente! Acesse: ${shareUrl}`,
      url: shareUrl, // The URL for sharing
    };

    // SVG do logo com cor embutida para compartilhamento
    const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" fill="#14b8a6"><path d="M224,160V96a16,16,0,0,0-16-16H48A16,16,0,0,0,32,96v64a16,16,0,0,0,16,16H208A16,16,0,0,0,224,160ZM48,96H208l-32,32L144,96H112l32,32L112,160h32l32-32,32,32H48Z"></path></svg>`;
    const blob = new Blob([logoSvg], { type: 'image/svg+xml' });
    const logoFile = new File([blob], 'stockline-logo.svg', { type: 'image/svg+xml' });

    try {
      // Usa a Web Share API se disponível
      if (navigator.share) {
        // Tenta compartilhar com o arquivo do logo se o navegador suportar
        if (navigator.canShare && navigator.canShare({ files: [logoFile], ...shareData })) { // Include shareData for canShare check
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
        await navigator.clipboard.writeText(`${shareData.text}`); // Copy the enhanced text to clipboard
        alert('Link da música copiado para a área de transferência! Compartilhe e inspire!');
      }
    } catch (error) {
      // Ignora o erro se o usuário cancelar o compartilhamento
      if ((error as DOMException)?.name !== 'AbortError') {
        console.error('Sharing failed:', error);
        // Tenta a área de transferência como último recurso
        try {
          await navigator.clipboard.writeText(`${shareData.text}`);
          alert('O compartilhamento falhou. O link foi copiado para a área de transferência!');
        } catch (copyError) {
          console.error('Clipboard fallback failed:', copyError);
          alert('Falha ao compartilhar e ao copiar o link.');
        }
      }
    }
  }

  private async playSharedMusic(musicId: string): Promise<void> {
    // Check if the music is already playing or loaded to avoid redundant actions
    if (this.playerService.currentMusic()?.id === musicId) {
      this.clearPlayMusicIdFromUrl();
      return;
    }

    console.log(`FeedComponent: Attempting to play shared music ID: ${musicId}`);
    try {
      const music = await this.supabase.getMusicById(musicId);
      if (music && music.status === 'succeeded' && music.audio_url) {
        // Use the current publicMusic list as a playlist, if available, otherwise just the shared music.
        const publicMusicList = this.publicMusic().length > 0 ? this.publicMusic() : [music];
        this.playerService.selectMusicAndPlaylist(music, publicMusicList);
        console.log(`FeedComponent: Successfully played shared music: ${music.title}`);
      } else {
        console.warn(`FeedComponent: Shared music ID ${musicId} not found, not succeeded, or no audio URL.`);
      }
    } catch (error) {
      console.error(`FeedComponent: Error playing shared music ID ${musicId}:`, error);
    } finally {
      this.clearPlayMusicIdFromUrl();
    }
  }

  private clearPlayMusicIdFromUrl(): void {
    // Remove the play_music_id query parameter from the URL
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { play_music_id: null }, // Set it to null to remove it
      queryParamsHandling: 'merge', // Merge with existing query params
      replaceUrl: true // Replace current history entry to avoid back button issues
    });
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