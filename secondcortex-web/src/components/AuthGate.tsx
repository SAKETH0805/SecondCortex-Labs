'use client';

import { useState, useEffect } from 'react';
import ContextGraph from '@/components/ContextGraph';

/**
 * AuthGate — login screen that requires an API key before showing the graph.
 * The key is stored in sessionStorage (cleared when tab closes).
 * Never baked into the JS bundle.
 */
export default function AuthGate() {
    const [apiKey, setApiKey] = useState<string>('');
    const [inputKey, setInputKey] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    // On mount, check if user already has a session
    useEffect(() => {
        const stored = sessionStorage.getItem('sc_api_key');
        if (stored) {
            setApiKey(stored);
        }
    }, []);

    const handleLogin = async () => {
        const key = inputKey.trim();
        if (!key) {
            setError('Please enter your API key.');
            return;
        }

        setIsLoading(true);
        setError('');

        // Validate the key against the backend health endpoint with auth
        try {
            const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://sc-backend-suhaan.azurewebsites.net';
            const res = await fetch(`${backendUrl}/api/v1/events`, {
                headers: { 'X-API-Key': key },
            });
            if (res.ok) {
                sessionStorage.setItem('sc_api_key', key);
                setApiKey(key);
            } else if (res.status === 401 || res.status === 403) {
                setError('Invalid API key. Please check and try again.');
            } else {
                setError(`Backend error: ${res.status}`);
            }
        } catch {
            setError('Cannot reach the backend. Is it running?');
        } finally {
            setIsLoading(false);
        }
    };

    const handleLogout = () => {
        sessionStorage.removeItem('sc_api_key');
        setApiKey('');
        setInputKey('');
    };

    // ── Authenticated: show the graph ───────────────────────────
    if (apiKey) {
        return (
            <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
                <button
                    onClick={handleLogout}
                    style={{
                        position: 'absolute',
                        top: 16,
                        right: 16,
                        zIndex: 1000,
                        padding: '6px 14px',
                        fontSize: '12px',
                        background: 'rgba(239, 68, 68, 0.15)',
                        color: '#f87171',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        backdropFilter: 'blur(8px)',
                        transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={(e) => {
                        (e.target as HTMLElement).style.background = 'rgba(239, 68, 68, 0.3)';
                    }}
                    onMouseLeave={(e) => {
                        (e.target as HTMLElement).style.background = 'rgba(239, 68, 68, 0.15)';
                    }}
                >
                    Logout
                </button>
                <ContextGraph apiKey={apiKey} />
            </div>
        );
    }

    // ── Login screen ────────────────────────────────────────────
    return (
        <div style={{
            width: '100%',
            height: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #020617 0%, #0f172a 50%, #1e1b4b 100%)',
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        }}>
            <div style={{
                background: 'rgba(15, 23, 42, 0.8)',
                backdropFilter: 'blur(20px)',
                border: '1px solid rgba(99, 102, 241, 0.2)',
                borderRadius: '16px',
                padding: '48px',
                maxWidth: '420px',
                width: '100%',
                boxShadow: '0 25px 50px rgba(0, 0, 0, 0.5), 0 0 100px rgba(99, 102, 241, 0.1)',
            }}>
                {/* Logo */}
                <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                    <div style={{
                        fontSize: '36px',
                        marginBottom: '8px',
                    }}>🧠</div>
                    <h1 style={{
                        fontSize: '24px',
                        fontWeight: 700,
                        color: '#e2e8f0',
                        margin: '0 0 4px 0',
                        letterSpacing: '-0.5px',
                    }}>SecondCortex</h1>
                    <p style={{
                        fontSize: '14px',
                        color: '#64748b',
                        margin: 0,
                    }}>Live Context Graph</p>
                </div>

                {/* API Key Input */}
                <div style={{ marginBottom: '16px' }}>
                    <label style={{
                        display: 'block',
                        fontSize: '13px',
                        fontWeight: 500,
                        color: '#94a3b8',
                        marginBottom: '8px',
                    }}>
                        API Key
                    </label>
                    <input
                        type="password"
                        value={inputKey}
                        onChange={(e) => setInputKey(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleLogin(); }}
                        placeholder="sc-key-..."
                        style={{
                            width: '100%',
                            padding: '12px 16px',
                            fontSize: '14px',
                            background: 'rgba(30, 41, 59, 0.8)',
                            border: error ? '1px solid rgba(239, 68, 68, 0.5)' : '1px solid rgba(99, 102, 241, 0.3)',
                            borderRadius: '10px',
                            color: '#e2e8f0',
                            outline: 'none',
                            transition: 'border-color 0.2s ease',
                            boxSizing: 'border-box',
                        }}
                        autoFocus
                    />
                </div>

                {/* Error message */}
                {error && (
                    <div style={{
                        padding: '10px 14px',
                        fontSize: '13px',
                        color: '#f87171',
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.2)',
                        borderRadius: '8px',
                        marginBottom: '16px',
                    }}>
                        {error}
                    </div>
                )}

                {/* Login button */}
                <button
                    onClick={handleLogin}
                    disabled={isLoading}
                    style={{
                        width: '100%',
                        padding: '12px',
                        fontSize: '14px',
                        fontWeight: 600,
                        background: isLoading
                            ? 'rgba(99, 102, 241, 0.3)'
                            : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '10px',
                        cursor: isLoading ? 'wait' : 'pointer',
                        transition: 'all 0.2s ease',
                        letterSpacing: '0.3px',
                    }}
                >
                    {isLoading ? 'Verifying…' : 'Authenticate'}
                </button>

                {/* Help text */}
                <p style={{
                    fontSize: '12px',
                    color: '#475569',
                    textAlign: 'center',
                    marginTop: '20px',
                    lineHeight: '1.5',
                }}>
                    Enter the API key configured in your<br />
                    VS Code extension settings.
                </p>
            </div>
        </div>
    );
}
