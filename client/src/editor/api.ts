// HTTP calls for the map editor (admin only; see server/src/networking/http.ts).

import type { ContentBundle, MapData } from '@tuff/shared';
import { ApiError } from '../net/api';

export interface MapListEntry {
  id: string;
  bytes: number;
  modified: number;
}

export class EditorApi {
  constructor(private readonly token: string) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(path, {
        method,
        headers: { authorization: `Bearer ${this.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError('Cannot reach the server.', 0);
    }
    const data = (await res.json().catch(() => ({}))) as T & { message?: string; problems?: string[] };
    if (!res.ok) {
      const extra = data.problems && data.problems.length > 1 ? ` (+${data.problems.length - 1} more)` : '';
      throw new ApiError(`${data.message ?? `Request failed (${res.status})`}${extra}`, res.status);
    }
    return data;
  }

  content(): Promise<{ content: ContentBundle; liveMap: string }> {
    return this.request('GET', '/api/editor/content');
  }

  maps(): Promise<{ maps: MapListEntry[]; liveMap: string }> {
    return this.request('GET', '/api/editor/maps');
  }

  async load(id: string): Promise<MapData> {
    return (await this.request<{ map: MapData }>('GET', `/api/editor/map?id=${encodeURIComponent(id)}`)).map;
  }

  async save(map: MapData): Promise<void> {
    await this.request('PUT', `/api/editor/map?id=${encodeURIComponent(map.id)}`, { map });
  }

  async publish(id: string): Promise<void> {
    await this.request('POST', `/api/editor/publish?id=${encodeURIComponent(id)}`);
  }
}
