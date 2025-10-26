import { Injectable, signal } from '@angular/core';
import { environment } from '../auth/config';
import { GoogleGenAI } from '@google/genai';

@Injectable({
  providedIn: 'root',
})
export class GeminiService {
  private gemini: GoogleGenAI | null = null;
  readonly isConfigured = signal(true);

  constructor() {
    const apiKey = environment.geminiApiKey;
    if (!apiKey || apiKey === 'COLE_SUA_CHAVE_GEMINI_API_AQUI') {
      this.isConfigured.set(false);
      return;
    }
    this.gemini = new GoogleGenAI({apiKey});
  }
  
  private getApiErrorMessage(error: any): string {
    if (error?.message) {
      if (error.message.includes('API key not valid')) {
        return 'A chave da API do Gemini é inválida ou não foi configurada. Verifique o arquivo `src/config.ts`.';
      }
      return `Erro da API Gemini: ${error.message}`;
    }
    return 'Falha ao comunicar com a API do Gemini. Verifique sua chave de API e conexão com a internet.';
  }

  async generateLyrics(prompt: string): Promise<string> {
    if (!this.gemini || !this.isConfigured()) {
      throw new Error('O serviço Gemini não está configurado. Verifique sua chave de API em `src/config.ts`.');
    }

    try {
      const fullPrompt = `Gere uma letra de música completa baseada na seguinte ideia: "${prompt}". A letra deve ter uma estrutura clara, incluindo versos, refrão e talvez uma ponte. O tom deve ser consistente com a ideia apresentada.`;
      
      const response = await this.gemini.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: fullPrompt,
        config: {
            systemInstruction: 'Você é um talentoso compositor de músicas. Sua especialidade é criar letras poéticas, emocionantes e cativantes que contam uma história.',
            temperature: 0.7,
            topP: 0.95,
        }
      });
      
      const text = response.text;
      if (!text) {
        throw new Error('A resposta da API do Gemini está vazia.');
      }

      return text;
    } catch (error) {
      console.error('Erro ao gerar letras via Gemini API:', error);
      const errorMessage = this.getApiErrorMessage(error);
      throw new Error(errorMessage);
    }
  }
}