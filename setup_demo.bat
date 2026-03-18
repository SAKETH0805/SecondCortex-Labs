@echo off
SETLOCAL EnableDelayedExpansion

:: 1. Create Folder Structure
mkdir src\components\Simulator
mkdir public

:: 2. Create package.json
(
echo {
echo   "name": "secondcortex-demo",
echo   "version": "1.0.0",
echo   "private": true,
echo   "dependencies": {
echo     "react": "^18.2.0",
echo     "react-dom": "^18.2.0",
echo     "react-scripts": "5.0.1",
echo     "lucide-react": "^0.284.0"
echo   },
echo   "scripts": {
echo     "start": "react-scripts start"
echo   }
echo }
) > package.json

:: 3. Create Index HTML
(
echo ^<!DOCTYPE html^>
echo ^<html lang="en"^>
echo   ^<head^>
echo     ^<meta charset="utf-8" /^>
echo     ^<meta name="viewport" content="width=device-width, initial-scale=1" /^>
echo     ^<title^>SecondCortex Demo^</title^>
echo     ^<script src="https://cdn.tailwindcss.com"^>^</script^>
echo   ^</head^>
echo   ^<body^>
echo     ^<div id="root"^>^</div^>
echo   ^</body^>
echo ^</html^>
) > public\index.html

:: 4. Create App.js (The Main Logic)
(
echo import React, { useState } from 'react';
echo import { RotateCcw, GitBranch, ShieldCheck, Terminal as TerminalIcon } from 'lucide-react';
echo.
echo export default function App^(^) {
echo   const [isResurrecting, setIsResurrecting] = useState^(false^);
echo   const [showIdeology, setShowIdeology] = useState^(false^);
echo   const [logs, setLogs] = useState^([ '[System] SecondCortex Node Active', '[Git] Branch: feature/billing-dashboard' ]^);
echo.
echo   const resurrect = ^(^) =^> {
echo     setIsResurrecting^(true^);
echo     setTimeout^(^(^) =^> {
echo       setLogs^(prev =^> [
echo         ...prev,
echo         '[Analysis] Deep context found for Billing Refactor',
echo         '[Ideology] Scaling for Q3 seat-based pricing detected',
echo         '[Security] Secret scrubbed: sk_test_51Mz...',
echo         '[Success] Developer State Restored'
echo       ]^);
echo       setShowIdeology^(true^);
echo       setIsResurrecting^(false^);
echo     }, 1200^);
echo   };
echo.
echo   return ^(
echo     ^<div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 font-sans text-slate-200"^>
echo       ^<div className="text-center mb-10"^>
echo         ^<h1 className="text-4xl font-black text-white mb-2 tracking-tight"^>SecondCortex Labs^</h1^>
echo         ^<p className="text-slate-400 uppercase tracking-widest text-xs font-bold"^>Resurrect Context Simulator^</p^>
echo       ^</div^>
echo       ^<div className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden"^>
echo         ^<div className="bg-slate-800/50 p-4 border-b border-slate-700 flex justify-between items-center"^>
echo           ^<div className="flex items-center gap-2"^>
echo             ^<GitBranch size={16} className="text-indigo-400" /^>
echo             ^<span className="text-sm font-mono tracking-tighter"^>feature/billing-dashboard^</span^>
echo           ^</div^>
echo           ^<button onClick={resurrect} disabled={isResurrecting} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-5 py-2 rounded-full text-sm font-bold transition-all shadow-lg shadow-indigo-500/20"^>
echo             ^<RotateCcw size={16} className={isResurrecting ? 'animate-spin' : ''} /^>
echo             {isResurrecting ? 'RECONSTITUTING...' : 'RESURRECT PROGRESS'}
echo           ^</button^>
echo         ^</div^>
echo         ^<div className="grid md:grid-cols-2 gap-px bg-slate-800"^>
echo           ^<div className="bg-slate-900 p-6 h-80 overflow-y-auto font-mono text-xs"^>
echo             ^<div className="flex items-center gap-2 text-slate-500 mb-4 border-b border-slate-800 pb-2"^>
echo               ^<TerminalIcon size={14} /^> LIVE_CONTEXT_FEED
echo             ^</div^>
echo             {logs.map^(^(log, i^) =^> ^(
echo               ^<div key={i} className="mb-2 flex gap-2"^>
echo                 ^<span className="text-indigo-500 font-bold tracking-widest"^>^>^>^</span^>
echo                 ^<span className={log.includes^('Security'^) ? 'text-red-400' : 'text-green-400'}^>{log}^</span^>
echo               ^</div^>
echo             ^)^)}
echo           ^</div^>
echo           ^<div className="bg-slate-900 p-6 border-l border-slate-800"^>
echo             ^<div className="flex items-center gap-2 text-slate-500 mb-4 border-b border-slate-800 pb-2 uppercase text-xs font-bold tracking-tighter"^>
echo               ^<ShieldCheck size={14} /^> Restored Ideology
echo             ^</div^>
echo             {showIdeology ? ^(
echo               ^<div className="space-y-4"^>
echo                 ^<div className="p-4 bg-indigo-950/40 border border-indigo-500/30 rounded-lg"^>
echo                   ^<p className="text-indigo-300 text-[10px] font-black uppercase mb-1"^>Current Goal^</p^>
echo                   ^<p className="text-sm leading-relaxed"^>Transitioning billing logic to seat-based infrastructure. I was midway through deciding on the provider pattern before the meeting.^</p^>
echo                 ^</div^>
echo                 ^<div className="p-4 bg-red-950/40 border border-red-500/30 rounded-lg"^>
echo                   ^<p className="text-red-300 text-[10px] font-black uppercase mb-1"^>Security Alert^</p^>
echo                   ^<p className="text-sm italic"^>Stripe API Secret detected in line 12. Scrubbed from memory and local cache.^</p^>
echo                 ^</div^>
echo               ^</div^>
echo             ^) : ^(
echo               ^<div className="flex flex-col items-center justify-center h-full opacity-30 italic text-sm"^>
echo                 Waiting for resurrection...
echo               ^</div^>
echo             ^)}
echo           ^</div^>
echo         ^</div^>
echo       ^</div^>
echo     ^</div^>
echo   ^);
echo }
) > src\App.js

:: 5. Initialize Git
git init
git add .
git commit -m "Initial commit: SecondCortex Prototype"
git checkout -b feature/billing-dashboard

echo ----------------------------------------
echo SETUP COMPLETE
echo ----------------------------------------
echo Now run:
echo 1. npm install
echo 2. npm start
echo ----------------------------------------
pause