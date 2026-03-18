import React, { useState } from 'react';
import { RotateCcw, GitBranch, ShieldCheck, Terminal as TerminalIcon } from 'lucide-react';

export default function App() {
  const [isResurrecting, setIsResurrecting] = useState(false);
  const [showIdeology, setShowIdeology] = useState(false);
  const [logs, setLogs] = useState([ '[System] SecondCortex Node Active', '[Git] Branch: feature/billing-dashboard' ]);

  const resurrect = () => {
    setIsResurrecting(true);
    setTimeout(() => {
      setLogs(prev => [
        ...prev,
        '[Analysis] Deep context found for Billing Refactor',
        '[Ideology] Scaling for Q3 seat-based pricing detected',
        '[Security] Secret scrubbed: sk_test_51Mz...',
        '[Success] Developer State Restored'
      ]);
      setShowIdeology(true);
      setIsResurrecting(false);
    }, 1200);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 font-sans text-slate-200">
      <div className="text-center mb-10">
        <h1 className="text-4xl font-black text-white mb-2 tracking-tight">SecondCortex Labs</h1>
        <p className="text-slate-400 uppercase tracking-widest text-xs font-bold">Resurrect Context Simulator</p>
      </div>
      <div className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-slate-800/50 p-4 border-b border-slate-700 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <GitBranch size={16} className="text-indigo-400" />
            <span className="text-sm font-mono tracking-tighter">feature/billing-dashboard</span>
          </div>
          <button onClick={resurrect} disabled={isResurrecting} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-5 py-2 rounded-full text-sm font-bold transition-all shadow-lg shadow-indigo-500/20">
            <RotateCcw size={16} className={isResurrecting ? 'animate-spin' : ''} />
            {isResurrecting ? 'RECONSTITUTING...' : 'RESURRECT PROGRESS'}
          </button>
        </div>
        <div className="grid md:grid-cols-2 gap-px bg-slate-800">
          <div className="bg-slate-900 p-6 h-80 overflow-y-auto font-mono text-xs">
            <div className="flex items-center gap-2 text-slate-500 mb-4 border-b border-slate-800 pb-2">
              <TerminalIcon size={14} /> LIVE_CONTEXT_FEED
            </div>
            {logs.map((log, i) => (
              <div key={i} className="mb-2 flex gap-2">
                <span className="text-indigo-500 font-bold tracking-widest">>></span>
                <span className={log.includes('Security') ? 'text-red-400' : 'text-green-400'}>{log}</span>
              </div>
            ))}
          </div>
          <div className="bg-slate-900 p-6 border-l border-slate-800">
            <div className="flex items-center gap-2 text-slate-500 mb-4 border-b border-slate-800 pb-2 uppercase text-xs font-bold tracking-tighter">
              <ShieldCheck size={14} /> Restored Ideology
            </div>
            {showIdeology ? (
              <div className="space-y-4">
                <div className="p-4 bg-indigo-950/40 border border-indigo-500/30 rounded-lg">
                  <p className="text-indigo-300 text-[10px] font-black uppercase mb-1">Current Goal</p>
                  <p className="text-sm leading-relaxed">Transitioning billing logic to seat-based infrastructure. I was midway through deciding on the provider pattern before the meeting.</p>
                </div>
                <div className="p-4 bg-red-950/40 border border-red-500/30 rounded-lg">
                  <p className="text-red-300 text-[10px] font-black uppercase mb-1">Security Alert</p>
                  <p className="text-sm italic">Stripe API Secret detected in line 12. Scrubbed from memory and local cache.</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full opacity-30 italic text-sm">
                Waiting for resurrection...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
