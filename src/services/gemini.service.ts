import { Injectable } from '@angular/core';
import { GoogleGenAI } from '@google/genai';

@Injectable({
  providedIn: 'root',
})
export class GeminiService {
  private ai: GoogleGenAI | null = null;
  private readonly apiKey: string | undefined;

  constructor() {
    // A chave de API deve ser obtida exclusivamente da variável de ambiente.
    this.apiKey = process.env.API_KEY;

    if (this.apiKey) {
      this.ai = new GoogleGenAI({ apiKey: this.apiKey });
    } else {
      console.error('Chave da API do Google não encontrada. Configure a variável de ambiente API_KEY.');
    }
  }

  async generateLyrics(prompt: string): Promise<string> {
    if (!this.ai) {
      throw new Error('O serviço Gemini não foi inicializado. Verifique se a chave da API (API_KEY) está configurada corretamente.');
    }

    const fullPrompt = `Gere uma letra de música completa baseada na seguinte ideia: "${prompt}". A letra deve ter uma estrutura clara, incluindo versos, refrão e talvez uma ponte. O tom deve ser consistente com a ideia apresentada.`;
    
    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: fullPrompt,
        config: {
          systemInstruction: 'Você é um talentoso compositor de músicas. Sua especialidade é criar letras poéticas, emocionantes e cativantes que contam uma história.',
          temperature: 0.7,
          topP: 0.95,
        }
      });
      
      return response.text;
    } catch (error) {
      console.error('Error calling Gemini API:', error);
      throw new Error('Falha ao comunicar com a API do Gemini. Verifique sua chave de API e a conectividade.');
    }
  }
}