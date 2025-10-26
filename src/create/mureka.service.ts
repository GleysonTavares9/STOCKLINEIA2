import { Injectable, signal, inject, effect, untracked } from '@angular/core';
import { HttpClient, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SupabaseService, Music } from '../services/supabase.service';
import { environment } from '../config';

// The new base URL points to the Supabase function proxy.
const MUREKA_PROXY_URL = new URL('/functions/v1/mureka-proxy', environment.supabaseUrl).href;

interface MurekaGenerateResponse {
  id: string;
  //... other properties
}

interface MurekaQueryResponse {
  status: 'preparing' | 'queued' | 'running' | 'streaming' | 'succeeded' | 'failed' | 'timeouted' | 'cancelled';
  failed_reason?: string;
  choices?: { audio_url: string }[];
}

@Injectable({
  providedIn: 'root',
})
export class MurekaService {
  private readonly http = inject(HttpClient);
  private readonly supabase = inject(SupabaseService);
  // isConfigured now depends on Supabase, as the proxy function is part of it.
  readonly isConfigured = this.supabase.isConfigured;

  userMusic = signal<Music[]>([]);

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

  private getApiErrorMessage(error: any, defaultMessage: string): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) {
        return 'Falha de rede ao contatar o backend. Verifique sua conexão com a internet.';
      }
      
      const apiError = error.error;
      if (error.status === 401) {
        return 'Erro de Autenticação: Sua sessão pode ter expirado. Tente fazer login novamente.';
      }
      if (error.status === 500 && apiError?.error?.includes('Mureka API key not configured')) {
        return 'Erro de Configuração no Servidor: A chave da API da Mureka não foi configurada no backend.';
      }

      if (apiError?.detail) return `Erro da API Mureka (${error.status}): ${apiError.detail}`;
      if (apiError?.message) return `Erro da API Mureka (${error.status}): ${apiError.message}`;
      if (apiError?.error) return `Erro do Servidor (${error.status}): ${apiError.error}`;
      
      return `Erro na requisição: ${error.status} - ${error.statusText}`;
    }

    if (error?.message) return `Erro de comunicação: ${error.message}`;
    return defaultMessage;
  }

  async generateMusic(title: string, style: string, lyrics: string): Promise<void> {
    if (!this.isConfigured()) {
        const errorMsg = 'O Supabase não está configurado. A geração de música está desativada.';
        console.error(errorMsg);
        await this.supabase.addMusic({ title, style, lyrics, status: 'failed', error: errorMsg });
        return;
    }

    const session = await this.supabase.getSession();
    if (!session?.access_token) {
      const errorMsg = "Usuário não autenticado. Impossível gerar música.";
      console.error(errorMsg);
      // Optionally create a failed record to inform the user.
      await this.supabase.addMusic({ title, style, lyrics, status: 'failed', error: 'Você precisa estar logado para criar músicas.' });
      return;
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
      
      // Headers now include the user's JWT for authentication with the Supabase function.
      const headers = new HttpHeaders({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': environment.supabaseKey, // The anon key is required to invoke functions.
      });

      const body: { [key: string]: any } = {
        title,
        tags: style,
        model_version: 'v2'
      };

      // The Mureka API might reject requests with an empty lyrics string.
      // Only include the lyrics property if it's not empty. This handles
      // instrumental songs correctly, as they will have empty lyrics.
      if (lyrics && lyrics.trim().length > 0) {
        body.lyrics = lyrics;
      }

      const generateResponse = await firstValueFrom(
        this.http.post<MurekaGenerateResponse>(`${MUREKA_PROXY_URL}/generate`, body, { headers })
      );

      const taskId = generateResponse.id;

      await this.supabase.updateMusic(finalMusicRecord.id, { mureka_id: taskId });
      
      this.pollForResult(finalMusicRecord.id, taskId);

    } catch (error) {
      console.error('Erro ao iniciar a geração da música:', error);
      const errorMessage = this.getApiErrorMessage(error, 'Ocorreu um erro desconhecido ao contatar o backend.');

      if (musicRecord) {
        const updatedMusic = await this.supabase.updateMusic(musicRecord.id, { status: 'failed', error: errorMessage });
        if (updatedMusic) {
            this.userMusic.update(music => music.map(s => s.id === updatedMusic.id ? updatedMusic : s));
        }
      } else {
         const newFailedMusic = await this.supabase.addMusic({ title, style, lyrics, status: 'failed', error: errorMessage });
         if (newFailedMusic) {
            this.userMusic.update(current => [newFailedMusic, ...current]);
         }
      }
    }
  }

  private async pollForResult(musicId: string, taskId: string): Promise<void> {
    const session = await this.supabase.getSession();
    if (!session?.access_token) {
      console.error("Sessão expirada. Interrompendo a verificação de status da música.");
      const errorMsg = 'Sua sessão expirou. Faça login novamente para ver o resultado.';
      const updatedMusic = await this.supabase.updateMusic(musicId, { status: 'failed', error: errorMsg });
       if (updatedMusic) {
          this.userMusic.update(music => music.map(s => s.id === updatedMusic.id ? updatedMusic : s));
       }
      return;
    }

    const poll = async (retries: number): Promise<void> => {
      if (retries <= 0) {
        console.error(`Polling timeout for task ${taskId}`);
        const errorMsg = 'O tempo para gerar a música esgotou.';
        const updatedMusic = await this.supabase.updateMusic(musicId, { status: 'failed', error: errorMsg });
        if (updatedMusic) {
            this.userMusic.update(music => music.map(s => s.id === updatedMusic.id ? updatedMusic : s));
        }
        return;
      }

      try {
        await new Promise(resolve => setTimeout(resolve, 10000)); 

        const headers = new HttpHeaders({
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': environment.supabaseKey,
        });

        const queryResponse = await firstValueFrom(
          this.http.get<MurekaQueryResponse>(`${MUREKA_PROXY_URL}/query?id=${taskId}`, { headers })
        );

        const status = queryResponse.status;
        
        if (status === 'succeeded') {
          const audioUrl = queryResponse.choices?.[0]?.audio_url;
          if (!audioUrl) {
            throw new Error('API retornou sucesso, mas a URL do áudio não foi encontrada.');
          }
          const updatedMusic = await this.supabase.updateMusic(musicId, { status: 'succeeded', audio_url: audioUrl });
           if (updatedMusic) {
            this.userMusic.update(music => music.map(s => s.id === updatedMusic.id ? updatedMusic : s));
          }
        } else if (status === 'failed' || status === 'timeouted' || status === 'cancelled') {
          const reason = queryResponse.failed_reason || 'A geração falhou por um motivo desconhecido.';
          const updatedMusic = await this.supabase.updateMusic(musicId, { status: 'failed', error: reason });
           if (updatedMusic) {
            this.userMusic.update(music => music.map(s => s.id === updatedMusic.id ? updatedMusic : s));
          }
        } else {
          poll(retries - 1);
        }

      } catch (error) {
        console.error(`Error polling for task ${taskId}:`, error);
         const errorMessage = this.getApiErrorMessage(error, 'Erro ao verificar o status da música.');
         const updatedMusic = await this.supabase.updateMusic(musicId, { status: 'failed', error: errorMessage });
          if (updatedMusic) {
            this.userMusic.update(music => music.map(s => s.id === updatedMusic.id ? updatedMusic : s));
          }
      }
    };

    poll(30);
  }

  async deleteMusic(musicId: string): Promise<void> {
    const { error } = await this.supabase.deleteMusic(musicId);
    if (error) {
      console.error('Error deleting music:', error.message);
      // In a real app, you might want to show a user-facing error.
    } else {
      this.userMusic.update(music => music.filter(s => s.id !== musicId));
    }
  }

  async clearFailedMusic(): Promise<void> {
    const user = this.supabase.currentUser();
    if (!user) return;

    const { error } = await this.supabase.deleteFailedMusicForUser(user.id);
    if (error) {
        console.error('Error clearing failed music:', error.message);
    } else {
        this.userMusic.update(music => music.filter(s => s.status !== 'failed'));
    }
  }
}
