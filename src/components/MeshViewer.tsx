"use client";

import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from "react";
import { getSurfaceMesh, type SurfaceMesh, type SegmentResult } from "@/lib/api";
import { Loader2 } from "lucide-react";

// VTK.js imports
import "@kitware/vtk.js/Rendering/Profiles/Geometry";
import vtkFullScreenRenderWindow from "@kitware/vtk.js/Rendering/Misc/FullScreenRenderWindow";
import vtkActor from "@kitware/vtk.js/Rendering/Core/Actor";
import vtkMapper from "@kitware/vtk.js/Rendering/Core/Mapper";
import vtkPolyData from "@kitware/vtk.js/Common/DataModel/PolyData";
import vtkDataArray from "@kitware/vtk.js/Common/Core/DataArray";

import {
  SEGMENT_COLORS,
  DEFAULT_MESH_COLOR,
  HIGHLIGHT_COLOR,
  type MeshViewerHandle,
} from "./meshConstants";

interface MeshViewerProps {
  uid: string;
  sessionId: string;
  segmentResult: SegmentResult | null;
  highlightIds: number[];
  processing: boolean;
  opacity: number; // 0–1, surface mesh opacity
}

const MeshViewer = forwardRef<MeshViewerHandle, MeshViewerProps>(function MeshViewer(
  { uid, sessionId, segmentResult, highlightIds, processing, opacity },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const vtkContextRef = useRef<ReturnType<typeof vtkFullScreenRenderWindow.newInstance> | null>(null);
  const surfaceActorRef = useRef<ReturnType<typeof vtkActor.newInstance> | null>(null);
  const rendererRef = useRef<ReturnType<ReturnType<typeof vtkFullScreenRenderWindow.newInstance>["getRenderer"]> | null>(null);
  const renderWindowRef = useRef<ReturnType<ReturnType<typeof vtkFullScreenRenderWindow.newInstance>["getRenderWindow"]> | null>(null);

  const [surfaceMesh, setSurfaceMesh] = useState<SurfaceMesh | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-rotation state
  const rotatingRef = useRef(true); // default: rotating
  const rafIdRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const rotationAngleRef = useRef({ azimuth: 0, elevation: 0 });

  // ── Expose zoom/reset to parent ──
  const zoomIn = useCallback(() => {
    if (!rendererRef.current || !renderWindowRef.current) return;
    const cam = rendererRef.current.getActiveCamera();
    cam.dolly(1.2);
    rendererRef.current.resetCameraClippingRange();
    renderWindowRef.current.render();
  }, []);

  const zoomOut = useCallback(() => {
    if (!rendererRef.current || !renderWindowRef.current) return;
    const cam = rendererRef.current.getActiveCamera();
    cam.dolly(0.8);
    rendererRef.current.resetCameraClippingRange();
    renderWindowRef.current.render();
  }, []);

  const resetCamera = useCallback(() => {
    if (!rendererRef.current || !renderWindowRef.current) return;
    rendererRef.current.resetCamera();
    rendererRef.current.getActiveCamera().azimuth(25);
    rendererRef.current.getActiveCamera().elevation(15);
    rendererRef.current.resetCameraClippingRange();
    renderWindowRef.current.render();
  }, []);

  // ── Auto-rotation loop ──
  const startRotation = useCallback(() => {
    if (rafIdRef.current !== null) return; // already running
    lastTimeRef.current = performance.now();

    const AZIMUTH_SPEED = 8;   // degrees per second (horizontal)
    const ELEVATION_AMP = 3;   // degrees amplitude (gentle vertical bob)
    const ELEVATION_PERIOD = 12; // seconds for one full bob cycle

    const animate = (now: number) => {
      if (!rotatingRef.current) {
        rafIdRef.current = null;
        return;
      }
      const dt = (now - lastTimeRef.current) / 1000; // seconds
      lastTimeRef.current = now;

      if (rendererRef.current && renderWindowRef.current) {
        const cam = rendererRef.current.getActiveCamera();

        // Slow horizontal rotation
        cam.azimuth(AZIMUTH_SPEED * dt);

        // Gentle vertical oscillation
        rotationAngleRef.current.elevation += dt;
        const elevDelta = Math.sin((rotationAngleRef.current.elevation / ELEVATION_PERIOD) * Math.PI * 2) * ELEVATION_AMP * dt;
        cam.elevation(elevDelta);

        cam.orthogonalizeViewUp();
        rendererRef.current.resetCameraClippingRange();
        renderWindowRef.current.render();
      }

      rafIdRef.current = requestAnimationFrame(animate);
    };

    rafIdRef.current = requestAnimationFrame(animate);
  }, []);

  const stopRotation = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  const toggleRotation = useCallback(() => {
    rotatingRef.current = !rotatingRef.current;
    if (rotatingRef.current) {
      startRotation();
    } else {
      stopRotation();
    }
    return rotatingRef.current;
  }, [startRotation, stopRotation]);

  const isRotating = useCallback(() => rotatingRef.current, []);

  useImperativeHandle(ref, () => ({ zoomIn, zoomOut, resetCamera, toggleRotation, isRotating }), [zoomIn, zoomOut, resetCamera, toggleRotation, isRotating]);

  // ── Update opacity without re-rendering entire scene ──
  useEffect(() => {
    if (surfaceActorRef.current && renderWindowRef.current) {
      surfaceActorRef.current.getProperty().setOpacity(opacity);
      renderWindowRef.current.render();
    }
  }, [opacity]);

  // ── Fetch surface mesh ──
  useEffect(() => {
    if (!uid || !sessionId) return;
    setLoading(true);
    setError(null);
    console.log("[MeshViewer] fetching surface mesh for", uid, sessionId);

    getSurfaceMesh(uid, sessionId)
      .then((data) => {
        console.log("[MeshViewer] loaded:", data.vertices?.length, "verts,", data.faces?.length, "faces");
        if (!data.vertices?.length || !data.faces?.length) {
          console.warn("[MeshViewer] mesh data is empty or missing fields. Keys:", Object.keys(data));
          setError("Mesh data is empty or has unexpected format.");
          return;
        }
        setSurfaceMesh(data);
      })
      .catch((err) => {
        console.error("[MeshViewer] failed:", err.message || err);
        setError(`Could not load mesh: ${err.message || "unknown error"}`);
      })
      .finally(() => setLoading(false));
  }, [uid, sessionId]);

  // ── Render VTK scene ──
  useEffect(() => {
    if (!containerRef.current || !surfaceMesh) return;
    const { vertices, faces } = surfaceMesh;
    if (!vertices?.length || !faces?.length) return;

    console.log("[MeshViewer] rendering —", vertices.length, "verts,", faces.length, "faces");

    // Cleanup
    if (vtkContextRef.current) {
      vtkContextRef.current.delete();
      vtkContextRef.current = null;
    }
    containerRef.current.innerHTML = "";

    const fullScreenRenderer = vtkFullScreenRenderWindow.newInstance({
      container: containerRef.current,
      background: [0.97, 0.97, 0.96] as [number, number, number],
    });
    vtkContextRef.current = fullScreenRenderer;

    const renderer = fullScreenRenderer.getRenderer();
    const renderWindow = fullScreenRenderer.getRenderWindow();
    rendererRef.current = renderer;
    renderWindowRef.current = renderWindow;

    // ── Surface mesh geometry ──
    const surfacePolyData = vtkPolyData.newInstance();
    const numVerts = vertices.length;
    const points = new Float32Array(numVerts * 3);
    for (let i = 0; i < numVerts; i++) {
      points[i * 3] = vertices[i][0];
      points[i * 3 + 1] = vertices[i][1];
      points[i * 3 + 2] = vertices[i][2];
    }
    surfacePolyData.getPoints().setData(points, 3);

    const numFaces = faces.length;
    const polys = new Uint32Array(numFaces * 4);
    for (let i = 0; i < numFaces; i++) {
      polys[i * 4] = 3;
      polys[i * 4 + 1] = faces[i][0];
      polys[i * 4 + 2] = faces[i][1];
      polys[i * 4 + 3] = faces[i][2];
    }
    surfacePolyData.getPolys().setData(polys);

    // ── Color faces by segment (same colors as centerline) ──
    const faceColors = new Uint8Array(numFaces * 3);
    for (let i = 0; i < numFaces; i++) {
      faceColors[i * 3] = DEFAULT_MESH_COLOR[0];
      faceColors[i * 3 + 1] = DEFAULT_MESH_COLOR[1];
      faceColors[i * 3 + 2] = DEFAULT_MESH_COLOR[2];
    }

    if (segmentResult?.segments) {
      for (const seg of segmentResult.segments) {
        const isHighlighted = highlightIds.includes(seg.segment_id);
        const color = isHighlighted
          ? HIGHLIGHT_COLOR
          : SEGMENT_COLORS[seg.type] || DEFAULT_MESH_COLOR;

        // Use face_ids if available (preferred)
        if (seg.face_ids && seg.face_ids.length > 0) {
          for (const faceIdx of seg.face_ids) {
            if (faceIdx < numFaces) {
              faceColors[faceIdx * 3] = color[0];
              faceColors[faceIdx * 3 + 1] = color[1];
              faceColors[faceIdx * 3 + 2] = color[2];
            }
          }
        }
        // Fallback: color vertices by original_node_ids (vertex coloring)
        // This is less precise but works without face_ids
      }
    }

    const cellColorArray = vtkDataArray.newInstance({
      numberOfComponents: 3,
      values: faceColors,
      name: "SegmentColors",
      dataType: "Uint8Array",
    });
    surfacePolyData.getCellData().setScalars(cellColorArray);

    const surfaceMapper = vtkMapper.newInstance();
    surfaceMapper.setInputData(surfacePolyData);
    surfaceMapper.setScalarVisibility(true);
    surfaceMapper.setScalarModeToUseCellData();

    const surfaceActor = vtkActor.newInstance();
    surfaceActor.setMapper(surfaceMapper);
    surfaceActor.getProperty().setEdgeVisibility(true);
    surfaceActor.getProperty().setEdgeColor(0.15, 0.15, 0.15);
    surfaceActor.getProperty().setLineWidth(0.5);
    surfaceActor.getProperty().setOpacity(opacity);
    surfaceActorRef.current = surfaceActor;

    renderer.addActor(surfaceActor);

    // ── Centerline overlay — same colors as surface ──
    if (segmentResult?.segments) {
      const clPolyData = vtkPolyData.newInstance();
      const clPoints: number[] = [];
      const clLines: number[] = [];
      const clColors: number[] = [];
      let offset = 0;

      for (const seg of segmentResult.segments) {
        const nodes = seg.downsampled_nodes;
        if (!nodes || nodes.length < 2) continue;

        const isHighlighted = highlightIds.includes(seg.segment_id);
        const color = isHighlighted
          ? HIGHLIGHT_COLOR
          : SEGMENT_COLORS[seg.type] || DEFAULT_MESH_COLOR;

        for (const node of nodes) {
          clPoints.push(node[0], node[1], node[2]);
          clColors.push(color[0], color[1], color[2]);
        }

        const edges = seg.downsampled_edges;
        if (edges && edges.length > 0) {
          for (const edge of edges) {
            clLines.push(2, edge[0] + offset, edge[1] + offset);
          }
        } else {
          clLines.push(nodes.length);
          for (let i = 0; i < nodes.length; i++) {
            clLines.push(i + offset);
          }
        }
        offset += nodes.length;
      }

      if (clPoints.length > 0) {
        clPolyData.getPoints().setData(new Float32Array(clPoints), 3);
        clPolyData.getLines().setData(new Uint32Array(clLines));

        const clColorArray = vtkDataArray.newInstance({
          numberOfComponents: 3,
          values: new Uint8Array(clColors),
          name: "CenterlineColors",
          dataType: "Uint8Array",
        });
        clPolyData.getPointData().setScalars(clColorArray);

        const clMapper = vtkMapper.newInstance();
        clMapper.setInputData(clPolyData);
        clMapper.setScalarVisibility(true);

        const clActor = vtkActor.newInstance();
        clActor.setMapper(clMapper);
        clActor.getProperty().setLineWidth(4);
        clActor.getProperty().setOpacity(1);

        renderer.addActor(clActor);
      }
    }

    // Camera
    renderer.resetCamera();
    renderer.getActiveCamera().azimuth(25);
    renderer.getActiveCamera().elevation(15);
    renderer.resetCameraClippingRange();
    renderWindow.render();

    // Start auto-rotation if enabled
    if (rotatingRef.current) {
      startRotation();
    }

    return () => {
      stopRotation();
      surfaceActorRef.current = null;
      rendererRef.current = null;
      renderWindowRef.current = null;
      if (vtkContextRef.current) {
        vtkContextRef.current.delete();
        vtkContextRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaceMesh, segmentResult, highlightIds, opacity]);

  // ── States ──
  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="flex items-center gap-3">
          <Loader2 size={18} className="animate-spin text-black/30" />
          <span className="text-[14px] font-medium text-black/30">Loading mesh…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2">
        <p className="text-[14px] font-medium text-red-400">{error}</p>
        <p className="max-w-md text-center text-[12px] text-black/25">
          Backend needs <code className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-[11px]">GET /mesh/{"{uid}"}/{"{session_id}"}</code>
        </p>
      </div>
    );
  }

  if (!surfaceMesh && processing) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="flex items-center gap-3">
          <Loader2 size={18} className="animate-spin text-black/30" />
          <span className="text-[14px] font-medium text-black/30">Processing mesh…</span>
        </div>
      </div>
    );
  }

  if (!surfaceMesh) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="text-[14px] font-medium text-black/20">Waiting for mesh data…</p>
      </div>
    );
  }

  return <div ref={containerRef} className="relative h-full w-full" />;
});

export default MeshViewer;
