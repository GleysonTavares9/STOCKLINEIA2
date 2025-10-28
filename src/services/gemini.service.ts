import { Injectable, signal, inject, computed } from '@angular/core';
import { SupabaseService } from './supabase.service';

@Injectable({
  providedIn: 'root',
})
export class GeminiService {
  private readonly supabase = inject(SupabaseService);

  // Gemini is configured if Supabase is, since it's now a proxy.
  readonly isConfigured = computed(() => this.supabase.isConfigured());

  constructor() {
    // Gemini API key is now a secret in the Edge Function.
    // The service is "configured" if the Supabase client is ready.
  }
  
  private getApiErrorMessage(error: any): string {
    // Check for proxy-specific error message
    if (error?.message?.includes('GEMINI_API_KEY not configured on Supabase Edge Function')) {
        return 'Erro de configuração no servidor: a chave da API Gemini não foi configurada na Edge Function. Por favor, configure a variável de ambiente GEMINI_API_KEY no painel do Supabase para a função `gemini-proxy`.';
    }

    if (error?.error === 'Gemini API call failed') {
        const details = error.details?.error?.message || JSON.stringify(error.details);
        return `Erro da API Gemini (via proxy): ${details}`;
    }

    // Generic Supabase function error
    if (error?.message) {
      return `Erro ao chamar a função do Supabase (gemini-proxy): ${error.message}`;
    }
    return 'Falha ao comunicar com a API do Gemini via proxy. Verifique sua conexão com a internet e a implantação da Edge Function.';
  }

  async generateLyrics(prompt: string): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error('O serviço Gemini não está configurado porque o Supabase não está configurado. Verifique sua chave de API em `src/auth/config.ts`.');
    }

    try {
      const { data, error: proxyError } = await this.supabase.invokeFunction('bright-worker', {
        body: { prompt }
      });

      if (proxyError) {
        console.error('Erro ao chamar a função proxy do Gemini:', proxyError);
        throw proxyError;
      }
      
      if (data?.error) {
        console.error('Erro retornado pela API do Gemini via proxy:', data);
        throw data;
      }

      const text = data?.text;
      if (!text) {
        throw new Error('A resposta da API do Gemini via proxy está vazia ou malformada.');
      }

      return text.trim();
    } catch (error) {
      console.error('Erro ao gerar letras via Gemini proxy:', error);
      const errorMessage = this.getApiErrorMessage(error);
      throw new Error(errorMessage);
    }
  }
}