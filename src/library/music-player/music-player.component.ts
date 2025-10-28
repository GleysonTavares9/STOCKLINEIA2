import { Component, ChangeDetectionStrategy, input, output, signal, viewChild, ElementRef, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Music } from '../../services/supabase.service';

@Component({
  selector: 'app-music-player',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './music-player.component.html',
  styleUrls: ['./music-player.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MusicPlayerComponent {
  music = input.required<Music | null>();
  playlist = input<Music[]>([]);
  isPublicContext = input<boolean>(false);

  close = output<void>();
  changeSong = output<Music>();

  audioEl = viewChild<ElementRef<HTMLAudioElement>>('audioPlayer');

  isPlaying = signal(false);
  duration = signal(0);
  currentTime = signal(0);
  isSeeking = signal(false);

  constructor() {
    effect(() => {
      const audio = this.audioEl()?.nativeElement;
      const currentMusic = this.music();
      if (audio && currentMusic) {
        if (audio.src !== currentMusic.audio_url) {
            audio.src = currentMusic.audio_url;
        }
        audio.load();
        audio.play().then(() => {
          this.isPlaying.set(true);
        }).catch(e => {
          console.error("Audio autoplay failed:", e);
          this.isPlaying.set(false);
        });
      }
    }, { allowSignalWrites: true });
  }

  onTimeUpdate(event: Event): void {
    if (!this.isSeeking()) {
      this.currentTime.set((event.target as HTMLAudioElement).currentTime);
    }
  }

  onLoadedMetadata(event: Event): void {
    this.duration.set((event.target as HTMLAudioElement).duration);
  }

  togglePlayPause(): void {
    const audio = this.audioEl()?.nativeElement;
    if (!audio) return;
    if (audio.paused) {
      audio.play();
      this.isPlaying.set(true);
    } else {
      audio.pause();
      this.isPlaying.set(false);
    }
  }

  onSeek(event: Event): void {
    const audio = this.audioEl()?.nativeElement;
    if (!audio) return;
    const input = event.target as HTMLInputElement;
    audio.currentTime = Number(input.value);
    this.currentTime.set(audio.currentTime);
  }

  onEnded(): void {
    this.playNext();
  }

  get canPlayNext(): boolean {
    const pl = this.playlist();
    const current = this.music();
    if (!pl.length || !current) return false;
    const currentIndex = pl.findIndex(s => s.id === current.id);
    return currentIndex < pl.length - 1;
  }

  get canPlayPrev(): boolean {
    const pl = this.playlist();
    const current = this.music();
    if (!pl.length || !current) return false;
    const currentIndex = pl.findIndex(s => s.id === current.id);
    return currentIndex > 0;
  }
  
  playNext(): void {
    if (!this.canPlayNext) return;
    const pl = this.playlist();
    const current = this.music();
    const currentIndex = pl.findIndex(s => s.id === current!.id);
    this.changeSong.emit(pl[currentIndex + 1]);
  }

  playPrev(): void {
    if (!this.canPlayPrev) return;
    const pl = this.playlist();
    const current = this.music();
    const currentIndex = pl.findIndex(s => s.id === current!.id);
    this.changeSong.emit(pl[currentIndex - 1]);
  }

  formatTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }
  
  getCoverArt(title: string | undefined): string {
    if (!title) return `https://picsum.photos/seed/art-unknown/100/100`;
    return `https://picsum.photos/seed/art-${title}/100/100`;
  }
}