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

  // Music generation state
  isGeneratingMusic = signal(false);
  generationError = signal<string | null>(null);
  
  // FIX: New signals to track specific music generation progress
  generatingMusicId = signal<string | null>(null);
  musicGenerationProgress = signal(0);
  musicGenerationStatusMessage = signal('');

  // Advanced audio creation state
  audioCreationMode = signal<'upload' | 'youtube' | 'clone'>('upload');
  uploadedFile = signal<File | null>(null);
  youtubeUrl = signal<string>('');
  isUploading = signal(false);
  uploadError = signal<string | null>(null);

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
    if (!this.isMurekaConfigured() || !this.currentUserProfile() || this.currentUserProfile()!.credits <= 0 || this.generatingLyrics() || this.isGeneratingMusic()) {
      return false;
    }
    const hasStyle = this.selectedStyles().size > 0 || this.customStyle().trim().length > 0;
    const hasTitle = this.songTitle().trim().length > 0;
    if (!hasStyle || !hasTitle) return false;

    if (this.isInstrumental()) {
      return true;
    }

    const hasLyrics = this.lyrics().trim().length > 0 && !this.isLyricsTooLong();
    const hasLyricsDesc = this.lyricsDescription().trim().length > 0;
    return hasLyrics || hasLyricsDesc;
  });

  canUploadAudio = computed(() => {
    const profile = this.currentUserProfile();
    return this.uploadedFile() !== null && 
           this.songTitle().trim().length > 0 && 
           !this.isUploading() &&
           !!profile && profile.credits > 0;
  });

  canProcessYouTube = computed(() => {
    const url = this.youtubeUrl().trim();
    const isYouTubeLink = url.includes('youtube.com/') || url.includes('youtu.be/');
    const profile = this.currentUserProfile();
    
    if (!isYouTubeLink || !this.songTitle().trim() || this.isUploading() || !profile || profile.credits <= 0) {
      return false;
    }

    const hasStyle = this.selectedStyles().size > 0 || this.customStyle().trim().length > 0;
    if (!hasStyle) return false;

    if (this.isInstrumental()) {
        return true;
    }
    
    return this.lyrics().trim().length > 0 && !this.isLyricsTooLong();
  });

  canCloneVoice = computed(() => {
    const profile = this.currentUserProfile();
    return this.uploadedFile() !== null &&
           this.songTitle().trim().length > 0 &&
           this.cloneLyrics().trim().length > 0 &&
           this.cloneStyle().trim().length > 0 &&
           !this.isUploading() &&
           !!profile && profile.credits > 0;
  });

  constructor() {
    // FIX: Effect to observe music generation progress
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
            if (status === 'failed') {
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
      // The Gemini service now handles credit consumption.
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
    this.musicGenerationProgress.set(0);
    this.musicGenerationStatusMessage.set('Iniciando...');

    try {
      const stylesArray = Array.from(this.selectedStyles());
      const finalStyle = stylesArray.length > 0 ? stylesArray.join(', ') : this.customStyle().trim();
      const title = this.songTitle().trim();

      let musicRecordId: string | undefined;

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

    this.audioCreationMode.set(mode);
    this.resetAdvancedForm();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.uploadedFile.set(input.files?.[0] || null);
  }

  async handleAudioUpload(): Promise<void> {
    if (!this.canUploadAudio()) return;

    this.isUploading.set(true);
    this.uploadError.set(null);
    this.musicGenerationProgress.set(0);
    this.musicGenerationStatusMessage.set('Iniciando upload de áudio...');
    this.isGeneratingMusic.set(true); // Treat advanced generation like regular generation for progress UI

    try {
        const tempMusic = await this.supabaseService.addMusic({
          title: this.songTitle(), style: 'upload', lyrics: '', status: 'processing', is_public: true,
          metadata: { progress: 0, status_message: 'Iniciando upload de áudio...' }
        });
        if (tempMusic) {
          this.generatingMusicId.set(tempMusic.id);
          await this.murekaService.uploadAudio(this.uploadedFile()!, this.songTitle());
        } else {
          throw new Error('Falha ao registrar a música para upload.');
        }

        this.resetAdvancedForm();
        // this.router.navigate(['/library']);
    } catch (error: any) {
        console.error('Erro ao fazer upload do áudio:', error);
        this.uploadError.set(error.message || 'Falha ao enviar o arquivo. Tente novamente.');
        this.isGeneratingMusic.set(false);
        this.generatingMusicId.set(null);
        this.musicGenerationProgress.set(100);
        this.musicGenerationStatusMessage.set('Falha no upload!');
    } finally {
        this.isUploading.set(false);
    }
  }
  
  async handleYouTubeProcess(): Promise<void> {
    if (!this.canProcessYouTube()) return;

    this.isUploading.set(true);
    this.uploadError.set(null);
    this.musicGenerationProgress.set(0);
    this.musicGenerationStatusMessage.set('Iniciando processamento do YouTube...');
    this.isGeneratingMusic.set(true); // Treat advanced generation like regular generation for progress UI
    
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
        title: this.songTitle(), style: `YouTube: ${finalPrompt}`, lyrics: this.lyrics(), status: 'processing', is_public: this.isPublic(),
        metadata: { youtube_url: this.youtubeUrl(), queryPath: (this.isInstrumental() ? 'instrumental/query' : 'song/query'), progress: 0, status_message: 'Iniciando processamento do YouTube...' }
      });
      if (tempMusic) {
        this.generatingMusicId.set(tempMusic.id);
        await this.murekaService.processYouTubeVideo(
          this.youtubeUrl(), 
          this.songTitle(), 
          finalPrompt, 
          this.lyrics(),
          this.isInstrumental(),
          this.isPublic()
        );
      } else {
        throw new Error('Falha ao registrar a música para YouTube.');
      }

      this.resetAdvancedForm();
      // this.router.navigate(['/library']);

    } catch (error: any) {
        console.error('Erro ao processar vídeo do YouTube:', error);
        this.uploadError.set(error.message || 'Falha ao processar o vídeo. Verifique o link e tente novamente.');
        this.isGeneratingMusic.set(false);
        this.generatingMusicId.set(null);
        this.musicGenerationProgress.set(100);
        this.musicGenerationStatusMessage.set('Falha no processamento do YouTube!');
    } finally {
        this.isUploading.set(false);
    }
  }
  
  async handleVoiceClone(): Promise<void> {
    if (!this.canCloneVoice()) return;

    this.isUploading.set(true);
    this.uploadError.set(null);
    this.musicGenerationProgress.set(0);
    this.musicGenerationStatusMessage.set('Iniciando clonagem de voz...');
    this.isGeneratingMusic.set(true); // Treat advanced generation like regular generation for progress UI

    try {
        const tempMusic = await this.supabaseService.addMusic({
          title: this.songTitle(), style: `Voz clonada, ${this.cloneStyle()}`, lyrics: this.cloneLyrics(), status: 'processing', is_public: true,
          metadata: { queryPath: 'voice_clone/query', type: 'voice_clone', progress: 0, status_message: 'Iniciando clonagem de voz...' }
        });
        if (tempMusic) {
          this.generatingMusicId.set(tempMusic.id);
          await this.murekaService.cloneVoice(
            this.uploadedFile()!,
            this.songTitle(),
            this.cloneLyrics(),
            this.cloneStyle(),
            true
          );
        } else {
          throw new Error('Falha ao registrar a música para clonagem de voz.');
        }
        
        this.resetAdvancedForm();
        // this.router.navigate(['/library']);
    } catch (error: any) {
        console.error('Erro ao clonar voz:', error);
        this.uploadError.set(error.message || 'Falha ao clonar a voz. Tente novamente.');
        this.isGeneratingMusic.set(false);
        this.generatingMusicId.set(null);
        this.musicGenerationProgress.set(100);
        this.musicGenerationStatusMessage.set('Falha na clonagem de voz!');
    } finally {
        this.isUploading.set(false);
    }
  }

  private resetMainForm(): void {
    this.songTitle.set('');
    this.selectedStyles.set(new Set<string>());
    this.customStyle.set('');
    this.lyrics.set('');
    this.lyricsDescription.set('');
    this.isInstrumental.set(false);
  }

  private resetAdvancedForm(): void {
    // Shared fields are reset
    this.songTitle.set('');
    this.selectedStyles.set(new Set());
    this.customStyle.set('');
    this.lyrics.set('');
    // Mode-specific fields are reset
    this.uploadedFile.set(null);
    this.youtubeUrl.set('');
    this.cloneLyrics.set('');
    this.cloneStyle.set('');
    // Error/loading state
    this.uploadError.set(null);
  }
}