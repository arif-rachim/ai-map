import {
  Circle,
  MapPin,
  Pentagon,
  Radar,
  RectangleHorizontal,
  Ruler,
  Shield,
  Spline,
  SquareDashed,
  Type,
  type LucideIcon,
} from 'lucide-react';
import type { FeatureKind } from '@ai-map/shared';
import type { DrawTool, MeasureTool } from '../store';

/** Open-source (Lucide, ISC) line icons in the spirit of SF Symbols, which may not be used outside Apple platforms. */
export const DRAW_ICONS: Record<DrawTool, LucideIcon> = {
  point: MapPin,
  line: Spline,
  rectangle: RectangleHorizontal,
  polygon: Pentagon,
  circle: Circle,
  text: Type,
  milsymbol: Shield,
};

export const KIND_ICONS: Record<FeatureKind, LucideIcon> = DRAW_ICONS;

export const MEASURE_ICONS: Record<MeasureTool, LucideIcon> = {
  distance: Ruler,
  area: SquareDashed,
  rings: Radar,
};
