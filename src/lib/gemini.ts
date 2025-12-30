
import { GoogleGenerativeAI } from "@google/generative-ai";

export const getGeminiModel = (apiKey: string, modelName: string = "gemini-1.5-pro", systemInstruction?: string) => {
    const genAI = new GoogleGenerativeAI(apiKey);
    return genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: systemInstruction
    });
};
