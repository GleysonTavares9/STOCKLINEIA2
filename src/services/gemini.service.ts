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
      // Improved prompt to strictly request only the lyrics.
      const fullPrompt = `Gere uma letra de música baseada na seguinte ideia: "${prompt}".

REGRAS ESTRITAS DE FORMATAÇÃO DA RESPOSTA:
1.  **NÃO** inclua um título.
2.  **NÃO** inclua marcadores de seção como "[Verso 1]", "[Refrão]", etc.
3.  **NÃO** inclua introduções, explicações ou qualquer texto que não seja parte da letra da música.
4.  Responda APENAS com o texto bruto da letra.`;
      
      const response = await this.gemini.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: fullPrompt,
        config: {
            // Updated system instruction to be more forceful about formatting.
            systemInstruction: `Você é um compositor de músicas profissional. Sua tarefa é criar letras poéticas e bem estruturadas.
Você DEVE seguir TODAS as regras de formatação da resposta solicitadas pelo usuário, sem exceções. Sua resposta deve conter APENAS a letra da música.`,
            temperature: 0.7,
            topP: 0.95,
        }
      });
      
      const text = response.text;
      if (!text) {
        throw new Error('A resposta da API do Gemini está vazia.');
      }

      return text.trim(); // A simple trim should be sufficient with the improved prompt.
    } catch (error) {
      console.error('Erro ao gerar letras via Gemini API:', error);
      const errorMessage = this.getApiErrorMessage(error);
      throw new Error(errorMessage);
    }
  }
}