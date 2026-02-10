"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { getWsUrl, type WsIncoming, type SegmentResult, type QueryResult } from "./api";

export type PipelinePhase =
  | "idle"
  | "connecting"
  | "connected"
  | "segmenting"
  | "segmented"
  | "downsampling"
  | "downsampled"
  | "embedding"
  | "embedded"
  | "stored"
  | "segment_done"
  | "parsing_query"
  | "tool_call"
  | "query_done"
  | "error";

export interface ProgressEntry {
  step: string;
  detail: Record<string, unknown>;
  explanation?: string;
  timestamp: number;
}

interface UseShapeSocketReturn {
  connect: (uid: string, sessionId: string) => void;
  disconnect: () => void;
  triggerSegmentation: (opts?: { target_step?: number; downsample_nodes?: number; embed?: boolean }) => void;
  sendQuery: (query: string) => void;
  phase: PipelinePhase;
  setPhase: (p: PipelinePhase) => void;
  progressLog: ProgressEntry[];
  progressText: string;
  segmentResult: SegmentResult | null;
  setSegmentResult: (r: SegmentResult | null) => void;
  queryResult: QueryResult | null;
  /** Increments each time a new query result arrives — use as effect dependency */
  queryResultVersion: number;
  error: string | null;
  isConnected: boolean;
}

export function useShapeSocket(): UseShapeSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const [phase, setPhase] = useState<PipelinePhase>("idle");
  const [progressLog, setProgressLog] = useState<ProgressEntry[]>([]);
  const [progressText, setProgressText] = useState("");
  const [segmentResult, setSegmentResult] = useState<SegmentResult | null>(null);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [queryResultVersion, setQueryResultVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const expectingRef = useRef<"segment" | "query" | null>(null);

  const disconnect = useCallback(() => {
    console.log("[WS] disconnect() called");
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
    setPhase("idle");
  }, []);

  const connect = useCallback(
    (uid: string, sessionId: string) => {
      if (wsRef.current) {
        console.log("[WS] closing existing connection");
        wsRef.current.close();
      }

      setPhase("connecting");
      setError(null);
      setProgressLog([]);
      setProgressText("");
      // Note: we do NOT clear segmentResult/queryResult here —
      // the dashboard manages that when switching sessions.
      // Clearing here would race with async data loading.

      const url = getWsUrl(uid, sessionId);
      console.log("[WS] connecting to:", url);
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[WS] ✅ onopen — connection established");
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        console.log("[WS] 📩 raw message:", event.data);

        let msg: WsIncoming;
        try {
          msg = JSON.parse(event.data);
        } catch (e) {
          console.error("[WS] ❌ failed to parse message:", e);
          return;
        }

        console.log("[WS] 📩 parsed:", msg.type, msg);

        switch (msg.type) {
          case "connected":
            console.log("[WS] → phase: connected");
            // Only move to "connected" if we're still in connecting state.
            // If segments were already loaded from REST, phase may be "segment_done" — don't regress.
            setPhase((prev) => (prev === "connecting" || prev === "idle") ? "connected" : prev);
            break;

          case "progress": {
            const entry: ProgressEntry = {
              step: msg.step,
              detail: msg.detail,
              explanation: msg.explanation,
              timestamp: Date.now(),
            };
            setProgressLog((prev) => [...prev, entry]);
            setPhase(msg.step as PipelinePhase);
            console.log("[WS] → phase:", msg.step, "detail:", msg.detail);

            const detail = msg.detail;
            if (msg.explanation) {
              setProgressText(msg.explanation);
            } else if (detail.status && typeof detail.status === "string") {
              setProgressText(detail.status);
            } else if (msg.step === "segmented" && detail.total_segments) {
              setProgressText(`Found ${detail.total_segments} segments`);
            } else if (msg.step === "downsampled") {
              setProgressText(`Downsampled ${detail.segments_processed} segments`);
            } else if (msg.step === "embedded") {
              setProgressText(`Embedded ${detail.segments_embedded} segments`);
            } else if (msg.step === "tool_call" && detail.tool) {
              setProgressText(`Calling ${detail.tool}...`);
            } else {
              setProgressText(msg.step.replace(/_/g, " "));
            }
            break;
          }

          case "result": {
            const data = msg.data;
            console.log("[WS] → result received, expecting:", expectingRef.current, "has answer:", "answer" in data);
            if (expectingRef.current === "query" || "answer" in data) {
              console.log("[WS] → treating as QUERY result");
              setQueryResult(data as QueryResult);
              setQueryResultVersion((v) => v + 1);
              setPhase("query_done");
              setProgressText("");
            } else {
              console.log("[WS] → treating as SEGMENT result, segments:", (data as SegmentResult).segments?.length);
              setSegmentResult(data as SegmentResult);
              setPhase("segment_done");
              setProgressText("");
            }
            expectingRef.current = null;
            break;
          }

          case "error":
            console.error("[WS] ❌ error from server:", msg.message);
            setError(msg.message);
            setPhase("error");
            setProgressText("");
            break;

          default:
            console.warn("[WS] ⚠️ unknown message type:", (msg as Record<string, unknown>).type, msg);
            break;
        }
      };

      ws.onclose = (event) => {
        console.log("[WS] 🔌 onclose — code:", event.code, "reason:", event.reason, "wasClean:", event.wasClean);
        setIsConnected(false);
        if (event.code === 4001) {
          setError("Authentication failed. Please sign in again.");
          setPhase("error");
        }
      };

      ws.onerror = (event) => {
        console.error("[WS] ❌ onerror:", event);
        setError("WebSocket connection failed.");
        setPhase("error");
        setIsConnected(false);
      };
    },
    [],
  );

  const triggerSegmentation = useCallback(
    (opts?: { target_step?: number; downsample_nodes?: number; embed?: boolean }) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        console.warn("[WS] triggerSegmentation called but WS not open, readyState:", wsRef.current?.readyState);
        return;
      }
      expectingRef.current = "segment";
      setProgressLog([]);
      setProgressText("Starting segmentation...");
      setPhase("segmenting");

      const payload = {
        type: "upload_and_segment",
        target_step: opts?.target_step ?? 1.0,
        downsample_nodes: opts?.downsample_nodes ?? 16,
        embed: opts?.embed ?? true,
      };
      console.log("[WS] 📤 sending:", payload);
      wsRef.current.send(JSON.stringify(payload));
    },
    [],
  );

  const sendQuery = useCallback((query: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn("[WS] sendQuery called but WS not open, readyState:", wsRef.current?.readyState);
      return;
    }
    expectingRef.current = "query";
    setProgressText("Understanding your question...");
    setPhase("parsing_query");

    const payload = { type: "query", query };
    console.log("[WS] 📤 sending:", payload);
    wsRef.current.send(JSON.stringify(payload));
  }, []);

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        console.log("[WS] 🧹 cleanup — closing on unmount");
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  return {
    connect,
    disconnect,
    triggerSegmentation,
    sendQuery,
    phase,
    setPhase,
    progressLog,
    progressText,
    segmentResult,
    setSegmentResult,
    queryResult,
    queryResultVersion,
    error,
    isConnected,
  };
}
