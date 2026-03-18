'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';

// ── Language color map for timeline dots ────────────────────────
const LANG_COLORS: Record<string, string> = {
    python: '#3572A5',
    typescriptreact: '#f0c040',
    typescript: '#3178c6',
    javascript: '#f7df1e',
    css: '#563d7c',
    json: '#292929',
    yaml: '#cb171e',
    markdown: '#083fa1',
    bat: '#C1F12E',
    html: '#e34c26',
};

function getLangColor(langId: string): string {
    return LANG_COLORS[langId?.toLowerCase()] || '#888';
}

function getLangLabel(langId: string): string {
    const labels: Record<string, string> = {
        python: 'Python',
        typescriptreact: 'TSX',
        typescript: 'TypeScript',
        javascript: 'JavaScript',
        css: 'CSS',
        json: 'JSON',
        yaml: 'YAML',
        markdown: 'Markdown',
        bat: 'Batch',
        html: 'HTML',
    };
    return labels[langId?.toLowerCase()] || langId || 'Unknown';
}

// ── Types ───────────────────────────────────────────────────────

interface DashboardProps {
    token: string;
    backendUrl?: string;
    isDemoMode?: boolean;
}

interface Stats {
    totalSnapshots: number;
    lastSnapshotTime: string | null;
    activeProject: string;
}

interface TimelineEvent {
    id: string;
    timestamp: string;
    active_file: string;
    language_id: string;
    git_branch: string;
    summary: string;
    entities: string[];
}

export default function Dashboard({ 
    token, 
    backendUrl: passedBackendUrl,
    isDemoMode = false,
}: DashboardProps) {
    const backendUrl = passedBackendUrl || 
                      process.env.NEXT_PUBLIC_BACKEND_URL || 
                      (isDemoMode ? 'http://localhost:8000' : 'https://sc-backend-suhaan.azurewebsites.net');

    const [stats, setStats] = useState<Stats>({
        totalSnapshots: 0,
        lastSnapshotTime: null,
        activeProject: 'SecondCortex Labs'
    });
    const [mcpKey, setMcpKey] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    // ── Timeline state ──────────────────────────────────────────
    const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
    const [selectedEvent, setSelectedEvent] = useState<TimelineEvent | null>(null);
    const [showTimelineDetail, setShowTimelineDetail] = useState(false);
    const tourStartedRef = useRef(false);

    const fetchStats = useCallback(async () => {
        try {
            const res = await fetch(`${backendUrl}/api/v1/snapshots/timeline?limit=1000`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                if (data.timeline && data.timeline.length > 0) {
                    const latest = data.timeline[data.timeline.length - 1];
                    setStats(prev => ({
                        ...prev,
                        totalSnapshots: data.timeline.length,
                        lastSnapshotTime: latest?.timestamp ?? null,
                    }));
                    setTimeline(data.timeline);
                } else {
                    setStats(prev => ({
                        ...prev,
                        totalSnapshots: 0,
                        lastSnapshotTime: null,
                    }));
                    setTimeline([]);
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
        if (!isDemoMode) {
            fetchMcpKey();
        }
        const intervalId = window.setInterval(fetchStats, 5000);
        return () => window.clearInterval(intervalId);
    }, [fetchStats, fetchMcpKey, isDemoMode]);

    // ── Onboarding Tour (driver.js) ─────────────────────────────
    useEffect(() => {
        if (!isDemoMode || tourStartedRef.current || timeline.length === 0) return;
        tourStartedRef.current = true;

        // Dynamically load driver.js to avoid SSR issues
        import('driver.js').then(({ driver }) => {
            import('driver.js/dist/driver.css');

            const driverObj = driver({
                showProgress: true,
                animate: true,
                overlayColor: 'rgba(0, 0, 0, 0.75)',
                popoverClass: 'sc-tour-popover',
                steps: [
                    {
                        element: '#sc-stats-grid',
                        popover: {
                            title: '📊 Your Memory Dashboard',
                            description: 'These cards show your total context snapshots, active project, and MCP connection status — all in real time.',
                            side: 'bottom' as const,
                            align: 'center' as const,
                        }
                    },
                    {
                        element: '#sc-cortex-timeline',
                        popover: {
                            title: '🧠 Live Cortex Timeline',
                            description: 'This is your coding day, visualized. Each dot is a snapshot — color-coded by language. Click any point to see what file you were editing, which branch, and the AI summary.',
                            side: 'top' as const,
                            align: 'center' as const,
                        }
                    },
                    {
                        element: '#sc-timeline-legend',
                        popover: {
                            title: '🎨 Language Legend',
                            description: 'Quickly identify which languages you worked in. Python is blue, TypeScript is amber, CSS is purple, and more.',
                            side: 'top' as const,
                            align: 'center' as const,
                        }
                    },
                    {
                        element: '#sc-mcp-panel',
                        popover: {
                            title: '🔗 MCP Integration',
                            description: 'Connect Claude Desktop, Cursor, or any MCP client to your context memory. Generate a unique API key and paste it into your config.',
                            side: 'top' as const,
                            align: 'center' as const,
                        }
                    },
                ],
            });

            // Small delay to let the DOM render
            setTimeout(() => driverObj.drive(), 800);
        }).catch(err => {
            console.warn('Tour library not available:', err);
        });
    }, [isDemoMode, timeline]);

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

    const handleTimelineClick = (event: TimelineEvent) => {
        setSelectedEvent(event);
        setShowTimelineDetail(true);
    };

    // ── Derive unique languages for legend ──────────────────────
    const uniqueLangs = Array.from(new Set(timeline.map(e => e.language_id).filter(Boolean)));

    return (
        <div className="sc-dashboard-wrap">
            <div className="sc-dashboard-inner">
                <div className="sc-section-header">
                    <p className="section-label">Control Surface</p>
                    <h1 className="section-title">Developer Dashboard</h1>
                    <p className="section-desc">Manage your SecondCortex memory system and external MCP integrations.</p>
                </div>

                <div className="sc-stats-grid" id="sc-stats-grid">
                    <StatCard 
                        title="Memory Snapshots" 
                        value={stats.totalSnapshots.toString()} 
                        subtitle={stats.lastSnapshotTime ? `Last update: ${new Date(stats.lastSnapshotTime).toLocaleTimeString()}` : "No snapshots yet"} 
                        icon="storage"
                    />
                    <StatCard 
                        title="Active Project" 
                        value={stats.activeProject} 
                        subtitle="Current workspace scope" 
                        icon="workspace"
                    />
                    <StatCard 
                        title="MCP Status" 
                        value={mcpKey ? "Connected" : "Not Linked"} 
                        subtitle={mcpKey ? "Authentication active" : "Requires API Key"} 
                        icon="connection"
                    />
                </div>

                {/* ── Live Cortex Timeline ──────────────────────────────── */}
                <div className="sc-timeline-section" id="sc-cortex-timeline">
                    <div className="sc-section-header">
                        <p className="section-label">Context Memory</p>
                        <h2 className="section-title" style={{ fontSize: '1.3rem' }}>Live Cortex Timeline</h2>
                        <p className="section-desc">Click any snapshot to see what you were working on.</p>
                    </div>

                    {timeline.length === 0 ? (
                        <div className="sc-timeline-empty">
                            <p>No snapshots yet. Start coding with the VS Code extension to see your timeline.</p>
                        </div>
                    ) : (
                        <>
                            <div className="sc-timeline-track">
                                <div className="sc-timeline-line" />
                                {timeline.map((event, idx) => {
                                    const color = getLangColor(event.language_id);
                                    const leftPercent = (idx / Math.max(timeline.length - 1, 1)) * 100;
                                    return (
                                        <button
                                            key={event.id}
                                            className="sc-timeline-dot"
                                            style={{
                                                left: `${leftPercent}%`,
                                                backgroundColor: color,
                                                boxShadow: `0 0 8px ${color}88`,
                                            }}
                                            title={`${event.active_file} (${getLangLabel(event.language_id)})`}
                                            onClick={() => handleTimelineClick(event)}
                                        />
                                    );
                                })}
                            </div>

                            {/* Time labels */}
                            <div className="sc-timeline-labels">
                                <span>{timeline[0]?.timestamp ? new Date(timeline[0].timestamp).toLocaleDateString() : ''}</span>
                                <span>{timeline[timeline.length - 1]?.timestamp ? new Date(timeline[timeline.length - 1].timestamp).toLocaleDateString() : ''}</span>
                            </div>

                            {/* Language Legend */}
                            <div className="sc-timeline-legend" id="sc-timeline-legend">
                                {uniqueLangs.map(lang => (
                                    <span key={lang} className="sc-legend-item">
                                        <span className="sc-legend-dot" style={{ backgroundColor: getLangColor(lang) }} />
                                        {getLangLabel(lang)}
                                    </span>
                                ))}
                            </div>
                        </>
                    )}
                </div>

                {/* ── MCP Panel ─────────────────────────────────────────── */}
                <div className="sc-dashboard-panel" id="sc-mcp-panel">
                    <div className="sc-dashboard-panel-inner">
                        <div className="sc-dashboard-text">
                            <h2 className="sc-dashboard-h2">
                                <span className="sc-icon-cell"><MonoIcon kind="connection" /></span>
                                MCP Integration (Model Context Protocol)
                            </h2>
                            <p className="sc-dashboard-p">
                                Connect external AI assistants like Claude Desktop or Cursor to your local context memory. 
                                Secure your connection by generating a unique API key.
                            </p>
                        </div>
                        <div className="sc-dashboard-actions">
                            <button
                                onClick={mcpKey ? () => setShowModal(true) : handleGenerateKey}
                                disabled={isGenerating}
                                className="btn-primary sc-dashboard-btn"
                            >
                                {isGenerating ? "Processing..." : mcpKey ? "View Existing Key" : "Generate MCP Key"}
                            </button>
                            {error && <p className="sc-auth-error">{error}</p>}
                            {notice && <p className="sc-auth-sub">{notice}</p>}
                        </div>
                    </div>
                </div>

                <div className="sc-guide-grid">
                    <div className="sc-guide-card">
                        <h3 className="sc-guide-title">Quick Start: Claude Desktop</h3>
                        <pre className="sc-guide-code">
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
                                        <div className="sc-guide-card">
                                                <h3 className="sc-guide-title">Integration Tips</h3>
                                                <ul className="sc-guide-list">
                            <li>Keep your API key private — it grants access to your memory.</li>
                            <li>You can regenerate your key at any time to revoke old ones.</li>
                            <li>Ensure your backend is awake by visiting the dashboard occasionally.</li>
                        </ul>
                    </div>
                </div>
            </div>

            {/* ── Timeline Detail Modal ──────────────────────────────── */}
            {showTimelineDetail && selectedEvent && (
                <div className="sc-modal-wrap">
                    <div className="sc-modal-backdrop" onClick={() => setShowTimelineDetail(false)} />
                    <div className="sc-modal-card sc-timeline-modal">
                        <div className="sc-modal-stack">
                            <div className="sc-modal-head">
                                <div
                                    className="sc-timeline-modal-dot"
                                    style={{ backgroundColor: getLangColor(selectedEvent.language_id) }}
                                />
                                <h3 className="sc-modal-title">Snapshot Detail</h3>
                                <p className="sc-modal-sub">
                                    {new Date(selectedEvent.timestamp).toLocaleString()}
                                </p>
                            </div>

                            <div className="sc-timeline-detail-grid">
                                <div className="sc-detail-row">
                                    <span className="sc-detail-label">File</span>
                                    <span className="sc-detail-value">{selectedEvent.active_file}</span>
                                </div>
                                <div className="sc-detail-row">
                                    <span className="sc-detail-label">Language</span>
                                    <span className="sc-detail-value">
                                        <span className="sc-legend-dot" style={{ backgroundColor: getLangColor(selectedEvent.language_id) }} />
                                        {getLangLabel(selectedEvent.language_id)}
                                    </span>
                                </div>
                                <div className="sc-detail-row">
                                    <span className="sc-detail-label">Branch</span>
                                    <span className="sc-detail-value sc-branch-tag">{selectedEvent.git_branch || 'N/A'}</span>
                                </div>
                                <div className="sc-detail-row">
                                    <span className="sc-detail-label">AI Summary</span>
                                    <span className="sc-detail-value">{selectedEvent.summary || 'No summary available.'}</span>
                                </div>
                                {selectedEvent.entities?.length > 0 && (
                                    <div className="sc-detail-row">
                                        <span className="sc-detail-label">Entities</span>
                                        <span className="sc-detail-value sc-entities">
                                            {selectedEvent.entities.map((e, i) => (
                                                <span key={i} className="sc-entity-chip">{e}</span>
                                            ))}
                                        </span>
                                    </div>
                                )}
                            </div>

                            <button 
                                onClick={() => setShowTimelineDetail(false)}
                                className="btn-primary sc-modal-close"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── MCP Key Modal ──────────────────────────────────────── */}
            {showModal && (
                <div className="sc-modal-wrap">
                    <div className="sc-modal-backdrop" onClick={() => setShowModal(false)} />
                    <div className="sc-modal-card">
                        <div className="sc-modal-stack">
                            <div className="sc-modal-head">
                                <div className="sc-modal-emoji"><MonoIcon kind="key" /></div>
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
                                    <MonoIcon kind="copy" />
                                </button>
                            </div>

                            <div className="sc-modal-warn">
                                <span><MonoIcon kind="warning" /></span>
                                <p>
                                    Warning: This key grants full access to your snapshot history. 
                                    Do not share it on public forums or commit it to GitHub.
                                </p>
                            </div>

                            <button 
                                onClick={() => setShowModal(false)}
                                className="btn-primary sc-modal-close"
                            >
                                Got it
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Timeline + Tour Styles ──────────────────────────────── */}
            <style jsx>{`
                .sc-timeline-section {
                    margin: 2rem 0;
                    padding: 1.5rem;
                    background: rgba(255,255,255,0.03);
                    border: 1px solid rgba(255,255,255,0.06);
                    border-radius: 12px;
                }
                .sc-timeline-track {
                    position: relative;
                    height: 60px;
                    margin: 1.5rem 20px 0.5rem;
                }
                .sc-timeline-line {
                    position: absolute;
                    top: 50%;
                    left: 0;
                    right: 0;
                    height: 2px;
                    background: linear-gradient(90deg, rgba(255,255,255,0.05), rgba(255,255,255,0.15), rgba(255,255,255,0.05));
                    transform: translateY(-50%);
                }
                .sc-timeline-dot {
                    position: absolute;
                    top: 50%;
                    width: 14px;
                    height: 14px;
                    border-radius: 50%;
                    border: 2px solid rgba(255,255,255,0.2);
                    transform: translate(-50%, -50%);
                    cursor: pointer;
                    transition: all 0.2s ease;
                    z-index: 2;
                    padding: 0;
                }
                .sc-timeline-dot:hover {
                    transform: translate(-50%, -50%) scale(1.6);
                    border-color: rgba(255,255,255,0.6);
                    z-index: 10;
                }
                .sc-timeline-labels {
                    display: flex;
                    justify-content: space-between;
                    padding: 0 16px;
                    font-size: 0.7rem;
                    color: rgba(255,255,255,0.35);
                    font-family: 'JetBrains Mono', monospace;
                }
                .sc-timeline-legend {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 12px;
                    margin-top: 1rem;
                    padding-top: 0.75rem;
                    border-top: 1px solid rgba(255,255,255,0.05);
                }
                .sc-legend-item {
                    display: flex;
                    align-items: center;
                    gap: 5px;
                    font-size: 0.72rem;
                    color: rgba(255,255,255,0.5);
                    font-family: 'JetBrains Mono', monospace;
                }
                .sc-legend-dot {
                    display: inline-block;
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    flex-shrink: 0;
                }
                .sc-timeline-empty {
                    text-align: center;
                    padding: 2rem;
                    color: rgba(255,255,255,0.3);
                    font-size: 0.85rem;
                }
                /* Timeline detail modal */
                .sc-timeline-modal {
                    max-width: 480px;
                }
                .sc-timeline-modal-dot {
                    width: 20px;
                    height: 20px;
                    border-radius: 50%;
                    margin-bottom: 8px;
                    box-shadow: 0 0 12px currentColor;
                }
                .sc-timeline-detail-grid {
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    padding: 0.75rem 0;
                }
                .sc-detail-row {
                    display: flex;
                    gap: 12px;
                    align-items: flex-start;
                }
                .sc-detail-label {
                    flex-shrink: 0;
                    width: 80px;
                    font-size: 0.7rem;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    color: rgba(255,255,255,0.4);
                    padding-top: 2px;
                }
                .sc-detail-value {
                    font-size: 0.82rem;
                    color: rgba(255,255,255,0.85);
                    word-break: break-all;
                    display: flex;
                    align-items: center;
                    gap: 5px;
                    flex-wrap: wrap;
                }
                .sc-branch-tag {
                    background: rgba(255,255,255,0.08);
                    padding: 2px 8px;
                    border-radius: 4px;
                    font-family: 'JetBrains Mono', monospace;
                    font-size: 0.75rem;
                }
                .sc-entities {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 4px;
                }
                .sc-entity-chip {
                    background: rgba(0, 255, 200, 0.1);
                    border: 1px solid rgba(0, 255, 200, 0.2);
                    padding: 1px 7px;
                    border-radius: 4px;
                    font-size: 0.7rem;
                    color: rgba(0, 255, 200, 0.8);
                    font-family: 'JetBrains Mono', monospace;
                }
            `}</style>
        </div>
    );
}

function MonoIcon({ kind }: { kind: 'storage' | 'workspace' | 'connection' | 'key' | 'copy' | 'warning' }) {
    const baseProps = {
        width: 16,
        height: 16,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinecap: 'round' as const,
        strokeLinejoin: 'round' as const,
        'aria-hidden': true,
    };

    if (kind === 'storage') {
        return (
            <svg {...baseProps}><ellipse cx="8" cy="3.5" rx="5.5" ry="2.2" /><path d="M2.5 3.5v6.2c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2V3.5" /><path d="M2.5 6.6c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2" /></svg>
        );
    }
    if (kind === 'workspace') {
        return (
            <svg {...baseProps}><rect x="2.3" y="3" width="11.4" height="10" rx="1.4" /><path d="M2.3 6.2h11.4" /><path d="M5 9h2.5" /></svg>
        );
    }
    if (kind === 'connection') {
        return (
            <svg {...baseProps}><path d="M5.1 4.4h2.2a2 2 0 0 1 0 4H5.1" /><path d="M10.9 11.6H8.7a2 2 0 1 1 0-4h2.2" /><path d="M6.3 8h3.4" /></svg>
        );
    }
    if (kind === 'key') {
        return (
            <svg {...baseProps}><circle cx="5.4" cy="8" r="2.3" /><path d="M7.7 8h5.8" /><path d="M11.2 8v2" /><path d="M13 8v1.2" /></svg>
        );
    }
    if (kind === 'copy') {
        return (
            <svg {...baseProps}><rect x="5" y="4" width="8" height="9" rx="1" /><path d="M3 10V3.8A.8.8 0 0 1 3.8 3H10" /></svg>
        );
    }
    return (
        <svg {...baseProps}><path d="M8 2.2 13.3 12H2.7L8 2.2Z" /><path d="M8 6v2.8" /><circle cx="8" cy="10.7" r=".7" fill="currentColor" stroke="none" /></svg>
    );
}

function StatCard({ title, value, subtitle, icon }: { title: string, value: string, subtitle: string, icon: 'storage' | 'workspace' | 'connection' }) {
    return (
        <div className="sc-stat-card">
            <div className="sc-stat-head">
                <span className="sc-stat-title">{title}</span>
                <span className="sc-icon-cell"><MonoIcon kind={icon} /></span>
            </div>
            <div>
                <div className="sc-stat-value">{value}</div>
                <div className="sc-stat-sub">{subtitle}</div>
            </div>
        </div>
    );
}

