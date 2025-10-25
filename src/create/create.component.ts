import { Component, ChangeDetectionStrategy, signal, inject, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GeminiService } from '../services/gemini.service';
import { MurekaService } from './mureka.service';
import { SupabaseService, Song } from '../services/supabase.service';
import { Router } from '@angular/router';


@Component({
  selector: 'app-create',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './create.component.html',
  styleUrls: ['./create.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateComponent {
  private readonly geminiService = inject(GeminiService);
  private readonly murekaService = inject(MurekaService);
  private readonly supabaseService = inject(SupabaseService);
  private readonly router = inject(Router);

  readonly currentUser = this.supabaseService.currentUser;

  currentStep = signal<number>(1); // 1: Info, 2: Lyrics, 3: Result

  // Step 1
  songTitle = signal<string>('');
  songStyle = signal<string>('');
  
  // Step 2
  lyricsDescription = signal<string>('');
  generatingLyrics = signal<boolean>(false);
  lyrics = signal<string>('');
  lyricsError = signal<string | null>(null);

  // Step 3
  copySuccess = signal(false);

  currentJob = computed<Song | null>(() => {
    if (this.currentStep() === 3) {
      // The current job is the one most recently added to the user's song list.
      return this.murekaService.userSongs()?.[0] ?? null;
    }
    return null;
  });

  lyricsFormatted = computed(() => this.currentJob()?.lyrics?.replace(/\n/g, '<br>') || this.lyrics().replace(/\n/g, '<br>'));
  canProceedToStep2 = computed(() => this.songTitle().trim().length > 0 && this.songStyle().trim().length > 0);
  canProceedToStep3 = computed(() => this.lyrics().trim().length > 0);

  constructor() {
    effect(() => {
      if (!this.currentUser()) {
        // If user logs out or session expires, redirect to auth page
        this.router.navigate(['/auth'], { queryParams: { message: 'Faça login para criar músicas.' } });
      }
    });
  }

  nextStep(): void {
    if (this.currentStep() < 3) {
      this.currentStep.update(step => step + 1);
    }
  }

  previousStep(): void {
    if (this.currentStep() > 1) {
      this.currentStep.update(step => step - 1);
    }
  }

  async generateLyrics(): Promise<void> {
    if (!this.lyricsDescription() || this.generatingLyrics()) {
      return;
    }

    this.generatingLyrics.set(true);
    this.lyrics.set('');
    this.lyricsError.set(null);

    try {
      const result = await this.geminiService.generateLyrics(this.lyricsDescription());
      this.lyrics.set(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Ocorreu um erro desconhecido. Por favor, tente novamente.';
      this.lyricsError.set(message);
      console.error(e);
    } finally {
      this.generatingLyrics.set(false);
    }
  }

  async startMusicGenerationWorkflow(): Promise<void> {
    if (!this.canProceedToStep3() || !this.currentUser()) {
      return;
    }
    
    this.nextStep(); 

    await this.murekaService.generateMusic(this.songTitle(), this.songStyle(), this.lyrics());
  }

  async shareSong(job: Song): Promise<void> {
    if (!job.audio_url) return;

    const shareData = {
      title: `Música gerada por IA: ${job.title}`,
      text: `Ouça a música "${job.title}" que eu criei com Mureka AI!`,
      url: job.audio_url,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        console.log('Web Share API não foi concluída.', err);
      }
    } else {
      try {
        await navigator.clipboard.writeText(job.audio_url);
        this.copySuccess.set(true);
        setTimeout(() => this.copySuccess.set(false), 2000); 
      } catch (err) {
        console.error('Falha ao copiar link para a área de transferência:', err);
        alert('Não foi possível copiar o link. Por favor, copie-o manualmente.');
      }
    }
  }

  reset(): void {
    this.currentStep.set(1);
    this.songTitle.set('');
    this.songStyle.set('');
    this.lyricsDescription.set('');
    this.lyrics.set('');
    this.lyricsError.set(null);
  }
}