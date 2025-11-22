import { Injectable, signal, inject, effect, untracked, computed } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { SupabaseService, Music } from './supabase.service';

interface AIGenerateResponse {
  id: string;
  file_id?: string;
}

interface AIQueryResponse {
  status: 'preparing' | 'queued' | 'running' | 'streaming' | 'succeeded' | 'failed' | 'timeouted' | 'cancelled';
  failed_reason?: string;
  choices?: { url: string; flac_url?: string; duration?: number; id?: string }[];
  file_id?: string;
  progress?: number;
}

@Injectable({
  providedIn: 'root',
})
export class StocklineAiService {
  private readonly supabase = inject(SupabaseService);
  private currentlyPolling = new Set<string>();

  userMusic = signal<Music[]>([]);
  readonly isConfigured = computed(() => this.supabase.isConfigured());

  constructor() {
    effect(() => {
      const user = this.supabase.currentUser();
      if (user) {
        this.supabase.getMusicForUser(user.id).then(music => {
            this.userMusic.set(music);
            const processingMusic = music.filter(m => m.status === 'processing' && m.task_id);
            console.log(`StocklineAiService: Encontradas ${processingMusic.length} música(s) em processamento na carga inicial.`);
            processingMusic.forEach(m => {
                const queryPath = (m.metadata?.queryPath as 'song/query' | 'instrumental/query' | 'voice_clone/query') || 'song/query';
                this.pollForResult(m.id, m.task_id!, queryPath);
            });
        });
      } else {
        this.userMusic.set([]);
        this.currentlyPolling.clear();
      }
    });
  }

  async uploadAudio(file: File, title: string, description?: string): Promise<Music> {
    const user = this.supabase.currentUser();
    if (!this.isConfigured() || !user) {
      throw new Error('O Supabase não está configurado ou o usuário não está autenticado.');
    }

    let musicRecord: Music | null = null;
    
    try {
      musicRecord = await this.supabase.addMusic({
        title,
        style: 'Clone de Estilo (Arquivo)',
        lyrics: description || '',
        status: 'processing',
        is_public: false,
        metadata: { progress: 0, status_message: 'Iniciando upload...' }
      });

      if (!musicRecord) {
        throw new Error('Falha ao criar registro da música.');
      }

      const finalMusicRecord = musicRecord;
      this.userMusic.update(current => [finalMusicRecord, ...current]);

      const fileContent = await this.fileToBase64(file);
      
      const { data, error: proxyError } = await this.supabase.invokeFunction('mureka-proxy', {
        body: {
          apiPath: 'files/upload',
          murekaApiPath: 'files/upload', // Compatibility
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

      const fileId = data.id;
      
      const updatedRecordWithFile = await this.supabase.updateMusic(finalMusicRecord.id, { 
        ai_task_id: fileId,
        metadata: { 
          ...(finalMusicRecord.metadata || {}),
          file_id: fileId,
          original_filename: file.name,
          progress: 5,
          status_message: 'Arquivo enviado. Analisando o áudio...'
        }
      });
      if (updatedRecordWithFile) {
        this.userMusic.update(music => music.map(s => s.id === finalMusicRecord.id ? updatedRecordWithFile : s));
      }

      await this.processUploadedAudio(finalMusicRecord.id, fileId, title, description);
      return finalMusicRecord;

    } catch (error) {
      const errorMessage = await this.getApiErrorMessage(error, 'Erro ao fazer upload do arquivo.');
      await this.handleGenerationError(error, musicRecord, { 
        title, 
        style: 'Clone de Estilo (Arquivo)', 
        lyrics: description || '', 
        errorMessage, 
        is_public: false 
      });
      throw new Error(errorMessage);
    }
  }

  async processYouTubeVideo(youtubeUrl: string, title: string, isPublic: boolean): Promise<Music> {
    const user = this.supabase.currentUser();
    if (!this.isConfigured() || !user) {
      throw new Error('O Supabase não está configurado ou o usuário não está autenticado.');
    }

    let musicRecord: Music | null = null;
    const queryPath = 'instrumental/query';

    try {
      musicRecord = await this.supabase.addMusic({
        title,
        style: `Clone de Estilo (YouTube)`,
        lyrics: `Gerado a partir de: ${youtubeUrl}`,
        status: 'processing', 
        is_public: isPublic,
        metadata: { youtube_url: youtubeUrl, queryPath: queryPath, progress: 0, status_message: 'Iniciando processamento do YouTube...' }
      });

      if (!musicRecord) {
        throw new Error('Falha ao criar registro da música.');
      }
      
      const finalMusicRecord = musicRecord;
      this.userMusic.update(current => [finalMusicRecord, ...current]);

      const apiPath = 'instrumental/generate';
      const requestBody = {
        audio_url: youtubeUrl,
        prompt: `Uma nova faixa instrumental inspirada no estilo, humor e instrumentação do áudio de referência do YouTube.`,
        model: 'auto',
        n: 1,
      };

      const { data, error: proxyError } = await this.supabase.invokeFunction('mureka-proxy', {
        body: { 
          apiPath: apiPath, 
          murekaApiPath: apiPath, // Compatibility
          method: 'POST', 
          requestBody 
        }
      });

      if (proxyError) throw proxyError;
      if (data?.error) throw data;

      await this.supabase.consumeCredits(user.id, 1, `Criação por YouTube: "${title}"`, musicRecord.id);

      const taskId = data.id;
      const updatedRecord = await this.supabase.updateMusic(finalMusicRecord.id, { 
        ai_task_id: taskId,
        metadata: {
          ...(finalMusicRecord.metadata || {}),
          progress: 10,
          status_message: 'Vídeo do YouTube processado. Gerando faixa...'
        }
      });
      
      if (updatedRecord) {
        this.userMusic.update(music => music.map(s => s.id === finalMusicRecord.id ? updatedRecord : s));
      }

      this.pollForResult(finalMusicRecord.id, taskId, queryPath);
      return finalMusicRecord;

    } catch (error) {
      const errorMessage = await this.getApiErrorMessage(error, 'Erro ao processar o vídeo do YouTube.');
      await this.handleGenerationError(error, musicRecord, { 
        title, 
        style: 'Clone de Estilo (YouTube)', 
        lyrics: `Gerado a partir de: ${youtubeUrl}`, 
        errorMessage, 
        is_public: isPublic 
      });
      throw new Error(errorMessage);
    }
  }

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
            apiPath: 'song/describe',
            murekaApiPath: 'song/describe', // Compatibility
            method: 'POST',
            requestBody: { file_id: fileId }
          }
        });

        if (!describeError && describeData?.description) {
          analysisDescription = describeData.description;
          await this.supabase.updateMusic(musicId, {
            description: description || `Áudio analisado: ${analysisDescription}`,
            metadata: { 
              ...existingMetadata,
              progress: 20,
              status_message: 'Áudio analisado. Gerando instrumental...'
            }
          });
        }
      } catch (describeError) {
        console.warn('StocklineAiService: Não foi possível analisar o áudio:', describeError);
      }

      const { data, error: proxyError } = await this.supabase.invokeFunction('mureka-proxy', {
        body: {
          apiPath: 'instrumental/generate',
          murekaApiPath: 'instrumental/generate', // Compatibility
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
        ai_task_id: taskId,
        metadata: {
          ...existingMetadata,
          queryPath: 'instrumental/query',
          progress: 30,
          status_message: 'Geração do instrumental iniciada...'
        }
      });
      
      if (updatedRecord) {
        this.userMusic.update(music => music.map(s => s.id === musicId ? updatedRecord : s));
      }

      this.pollForResult(musicId, taskId, 'instrumental/query');

    } catch (error) {
      const errorMessage = await this.getApiErrorMessage(error, 'Erro ao processar o arquivo de áudio para geração.');
      
      const updatedMusic = await this.supabase.updateMusic(musicId, { 
        status: 'failed', 
        metadata: { ...(originalRecord?.metadata || {}), error: errorMessage, progress: 100, status_message: 'Falha na geração.' } 
      });

      if (updatedMusic) {
        this.userMusic.update(music => music.map(m => m.id === musicId ? updatedMusic : m));
      }
    }
  }

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
        metadata: { ...(musicRecord.metadata || {}), error: details.errorMessage, progress: 100, status_message: 'Falha na geração.' } 
      });
      if (updatedMusic) {
          this.userMusic.update(music => music.map(s => s.id === updatedMusic.id ? updatedMusic : s));
      }
    } else {
       const newFailedMusic = await this.supabase.addMusic({ title: details.title, style: details.style, lyrics: details.lyrics, status: 'failed', error: details.errorMessage, is_public: details.is_public, metadata: { progress: 100, status_message: 'Falha na geração.' } });
       if (newFailedMusic) {
          this.userMusic.update(current => [newFailedMusic, ...current]);
       }
    }
  }

  async generateMusic(title: string, displayStyle: string, aiPrompt: string, lyrics: string, isPublic: boolean): Promise<Music> {
    const user = this.supabase.currentUser();
    if (!this.isConfigured() || !user) {
        const errorMsg = 'O Supabase não está configurado ou o usuário não está autenticado.';
        await this.handleGenerationError(null, null, { title, style: displayStyle, lyrics, errorMessage: errorMsg, is_public: isPublic });
        throw new Error(errorMsg);
    }
    
    let musicRecord: Music | null = null;
    try {
      musicRecord = await this.supabase.addMusic({
        title,
        style: displayStyle,
        lyrics,
        status: 'processing',
        is_public: isPublic,
        metadata: { queryPath: 'song/query', progress: 0, status_message: 'Iniciando geração da música...' }
      });

      if (!musicRecord) {
        throw new Error('Falha ao criar o registro da música no banco de dados.');
      }

      const finalMusicRecord = musicRecord;
      this.userMusic.update(current => [finalMusicRecord, ...current]);
      
      const aiRequestBody: { [key: string]: any } = {
        prompt: aiPrompt,
        model: 'auto',
        n: 1, 
      };
      
      if (lyrics && lyrics.trim().length > 0) {
        aiRequestBody.lyrics = lyrics;
      }

      const { data, error: proxyError } = await this.supabase.invokeFunction('mureka-proxy', {
          body: {
              apiPath: 'song/generate',
              murekaApiPath: 'song/generate', // Compatibility
              method: 'POST',
              requestBody: aiRequestBody,
          }
      });

      if (proxyError) throw proxyError;
      if (data?.error) throw data;
      if (typeof data.id !== 'string') throw new Error('A API de IA não retornou um ID de tarefa válido.');

      await this.supabase.consumeCredits(user.id, 1, `Criação de música: "${title}"`, musicRecord.id);

      const taskId = data.id;
      const updatedRecord = await this.supabase.updateMusic(finalMusicRecord.id, { 
        ai_task_id: taskId,
        metadata: { ...(finalMusicRecord.metadata || {}), progress: 10, status_message: 'Requisição enviada. Aguardando a IA...' }
      });
      if (updatedRecord) {
        this.userMusic.update(music => music.map(s => s.id === finalMusicRecord.id ? updatedRecord : s));
      }
      this.pollForResult(finalMusicRecord.id, taskId, 'song/query');
      return finalMusicRecord;

    } catch (error) {
      const errorMessage = await this.getApiErrorMessage(error, 'Ocorreu um erro desconhecido.');
      await this.handleGenerationError(error, musicRecord, { title, style: displayStyle, lyrics, errorMessage, is_public: isPublic });
      throw new Error(errorMessage);
    }
  }

  async generateInstrumental(title: string, style: string, isPublic: boolean): Promise<Music> {
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
        metadata: { queryPath: 'instrumental/query', progress: 0, status_message: 'Iniciando geração do instrumental...' }
      });

      if (!musicRecord) {
        throw new Error('Falha ao criar o registro da música no banco de dados.');
      }
      
      const finalMusicRecord = musicRecord;
      this.userMusic.update(current => [finalMusicRecord, ...current]);
      
      const aiRequestBody = {
        prompt: style,
        model: 'auto',
        n: 1,
      };

      const { data, error: proxyError } = await this.supabase.invokeFunction('mureka-proxy', {
          body: {
              apiPath: 'instrumental/generate',
              murekaApiPath: 'instrumental/generate', // Compatibility
              method: 'POST',
              requestBody: aiRequestBody,
          }
      });

      if (proxyError) throw proxyError;
      if (data?.error) throw data;
      if (typeof data.id !== 'string') throw new Error('A API de IA não retornou um ID de tarefa válido.');

      await this.supabase.consumeCredits(user.id, 1, `Criação de instrumental: "${title}"`, musicRecord.id);

      const taskId = data.id;
      const updatedRecord = await this.supabase.updateMusic(finalMusicRecord.id, { 
        ai_task_id: taskId,
        metadata: { ...(finalMusicRecord.metadata || {}), progress: 10, status_message: 'Requisição enviada. Aguardando a IA...' }
      });
      if (updatedRecord) {
        this.userMusic.update(music => music.map(s => s.id === finalMusicRecord.id ? updatedRecord : s));
      }
      this.pollForResult(finalMusicRecord.id, taskId, 'instrumental/query');
      return finalMusicRecord;

    } catch (error) {
      const errorMessage = await this.getApiErrorMessage(error, 'Ocorreu um erro desconhecido.');
      await this.handleGenerationError(error, musicRecord, { title, style, lyrics: '', errorMessage, is_public: isPublic });
      throw new Error(errorMessage);
    }
  }

  async cloneVoice(voiceSampleFile: File, title: string, lyrics: string, style: string, isPublic: boolean): Promise<Music> {
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
        metadata: { queryPath: 'voice_clone/query', progress: 0, status_message: 'Iniciando clonagem de voz...' }
      });

      if (!musicRecord) throw new Error('Falha ao criar o registro da música.');
      
      const finalMusicRecord = musicRecord;
      this.userMusic.update(current => [finalMusicRecord, ...current]);

      const fileContent = await this.fileToBase64(voiceSampleFile);
      const { data: uploadData, error: uploadError } = await this.supabase.invokeFunction('mureka-proxy', {
        body: {
          apiPath: 'files/upload',
          murekaApiPath: 'files/upload', // Compatibility
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
          apiPath: 'voice_clone/generate',
          murekaApiPath: 'voice_clone/generate', // Compatibility
          method: 'POST',
          requestBody: { file_id: fileId, lyrics: lyrics, prompt: style, model: 'auto', n: 1 },
        }
      });

      if (proxyError) throw proxyError;
      if (data?.error) throw data;
      
      await this.supabase.consumeCredits(user.id, 1, `Clonagem de voz: "${title}"`, musicRecord.id);

      const taskId = data.id;

      const updatedRecord = await this.supabase.updateMusic(finalMusicRecord.id, { 
        ai_task_id: taskId,
        metadata: { ...(finalMusicRecord.metadata || {}), progress: 10, status_message: 'Amostra de voz enviada. Gerando voz clonada...' }
      });
      if (updatedRecord) this.userMusic.update(music => music.map(s => s.id === finalMusicRecord.id ? updatedRecord : s));

      this.pollForResult(finalMusicRecord.id, taskId, 'voice_clone/query');
      return finalMusicRecord;

    } catch (error) {
      const errorMessage = await this.getApiErrorMessage(error, 'Ocorreu um erro ao clonar a voz.');
      await this.handleGenerationError(error, musicRecord, { title, style: `Voz clonada, ${style}`, lyrics, errorMessage, is_public: isPublic });
      throw new Error(errorMessage);
    }
  }

  async extendMusic(originalMusicId: string, durationInSeconds: number): Promise<Music> {
    const user = this.supabase.currentUser();
    if (!this.isConfigured() || !user) {
        throw new Error('O Supabase não está configurado ou o usuário não está autenticado.');
    }
    
    const originalMusic = this.userMusic().find(m => m.id === originalMusicId);
    if (!originalMusic || !originalMusic.task_id) {
        throw new Error("Música original ou ID da tarefa de IA não encontrado para extensão.");
    }

    const queryPath = originalMusic.metadata?.queryPath as 'song/query' | 'instrumental/query' | 'voice_clone/query' | undefined;
    if (!queryPath) {
      throw new Error("Não foi possível determinar o tipo da faixa original para estendê-la.");
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
              progress: 0,
              status_message: 'Iniciando extensão da música...'
            }
        });

        if (!newMusicRecord) throw new Error('Falha ao criar o registro para a música estendida.');
        
        const finalNewMusicRecord = newMusicRecord;
        this.userMusic.update(current => [finalNewMusicRecord, ...current]);

        const extendPath = queryPath.replace('query', 'extend');

        const { data, error: proxyError } = await this.supabase.invokeFunction('mureka-proxy', {
            body: {
                apiPath: extendPath,
                murekaApiPath: extendPath, // Compatibility
                method: 'POST',
                requestBody: { id: originalMusic.task_id, duration: durationInSeconds },
            }
        });

        if (proxyError) throw proxyError;
        if (data?.error) throw data;
        
        await this.supabase.consumeCredits(user.id, 1, `Extensão de música: "${originalMusic.title}"`, newMusicRecord.id);

        const taskId = data.id;
        const updatedRecord = await this.supabase.updateMusic(newMusicRecord.id, { 
          ai_task_id: taskId,
          metadata: { ...(newMusicRecord.metadata || {}), progress: 10, status_message: 'Requisição de extensão enviada...' }
        });
        if (updatedRecord) this.userMusic.update(music => music.map(s => s.id === finalNewMusicRecord.id ? updatedRecord : s));
        
        this.pollForResult(newMusicRecord.id, taskId, queryPath);
        return newMusicRecord;

    } catch (error) {
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

  private pollForResult(musicId: string, taskId: string, queryPath: 'song/query' | 'instrumental/query' | 'voice_clone/query'): void {
    if (this.currentlyPolling.has(taskId)) {
      return;
    }
    this.currentlyPolling.add(taskId);

    const interval = 10000;
    const maxAttempts = 60;
    let attempts = 0;

    const executePoll = async () => {
      const originalMusic = this.userMusic().find(m => m.id === musicId);
      if (!originalMusic || !['processing'].includes(originalMusic.status)) {
        this.currentlyPolling.delete(taskId);
        return;
      }

      if (attempts >= maxAttempts) {
        const updatedMusic = await this.supabase.updateMusic(musicId, { 
          status: 'failed', 
          metadata: { ...(originalMusic?.metadata || {}), error: 'A geração demorou muito para responder (timeout).', progress: 100, status_message: 'Falha na geração.' } 
        });
        if(updatedMusic) this.userMusic.update(musics => musics.map(m => m.id === musicId ? updatedMusic : m));
        this.currentlyPolling.delete(taskId);
        return;
      }
      
      attempts++;
      
      try {
          const result = await this.queryMusicStatus(taskId, queryPath);
          const isFinalStatus = ['succeeded', 'failed', 'timeouted', 'cancelled'].includes(result.status);
          
          let currentProgress: number;
          let currentStatusMessage: string;

          switch (result.status) {
              case 'preparing': currentProgress = 15; currentStatusMessage = 'Preparando os recursos de IA...'; break;
              case 'queued': currentProgress = 30; currentStatusMessage = 'Na fila de processamento...'; break;
              case 'running': currentProgress = result.progress ? 30 + (result.progress * 0.5) : 60; currentStatusMessage = 'Gerando a faixa de áudio...'; break;
              case 'streaming': currentProgress = 85; currentStatusMessage = 'Renderizando e finalizando...'; break;
              case 'succeeded': currentProgress = 100; currentStatusMessage = 'Música gerada com sucesso!'; break;
              case 'failed':
              case 'timeouted':
              case 'cancelled': currentProgress = 100; currentStatusMessage = result.failed_reason || 'Falha na geração.'; break;
              default: currentProgress = (originalMusic.metadata?.progress as number) || 0; currentStatusMessage = (originalMusic.metadata?.status_message as string) || 'Status desconhecido.'; break;
          }

          const updatedMetadata = { 
            ...(originalMusic?.metadata || {}), 
            progress: currentProgress, 
            status_message: currentStatusMessage 
          };
          this.userMusic.update(musics => musics.map(m => m.id === musicId ? { ...m, metadata: updatedMetadata } : m));

          if (isFinalStatus) {
              await this.handleFinalStatus(musicId, result);
              this.currentlyPolling.delete(taskId);
          } else {
              setTimeout(executePoll, interval);
          }
      } catch (error) {
          const errorMessage = await this.getApiErrorMessage(error, 'Erro ao verificar o status da geração.');
          const updatedMusic = await this.supabase.updateMusic(musicId, { 
            status: 'failed', 
            metadata: { ...(originalMusic?.metadata || {}), error: errorMessage, progress: 100, status_message: 'Falha na comunicação.' } 
          });
          if (updatedMusic) this.userMusic.update(musics => musics.map(m => m.id === musicId ? updatedMusic : m));
          this.currentlyPolling.delete(taskId);
      }
    };
    
    setTimeout(executePoll, 5000);
  }

  private async queryMusicStatus(taskId: string, queryPath: 'song/query' | 'instrumental/query' | 'voice_clone/query' = 'song/query'): Promise<AIQueryResponse> {
    const apiPath = `${queryPath}/${taskId}`;
    const { data, error: proxyError } = await this.supabase.invokeFunction('mureka-proxy', {
        body: {
            apiPath: apiPath,
            murekaApiPath: apiPath, // Compatibility
            method: 'GET',
        }
    });

    if (proxyError) throw proxyError;
    if (data?.error) throw data;

    return data as AIQueryResponse;
  }

  private async handleFinalStatus(musicId: string, result: AIQueryResponse): Promise<void> {
    const originalMusic = this.userMusic().find(m => m.id === musicId);
    if (!originalMusic) return;

    let updatedMusic: Music | null = null;
    const existingMetadata = originalMusic.metadata || {};

    if (result.status === 'succeeded') {
        const audioUrl = result.choices?.[0]?.url;
        if (audioUrl) {
            updatedMusic = await this.supabase.updateMusic(musicId, { 
                status: 'succeeded', 
                audio_url: audioUrl,
                metadata: { ...existingMetadata, duration: result.choices?.[0]?.duration, ai_choice_id: result.choices?.[0]?.id }
            });
        } else {
            updatedMusic = await this.supabase.updateMusic(musicId, { 
                status: 'failed', 
                metadata: { ...existingMetadata, error: 'Sucesso, mas a API de IA não forneceu um URL de áudio.' } 
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
    let finalMessage = error?.message || defaultMessage;

    if (error?.message?.includes('Supabase client not initialized')) {
        return 'O Supabase não está configurado. Verifique as credenciais.';
    }

    const functionName = 'mureka-proxy';
    if (error?.message && (error.message.toLowerCase().includes('function not found') || error.message.includes('NotFoundException'))) {
      if (error.message.includes(functionName) || error.message.includes('stockline-ai-proxy')) {
        return `Erro de Configuração: A função '${functionName}' não foi encontrada no Supabase. Verifique se a Edge Function foi implantada corretamente com este nome.`;
      }
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
        try { parsedDetails = JSON.parse(bodyToParse); } catch { /* ignore */ }
    } else if (typeof bodyToParse === 'object' && bodyToParse !== null) {
        parsedDetails = bodyToParse;
    }

    if (parsedDetails) {
        if (parsedDetails.error?.includes('STOCKLINE_AI_API_KEY not configured')) {
            return 'Erro de configuração no servidor: a chave da API da STOCKLINE AI não foi configurada na Edge Function.';
        } else if (parsedDetails.error === 'AI API call failed' && parsedDetails.details) {
            const apiMsg = parsedDetails.details.message || JSON.stringify(parsedDetails.details);
            return `Erro da API de IA (via proxy - Status: ${parsedDetails.status || 'desconhecido'}): ${apiMsg}`;
        } else if (parsedDetails.error) {
            return `Erro da função do Supabase (mureka-proxy): ${parsedDetails.error}`;
        }
    }
    
    return finalMessage;
  }
}