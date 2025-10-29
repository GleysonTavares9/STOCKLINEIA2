import { Injectable, signal, inject, effect, untracked, computed } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { SupabaseService, Music } from './supabase.service';
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

  private async getApiErrorMessage(error: any, defaultMessage: string): Promise<string> {
    console.groupCollapsed('🚨 MurekaService: getApiErrorMessage - Debugging');
    console.log('Raw error object received:', error);
  
    // Case 1: Supabase client isn't configured on the frontend.
    if (error?.message?.includes('Supabase client not initialized')) {
      console.log('Error Type: Supabase client not initialized.');
      console.groupEnd();
      return 'O Supabase não está configurado. Verifique as credenciais no `src/config.ts`.';
    }
  
    // Case 2: A network/runtime error from supabase.functions.invoke().
    // This error object will NOT have our custom `isProxyError` flag.
    if (error?.message && !error.isProxyError) {
      console.log('Error Type: Supabase invokeFunction network/runtime error.');
      if (error.message.includes('Edge Function returned a non-2xx status code')) {
        console.groupEnd();
        // This path is less likely with the new proxy, but kept for robustness.
        return `Erro de execução na função do Supabase. Verifique os logs da função 'mureka-proxy' no Supabase para mais detalhes.`;
      }
      if (error.message.includes('Failed to send a request to the Edge Function')) {
          console.groupEnd();
          return 'Falha de rede ao conectar com a Edge Function do Supabase. Verifique se a função `mureka-proxy` está implantada e acessível.';
      }
      console.groupEnd();
      return `Erro ao chamar a função do Supabase: ${error.message}`;
    }
  
    // Case 3: A structured error returned from our proxy function.
    // The 'error' object passed here is the 'data' object from the invokeFunction response.
    const proxyErrorDetails = error;
  
    // Specific error from Edge Function if MUREKA_API_KEY is missing
    if (proxyErrorDetails.error?.includes('MUREKA_API_KEY not configured')) {
        console.log('Error Type: MUREKA_API_KEY not configured.');
        console.groupEnd();
        return 'Erro de configuração no servidor: a chave da API Mureka não foi configurada na Edge Function. Por favor, configure a variável de ambiente MUREKA_API_KEY no painel do Supabase para a função `mureka-proxy`.';
    }
  
    // Handle structured error response from the proxy for Mureka API failures
    if (proxyErrorDetails.error === 'Mureka API call failed') {
        const murekaStatus = proxyErrorDetails.status; 
        const murekaDetails = proxyErrorDetails.details;
        
        let detailMessage = 'Detalhes desconhecidos da API Mureka.';
        if (murekaDetails) {
          const detailsToParse = typeof murekaDetails === 'object' && murekaDetails !== null ? murekaDetails : { message: String(murekaDetails) };
          if (detailsToParse.error) {
              detailMessage = typeof detailsToParse.error === 'string' ? detailsToParse.error : JSON.stringify(detailsToParse.error);
          } else if (detailsToParse.message) {
              detailMessage = detailsToParse.message;
          } else {
              detailMessage = JSON.stringify(detailsToParse);
          }
        }
  
        console.log('Error Type: Mureka API call failed (from proxy).');
        console.groupEnd();
        return `Erro da API Mureka (via proxy - Status: ${murekaStatus || 'desconhecido'}): ${detailMessage}`;
    }
    
    // Generic error returned by the Edge Function
    if (proxyErrorDetails.error) {
        console.log('Error Type: Generic Edge Function error.');
        console.groupEnd();
        return `Erro da função do Supabase (mureka-proxy): ${proxyErrorDetails.error}`;
    }
  
    // Final fallback.
    console.log('Error Type: Unknown error (final fallback).');
    console.groupEnd();
    return defaultMessage;
  }

  async generateMusic(title: string, style: string, lyrics: string): Promise<void> {
    if (!this.isConfigured()) {
        const errorMsg = 'O Supabase não está configurado. Verifique as credenciais em `src/config.ts`.';
        console.error('MurekaService: generateMusic: Supabase not configured.', errorMsg);
        await this.supabase.addMusic({ title, style, lyrics, status: 'failed', error: errorMsg });
        throw new Error(errorMsg);
    }
    
    // A autenticação da Mureka agora é tratada pela Edge Function, mas ainda precisamos do usuário logado
    // para registrar a música no Supabase e gerenciar créditos.
    const session = await this.supabase.getSession();
    if (!session?.access_token) {
      const errorMsg = "Usuário não autenticado no Supabase. Impossível gerar música.";
      console.error('MurekaService: generateMusic: User not authenticated.', errorMsg);
      await this.supabase.addMusic({ title, style, lyrics, status: 'failed', error: 'Você precisa estar logado para criar músicas.' });
      throw new Error(errorMsg);
    }

    let musicRecord: Music | null = null;
    // A chamada para a API Mureka é feita através da Edge Function 'mureka-proxy' do Supabase.
    // Isso garante que a chave da API (MUREKA_API_KEY) nunca seja exposta no frontend,
    // seguindo as melhores práticas de segurança. A função atua como um proxy seguro.
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
        console.error('MurekaService: Erro ao chamar a função proxy (`mureka-proxy`) para gerar música (proxyError):', proxyError);
        throw proxyError; // Throw the actual error object from invokeFunction
      }
      // Check for proxied errors in data object from the proxy function
      if (!data || data.error) { 
          console.error('MurekaService: Resposta inválida ou erro da API da Mureka via proxy (data.error):', data);
          throw data; // Throw the data object containing the error
      }
      if (typeof data.id !== 'string') {
        console.error('MurekaService: Resposta da API da Mureka via proxy não contém ID válido:', data);
        throw new Error('A API Mureka (via proxy) não retornou um ID de tarefa válido.');
      }

      const taskId = data.id;
      await this.supabase.updateMusic(finalMusicRecord.id, { mureka_id: taskId });
    } catch (error: any) {
        const errorMessage = await this.getApiErrorMessage(error, 'Falha ao gerar a música.');
        console.error('MurekaService: Erro ao gerar música:', errorMessage);
  
        if (musicRecord) {
          await this.supabase.updateMusic(musicRecord.id, {
            status: 'failed',
            error: errorMessage,
          });
          // Update local state to reflect failure
          this.userMusic.update(current =>
            current.map(m =>
              m.id === musicRecord!.id ? { ...m, status: 'failed', metadata: { error: errorMessage } } : m
            )
          );
        }
        throw new Error(errorMessage);
    }
  }
  
  // Fix: Added missing method 'generateInstrumental' to fix call in create.component.ts.
  async generateInstrumental(title: string, style: string): Promise<void> {
    // Instrumental music is generated by calling generateMusic without lyrics.
    return this.generateMusic(title, style, '');
  }
  
  // Fix: Added missing method 'deleteMusic' to fix call in library.component.ts.
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

  // Fix: Added missing method 'clearFailedMusic' to fix call in library.component.ts.
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
}
