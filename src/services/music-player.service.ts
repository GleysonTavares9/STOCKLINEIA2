import { Injectable, signal, computed, effect } from '@angular/core';
import { Music } from './supabase.service';

@Injectable({
  providedIn: 'root'
})
export class MusicPlayerService {
  private audio: HTMLAudioElement;

  currentMusic = signal<Music | null>(null);
  playlist = signal<Music[]>([]);
  
  isPlaying = signal(false);
  currentTime = signal(0);
  duration = signal(0);
  isSeeking = signal(false);

  constructor() {
    this.audio = new Audio();

    this.audio.addEventListener('timeupdate', () => {
      if (!this.isSeeking()) {
        this.currentTime.set(this.audio.currentTime);
      }
    });

    this.audio.addEventListener('loadedmetadata', () => {
      this.duration.set(this.audio.duration);
    });

    this.audio.addEventListener('ended', () => {
      this.playNext();
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
    } else {
        this.isPlaying.set(false);
    }
  }

  playPrev() {
    if (this.canPlayPrev()) {
        const prevIndex = this.currentIndex - 1;
        this.currentMusic.set(this.playlist()[prevIndex]);
    }
  }
}
