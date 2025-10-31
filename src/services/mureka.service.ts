import { Injectable, signal, inject, effect, untracked, computed } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { SupabaseService, Music } from './supabase.service';

interface MurekaGenerateResponse {
  id: string;
  file_id?: string;
}

interface MurekaQueryResponse {
  status: 'preparing' | 'queued' | 'running' | 'streaming' | 'succeeded' | 'failed' | 'timeouted' | 'cancelled';
  failed_reason?: string;
  choices?: { url: string; flac_url?: string; duration?: number; id?: string }[];
  file_id?: string;
}

@Injectable({
  providedIn: 'root',
})
export class MurekaService {
  private readonly supabase = inject(SupabaseService);

  userMusic = signal<Music[]>([]);
  readonly isConfigured = computed(() => this.supabase.isConfigured());

  constructor() {
    effect(() => {
      const user = this.supabase.currentUser();
      if (user) {
        untracked(async () => {
          const music = await this.supabase.getMusicForUser(user.id);
          this.userMusic.set(music);
        });
      } else {
        this.userMusic.set([]);
      }
    });
  }

  // ========== UPLOAD DE ÁUDIO LOCAL ==========

  async uploadAudio(file: File, title: string, description?: string): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('O Supabase não está configurado.');
    }

    const session = await this.supabase.getSession();
    if (!session?.access_token) {
      throw new Error("Usuário não autenticado.");
    }

    let musicRecord: Music | null = null;
    
    try {
      musicRecord = await this.supabase.addMusic({
        title,
        style: 'uploaded',
        lyrics: description || '',
        status: 'processing',
        is_public: false
      });

      if (!musicRecord) {
        throw new Error('Falha ao criar registro da música.');
      }

      const finalMusicRecord = musicRecord;
      this.userMusic.update(current => [finalMusicRecord, ...current]);

      const fileContent = await this.fileToBase64(file);
      
      const { data, error: proxyError } = await this.supabase.invokeFunction('mureka-proxy', {
        body: {
          murekaApiPath: 'files/upload',
          method: 'POST',
          isFileUpload: true,
          requestBody: {
            fileContent: fileContent.split(',')[1],
            fileName: file.name,
            fileType: file.type,
            purpose: 'reference'
          }
        }
      });

      if (proxyError) throw proxyError;
      if (data?.error) throw data;

      console.log('MurekaService: Upload response:', data);

      const fileId = data.id;
      
      const updatedRecord = await this.supabase.updateMusic(finalMusicRecord.id, { 
        mureka_id: fileId,
        metadata: { 
          ...finalMusicRecord.metadata, 
          file_id: fileId,
          original_filename: file.name,
          file_size: file.size,
          upload_type: 'direct'
        }
      });
      
      if (updatedRecord) {
        this.userMusic.update(music => music.map(s => s.id === finalMusicRecord.id ? updatedRecord : s));
      }

      // The generation logic is now handled inside processUploadedAudio
      await this.processUploadedAudio(finalMusicRecord.id, fileId, title, description);

    } catch (error) {
      console.error('MurekaService: Erro no upload de áudio:', error);
      const errorMessage = await this.getApiErrorMessage(error, 'Erro ao fazer upload do arquivo.');
      await this.handleGenerationError(error, musicRecord, { 
        title, 
        style: 'uploaded', 
        lyrics: description || '', 
        errorMessage, 
        is_public: false 
      });
      throw new Error(errorMessage);
    }
  }

  // ========== PROCESSAMENTO DO YOUTUBE ==========

  async processYouTubeVideo(youtubeUrl: string, title: string, description?: string): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('O Supabase não está configurado.');
    }

    const session = await this.supabase.getSession();
    if (!session?.access_token) {
      throw new Error("Usuário não autenticado.");
    }

    let musicRecord: Music | null = null;

    try {
      musicRecord = await this.supabase.addMusic({
        title,
        style: 'youtube',
        lyrics: description || '',
        status: 'processing', 
        is_public: false,
        metadata: { youtube_url: youtubeUrl, queryPath: 'instrumental/query' }
      });

      if (!musicRecord) {
        throw new Error('Falha ao criar registro da música.');
      }

      const finalMusicRecord = musicRecord;
      this.userMusic.update(current => [finalMusicRecord, ...current]);

      const { data, error: proxyError } = await this.supabase.invokeFunction('mureka-proxy', {
        body: {
          murekaApiPath: 'instrumental/generate',
          method: 'POST',
          requestBody: {
            audio_url: youtubeUrl,
            prompt: description || 'Gerar música inspirada no áudio do link.',
            model: 'auto',
            n: 1,
          }
        }
      });

      if (proxyError) throw proxyError;
      if (data?.error) throw data;

      const taskId = data.id;
      
      const updatedRecord = await this.supabase.updateMusic(finalMusicRecord.id, { 
        mureka_id: taskId,
        metadata: {
          ...finalMusicRecord.metadata,
          processing_method: 'generation_based'
        }
      });
      
      if (updatedRecord) {
        this.userMusic.update(music => music.map(s => s.id === finalMusicRecord.id ? updatedRecord : s));
      }

      this.pollForResult(finalMusicRecord.id, taskId, 'instrumental/query');

    } catch (error) {
      console.error('MurekaService: Erro ao processar vídeo do YouTube:', error);
      const errorMessage = await this.getApiErrorMessage(error, 'Erro ao processar o vídeo do YouTube.');
      await this.handleGenerationError(error, musicRecord, { 
        title, 
        style: 'youtube', 
        lyrics: description || '', 
        errorMessage, 
        is_public: false 
      });
      throw new Error(errorMessage);
    }
  }

  // ========== MÉTODOS DE ANÁLISE PARA ÁUDIO UPLOADADO ==========

  private async processUploadedAudio(musicId: string, fileId: string, title: string, description?: string): Promise<void> {
    try {
      // Find the record to access its metadata during updates
      const originalRecord = this.userMusic().find(m => m.id === musicId);
      const existingMetadata = originalRecord?.metadata || {};

      let analysisDescription = '';
      try {
        const { data: describeData, error: describeError } = await this.supabase.invokeFunction('mureka-proxy', {
          body: {
            murekaApiPath: 'song/describe',
            method: 'POST',
            requestBody: {
              file_id: fileId
            }
          }
        });

        if (!describeError && describeData?.description) {
          analysisDescription = describeData.description;
          // Update music with description from analysis
          await this.supabase.updateMusic(musicId, {
            description: description || `Áudio analisado: ${analysisDescription}`,
            metadata: { 
              ...existingMetadata,
              analysis: describeData,
            }
          });
        }
      } catch (describeError) {
        console.warn('MurekaService: Não foi possível analisar o áudio:', describeError);
      }

      // Now, generate music from the uploaded file
      const { data, error: proxyError } = await this.supabase.invokeFunction('mureka-proxy', {
        body: {
          murekaApiPath: 'instrumental/generate',
          method: 'POST',
          requestBody: {
            file_id: fileId,
            prompt: description || analysisDescription || 'Gerar música inspirada no áudio de referência.',
            model: 'auto',
            n: 1
          }
        }
      });

      if (proxyError) throw proxyError;
      if (data?.error) throw data;

      const taskId = data.id;
      
      const updatedRecord = await this.supabase.updateMusic(musicId, { 
        mureka_id: taskId,
        metadata: {
          ...existingMetadata,
          queryPath: 'instrumental/query',
          processing_method: 'generation_from_upload'
        }
      });
      
      if (updatedRecord) {
        this.userMusic.update(music => music.map(s => s.id === musicId ? updatedRecord : s));
      }

      this.pollForResult(musicId, taskId, 'instrumental/query');

    } catch (error) {
      console.error('MurekaService: Erro ao processar áudio uploadado para geração:', error);
      const errorMessage = await this.getApiErrorMessage(error, 'Erro ao processar o arquivo de áudio para geração.');
      
      const updatedMusic = await this.supabase.updateMusic(musicId, { 
        status: 'failed', 
        error: errorMessage 
      });

      if (updatedMusic) {
        // Fix: Corrected typo 's' to 'm' in the map function parameter
        this.userMusic.update(music => music.map(m => m.id === musicId ? updatedMusic : m));
      }
    }
  }

  // ========== MÉTODOS AUXILIARES ==========

  private async fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
      reader.readAsDataURL(file);
    });
  }

  private async handleGenerationError(error: any, musicRecord: Music | null, details: { title: string, style: string, lyrics: string, errorMessage: string, is_public: boolean }) {
    if (musicRecord) {
      const updatedMusic = await this.supabase.updateMusic(musicRecord.id, { status: 'failed', error: details.errorMessage });
      if (updatedMusic) {
          this.userMusic.update(music => music.map(s => s.id === updatedMusic.id ? updatedMusic : s));
      }
    } else {
       const newFailedMusic = await this.supabase.addMusic({ title: details.title, style: details.style, lyrics: details.lyrics, status: 'failed', error: details.errorMessage, is_public: details.is_public });
       if (newFailedMusic) {
          this.userMusic.update(current => [newFailedMusic, ...current]);
       }
    }
  }

  // ========== GERAÇÃO DE MÚSICA E INSTRUMENTAL ==========

  async generateMusic(title: string, style: string, lyrics: string, isPublic: boolean): Promise<void> {
    if (!this.isConfigured()) {
        const errorMsg = 'O Supabase não está configurado. Verifique as credenciais em `src/config.ts`.';
        console.error('MurekaService: generateMusic: Supabase not configured.', errorMsg);
        await this.supabase.addMusic({ title, style, lyrics, status: 'failed', error: errorMsg, is_public: isPublic });
        throw new Error(errorMsg);
    }
    
    const session = await this.supabase.getSession();
    if (!session?.access_token) {
      const errorMsg = "Usuário não autenticado no Supabase. Impossível gerar música.";
      console.error('MurekaService: generateMusic: User not authenticated.', errorMsg);
      await this.supabase.addMusic({ title, style, lyrics, status: 'failed', error: 'Você precisa estar logado para criar músicas.', is_public: isPublic });
      throw new Error(errorMsg);
    }

    let musicRecord: Music | null = null;
    try {
      musicRecord = await this.supabase.addMusic({
        title,
        style,
        lyrics,
        status: 'processing',
        is_public: isPublic,
        metadata: { queryPath: 'song/query' }
      });

      if (!musicRecord) {
        throw new Error('Falha ao criar o registro da música no banco de dados.');
      }

      const finalMusicRecord = musicRecord;
      this.userMusic.update(current => [finalMusicRecord, ...current]);
      
      const murekaRequestBody: { [key: string]: any } = {
        prompt: style,
        model: 'auto',
        n: 1, 
      };
      
      if (lyrics && lyrics.trim().length > 0) {
        murekaRequestBody.lyrics = lyrics;
      }

      const { data, error: proxyError } = await this.supabase.invokeFunction('mureka-proxy', {
          body: {
              murekaApiPath: 'song/generate',
              method: 'POST',
              requestBody: murekaRequestBody,
          }
      });

      if (proxyError) {
        console.error('MurekaService: Erro ao chamar a função proxy (`mureka-proxy`) para gerar música (proxyError):', proxyError);
        throw proxyError;
      }
      
      if (!data || data.error) { 
          console.error('MurekaService: Resposta inválida ou erro da API da Mureka via proxy (data.error):', data);
          throw data;
      }
      if (typeof data.id !== 'string') {
        console.error('MurekaService: Resposta da API da Mureka via proxy não contém ID válido:', data);
        throw new Error('A API Mureka (via proxy) não retornou um ID de tarefa válido.');
      }

      const taskId = data.id;
      const updatedRecord = await this.supabase.updateMusic(finalMusicRecord.id, { mureka_id: taskId });
      if (updatedRecord) {
        this.userMusic.update(music => music.map(s => s.id === finalMusicRecord.id ? updatedRecord : s));
      }
      this.pollForResult(finalMusicRecord.id, taskId, 'song/query');

    } catch (error) {
      console.error('MurekaService: Erro ao iniciar a geração da música (catch block):', error);
      const errorMessage = await this.getApiErrorMessage(error, 'Ocorreu um erro desconhecido ao contatar a API da Mureka.');
      await this.handleGenerationError(error, musicRecord, { title, style, lyrics, errorMessage, is_public: isPublic });
      throw new Error(errorMessage);
    }
  }

  async generateInstrumental(title: string, style: string, isPublic: boolean): Promise<void> {
    if (!this.isConfigured()) {
        const errorMsg = 'O Supabase não está configurado. Verifique as credenciais em `src/config.ts`.';
        console.error('MurekaService: generateInstrumental: Supabase not configured.', errorMsg);
        await this.supabase.addMusic({ title, style, lyrics: '', status: 'failed', error: errorMsg, is_public: isPublic });
        throw new Error(errorMsg);
    }

    const session = await this.supabase.getSession();
    if (!session?.access_token) {
      const errorMsg = "Usuário não autenticado no Supabase. Impossível gerar música.";
      console.error('MurekaService: generateInstrumental: User not authenticated.', errorMsg);
      await this.supabase.addMusic({ title, style, lyrics: '', status: 'failed', error: 'Você precisa estar logado para criar músicas.', is_public: isPublic });
      throw new Error(errorMsg);
    }

    let musicRecord: Music | null = null;
    try {
      musicRecord = await this.supabase.addMusic({
        title,
        style,
        lyrics: '',
        status: 'processing',
        is_public: isPublic,
        metadata: { queryPath: 'instrumental/query' }
      });

      if (!musicRecord) {
        throw new Error('Falha ao criar o registro da música no banco de dados.');
      }

      const finalMusicRecord = musicRecord;
      this.userMusic.update(current => [finalMusicRecord, ...current]);
      
      const murekaRequestBody = {
        prompt: style,
        model: 'auto',
        n: 1,
      };

      const { data, error: proxyError } = await this.supabase.invokeFunction('mureka-proxy', {
          body: {
              murekaApiPath: 'instrumental/generate',
              method: 'POST',
              requestBody: murekaRequestBody,
          }
      });

      if (proxyError) {
        console.error('MurekaService: Erro ao chamar a função proxy (`mureka-proxy`) para gerar instrumental (proxyError):', proxyError);
        throw proxyError;
      }
      
      if (!data || data.error) { 
          console.error('MurekaService: Resposta inválida ou erro da API da Mureka via proxy (data.error):', data);
          throw data;
      }
      if (typeof data.id !== 'string') {
        console.error('MurekaService: Resposta da API da Mureka via proxy não contém ID válido:', data);
        throw new Error('A API Mureka (via proxy) não retornou um ID de tarefa válido.');
      }

      const taskId = data.id;
      const updatedRecord = await this.supabase.updateMusic(finalMusicRecord.id, { mureka_id: taskId });
      if (updatedRecord) {
        this.userMusic.update(music => music.map(s => s.id === finalMusicRecord.id ? updatedRecord : s));
      }
      this.pollForResult(finalMusicRecord.id, taskId, 'instrumental/query');

    } catch (error) {
      console.error('MurekaService: Erro ao iniciar a geração do instrumental (catch block):', error);
      const errorMessage = await this.getApiErrorMessage(error, 'Ocorreu um erro desconhecido ao contatar a API da Mureka.');
      await this.handleGenerationError(error, musicRecord, { title, style, lyrics: '', errorMessage, is_public: isPublic });
      throw new Error(errorMessage);
    }
  }

  // ========== VOICE CLONING ==========

  async cloneVoice(voiceSampleFile: File, title: string, lyrics: string, style: string, isPublic: boolean): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('O Supabase não está configurado.');
    }
    const session = await this.supabase.getSession();
    if (!session?.access_token) {
      throw new Error("Usuário não autenticado.");
    }

    let musicRecord: Music | null = null;
    try {
      // 1. Create a record in the database
      musicRecord = await this.supabase.addMusic({
        title,
        style: `Voz clonada, ${style}`,
        lyrics,
        status: 'processing',
        is_public: isPublic,
        metadata: { queryPath: 'voice_clone/query', type: 'voice_clone' } // Assumed query path
      });

      if (!musicRecord) {
        throw new Error('Falha ao criar o registro da música no banco de dados.');
      }
      
      const finalMusicRecord = musicRecord;
      this.userMusic.update(current => [finalMusicRecord, ...current]);

      // 2. Upload the voice sample file
      const fileContent = await this.fileToBase64(voiceSampleFile);
      const { data: uploadData, error: uploadError } = await this.supabase.invokeFunction('mureka-proxy', {
        body: {
          murekaApiPath: 'files/upload',
          method: 'POST',
          isFileUpload: true,
          requestBody: {
            fileContent: fileContent.split(',')[1],
            fileName: voiceSampleFile.name,
            fileType: voiceSampleFile.type,
            purpose: 'reference' // Using 'reference' as a safe default
          }
        }
      });

      if (uploadError) throw uploadError;
      if (uploadData?.error) throw uploadData;
      
      const fileId = uploadData.id;

      // 3. Start the voice cloning generation job
      const { data, error: proxyError } = await this.supabase.invokeFunction('mureka-proxy', {
        body: {
          murekaApiPath: 'voice_clone/generate', // Assumed endpoint
          method: 'POST',
          requestBody: {
            file_id: fileId,
            lyrics: lyrics,
            prompt: style, // Prompt for the background music
            model: 'auto',
            n: 1,
          },
        }
      });

      if (proxyError) throw proxyError;
      if (data?.error) throw data;

      const taskId = data.id;

      // 4. Update the DB record with the task ID
      const updatedRecord = await this.supabase.updateMusic(finalMusicRecord.id, { mureka_id: taskId });
      if (updatedRecord) {
        this.userMusic.update(music => music.map(s => s.id === finalMusicRecord.id ? updatedRecord : s));
      }

      // 5. Start polling for the result
      this.pollForResult(finalMusicRecord.id, taskId, 'voice_clone/query'); // Assumed query path

    } catch (error) {
      console.error('MurekaService: Erro ao clonar voz:', error);
      const errorMessage = await this.getApiErrorMessage(error, 'Ocorreu um erro desconhecido ao clonar a voz.');
      await this.handleGenerationError(error, musicRecord, { 
        title, 
        style: `Voz clonada, ${style}`, 
        lyrics, 
        errorMessage, 
        is_public: isPublic 
      });
      throw new Error(errorMessage);
    }
  }

  // ========== EXTEND MUSIC ==========
  async extendMusic(originalMusicId: string, durationInSeconds: number): Promise<void> {
    if (!this.isConfigured()) {
        throw new Error('O Supabase não está configurado.');
    }

    const session = await this.supabase.getSession();
    if (!session?.access_token) {
        throw new Error("Usuário não autenticado.");
    }
    
    const originalMusic = this.userMusic().find(m => m.id === originalMusicId);
    if (!originalMusic || !originalMusic.task_id) {
        throw new Error("Música original ou ID da tarefa não encontrado para extensão.");
    }

    const queryPath = originalMusic.metadata?.queryPath as 'song/query' | 'instrumental/query' | undefined;
    if (!queryPath) {
      throw new Error("Não foi possível determinar o tipo (música ou instrumental) da faixa original para estendê-la.");
    }

    let newMusicRecord: Music | null = null;
    try {
        newMusicRecord = await this.supabase.addMusic({
            title: `${originalMusic.title} (Estendida)`,
            style: originalMusic.style,
            lyrics: originalMusic.description,
            status: 'processing',
            is_public: originalMusic.is_public ?? false,
            metadata: { 
                original_music_id: originalMusic.id,
                queryPath: queryPath,
            }
        });

        if (!newMusicRecord) {
            throw new Error('Falha ao criar o registro para a música estendida.');
        }
        
        this.userMusic.update(current => [newMusicRecord!, ...current]);

        const extendPath = queryPath.replace('query', 'extend'); // song/query -> song/extend

        const { data, error: proxyError } = await this.supabase.invokeFunction('mureka-proxy', {
            body: {
                murekaApiPath: extendPath,
                method: 'POST',
                requestBody: {
                    id: originalMusic.task_id,
                    duration: durationInSeconds
                },
            }
        });

        if (proxyError) throw proxyError;
        if (data?.error) throw data;

        const taskId = data.id;
        const updatedRecord = await this.supabase.updateMusic(newMusicRecord.id, { mureka_id: taskId });
        if (updatedRecord) {
          this.userMusic.update(music => music.map(s => s.id === newMusicRecord!.id ? updatedRecord : s));
        }
        
        this.pollForResult(newMusicRecord.id, taskId, queryPath);

    } catch (error) {
        console.error('MurekaService: Erro ao estender música:', error);
        const errorMessage = await this.getApiErrorMessage(error, 'Falha ao estender a música.');
        await this.handleGenerationError(error, newMusicRecord, { 
            title: `${originalMusic.title} (Estendida)`, 
            style: originalMusic.style, 
            lyrics: originalMusic.description, 
            errorMessage, 
            is_public: originalMusic.is_public ?? false 
        });
        throw new Error(errorMessage);
    }
  }

  // ========== POLLING & STATUS ==========

  async queryMusicStatus(taskId: string, queryPath: 'song/query' | 'instrumental/query' | 'voice_clone/query' = 'song/query'): Promise<MurekaQueryResponse> {
    const { data, error: proxyError } = await this.supabase.invokeFunction('mureka-proxy', {
        body: {
            murekaApiPath: `${queryPath}/${taskId}`,
            method: 'GET',
        }
    });

    if (proxyError) throw proxyError;
    if (data?.error) throw data;

    return data as MurekaQueryResponse;
  }
  
  private pollForResult(musicId: string, taskId: string, queryPath: 'song/query' | 'instrumental/query' | 'voice_clone/query'): void {
    const interval = 10000; // 10 seconds
    const maxAttempts = 60; // 10 minutes max
    let attempts = 0;

    const executePoll = async () => {
      if (attempts >= maxAttempts) {
        console.log(`MurekaService: Polling for task ${taskId} timed out after ${maxAttempts} attempts.`);
        await this.supabase.updateMusic(musicId, { status: 'failed', error: 'A geração demorou muito para responder (timeout).' });
        return;
      }
      
      attempts++;
      console.log(`MurekaService: Polling for task ${taskId}, attempt ${attempts}...`);
      
      try {
          const result = await this.queryMusicStatus(taskId, queryPath);
          const isFinalStatus = ['succeeded', 'failed', 'timeouted', 'cancelled'].includes(result.status);
          
          if (isFinalStatus) {
              await this.handleFinalStatus(musicId, result);
          } else {
              setTimeout(executePoll, interval);
          }
      } catch (error) {
          console.error(`MurekaService: Error polling for task ${taskId}:`, error);
          const errorMessage = await this.getApiErrorMessage(error, 'Erro ao verificar o status da geração.');
          await this.supabase.updateMusic(musicId, { status: 'failed', error: errorMessage });
      }
    };
    
    setTimeout(executePoll, interval);
  }

  private async handleFinalStatus(musicId: string, result: MurekaQueryResponse): Promise<void> {
    let updatedMusic: Music | null = null;
    const originalMusic = this.userMusic().find(m => m.id === musicId);
    const existingMetadata = originalMusic?.metadata || {};

    if (result.status === 'succeeded') {
        const audioUrl = result.choices?.[0]?.url;
        const fileId = result.file_id; // For generated music
        if (audioUrl) {
            let finalUrl = audioUrl;
            if (fileId) {
                // Construct permanent URL for generated audio
                finalUrl = `https://api.mureka.ai/v1/files/${fileId}/download`;
            }
            updatedMusic = await this.supabase.updateMusic(musicId, { 
                status: 'succeeded', 
                audio_url: finalUrl,
                metadata: { ...existingMetadata, file_id: fileId }
            });
        } else {
            updatedMusic = await this.supabase.updateMusic(musicId, { 
                status: 'failed', 
                error: 'A geração foi bem-sucedida, mas a Mureka não forneceu um URL de áudio.' 
            });
        }
    } else {
        const reason = result.failed_reason || `A geração falhou com o status: ${result.status}`;
        updatedMusic = await this.supabase.updateMusic(musicId, { 
            status: 'failed', 
            error: reason 
        });
    }

    if (updatedMusic) {
        this.userMusic.update(musics => musics.map(m => m.id === musicId ? updatedMusic : m));
    }
  }

  // ========== GERENCIAMENTO DE MÚSICA ==========

  async deleteMusic(musicId: string): Promise<void> {
    const { error, count } = await this.supabase.deleteMusic(musicId);
    if (error || count === 0) {
      throw new Error(error?.message || "Falha ao apagar a música ou música não encontrada.");
    }
    this.userMusic.update(musics => musics.filter(m => m.id !== musicId));
  }
  
  async clearFailedMusic(): Promise<void> {
      const user = this.supabase.currentUser();
      if (!user) {
        throw new Error("Usuário não autenticado.");
      }
      const { error, count } = await this.supabase.deleteFailedMusicForUser(user.id);
      if (error) {
        throw new Error(error.message);
      }
      if (count && count > 0) {
        this.userMusic.update(musics => musics.filter(m => m.status !== 'failed'));
      }
  }

  async updateMusicVisibility(music: Music, isPublic: boolean): Promise<void> {
    const updatedMusic = await this.supabase.updateMusicVisibility(music.id, isPublic);
    if (updatedMusic) {
      this.userMusic.update(musics => musics.map(m => m.id === music.id ? updatedMusic : m));
    } else {
      throw new Error("Falha ao atualizar a visibilidade da música.");
    }
  }
  
  private async getApiErrorMessage(error: any, defaultMessage: string): Promise<string> {
    console.groupCollapsed('🚨 MurekaService: getApiErrorMessage - Debugging');
    console.log('Raw error object received:', error);

    // Default message
    let finalMessage = defaultMessage;

    // Check for Supabase client initialization error
    if (error?.message?.includes('Supabase client not initialized')) {
        console.log('Error Type: Supabase client not initialized.');
        console.groupEnd();
        return 'O Supabase não está configurado. Verifique as credenciais no `src/auth/config.ts`.';
    }

    // Try to parse error body from Supabase Edge Function response
    let bodyToParse: any = null;
    const bodyStream = error?.context?.body || error?.body;

    if (bodyStream && typeof bodyStream.getReader === 'function') {
        console.log('Found a ReadableStream in error body, attempting to read it.');
        try {
            const reader = bodyStream.getReader();
            const decoder = new TextDecoder();
            let result = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                result += decoder.decode(value, { stream: true });
            }
            bodyToParse = result;
            console.log('Successfully read stream to string:', bodyToParse);
        } catch (streamError) {
            console.error('Failed to read error body stream:', streamError);
            bodyToParse = 'Failed to read error stream.';
        }
    } else if (error?.context?.body) {
        bodyToParse = error.context.body;
        console.log('Found error.context.body (not a stream):', bodyToParse);
    } else if (error?.body) {
        bodyToParse = error.body;
        console.log('Found error.body (not a stream):', bodyToParse);
    } else if (error?.error) {
        bodyToParse = error; // The object itself is structured like { error: ..., details: ... }
        console.log('Error object itself is structured:', bodyToParse);
    }

    let parsedDetails: any = null;
    if (typeof bodyToParse === 'string') {
        try {
            parsedDetails = JSON.parse(bodyToParse);
        } catch {
            parsedDetails = { message: bodyToParse }; // Treat as plain text
        }
    } else if (typeof bodyToParse === 'object' && bodyToParse !== null) {
        parsedDetails = bodyToParse;
    }

    if (parsedDetails) {
        if (parsedDetails.error?.includes('MUREKA_API_KEY not configured')) {
            finalMessage = 'Erro de configuração no servidor: a chave da API Mureka não foi configurada na Edge Function. Por favor, configure a variável de ambiente MUREKA_API_KEY no painel do Supabase.';
        } else if (parsedDetails.error === 'Mureka API call failed' && parsedDetails.details) {
            const murekaMsg = parsedDetails.details.message || JSON.stringify(parsedDetails.details);
            finalMessage = `Erro da API Mureka (via proxy - Status: ${parsedDetails.status || 'desconhecido'}): ${murekaMsg}`;
        } else if (parsedDetails.error) {
            finalMessage = `Erro da função do Supabase (mureka-proxy): ${parsedDetails.error}`;
        } else if (parsedDetails.message) {
            finalMessage = `Erro da função do Supabase (mureka-proxy): ${parsedDetails.message}`;
        }
    } else if (error?.message) {
      if (error.message.includes('Edge Function returned a non-2xx status code')) {
        finalMessage = `Erro de execução na função do Supabase. Verifique os logs da função 'mureka-proxy' no Supabase para mais detalhes.`;
      } else {
        finalMessage = `Erro ao chamar a função do Supabase (mureka-proxy): ${error.message}`;
      }
    }
    
    console.log('Final error message:', finalMessage);
    console.groupEnd();
    return finalMessage;
  }
}
