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
    const user = this.supabase.currentUser();
    if (!this.isConfigured() || !user) {
      throw new Error('O Supabase não está configurado ou o usuário não está autenticado.');
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
          murekaApiPath: 'v1/files/upload',
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
          ...(finalMusicRecord.metadata || {}),
          file_id: fileId,
          original_filename: file.name,
          file_size: file.size,
          upload_type: 'direct'
        }
      });
      
      if (updatedRecord) {
        this.userMusic.update(music => music.map(s => s.id === finalMusicRecord.id ? updatedRecord : s));
      }

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

  async processYouTubeVideo(
    youtubeUrl: string, 
    title: string, 
    prompt: string, 
    lyrics: string, 
    isInstrumental: boolean, 
    isPublic: boolean
  ): Promise<void> {
    const user = this.supabase.currentUser();
    if (!this.isConfigured() || !user) {
      throw new Error('O Supabase não está configurado ou o usuário não está autenticado.');
    }

    let musicRecord: Music | null = null;
    const queryPath = isInstrumental ? 'v1/instrumental/query' : 'v1/song/query';

    try {
      musicRecord = await this.supabase.addMusic({
        title,
        style: `YouTube: ${prompt}`,
        lyrics: lyrics,
        status: 'processing', 
        is_public: isPublic,
        metadata: { youtube_url: youtubeUrl, queryPath: queryPath }
      });

      if (!musicRecord) {
        throw new Error('Falha ao criar registro da música.');
      }
      
      const finalMusicRecord = musicRecord;
      this.userMusic.update(current => [finalMusicRecord, ...current]);

      // Usar endpoints corretos da API Mureka v1
      const apiPath = isInstrumental ? 'v1/instrumental/generate' : 'v1/song/generate';
      const requestBody: any = {
        audio_url: youtubeUrl,
        prompt: prompt,
        model: 'auto',
        n: 1,
      };
      
      if (!isInstrumental) {
        requestBody.lyrics = lyrics;
      }

      console.log('MurekaService: Enviando requisição para:', apiPath, requestBody);

      const { data, error: proxyError } = await this.supabase.invokeFunction('mureka-proxy', {
        body: {
          murekaApiPath: apiPath,
          method: 'POST',
          requestBody: requestBody
        }
      });

      if (proxyError) throw proxyError;
      if (data?.error) throw data;

      console.log('MurekaService: Resposta da geração:', data);

      await this.supabase.consumeCredits(user.id, 1, `Criação por YouTube: "${title}"`, musicRecord.id);

      const taskId = data.id;
      
      const processingMethod = isInstrumental ? 'generation_from_youtube' : 'generation_from_youtube';

      const updatedRecord = await this.supabase.updateMusic(finalMusicRecord.id, { 
        mureka_id: taskId,
        metadata: {
          ...(finalMusicRecord.metadata || {}),
          processing_method: processingMethod
        }
      });
      
      if (updatedRecord) {
        this.userMusic.update(music => music.map(s => s.id === finalMusicRecord.id ? updatedRecord : s));
      }

      this.pollForResult(finalMusicRecord.id, taskId, queryPath);

    } catch (error) {
      console.error('MurekaService: Erro ao processar vídeo do YouTube:', error);
      const errorMessage = await this.getApiErrorMessage(error, 'Erro ao processar o vídeo do YouTube.');
      await this.handleGenerationError(error, musicRecord, { 
        title, 
        style: 'youtube', 
        lyrics: lyrics, 
        errorMessage, 
        is_public: isPublic
      });
      throw new Error(errorMessage);
    }
  }

  // ========== MÉTODOS DE ANÁLISE PARA ÁUDIO UPLOADADO ==========

  private async processUploadedAudio(musicId: string, fileId: string, title: string, description?: string): Promise<void> {
    const originalRecord = this.userMusic().find(m => m.id === musicId);
    const user = this.supabase.currentUser();
    if (!user) throw new Error("Usuário se desconectou durante o processamento.");
    
    try {
      const existingMetadata = originalRecord?.metadata || {};

      let analysisDescription = '';
      try {
        const { data: describeData, error: describeError } = await this.supabase.invokeFunction('mureka-proxy', {
          body: {
            murekaApiPath: 'v1/song/describe',
            method: 'POST',
            requestBody: {
              file_id: fileId
            }
          }
        });

        if (!describeError && describeData?.description) {
          analysisDescription = describeData.description;
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

      // Gerar música a partir do arquivo uploadado usando generate
      const { data, error: proxyError } = await this.supabase.invokeFunction('mureka-proxy', {
        body: {
          murekaApiPath: 'v1/instrumental/generate',
          method: 'POST',
          requestBody: {
            file_id: fileId,
            prompt: description || analysisDescription || 'Uma nova faixa instrumental com estilo, humor e instrumentação semelhantes ao áudio de referência.',
            model: 'auto',
            n: 1
          }
        }
      });

      if (proxyError) throw proxyError;
      if (data?.error) throw data;

      await this.supabase.consumeCredits(user.id, 1, `Criação por upload: "${title}"`, musicId);

      const taskId = data.id;
      
      const updatedRecord = await this.supabase.updateMusic(musicId, { 
        mureka_id: taskId,
        metadata: {
          ...existingMetadata,
          queryPath: 'v1/instrumental/query',
          processing_method: 'generation_from_upload'
        }
      });
      
      if (updatedRecord) {
        this.userMusic.update(music => music.map(s => s.id === musicId ? updatedRecord : s));
      }

      this.pollForResult(musicId, taskId, 'v1/instrumental/query');

    } catch (error) {
      console.error('MurekaService: Erro ao processar áudio uploadado para geração:', error);
      const errorMessage = await this.getApiErrorMessage(error, 'Erro ao processar o arquivo de áudio para geração.');
      
      const updatedMusic = await this.supabase.updateMusic(musicId, { 
        status: 'failed', 
        metadata: { ...(originalRecord?.metadata || {}), error: errorMessage } 
      });

      if (updatedMusic) {
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
      const updatedMusic = await this.supabase.updateMusic(musicRecord.id, { 
        status: 'failed', 
        metadata: { ...(musicRecord.metadata || {}), error: details.errorMessage } 
      });
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
    const user = this.supabase.currentUser();
    if (!this.isConfigured() || !user) {
        const errorMsg = 'O Supabase não está configurado ou o usuário não está autenticado.';
        await this.handleGenerationError(null, null, { title, style, lyrics, errorMessage: errorMsg, is_public: isPublic });
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
        metadata: { queryPath: 'v1/song/query' }
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

      console.log('MurekaService: Gerando música com:', murekaRequestBody);

      const { data, error: proxyError } = await this.supabase.invokeFunction('mureka-proxy', {
          body: {
              murekaApiPath: 'v1/song/generate',
              method: 'POST',
              requestBody: murekaRequestBody,
          }
      });

      if (proxyError) throw proxyError;
      if (data?.error) throw data;
      if (typeof data.id !== 'string') throw new Error('A API Mureka não retornou um ID de tarefa válido.');

      await this.supabase.consumeCredits(user.id, 1, `Criação de música: "${title}"`, musicRecord.id);

      const taskId = data.id;
      const updatedRecord = await this.supabase.updateMusic(finalMusicRecord.id, { mureka_id: taskId });
      if (updatedRecord) {
        this.userMusic.update(music => music.map(s => s.id === finalMusicRecord.id ? updatedRecord : s));
      }
      this.pollForResult(finalMusicRecord.id, taskId, 'v1/song/query');

    } catch (error) {
      console.error('MurekaService: Erro ao iniciar a geração da música:', error);
      const errorMessage = await this.getApiErrorMessage(error, 'Ocorreu um erro desconhecido.');
      await this.handleGenerationError(error, musicRecord, { title, style, lyrics, errorMessage, is_public: isPublic });
      throw new Error(errorMessage);
    }
  }

  async generateInstrumental(title: string, style: string, isPublic: boolean): Promise<void> {
    const user = this.supabase.currentUser();
    if (!this.isConfigured() || !user) {
        const errorMsg = 'O Supabase não está configurado ou o usuário não está autenticado.';
        await this.handleGenerationError(null, null, { title, style, lyrics: '', errorMessage: errorMsg, is_public: isPublic });
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
        metadata: { queryPath: 'v1/instrumental/query' }
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

      console.log('MurekaService: Gerando instrumental com:', murekaRequestBody);

      const { data, error: proxyError } = await this.supabase.invokeFunction('mureka-proxy', {
          body: {
              murekaApiPath: 'v1/instrumental/generate',
              method: 'POST',
              requestBody: murekaRequestBody,
          }
      });

      if (proxyError) throw proxyError;
      if (data?.error) throw data;
      if (typeof data.id !== 'string') throw new Error('A API Mureka não retornou um ID de tarefa válido.');

      await this.supabase.consumeCredits(user.id, 1, `Criação de instrumental: "${title}"`, musicRecord.id);

      const taskId = data.id;
      const updatedRecord = await this.supabase.updateMusic(finalMusicRecord.id, { mureka_id: taskId });
      if (updatedRecord) {
        this.userMusic.update(music => music.map(s => s.id === finalMusicRecord.id ? updatedRecord : s));
      }
      this.pollForResult(finalMusicRecord.id, taskId, 'v1/instrumental/query');

    } catch (error) {
      console.error('MurekaService: Erro ao iniciar a geração do instrumental:', error);
      const errorMessage = await this.getApiErrorMessage(error, 'Ocorreu um erro desconhecido.');
      await this.handleGenerationError(error, musicRecord, { title, style, lyrics: '', errorMessage, is_public: isPublic });
      throw new Error(errorMessage);
    }
  }

  // ========== VOICE CLONING ==========

  async cloneVoice(voiceSampleFile: File, title: string, lyrics: string, style: string, isPublic: boolean): Promise<void> {
    const user = this.supabase.currentUser();
    if (!this.isConfigured() || !user) {
      throw new Error('O Supabase não está configurado ou o usuário não está autenticado.');
    }

    let musicRecord: Music | null = null;
    try {
      musicRecord = await this.supabase.addMusic({
        title,
        style: `Voz clonada, ${style}`,
        lyrics,
        status: 'processing',
        is_public: isPublic,
        metadata: { queryPath: 'v1/voice_clone/query', type: 'voice_clone' }
      });

      if (!musicRecord) throw new Error('Falha ao criar o registro da música.');
      
      const finalMusicRecord = musicRecord;
      this.userMusic.update(current => [finalMusicRecord, ...current]);

      const fileContent = await this.fileToBase64(voiceSampleFile);
      const { data: uploadData, error: uploadError } = await this.supabase.invokeFunction('mureka-proxy', {
        body: {
          murekaApiPath: 'v1/files/upload',
          method: 'POST',
          isFileUpload: true,
          requestBody: {
            fileContent: fileContent.split(',')[1],
            fileName: voiceSampleFile.name,
            fileType: voiceSampleFile.type,
            purpose: 'reference'
          }
        }
      });

      if (uploadError) throw uploadError;
      if (uploadData?.error) throw uploadData;
      const fileId = uploadData.id;

      const { data, error: proxyError } = await this.supabase.invokeFunction('mureka-proxy', {
        body: {
          murekaApiPath: 'v1/voice_clone/generate',
          method: 'POST',
          requestBody: { file_id: fileId, lyrics: lyrics, prompt: style, model: 'auto', n: 1 },
        }
      });

      if (proxyError) throw proxyError;
      if (data?.error) throw data;
      
      await this.supabase.consumeCredits(user.id, 1, `Clonagem de voz: "${title}"`, musicRecord.id);

      const taskId = data.id;

      const updatedRecord = await this.supabase.updateMusic(finalMusicRecord.id, { mureka_id: taskId });
      if (updatedRecord) this.userMusic.update(music => music.map(s => s.id === finalMusicRecord.id ? updatedRecord : s));

      this.pollForResult(finalMusicRecord.id, taskId, 'v1/voice_clone/query');

    } catch (error) {
      const errorMessage = await this.getApiErrorMessage(error, 'Ocorreu um erro ao clonar a voz.');
      await this.handleGenerationError(error, musicRecord, { title, style: `Voz clonada, ${style}`, lyrics, errorMessage, is_public: isPublic });
      throw new Error(errorMessage);
    }
  }

  // ========== EXTEND MUSIC ==========
  async extendMusic(originalMusicId: string, durationInSeconds: number): Promise<void> {
    const user = this.supabase.currentUser();
    if (!this.isConfigured() || !user) {
        throw new Error('O Supabase não está configurado ou o usuário não está autenticado.');
    }
    
    const originalMusic = this.userMusic().find(m => m.id === originalMusicId);
    // FIX: Use 'task_id' instead of 'mureka_id' to match the Music interface.
    if (!originalMusic || !originalMusic.task_id) {
        throw new Error("Música original ou ID da tarefa Mureka não encontrado para extensão.");
    }

    const queryPath = originalMusic.metadata?.queryPath as 'v1/song/query' | 'v1/instrumental/query' | 'v1/voice_clone/query' | undefined;
    if (!queryPath) {
      throw new Error("Não foi possível determinar o tipo da faixa original para estendê-la.");
    }

    let newMusicRecord: Music | null = null;
    try {
        newMusicRecord = await this.supabase.addMusic({
            title: `${originalMusic.title} (Estendida)`,
            style: originalMusic.style,
            // FIX: Use 'description' instead of 'lyrics' to match the Music interface.
            lyrics: originalMusic.description,
            status: 'processing',
            is_public: originalMusic.is_public ?? false,
            metadata: { 
              original_music_id: originalMusic.id, 
              queryPath: queryPath,
              processing_method: 'extended'
            }
        });

        if (!newMusicRecord) throw new Error('Falha ao criar o registro para a música estendida.');
        
        this.userMusic.update(current => [newMusicRecord!, ...current]);

        const extendPath = queryPath.replace('query', 'extend');

        const { data, error: proxyError } = await this.supabase.invokeFunction('mureka-proxy', {
            body: {
                murekaApiPath: extendPath,
                method: 'POST',
                // FIX: Use 'task_id' instead of 'mureka_id' to match the Music interface.
                requestBody: { id: originalMusic.task_id, duration: durationInSeconds },
            }
        });

        if (proxyError) throw proxyError;
        if (data?.error) throw data;
        
        await this.supabase.consumeCredits(user.id, 1, `Extensão de música: "${originalMusic.title}"`, newMusicRecord.id);

        const taskId = data.id;
        const updatedRecord = await this.supabase.updateMusic(newMusicRecord.id, { mureka_id: taskId });
        if (updatedRecord) this.userMusic.update(music => music.map(s => s.id === newMusicRecord!.id ? updatedRecord : s));
        
        this.pollForResult(newMusicRecord.id, taskId, queryPath);

    } catch (error) {
        const errorMessage = await this.getApiErrorMessage(error, 'Falha ao estender a música.');
        await this.handleGenerationError(error, newMusicRecord, { 
            title: `${originalMusic.title} (Estendida)`, 
            style: originalMusic.style, 
            // FIX: Use 'description' instead of 'lyrics' to match the Music interface.
            lyrics: originalMusic.description, 
            errorMessage, 
            is_public: originalMusic.is_public ?? false 
        });
        throw new Error(errorMessage);
    }
  }

  // ========== POLLING & STATUS ==========

  async queryMusicStatus(taskId: string, queryPath: 'v1/song/query' | 'v1/instrumental/query' | 'v1/voice_clone/query' = 'v1/song/query'): Promise<MurekaQueryResponse> {
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
  
  private pollForResult(musicId: string, taskId: string, queryPath: 'v1/song/query' | 'v1/instrumental/query' | 'v1/voice_clone/query'): void {
    const interval = 10000; // 10 seconds
    const maxAttempts = 60; // 10 minutes max
    let attempts = 0;

    const executePoll = async () => {
      if (attempts >= maxAttempts) {
        console.log(`MurekaService: Polling for task ${taskId} timed out after ${maxAttempts} attempts.`);
        const originalMusic = this.userMusic().find(m => m.id === musicId);
        await this.supabase.updateMusic(musicId, { status: 'failed', metadata: { ...(originalMusic?.metadata || {}), error: 'A geração demorou muito para responder (timeout).' } });
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
          const originalMusic = this.userMusic().find(m => m.id === musicId);
          await this.supabase.updateMusic(musicId, { status: 'failed', metadata: { ...(originalMusic?.metadata || {}), error: errorMessage } });
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
        const flacUrl = result.choices?.[0]?.flac_url;
        const fileId = result.file_id;
        
        if (audioUrl || flacUrl) {
            let finalUrl = flacUrl || audioUrl;
            if (fileId) {
                finalUrl = `https://api.mureka.ai/v1/files/${fileId}/download`;
            }
            updatedMusic = await this.supabase.updateMusic(musicId, { 
                status: 'succeeded', 
                audio_url: finalUrl,
                metadata: { 
                  ...existingMetadata, 
                  file_id: fileId,
                  duration: result.choices?.[0]?.duration,
                  mureka_choice_id: result.choices?.[0]?.id
                }
            });
        } else {
            updatedMusic = await this.supabase.updateMusic(musicId, { 
                status: 'failed', 
                metadata: { ...existingMetadata, error: 'Sucesso, mas a Mureka não forneceu um URL de áudio.' } 
            });
        }
    } else {
        const reason = result.failed_reason || `A geração falhou com o status: ${result.status}`;
        updatedMusic = await this.supabase.updateMusic(musicId, { 
            status: 'failed', 
            metadata: { ...existingMetadata, error: reason } 
        });
    }

    if (updatedMusic) {
        this.userMusic.update(musics => musics.map(m => m.id === musicId ? updatedMusic : m));
        const user = this.supabase.currentUser();
        if (user) {
            if (updatedMusic.status === 'succeeded') {
                await this.supabase.addNotification(user.id, 'Música Pronta!', `Sua música "${updatedMusic.title}" foi gerada com sucesso.`, 'success');
            } else if (updatedMusic.status === 'failed') {
                await this.supabase.addNotification(user.id, 'Falha na Geração', `Houve um problema ao gerar "${updatedMusic.title}".`, 'error');
            }
        }
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

  updateLocalMusic(updatedMusic: Music): void {
    this.userMusic.update(musics => 
      musics.map(m => m.id === updatedMusic.id ? updatedMusic : m)
    );
  }
  
  private async getApiErrorMessage(error: any, defaultMessage: string): Promise<string> {
    console.groupCollapsed('🚨 MurekaService: getApiErrorMessage - Debugging');
    console.log('Raw error object received:', error);

    let finalMessage = error?.message || defaultMessage;

    if (error?.message?.includes('Supabase client not initialized')) {
        finalMessage = 'O Supabase não está configurado. Verifique as credenciais.';
    }

    // Verificar se é um erro 404 específico de endpoint
    if (finalMessage.includes('404') && finalMessage.includes('page not found')) {
        finalMessage = 'Endpoint da API Mureka não encontrado. Verifique se o caminho da API está correto.';
    }

    let bodyToParse: any = null;
    const bodyStream = error?.context?.body || error?.body;

    if (bodyStream && typeof bodyStream.getReader === 'function') {
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
        } catch (streamError) {
            bodyToParse = 'Failed to read error stream.';
        }
    } else {
        bodyToParse = error?.context?.body || error?.body || error;
    }

    let parsedDetails: any = null;
    if (typeof bodyToParse === 'string') {
        try {
            parsedDetails = JSON.parse(bodyToParse);
        } catch {
            parsedDetails = { message: bodyToParse };
        }
    } else if (typeof bodyToParse === 'object' && bodyToParse !== null) {
        parsedDetails = bodyToParse;
    }

    if (parsedDetails) {
        if (parsedDetails.error?.includes('MUREKA_API_KEY not configured')) {
            finalMessage = 'Erro de configuração no servidor: a chave da API Mureka não foi configurada na Edge Function.';
        } else if (parsedDetails.error === 'Mureka API call failed' && parsedDetails.details) {
            const murekaMsg = parsedDetails.details.message || JSON.stringify(parsedDetails.details);
            finalMessage = `Erro da API Mureka (via proxy - Status: ${parsedDetails.status || 'desconhecido'}): ${murekaMsg}`;
        } else if (parsedDetails.error) {
            finalMessage = `Erro da função do Supabase (mureka-proxy): ${parsedDetails.error}`;
        }
    }
    
    console.log('Final error message:', finalMessage);
    console.groupEnd();
    return finalMessage;
  }
}
