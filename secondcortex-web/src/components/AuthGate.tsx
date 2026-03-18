'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ContextGraph from '@/components/ContextGraph';
import Dashboard from '@/components/Dashboard';

/**
 * AuthGate — protection wrapper for the live graph and dashboard.
 * If no token is found in localStorage, it redirects to /login.
 * Supports ?demo=true to bypass auth and load demo data for onboarding.
 */
export default function AuthGate() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [token, setToken] = useState<string | null>(null);
    const [isChecking, setIsChecking] = useState(true);
    const [activeTab, setActiveTab] = useState<'dashboard' | 'live'>('dashboard');
    const [isDemoMode, setIsDemoMode] = useState(false);

    useEffect(() => {
        const demoParam = searchParams.get('demo');
        if (demoParam === 'true') {
            // Demo mode: bypass auth, use a demo token
            setIsDemoMode(true);
            setToken('demo_token');
            setIsChecking(false);
            return;
        }

        const stored = localStorage.getItem('sc_jwt_token');
        if (!stored) {
            router.push('/login');
        } else {
            setToken(stored);
        }
        setIsChecking(false);
    }, [router, searchParams]);

    const handleLogout = () => {
        if (isDemoMode) {
            // In demo mode, just redirect to landing
            router.push('/');
            return;
        }
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
                    {isDemoMode && <span className="sc-demo-badge">DEMO</span>}
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

                <button
                    onClick={handleLogout}
                    className="btn-secondary sc-logout"
                    type="button"
                >
                    {isDemoMode ? 'Exit Demo' : 'Logout'}
                </button>
            </div>

            <div className="sc-app-content custom-scrollbar">
                {activeTab === 'dashboard' ? (
                    <Dashboard token={token} isDemoMode={isDemoMode} />
                ) : (
                    <ContextGraph token={token} onUnauthorized={handleLogout} />
                )}
            </div>

            <style jsx global>{`
                .sc-demo-badge {
                    display: inline-block;
                    margin-left: 8px;
                    padding: 2px 8px;
                    font-size: 10px;
                    font-weight: 700;
                    letter-spacing: 1px;
                    color: #0a0a0a;
                    background: linear-gradient(135deg, #00ffc8, #00d4aa);
                    border-radius: 4px;
                    vertical-align: middle;
                    animation: demoPulse 2s ease-in-out infinite;
                }
                @keyframes demoPulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.7; }
                }
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
        </div>
    );
}
