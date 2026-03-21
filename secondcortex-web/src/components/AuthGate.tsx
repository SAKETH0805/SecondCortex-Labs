'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import ContextGraph from '@/components/ContextGraph';
import Dashboard from '@/components/Dashboard';

/**
 * AuthGate — protection wrapper for the live graph and dashboard.
 * If no token is found in localStorage, it redirects to /login.
 */
export default function AuthGate() {
    const router = useRouter();
    const [token, setToken] = useState<string | null>(null);
    const [isChecking, setIsChecking] = useState(true);
    const [activeTab, setActiveTab] = useState<'dashboard' | 'live'>('dashboard');
    const [mcpKey, setMcpKey] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [showMcpModal, setShowMcpModal] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const backendUrl = 'https://sc-backend-suhaan.azurewebsites.net';

    useEffect(() => {
        const stored = localStorage.getItem('sc_jwt_token');
        if (!stored) {
            router.push('/login');
        } else {
            setToken(stored);
            fetchMcpKey(stored);
        }
        setIsChecking(false);
    }, [router]);

    const fetchMcpKey = async (authToken: string) => {
        try {
            const res = await fetch(`${backendUrl}/api/v1/auth/mcp-key`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
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
    };

    const handleGenerateKey = async () => {
        if (!token) return;
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
                setShowMcpModal(true);
            } else {
                setError("Failed to generate key. Please try again.");
            }
        } catch {
            setError("Connection error. Check your internet.");
        } finally {
            setIsGenerating(false);
        }
    };

    const copyToClipboard = () => {
        if (mcpKey) {
            navigator.clipboard.writeText(mcpKey);
            setNotice("API key copied to clipboard.");
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('sc_jwt_token');
        setToken(null);
        router.push('/login');
    };

    if (isChecking) {
        return (
            <div className="sc-shell sc-center-text">
                Authenticating...
            </div>
        );
    }

    if (!token) {
        return null;
    }

    return (
        <div className="sc-shell sc-app-shell">
            <div className="sc-app-topbar">
                <div className="nav-logo">
                    Second<span>Cortex</span>
                </div>

                <div className="sc-app-tabs">
                <button
                    onClick={() => setActiveTab('dashboard')}
                    className={`sc-app-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
                >
                    Dashboard
                </button>
                <button
                    onClick={() => setActiveTab('live')}
                    className={`sc-app-tab ${activeTab === 'live' ? 'active' : ''}`}
                >
                    Live Context Graph
                </button>
                </div>

                <div className="sc-app-actions">
                    <button
                        onClick={mcpKey ? () => setShowMcpModal(true) : handleGenerateKey}
                        disabled={isGenerating}
                        className="btn-secondary sc-mcp-btn"
                        title={mcpKey ? "View MCP Integration" : "Generate MCP API Key"}
                    >
                        {isGenerating ? "⏳" : mcpKey ? "🔐" : "⚙️"} MCP
                    </button>
                </div>

                <button
                    onClick={handleLogout}
                    className="btn-secondary sc-logout"
                    type="button"
                >
                    Logout
                </button>
            </div>

            <div className="sc-app-content custom-scrollbar">
                {activeTab === 'dashboard' ? (
                    <Dashboard token={token} />
                ) : (
                    <ContextGraph token={token} onUnauthorized={handleLogout} />
                )}
            </div>

            <style jsx global>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 6px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: rgba(255, 255, 255, 0.2);
                }
            `}</style>

            {/* MCP Modal */}
            {showMcpModal && (
                <div className="sc-modal-wrap">
                    <div className="sc-modal-backdrop" onClick={() => setShowMcpModal(false)} />
                    <div className="sc-modal-card">
                        <div className="sc-modal-stack">
                            <div className="sc-modal-head">
                                <div className="sc-modal-emoji">🔐</div>
                                <h3 className="sc-modal-title">Your MCP API Key</h3>
                                <p className="sc-modal-sub">Use this key to authorize external MCP clients.</p>
                            </div>

                            <div className="sc-modal-key">
                                <span className="sc-modal-key-text">{mcpKey}</span>
                                <button 
                                    onClick={copyToClipboard}
                                    className="btn-secondary"
                                    title="Copy to clipboard"
                                >
                                    📋
                                </button>
                            </div>

                            <div className="sc-modal-warn">
                                <span>⚠️</span>
                                <p>
                                    Warning: This key grants full access to your snapshot history. 
                                    Do not share it on public forums or commit it to GitHub.
                                </p>
                            </div>

                            {error && <p className="sc-auth-error">{error}</p>}
                            {notice && <p className="sc-auth-sub">{notice}</p>}

                            <button 
                                onClick={() => setShowMcpModal(false)}
                                className="btn-primary sc-modal-close"
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
