import { Component, ChangeDetectionStrategy, input, output, computed, signal, ElementRef, viewChild, OnDestroy, effect } from '@angular/core';
import { CommonModule, NgOptimizedImage } from '@angular/common';
import { Music } from '../../services/supabase.service';

@Component({
  selector: 'app-music-player',
  standalone: true,
  imports: [CommonModule, NgOptimizedImage],
  templateUrl: './music-player.component.html',
  styleUrls: ['./music-player.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MusicPlayerComponent implements OnDestroy {
  music = input.required<Music>();
  playlist = input.required<Music[]>();
  isPublicContext = input(false); // New input to control download visibility
  
  close = output<void>();
  changeSong = output<Music>();

  audioPlayerRef = viewChild<ElementRef<HTMLAudioElement>>('audioPlayer');
  
  isPlaying = signal(false);
  currentTime = signal(0);
  duration = signal(0);

  private audioCleanupFns: Array<() => void> = [];

  currentIndex = computed(() => this.playlist().findIndex(item => item.id === this.music().id));
  
  canPlayPrevious = computed(() => this.currentIndex() > 0);
  canPlayNext = computed(() => this.currentIndex() < this.playlist().length - 1);

  constructor() {
    effect(() => {
      const currentMusic = this.music();
      const audioEl = this.audioPlayerRef()?.nativeElement;

      if (!audioEl) {
        // If audio element is not yet rendered or removed, return.
        // The effect will rerun when it becomes available.
        return;
      }
      
      // Cleanup existing listeners before setting up new ones or changing source
      this.cleanupAudioListeners(); 

      // Reset player state
      this.isPlaying.set(false); 
      this.currentTime.set(0);
      this.duration.set(0);
      
      if (currentMusic.audio_url) {
        audioEl.src = currentMusic.audio_url; // Set new source directly

        // Attach listeners
        const onLoadedMetadata = () => this.onLoadedMetadata();
        const onTimeUpdate = () => this.onTimeUpdate();
        const onEnded = () => this.onAudioEnded();
        const onPlay = () => this.isPlaying.set(true);
        const onPause = () => this.isPlaying.set(false);

        audioEl.addEventListener('loadedmetadata', onLoadedMetadata);
        audioEl.addEventListener('timeupdate', onTimeUpdate);
        audioEl.addEventListener('ended', onEnded);
        audioEl.addEventListener('play', onPlay);
        audioEl.addEventListener('pause', onPause);

        this.audioCleanupFns.push(
          () => audioEl.removeEventListener('loadedmetadata', onLoadedMetadata),
          () => audioEl.removeEventListener('timeupdate', onTimeUpdate),
          () => audioEl.removeEventListener('ended', onEnded),
          () => audioEl.removeEventListener('play', onPlay),
          () => audioEl.removeEventListener('pause', onPause)
        );

        audioEl.load(); // Necessary for some browsers to pick up src change
        audioEl.play().catch(e => console.error("Autoplay failed:", e));
      } else {
        // If no audio_url, ensure player is paused and source is cleared.
        audioEl.pause();
        audioEl.src = '';
      }
    }, { allowSignalWrites: true }); 
  }

  ngOnDestroy(): void {
    this.cleanupAudioListeners();
    // Also explicitly pause audio when component is destroyed
    const audioEl = this.audioPlayerRef()?.nativeElement;
    if (audioEl) {
      audioEl.pause();
    }
  }

  private cleanupAudioListeners(): void {
    this.audioCleanupFns.forEach(cleanup => cleanup());
    this.audioCleanupFns = [];
  }

  togglePlayPause(): void {
    const audioEl = this.audioPlayerRef()?.nativeElement;
    if (audioEl) {
      if (this.isPlaying()) {
        audioEl.pause();
      } else {
        audioEl.play().catch(e => console.error("Play failed:", e));
      }
    }
  }

  onLoadedMetadata(): void {
    const audioEl = this.audioPlayerRef()?.nativeElement;
    if (audioEl) {
      this.duration.set(audioEl.duration);
      this.currentTime.set(audioEl.currentTime); // Initialize current time
    }
  }

  onTimeUpdate(): void {
    const audioEl = this.audioPlayerRef()?.nativeElement;
    if (audioEl) {
      this.currentTime.set(audioEl.currentTime);
    }
  }

  onAudioEnded(): void {
    this.isPlaying.set(false);
    this.currentTime.set(0);
    if (this.canPlayNext()) {
      this.playNext();
    } else {
      // If last song ended and no next song, reset player state
      const audioEl = this.audioPlayerRef()?.nativeElement;
      if (audioEl) {
        audioEl.currentTime = 0; // Rewind to start
      }
    }
  }

  formatTime(seconds: number): string {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  }

  seek(event: MouseEvent): void {
    const audioEl = this.audioPlayerRef()?.nativeElement;
    const progressBar = event.currentTarget as HTMLElement;
    if (audioEl && progressBar && this.duration() > 0) { // Only seek if duration is known
      const rect = progressBar.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, clickX / rect.width)); // Clamp between 0 and 1
      audioEl.currentTime = this.duration() * percentage;
    }
  }

  playPrevious(): void {
    const audioEl = this.audioPlayerRef()?.nativeElement;
    if (audioEl) { audioEl.pause(); } // Pause current before changing
    if (this.canPlayPrevious()) {
      const newIndex = this.currentIndex() - 1;
      this.changeSong.emit(this.playlist()[newIndex]);
    }
  }

  playNext(): void {
    const audioEl = this.audioPlayerRef()?.nativeElement;
    if (audioEl) { audioEl.pause(); } // Pause current before changing
    if (this.canPlayNext()) {
      const newIndex = this.currentIndex() + 1;
      this.changeSong.emit(this.playlist()[newIndex]);
    }
  }

  closePlayer(): void {
    const audioEl = this.audioPlayerRef()?.nativeElement;
    if (audioEl) {
      audioEl.pause(); 
    }
    this.close.emit();
  }

  onContentClick(event: MouseEvent): void {
    event.stopPropagation();
  }

  async downloadMusic(): Promise<void> {
    if (!this.music().audio_url) return;
    try {
      const response = await fetch(this.music().audio_url);
      if (!response.ok) {
        throw new Error(`Network response was not ok, status: ${response.status}`);
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `${this.music().title.replace(/[^a-zA-Z0-9 ]/g, '') || 'mureka-song'}.mp3`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (error) {
      console.error('Download failed:', error);
      alert('O download direto falhou. Tentando abrir em uma nova aba. Por favor, salve a partir daí.');
      window.open(this.music().audio_url, '_blank');
    }
  }

  async shareMusic(): Promise<void> {
    const shareData = {
      title: `STOCKLINE AI Music: ${this.music().title}`,
      text: `Ouça "${this.music().title}", uma música que criei com STOCKLINE AI!`,
      url: window.location.origin, // Shares the main app URL
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(`${shareData.text} Crie a sua: ${shareData.url}`);
        alert('Link da música copiado para a área de transferência!');
      }
    } catch (error) {
      console.error('Sharing failed:', error);
      alert('Falha ao compartilhar.');
    }
  }
}