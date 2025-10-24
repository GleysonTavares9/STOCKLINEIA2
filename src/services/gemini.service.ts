import { Injectable } from '@angular/core';
import { GoogleGenAI } from '@google/genai';
import { environment } from '../config';

@Injectable({
  providedIn: 'root',
})
export class GeminiService {
  private ai: GoogleGenAI | null = null;
  private readonly apiKey: string | undefined;

  constructor() {
    // Prioritize environment variable, but fall back to config file for demo purposes.
    this.apiKey = process.env.GOOGLE_AI_API_KEY || environment.googleApiKey;

    if (this.apiKey) {
      this.ai = new GoogleGenAI({ apiKey: this.apiKey });
    } else {
      console.error('Chave da API do Gemini não encontrada. Configure GOOGLE_AI_API_KEY no ambiente ou em src/config.ts.');
    }
  }

  async generateLyrics(prompt: string): Promise<string> {
    if (!this.ai) {
      throw new Error('O serviço Gemini não foi inicializado. Verifique se a chave da API (GOOGLE_AI_API_KEY) está configurada corretamente.');
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
