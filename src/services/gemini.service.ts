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
  
  private async getApiErrorMessage(error: any): Promise<string> {
    console.groupCollapsed('🚨 GeminiService: getApiErrorMessage - Debugging');
    console.log('Raw error object received:', error);

    // Check for Supabase client initialization error
    if (error?.message?.includes('Supabase client not initialized')) {
        console.log('Error Type: Supabase client not initialized.');
        console.groupEnd();
        return 'O Supabase não está configurado. Verifique as credenciais no `src/auth/config.ts`.';
    }

    // Attempt to extract detailed error from Supabase Edge Function's context or direct body
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
    } else if (error?.error || (error?.message && error.message.includes('Gemini API call failed'))) {
        // This case covers when the `throw { error: data.error, ... }` happens
        // from the `generateLyrics` method itself.
        bodyToParse = error;
        console.log('Error object itself is structured (e.g., from `throw data`):', bodyToParse);
    }


    let parsedEdgeFunctionDetails: any = null;
    if (typeof bodyToParse === 'string') {
        try {
            parsedEdgeFunctionDetails = JSON.parse(bodyToParse);
            console.log('Successfully JSON.parsed bodyToParse:', parsedEdgeFunctionDetails);
        } catch (parseError) {
            console.warn('Failed to JSON.parse bodyToParse. It might be plain text or malformed JSON.', bodyToParse, parseError);
            // If it's not JSON, we might still want to use it as a plain text error message later
            parsedEdgeFunctionDetails = { message: bodyToParse };
        }
    } else if (typeof bodyToParse === 'object' && bodyToParse !== null) {
        // If it's already an object, use it directly
        parsedEdgeFunctionDetails = bodyToParse;
        console.log('bodyToParse was already an object:', parsedEdgeFunctionDetails);
    }

    if (parsedEdgeFunctionDetails) {
        // Specific error for missing GEMINI_API_KEY from proxy
        if (parsedEdgeFunctionDetails.error?.includes('GEMINI_API_KEY not configured on Supabase Edge Function')) {
            console.log('Error Type: GEMINI_API_KEY not configured.');
            console.groupEnd();
            return 'Erro de configuração no servidor: a chave da API Gemini não foi configurada na Edge Function. Por favor, configure a variável de ambiente GEMINI_API_KEY no painel do Supabase para a função `bright-worker`.';
        }

        // Specific error for Gemini API call failed (propagated from proxy)
        if (parsedEdgeFunctionDetails.error === 'Gemini API call failed') {
            const details = parsedEdgeFunctionDetails.details?.error?.message || parsedEdgeFunctionDetails.details?.message || JSON.stringify(parsedEdgeFunctionDetails.details || 'Detalhes desconhecidos da API Gemini.');
            console.log('Error Type: Gemini API call failed (from proxy).');
            console.groupEnd();
            return `Erro da API Gemini (via proxy - Status: ${parsedEdgeFunctionDetails.status || 'desconhecido'}): ${details}`;
        }
        
        // Generic error returned by the Edge Function (has an 'error' field)
        if (parsedEdgeFunctionDetails.error) {
            console.log('Error Type: Generic Edge Function error (with "error" field).');
            console.groupEnd();
            return `Erro da função do Supabase (bright-worker): ${parsedEdgeFunctionDetails.error}`;
        }
        // If there's a 'message' field but no specific 'error' field
        if (parsedEdgeFunctionDetails.message && typeof parsedEdgeFunctionDetails.message === 'string') {
            console.log('Error Type: Generic Edge Function error (with "message" field).');
            console.groupEnd();
            return `Erro da função do Supabase (bright-worker): ${parsedEdgeFunctionDetails.message}`;
        }
    }

    // Fallback for `invokeFunction` errors that might not have a structured body,
    // or if parsing failed, or if it was a generic network/runtime error.
    if (error?.message) {
      if (error.message.includes('Edge Function returned a non-2xx status code')) {
        console.log('Error Type: Raw Edge Function non-2xx message (fallback).');
        console.groupEnd();
        // If we reached here, parsing the `body` might have failed or the body was uninformative.
        // Include raw body or message for more info.
        return `Erro de execução na função do Supabase. Verifique os logs da função 'bright-worker' no Supabase para mais detalhes. (Original: ${bodyToParse || error.message})`;
      }
      console.log('Error Type: Generic Supabase invokeFunction error message (fallback).');
      console.groupEnd();
      return `Erro ao chamar a função do Supabase (bright-worker): ${error.message}`;
    }
    
    console.log('Error Type: Unknown error (final fallback).');
    console.groupEnd();
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
        console.error('Erro ao chamar a função proxy do Gemini (proxyError):', proxyError);
        throw proxyError;
      }
      
      // The Edge Function can return { error: "...", details: "..." } even with a 200 status for some internal errors
      if (data?.error) {
        console.error('Erro retornado pela API do Gemini via proxy (data.error):', data);
        // Throw a structured error to be caught by getApiErrorMessage
        throw { error: data.error, details: data.details, status: data.status || 200 };
      }

      const text = data?.text;
      if (!text) {
        throw new Error('A resposta da API do Gemini via proxy está vazia ou malformada.');
      }

      return text.trim();
    } catch (error) {
      console.error('Erro ao gerar letras via Gemini proxy (catch block):', error);
      const errorMessage = await this.getApiErrorMessage(error);
      throw new Error(errorMessage);
    }
  }
}
