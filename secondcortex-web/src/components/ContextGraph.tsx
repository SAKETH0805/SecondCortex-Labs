'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    useNodesState,
    useEdgesState,
    addEdge,
    type Node,
    type Edge,
    type Connection,
    MarkerType,
    BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import * as d3 from 'd3-force';

type VsCodeApi = {
    postMessage: (message: unknown) => void;
};

declare global {
    interface Window {
        acquireVsCodeApi?: () => VsCodeApi;
    }
}

interface SnapshotEvent {
    id: string;
    timestamp: string;
    active_file: string;
    git_branch: string | null;
    summary: string;
    entities: string[];
    relations: Array<{ source: string; target: string; relation: string }>;
}

const NODE_STYLES: Record<string, React.CSSProperties> = {
    commit: {
        background: '#667eea',
        color: '#fff',
        border: '1px solid rgba(255,255,255,0.2)',
        borderRadius: '12px',
        padding: '12px 18px',
        fontSize: '13px',
        fontWeight: 600,
        textWrap: 'balance',
    },
    file: {
        background: '#f5576c',
        color: '#fff',
        border: '1px solid rgba(255,255,255,0.2)',
        borderRadius: '10px',
        padding: '12px 16px',
        fontSize: '13px',
        fontWeight: 600,
        textWrap: 'balance',
    },
    entity: {
        background: '#0f172a',
        color: '#38bdf8',
        border: '1px solid rgba(56, 189, 248, 0.4)',
        borderRadius: '8px',
        padding: '8px 14px',
        fontSize: '12px',
        fontWeight: 500,
        textWrap: 'balance',
    },
    reasoning: {
        background: '#10b981',
        color: '#ecfdf5',
        border: '1px solid rgba(255,255,255,0.3)',
        borderRadius: '16px',
        padding: '16px 20px',
        fontSize: '14px',
        fontWeight: 600,
        textWrap: 'balance',
        maxWidth: 280,
    },
};

interface ContextGraphProps {
    backendUrl?: string;
    pollIntervalMs?: number;
    token?: string;
    onUnauthorized?: () => void;
}

export default function ContextGraph({
    backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://sc-backend-suhaan.azurewebsites.net',
    pollIntervalMs = 5000,
    token = '',
    onUnauthorized,
}: ContextGraphProps) {
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [isConnected, setIsConnected] = useState(false);
    const [timeline, setTimeline] = useState<SnapshotEvent[]>([]);
    const [selectedIndex, setSelectedIndex] = useState<number>(0);
    const [isPinnedInPast, setIsPinnedInPast] = useState(false);
    const [lastEvent, setLastEvent] = useState<string>('Waiting for snapshots...');
    const vscodeApiRef = useRef<VsCodeApi | null>(null);
    const simulationRef = useRef<d3.Simulation<any, any> | null>(null);

    const onConnect = useCallback(
        (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
        [setEdges]
    );

    const selectedSnapshot = timeline[selectedIndex];

    const recentFileList = useMemo(() => {
        const files = new Set<string>();
        timeline.slice(0, selectedIndex + 1).forEach((snapshot) => {
            if (snapshot.active_file) {
                files.add(snapshot.active_file);
            }
        });
        return Array.from(files).slice(-8).reverse();
    }, [timeline, selectedIndex]);

    const recentSummaries = useMemo(() => {
        return timeline
            .slice(Math.max(0, selectedIndex - 4), selectedIndex + 1)
            .map((snapshot) => ({
                id: snapshot.id,
                summary: snapshot.summary || 'No summary',
                time: new Date(snapshot.timestamp).toLocaleTimeString(),
            }))
            .reverse();
    }, [timeline, selectedIndex]);

    useEffect(() => {
        if (typeof window !== 'undefined' && window.acquireVsCodeApi) {
            vscodeApiRef.current = window.acquireVsCodeApi();
        }
    }, []);

    const postToHost = useCallback((payload: Record<string, unknown>) => {
        const envelope = { source: 'secondcortex-shadow-graph', ...payload };
        try {
            vscodeApiRef.current?.postMessage(envelope);
        } catch {
            // Browser mode: no VS Code bridge available.
        }

        if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
            window.parent.postMessage(envelope, '*');
        }
    }, []);

    const handlePreviewSelection = useCallback((index: number) => {
        const snapshot = timeline[index];
        if (!snapshot) {
            return;
        }

        setSelectedIndex(index);
        setIsPinnedInPast(index < timeline.length - 1);
        setLastEvent(`${new Date(snapshot.timestamp).toLocaleTimeString()} - ${snapshot.summary || snapshot.active_file}`);
        postToHost({ type: 'previewSnapshot', snapshotId: snapshot.id });
    }, [timeline, postToHost]);

    const handleRestore = useCallback(() => {
        if (!selectedSnapshot) {
            return;
        }
        postToHost({ type: 'restoreSnapshot', snapshotId: selectedSnapshot.id, target: selectedSnapshot.id });
    }, [postToHost, selectedSnapshot]);

    const buildGraphForSnapshot = useCallback((snapshot: SnapshotEvent | undefined): { nodes: Node[]; edges: Edge[] } => {
        if (!snapshot) {
            return { nodes: [], edges: [] };
        }

        const outNodes: Node[] = [];
        const outEdges: Edge[] = [];

        const activeFile = snapshot.active_file || 'unknown';
        const fileName = activeFile.split(/[/\\]/).pop() ?? activeFile;
        const fileNodeId = `file-${snapshot.id}`;

        outNodes.push({
            id: fileNodeId,
            data: { label: `File: ${fileName}` },
            position: { x: 0, y: 0 },
            style: NODE_STYLES.file,
        });

        if (snapshot.git_branch) {
            const branchNodeId = `branch-${snapshot.id}`;
            outNodes.push({
                id: branchNodeId,
                data: { label: `Branch: ${snapshot.git_branch}` },
                position: { x: -260, y: -80 },
                style: NODE_STYLES.commit,
            });

            outEdges.push({
                id: `e-${branchNodeId}-${fileNodeId}`,
                source: branchNodeId,
                target: fileNodeId,
                animated: true,
                markerEnd: { type: MarkerType.ArrowClosed },
                style: { stroke: 'rgba(102, 126, 234, 0.8)', strokeWidth: 2 },
            });
        }

        snapshot.entities.slice(0, 8).forEach((entity, idx) => {
            const entityNodeId = `entity-${snapshot.id}-${entity}`;
            outNodes.push({
                id: entityNodeId,
                data: { label: `Entity: ${entity}` },
                position: { x: 260, y: -180 + idx * 52 },
                style: NODE_STYLES.entity,
            });

            outEdges.push({
                id: `e-${fileNodeId}-${entityNodeId}`,
                source: fileNodeId,
                target: entityNodeId,
                style: { stroke: 'rgba(56, 189, 248, 0.5)', strokeDasharray: '4,6', strokeWidth: 1.5 },
            });
        });

        if (snapshot.summary) {
            const reasoningNodeId = `reason-${snapshot.id}`;
            outNodes.push({
                id: reasoningNodeId,
                data: { label: snapshot.summary },
                position: { x: 0, y: 220 },
                style: NODE_STYLES.reasoning,
            });

            outEdges.push({
                id: `e-${fileNodeId}-${reasoningNodeId}`,
                source: fileNodeId,
                target: reasoningNodeId,
                animated: true,
                style: { stroke: '#10b981', strokeWidth: 2.5 },
                markerEnd: { type: MarkerType.ArrowClosed },
            });
        }

        return { nodes: outNodes, edges: outEdges };
    }, []);

    useEffect(() => {
        if (nodes.length === 0) return;

        const simNodes = nodes.map((n) => ({ ...n, x: n.position.x, y: n.position.y }));
        const nodeIds = new Set(simNodes.map(n => n.id));
        const simLinks = edges
            .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
            .map((e) => ({ source: e.source, target: e.target, id: e.id }));

        const simulation = d3.forceSimulation(simNodes)
            .force('charge', d3.forceManyBody().strength(-400).distanceMax(800))
            .force('link', d3.forceLink(simLinks).id((d: any) => d.id).distance(160).strength(0.4))
            .force('center', d3.forceCenter(0, 0).strength(0.02))
            .force('collide', d3.forceCollide().radius((d: any) => {
                const label = d.data?.label || '';
                return Math.max(90, label.length * 6);
            }).iterations(4))
            .alpha(0.3)
            .alphaDecay(0.04)
            .restart();

        simulation.on('tick', () => {
            setNodes((currentNodes) =>
                currentNodes.map((n) => {
                    const simNode = simNodes.find((sn) => sn.id === n.id);
                    if (simNode) {
                        return {
                            ...n,
                            position: { x: simNode.x ?? 0, y: simNode.y ?? 0 },
                        };
                    }
                    return n;
                })
            );
        });

        simulationRef.current = simulation;

        return () => {
            simulation.stop();
        };
    }, [nodes.length, edges.length, setNodes]);

    useEffect(() => {
        let active = true;

        const poll = async () => {
            try {
                const headers: Record<string, string> = {};
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                }
                const res = await fetch(`${backendUrl}/api/v1/snapshots/timeline?limit=300`, { headers });

                if (res.status === 401 || res.status === 403) {
                    setIsConnected(false);
                    if (onUnauthorized) onUnauthorized();
                    return;
                }

                if (res.ok) {
                    setIsConnected(true);
                    const data = await res.json();
                    if (Array.isArray(data.timeline)) {
                        const nextTimeline = data.timeline as SnapshotEvent[];
                        setTimeline((current) => {
                            const currentIds = new Set(current.map((s) => s.id));
                            const merged = [...current];
                            nextTimeline.forEach((snapshot) => {
                                if (!currentIds.has(snapshot.id)) {
                                    merged.push(snapshot);
                                }
                            });
                            merged.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

                            if (merged.length > 0) {
                                setSelectedIndex((prevIndex) => {
                                    if (!isPinnedInPast) {
                                        return merged.length - 1;
                                    }
                                    return Math.min(prevIndex, merged.length - 1);
                                });
                            }

                            return merged;
                        });
                    }
                } else {
                    setIsConnected(false);
                }
            } catch {
                setIsConnected(false);
            }
        };

        const interval = setInterval(() => {
            if (active) poll();
        }, pollIntervalMs);

        poll();

        return () => {
            active = false;
            clearInterval(interval);
        };
    }, [backendUrl, pollIntervalMs, token, onUnauthorized, isPinnedInPast]);

    useEffect(() => {
        const graph = buildGraphForSnapshot(selectedSnapshot);
        setNodes(graph.nodes);
        setEdges(graph.edges);
    }, [selectedSnapshot, buildGraphForSnapshot, setNodes, setEdges]);

    const selectedAgeLabel = selectedSnapshot
        ? (() => {
            const now = Date.now();
            const then = new Date(selectedSnapshot.timestamp).getTime();
            const mins = Math.max(0, Math.round((now - then) / 60000));
            if (mins < 1) return 'just now';
            if (mins < 60) return `${mins}m ago`;
            const hours = Math.floor(mins / 60);
            const remMins = mins % 60;
            return remMins ? `${hours}h ${remMins}m ago` : `${hours}h ago`;
        })()
        : 'n/a';

    return (
        <div style={{ width: '100%', height: '100vh', background: '#020617' }}>
            <div
                style={{
                    position: 'absolute',
                    top: 24,
                    left: 24,
                    zIndex: 10,
                    display: 'flex',
                    gap: 16,
                    alignItems: 'center',
                }}
            >
                <div
                    style={{
                        background: 'rgba(15, 23, 42, 0.95)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: 16,
                        padding: '12px 20px',
                        color: '#f8fafc',
                        fontSize: 14,
                        fontWeight: 500,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                    }}
                >
                    <span
                        style={{
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            background: isConnected ? '#10b981' : '#ef4444',
                        }}
                    />
                    {isConnected ? 'Timeline Sync Active' : 'Offline'}
                </div>

                <div
                    style={{
                        background: 'rgba(15, 23, 42, 0.95)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: 16,
                        padding: '12px 24px',
                        color: '#cbd5e1',
                        fontSize: 14,
                        maxWidth: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {selectedSnapshot ? `${selectedAgeLabel} | ${lastEvent}` : 'No snapshots captured yet'}
                </div>
            </div>

            <div
                style={{
                    position: 'absolute',
                    top: 24,
                    right: 24,
                    zIndex: 10,
                    background: 'rgba(15, 23, 42, 0.95)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 16,
                    padding: '16px 24px',
                    color: '#fff',
                    fontSize: 20,
                    fontWeight: 700,
                    letterSpacing: '-0.02em',
                }}
            >
                SecondCortex <span style={{ opacity: 0.3, fontWeight: 400 }}>| Shadow Graph Time-Travel</span>
            </div>

            <div
                style={{
                    position: 'absolute',
                    left: 24,
                    right: 24,
                    bottom: 24,
                    zIndex: 20,
                    background: 'rgba(15, 23, 42, 0.92)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 16,
                    padding: 14,
                    backdropFilter: 'blur(14px)',
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                    <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>
                        Snapshot Slider ({timeline.length} snapshots)
                    </div>
                    <button
                        onClick={handleRestore}
                        disabled={!selectedSnapshot}
                        style={{
                            border: '1px solid rgba(16,185,129,0.5)',
                            color: '#34d399',
                            background: 'rgba(16,185,129,0.12)',
                            borderRadius: 8,
                            padding: '8px 14px',
                            fontSize: 12,
                            fontWeight: 700,
                            letterSpacing: '0.02em',
                            cursor: selectedSnapshot ? 'pointer' : 'not-allowed',
                            opacity: selectedSnapshot ? 1 : 0.5,
                        }}
                    >
                        Restore
                    </button>
                </div>

                <input
                    type="range"
                    min={0}
                    max={Math.max(0, timeline.length - 1)}
                    value={Math.min(selectedIndex, Math.max(0, timeline.length - 1))}
                    onChange={(e) => {
                        const idx = Number(e.target.value);
                        handlePreviewSelection(idx);
                    }}
                    style={{ width: '100%' }}
                    disabled={timeline.length === 0}
                />

                <div style={{ display: 'flex', gap: 6, marginTop: 8, overflowX: 'auto', paddingBottom: 2 }}>
                    {timeline.map((snapshot, idx) => (
                        <button
                            key={snapshot.id}
                            onClick={() => handlePreviewSelection(idx)}
                            title={new Date(snapshot.timestamp).toLocaleString()}
                            style={{
                                width: 10,
                                height: 10,
                                borderRadius: '50%',
                                border: 'none',
                                flex: '0 0 auto',
                                cursor: 'pointer',
                                background: idx === selectedIndex ? '#f59e0b' : 'rgba(148,163,184,0.55)',
                                boxShadow: idx === selectedIndex ? '0 0 0 3px rgba(245,158,11,0.25)' : 'none',
                            }}
                        />
                    ))}
                </div>

                <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div style={{ background: 'rgba(15,23,42,0.66)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: 10 }}>
                        <div style={{ fontSize: 12, color: '#93c5fd', marginBottom: 6, fontWeight: 700 }}>Files At This Point</div>
                        {recentFileList.length === 0 ? (
                            <div style={{ fontSize: 12, color: '#94a3b8' }}>No files yet</div>
                        ) : (
                            recentFileList.map((file) => (
                                <div key={file} style={{ fontSize: 12, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {file}
                                </div>
                            ))
                        )}
                    </div>

                    <div style={{ background: 'rgba(15,23,42,0.66)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: 10 }}>
                        <div style={{ fontSize: 12, color: '#86efac', marginBottom: 6, fontWeight: 700 }}>Recent Summaries</div>
                        {recentSummaries.length === 0 ? (
                            <div style={{ fontSize: 12, color: '#94a3b8' }}>No summary timeline</div>
                        ) : (
                            recentSummaries.map((item) => (
                                <div key={item.id} style={{ marginBottom: 5 }}>
                                    <div style={{ fontSize: 10, color: '#94a3b8' }}>{item.time}</div>
                                    <div style={{ fontSize: 12, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.summary}</div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                minZoom={0.05}
                maxZoom={2}
                style={{ background: '#020617' }}
            >
                <Background color="#1e293b" gap={24} size={1} variant={BackgroundVariant.Dots} />
                <Controls
                    style={{
                        background: 'rgba(15, 23, 42, 0.6)',
                        backdropFilter: 'blur(12px)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 12,
                        padding: 4,
                        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                    }}
                />
                <MiniMap
                    nodeColor={(node) => {
                        if (node.id.startsWith('reason')) return '#10b981';
                        if (node.id.startsWith('file')) return '#f5576c';
                        if (node.id.startsWith('branch')) return '#667eea';
                        return '#4facfe';
                    }}
                    maskColor="rgba(2, 6, 23, 0.85)"
                    style={{
                        background: 'rgba(15, 23, 42, 0.6)',
                        backdropFilter: 'blur(12px)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 16,
                        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                    }}
                />
            </ReactFlow>

            <style>{`
                :root {
                    color-scheme: dark;
                }
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

                body {
                    margin: 0;
                    padding: 0;
                    background: #020617;
                    color: #f8fafc;
                    overflow: hidden;
                    font-family: 'Inter', system-ui, -apple-system, sans-serif;
                }

                .react-flow__controls-button {
                    background: transparent !important;
                    border-bottom: 1px solid rgba(255,255,255,0.1) !important;
                    fill: #f8fafc !important;
                    transition: background 0.2s ease;
                }
                .react-flow__controls-button:hover {
                    background: rgba(255,255,255,0.1) !important;
                }
                .react-flow__controls-button:last-child {
                    border-bottom: none !important;
                }
            `}</style>
        </div>
    );
}
