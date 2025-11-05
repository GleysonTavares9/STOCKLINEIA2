import { Component, ChangeDetectionStrategy, signal, inject, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GeminiService } from '../services/gemini.service';
import { MurekaService } from '../services/mureka.service';
import { SupabaseService } from '../services/supabase.service';
import { Router, RouterLink } from '@angular/router';


@Component({
  selector: 'app-create',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './create.component.html',
  styleUrls: ['./create.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateComponent {
  private readonly geminiService: GeminiService = inject(GeminiService);
  private readonly murekaService: MurekaService = inject(MurekaService);
  private readonly supabaseService: SupabaseService = inject(SupabaseService);
  private readonly router: Router = inject(Router);

  readonly currentUser = this.supabaseService.currentUser;
  readonly currentUserProfile = this.supabaseService.currentUserProfile;

  // Config signals
  readonly isGeminiConfigured = this.geminiService.isConfigured;
  readonly isMurekaConfigured = this.murekaService.isConfigured;
  readonly supabaseInitError = this.supabaseService.supabaseInitError;

  // Form signals
  songTitle = signal<string>('');
  selectedStyles = signal(new Set<string>());
  customStyle = signal<string>('');
  lyrics = signal<string>('');
  lyricsDescription = signal<string>(''); // For AI lyrics prompt
  vocalGender = signal<'male' | 'female'>('female');
  isInstrumental = signal<boolean>(false);
  isPublic = signal<boolean>(true);

  // Style options
  readonly musicStyles = [
    'Pop', 'Rock', 'Sertanejo', 'Eletrônica', 'Hip Hop', 'Funk',
    'Acústico', 'Ambiente', 'Clássico', 'MPB', 'Samba', 'Forró',
    'R&B', 'Reggae', 'Lo-Fi', 'Jazz', 'Blues', 'Gospel', 'Folk', 'Country'
  ];

  // AI Lyrics generation state
  generatingLyrics = signal(false);
  lyricsError = signal<string | null>(null);
  lyricsCost = signal(1);

  // Music generation state (unified for all creation types)
  isGeneratingMusic = signal(false);
  generationError = signal<string | null>(null);
  generatingMusicId = signal<string | null>(null);
  musicGenerationProgress = signal(0);
  musicGenerationStatusMessage = signal('');

  // Advanced audio creation state
  audioCreationMode = signal<'upload' | 'youtube' | 'clone'>('upload'); // Default to 'upload' for advanced section
  uploadedFile = signal<File | null>(null);
  youtubeUrl = signal<string>('');
  audioTitle = signal<string>(''); // New signal for audio-based creation title

  // Voice cloning state
  cloneLyrics = signal<string>('');
  cloneStyle = signal<string>('');

  // Character limits
  readonly lyricsCharLimit = 3000;
  lyricsCharCount = computed(() => this.lyrics().length);
  isLyricsTooLong = computed(() => this.lyricsCharCount() > this.lyricsCharLimit);

  // Computed property to check for advanced features based on user profile
  hasAdvancedFeatures = computed(() => {
    return !!this.currentUserProfile()?.stripe_customer_id;
  });

  canGenerateLyrics = computed(() => {
    if (!this.isGeminiConfigured() || this.generatingLyrics() || !this.lyricsDescription().trim()) {
      return false;
    }
    const profile = this.currentUserProfile();
    return !!profile && profile.credits >= this.lyricsCost();
  });

  canGenerateMusic = computed(() => {
    // Disable if any generation is in progress (lyrics or music)
    if (this.generatingLyrics() || this.isGeneratingMusic()) {
      return false;
    }
    // Disable if Mureka/Supabase is not configured or user has no credits
    if (!this.isMurekaConfigured() || !this.currentUserProfile() || this.currentUserProfile()!.credits <= 0) {
      return false;
    }

    const hasStyle = this.selectedStyles().size > 0 || this.customStyle().trim().length > 0;
    const hasTitle = this.songTitle().trim().length > 0;
    if (!hasStyle || !hasTitle) return false;

    if (this.isInstrumental()) {
      return true; // Only style and title needed for instrumental
    }

    // For non-instrumental, lyrics are required (either entered or AI generated description)
    const hasLyrics = this.lyrics().trim().length > 0 && !this.isLyricsTooLong();
    const hasLyricsDesc = this.lyricsDescription().trim().length > 0; // If description is present, user expects AI to generate.

    return hasLyrics || hasLyricsDesc;
  });

  canUploadAudio = computed(() => {
    const profile = this.currentUserProfile();
    // Use isGeneratingMusic for overall busy state
    return this.uploadedFile() !== null && 
           this.audioTitle().trim().length > 0 && 
           !this.isGeneratingMusic() &&
           !!profile && profile.credits > 0;
  });

  canProcessYouTube = computed(() => {
    const url = this.youtubeUrl().trim();
    const isYouTubeLink = url.includes('youtube.com/') || url.includes('youtu.be/');
    const profile = this.currentUserProfile();
    
    // Use isGeneratingMusic for overall busy state
    if (!isYouTubeLink || !this.audioTitle().trim() || this.isGeneratingMusic() || !profile || profile.credits <= 0) {
      return false;
    }

    const hasStyle = this.selectedStyles().size > 0 || this.customStyle().trim().length > 0;
    if (!hasStyle) return false;

    if (this.isInstrumental()) {
        return true;
    }
    
    // For vocal YouTube processing, lyrics are required
    return (this.lyrics().trim().length > 0 || this.lyricsDescription().trim().length > 0) && !this.isLyricsTooLong();
  });

  canCloneVoice = computed(() => {
    const profile = this.currentUserProfile();
    // Use isGeneratingMusic for overall busy state
    return this.uploadedFile() !== null &&
           this.audioTitle().trim().length > 0 && 
           this.cloneLyrics().trim().length > 0 &&
           this.cloneStyle().trim().length > 0 &&
           !this.isGeneratingMusic() &&
           !!profile && profile.credits > 0;
  });

  constructor() {
    effect(() => {
      const currentGeneratingId = this.generatingMusicId();
      if (currentGeneratingId) {
        const musicInService = this.murekaService.userMusic().find(m => m.id === currentGeneratingId);
        if (musicInService) {
          const status = musicInService.status;
          const progress = musicInService.metadata?.progress ?? 0;
          const message = musicInService.metadata?.status_message ?? 'Iniciando...';
          
          this.musicGenerationProgress.set(progress);
          this.musicGenerationStatusMessage.set(message);

          if (status === 'succeeded' || status === 'failed') {
            this.isGeneratingMusic.set(false);
            this.generatingMusicId.set(null); // Reset after completion

            // Redirect to library upon successful generation
            if (status === 'succeeded') {
              this.router.navigate(['/library']);
            } else if (status === 'failed') {
              this.generationError.set(musicInService.metadata?.error || 'Falha na geração da música.');
            }
          }
        }
      }
    });
  }

  toggleStyle(style: string): void {
    this.selectedStyles.update(currentStyles => {
      const newStyles = new Set(currentStyles);
      newStyles.has(style) ? newStyles.delete(style) : newStyles.add(style);
      return newStyles;
    });
  }
  
  private getVocalPrompt(vocalGender: 'male' | 'female'): string {
    const genderText = vocalGender === 'male' ? 'masculinos' : 'femininos';
    return `com vocais ${genderText} expressivos que combinam com o estilo musical`;
  }

  async generateLyrics(): Promise<void> {
    if (!this.canGenerateLyrics()) return;

    this.generatingLyrics.set(true);
    this.lyricsError.set(null);

    try {
      const generatedText = await this.geminiService.generateLyrics(this.lyricsDescription().trim(), this.lyricsCost());
      this.lyrics.set(generatedText);
    } catch (error: any) {
      console.error('Erro ao gerar letras:', error);
      this.lyricsError.set(error.message || 'Falha ao gerar letras. Tente novamente.');
    } finally {
      this.generatingLyrics.set(false);
    }
  }

  async startMusicGenerationWorkflow(): Promise<void> {
    if (!this.canGenerateMusic()) return;

    this.isGeneratingMusic.set(true);
    this.generationError.set(null);
    this.musicGenerationProgress.set(0); // Immediate feedback
    this.musicGenerationStatusMessage.set('Iniciando...'); // Immediate feedback

    try {
      const stylesArray = Array.from(this.selectedStyles());
      const finalStyle = stylesArray.length > 0 ? stylesArray.join(', ') : this.customStyle().trim();
      const title = this.songTitle().trim();

      if (this.isInstrumental()) {
        const tempMusic = await this.supabaseService.addMusic({
          title, style: finalStyle, lyrics: '', status: 'processing', is_public: this.isPublic(),
          metadata: { queryPath: 'instrumental/query', progress: 0, status_message: 'Iniciando geração do instrumental...' }
        });
        if (tempMusic) {
          this.generatingMusicId.set(tempMusic.id);
          await this.murekaService.generateInstrumental(title, finalStyle, this.isPublic());
        } else {
          throw new Error('Falha ao registrar a música para instrumental.');
        }
      } else {
        const vocalPrompt = this.getVocalPrompt(this.vocalGender());
        const promptWithVocals = `${finalStyle}, ${vocalPrompt}`;

        const tempMusic = await this.supabaseService.addMusic({
          title, style: promptWithVocals, lyrics: this.lyrics().trim(), status: 'processing', is_public: this.isPublic(),
          metadata: { queryPath: 'song/query', progress: 0, status_message: 'Iniciando geração da música...' }
        });
        if (tempMusic) {
          this.generatingMusicId.set(tempMusic.id);
          await this.murekaService.generateMusic(title, promptWithVocals, this.lyrics().trim(), this.isPublic());
        } else {
          throw new Error('Falha ao registrar a música.');
        }
      }
      
      this.resetMainForm();
      // Navigation is now handled by the effect when generation completes
      // this.router.navigate(['/library']); 

    } catch (error: any) {
      console.error('Erro ao iniciar geração de música:', error);
      this.generationError.set(error.message || 'Falha ao gerar a música. Tente novamente.');
      this.isGeneratingMusic.set(false); // Ensure state reset on error
      this.generatingMusicId.set(null);
      this.musicGenerationProgress.set(100);
      this.musicGenerationStatusMessage.set('Falha!');
    } finally {
      // Final state will be handled by the effect
    }
  }
  
  setAudioMode(mode: 'upload' | 'youtube' | 'clone') {
    if (this.audioCreationMode() === mode) return;

    // Se o modo é avançado e o usuário não tem features avançadas, não permite a mudança
    if (!this.hasAdvancedFeatures()) {
      this.generationError.set('Recursos avançados requerem um plano superior. Por favor, assine para acessá-los.');
      return; 
    }

    this.audioCreationMode.set(mode);
    this.resetForms(); // Reset all forms when switching modes
    this.generationError.set(null); // Clear previous errors, if any.
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.uploadedFile.set(input.files?.[0] || null);
  }

  async handleAudioUpload(): Promise<void> {
    if (!this.canUploadAudio()) return;

    this.isGeneratingMusic.set(true); // Unified busy state
    this.generationError.set(null); // Use unified error signal
    this.musicGenerationProgress.set(0); // Immediate feedback
    this.musicGenerationStatusMessage.set('Iniciando upload de áudio...'); // Immediate feedback

    try {
        const tempMusic = await this.supabaseService.addMusic({
          title: this.audioTitle(), style: 'upload', lyrics: '', status: 'processing', is_public: true,
          metadata: { progress: 0, status_message: 'Iniciando upload de áudio...' }
        });
        if (tempMusic) {
          this.generatingMusicId.set(tempMusic.id);
          await this.murekaService.uploadAudio(this.uploadedFile()!, this.audioTitle()); // Uses audioTitle
        } else {
          throw new Error('Falha ao registrar a música para upload.');
        }

        this.resetAdvancedForm();
        // this.router.navigate(['/library']); // Redirect handled by effect
    } catch (error: any) {
        console.error('Erro ao fazer upload do áudio:', error);
        this.generationError.set(error.message || 'Falha ao enviar o arquivo. Tente novamente.');
        this.isGeneratingMusic.set(false);
        this.generatingMusicId.set(null);
        this.musicGenerationProgress.set(100);
        this.musicGenerationStatusMessage.set('Falha no upload!');
    } finally {
        // Final state will be handled by the effect
    }
  }
  
  async handleYouTubeProcess(): Promise<void> {
    if (!this.canProcessYouTube()) return;

    this.isGeneratingMusic.set(true); // Unified busy state
    this.generationError.set(null); // Use unified error signal
    this.musicGenerationProgress.set(0); // Immediate feedback
    this.musicGenerationStatusMessage.set('Iniciando processamento do YouTube...'); // Immediate feedback
    
    try {
      const stylesArray = Array.from(this.selectedStyles());
      const finalStyle = stylesArray.length > 0 ? stylesArray.join(', ') : this.customStyle().trim();
      
      let finalPrompt: string;
      if (this.isInstrumental()) {
          finalPrompt = `Uma nova faixa instrumental no estilo de ${finalStyle}, inspirada no áudio de referência do YouTube.`;
      } else {
          const vocalPrompt = this.getVocalPrompt(this.vocalGender());
          finalPrompt = `Uma nova música no estilo de ${finalStyle}, ${vocalPrompt}, inspirada no áudio de referência do YouTube.`;
      }

      const tempMusic = await this.supabaseService.addMusic({
        title: this.audioTitle(), style: `YouTube: ${finalPrompt}`, lyrics: this.lyrics(), status: 'processing', is_public: this.isPublic(),
        metadata: { youtube_url: this.youtubeUrl(), queryPath: (this.isInstrumental() ? 'instrumental/query' : 'song/query'), progress: 0, status_message: 'Iniciando processamento do YouTube...' }
      });
      if (tempMusic) {
        this.generatingMusicId.set(tempMusic.id);
        await this.murekaService.processYouTubeVideo(
          this.youtubeUrl(), 
          this.audioTitle(), // Uses audioTitle
          finalPrompt, 
          this.lyrics(),
          this.isInstrumental(),
          this.isPublic()
        );
      } else {
        throw new Error('Falha ao registrar a música para YouTube.');
      }

      this.resetAdvancedForm();
      // this.router.navigate(['/library']); // Redirect handled by effect

    } catch (error: any) {
        console.error('Erro ao processar vídeo do YouTube:', error);
        this.generationError.set(error.message || 'Falha ao processar o vídeo. Verifique o link e tente novamente.');
        this.isGeneratingMusic.set(false);
        this.generatingMusicId.set(null);
        this.musicGenerationProgress.set(100);
        this.musicGenerationStatusMessage.set('Falha no processamento do YouTube!');
    } finally {
        // Final state will be handled by the effect
    }
  }
  
  async handleVoiceClone(): Promise<void> {
    if (!this.canCloneVoice()) return;

    this.isGeneratingMusic.set(true); // Unified busy state
    this.generationError.set(null); // Use unified error signal
    this.musicGenerationProgress.set(0); // Immediate feedback
    this.musicGenerationStatusMessage.set('Iniciando clonagem de voz...'); // Immediate feedback

    try {
        const tempMusic = await this.supabaseService.addMusic({
          title: this.audioTitle(), style: `Voz clonada, ${this.cloneStyle()}`, lyrics: this.cloneLyrics(), status: 'processing', is_public: true,
          metadata: { queryPath: 'voice_clone/query', type: 'voice_clone', progress: 0, status_message: 'Iniciando clonagem de voz...' }
        });
        if (tempMusic) {
          this.generatingMusicId.set(tempMusic.id);
          await this.murekaService.cloneVoice(
            this.uploadedFile()!,
            this.audioTitle(), // Uses audioTitle
            this.cloneLyrics(),
            this.cloneStyle(),
            true
          );
        } else {
          throw new Error('Falha ao registrar a música para clonagem de voz.');
        }
        
        this.resetAdvancedForm();
        // this.router.navigate(['/library']); // Redirect handled by effect
    } catch (error: any) {
        console.error('Erro ao clonar voz:', error);
        this.generationError.set(error.message || 'Falha ao clonar a voz. Tente novamente.');
        this.isGeneratingMusic.set(false);
        this.generatingMusicId.set(null);
        this.musicGenerationProgress.set(100);
        this.musicGenerationStatusMessage.set('Falha na clonagem de voz!');
    } finally {
        // Final state will be handled by the effect
    }
  }

  private resetForms(): void {
    this.resetMainForm();
    this.resetAdvancedForm();
  }

  private resetMainForm(): void {
    this.songTitle.set(''); // Reset song title
    this.selectedStyles.set(new Set<string>());
    this.customStyle.set('');
    this.lyrics.set('');
    this.lyricsDescription.set('');
    this.vocalGender.set('female');
    this.isInstrumental.set(false);
    this.isPublic.set(true);
  }

  private resetAdvancedForm(): void {
    // Reset fields specific to advanced forms
    this.uploadedFile.set(null);
    this.youtubeUrl.set('');
    this.audioTitle.set(''); // Reset audioTitle
    this.cloneLyrics.set('');
    this.cloneStyle.set('');
    // Clear errors from previous advanced generation attempt
    this.generationError.set(null); 
    // It's also good to reset general fields that might have been used across tabs
    // Note: songTitle is reset by resetMainForm now, so no need here if called together.
  }
}