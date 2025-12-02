import React from 'react';
import { Layers } from 'lucide-react';

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="min-h-screen bg-[#FAFAFA] text-zinc-900 font-sans">
      <header className="sticky top-0 z-50 bg-[#FAFAFA]/80 backdrop-blur-xl border-b border-zinc-100">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center text-white shadow-lg shadow-zinc-900/10">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xl font-bold tracking-tight text-zinc-900 block leading-none">UGC Flow</span>
              <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-widest">Studio</span>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-6">
            <div className="text-xs font-medium px-3 py-1 rounded-full bg-zinc-100 text-zinc-500">
              Gemini 3 Pro Active
            </div>
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-zinc-200 to-zinc-100 border border-white shadow-sm"></div>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-12">
        {children}
      </main>
    </div>
  );
};