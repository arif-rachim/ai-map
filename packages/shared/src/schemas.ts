import { z } from 'zod';

export const FEATURE_KINDS = ['rectangle', 'polygon', 'circle', 'line', 'point', 'text', 'milsymbol'] as const;
export const FeatureKind = z.enum(FEATURE_KINDS);
export type FeatureKind = z.infer<typeof FeatureKind>;

const Position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

export const Geometry = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Point'), coordinates: Position }),
  z.object({ type: z.literal('LineString'), coordinates: z.array(Position).min(2) }),
  z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(Position).min(4)).min(1) }),
]);
export type Geometry = z.infer<typeof Geometry>;

export const Style = z.object({
  strokeColor: z.string().max(32).default('#e11d48'),
  strokeWidth: z.number().min(0).max(20).default(2),
  strokeOpacity: z.number().min(0).max(1).default(1),
  strokeDash: z.boolean().default(false),
  fillColor: z.string().max(32).default('#e11d48'),
  fillOpacity: z.number().min(0).max(1).default(0.2),
  textColor: z.string().max(32).default('#111827'),
  textSize: z.number().min(6).max(64).default(14),
  iconSize: z.number().min(10).max(120).default(36),
});
export type Style = z.infer<typeof Style>;
export const DEFAULT_STYLE: Style = Style.parse({});

export const FeatureInput = z.object({
  layerId: z.uuid(),
  kind: FeatureKind,
  geometry: Geometry,
  name: z.string().max(200).default(''),
  description: z.string().max(5000).default(''),
  style: Style.default(DEFAULT_STYLE),
  /** Circle radius in meters (kind = circle; geometry is the polygon approximation). */
  radiusM: z.number().positive().nullable().default(null),
  /** Circle center [lon, lat] (kind = circle). */
  center: Position.nullable().default(null),
  /** MIL-STD-2525D/E SIDC (kind = milsymbol). */
  sidc: z.string().max(30).nullable().default(null),
});
export type FeatureInput = z.infer<typeof FeatureInput>;

export const FeaturePatch = FeatureInput.partial().extend({ version: z.number().int().positive() });
export type FeaturePatch = z.infer<typeof FeaturePatch>;

export interface MapFeature extends FeatureInput {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const LayerInput = z.object({
  name: z.string().min(1).max(120),
  visible: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});
export type LayerInput = z.infer<typeof LayerInput>;
export const LayerPatch = LayerInput.partial();
export type LayerPatch = z.infer<typeof LayerPatch>;

export interface MapLayer extends LayerInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface Airport {
  ident: string;
  iata: string | null;
  icao: string | null;
  name: string;
  type: string;
  country: string;
  municipality: string | null;
  lon: number;
  lat: number;
}

/** Messages pushed by the server over /ws. */
export type ServerMessage =
  | { type: 'feature.created'; feature: MapFeature }
  | { type: 'feature.updated'; feature: MapFeature }
  | { type: 'feature.deleted'; id: string }
  | { type: 'layer.created'; layer: MapLayer }
  | { type: 'layer.updated'; layer: MapLayer }
  | { type: 'layer.deleted'; id: string };

export interface DataCapabilities {
  region: boolean;
  world: boolean;
  terrain: boolean;
  /** Max zoom of the terrain DEM tiles (null without terrain). */
  terrainMaxzoom: number | null;
  terrainBounds: [number, number, number, number] | null;
  geocoder: boolean;
}
