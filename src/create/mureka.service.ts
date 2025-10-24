import { Injectable, signal, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface HistoryItem {
  id: string; // Mureka Task ID
  title: string;
  style: string;
  lyrics: string;
  status: 'processing' | 'succeeded' | 'failed';
  audioUrl?: string;
  error?: string;
  createdAt: Date;
}

interface MurekaGenerateResponse {
  id: string;
  //... other properties
}

interface MurekaQueryResponse {
  status: 'preparing' | 'queued' | 'running' | 'streaming' | 'succeeded' | 'failed' | 'timeouted' | 'cancelled';
  failed_reason?: string;
  choices?: any[]; // Loosen type as the exact shape is unknown from docs
}


@Injectable({
  providedIn: 'root',
})
export class MurekaService {
  private readonly http = inject(HttpClient);
  private readonly MUREKA_API_BASE_URL = 'https://api.mureka.ai/v1';
  private readonly apiKey = 'op_mfsjty5x8ki4FpjGBDz36a9QFsXhtB7';

  history = signal<HistoryItem[]>([]);

  constructor() {}

  /**
   * Extracts a specific error message from an API error response.
   * @param error The error object, likely an HttpErrorResponse.
   * @param defaultMessage A fallback message if no specific error is found.
   * @returns A user-friendly error string.
   */
  private getApiErrorMessage(error: any, defaultMessage: string): string {
    if (error?.error?.detail) {
      return `Erro da API: ${error.error.detail}`;
    }
    if (error?.error?.message) {
      return `Erro da API: ${error.error.message}`;
    }
    if (typeof error?.error === 'string' && error.error.length > 0) {
      return `Erro da API: ${error.error}`;
    }
    // For network errors or other non-API specific issues, show a simpler message.
    if (error?.message) {
      return `Erro de comunicação: ${error.message}`;
    }
    return defaultMessage;
  }

  async generateMusic(title: string, style: string, lyrics: string): Promise<void> {
    if (!this.apiKey) {
      const error = 'API key is not configured. This is required for both Gemini and Mureka services.';
      console.error(error);
      this.history.update(current => [{
        id: `local_error_${Date.now()}`,
        title,
        style,
        lyrics,
        status: 'failed',
        error: 'A chave da API não foi encontrada. Verifique a configuração do ambiente.',
        createdAt: new Date(),
      }, ...current]);
      return;
    }
    
    const clientSideId = `client_${Date.now()}`;
    const newItem: HistoryItem = {
      id: clientSideId,
      title,
      style,
      lyrics,
      status: 'processing',
      createdAt: new Date(),
    };
    this.history.update(current => [newItem, ...current]);

    try {
      const headers = new HttpHeaders({
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      });
      
      const body = {
        lyrics: lyrics,
        model: 'auto',
        prompt: style
      };

      const response = await firstValueFrom(
        this.http.post<MurekaGenerateResponse>(`${this.MUREKA_API_BASE_URL}/song/generate`, body, { headers })
      );

      const taskId = response.id;
      
      this.history.update(current => 
        current.map(item => item.id === clientSideId ? { ...item, id: taskId } : item)
      );
      
      this.pollForStatus(taskId);

    } catch (error) {
      console.error('Failed to start music generation:', error);
      const errorMessage = this.getApiErrorMessage(error, 'Falha ao iniciar a geração da música na API Mureka.');
      this.history.update(current => 
        current.map(item => item.id === clientSideId ? { 
          ...item, 
          status: 'failed', 
          error: errorMessage
        } : item)
      );
    }
  }

  private pollForStatus(taskId: string, attempts = 0): void {
    const MAX_POLL_ATTEMPTS = 36; // Timeout after 36 * 5s = 3 minutes
    if (attempts >= MAX_POLL_ATTEMPTS) {
       this.history.update(current => 
        current.map(item => item.id === taskId ? { 
          ...item, 
          status: 'failed', 
          error: 'O tempo para gerar a música esgotou.' 
        } : item)
      );
      return;
    }
    
    setTimeout(async () => {
      try {
        const headers = new HttpHeaders({ 'Authorization': `Bearer ${this.apiKey}` });
        const res = await firstValueFrom(
          this.http.get<MurekaQueryResponse>(`${this.MUREKA_API_BASE_URL}/song/query/${taskId}`, { headers })
        );

        const murekaStatus = res.status;
        
        if (murekaStatus === 'succeeded') {
          const audioUrl = res.choices?.[0]?.url;

          if (audioUrl && typeof audioUrl === 'string') {
            this.history.update(current => 
              current.map(item => item.id === taskId ? { 
                ...item, 
                status: 'succeeded', 
                audioUrl: audioUrl
              } : item)
            );
          } else {
            console.error('Mureka task succeeded, but a valid audio URL was not found in the response choices.', res);
            this.history.update(current => 
              current.map(item => item.id === taskId ? { 
                ...item, 
                status: 'failed', 
                error: 'A música foi gerada com sucesso, mas o formato da resposta da API era inesperado.' 
              } : item)
            );
          }
        } else if (['failed', 'timeouted', 'cancelled'].includes(murekaStatus)) {
           this.history.update(current => 
            current.map(item => item.id === taskId ? { 
              ...item, 
              status: 'failed', 
              error: res.failed_reason || 'A geração da música falhou por um motivo desconhecido.' 
            } : item)
          );
        } else { // 'preparing', 'queued', 'running', 'streaming'
          this.pollForStatus(taskId, attempts + 1);
        }

      } catch (error) {
        console.error(`Error polling for task ${taskId}:`, error);
        const errorMessage = this.getApiErrorMessage(error, 'Erro de comunicação ao verificar o status da música.');
        this.history.update(current => 
          current.map(item => item.id === taskId ? { 
            ...item, 
            status: 'failed', 
            error: errorMessage
          } : item)
        );
      }
    }, 5000); // Poll every 5 seconds
  }
}