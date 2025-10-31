import { Injectable, signal, computed, effect } from '@angular/core';
import { Music } from './supabase.service';

@Injectable({
  providedIn: 'root'
})
export class MusicPlayerService {
  private audio: HTMLAudioElement;
  private lastVolume = signal(1); // To store volume before mute

  currentMusic = signal<Music | null>(null);
  playlist = signal<Music[]>([]);
  
  isPlaying = signal(false);
  currentTime = signal(0);
  duration = signal(0);
  isSeeking = signal(false);

  // New signals for advanced controls
  volume = signal(1); // 0.0 to 1.0
  isMuted = signal(false);
  repeatMode = signal<'off' | 'all' | 'one'>('off');

  constructor() {
    this.audio = new Audio();
    this.audio.volume = this.volume();

    this.audio.addEventListener('timeupdate', () => {
      if (!this.isSeeking()) {
        this.currentTime.set(this.audio.currentTime);
      }
    });

    this.audio.addEventListener('loadedmetadata', () => {
      this.duration.set(this.audio.duration);
    });

    this.audio.addEventListener('ended', () => {
      this.handleSongEnd();
    });

    this.audio.addEventListener('play', () => {
      this.isPlaying.set(true);
    });

    this.audio.addEventListener('pause', () => {
      this.isPlaying.set(false);
    });

    effect(() => {
        const music = this.currentMusic();
        if (music && music.audio_url) {
            if (this.audio.src !== music.audio_url) {
                this.audio.src = music.audio_url;
                this.audio.load();
            }
            this.audio.play().catch(e => console.error("Audio playback failed", e));
        } else {
            this.audio.pause();
            this.audio.src = '';
        }
    });
    
    effect(() => {
        // Update audio element's volume when signal changes
        this.audio.volume = this.volume();
        // Update muted state based on volume
        this.isMuted.set(this.volume() === 0);
    });
  }

  selectMusicAndPlaylist(music: Music, playlist: Music[]) {
    this.playlist.set(playlist);
    this.currentMusic.set(music);
  }
  
  closePlayer() {
    this.currentMusic.set(null);
    this.playlist.set([]);
  }

  togglePlayPause() {
    if (this.audio.paused) {
      this.audio.play().catch(e => console.error("Audio playback failed", e));
    } else {
      this.audio.pause();
    }
  }

  seek(time: number) {
    this.audio.currentTime = time;
  }

  setVolume(level: number) {
    const newVolume = Math.max(0, Math.min(1, level));
    this.volume.set(newVolume);
    if (newVolume > 0) {
      this.lastVolume.set(newVolume);
    }
  }

  toggleMute() {
    if (this.isMuted()) {
      this.volume.set(this.lastVolume() > 0 ? this.lastVolume() : 1);
    } else {
      this.lastVolume.set(this.volume());
      this.volume.set(0);
    }
  }

  toggleRepeatMode() {
    this.repeatMode.update(current => {
      if (current === 'off') return 'all';
      if (current === 'all') return 'one';
      return 'off';
    });
  }

  private handleSongEnd() {
    const mode = this.repeatMode();
    if (mode === 'one') {
      this.audio.currentTime = 0;
      this.audio.play();
    } else if (mode === 'all') {
      if (this.canPlayNext()) {
        this.playNext();
      } else if (this.playlist().length > 0) {
        // Loop back to the start
        this.currentMusic.set(this.playlist()[0]);
      }
    } else { // 'off'
      if (this.canPlayNext()) {
        this.playNext();
      } else {
        this.isPlaying.set(false);
        this.currentTime.set(0); // Reset for next play
      }
    }
  }

  private get currentIndex(): number {
    const pl = this.playlist();
    const current = this.currentMusic();
    if (!pl.length || !current) return -1;
    return pl.findIndex(s => s.id === current.id);
  }

  canPlayNext = computed(() => {
    const idx = this.currentIndex;
    return idx > -1 && idx < this.playlist().length - 1;
  });
  
  canPlayPrev = computed(() => {
    return this.currentIndex > 0;
  });

  playNext() {
    if (this.canPlayNext()) {
        const nextIndex = this.currentIndex + 1;
        this.currentMusic.set(this.playlist()[nextIndex]);
    } else if (this.repeatMode() === 'all' && this.playlist().length > 0) {
        // Handle manual skip on last song when repeat all is on
        this.currentMusic.set(this.playlist()[0]);
    }
  }

  playPrev() {
    if (this.canPlayPrev()) {
        const prevIndex = this.currentIndex - 1;
        this.currentMusic.set(this.playlist()[prevIndex]);
    }
  }
}
