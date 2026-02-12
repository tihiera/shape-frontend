"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { uploadMesh, getChatHistory, getSegments } from "@/lib/api";
import { useShapeSocket, type PipelinePhase } from "@/lib/useShapeSocket";
import {
  ArrowUp,
  Upload,
  X,
  Check,
  Plus,
  MessageSquare,
  Box,
  Loader2,
  ZoomIn,
  ZoomOut,
  Maximize,
  Minimize,
  RotateCcw,
  RotateCw,
  Download,
  FileBox,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import { SEGMENT_COLORS, type MeshViewerHandle } from "@/components/meshConstants";

const MeshViewer = dynamic(() => import("@/components/MeshViewer"), { ssr: false });

/* ── Sample meshes available in /public/meshes ── */

const SAMPLE_MESHES = [
  { name: "Simple Bend",     file: "simple_bend.msh",     desc: "A single smooth bend" },
  { name: "S-Curve",         file: "s_curve.msh",         desc: "S-shaped pipe curve" },
  { name: "U-Bend",          file: "u_bend.msh",          desc: "U-shaped return bend" },
  { name: "T-Junction",      file: "t_junction.msh",      desc: "Three-way junction" },
  { name: "Complex Network", file: "complex_network.msh", desc: "Multi-branch pipe network" },
];

/* ── Chat message types ── */

interface ChatMessage {
  role: "user" | "assistant" | "system";
  text: string;
}

/* ── Pipeline phase → human label ── */

function phaseLabel(phase: PipelinePhase): string {
  const map: Record<string, string> = {
    connecting: "Connecting…",
    connected: "Connected",
    segmenting: "Segmenting mesh…",
    segmented: "Segments found",
    downsampling: "Downsampling…",
    downsampled: "Downsampled",
    embedding: "Computing embeddings…",
    embedded: "Embeddings ready",
    stored: "Saving results…",
    segment_done: "Segmentation complete",
    parsing_query: "Understanding question…",
    tool_call: "Running analysis…",
    query_done: "Done",
  };
  return map[phase] || "";
}

function isProcessing(phase: PipelinePhase): boolean {
  return [
    "connecting", "segmenting", "segmented", "downsampling",
    "downsampled", "embedding", "embedded", "stored",
    "parsing_query", "tool_call",
  ].includes(phase);
}

/* ── Color dot for segment type ── */
function segColorStyle(type: string) {
  const c = SEGMENT_COLORS[type];
  if (!c) return {};
  return { backgroundColor: `rgb(${c[0]}, ${c[1]}, ${c[2]})` };
}

export default function DashboardPage() {
  const { uid, email, sessions, loading, logout, addSession } = useAuth();
  const router = useRouter();

  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  // Modal
  const [showNewModal, setShowNewModal] = useState(false);
  const [modalFile, setModalFile] = useState<File | null>(null);
  const [modalPrompt, setModalPrompt] = useState("");
  const [modalDragging, setModalDragging] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pendingPromptRef = useRef<string | null>(null);
  const needsSegmentationRef = useRef(false); // true only for newly created sessions
  const [highlightIds, setHighlightIds] = useState<number[]>([]);

  // Smooth transition: wait a frame after session change before showing content
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);

  // Sample meshes floating panel
  const [showSamplePanel, setShowSamplePanel] = useState(true);

  // Viewer controls
  const [meshOpacity, setMeshOpacity] = useState(0.4);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const meshViewerRef = useRef<MeshViewerHandle>(null);

  // WebSocket
  const {
    connect, disconnect, triggerSegmentation, sendQuery,
    phase, setPhase, progressText, segmentResult, setSegmentResult,
    queryResult, queryResultVersion,
    error: wsError, isConnected,
  } = useShapeSocket();

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 50);
  }, []);

  /* ── Effects ── */

  // Smooth session transition — delay content until layout is painted
  useEffect(() => {
    if (!activeSession) {
      setSessionReady(false);
      return;
    }
    setSessionReady(false);
    const raf = requestAnimationFrame(() => {
      setSessionReady(true);
    });
    return () => cancelAnimationFrame(raf);
  }, [activeSession]);

  // Track whether the segment_done came from a fresh WS segmentation (not REST restore)
  const freshSegmentationRef = useRef(false);

  useEffect(() => {
    if (phase === "segment_done" && segmentResult && freshSegmentationRef.current) {
      freshSegmentationRef.current = false;
      const summary = segmentResult.summary;
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          text: `Segmentation complete — ${summary.total_segments} segments found (${Object.entries(summary.counts_by_type).map(([t, c]) => `${c} ${t}`).join(", ")}).`,
        },
      ]);
      scrollToBottom();
      const prompt = pendingPromptRef.current?.trim() || "describe this geometry";
      pendingPromptRef.current = null;
      setMessages((prev) => [...prev, { role: "user", text: prompt }]);
      scrollToBottom();
      sendQuery(prompt);
    }
  }, [phase, segmentResult, sendQuery, scrollToBottom]);

  useEffect(() => {
    if (queryResult) {
      setMessages((prev) => [...prev, { role: "assistant", text: queryResult.answer }]);
      if (queryResult.highlight_ids?.length) setHighlightIds(queryResult.highlight_ids);
      scrollToBottom();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryResultVersion]);

  useEffect(() => {
    if (wsError) {
      setMessages((prev) => [...prev, { role: "system", text: `Error: ${wsError}` }]);
      scrollToBottom();
    }
  }, [wsError, scrollToBottom]);

  useEffect(() => {
    if (phase === "connected" && activeSession && needsSegmentationRef.current) {
      needsSegmentationRef.current = false;
      freshSegmentationRef.current = true; // this is a new segmentation → auto-describe after
      triggerSegmentation();
    }
  }, [phase, activeSession, triggerSegmentation]);

  // Fullscreen change listener
  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  /* ── Loading ── */
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#FDFDFB] font-sans">
        <Loader2 size={20} className="animate-spin text-black/40" />
      </div>
    );
  }
  if (!uid) {
    router.replace("/login");
    return null;
  }

  const hasSessions = sessions.length > 0;
  const processing = isProcessing(phase);

  /* ── Handlers ── */

  function handleSendMessage() {
    const text = chatInput.trim();
    if (!text || !activeSession || processing) return;
    setMessages((prev) => [...prev, { role: "user", text }]);
    setChatInput("");
    scrollToBottom();
    sendQuery(text);
    // Keep focus on the input so the user can follow up immediately
    setTimeout(() => chatInputRef.current?.focus(), 0);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
  }

  async function handleCreateInteraction() {
    if (!modalFile || !uid) return;
    setModalLoading(true);
    setModalError("");
    try {
      const data = await uploadMesh(uid, modalFile);
      const sid = data.session.session_id;
      addSession(sid); // add to history sidebar immediately
      pendingPromptRef.current = modalPrompt || null;
      needsSegmentationRef.current = true; // new session → trigger segmentation on WS connect
      setActiveSession(sid);
      setMessages([{
        role: "system",
        text: `Uploaded ${modalFile.name} — ${data.ingest.num_nodes} nodes, ${data.ingest.num_edges} edges (${data.ingest.file_type})`,
      }]);
      setShowNewModal(false);
      setModalFile(null);
      setModalPrompt("");
      connect(uid, sid);
    } catch {
      setModalError("Failed to upload. Please try again.");
    } finally {
      setModalLoading(false);
    }
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setModalDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) setModalFile(file);
  }

  function closeModal() {
    setShowNewModal(false);
    setModalFile(null);
    setModalPrompt("");
    setModalError("");
  }

  /** Load a sample mesh from /public/meshes/ and set it as the modal file */
  async function handlePickSample(sample: typeof SAMPLE_MESHES[number]) {
    try {
      const res = await fetch(`/meshes/${sample.file}`);
      const blob = await res.blob();
      const file = new File([blob], sample.file, { type: "application/octet-stream" });
      setModalFile(file);
      if (!showNewModal) setShowNewModal(true);
    } catch {
      console.error("Failed to load sample mesh");
    }
  }

  async function handleSelectSession(sid: string) {
    if (sid === activeSession) return;
    disconnect();
    setActiveSession(sid);
    setMessages([]);
    setHighlightIds([]);
    setSegmentResult(null);
    setSessionLoading(true);

    if (!uid) return;

    // Connect WS first (for follow-up queries), then load saved data
    connect(uid, sid);

    // Load previous chat history + segments in parallel
    try {
      const [chatHistory, segments] = await Promise.all([
        getChatHistory(uid, sid).catch(() => []),
        getSegments(uid, sid).catch(() => null),
      ]);

      // Restore chat messages
      if (chatHistory.length > 0) {
        const restored: ChatMessage[] = chatHistory.map((msg) => ({
          role: msg.role === "user" ? "user" : "assistant",
          text: msg.content,
        }));
        setMessages(restored);
        scrollToBottom();
      }

      // Restore segment results — this sets the controls bar + 3D viewer coloring
      if (segments) {
        setSegmentResult(segments);
        setPhase("segment_done");
      }
    } catch (err) {
      console.warn("[Dashboard] failed to load session data:", err);
    } finally {
      setSessionLoading(false);
    }
  }

  function toggleFullscreen() {
    if (!viewerContainerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      viewerContainerRef.current.requestFullscreen();
    }
  }

  return (
    <div className="flex h-screen flex-col bg-[#FDFDFB] font-sans text-[#111]">
      {/* ── Top bar ── */}
      <header className="flex h-13 shrink-0 items-center justify-between border-b border-black/8 px-6">
        <div className="flex items-center gap-3">
          <a href="/" className="text-[15px] font-bold tracking-widest text-black/85 uppercase transition-colors hover:text-black">
            shape
          </a>
          {activeSession && (
            <>
              <span className="text-black/20">/</span>
              <span className="rounded-md bg-black/4 px-2.5 py-1 text-[13px] font-mono font-medium text-black/50">
                {activeSession.slice(0, 8)}
              </span>
              <span
                className={`h-2 w-2 rounded-full ${isConnected ? "bg-green-500" : "bg-black/15"}`}
                title={isConnected ? "Connected" : "Disconnected"}
              />
            </>
          )}
        </div>
        <div className="flex items-center gap-5">
          <span className="text-[13px] font-medium text-black/40">
            {email && email.length > 20 ? `${email.slice(0, 8)}…${email.slice(email.indexOf("@"))}` : email}
          </span>
          <button onClick={logout} className="text-[13px] font-medium text-black/35 transition-colors hover:text-black/70">
            Sign out
          </button>
        </div>
      </header>

      {/* ── Main workspace ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar: History */}
        <aside className="flex w-72 shrink-0 flex-col border-r border-black/8 bg-[#F7F7F5]">
          <div className="flex items-center justify-between px-5 py-4">
            <h2 className="text-[13px] font-semibold tracking-wide text-black/50 uppercase">History</h2>
            <button
              onClick={() => setShowNewModal(true)}
              className="flex items-center gap-1.5 rounded-lg bg-black/5 px-3 py-1.5 text-[13px] font-semibold text-black/60 transition-colors hover:bg-black/10 hover:text-black/80"
            >
              <Plus size={14} strokeWidth={2.5} />
              Explore
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-3">
            {hasSessions ? (
              <ul className="space-y-1">
                {sessions.map((sid) => (
                  <li key={sid}>
                    <button
                      onClick={() => handleSelectSession(sid)}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-3.5 py-3 text-left transition-colors ${
                        activeSession === sid ? "bg-black/8 text-black/85" : "text-black/50 hover:bg-black/4 hover:text-black/70"
                      }`}
                    >
                      <MessageSquare size={15} strokeWidth={1.8} className="shrink-0 opacity-50" />
                      <span className="block truncate text-[13px] font-semibold">Interaction {sid.slice(0, 8)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <Upload size={32} strokeWidth={1.3} className="mb-4 text-black/15" />
                <p className="text-[14px] font-semibold text-black/30">No history yet</p>
                <p className="mt-2 text-[13px] text-black/20">
                  Click{" "}
                  <button onClick={() => setShowNewModal(true)} className="font-bold text-black/40 underline underline-offset-2 hover:text-black/60">
                    + Explore
                  </button>{" "}
                  to start
                </p>
              </div>
            )}
          </div>
        </aside>

        {/* Center: 3D Viewer */}
        <main className="flex flex-1 flex-col bg-[#FDFDFB]">
          {/* Top bar area — always reserve the h-12 space when a session is active */}
          {activeSession && (
            <div className="flex h-12 shrink-0 items-center border-b border-black/6 bg-[#F7F7F5] px-6">
              {processing ? (
                <div className="flex items-center gap-3 animate-fade-in">
                  <Loader2 size={14} className="animate-spin text-black/40" />
                  <span className="text-[13px] font-semibold text-black/50">{phaseLabel(phase)}</span>
                  {progressText && <span className="text-[13px] font-medium text-black/30">— {progressText}</span>}
                </div>
              ) : segmentResult ? (
                <div className="flex w-full items-center justify-between animate-fade-in">
                  {/* Left: segment legend */}
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-[13px] font-bold text-black/60">
                      {segmentResult.summary.total_segments} segments
                    </span>
                    {Object.entries(segmentResult.summary.counts_by_type).map(([type, count]) => (
                      <span key={type} className="flex items-center gap-1.5 text-[12px] font-semibold text-black/50">
                        <span className="inline-block h-2.5 w-2.5 rounded-full" style={segColorStyle(type)} />
                        {count} {type}
                      </span>
                    ))}
                  </div>

                  {/* Right: viewer controls */}
                  <div className="flex items-center gap-2">
                    {/* Opacity slider */}
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-black/30">Opacity</span>
                      <input
                        type="range"
                        min={0.1}
                        max={1}
                        step={0.05}
                        value={meshOpacity}
                        onChange={(e) => setMeshOpacity(parseFloat(e.target.value))}
                        className="h-1 w-20 cursor-pointer accent-black/40"
                      />
                      <span className="w-7 text-right text-[11px] font-mono text-black/30">
                        {Math.round(meshOpacity * 100)}%
                      </span>
                    </div>

                    <div className="mx-1 h-4 w-px bg-black/8" />

                    {/* Zoom controls */}
                    <button
                      onClick={() => meshViewerRef.current?.zoomIn()}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-black/35 transition-colors hover:bg-black/5 hover:text-black/60"
                      title="Zoom in"
                    >
                      <ZoomIn size={15} strokeWidth={2} />
                    </button>
                    <button
                      onClick={() => meshViewerRef.current?.zoomOut()}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-black/35 transition-colors hover:bg-black/5 hover:text-black/60"
                      title="Zoom out"
                    >
                      <ZoomOut size={15} strokeWidth={2} />
                    </button>
                    <button
                      onClick={() => meshViewerRef.current?.resetCamera()}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-black/35 transition-colors hover:bg-black/5 hover:text-black/60"
                      title="Reset view"
                    >
                      <RotateCcw size={14} strokeWidth={2} />
                    </button>

                    <div className="mx-1 h-4 w-px bg-black/8" />

                    {/* Auto-rotate toggle */}
                    <button
                      onClick={() => {
                        const newState = meshViewerRef.current?.toggleRotation();
                        if (newState !== undefined) setAutoRotate(newState);
                      }}
                      className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors ${
                        autoRotate
                          ? "bg-black/8 text-black/60"
                          : "text-black/30 hover:bg-black/5 hover:text-black/50"
                      }`}
                      title={autoRotate ? "Stop rotation" : "Start rotation"}
                    >
                      <RotateCw size={13} strokeWidth={2} className={autoRotate ? "animate-spin" : ""} style={autoRotate ? { animationDuration: "3s" } : undefined} />
                      <span>{autoRotate ? "Rotating" : "Rotate"}</span>
                    </button>

                    <div className="mx-1 h-4 w-px bg-black/8" />

                    {/* Fullscreen */}
                    <button
                      onClick={toggleFullscreen}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-black/35 transition-colors hover:bg-black/5 hover:text-black/60"
                      title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                    >
                      {isFullscreen ? <Minimize size={15} strokeWidth={2} /> : <Maximize size={15} strokeWidth={2} />}
                    </button>
                  </div>
                </div>
              ) : sessionLoading ? (
                <div className="flex items-center gap-3 animate-fade-in">
                  <Loader2 size={14} className="animate-spin text-black/30" />
                  <span className="text-[13px] font-medium text-black/25">Loading session…</span>
                </div>
              ) : (
                /* Session loaded but no segments — ready for queries */
                <span className="text-[13px] font-medium text-black/25">Ready</span>
              )}
            </div>
          )}

          {/* Viewer area */}
          <div ref={viewerContainerRef} className="relative flex flex-1 items-center justify-center overflow-hidden bg-[#F8F8F6]">
            {activeSession && uid ? (
              <div className={`h-full w-full transition-opacity duration-500 ${sessionReady ? "opacity-100" : "opacity-0"}`}>
                <MeshViewer
                  ref={meshViewerRef}
                  uid={uid}
                  sessionId={activeSession}
                  segmentResult={segmentResult}
                  highlightIds={highlightIds}
                  processing={processing}
                  opacity={meshOpacity}
                />
              </div>
            ) : (
              <div className="text-center animate-fade-in">
                <Box size={64} strokeWidth={0.8} className="mx-auto mb-5 text-black/8" />
                <p className="text-[16px] font-semibold text-black/30">Select from history or start a new exploration</p>
                <button
                  onClick={() => setShowNewModal(true)}
                  className="mt-5 rounded-full border border-black/12 px-6 py-2.5 text-[14px] font-semibold text-black/55 transition-colors hover:border-black/25 hover:text-black/80"
                >
                  + Explore
                </button>
              </div>
            )}
          </div>
        </main>

        {/* Right sidebar: Chat */}
        <aside className="flex w-96 shrink-0 flex-col border-l border-black/8 bg-[#F7F7F5]">
          <div className="flex h-12 items-center justify-between border-b border-black/8 px-5">
            <h2 className="text-[13px] font-semibold tracking-wide text-black/50 uppercase">Chat</h2>
            {processing && <Loader2 size={13} className="animate-spin text-black/30" />}
          </div>

          <div className="flex flex-1 flex-col overflow-y-auto px-4 py-4">
            {messages.length > 0 ? (
              <div className="flex flex-col gap-3">
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex animate-slide-in ${msg.role === "user" ? "justify-end" : msg.role === "system" ? "justify-center" : "justify-start"}`}
                  >
                    {msg.role === "system" ? (
                      <div className="max-w-[90%] rounded-lg bg-black/4 px-3.5 py-2 text-[13px] font-medium text-black/40">
                        {msg.text}
                      </div>
                    ) : msg.role === "user" ? (
                      <div className="max-w-[85%] rounded-2xl bg-black/7 px-4 py-3 text-[14px] font-medium leading-relaxed text-black/80">
                        {msg.text}
                      </div>
                    ) : (
                      <div className="prose-chat max-w-[85%] rounded-2xl border border-black/8 bg-white px-4 py-3">
                        <ReactMarkdown>{msg.text}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                ))}
                {(phase === "parsing_query" || phase === "tool_call") && (
                  <div className="flex justify-start">
                    <div className="flex items-center gap-2 rounded-2xl border border-black/8 bg-white px-4 py-3">
                      <Loader2 size={14} className="animate-spin text-black/30" />
                      <span className="text-[13px] font-medium text-black/35">{progressText || "Thinking…"}</span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            ) : activeSession ? (
              <div className="flex flex-1 items-center justify-center">
                <p className="px-6 text-center text-[14px] font-medium text-black/25">
                  {processing ? "Processing your mesh…" : "Ask questions about your mesh — topology, segments, structure."}
                </p>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <p className="px-6 text-center text-[14px] font-medium text-black/20">Start an exploration to chat</p>
              </div>
            )}
          </div>

          <div className="border-t border-black/8 p-4">
            <div className="flex items-center gap-2 rounded-xl border border-black/10 bg-white px-4 py-3">
              <input
                ref={chatInputRef}
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={!activeSession ? "Start an exploration first…" : processing ? "Processing…" : "Ask about your mesh…"}
                disabled={!activeSession || processing}
                className="flex-1 bg-transparent text-[14px] font-medium text-black/80 outline-none placeholder-black/30 disabled:cursor-not-allowed"
              />
              <button
                onClick={handleSendMessage}
                disabled={!activeSession || !chatInput.trim() || processing}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/6 text-black/30 transition-colors hover:bg-black/12 hover:text-black/60 disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ArrowUp size={16} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* ── Floating Sample Meshes Panel (bottom-left) ── */}
      <div className="fixed bottom-5 left-4 z-40 w-62 animate-float-in">
        <div className="overflow-hidden rounded-2xl border border-black/8 bg-white/95 shadow-lg backdrop-blur-md">
          {/* Header — always visible, acts as toggle */}
          <button
            onClick={() => setShowSamplePanel((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-black/3"
          >
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/5">
                <FileBox size={14} strokeWidth={2} className="text-black/45" />
              </div>
              <span className="text-[13px] font-bold text-black/60">Sample Meshes</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-bold text-black/35">
                {SAMPLE_MESHES.length}
              </span>
              {showSamplePanel ? (
                <ChevronDown size={14} className="text-black/30" />
              ) : (
                <ChevronUp size={14} className="text-black/30" />
              )}
            </div>
          </button>

          {/* Expandable list */}
          {showSamplePanel && (
            <div className="border-t border-black/6 px-2 py-2">
              {SAMPLE_MESHES.map((sample) => (
                <div
                  key={sample.file}
                  className="group flex items-center justify-between rounded-xl px-3 py-2.5 transition-colors hover:bg-black/4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-black/65 group-hover:text-black/80">
                      {sample.name}
                    </p>
                    <p className="truncate text-[11px] font-medium text-black/30">
                      {sample.desc}
                    </p>
                  </div>
                  <div className="ml-2 flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => handlePickSample(sample)}
                      title="Use this mesh"
                      className="flex h-7 items-center gap-1.5 rounded-lg bg-black/5 px-2.5 text-[11px] font-bold text-black/45 opacity-0 transition-all hover:bg-black/10 hover:text-black/70 group-hover:opacity-100"
                    >
                      <Upload size={12} strokeWidth={2.5} />
                      Use
                    </button>
                    <a
                      href={`/meshes/${sample.file}`}
                      download={sample.file}
                      title="Download"
                      onClick={(e) => e.stopPropagation()}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-black/25 opacity-0 transition-all hover:bg-black/5 hover:text-black/50 group-hover:opacity-100"
                    >
                      <Download size={13} strokeWidth={2} />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── New Exploration Modal ── */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/1 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-3xl border border-black/10 bg-[#FDFDFB] p-10 shadow-2xl">
            <div className="mb-8 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-black/85">New Exploration</h3>
                <p className="mt-1 text-[14px] font-medium text-black/40">Upload a mesh and start asking questions</p>
              </div>
              <button onClick={closeModal} className="flex h-9 w-9 items-center justify-center rounded-full text-black/35 transition-colors hover:bg-black/5 hover:text-black/70">
                <X size={18} strokeWidth={2} />
              </button>
            </div>

            <div
              onDragOver={(e) => { e.preventDefault(); setModalDragging(true); }}
              onDragLeave={() => setModalDragging(false)}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`mb-8 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed py-16 transition-all ${
                modalDragging ? "border-black/30 bg-black/4" : modalFile ? "border-black/15 bg-black/3" : "border-black/12 hover:border-black/25 hover:bg-black/2"
              }`}
            >
              <input ref={fileInputRef} type="file" accept=".msh,.obj,.stl,.vtk,.ply" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setModalFile(f); }} />
              {modalFile ? (
                <>
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                    <Check size={24} strokeWidth={2} className="text-green-600" />
                  </div>
                  <p className="text-[16px] font-bold text-black/75">{modalFile.name}</p>
                  <p className="mt-1 text-[13px] font-medium text-black/35">{(modalFile.size / 1024).toFixed(1)} KB — click to change</p>
                </>
              ) : (
                <>
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-black/5">
                    <Upload size={26} strokeWidth={1.8} className="text-black/30" />
                  </div>
                  <p className="text-[16px] font-bold text-black/50">Drop a mesh file or click to browse</p>
                  <p className="mt-2 text-[13px] font-medium text-black/25">formats: .msh &nbsp;</p>
                </>
              )}
            </div>

            {/* ── Or pick a sample ── */}
            <div className="mb-8">
              <div className="mb-3 flex items-center gap-3">
                <div className="h-px flex-1 bg-black/8" />
                <span className="text-[12px] font-bold tracking-wide text-black/30 uppercase">or try a sample</span>
                <div className="h-px flex-1 bg-black/8" />
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {SAMPLE_MESHES.map((sample) => (
                  <button
                    key={sample.file}
                    onClick={(e) => { e.stopPropagation(); handlePickSample(sample); }}
                    className={`group flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 transition-all ${
                      modalFile?.name === sample.file
                        ? "border-black/20 bg-black/5"
                        : "border-black/8 hover:border-black/18 hover:bg-black/3"
                    }`}
                  >
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                      modalFile?.name === sample.file ? "bg-black/10" : "bg-black/4 group-hover:bg-black/7"
                    }`}>
                      <FileBox size={16} strokeWidth={1.8} className={`transition-colors ${
                        modalFile?.name === sample.file ? "text-black/60" : "text-black/30 group-hover:text-black/45"
                      }`} />
                    </div>
                    <span className={`text-center text-[11px] font-semibold leading-tight transition-colors ${
                      modalFile?.name === sample.file ? "text-black/70" : "text-black/40 group-hover:text-black/60"
                    }`}>
                      {sample.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <label className="mb-2 block text-[13px] font-bold tracking-wide text-black/45 uppercase">
              Initial question <span className="font-medium text-black/25">(optional)</span>
            </label>
            <textarea
              value={modalPrompt}
              onChange={(e) => setModalPrompt(e.target.value)}
              placeholder="e.g. Explain the topology of this mesh…"
              rows={3}
              className="mb-8 w-full resize-none rounded-xl border border-black/10 bg-white px-5 py-4 text-[15px] font-medium text-black/75 outline-none placeholder-black/30 transition-colors focus:border-black/25"
            />

            {modalError && <p className="mb-4 text-[14px] font-semibold text-red-500">{modalError}</p>}

            <div className="flex items-center justify-end gap-4">
              <button onClick={closeModal} className="rounded-xl px-6 py-3 text-[15px] font-semibold text-black/40 transition-colors hover:text-black/70">Cancel</button>
              <button
                onClick={handleCreateInteraction}
                disabled={!modalFile || modalLoading}
                className="rounded-xl bg-[#111] px-8 py-3 text-[15px] font-bold text-white transition-all hover:bg-black disabled:opacity-30"
              >
                {modalLoading ? (
                  <span className="flex items-center gap-2"><Loader2 size={15} className="animate-spin" />Uploading…</span>
                ) : "Start Exploration"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
