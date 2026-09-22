export { AiMapClient, AiMapError } from './client';
export type * from './client';
export { AiMapEmbed } from './embed';
export type * from './embed';
export { addDrawings, drawingLayers, milImageId, registerMilSymbolImages, toRenderCollection, MIL_IMAGE_PREFIX } from './drawings';
export type { DrawingsController, DrawingsOptions } from './drawings';
export { buildEmbedUrl, EMBED_PROTOCOL_VERSION } from '@ai-map/shared/embed';
export { ALL_CONTROLS, CONTROL_GROUPS, resolveControls } from '@ai-map/shared/controls';
export const VERSION = '1.0.0';
