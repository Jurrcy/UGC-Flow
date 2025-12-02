export interface Persona {
  id: string;
  name: string;
  location: string;
  country: string;
  niche: string[];
  bio: string;
  avatarUrl: string;
  refImages: string[]; // base64 strings
}

export interface GeneratedIdea {
  id: string;
  personaId: string;
  title: string;
  description: string;
  selected: boolean;
}

export interface RefinementRequirement {
  id: string;
  question: string;
  suggestion: string;
  userResponse: string;
  referenceImage?: string; // base64
}

export interface GeneratedImage {
  id: string;
  ideaId: string;
  imageUrl: string; // base64 data uri
  prompt: string;
}

export interface CaptionData {
  caption: string;
  hashtags: string[];
}

export interface WorkflowState {
  step: 'dashboard' | 'selection' | 'ideation' | 'refinement' | 'generation' | 'editing' | 'captions' | 'complete';
  selectedPersonaIds: string[];
  mode: 'manual' | 'auto' | null;
  manualActivityInput: string;
  generatedIdeas: Record<string, GeneratedIdea[]>; // personaId -> ideas
  selectedIdeaIds: Record<string, string>; // personaId -> ideaId
  refinementData: Record<string, RefinementRequirement[]>; // ideaId -> requirements
  generatedImages: Record<string, GeneratedImage[]>; // ideaId -> images
  captions: Record<string, CaptionData>; // imageId -> caption data
}
