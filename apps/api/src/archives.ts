import { open, stat, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { PMTiles, TileType, type Header, type RangeResponse, type Source } from 'pmtiles';

/** pmtiles Source backed by a local file. */
class LocalFileSource implements Source {
  private handle: Promise<FileHandle> | null = null;
  constructor(private readonly file: string) {}

  getKey(): string {
    return this.file;
  }

  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    this.handle ??= open(this.file, 'r');
    const fh = await this.handle;
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, offset);
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + bytesRead) as ArrayBuffer };
  }

  async close(): Promise<void> {
    const h = this.handle;
    this.handle = null;
    if (h) await (await h).close().catch(() => {});
  }
}

export const TILE_CONTENT_TYPES: Partial<Record<TileType, string>> = {
  [TileType.Mvt]: 'application/vnd.mapbox-vector-tile',
  [TileType.Webp]: 'image/webp',
  [TileType.Png]: 'image/png',
  [TileType.Jpeg]: 'image/jpeg',
};

export const TILE_EXTENSIONS: Partial<Record<TileType, string>> = {
  [TileType.Mvt]: 'mvt',
  [TileType.Webp]: 'webp',
  [TileType.Png]: 'png',
  [TileType.Jpeg]: 'jpg',
};

/** A PMTiles archive on disk; reopens transparently when the file is replaced (install.sh renames files). */
export class Archive {
  private source: LocalFileSource | null = null;
  private pmtiles: PMTiles | null = null;
  private inode = 0;
  private checkedAt = 0;

  constructor(readonly file: string) {}

  private async current(): Promise<PMTiles | null> {
    const now = Date.now();
    if (this.pmtiles && now - this.checkedAt < 30_000) return this.pmtiles;
    this.checkedAt = now;
    let ino: number;
    try {
      ino = (await stat(this.file)).ino;
    } catch {
      await this.source?.close();
      this.source = this.pmtiles = null;
      return null;
    }
    if (!this.pmtiles || ino !== this.inode) {
      await this.source?.close();
      this.inode = ino;
      this.source = new LocalFileSource(this.file);
      this.pmtiles = new PMTiles(this.source);
    }
    return this.pmtiles;
  }

  async header(): Promise<Header | null> {
    const p = await this.current();
    return p ? p.getHeader() : null;
  }

  async metadata(): Promise<Record<string, unknown>> {
    const p = await this.current();
    return p ? ((await p.getMetadata()) as Record<string, unknown>) : {};
  }

  /** Decompressed tile bytes, or null when absent / out of range. */
  async tile(z: number, x: number, y: number): Promise<{ data: ArrayBuffer; tileType: TileType } | null> {
    const p = await this.current();
    if (!p) return null;
    const h = await p.getHeader();
    if (z < h.minZoom || z > h.maxZoom || x >= 2 ** z || y >= 2 ** z) return null;
    const res = await p.getZxy(z, x, y);
    return res ? { data: res.data, tileType: h.tileType } : null;
  }
}

export const ARCHIVE_NAMES = ['world', 'region', 'terrain'] as const;
export type ArchiveName = (typeof ARCHIVE_NAMES)[number];

export function openArchives(dataDir: string): Record<ArchiveName, Archive> {
  const f = (n: string) => new Archive(path.join(dataDir, 'tiles', `${n}.pmtiles`));
  return { world: f('world'), region: f('region'), terrain: f('terrain') };
}
