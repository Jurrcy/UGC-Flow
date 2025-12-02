import { GoogleGenAI, Type } from "@google/genai";
import { Persona, GeneratedIdea, RefinementRequirement, GeneratedImage, CaptionData } from "../types";

const getClient = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

// Helper to download an image from a URL (e.g., Supabase) and convert to base64
// This is necessary because the Gemini API `inlineData` expects base64 strings.
const urlToBase64 = async (url: string): Promise<string | null> => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        // Remove the "data:image/jpeg;base64," prefix
        resolve(base64String.split(',')[1]);
      };
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error("Failed to fetch image for AI generation:", url, e);
    return null;
  }
};

// ------------------------------------------------------------------
// PERSONA ENHANCEMENT
// ------------------------------------------------------------------

export const enhancePersonaProfile = async (
  currentProfile: Partial<Persona>
): Promise<Partial<Persona>> => {
  const ai = getClient();
  
  const prompt = `
    You are an expert Casting Director and Social Media Strategist.
    
    Task: Create or refine a realistic influencer persona profile based on the provided images and any existing text.
    
    INSTRUCTIONS:
    1. VISUAL ANALYSIS: Analyze the uploaded images (Avatar and Reference images) to determine visual style, ethnicity, age, vibe, and likely location.
    2. TEXT ANALYSIS (CRITICAL):
       - Read the "Current Inputs" below carefully.
       - If the user has typed ANYTHING (e.g., specific descriptors like "gay", "minimalist", "goth", "tech founder"), YOU MUST RESPECT THIS CONTEXT.
       - Use these existing keywords to shape the entire persona.
       - Example: If 'Bio' mentions "Gay lifestyle", ensure the generated Niche, Location, and Name align perfectly with that specific demographic and culture.
       - If inputs are empty, invent suitable details based solely on the images.
       
    3. GENERATION GOALS:
       - Name: Realistic, matching the ethnicity/vibe/identity.
       - Location: A specific City and Country. If one is provided, keep it or refine the formatting.
       - Niche: List 3-5 specific niches (e.g. 'Streetwear', 'Interior Design').
       - Bio: A compelling, short bio (max 2 sentences). Preserve the core meaning of any existing bio text, just make it punchier and more professional.

    Current Inputs:
    Name: ${currentProfile.name || "Unknown"}
    Location: ${currentProfile.location || "Unknown"}
    Niche: ${currentProfile.niche?.join(', ') || "Unknown"}
    Bio: ${currentProfile.bio || "Unknown"}
  `;

  const parts: any[] = [{ text: prompt }];

  // Add Avatar
  if (currentProfile.avatarUrl) {
    const b64 = await urlToBase64(currentProfile.avatarUrl);
    if (b64) parts.push({ inlineData: { mimeType: 'image/jpeg', data: b64 } });
  }

  // Add Reference Images
  if (currentProfile.refImages) {
    for (const imgUrl of currentProfile.refImages) {
      const b64 = await urlToBase64(imgUrl);
      if (b64) parts.push({ inlineData: { mimeType: 'image/jpeg', data: b64 } });
    }
  }

  const schema = {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING },
      location: { type: Type.STRING },
      country: { type: Type.STRING },
      niche: { type: Type.ARRAY, items: { type: Type.STRING } },
      bio: { type: Type.STRING },
    },
    required: ["name", "location", "country", "niche", "bio"],
  };

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: { parts },
    config: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      systemInstruction: "You are a creative AI assistant. Analyze visual cues to build personas.",
    },
  });

  try {
    return JSON.parse(response.text || "{}");
  } catch (e) {
    console.error("Failed to parse persona enhancement", e);
    return currentProfile;
  }
};

// ------------------------------------------------------------------
// IDEATION PHASE
// ------------------------------------------------------------------

export const generateManualVariants = async (
  persona: Persona,
  activity: string,
  feedback?: string
): Promise<GeneratedIdea[]> => {
  const ai = getClient();
  const prompt = `
    You are a creative director for an Instagram influencer.
    Persona: ${persona.name}
    Location: ${persona.location}, ${persona.country}
    Bio: ${persona.bio}
    
    Task: Generate 3 distinct Instagram post variants for the activity: "${activity}".
    
    CRITICAL CONSTRAINT: Every variant MUST be explicitly bound to a specific, real-world location, street, landmark, or venue within ${persona.location}, ${persona.country}.
    
    ${feedback ? `Refine based on this feedback: ${feedback}` : ''}
  `;

  const schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        description: { type: Type.STRING },
      },
      required: ["title", "description"],
    },
  };

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      systemInstruction: "You are an expert UGC strategist. Output valid JSON.",
    },
  });

  const raw = JSON.parse(response.text || "[]");
  return raw.map((r: any, i: number) => ({
    id: `${persona.id}-idea-${Date.now()}-${i}`,
    personaId: persona.id,
    title: r.title,
    description: r.description,
    selected: false,
  }));
};

export const generateAutoTrends = async (persona: Persona): Promise<GeneratedIdea[]> => {
  const ai = getClient();
  
  // Updated Prompt to enforce Google Search usage
  const prompt = `
    Task: Find REAL-TIME Instagram trends and generate post ideas.
    
    1. Use Google Search to find the latest trending topics, aesthetics, and viral challenges specifically for the niche: "${persona.niche.join(', ')}".
    2. Based on the search results, create 3 high-engagement post ideas for: ${persona.name}.
    3. Location context: ${persona.location}, ${persona.country}.
    
    OUTPUT FORMAT:
    You must return a valid JSON array. Do not include markdown formatting like \`\`\`json.
    Example: [{"title": "...", "description": "..."}]
    
    CRITICAL: Every idea must be tied to a real location in ${persona.location} found via search or known geography.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview', // Using 3-pro for complex reasoning + search
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }], // Enable Real-Time Search
      // Note: responseMimeType: 'application/json' is NOT supported with googleSearch
    },
  });

  // Manual JSON extraction because search tool output can be mixed
  let raw: any[] = [];
  try {
    const text = response.text || "";
    const jsonMatch = text.match(/\[[\s\S]*\]/); // Find the JSON array in the text
    if (jsonMatch) {
      raw = JSON.parse(jsonMatch[0]);
    } else {
      // Fallback if model returns just text
      console.warn("Could not parse JSON from trend response, using fallback.");
      raw = []; 
    }
  } catch (e) {
    console.error("Failed to parse trend JSON", e);
    raw = [];
  }

  return raw.map((r: any, i: number) => ({
    id: `${persona.id}-trend-${Date.now()}-${i}`,
    personaId: persona.id,
    title: r.title || "Trending Idea",
    description: r.description || "Description unavailable",
    selected: false,
  }));
};

// ------------------------------------------------------------------
// REFINEMENT PHASE
// ------------------------------------------------------------------

export const analyzeIdeaRequirements = async (
  idea: GeneratedIdea,
  persona: Persona
): Promise<RefinementRequirement[]> => {
  const ai = getClient();
  const prompt = `
    Analyze this Instagram post idea to determine what specific visual details are needed to generate a high-quality, accurate image.
    Idea: ${idea.title} - ${idea.description}
    Persona: ${persona.name} in ${persona.location}.
    
    Identify 2-3 missing details, specifically asking for reference images of locations mentioned or specific styling details.
    For each requirement, provide a helpful suggestion/default value that the AI would make up if the user doesn't provide it.
  `;

  const schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        question: { type: Type.STRING, description: "The specific question asking for an image or detail" },
        suggestion: { type: Type.STRING, description: "An AI-generated default answer" },
      },
      required: ["question", "suggestion"],
    },
  };

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  });

  const raw = JSON.parse(response.text || "[]");
  return raw.map((r: any, i: number) => ({
    id: `${idea.id}-req-${i}`,
    question: r.question,
    suggestion: r.suggestion,
    userResponse: "",
  }));
};

// ------------------------------------------------------------------
// GENERATION PHASE
// ------------------------------------------------------------------

export const generateUGCImages = async (
  persona: Persona,
  idea: GeneratedIdea,
  requirements: RefinementRequirement[],
  count: number,
  quality: '1K' | '2K' | '4K'
): Promise<GeneratedImage[]> => {
  const ai = getClient();
  
  // Construct a rich prompt based on all collected data
  let fullPrompt = `Photorealistic Instagram photo of ${persona.name}, a ${persona.bio}. 
  Location: ${persona.location}, ${persona.country}.
  Action: ${idea.description}.
  `;

  requirements.forEach(req => {
    fullPrompt += ` Detail: ${req.userResponse || req.suggestion}.`;
  });

  // Collect reference images
  const parts: any[] = [{ text: fullPrompt }];
  
  // Add persona reference images (Fetch from URL, convert to Base64)
  if (persona.refImages && persona.refImages.length > 0) {
    for (const imgUrl of persona.refImages) {
        if (imgUrl.startsWith('http')) {
             const base64 = await urlToBase64(imgUrl);
             if (base64) {
                 parts.push({ inlineData: { mimeType: 'image/jpeg', data: base64 } });
             }
        } else {
            // Backwards compatibility if user has base64 data still in DB
             parts.push({ inlineData: { mimeType: 'image/jpeg', data: imgUrl } });
        }
    }
  }

  // Add specific location/prop references from refinement (These are currently Base64 in state)
  requirements.forEach(req => {
    if (req.referenceImage) {
      parts.push({
        inlineData: { mimeType: 'image/jpeg', data: req.referenceImage }
      });
    }
  });

  const results: GeneratedImage[] = [];

  // Generate images one by one or in small batches
  for (let i = 0; i < count; i++) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-image-preview',
        contents: { parts },
        config: {
          imageConfig: {
              imageSize: quality,
              aspectRatio: "4:5", // Instagram Portrait
          }
        },
      });

      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          results.push({
            id: `${idea.id}-img-${Date.now()}-${i}`,
            ideaId: idea.id,
            imageUrl: `data:image/png;base64,${part.inlineData.data}`,
            prompt: fullPrompt,
          });
        }
      }
    } catch (e) {
      console.error("Image generation error", e);
    }
  }

  return results;
};

export const editImageWithChat = async (
  image: GeneratedImage,
  instruction: string,
  referenceImage?: string
): Promise<GeneratedImage> => {
  const ai = getClient();
  
  const base64Data = image.imageUrl.split(',')[1];
  if (!base64Data) throw new Error("Invalid image data");

  // To edit, we send the image + text prompt.
  const parts: any[] = [
    { inlineData: { mimeType: 'image/png', data: base64Data } },
    { text: `Edit this image. Instruction: ${instruction}` }
  ];

  if (referenceImage) {
     parts.push({ inlineData: { mimeType: 'image/png', data: referenceImage } });
  }

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-image-preview',
    contents: { parts },
    config: {
        imageConfig: {
            aspectRatio: "4:5",
        }
    }
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return {
        ...image,
        imageUrl: `data:image/png;base64,${part.inlineData.data}`,
      };
    }
  }
  
  throw new Error("No image returned from edit");
};

// ------------------------------------------------------------------
// CAPTION PHASE
// ------------------------------------------------------------------

export const generateCaptionStrategy = async (
  persona: Persona,
  idea: GeneratedIdea
): Promise<CaptionData> => {
  const ai = getClient();
  const prompt = `
    Step 3: Caption Writer. Write a scroll-stopping Instagram caption for a post about: ${idea.title} - ${idea.description}.
    Tone: Human, organic, matching persona: ${persona.name} (${persona.bio}).
    Strategy: Use curiosity, controversy, or inspiration.
    
    Step 4: Hashtag Booster. Create a mix of low, mid, and high-competition tags specifically for ${persona.niche.join(', ')} and location ${persona.location}.
  `;

  const schema = {
    type: Type.OBJECT,
    properties: {
      caption: { type: Type.STRING },
      hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
    required: ["caption", "hashtags"],
  };

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  });

  return JSON.parse(response.text || "{\"caption\":\"\", \"hashtags\":[]}");
};