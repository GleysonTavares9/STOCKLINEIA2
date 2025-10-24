import { Injectable, signal, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../config';

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
  private readonly apiKey: string | undefined;

  history = signal<HistoryItem[]>([]);

  constructor() {
    // Prioritize environment variable, but fall back to config file for demo purposes.
    this.apiKey = process.env.MUREKA_API_KEY || environment.murekaApiKey;

    if (!this.apiKey) {
      console.error('Chave da API da Mureka não encontrada. Configure MUREKA_API_KEY no ambiente ou em src/config.ts.');
    }
  }

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
      const error = 'O serviço Mureka não foi inicializado. Verifique se a chave da API (MUREKA_API_KEY) está configurada corretamente.';
      console.error('Mureka API key is not configured. This is required for music generation.');
      this.history.update(current => [{
        id: `local_error_${Date.now()}`,
        title,
        style,
        lyrics,
        status: 'failed',
        error,
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
        title: title,
        lyrics: lyrics,
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

  /**
   * Recursively searches through a data structure to find a plausible audio URL.
   * It collects all URLs, prioritizes them based on common audio-related keys and
   * file extensions, and returns the best candidate.
   * @param data The data structure (object, array, primitive) to search.
   * @returns The best candidate URL found, or null if none is found.
   */
  private findUrlInResponse(data: any): string | null {
    const urls: string[] = [];
    const visited = new WeakSet(); // Prevent infinite loops in circular structures

    const collectUrls = (current: any) => {
      if (!current || typeof current !== 'object') {
        if (typeof current === 'string' && current.startsWith('http')) {
          urls.push(current);
        }
        return;
      }
      
      if (visited.has(current)) {
        return;
      }
      visited.add(current);

      if (Array.isArray(current)) {
        for (const item of current) {
          collectUrls(item);
        }
      } else { // It's an object
        // Prioritize common keys by checking them first and adding their values to the front
        const prioritizedKeys = ['output', 'url', 'audio_url', 'uri', 'audio', 'link', 'public_url'];
        for (const key of prioritizedKeys) {
          const value = current[key];
          if (value && typeof value === 'string' && value.startsWith('http')) {
            urls.unshift(value); // Prepend to prioritize
          }
        }
        
        // Also check all other keys
        for (const key in current) {
          if (Object.prototype.hasOwnProperty.call(current, key)) {
            // Avoid re-processing prioritized keys we just checked
            if (!prioritizedKeys.includes(key)) {
                collectUrls(current[key]);
            }
          }
        }
      }
    };

    collectUrls(data);

    if (urls.length === 0) {
      return null;
    }

    // Create a unique set of URLs, preserving the prioritized order
    const uniqueUrls = [...new Set(urls)];

    // 1. Prefer URLs with common audio extensions.
    const audioExtensionRegex = /\.(mp3|wav|ogg|m4a|flac|aac)(\?.*)?$/i;
    const audioUrl = uniqueUrls.find(u => audioExtensionRegex.test(u));
    if (audioUrl) {
      return audioUrl;
    }

    // 2. If no audio extension, return the first URL found (which may have been prioritized by key).
    return uniqueUrls[0];
  }

  private pollForStatus(taskId: string, attempts = 0): void {
    const MAX_POLL_ATTEMPTS = 48; // Timeout after 48 * 5s = 4 minutes
    if (attempts >= MAX_POLL_ATTEMPTS) {
       this.history.update(current => 
        current.map(item => item.id === taskId ? { 
          ...item, 
          status: 'failed', 
          error: 'O processo demorou mais que o esperado e foi interrompido.' 
        } : item)
      );
      return;
    }
    
    setTimeout(async () => {
       if (!this.apiKey) {
             this.history.update(current => 
              current.map(item => item.id === taskId ? { 
                ...item, 
                status: 'failed', 
                error: 'A chave da API não pôde ser lida durante a verificação.' 
              } : item)
            );
            return;
          }

      try {
        const headers = new HttpHeaders({ 'Authorization': `Bearer ${this.apiKey}` });
        const res = await firstValueFrom(
          this.http.get<MurekaQueryResponse>(`${this.MUREKA_API_BASE_URL}/song/query/${taskId}`, { headers })
        );

        // 1. Aggressively search for the audio URL on every poll response.
        const audioUrl = this.findUrlInResponse(res);

        if (audioUrl) {
          // URL FOUND! This is our primary success condition. Stop polling.
          this.history.update(current => 
            current.map(item => item.id === taskId ? { 
              ...item, 
              status: 'succeeded', 
              audioUrl: audioUrl
            } : item)
          );
          return; // IMPORTANT: Stop polling
        }

        // 2. If no URL was found, proceed with status-based logic.
        const murekaStatus = res.status;
        
        if (murekaStatus === 'succeeded') {
          // The API says it succeeded, but we couldn't find a URL.
          // This is a failure from our app's perspective. Stop polling and show an error.
          console.error(`Mureka task ${taskId} succeeded, but no audio URL was found in the final payload.`, res);
          this.history.update(current => 
            current.map(item => item.id === taskId ? { 
              ...item, 
              status: 'failed', 
              error: 'A música foi gerada, mas não foi possível encontrar o link do áudio na resposta da API.' 
            } : item)
          );
        } else if (['failed', 'timeouted', 'cancelled'].includes(murekaStatus)) {
           // The API explicitly reports a failure.
           this.history.update(current => 
            current.map(item => item.id === taskId ? { 
              ...item, 
              status: 'failed', 
              error: res.failed_reason || 'A geração da música falhou por um motivo desconhecido.' 
            } : item)
          );
        } else { // 'preparing', 'queued', 'running', 'streaming'
          // No URL yet and still processing. Continue polling.
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