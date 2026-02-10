// ── Segment type → color (RGB 0–255) ──
// These colors are shared: surface faces AND centerline use the SAME color per type
export const SEGMENT_COLORS: Record<string, [number, number, number]> = {
  straight: [90, 178, 242],
  arc: [242, 140, 90],
  junction: [110, 210, 110],
  corner: [230, 100, 140],
};

export const DEFAULT_MESH_COLOR: [number, number, number] = [200, 200, 210];
export const HIGHLIGHT_COLOR: [number, number, number] = [255, 230, 80];

export interface MeshViewerHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  resetCamera: () => void;
  toggleRotation: () => boolean;
  isRotating: () => boolean;
}
