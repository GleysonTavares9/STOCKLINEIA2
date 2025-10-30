import { Injectable, signal, inject, effect, untracked, computed } from '@angular/core';
import { SupabaseService, Music } from './supabase.service';

interface MurekaGenerateResponse {
  id: string;
  //... other properties
}

interface MurekaQueryResponse {
  status: 'preparing' | 'queued' | 'running' | 'streaming' | 'succeeded' | 'failed' | 'timeouted' | 'cancelled';
  failed_reason?: string;
  choices?: { url: string; flac_url?: string; duration?: number; id?: string }[];
}

@Injectable({
  providedIn: 'root',
})
export class MurekaService {
  private readonly supabase = inject(SupabaseService);

  userMusic = signal<Music[]>([]);
  readonly isConfigured = computed(() => this.supabase.isConfigured());

  constructor() {
    // Load user music when auth state changes
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

  private async getApiErrorMessage(error: any, defaultMessage: string): Promise<string> {
    console.groupCollapsed('🚨 MurekaService: getApiErrorMessage - Debugging');
    console.log('Raw error object received:', error);

    // Check for Supabase client initialization error
    if (error?.message?.includes('Supabase client not initialized')) {
        console.log('Error Type: Supabase client not initialized.');
        console.groupEnd();
        return 'O Supabase não está configurado. Verifique as credenciais no `src/config.ts`.';
    }

    // Handle different error structures, starting with reading a potential stream body
    let bodyToParse: any = null;
    const bodyStream = error?.context?.body || error?.body;

    if (bodyStream && typeof bodyStream.getReader === 'function') { // Check if it's a ReadableStream
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
    } else if (error?.error || (error?.message && error.message !== 'Edge Function returned a non-2xx status code')) {
        // This case covers when `throw data` happens or a simple error object is thrown
        bodyToParse = error;
        console.log('Error object itself is structured:', bodyToParse);
    }

    let errorDetails: any = null;
    if (typeof bodyToParse === 'string') {
        try {
            errorDetails = JSON.parse(bodyToParse);
            console.log('Successfully JSON.parsed bodyToParse:', errorDetails);
        } catch (parseError) {
            console.warn('Failed to JSON.parse bodyToParse. It might be plain text or malformed JSON.', bodyToParse);
            errorDetails = { message: bodyToParse };
        }
    } else if (typeof bodyToParse === 'object' && bodyToParse !== null) {
        errorDetails = bodyToParse;
        console.log('bodyToParse was already an object:', errorDetails);
    }


    console.log('Processed error details:', errorDetails);

    if (errorDetails) {
        // Specific error for missing MUREKA_API_KEY from proxy
        if (errorDetails.error?.includes('MUREKA_API_KEY not configured')) {
            console.log('Error Type: MUREKA_API_KEY not configured.');
            console.groupEnd();
            return 'Erro de configuração no servidor: a chave da API Mureka não foi configurada na Edge Function. Por favor, configure a variável de ambiente MUREKA_API_KEY no painel do Supabase para a função `mureka-proxy`.';
        }

        // Handle structured error response from the proxy for Mureka API failures
        if (errorDetails.error === 'Mureka API request failed' || errorDetails.error?.message?.includes('Invalid Request')) {
            const murekaStatus = errorDetails.status; 
            const murekaDetails = errorDetails.details || errorDetails;
            
            let detailMessage = 'Detalhes desconhecidos da API Mureka.';
            if (murekaDetails) {
                if (typeof murekaDetails === 'object') {
                    if (murekaDetails.error) {
                        detailMessage = typeof murekaDetails.error === 'string' ? murekaDetails.error : (murekaDetails.error.message || JSON.stringify(murekaDetails.error));
                    } else if (murekaDetails.message) {
                        detailMessage = murekaDetails.message;
                    } else {
                        detailMessage = JSON.stringify(murekaDetails);
                    }
                } else {
                    detailMessage = String(murekaDetails);
                }
            }
      
            console.log('Error Type: Mureka API call failed (from proxy).');
            console.groupEnd();
            return `Erro da API Mureka (via proxy - Status: ${murekaStatus || 'desconhecido'}): ${detailMessage}`;
        }
        
        // Generic error returned by the Edge Function
        if (errorDetails.error) {
            console.log('Error Type: Generic Edge Function error (with "error" field).');
            console.groupEnd();
            return `Erro da função do Supabase (mureka-proxy): ${errorDetails.error}`;
        }
        if (errorDetails.message) {
            console.log('Error Type: Generic Edge Function error (with "message" field).');
            console.groupEnd();
            return `Erro da função do Supabase (mureka-proxy): ${errorDetails.message}`;
        }
    }

    // Fallback for network errors or unknown errors
    if (error?.message) {
      if (error.message.includes('Edge Function returned a non-2xx status code')) {
        console.log('Error Type: Raw Edge Function non-2xx message (fallback).');
        console.groupEnd();
        // If we reached here, parsing the `body` might have failed or the body was uninformative.
        // Include raw body or message for more info.
        return `Erro de execução na função do Supabase. Verifique os logs da função 'mureka-proxy' no Supabase para mais detalhes. (Original: ${bodyToParse || error.message})`;
      }
      console.log('Error Type: Generic error message (fallback).');
      console.groupEnd();
      return `Erro: ${error.message}`;
    }
    
    console.log('Error Type: Unknown error (final fallback).');
    console.groupEnd();
    return defaultMessage;
  }

  async generateMusic(title: string, style: string, lyrics: string): Promise<void> {
    if (!lyrics || !lyrics.trim()) {
      throw new Error('A letra não pode estar vazia para gerar uma música com vocais.');
    }
    const requestBody = {
      prompt: style,
      model: 'chirp-v3-5',
      n: 1,
      lyrics: lyrics.trim(),
    };
    await this.sendToMurekaProxy('song/generate', title, style, lyrics, requestBody);
  }

  async generateInstrumental(title: string, style: string): Promise<void> {
    const requestBody = {
      prompt: style,
      model: 'auto',
      n: 1,
      stream: false,
    };
    // Salva uma string vazia para as letras no nosso BD para faixas instrumentais
    await this.sendToMurekaProxy('instrumental/generate', title, style, '', requestBody);
  }

  private async sendToMurekaProxy(apiPath: string, title: string, style: string, lyricsForDb: string, murekaRequestBody: object): Promise<void> {
    if (!this.isConfigured()) {
      const errorMsg = 'O Supabase não está configurado. Verifique as credenciais em `src/config.ts`.';
      await this.supabase.addMusic({ title, style, lyrics: lyricsForDb, status: 'failed', error: errorMsg });
      throw new Error(errorMsg);
    }
  
    const session = await this.supabase.getSession();
    if (!session?.access_token) {
      const errorMsg = "Usuário não autenticado no Supabase. Impossível gerar música.";
      await this.supabase.addMusic({ title, style, lyrics: lyricsForDb, status: 'failed', error: 'Você precisa estar logado para criar músicas.' });
      throw new Error(errorMsg);
    }
  
    let musicRecord: Music | null = null;
    try {
      musicRecord = await this.supabase.addMusic({
        title,
        style,
        lyrics: lyricsForDb,
        status: 'processing',
      });
  
      if (!musicRecord) {
        throw new Error('Falha ao criar o registro da música no banco de dados.');
      }
  
      const finalMusicRecord = musicRecord;
      this.userMusic.update(current => [finalMusicRecord, ...current]);
  
      console.log(`MurekaService: Enviando requisição para mureka-proxy (endpoint: ${apiPath}):`, { body: { murekaApiPath: apiPath, method: 'POST', requestBody: murekaRequestBody } });
  
      const { data, error } = await this.supabase.invokeFunction('mureka-proxy', {
        body: {
          murekaApiPath: apiPath,
          method: 'POST',
          requestBody: murekaRequestBody,
        },
      });
  
      if (error) { throw error; }
      if (data?.error) { throw data; }
      if (typeof data?.id !== 'string') { throw new Error('A API Mureka não retornou um ID de tarefa válido.'); }
  
      const taskId = data.id;
      await this.supabase.updateMusic(finalMusicRecord.id, {
        mureka_id: taskId,
        status: 'processing',
      });
  
      console.log('✅ Música enviada para geração com ID:', taskId);
  
    } catch (error: any) {
      const errorMessage = await this.getApiErrorMessage(error, 'Falha ao gerar a música.');
      console.error('MurekaService: Erro ao gerar música:', errorMessage);
  
      if (musicRecord) {
        await this.supabase.updateMusic(musicRecord.id, {
          status: 'failed',
          error: errorMessage,
        });
        this.userMusic.update(current =>
          current.map(m =>
            m.id === musicRecord!.id ? { ...m, status: 'failed', metadata: { ...m.metadata, error: errorMessage } } : m
          )
        );
      }
      throw new Error(errorMessage);
    }
  }

  async deleteMusic(musicId: string): Promise<void> {
    const { error, count } = await this.supabase.deleteMusic(musicId);
    if (error) {
      throw new Error(error.message || 'Falha ao apagar música do banco de dados.');
    }
    if (count === 0) {
      console.warn(`Tentativa de apagar a música com ID ${musicId}, mas nenhuma linha foi afetada.`);
    }
    this.userMusic.update(musics => musics.filter(m => m.id !== musicId));
  }

  async clearFailedMusic(): Promise<void> {
    const user = this.supabase.currentUser();
    if (!user) {
      throw new Error('Usuário não autenticado.');
    }

    const { error, count } = await this.supabase.deleteFailedMusicForUser(user.id);
    if (error) {
      throw new Error(error.message || 'Falha ao limpar as músicas com falha.');
    }

    if (count && count > 0) {
      this.userMusic.update(musics => musics.filter(m => m.status !== 'failed'));
    }
  }

  async queryMusicStatus(taskId: string): Promise<MurekaQueryResponse> {
    if (!this.isConfigured()) {
      throw new Error('Supabase not configured. Cannot query music status.');
    }
  
    try {
      const { data, error } = await this.supabase.invokeFunction('mureka-proxy', {
        body: {
            murekaApiPath: 'song/query',
            method: 'GET',
            queryParams: { id: taskId }
        }
      });
  
      if (error) {
        console.warn('MurekaService: Erro na consulta de status:', error);
        const errorMessage = await this.getApiErrorMessage(error, 'Falha ao consultar status da música.');
        return {
          status: 'failed',
          failed_reason: errorMessage
        };
      }
  
      // Verificação robusta dos dados
      if (!data || typeof data !== 'object') {
        return {
          status: 'failed',
          failed_reason: 'Resposta inválida da API'
        };
      }

      if (data.error) {
        return {
          status: 'failed',
          failed_reason: data.error.message || data.error
        };
      }

      return data as MurekaQueryResponse;
      
    } catch (error: any) {
      console.error('MurekaService: Erro inesperado ao consultar status:', error);
      return {
        status: 'failed',
        failed_reason: 'Erro inesperado ao consultar status'
      };
    }
  }

  // Método auxiliar para verificar se uma música está pronta
  isMusicReady(status: string): boolean {
    return status === 'succeeded';
  }

  // Método auxiliar para verificar se uma música falhou
  isMusicFailed(status: string): boolean {
    return ['failed', 'timeouted', 'cancelled'].includes(status);
  }

  // Método auxiliar para verificar se uma música ainda está processando
  isMusicProcessing(status: string): boolean {
    return ['preparing', 'queued', 'running', 'streaming'].includes(status);
  }
}
