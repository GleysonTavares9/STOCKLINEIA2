import { Injectable, signal, inject, effect, untracked } from '@angular/core';
import { HttpClient, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SupabaseService, Music } from '../services/supabase.service';
import { environment } from '../config';

const MUREKA_API_BASE_URL = 'https://api.mureka.ai/v1';

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
  private readonly murekaApiKey: string;
  readonly isConfigured = signal(true);

  userMusic = signal<Music[]>([]);

  constructor() {
    this.murekaApiKey = environment.murekaApiKey;
    if (!this.murekaApiKey || this.murekaApiKey === 'COLE_SUA_CHAVE_MUREKA_API_AQUI') {
      this.isConfigured.set(false);
    }

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
        return 'Falha de rede ao contatar a API da Mureka. Verifique sua conexão com a internet.';
      }
      
      const apiError = error.error;
      if (error.status === 401) {
        return 'Erro de Autenticação (401): Sua chave da API Mureka é inválida. Verifique o arquivo `src/config.ts`.';
      }

      if (apiError?.detail) return `Erro da API Mureka (${error.status}): ${apiError.detail}`;
      if (apiError?.message) return `Erro da API Mureka (${error.status}): ${apiError.message}`;
      
      return `Erro na requisição à Mureka: ${error.status} - ${error.statusText}`;
    }

    if (error?.message) return `Erro de comunicação: ${error.message}`;
    return defaultMessage;
  }

  async generateMusic(title: string, style: string, lyrics: string): Promise<void> {
    if (!this.isConfigured()) {
        const errorMsg = 'A API da Mureka não está configurada. Verifique sua chave de API em `src/config.ts`.';
        console.error(errorMsg);
        await this.supabase.addMusic({ title, style, lyrics, status: 'failed', error: errorMsg });
        return;
    }

    const user = this.supabase.currentUser();
    if (!user) {
      console.error("Usuário não autenticado. Impossível gerar música.");
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

      const headers = new HttpHeaders({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.murekaApiKey}`
      });

      const body = {
        title,
        tags: style,
        lyrics,
        model_version: 'v2'
      };

      const generateResponse = await firstValueFrom(
        this.http.post<MurekaGenerateResponse>(`${MUREKA_API_BASE_URL}/generate`, body, { headers })
      );

      const taskId = generateResponse.id;

      await this.supabase.updateMusic(finalMusicRecord.id, { mureka_id: taskId });
      
      this.pollForResult(finalMusicRecord.id, taskId);

    } catch (error) {
      console.error('Erro ao iniciar a geração da música:', error);
      const errorMessage = this.getApiErrorMessage(error, 'Ocorreu um erro desconhecido ao contatar a Mureka.');

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
          'Authorization': `Bearer ${this.murekaApiKey}`
        });

        const queryResponse = await firstValueFrom(
          this.http.get<MurekaQueryResponse>(`${MUREKA_API_BASE_URL}/query?id=${taskId}`, { headers })
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
}