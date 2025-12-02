import { createClient } from '@supabase/supabase-js';

// Configuration using provided credentials
const supabaseUrl = 'https://wjfahwwupnifgzgpyqid.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndqZmFod3d1cG5pZmd6Z3B5cWlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ2MTM0MTcsImV4cCI6MjA4MDE4OTQxN30.td11azD-JQEMxqedCEzc9oYH8Qw6NwrfIm1ctS3O5V0';

export const supabase = createClient(supabaseUrl, supabaseKey);

// Helpers to map between DB snake_case and App camelCase
export const mapPersonaFromDb = (row: any) => ({
  id: row.id,
  name: row.name,
  location: row.location,
  country: row.country,
  niche: row.niche || [],
  bio: row.bio,
  avatarUrl: row.avatar_url,
  refImages: row.ref_images || []
});

export const mapPersonaToDb = (persona: any) => ({
  id: persona.id,
  name: persona.name,
  location: persona.location,
  country: persona.country,
  niche: persona.niche || [],
  bio: persona.bio,
  avatar_url: persona.avatarUrl || null,
  ref_images: persona.refImages || []
});

/**
 * Uploads a file to the 'personas' bucket and returns the public URL.
 */
export const uploadImage = async (file: Blob, path: string): Promise<string> => {
  const { data, error } = await supabase.storage
    .from('personas')
    .upload(path, file, {
      cacheControl: '3600',
      upsert: true
    });

  if (error) {
    throw error;
  }

  const { data: publicData } = supabase.storage
    .from('personas')
    .getPublicUrl(data.path);

  return publicData.publicUrl;
};
