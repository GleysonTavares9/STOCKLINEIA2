import { Injectable } from '@angular/core';
import { GoogleGenAI } from '@google/genai';

@Injectable({
  providedIn: 'root',
})
export class GeminiService {
  private ai: GoogleGenAI | null = null;

  constructor() {
    // IMPORTANT: In a real app, process.env.API_KEY is handled by the build environment.
    // We assume it's available here as per the instructions.
    if (process.env.API_KEY) {
      this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    } else {
      console.error('API_KEY environment variable not found.');
    }
  }

  async generateLyrics(prompt: string): Promise<string> {
    if (!this.ai) {
      throw new Error('Gemini AI client not initialized. Check API Key.');
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
      throw new Error('Failed to generate lyrics from Gemini API.');
    }
  }
}
