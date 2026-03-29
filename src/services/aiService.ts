import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export async function summarizeDescription(description: string): Promise<string> {
  if (!description || description.trim().length < 5) {
    return "A quiet soul observing the world from their chosen corner.";
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `You are a creative writer. Based on the following description, write a short, personal, and slightly introspective life snapshot. 
      It should be 2 sentences long. Feel like a brief but meaningful glimpse into their character.
      Be concrete and human. Avoid abstract or overly poetic phrases.
      
      Description: "${description}"`,
      config: {
        temperature: 0.7,
        topP: 0.8,
        topK: 40
      }
    });

    const text = response.text?.trim();
    if (!text) throw new Error("Empty AI response");
    
    return text;
  } catch (error) {
    console.error("Summarization failed:", error);
    // Return a slightly more varied fallback to avoid the "all same" feel
    return "A person navigating their own path through the world, seeking meaning in the small moments.";
  }
}

export async function generateLifeLogs(
  profile: any, 
  previousLogs: string[], 
  count: number,
  startDate: Date
): Promise<{ text: string, timestamp: string }[]> {
  if (count <= 0) return [];
  
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Generate ${count} daily life log entries for a person with this profile:
      Age: ${profile.age}, Gender: ${profile.gender}, Occupation: ${profile.occupation}, Personality: ${profile.description}.
      
      Previous logs for context:
      ${previousLogs.slice(-5).join('\n')}
      
      Requirements:
      - Each entry is exactly ONE short sentence.
      - Casual, human-sounding, slightly playful or personal.
      - Reflect everyday activities or small life moments.
      - Return as a JSON array of strings.
      - Do not include dates in the strings.
      
      Example: ["Ran a marathon today. So tired.", "Had coffee with a friend and talked about the future."]`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        }
      }
    });

    const texts: string[] = JSON.parse(response.text || "[]");
    
    return texts.slice(0, count).map((text, i) => {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i + 1);
      // Random time within that day
      date.setHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60));
      
      return {
        text,
        timestamp: date.toISOString()
      };
    });
  } catch (error) {
    console.error("Life log generation failed", error);
    return [];
  }
}

export async function generateCurrentState(profile: any): Promise<string> {
  // Calculate rough local time based on longitude (15 degrees = 1 hour)
  const utcDate = new Date();
  const offsetHours = (profile.lng || 0) / 15;
  const localDate = new Date(utcDate.getTime() + offsetHours * 60 * 60 * 1000);
  const hour = localDate.getUTCHours(); // Use UTC + offset logic
  
  // Determine time of day string
  let timeOfDay = "daytime";
  if (hour >= 5 && hour < 12) timeOfDay = "morning";
  else if (hour >= 12 && hour < 17) timeOfDay = "afternoon";
  else if (hour >= 17 && hour < 21) timeOfDay = "evening";
  else timeOfDay = "night";

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `You are a creative writer. Generate a short, literal status update (one sentence) for what this person is doing RIGHT NOW.
      
      Context:
      - Local Time: ${timeOfDay} (around ${hour}:00)
      - Location: Lat ${profile.lat}, Lng ${profile.lng}
      - Profile: Age ${profile.age}, Gender ${profile.gender}, Occupation ${profile.occupation}
      - Personality: ${profile.description}
      
      Requirements:
      - Be very literal and concrete (e.g., "Sipping a protein shake", "Watching a late-night talk show", "Fast asleep").
      - Match the activity to the local time (e.g., if it's 3 AM, they are likely sleeping or doing something very late-night).
      - Incorporate their personality/occupation (e.g., a gym-goer might be at the gym, an artist might be sketching).
      - Keep it under 15 words.
      
      Example: "This person is currently sipping on pre-workout before a late-night gym session."`,
      config: {
        temperature: 0.9,
        topP: 0.9,
        topK: 50
      }
    });
    return response.text?.trim() || "Just taking a moment to breathe.";
  } catch (error) {
    console.error("Current state generation failed", error);
    return "Just taking a moment to breathe.";
  }
}
