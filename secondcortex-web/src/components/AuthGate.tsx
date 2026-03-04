'use client';

import { useState, useEffect } from 'react';
import ContextGraph from '@/components/ContextGraph';

/**
 * AuthGate — login/signup screen that requires a JWT token before showing the graph.
 * The token is stored in localStorage.
 */
export default function AuthGate() {
    const [token, setToken] = useState<string>('');
    const [mode, setMode] = useState<'login' | 'signup'>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    // On mount, check if user already has a session
    useEffect(() => {
        const stored = localStorage.getItem('sc_jwt_token');
        if (stored) {
            setToken(stored);
        }
    }, []);

    const handleSubmit = async () => {
        const e = email.trim();
        const p = password;
        if (!e || !p) {
            setError('Please enter both email and password.');
            return;
        }

        setIsLoading(true);
        setError('');

        try {
            const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://sc-backend-suhaan.azurewebsites.net';
            const endpoint = mode === 'login' ? '/api/v1/auth/login' : '/api/v1/auth/signup';

            const payload = mode === 'login'
                ? { email: e, password: p }
                : { email: e, password: p, display_name: displayName.trim() };

            const res = await fetch(`${backendUrl}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                const data = await res.json();
                localStorage.setItem('sc_jwt_token', data.token);
                setToken(data.token);
            } else {
                const errData = await res.json().catch(() => ({}));
                setError(errData.detail || `${mode === 'login' ? 'Login' : 'Signup'} failed. Please check your credentials.`);
            }
        } catch {
            setError('Cannot reach the backend. Is it running?');
        } finally {
            setIsLoading(false);
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('sc_jwt_token');
        setToken('');
        setEmail('');
        setPassword('');
    };

    // ── Authenticated: show the graph ───────────────────────────
    if (token) {
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
                <ContextGraph token={token} onUnauthorized={handleLogout} />
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

                {/* Tabs */}
                <div style={{ display: 'flex', marginBottom: '24px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    <button
                        onClick={() => { setMode('login'); setError(''); }}
                        style={{
                            flex: 1, padding: '10px', background: 'transparent', border: 'none',
                            borderBottom: mode === 'login' ? '2px solid #8b5cf6' : '2px solid transparent',
                            color: mode === 'login' ? '#fff' : '#64748b',
                            cursor: 'pointer', fontSize: '14px', fontWeight: 500, transition: 'all 0.2s'
                        }}
                    >
                        Log In
                    </button>
                    <button
                        onClick={() => { setMode('signup'); setError(''); }}
                        style={{
                            flex: 1, padding: '10px', background: 'transparent', border: 'none',
                            borderBottom: mode === 'signup' ? '2px solid #8b5cf6' : '2px solid transparent',
                            color: mode === 'signup' ? '#fff' : '#64748b',
                            cursor: 'pointer', fontSize: '14px', fontWeight: 500, transition: 'all 0.2s'
                        }}
                    >
                        Sign Up
                    </button>
                </div>

                {/* Form Fields */}
                <div style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'block', fontSize: '13px', color: '#94a3b8', marginBottom: '8px' }}>Email</label>
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
                        placeholder="you@example.com"
                        style={{
                            width: '100%', padding: '12px 16px', fontSize: '14px',
                            background: 'rgba(30, 41, 59, 0.8)', border: '1px solid rgba(99, 102, 241, 0.3)',
                            borderRadius: '10px', color: '#e2e8f0', outline: 'none', boxSizing: 'border-box',
                            marginBottom: '16px'
                        }}
                    />

                    <label style={{ display: 'block', fontSize: '13px', color: '#94a3b8', marginBottom: '8px' }}>Password</label>
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
                        placeholder="••••••••"
                        style={{
                            width: '100%', padding: '12px 16px', fontSize: '14px',
                            background: 'rgba(30, 41, 59, 0.8)', border: '1px solid rgba(99, 102, 241, 0.3)',
                            borderRadius: '10px', color: '#e2e8f0', outline: 'none', boxSizing: 'border-box'
                        }}
                    />

                    {mode === 'signup' && (
                        <div style={{ marginTop: '16px' }}>
                            <label style={{ display: 'block', fontSize: '13px', color: '#94a3b8', marginBottom: '8px' }}>Display Name (optional)</label>
                            <input
                                type="text"
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
                                placeholder="Your Name"
                                style={{
                                    width: '100%', padding: '12px 16px', fontSize: '14px',
                                    background: 'rgba(30, 41, 59, 0.8)', border: '1px solid rgba(99, 102, 241, 0.3)',
                                    borderRadius: '10px', color: '#e2e8f0', outline: 'none', boxSizing: 'border-box'
                                }}
                            />
                        </div>
                    )}
                </div>

                {/* Error message */}
                {error && (
                    <div style={{
                        padding: '10px 14px', fontSize: '13px', color: '#f87171',
                        background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)',
                        borderRadius: '8px', marginBottom: '16px',
                    }}>
                        {error}
                    </div>
                )}

                {/* Submit button */}
                <button
                    onClick={handleSubmit}
                    disabled={isLoading}
                    style={{
                        width: '100%', padding: '12px', fontSize: '14px', fontWeight: 600,
                        background: isLoading ? 'rgba(99, 102, 241, 0.3)' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                        color: '#fff', border: 'none', borderRadius: '10px',
                        cursor: isLoading ? 'wait' : 'pointer', letterSpacing: '0.3px', marginTop: '8px'
                    }}
                >
                    {isLoading ? 'Please wait…' : (mode === 'login' ? 'Log In' : 'Create Account')}
                </button>
            </div>
        </div>
    );
}
