import React, { useState, useRef, useEffect } from 'react';
import { Layout } from './components/Layout';
import { Persona, WorkflowState, GeneratedIdea, RefinementRequirement, GeneratedImage, CaptionData } from './types';
import * as GeminiService from './services/geminiService';
import { supabase, mapPersonaFromDb, mapPersonaToDb, uploadImage } from './lib/supabase';
import { 
  Camera, MapPin, Loader2, Sparkles, CheckCircle, Edit3, 
  Image as ImageIcon, Send, ArrowRight, RefreshCw, Layers,
  ChevronRight, Instagram, Download, Hash, Plus, Trash2, X, Save, Upload, MoreVertical, Wand2, Database
} from 'lucide-react';

// --- MOCK DATA FOR SEEDING (Optional) ---
const SEED_PERSONAS: Persona[] = [
  {
    id: 'p1',
    name: 'Jakob',
    location: 'Zagreb',
    country: 'Croatia',
    niche: ['Fitness', 'Lifestyle'],
    bio: 'Energetic urban runner, loves coffee and sunrises.',
    avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&h=400&fit=crop',
    refImages: [] 
  },
  {
    id: 'p2',
    name: 'Sofia',
    location: 'Dubrovnik',
    country: 'Croatia',
    niche: ['Travel', 'Fashion'],
    bio: 'Elegant explorer, loves old architecture and sea views.',
    avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=400&fit=crop',
    refImages: [] 
  }
];

// Helper to compress images and return a Blob for uploading
const compressImageToBlob = (file: File): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1200; // Increased slightly as we are using storage buckets now
        const scaleSize = MAX_WIDTH / img.width;
        
        const finalScale = scaleSize < 1 ? scaleSize : 1;
        
        canvas.width = img.width * finalScale;
        canvas.height = img.height * finalScale;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            reject(new Error("Canvas context failed"));
            return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        // Export as Blob (JPEG 0.8)
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Blob creation failed"));
        }, 'image/jpeg', 0.85);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

// Helper for UI previews (Keep for refinement usage if needed, or simple local previews)
const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
    });
};

const App: React.FC = () => {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dbConnected, setDbConnected] = useState(true);
  const [uploading, setUploading] = useState(false);
  
  // Specific loading state for persona enhancement
  const [enhancing, setEnhancing] = useState(false);

  // Workflow State
  const [state, setState] = useState<WorkflowState>({
    step: 'dashboard',
    selectedPersonaIds: [],
    mode: null,
    manualActivityInput: '',
    generatedIdeas: {},
    selectedIdeaIds: {},
    refinementData: {},
    generatedImages: {},
    captions: {}
  });

  // Config for generation
  const [genCount, setGenCount] = useState(2);
  const [genQuality, setGenQuality] = useState<'1K' | '2K' | '4K'>('2K');
  const [editInputs, setEditInputs] = useState<Record<string, string>>({});

  // Persona Management State
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingPersona, setEditingPersona] = useState<Persona | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const refInputRef = useRef<HTMLInputElement>(null);

  // --- INITIAL LOAD ---
  useEffect(() => {
    fetchPersonas();
  }, []);

  const fetchPersonas = async () => {
    try {
      const { data, error } = await supabase
        .from('personas')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (data && data.length > 0) {
        setPersonas(data.map(mapPersonaFromDb));
      } else {
        setPersonas([]); 
      }
      setDbConnected(true);
    } catch (err) {
      console.error("Supabase connection error:", err);
      setPersonas(SEED_PERSONAS);
      setDbConnected(false);
    }
  };

  // --- PERSONA MANAGEMENT HANDLERS ---

  const handleCreatePersona = () => {
    setEditingPersona({
      id: '',
      name: '',
      location: '',
      country: '',
      niche: [],
      bio: '',
      avatarUrl: '',
      refImages: []
    });
    setIsEditorOpen(true);
  };

  const handleEditPersona = (e: React.MouseEvent, persona: Persona) => {
    e.preventDefault();
    e.stopPropagation();
    setEditingPersona({ ...persona });
    setIsEditorOpen(true);
  };

  const handleDeletePersona = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (window.confirm('Are you sure you want to delete this persona?')) {
      // Optimistic update
      setPersonas(prev => prev.filter(p => p.id !== id));
      setState(s => ({
        ...s,
        selectedPersonaIds: s.selectedPersonaIds.filter(pid => pid !== id)
      }));

      if (dbConnected) {
        try {
          const { error } = await supabase.from('personas').delete().eq('id', id);
          if (error) {
             console.error("Supabase delete error", error);
             alert("Could not delete from database, but removed locally.");
          }
        } catch (err) {
           console.error("Delete exception", err);
        }
      }
    }
  };

  const handleEnhancePersona = async () => {
    if (!editingPersona) return;
    
    // Check if we have anything to work with
    const hasImage = editingPersona.avatarUrl || editingPersona.refImages.length > 0;
    
    if (!hasImage && !editingPersona.bio && !editingPersona.name) {
      alert("Please upload an image or enter some text for the AI to analyze.");
      return;
    }

    setEnhancing(true);
    try {
      const result = await GeminiService.enhancePersonaProfile(editingPersona);
      setEditingPersona(prev => prev ? ({ ...prev, ...result }) : null);
    } catch (e) {
      console.error("Enhancement failed", e);
      alert("Failed to enhance persona. Please try again.");
    } finally {
      setEnhancing(false);
    }
  };

  const handleSavePersona = async () => {
    if (!editingPersona || !editingPersona.name) return;

    const isNew = !editingPersona.id;
    const personaToSave = {
      ...editingPersona,
      id: editingPersona.id || `p-${Date.now()}` // Client-side ID generation
    };

    setPersonas(prev => {
      if (!isNew) {
        return prev.map(p => p.id === personaToSave.id ? personaToSave : p);
      } else {
        return [personaToSave, ...prev];
      }
    });

    setIsEditorOpen(false);
    setEditingPersona(null);

    if (dbConnected) {
      try {
        const payload = mapPersonaToDb(personaToSave);
        
        const { error } = await supabase
          .from('personas')
          .upsert(payload);
        
        if (error) {
          console.error("Supabase Error saving persona:", error);
          alert(`Failed to save to database: ${error.message}`);
        }
      } catch (e: any) {
        console.error("Exception saving persona:", e);
        alert(`Error saving: ${e.message || e}`);
      }
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && editingPersona) {
      try {
        setUploading(true);
        // Compress first
        const blob = await compressImageToBlob(file);
        
        // Upload to bucket
        const fileName = `avatar-${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;
        const publicUrl = await uploadImage(blob, fileName);

        setEditingPersona({ ...editingPersona, avatarUrl: publicUrl });
      } catch (err) {
        console.error("Image upload failed", err);
        alert("Failed to upload image.");
      } finally {
        setUploading(false);
      }
    }
  };

  const handleRefImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && editingPersona) {
      if (editingPersona.refImages.length >= 3) {
        alert("Maximum 3 reference images allowed.");
        return;
      }
      try {
        setUploading(true);
        const blob = await compressImageToBlob(file);
        
        const fileName = `ref-${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;
        const publicUrl = await uploadImage(blob, fileName);
        
        setEditingPersona({ 
          ...editingPersona, 
          refImages: [...editingPersona.refImages, publicUrl] 
        });
      } catch (err) {
        console.error("Image upload failed", err);
        alert("Failed to upload image.");
      } finally {
        setUploading(false);
      }
    }
  };

  const removeRefImage = (index: number) => {
    if (editingPersona) {
      const newRefs = [...editingPersona.refImages];
      newRefs.splice(index, 1);
      setEditingPersona({ ...editingPersona, refImages: newRefs });
    }
  };

  // --- WORKFLOW ACTIONS ---

  const handleStartCreating = () => {
    setState(s => ({ ...s, step: 'selection' }));
  };

  const togglePersonaSelection = (id: string) => {
    setState(s => {
      const selected = s.selectedPersonaIds.includes(id)
        ? s.selectedPersonaIds.filter(pid => pid !== id)
        : [...s.selectedPersonaIds, id];
      return { ...s, selectedPersonaIds: selected };
    });
  };

  const proceedToIdeation = () => {
    if (state.selectedPersonaIds.length === 0) return;
    setState(s => ({ ...s, step: 'ideation' }));
  };

  const generateIdeas = async (mode: 'manual' | 'auto') => {
    setLoading(true);
    setLoadingMsg(mode === 'manual' ? 'Concepting variants...' : 'Scanning trends...');
    setError(null);
    try {
      const ideasMap: Record<string, GeneratedIdea[]> = {};
      
      for (const pid of state.selectedPersonaIds) {
        const persona = personas.find(p => p.id === pid)!;
        if (mode === 'manual') {
          ideasMap[pid] = await GeminiService.generateManualVariants(persona, state.manualActivityInput);
        } else {
          ideasMap[pid] = await GeminiService.generateAutoTrends(persona);
        }
      }
      
      setState(s => ({ ...s, generatedIdeas: ideasMap, mode, step: 'ideation' }));
    } catch (err: any) {
      setError("Failed to generate ideas. Ensure API Key is set.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const regenerateIdea = async (pid: string) => {
    const persona = personas.find(p => p.id === pid)!;
    setLoading(true);
    try {
      let newIdeas: GeneratedIdea[] = [];
      if (state.mode === 'manual') {
        newIdeas = await GeminiService.generateManualVariants(persona, state.manualActivityInput, "Try different angles or locations.");
      } else {
        newIdeas = await GeminiService.generateAutoTrends(persona); 
      }
      setState(s => ({
        ...s,
        generatedIdeas: { ...s.generatedIdeas, [pid]: newIdeas }
      }));
    } finally {
      setLoading(false);
    }
  };

  const selectIdea = (personaId: string, ideaId: string) => {
    setState(s => ({
      ...s,
      selectedIdeaIds: { ...s.selectedIdeaIds, [personaId]: ideaId }
    }));
  };

  const proceedToRefinement = async () => {
    setLoading(true);
    setLoadingMsg("Analyzing scene requirements...");
    setError(null);
    
    try {
      const refinementMap: Record<string, RefinementRequirement[]> = {};
      
      for (const pid of state.selectedPersonaIds) {
        const ideaId = state.selectedIdeaIds[pid];
        if (!ideaId) continue;
        
        const ideas = state.generatedIdeas[pid];
        const selectedIdea = ideas.find(i => i.id === ideaId);
        const persona = personas.find(p => p.id === pid)!;

        if (selectedIdea) {
          refinementMap[selectedIdea.id] = await GeminiService.analyzeIdeaRequirements(selectedIdea, persona);
        }
      }

      setState(s => ({ ...s, refinementData: refinementMap, step: 'refinement' }));
    } catch (err) {
      setError("Analysis failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleRefinementInput = (ideaId: string, reqId: string, val: string) => {
    setState(s => ({
      ...s,
      refinementData: {
        ...s.refinementData,
        [ideaId]: s.refinementData[ideaId].map(r => r.id === reqId ? { ...r, userResponse: val } : r)
      }
    }));
  };

  const useSuggestion = (ideaId: string, reqId: string) => {
    const req = state.refinementData[ideaId].find(r => r.id === reqId);
    if(req) handleRefinementInput(ideaId, reqId, req.suggestion);
  };

  // For Refinement requirements, we will stick to Base64 in state for simplicity, 
  // as these are transient and not saved to DB.
  const handleRefinementImage = async (ideaId: string, reqId: string, file: File) => {
    try {
        const base64Full = await fileToBase64(file);
        const cleanBase64 = base64Full.split(',')[1];
        setState(s => ({
            ...s,
            refinementData: {
            ...s.refinementData,
            [ideaId]: s.refinementData[ideaId].map(r => r.id === reqId ? { ...r, referenceImage: cleanBase64 } : r)
            }
        }));
    } catch (e) {
        alert("Could not process reference image");
    }
  };

  const proceedToGeneration = async () => {
    setLoading(true);
    setLoadingMsg(`Generating high-fidelity visuals...`);
    setState(s => ({ ...s, step: 'generation' }));
    
    try {
      const imagesMap: Record<string, GeneratedImage[]> = {};
      
      for (const pid of state.selectedPersonaIds) {
        const ideaId = state.selectedIdeaIds[pid];
        if (!ideaId) continue;

        const ideas = state.generatedIdeas[pid];
        const selectedIdea = ideas.find(i => i.id === ideaId)!;
        const persona = personas.find(p => p.id === pid)!;
        const reqs = state.refinementData[ideaId] || [];

        imagesMap[ideaId] = await GeminiService.generateUGCImages(persona, selectedIdea, reqs, genCount, genQuality);
      }

      setState(s => ({ ...s, generatedImages: imagesMap, step: 'editing' }));
    } catch (err) {
      setError("Image Generation Failed.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleEditImage = async (ideaId: string, imageId: string) => {
    const input = editInputs[imageId];
    if (!input) return;

    setLoading(true);
    setLoadingMsg("Refining visual...");
    try {
      const images = state.generatedImages[ideaId];
      const imageToEdit = images.find(img => img.id === imageId)!;
      
      const newImage = await GeminiService.editImageWithChat(imageToEdit, input);
      
      setState(s => ({
        ...s,
        generatedImages: {
          ...s.generatedImages,
          [ideaId]: s.generatedImages[ideaId].map(img => img.id === imageId ? newImage : img)
        }
      }));
      setEditInputs(prev => ({ ...prev, [imageId]: '' }));
    } catch(err) {
      setError("Editing failed.");
    } finally {
      setLoading(false);
    }
  };

  const proceedToCaptions = async () => {
    setLoading(true);
    setLoadingMsg("Writing copy & strategy...");
    setState(s => ({ ...s, step: 'captions' }));

    try {
      const captionsMap: Record<string, CaptionData> = {};
      
      for (const pid of state.selectedPersonaIds) {
        const ideaId = state.selectedIdeaIds[pid];
        const ideas = state.generatedIdeas[pid];
        const selectedIdea = ideas.find(i => i.id === ideaId)!;
        const persona = personas.find(p => p.id === pid)!;
        
        captionsMap[ideaId] = await GeminiService.generateCaptionStrategy(persona, selectedIdea);
      }

      setState(s => ({ ...s, captions: captionsMap }));
    } catch(err) {
      setError("Caption generation failed.");
    } finally {
      setLoading(false);
    }
  };

  // --- RENDERERS ---

  const renderPersonaEditor = () => {
    if (!isEditorOpen || !editingPersona) return null;

    return (
      <div className="fixed inset-0 z-[100] bg-zinc-900/60 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl animate-in fade-in zoom-in-95 duration-200">
          <div className="p-8 border-b border-zinc-100 flex justify-between items-center sticky top-0 bg-white/95 backdrop-blur z-10">
            <div>
              <h3 className="text-2xl font-bold text-zinc-900">
                {editingPersona.id ? 'Edit Persona' : 'New Creator'}
              </h3>
              <p className="text-zinc-500 text-sm mt-1">Configure your digital twin details.</p>
            </div>
            <button onClick={() => setIsEditorOpen(false)} className="p-2 bg-zinc-100 rounded-full hover:bg-zinc-200 transition-colors">
              <X className="w-5 h-5 text-zinc-600" />
            </button>
          </div>
          
          <div className="p-8 space-y-8">
            {/* Avatar Upload */}
            <div className="flex flex-col items-center">
              <div 
                onClick={() => !uploading && fileInputRef.current?.click()}
                className={`w-32 h-32 rounded-full bg-zinc-50 border-2 border-dashed border-zinc-200 flex items-center justify-center cursor-pointer overflow-hidden hover:border-zinc-900 transition-all relative group shadow-inner ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
              >
                {uploading && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/50">
                    <Loader2 className="w-8 h-8 animate-spin text-zinc-900" />
                  </div>
                )}
                {editingPersona.avatarUrl ? (
                  <img src={editingPersona.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  <Upload className="w-8 h-8 text-zinc-400 group-hover:text-zinc-600" />
                )}
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                   <Edit3 className="w-8 h-8 text-white" />
                </div>
              </div>
              <input 
                ref={fileInputRef} 
                type="file" 
                className="hidden" 
                accept="image/*" 
                onChange={handleAvatarUpload}
              />
              <span className="text-sm font-medium text-zinc-500 mt-3">Upload Portrait</span>
            </div>

            {/* AI Enhancement Button */}
            <div className="flex justify-center">
              <button 
                onClick={handleEnhancePersona}
                disabled={enhancing || uploading}
                className="bg-purple-50 text-purple-700 px-6 py-2.5 rounded-full text-sm font-bold border border-purple-200 hover:bg-purple-100 hover:border-purple-300 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {enhancing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {enhancing ? 'Analyzing visuals...' : 'Auto-Fill with AI'}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Name</label>
                <input 
                  type="text" 
                  value={editingPersona.name}
                  onChange={(e) => setEditingPersona({...editingPersona, name: e.target.value})}
                  className="w-full bg-white text-zinc-900 border border-zinc-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-900 outline-none transition-all placeholder:text-zinc-300"
                  placeholder="e.g. Jakob"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Niches</label>
                <input 
                  type="text" 
                  value={editingPersona.niche.join(', ')}
                  onChange={(e) => setEditingPersona({...editingPersona, niche: e.target.value.split(',').map(s => s.trim())})}
                  className="w-full bg-white text-zinc-900 border border-zinc-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-900 outline-none transition-all placeholder:text-zinc-300"
                  placeholder="e.g. Fitness, Lifestyle"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">City</label>
                <input 
                  type="text" 
                  value={editingPersona.location}
                  onChange={(e) => setEditingPersona({...editingPersona, location: e.target.value})}
                  className="w-full bg-white text-zinc-900 border border-zinc-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-900 outline-none transition-all placeholder:text-zinc-300"
                  placeholder="e.g. Zagreb"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Country</label>
                <input 
                  type="text" 
                  value={editingPersona.country}
                  onChange={(e) => setEditingPersona({...editingPersona, country: e.target.value})}
                  className="w-full bg-white text-zinc-900 border border-zinc-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-900 outline-none transition-all placeholder:text-zinc-300"
                  placeholder="e.g. Croatia"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Bio & Personality</label>
              <textarea 
                value={editingPersona.bio}
                onChange={(e) => setEditingPersona({...editingPersona, bio: e.target.value})}
                className="w-full bg-white text-zinc-900 border border-zinc-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-900 outline-none transition-all placeholder:text-zinc-300 min-h-[100px]"
                rows={3}
                placeholder="Describe their vibe, style, and content focus..."
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3 flex justify-between items-center">
                 <span>Reference Images</span>
                 <span className="bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded text-[10px]">{editingPersona.refImages.length}/3</span>
              </label>
              <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
                 {editingPersona.refImages.map((imgUrl, idx) => (
                   <div key={idx} className="relative w-24 h-24 flex-shrink-0 group">
                     {/* imgUrl is now a URL, not base64 */}
                     <img src={imgUrl} className="w-full h-full object-cover rounded-xl border border-zinc-100 shadow-sm" />
                     <button 
                       onClick={() => removeRefImage(idx)}
                       className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                     >
                       <X className="w-3 h-3" />
                     </button>
                   </div>
                 ))}
                 {editingPersona.refImages.length < 3 && (
                   <div 
                     onClick={() => !uploading && refInputRef.current?.click()}
                     className={`w-24 h-24 rounded-xl border-2 border-dashed border-zinc-200 flex items-center justify-center cursor-pointer hover:border-zinc-900 hover:bg-zinc-50 transition-all text-zinc-400 hover:text-zinc-900 ${uploading ? 'opacity-50' : ''}`}
                   >
                     {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Plus className="w-8 h-8" />}
                   </div>
                 )}
                 <input 
                   ref={refInputRef}
                   type="file"
                   className="hidden"
                   accept="image/*"
                   onChange={handleRefImageUpload}
                 />
              </div>
            </div>
          </div>
          
          <div className="p-6 border-t border-zinc-100 flex justify-end gap-3 bg-zinc-50/50 rounded-b-3xl">
            <button 
              onClick={() => setIsEditorOpen(false)}
              className="px-6 py-3 rounded-full text-zinc-600 font-medium hover:bg-zinc-200/50 transition-colors"
            >
              Cancel
            </button>
            <button 
              onClick={handleSavePersona}
              disabled={uploading}
              className="px-6 py-3 rounded-full bg-zinc-900 text-white font-medium hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-900/10 flex items-center disabled:opacity-50"
            >
              <Save className="w-4 h-4 mr-2" />
              {uploading ? 'Uploading...' : 'Save Creator'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (state.step === 'dashboard') {
    return (
      <Layout>
        {renderPersonaEditor()}
        <div className="flex flex-col items-center py-16">
          <div className="text-center mb-16 space-y-4">
            <div className="flex items-center justify-center gap-2 text-sm text-zinc-400 font-medium uppercase tracking-wider mb-2">
              <Database className={`w-4 h-4 ${dbConnected ? 'text-green-500' : 'text-red-500'}`} />
              {dbConnected ? 'Supabase Connected' : 'Local Mode'}
            </div>
            <h1 className="text-5xl font-extrabold text-zinc-900 tracking-tight">
              Creator Studio
            </h1>
            <p className="text-xl text-zinc-500 max-w-2xl mx-auto font-light">
              Manage your AI personas and generate hyper-local UGC content.
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-20 w-full max-w-6xl">
            {/* Create New Card */}
            <div 
              onClick={handleCreatePersona}
              className="bg-zinc-50 border border-dashed border-zinc-300 rounded-3xl p-8 flex flex-col items-center justify-center min-h-[320px] cursor-pointer hover:border-zinc-900 hover:bg-white transition-all group relative overflow-hidden"
            >
               <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mb-6 shadow-sm group-hover:scale-110 transition-transform duration-300 border border-zinc-100">
                 <Plus className="w-8 h-8 text-zinc-900" />
               </div>
               <h3 className="font-bold text-xl text-zinc-900">Add Creator</h3>
               <p className="text-sm text-zinc-500 mt-2 font-medium">Create new persona</p>
            </div>

            {personas.map(p => (
              <div key={p.id} className="bg-white rounded-3xl shadow-[0_2px_20px_rgba(0,0,0,0.04)] border border-zinc-100 overflow-hidden hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)] transition-all duration-300 relative group flex flex-col min-h-[320px]">
                
                {/* ACTION BUTTONS: Positioned Absolutely with high z-index to guarantee clickability */}
                <div className="absolute top-6 right-6 flex flex-col gap-2 z-[60] invisible group-hover:visible transition-all duration-200 opacity-0 group-hover:opacity-100">
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEditPersona(e, p);
                    }}
                    className="p-2.5 bg-zinc-100 text-zinc-600 hover:bg-zinc-900 hover:text-white rounded-xl transition-colors shadow-sm cursor-pointer border border-transparent hover:border-zinc-900"
                    title="Edit"
                  >
                    <Edit3 className="w-4 h-4 pointer-events-none" />
                  </button>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeletePersona(e, p.id);
                    }}
                    className="p-2.5 bg-red-50 text-red-500 hover:bg-red-500 hover:text-white rounded-xl transition-colors shadow-sm cursor-pointer border border-red-100 hover:border-red-500"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4 pointer-events-none" />
                  </button>
                </div>

                <div className="p-8 flex flex-col flex-grow">
                  <div className="flex items-start justify-between mb-6">
                    <div className="relative">
                       <img src={p.avatarUrl || 'https://via.placeholder.com/150'} alt={p.name} className="w-24 h-24 rounded-2xl object-cover shadow-sm" />
                    </div>
                  </div>
                  
                  <h3 className="font-bold text-2xl text-zinc-900 mb-1">{p.name}</h3>
                  <div className="flex items-center text-sm font-medium text-zinc-400 mb-4">
                    <MapPin className="w-4 h-4 mr-1.5" /> {p.location}, {p.country}
                  </div>
                  
                  <p className="text-zinc-600 text-sm line-clamp-3 mb-6 leading-relaxed font-light">{p.bio}</p>
                  
                  <div className="mt-auto flex flex-wrap gap-2">
                    {p.niche.slice(0, 3).map((n, i) => (
                      <span key={i} className="text-[10px] uppercase tracking-wider font-bold text-zinc-900 bg-zinc-100 px-3 py-1.5 rounded-full border border-zinc-200">
                        {n}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {personas.length > 0 && (
            <button 
              onClick={handleStartCreating}
              className="group relative inline-flex items-center justify-center px-10 py-5 text-lg font-bold text-white transition-all duration-300 bg-zinc-900 rounded-full hover:bg-black hover:scale-105 shadow-xl shadow-zinc-900/20"
            >
              Start Creating
              <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
          )}
        </div>
      </Layout>
    );
  }

  if (state.step === 'selection') {
    return (
      <Layout>
        <div className="max-w-2xl mx-auto py-12">
          <div className="flex items-center gap-4 mb-8">
            <button 
              onClick={() => setState(s => ({...s, step: 'dashboard'}))}
              className="p-2 hover:bg-zinc-100 rounded-full transition-colors"
            >
              <ArrowRight className="w-5 h-5 rotate-180" />
            </button>
            <h2 className="text-3xl font-bold text-zinc-900">Who is this campaign for?</h2>
          </div>
          
          <div className="grid grid-cols-1 gap-4">
            {personas.map(p => (
              <div 
                key={p.id}
                onClick={() => togglePersonaSelection(p.id)}
                className={`p-5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between group ${
                  state.selectedPersonaIds.includes(p.id) 
                    ? 'border-zinc-900 bg-zinc-50 shadow-md ring-1 ring-zinc-900/5' 
                    : 'border-zinc-200 bg-white hover:border-zinc-400'
                }`}
              >
                <div className="flex items-center gap-5">
                  <img src={p.avatarUrl || 'https://via.placeholder.com/150'} className="w-14 h-14 rounded-full object-cover shadow-sm" />
                  <div>
                    <h3 className="font-bold text-lg text-zinc-900">{p.name}</h3>
                    <p className="text-sm text-zinc-500 font-medium">{p.niche.join(', ')}</p>
                  </div>
                </div>
                <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-colors ${
                  state.selectedPersonaIds.includes(p.id) ? 'bg-zinc-900 border-zinc-900 text-white' : 'border-zinc-200 text-transparent group-hover:border-zinc-400'
                }`}>
                   <CheckCircle className="w-5 h-5" />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-12 flex justify-end">
             <button 
                onClick={proceedToIdeation}
                disabled={state.selectedPersonaIds.length === 0}
                className="bg-zinc-900 text-white px-8 py-4 rounded-full font-bold shadow-lg hover:shadow-xl hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                Continue
              </button>
          </div>
        </div>
      </Layout>
    );
  }

  if (state.step === 'ideation') {
    return (
      <Layout>
        <div className="max-w-5xl mx-auto min-h-[80vh]">
          {loading && (
             <div className="fixed inset-0 bg-white/90 z-[100] flex flex-col items-center justify-center backdrop-blur-sm">
               <Loader2 className="w-10 h-10 animate-spin text-zinc-900 mb-4" />
               <p className="text-lg font-medium text-zinc-600 animate-pulse">{loadingMsg}</p>
             </div>
          )}

          {!state.mode && (
            <div className="flex flex-col items-center justify-center h-full py-20">
              <h2 className="text-4xl font-bold mb-12 text-center">How should we work?</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-4xl">
                <div 
                  onClick={() => { setState(s => ({ ...s, mode: 'manual' })); }}
                  className="bg-white p-10 rounded-[2rem] border border-zinc-200 hover:border-zinc-900 cursor-pointer transition-all shadow-sm hover:shadow-2xl hover:-translate-y-1 text-center group"
                >
                  <div className="w-16 h-16 bg-zinc-50 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:bg-zinc-900 group-hover:text-white transition-colors">
                    <Edit3 className="w-8 h-8" />
                  </div>
                  <h3 className="text-2xl font-bold mb-3 text-zinc-900">I have an idea</h3>
                  <p className="text-zinc-500 leading-relaxed font-light">Input a specific activity, and Gemini will generate location-specific variants.</p>
                </div>
                <div 
                  onClick={() => generateIdeas('auto')}
                  className="bg-white p-10 rounded-[2rem] border border-zinc-200 hover:border-zinc-900 cursor-pointer transition-all shadow-sm hover:shadow-2xl hover:-translate-y-1 text-center group"
                >
                  <div className="w-16 h-16 bg-zinc-50 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:bg-zinc-900 group-hover:text-white transition-colors">
                    <Sparkles className="w-8 h-8" />
                  </div>
                  <h3 className="text-2xl font-bold mb-3 text-zinc-900">Surprise me</h3>
                  <p className="text-zinc-500 leading-relaxed font-light">AI scans niche trends to generate viral, high-engagement concepts automatically.</p>
                </div>
              </div>
            </div>
          )}

          {state.mode === 'manual' && Object.keys(state.generatedIdeas).length === 0 && (
             <div className="max-w-xl mx-auto py-24 animate-in fade-in slide-in-from-bottom-8 duration-500">
                <button 
                  onClick={() => setState(s => ({...s, mode: null}))}
                  className="mb-8 text-zinc-400 hover:text-zinc-900 flex items-center text-sm font-medium transition-colors"
                >
                  <ArrowRight className="w-4 h-4 mr-1 rotate-180" /> Back
                </button>
                <h3 className="text-3xl font-bold mb-4 text-zinc-900">What's the brief?</h3>
                <p className="text-zinc-500 mb-8 font-light text-lg">Describe the activity. We'll adapt it to each creator's location.</p>
                <textarea 
                  className="w-full bg-white text-zinc-900 border border-zinc-200 rounded-2xl p-6 focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-900 outline-none transition-all placeholder:text-zinc-300 shadow-sm text-lg resize-none"
                  placeholder="e.g. Drinking coffee at a busy market on a sunny morning..."
                  rows={4}
                  value={state.manualActivityInput}
                  onChange={(e) => setState(s => ({ ...s, manualActivityInput: e.target.value }))}
                  autoFocus
                />
                <button 
                  onClick={() => generateIdeas('manual')}
                  className="w-full mt-8 bg-zinc-900 text-white py-4 rounded-full font-bold text-lg hover:bg-black shadow-lg shadow-zinc-900/20 transition-all hover:scale-[1.02]"
                >
                  Generate Variants
                </button>
             </div>
          )}

          {Object.keys(state.generatedIdeas).length > 0 && (
            <div className="space-y-16 pb-32">
               {state.selectedPersonaIds.map(pid => {
                 const p = personas.find(x => x.id === pid)!;
                 const ideas = state.generatedIdeas[pid] || [];
                 const selectedId = state.selectedIdeaIds[pid];

                 return (
                   <div key={pid} className="space-y-6">
                     <div className="flex items-center justify-between">
                       <h3 className="text-2xl font-bold flex items-center text-zinc-900">
                         <img src={p.avatarUrl || 'https://via.placeholder.com/50'} className="w-12 h-12 rounded-full mr-4 object-cover border border-zinc-100 shadow-sm" />
                         {p.name}
                       </h3>
                       <button onClick={() => regenerateIdea(pid)} className="text-xs font-bold text-zinc-500 hover:text-zinc-900 flex items-center uppercase tracking-wider bg-white border border-zinc-200 px-4 py-2 rounded-full hover:bg-zinc-50 transition-colors">
                         <RefreshCw className="w-3 h-3 mr-2" /> Regenerate
                       </button>
                     </div>
                     <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                       {ideas.map(idea => (
                         <div 
                           key={idea.id}
                           onClick={() => selectIdea(pid, idea.id)}
                           className={`p-8 rounded-3xl border cursor-pointer transition-all relative flex flex-col group ${
                             selectedId === idea.id 
                              ? 'border-zinc-900 bg-zinc-900 text-white shadow-xl scale-[1.02]' 
                              : 'border-zinc-200 bg-white text-zinc-900 hover:border-zinc-400 hover:shadow-lg'
                           }`}
                         >
                            <h4 className="font-bold mb-4 text-xl">{idea.title}</h4>
                            <p className={`text-sm leading-relaxed flex-grow font-light ${selectedId === idea.id ? 'text-zinc-300' : 'text-zinc-500'}`}>{idea.description}</p>
                            <div className={`mt-6 w-full h-1 rounded-full ${selectedId === idea.id ? 'bg-white/20' : 'bg-zinc-100 group-hover:bg-zinc-200'}`} />
                         </div>
                       ))}
                     </div>
                   </div>
                 );
               })}
               
               <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40">
                  <button 
                    onClick={proceedToRefinement}
                    className="bg-zinc-900 text-white px-10 py-4 rounded-full font-bold shadow-2xl hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed flex items-center transition-all hover:scale-105 active:scale-95"
                    disabled={Object.keys(state.selectedIdeaIds).length !== state.selectedPersonaIds.length}
                  >
                    Next Step <ArrowRight className="w-5 h-5 ml-2" />
                  </button>
               </div>
            </div>
          )}
        </div>
      </Layout>
    );
  }

  if (state.step === 'refinement') {
    return (
       <Layout>
          <div className="max-w-4xl mx-auto pb-32">
            <h2 className="text-3xl font-bold mb-2">Refine Details</h2>
            <p className="text-zinc-500 mb-10 font-light">The AI needs a few specifics to get the location right.</p>

            {loading && (
             <div className="fixed inset-0 bg-white/90 z-[100] flex flex-col items-center justify-center">
               <Loader2 className="w-10 h-10 animate-spin text-zinc-900 mb-4" />
               <p className="text-lg font-medium">{loadingMsg}</p>
             </div>
            )}
            
            <div className="space-y-12">
              {state.selectedPersonaIds.map(pid => {
                const ideaId = state.selectedIdeaIds[pid];
                const requirements = state.refinementData[ideaId] || [];
                const persona = personas.find(p => p.id === pid)!;

                return (
                  <div key={pid} className="bg-white p-8 rounded-[2rem] shadow-sm border border-zinc-200">
                    <div className="flex items-center mb-8 border-b border-zinc-100 pb-6">
                       <img src={persona.avatarUrl || 'https://via.placeholder.com/40'} className="w-12 h-12 rounded-full mr-4 object-cover border border-zinc-100" />
                       <div>
                         <h3 className="font-bold text-xl text-zinc-900">{persona.name}</h3>
                         <p className="text-zinc-500 text-sm">{state.generatedIdeas[pid].find(i => i.id === ideaId)?.title}</p>
                       </div>
                    </div>
                    
                    <div className="space-y-8">
                      {requirements.map(req => (
                        <div key={req.id} className="group">
                          <label className="block text-sm font-bold text-zinc-900 mb-3 ml-1">
                             {req.question}
                          </label>
                          <div className="flex gap-3 mb-3">
                            <input 
                              type="text" 
                              className="flex-1 bg-white border border-zinc-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-900 outline-none transition-all placeholder:text-zinc-300"
                              value={req.userResponse}
                              placeholder={req.suggestion}
                              onChange={(e) => handleRefinementInput(ideaId, req.id, e.target.value)}
                            />
                            <button 
                              onClick={() => useSuggestion(ideaId, req.id)}
                              className="text-xs font-bold uppercase tracking-wider bg-zinc-100 text-zinc-600 px-5 py-3 rounded-xl hover:bg-zinc-200 transition-colors whitespace-nowrap"
                            >
                              Auto-Fill
                            </button>
                          </div>
                          
                          <div className="flex items-center mt-3 ml-1">
                            <label className={`cursor-pointer flex items-center gap-2 text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-lg transition-colors border ${req.referenceImage ? 'bg-green-50 text-green-700 border-green-200' : 'bg-white text-zinc-500 border-zinc-200 hover:border-zinc-900 hover:text-zinc-900'}`}>
                              <ImageIcon className="w-4 h-4" />
                              {req.referenceImage ? 'Image Attached' : 'Attach Reference'}
                              <input 
                                type="file" 
                                className="hidden" 
                                accept="image/*"
                                onChange={(e) => e.target.files?.[0] && handleRefinementImage(ideaId, req.id, e.target.files[0])}
                              />
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="mt-12 bg-zinc-900 text-white p-8 rounded-[2rem] shadow-xl flex flex-col md:flex-row items-center justify-between gap-6">
               <div>
                  <h4 className="font-bold text-xl mb-1">Production Settings</h4>
                  <p className="text-zinc-400 text-sm">Configure output quality and volume.</p>
               </div>
               <div className="flex gap-4">
                  <select 
                    value={genCount} 
                    onChange={(e) => setGenCount(Number(e.target.value))} 
                    className="bg-zinc-800 border border-zinc-700 text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-white/20 cursor-pointer"
                  >
                    {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} Image{n>1?'s':''}</option>)}
                  </select>
                  <select 
                    value={genQuality} 
                    onChange={(e) => setGenQuality(e.target.value as any)} 
                    className="bg-zinc-800 border border-zinc-700 text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-white/20 cursor-pointer"
                  >
                    <option value="1K">1K Res</option>
                    <option value="2K">2K Res</option>
                    <option value="4K">4K Res</option>
                  </select>
               </div>
               <button 
                  onClick={proceedToGeneration}
                  className="bg-white text-zinc-900 px-8 py-3 rounded-full font-bold hover:bg-zinc-200 transition-colors flex items-center shadow-lg"
               >
                 <Sparkles className="w-5 h-5 mr-2" /> Start Generation
               </button>
            </div>
          </div>
       </Layout>
    );
  }

  if (state.step === 'editing' || state.step === 'captions') {
    return (
      <Layout>
         <div className="max-w-7xl mx-auto pb-32">
            <header className="flex justify-between items-end mb-12">
               <div>
                 <h2 className="text-4xl font-bold mb-2 text-zinc-900">
                    {state.step === 'editing' ? 'Studio Editor' : 'Final Review'}
                 </h2>
                 <p className="text-zinc-500 text-lg font-light">
                   {state.step === 'editing' ? 'Refine visuals with AI commands.' : 'Ready to post content.'}
                 </p>
               </div>
               {state.step === 'editing' && (
                  <button 
                    onClick={proceedToCaptions}
                    className="bg-zinc-900 text-white px-8 py-4 rounded-full hover:bg-black font-bold shadow-xl transition-transform hover:scale-105 flex items-center"
                  >
                    Generate Captions <ArrowRight className="w-5 h-5 ml-2" />
                  </button>
                )}
            </header>

            {loading && (
             <div className="fixed inset-0 bg-white/90 z-[100] flex flex-col items-center justify-center backdrop-blur-sm">
               <Loader2 className="w-10 h-10 animate-spin text-zinc-900 mb-4" />
               <p className="text-lg font-medium text-zinc-600 animate-pulse">{loadingMsg}</p>
             </div>
            )}

            <div className="space-y-16">
               {state.selectedPersonaIds.map(pid => {
                 const ideaId = state.selectedIdeaIds[pid];
                 const images = state.generatedImages[ideaId] || [];
                 const captionData = state.captions[ideaId];
                 const persona = personas.find(p=>p.id===pid);
                 
                 return (
                   <div key={pid} className="bg-white rounded-[2.5rem] p-10 border border-zinc-200 shadow-sm">
                     <div className="flex items-center mb-8">
                        <img src={persona?.avatarUrl || 'https://via.placeholder.com/40'} className="w-14 h-14 rounded-full mr-5 object-cover border border-zinc-100 shadow-sm" />
                        <div>
                           <h3 className="text-2xl font-bold text-zinc-900">{persona?.name}</h3>
                           <p className="text-zinc-500 font-medium">Campaign Assets</p>
                        </div>
                     </div>
                     
                     <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
                        {images.map(img => (
                          <div key={img.id} className="flex flex-col gap-4 group">
                             <div className="aspect-[4/5] bg-zinc-100 rounded-2xl overflow-hidden relative shadow-md group-hover:shadow-xl transition-all duration-300">
                                <img src={img.imageUrl} className="w-full h-full object-cover" />
                                <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                   <a href={img.imageUrl} download={`ugc-${img.id}.png`} className="bg-white/90 backdrop-blur text-zinc-900 p-3 rounded-full shadow-lg hover:bg-white hover:scale-110 transition-all flex">
                                      <Download className="w-5 h-5" />
                                   </a>
                                </div>
                             </div>

                             {state.step === 'editing' ? (
                               <div className="relative">
                                 <input 
                                   type="text" 
                                   className="w-full bg-zinc-50 border border-zinc-200 rounded-full pl-5 pr-12 py-3 text-sm focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-900 outline-none transition-all placeholder:text-zinc-400"
                                   placeholder="Ask AI to edit this image..."
                                   value={editInputs[img.id] || ''}
                                   onChange={(e) => setEditInputs(prev => ({ ...prev, [img.id]: e.target.value }))}
                                 />
                                 <button 
                                   onClick={() => handleEditImage(ideaId, img.id)}
                                   disabled={!editInputs[img.id]}
                                   className="absolute right-1 top-1 bottom-1 w-10 bg-zinc-900 text-white rounded-full flex items-center justify-center hover:bg-black disabled:opacity-0 transition-all"
                                 >
                                   <Wand2 className="w-4 h-4" />
                                 </button>
                               </div>
                             ) : (
                               <div className="bg-zinc-50 p-6 rounded-2xl border border-zinc-100">
                                  <div className="flex items-start gap-4">
                                     <div className="bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-500 p-0.5 rounded-full flex-shrink-0">
                                        <div className="bg-white p-0.5 rounded-full">
                                          <img src={persona?.avatarUrl} className="w-8 h-8 rounded-full object-cover" />
                                        </div>
                                     </div>
                                     <div className="space-y-3">
                                        <p className="text-sm text-zinc-800 leading-relaxed font-medium">
                                          {captionData?.caption || "Generating caption..."}
                                        </p>
                                        <div className="flex flex-wrap gap-2">
                                          {captionData?.hashtags.map(tag => (
                                            <span key={tag} className="text-[11px] font-bold text-zinc-500">#{tag}</span>
                                          ))}
                                        </div>
                                     </div>
                                  </div>
                               </div>
                             )}
                          </div>
                        ))}
                     </div>
                   </div>
                 )
               })}
            </div>
         </div>
      </Layout>
    );
  }

  return <div>Unknown State</div>;
};

export default App;