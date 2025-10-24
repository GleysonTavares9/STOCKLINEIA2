import { Component, ChangeDetectionStrategy, signal, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GeminiService } from '../services/gemini.service';
import { MurekaService } from '../services/mureka.service';

@Component({
  selector: 'app-create',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './create.component.html',
  styleUrls: ['./create.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // providers array removed to ensure services are singletons
})
export class CreateComponent {
  private geminiService = inject(GeminiService);
  private murekaService = inject(MurekaService);

  currentStep = signal<number>(1); // 1: Info, 2: Lyrics, 3: Result

  // Step 1
  songTitle = signal<string>('');
  songStyle = signal<string>('');
  
  // Step 2
  lyricsDescription = signal<string>('');
  generatingLyrics = signal<boolean>(false);
  lyrics = signal<string>('');
  lyricsError = signal<string | null>(null);

  // Step 3 is now driven by the service
  currentJob = computed(() => {
    // The current job is the one we just started, which will be the first in the history array.
    // It's only relevant when we are on the result step (step 3).
    if (this.currentStep() === 3) {
      return this.murekaService.history()?.[0] ?? null;
    }
    return null;
  });

  lyricsFormatted = computed(() => this.currentJob()?.lyrics?.replace(/\n/g, '<br>') || this.lyrics().replace(/\n/g, '<br>'));
  canProceedToStep2 = computed(() => this.songTitle().trim().length > 0 && this.songStyle().trim().length > 0);
  canProceedToStep3 = computed(() => this.lyrics().trim().length > 0);

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
      this.lyricsError.set('Houve um erro ao gerar a letra. Por favor, tente novamente.');
      console.error(e);
    } finally {
      this.generatingLyrics.set(false);
    }
  }

  async startMusicGenerationWorkflow(): Promise<void> {
    if (!this.canProceedToStep3()) {
      return;
    }
    
    this.nextStep(); // Advance to the result screen to show loading state

    // Delegate the entire workflow to the service.
    // The component UI will react to changes in the service's history signal.
    this.murekaService.generateMusic(this.songTitle(), this.songStyle(), this.lyrics());
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
