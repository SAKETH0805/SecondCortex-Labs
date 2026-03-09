'use client';

import React, { useState, useEffect, useCallback } from 'react';

interface DashboardProps {
    token: string;
    backendUrl?: string;
}

interface Stats {
    totalSnapshots: number;
    lastSnapshotTime: string | null;
    activeProject: string;
}

export default function Dashboard({ 
    token, 
    backendUrl = 'https://sc-backend-suhaan.azurewebsites.net' 
}: DashboardProps) {
    const [stats, setStats] = useState<Stats>({
        totalSnapshots: 0,
        lastSnapshotTime: null,
        activeProject: 'SecondCortex Labs'
    });
    const [mcpKey, setMcpKey] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchStats = useCallback(async () => {
        try {
            const res = await fetch(`${backendUrl}/api/v1/snapshots/timeline?limit=1`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                if (data.timeline && data.timeline.length > 0) {
                    setStats(prev => ({
                        ...prev,
                        totalSnapshots: data.total || data.timeline.length, // Fallback if total isn't provided
                        lastSnapshotTime: data.timeline[0].timestamp
                    }));
                }
            }
        } catch (err) {
            console.error("Failed to fetch stats", err);
        }
    }, [backendUrl, token]);

    const fetchMcpKey = useCallback(async () => {
        try {
            const res = await fetch(`${backendUrl}/api/v1/auth/mcp-key`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                if (data.api_key) {
                    setMcpKey(data.api_key);
                }
            }
        } catch (err) {
            console.error("Failed to fetch MCP key", err);
        }
    }, [backendUrl, token]);

    useEffect(() => {
        fetchStats();
        fetchMcpKey();
    }, [fetchStats, fetchMcpKey]);

    const handleGenerateKey = async () => {
        setIsGenerating(true);
        setError(null);
        try {
            const res = await fetch(`${backendUrl}/api/v1/auth/mcp-key`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setMcpKey(data.api_key);
                setShowModal(true);
            } else {
                setError("Failed to generate key. Please try again.");
            }
        } catch (err) {
            setError("Connection error. Check your internet.");
        } finally {
            setIsGenerating(false);
        }
    };

    const copyToClipboard = () => {
        if (mcpKey) {
            navigator.clipboard.writeText(mcpKey);
            alert("API Key copied to clipboard!");
        }
    };

    return (
        <div className="min-h-screen w-full bg-[#020617] p-8 pt-24 text-white font-sans selection:bg-indigo-500/30">
            <div className="max-w-6xl mx-auto space-y-12">
                {/* Header */}
                <div className="space-y-2">
                    <h1 className="text-4xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-500">
                        Developer Dashboard
                    </h1>
                    <p className="text-gray-400 text-lg">Manage your SecondCortex environment and MCP integrations.</p>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <StatCard 
                        title="Memory Snapshots" 
                        value={stats.totalSnapshots.toString()} 
                        subtitle={stats.lastSnapshotTime ? `Last update: ${new Date(stats.lastSnapshotTime).toLocaleTimeString()}` : "No snapshots yet"} 
                        icon="🗄️"
                    />
                    <StatCard 
                        title="Active Project" 
                        value={stats.activeProject} 
                        subtitle="Current workspace scope" 
                        icon="🚀"
                    />
                    <StatCard 
                        title="MCP Status" 
                        value={mcpKey ? "Connected" : "Not Linked"} 
                        subtitle={mcpKey ? "Authentication active" : "Requires API Key"} 
                        icon="🔌"
                    />
                </div>

                {/* MCP Section */}
                <div className="relative group">
                    <div className="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl blur opacity-20 group-hover:opacity-30 transition duration-1000"></div>
                    <div className="relative bg-[#0f172a]/80 border border-white/10 p-8 rounded-2xl backdrop-blur-xl flex flex-col md:flex-row items-center justify-between gap-8">
                        <div className="space-y-4 max-w-xl">
                            <h2 className="text-2xl font-semibold flex items-center gap-3">
                                <span className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400">🔌</span>
                                MCP Integration (Model Context Protocol)
                            </h2>
                            <p className="text-gray-400 leading-relaxed">
                                Connect external AI assistants like Claude Desktop or Cursor to your local context memory. 
                                Secure your connection by generating a unique API key.
                            </p>
                        </div>
                        <div className="flex flex-col items-center gap-4 w-full md:w-auto">
                            <button
                                onClick={mcpKey ? () => setShowModal(true) : handleGenerateKey}
                                disabled={isGenerating}
                                className="w-full md:w-64 py-4 px-6 bg-white text-black font-bold rounded-xl hover:bg-indigo-50 transition-all active:scale-95 disabled:opacity-50 shadow-lg shadow-white/5"
                            >
                                {isGenerating ? "Processing..." : mcpKey ? "View Existing Key" : "Generate MCP Key"}
                            </button>
                            {error && <p className="text-red-400 text-sm">{error}</p>}
                        </div>
                    </div>
                </div>

                {/* Integration Guide */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8">
                    <div className="bg-[#0f172a]/40 border border-white/5 p-6 rounded-xl space-y-4">
                        <h3 className="font-semibold text-gray-300">Quick Start: Claude Desktop</h3>
                        <pre className="bg-black/50 p-4 rounded-lg text-xs text-indigo-300 overflow-x-auto border border-white/5">
{`"mcpServers": {
  "secondcortex": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-sse", "https://sc-backend-suhaan.azurewebsites.net/mcp/sse"],
    "env": {
      "SECOND_CORTEX_API_KEY": "YOUR_KEY_HERE"
    }
  }
}`}
                        </pre>
                    </div>
                    <div className="bg-[#0f172a]/40 border border-white/5 p-6 rounded-xl space-y-4">
                        <h3 className="font-semibold text-gray-300">Integration Tips</h3>
                        <ul className="text-sm text-gray-400 space-y-2 list-disc list-inside">
                            <li>Keep your API key private — it grants access to your memory.</li>
                            <li>You can regenerate your key at any time to revoke old ones.</li>
                            <li>Ensure your backend is awake by visiting the dashboard occasionally.</li>
                        </ul>
                    </div>
                </div>
            </div>

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowModal(false)}></div>
                    <div className="relative bg-[#1e293b] border border-white/10 w-full max-w-lg rounded-3xl p-8 shadow-2xl animate-in zoom-in duration-300">
                        <div className="space-y-6">
                            <div className="text-center space-y-2">
                                <div className="text-4xl animate-bounce">🔑</div>
                                <h3 className="text-2xl font-bold">Your MCP API Key</h3>
                                <p className="text-gray-400 text-sm">Use this key to authorize external MCP clients.</p>
                            </div>

                            <div className="bg-black/40 border border-white/10 p-5 rounded-2xl flex items-center justify-between gap-4 font-mono group">
                                <span className="text-indigo-400 truncate text-lg">{mcpKey}</span>
                                <button 
                                    onClick={copyToClipboard}
                                    className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                                    title="Copy to clipboard"
                                >
                                    📋
                                </button>
                            </div>

                            <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-xl flex gap-3">
                                <span className="text-amber-500 italic">⚠️</span>
                                <p className="text-xs text-amber-200/70">
                                    Warning: This key grants full access to your snapshot history. 
                                    Do not share it on public forums or commit it to GitHub.
                                </p>
                            </div>

                            <button 
                                onClick={() => setShowModal(false)}
                                className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 font-bold rounded-xl transition-colors shadow-lg shadow-indigo-500/20"
                            >
                                Got it
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function StatCard({ title, value, subtitle, icon }: { title: string, value: string, subtitle: string, icon: string }) {
    return (
        <div className="bg-[#0f172a]/50 border border-white/5 p-6 rounded-2xl space-y-4 hover:border-white/10 hover:bg-[#0f172a]/70 transition-all group">
            <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-500 uppercase tracking-wider">{title}</span>
                <span className="text-2xl group-hover:scale-125 transition-transform duration-500">{icon}</span>
            </div>
            <div className="space-y-1">
                <div className="text-3xl font-bold">{value}</div>
                <div className="text-xs text-gray-500">{subtitle}</div>
            </div>
        </div>
    );
}
