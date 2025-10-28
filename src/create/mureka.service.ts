

import { Injectable, signal, inject, effect, untracked, computed } from '@angular/core';
import { HttpClient, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SupabaseService, Music } from '../services/supabase.service';
import { environment } from '../auth/config';

// Agora a Mureka API é chamada diretamente do frontend.
// ATENÇÃO: Isso expõe a Mureka API Key no código do cliente.
// A Mureka API BASE URL não é mais usada diretamente, agora as chamadas passam pela Edge Function.
// const MUREKA_API_BASE_URL = 'https://api.mureka.ai/v1';

interface MurekaGenerateResponse {
  id: string;
  //... other properties
}

interface MurekaQueryResponse {
  status: 'preparing' | 'queued' | 'running' | 'streaming' | 'succeeded' | 'failed' | 'timeouted' | 'cancelled';
  failed_reason?: string;
  choices?: { url: string; flac_url?: string; duration?: number; id?: string }[]; // Corrigido para 'url'
}

@Injectable({
  providedIn: 'root',
})
export class MurekaService {
  private readonly http = inject(HttpClient);
  private readonly supabase = inject(SupabaseService);

  userMusic = signal<Music[]>([]);
  // isConfigured agora depende da configuração do Supabase, pois as chamadas Mureka passam por ele.
  readonly isConfigured = computed(() => this.supabase.isConfigured());

  constructor() {
    // A verificação da chave da Mureka foi movida para a Edge Function.
    // O `isConfigured` do frontend agora reflete a prontidão do cliente Supabase.

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

  private getApiErrorMessage(error: any, defaultMessage: string): string {
    // Check for Supabase client initialization error
    if (error?.message?.includes('Supabase client not initialized')) {
      return 'O Supabase não está configurado. Verifique as credenciais no `src/config.ts`.';
    }

    // Specific error from Edge Function if MUREKA_API_KEY is missing
    if (error?.message?.includes('MUREKA_API_KEY not configured on Supabase Edge Function.')) {
        return 'Erro de configuração no servidor: a chave da API Mureka não foi configurada na Edge Function. Por favor, configure a variável de ambiente MUREKA_API_KEY no painel do Supabase para a função `mureka-proxy`.';
    }

    // Handle structured error response from the proxy for Mureka API failures
    if (error?.error === 'Mureka API call failed') {
        const murekaStatus = error.status; // This would be the *Mureka's* HTTP status propagated by the proxy
        const murekaDetails = error.details;
        
        let detailMessage = '';
        // Ensure murekaDetails is an object to prevent error on JSON.stringify if it's a primitive type
        const detailsToParse = typeof murekaDetails === 'object' && murekaDetails !== null ? murekaDetails : { message: String(murekaDetails) };

        if (detailsToParse.error) {
            detailMessage = typeof detailsToParse.error === 'string' ? detailsToParse.error : JSON.stringify(detailsToParse.error);
        } else if (detailsToParse.message) {
            detailMessage = detailsToParse.message;
        } else {
            detailMessage = JSON.stringify(detailsToParse);
        }
        
        return `Erro da API Mureka (via proxy - Status: ${murekaStatus}): ${detailMessage}`;
    }

    // Trata erros que vêm da invokeFunction diretamente (erros de rede ou do runtime da função)
    // `error` aqui seria o `proxyError` retornado pela `invokeFunction`
    if (error?.message) {
      if (error.message.includes('Function returned an error')) {
        // This is a generic runtime error, try to extract more if possible
        return `Erro de execução na função do Supabase: ${error.message}`;
      }
      if (error.message.includes('Failed to send a request to the Edge Function')) {
        return 'Falha de rede ao conectar com a Edge Function do Supabase. Verifique se a função `mureka-proxy` está implantada e acessível.';
      }
      return `Erro ao chamar a função do Supabase: ${error.message}`;
    }

    // Fallback for HttpErrorResponse if the error wasn't caught earlier (less likely with invokeFunction)
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) {
        return 'Falha de rede. Verifique sua conexão com a internet ou se o Supabase está online.';
      }
      const apiError = error.error;
      if (apiError?.error) return `Erro do backend (${error.status}): ${typeof apiError.error === 'string' ? apiError.error : JSON.stringify(apiError.error)}`;
      if (apiError?.message) return `Erro do backend (${error.status}): ${apiError.message}`;
      if (apiError?.detail) return `Erro do backend (${error.status}): ${apiError.detail}`;
      
      return `Erro na requisição ao backend: ${error.status} - ${error.statusText}`;
    }

    return defaultMessage;
  }

  async generateMusic(title: string, style: string, lyrics: string): Promise<void> {
    if (!this.isConfigured()) {
        const errorMsg = 'O Supabase não está configurado. Verifique as credenciais em `src/config.ts`.';
        console.error(errorMsg);
        await this.supabase.addMusic({ title, style, lyrics, status: 'failed', error: errorMsg });
        throw new Error(errorMsg);
    }
    
    // A autenticação da Mureka agora é tratada pela Edge Function, mas ainda precisamos do usuário logado
    // para registrar a música no Supabase e gerenciar créditos.
    const session = await this.supabase.getSession();
    if (!session?.access_token) {
      const errorMsg = "Usuário não autenticado no Supabase. Impossível gerar música.";
      console.error(errorMsg);
      await this.supabase.addMusic({ title, style, lyrics, status: 'failed', error: 'Você precisa estar logado para criar músicas.' });
      throw new Error(errorMsg);
    }

    let musicRecord: Music | null = null;
    try {
      musicRecord = await this.supabase.addMusic({
        title,
        style,
        lyrics,
        status: 'processing',
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

      // Chama a Edge Function para proxy para a API Mureka
      const { data, error: proxyError } = await this.supabase.invokeFunction('mureka-proxy', {
          body: {
              murekaApiPath: 'song/generate',
              method: 'POST',
              requestBody: murekaRequestBody,
          }
      });

      if (proxyError) {
        console.error('MurekaService: Erro ao chamar a função proxy (`mureka-proxy`) para gerar música:', proxyError);
        throw proxyError; // Throw the actual error object from invokeFunction
      }
      // Check for proxied errors in data object from the proxy function
      if (!data || data.error) { 
          console.error('MurekaService: Resposta inválida ou erro da API da Mureka via proxy:', data);
          throw data; // Throw the data object containing the error
      }
      if (typeof data.id !== 'string') {
        console.error('MurekaService: Resposta da API da Mureka via proxy não contém ID válido:', data);
        throw new Error('A API Mureka (via proxy) não retornou um ID de tarefa válido.');
      }


      const taskId = data.id;
      await this.supabase.updateMusic(finalMusicRecord.id, { mureka_id: taskId });
      this.pollForResult(finalMusicRecord.id, taskId, 'song/query');

    } catch (error) {
      console.error('MurekaService: Erro ao iniciar a geração da música:', error);
      const errorMessage = this.getApiErrorMessage(error, 'Ocorreu um erro desconhecido ao contatar a API da Mureka.');
      this.handleGenerationError(error, musicRecord, { title, style, lyrics, errorMessage });
      throw new Error(errorMessage);
    }
  }

  async generateInstrumental(title: string, style: string): Promise<void> {
    if (!this.isConfigured()) {
        const errorMsg = 'O Supabase não está configurado. Verifique as credenciais em `src/config.ts`.';
        console.error(errorMsg);
        await this.supabase.addMusic({ title, style, lyrics: '', status: 'failed', error: errorMsg });
        throw new Error(errorMsg);
    }

    const session = await this.supabase.getSession();
    if (!session?.access_token) {
      const errorMsg = "Usuário não autenticado no Supabase. Impossível gerar música.";
      console.error(errorMsg);
      await this.supabase.addMusic({ title, style, lyrics: '', status: 'failed', error: 'Você precisa estar logado para criar músicas.' });
      throw new Error(errorMsg);
    }

    let musicRecord: Music | null = null;
    try {
      musicRecord = await this.supabase.addMusic({
        title,
        style,
        lyrics: '', // Instrumentals have no lyrics
        status: 'processing',
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

      // Chama a Edge Function para proxy para a API Mureka
      const { data, error: proxyError } = await this.supabase.invokeFunction('mureka-proxy', {
          body: {
              murekaApiPath: 'instrumental/generate',
              method: 'POST',
              requestBody: murekaRequestBody,
          }
      });

      if (proxyError) {
        console.error('MurekaService: Erro ao chamar a função proxy (`mureka-proxy`) para gerar instrumental:', proxyError);
        throw proxyError; // Throw the actual error object from invokeFunction
      }
      // Check for proxied errors in data object from the proxy function
      if (!data || data.error) { 
          console.error('MurekaService: Resposta inválida ou erro da API da Mureka via proxy:', data);
          throw data; // Throw the data object containing the error
      }
      if (typeof data.id !== 'string') {
        console.error('MurekaService: Resposta da API da Mureka via proxy não contém ID válido:', data);
        throw new Error('A API Mureka (via proxy) não retornou um ID de tarefa válido.');
      }


      const taskId = data.id;
      await this.supabase.updateMusic(finalMusicRecord.id, { mureka_id: taskId });
      this.pollForResult(finalMusicRecord.id, taskId, 'instrumental/query');

    } catch (error) {
      console.error('MurekaService: Erro ao iniciar a geração do instrumental:', error);
      const errorMessage = this.getApiErrorMessage(error, 'Ocorreu um erro desconhecido ao contatar a API da Mureka.');
      this.handleGenerationError(error, musicRecord, { title, style, lyrics: '', errorMessage });
      throw new Error(errorMessage);
    }
  }

  private async handleGenerationError(error: any, musicRecord: Music | null, details: { title: string, style: string, lyrics: string, errorMessage: string }) {
    if (musicRecord) {
      const updatedMusic = await this.supabase.updateMusic(musicRecord.id, { status: 'failed', error: details.errorMessage });
      if (updatedMusic) {
          this.userMusic.update(music => music.map(s => s.id === updatedMusic.id ? updatedMusic : s));
      }
    } else {
       const newFailedMusic = await this.supabase.addMusic({ title: details.title, style: details.style, lyrics: details.lyrics, status: 'failed', error: details.errorMessage });
       if (newFailedMusic) {
          this.userMusic.update(current => [newFailedMusic, ...current]);
       }
    }
  }
  
  private pollForResult(musicId: string, taskId: string, queryPath: 'song/query' | 'instrumental/query'): void {
    const maxRetries = 30; // 30 retries * 10 seconds = 5 minutes timeout
    let attempt = 0;

    const intervalId = setInterval(async () => {
      attempt++;

      // Stop if timeout is reached
      if (attempt > maxRetries) {
        clearInterval(intervalId);
        console.error(`MurekaService: Polling timeout for task ${taskId}`);
        const errorMsg = 'O tempo para gerar a música esgotou.';
        const updatedMusic = await this.supabase.updateMusic(musicId, { status: 'failed', error: errorMsg });
        if (updatedMusic) {
            this.userMusic.update(music => music.map(s => s.id === updatedMusic.id ? updatedMusic : s));
        }
        return;
      }

      // Se o usuário não estiver mais autenticado no Supabase (ex: logout), podemos parar de verificar.
      if (!this.supabase.currentUser()) {
        clearInterval(intervalId);
        console.error("MurekaService: Usuário não autenticado. Interrompendo a verificação de status da música.");
        const errorMsg = 'Você foi desconectado. Faça login novamente para ver o resultado.';
        const updatedMusic = await this.supabase.updateMusic(musicId, { status: 'failed', error: errorMsg });
        if (updatedMusic) {
            this.userMusic.update(music => music.map(s => s.id === updatedMusic.id ? updatedMusic : s));
        }
        return;
      }

      try {
        // Chama a Edge Function para proxy para a API Mureka para consulta
        const { data: queryResponse, error: proxyError } = await this.supabase.invokeFunction('mureka-proxy', {
            body: {
                murekaApiPath: `${queryPath}/${taskId}`,
                method: 'GET',
            }
        });

        if (proxyError) {
          console.error(`MurekaService: Erro retornado pela invokeFunction para tarefa ${taskId}:`, proxyError);
          // Don't throw here, just update status and stop polling if this is a terminal error.
          // The error message from getApiErrorMessage will be more specific.
          const errorMessage = this.getApiErrorMessage(proxyError, 'Erro ao verificar o status da música.');
          const updatedMusic = await this.supabase.updateMusic(musicId, { status: 'failed', error: errorMessage });
          if (updatedMusic) {
              this.userMusic.update(music => music.map(s => s.id === updatedMusic.id ? updatedMusic : s));
          }
          clearInterval(intervalId);
          return;
        }

        // Se data.error existe, significa que a Edge Function proxyou um erro da API Mureka
        if (queryResponse?.error) {
            console.error(`MurekaService: A API Mureka (via proxy) reportou um erro para a tarefa ${taskId}:`, queryResponse);
            const errorMessage = this.getApiErrorMessage(queryResponse, 'Erro ao verificar o status da música.');
            const updatedMusic = await this.supabase.updateMusic(musicId, { status: 'failed', error: errorMessage });
            if (updatedMusic) {
                this.userMusic.update(music => music.map(s => s.id === updatedMusic.id ? updatedMusic : s));
            }
            clearInterval(intervalId);
            return;
        }

        // `queryResponse` é a resposta real da API da Mureka
        // --- Início dos logs detalhados para diagnóstico ---
        console.log(`MurekaService: Mureka Query Response for task ${taskId} (tentativa ${attempt}/${maxRetries}):`, queryResponse);
        console.log(`MurekaService: Mureka Query Status: ${queryResponse.status}`);
        if (queryResponse.failed_reason) {
          console.log(`MurekaService: Mureka Query Failed Reason: ${queryResponse.failed_reason}`);
        }
        console.log(`MurekaService: Mureka Query Choices:`, queryResponse.choices);
        // --- Fim dos logs detalhados ---

        const status = queryResponse.status;
        
        if (status === 'succeeded') {
          clearInterval(intervalId);
          // Acessando a propriedade 'url' que é a correta na resposta da Mureka
          const audioUrl = queryResponse.choices?.[0]?.url; 
          if (!audioUrl) {
            // Log do objeto completo serializado para inspeção clara
            console.error('MurekaService: A API Mureka reportou sucesso, mas nenhuma URL de áudio foi encontrada. Objeto de resposta completo (JSON.stringify):', JSON.stringify(queryResponse, null, 2));
            const errorMsg = 'API retornou sucesso, mas a URL do áudio não foi encontrada.';
            const updatedMusic = await this.supabase.updateMusic(musicId, { status: 'failed', error: errorMsg });
            if (updatedMusic) {
                this.userMusic.update(music => music.map(s => s.id === updatedMusic.id ? updatedMusic : s));
            }
            return;
          }
          const updatedMusic = await this.supabase.updateMusic(musicId, { status: 'succeeded', audio_url: audioUrl });
           if (updatedMusic) {
            this.userMusic.update(music => music.map(s => s.id === updatedMusic.id ? updatedMusic : s));
          }
        } else if (status === 'failed' || status === 'timeouted' || status === 'cancelled') {
          clearInterval(intervalId);
          const reason = queryResponse.failed_reason || 'A geração falhou por um motivo desconhecido.';
          console.error(`MurekaService: A geração de música falhou para a tarefa ${taskId}:`, reason, queryResponse); // Log full response for failed status
          const updatedMusic = await this.supabase.updateMusic(musicId, { status: 'failed', error: reason });
           if (updatedMusic) {
            this.userMusic.update(music => music.map(s => s.id === updatedMusic.id ? updatedMusic : s));
          }
        }
        // If status is still processing (e.g., 'queued', 'running'), do nothing and let the interval continue.

      } catch (error) {
        clearInterval(intervalId);
        console.error(`MurekaService: Erro durante o polling para a tarefa ${taskId}:`, error);
         const errorMessage = this.getApiErrorMessage(error, 'Erro ao verificar o status da música.');
         const updatedMusic = await this.supabase.updateMusic(musicId, { status: 'failed', error: errorMessage });
          if (updatedMusic) {
            this.userMusic.update(music => music.map(s => s.id === updatedMusic.id ? updatedMusic : s));
          }
      }
    }, 10000); // Poll every 10 seconds
  }

  async deleteMusic(musicId: string): Promise<void> {
    const { error, count } = await this.supabase.deleteMusic(musicId);
    if (error) {
      // Improved error logging
      console.error('MurekaService: Erro ao apagar música:', error.message, error); 
      // Throw the error so the UI layer can catch it and notify the user.
      throw new Error(error.message || 'Falha ao apagar a música.');
    } else if (count === 0) {
        // This is a business logic error: the requested item was not deleted.
        // It could be due to RLS or because it was already deleted.
        throw new Error('A música não foi encontrada ou você não tem permissão para apagá-la.');
    } else {
      this.userMusic.update(music => music.filter(s => s.id !== musicId));
    }
  }

  async clearFailedMusic(): Promise<void> {
    const user = this.supabase.currentUser();
    if (!user) return;

    const { error } = await this.supabase.deleteFailedMusicForUser(user.id);
    if (error) {
        // Improved error logging
        console.error('MurekaService: Erro ao limpar músicas com falha:', error.message, error);
        throw new Error(error.message || 'Falha ao limpar as músicas com falha.');
    } else {
        this.userMusic.update(music => music.filter(s => s.status !== 'failed'));
    }
  }
}
