const BACKEND = process.env.NEXT_PUBLIC_BACKEND || "";
const API_BASE = BACKEND;
const WS_BASE = BACKEND.replace(/^http/, "ws");

/** Default headers for all API requests — includes ngrok bypass */
const defaultHeaders: Record<string, string> = {
  "ngrok-skip-browser-warning": "true",
};

/* ── Auth ── */

export interface SessionInfo {
  session_id: string;
  created_at?: string;
}

export async function login(email: string): Promise<{
  uid: string;
  email: string;
  is_new: boolean;
  sessions: (string | SessionInfo)[];
}> {
  const res = await fetch(`${API_BASE}/auth/login`, { 
    method: "POST",
    headers: { ...defaultHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error("Login failed");
  return res.json();
}

/** Extract session_id string from whatever the backend returns */
export function normalizeSessionId(s: string | SessionInfo | Record<string, unknown>): string {
  if (typeof s === "string") return s;
  if (s && typeof s === "object" && "session_id" in s && typeof s.session_id === "string") return s.session_id;
  return String(s);
}

export async function getMe(uid: string): Promise<{
  uid: string;
  email: string;
  sessions: (string | SessionInfo)[];
}> {
  const res = await fetch(`${API_BASE}/auth/me?uid=${encodeURIComponent(uid)}`, {
    headers: defaultHeaders,
  });
  if (res.status === 404 || res.status === 401) throw new Error("Invalid session");
  if (!res.ok) throw new Error("Failed to verify session");
  return res.json();
}

/* ── Upload ── */

export interface UploadResponse {
  session: {
    session_id: string;
    uid: string;
    created_at: string;
  };
  ingest: {
    num_nodes: number;
    num_edges: number;
    file_type: string;
  };
}

export async function uploadMesh(uid: string, file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("uid", uid);
  formData.append("file", file);

  const res = await fetch(`${API_BASE}/upload`, {
    method: "POST",
    headers: defaultHeaders,
    body: formData,
  });
  if (!res.ok) throw new Error("Upload failed");
  return res.json();
}

/* ── Surface mesh ── */

export interface SurfaceMesh {
  vertices: number[][];  // [[x,y,z], ...]
  faces: number[][];     // [[v0,v1,v2], ...] — triangle indices into vertices
}

export async function getSurfaceMesh(uid: string, sessionId: string): Promise<SurfaceMesh> {
  const url = `${API_BASE}/mesh/${uid}/${sessionId}`;
  const res = await fetch(url, { headers: defaultHeaders });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to load surface mesh (${res.status})`);
  }
  const data = await res.json();
  return data;
}

/* ── Chat history ── */

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

/**
 * Fetch saved chat history for a session.
 * Backend should expose: GET /chat/{uid}/{session_id}
 * Returns array of { role, content, timestamp? }
 */
export async function getChatHistory(uid: string, sessionId: string): Promise<ChatHistoryMessage[]> {
  const res = await fetch(`${API_BASE}/chat/${uid}/${sessionId}`, { headers: defaultHeaders });
  if (res.status === 404) return []; // no chat yet
  if (!res.ok) throw new Error("Failed to load chat history");
  return res.json();
}

/* ── Segments (pre-computed) ── */

/**
 * Fetch previously computed segment results for a session.
 * Backend should expose: GET /segments/{uid}/{session_id}
 * Returns the same SegmentResult shape as the WS "result" message.
 */
export async function getSegments(uid: string, sessionId: string): Promise<SegmentResult | null> {
  const res = await fetch(`${API_BASE}/segments/${uid}/${sessionId}`, { headers: defaultHeaders });
  if (res.status === 404) return null; // not yet segmented
  if (!res.ok) throw new Error("Failed to load segments");
  return res.json();
}

/* ── WebSocket ── */

export function getWsUrl(uid: string, sessionId: string): string {
  return `${WS_BASE}/ws/${uid}/${sessionId}`;
}

/* ── WS Message Types ── */

export type WsIncoming =
  | { type: "connected"; session: { session_id: string } }
  | { type: "progress"; step: string; detail: Record<string, unknown>; explanation?: string }
  | { type: "result"; data: SegmentResult | QueryResult }
  | { type: "error"; message: string };

export interface Segment {
  segment_id: number;
  type: string;
  node_count: number;
  original_node_ids: number[];
  /** Surface mesh face indices that belong to this segment */
  face_ids?: number[];
  length: number;
  mean_curvature: number;
  arc_angle_deg: number;
  corner_angle_deg: number;
  downsampled_nodes: number[][];
  downsampled_edges: number[][];
  embedding: number[];
  radius_est?: number;
}

export interface SegmentResult {
  segments: Segment[];
  summary: {
    total_segments: number;
    counts_by_type: Record<string, number>;
  };
}

export interface QueryResult {
  query: string;
  answer: string;
  tool_calls: { tool: string; params: Record<string, unknown>; result: unknown }[];
  highlight_ids: number[];
  mode: string;
}
