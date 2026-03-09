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

    useEffect(() => {
        const stored = localStorage.getItem('sc_jwt_token');
        if (!stored) {
            router.push('/login');
        } else {
            setToken(stored);
        }
        setIsChecking(false);
    }, [router]);

    const handleLogout = () => {
        localStorage.removeItem('sc_jwt_token');
        setToken(null);
        router.push('/login');
    };

    if (isChecking) {
        return (
            <div className="flex items-center justify-center w-full h-screen bg-[#020617] text-indigo-500 text-lg font-semibold">
                Authenticating...
            </div>
        );
    }

    if (!token) {
        return null;
    }

    return (
        <div className="relative w-full h-screen bg-[#020617] overflow-hidden">
            {/* Top Navigation Bar */}
            <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-1 p-1 bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl shadow-2xl">
                <button
                    onClick={() => setActiveTab('dashboard')}
                    className={`px-6 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 ${activeTab === 'dashboard'
                            ? 'bg-white text-black shadow-lg'
                            : 'text-gray-400 hover:text-white hover:bg-white/5'
                        }`}
                >
                    Dashboard
                </button>
                <button
                    onClick={() => setActiveTab('live')}
                    className={`px-6 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 ${activeTab === 'live'
                            ? 'bg-white text-black shadow-lg'
                            : 'text-gray-400 hover:text-white hover:bg-white/5'
                        }`}
                >
                    Live Context Graph
                </button>
            </div>

            {/* Logout Button */}
            <button
                onClick={handleLogout}
                className="fixed top-6 right-6 z-[100] px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-xl text-xs font-bold backdrop-blur-md transition-all active:scale-95"
            >
                Logout
            </button>

            {/* Content Area */}
            <div className="w-full h-full overflow-y-auto custom-scrollbar">
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
        </div>
    );
}
