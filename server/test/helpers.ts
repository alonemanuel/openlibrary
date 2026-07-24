import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import type { AppContext } from '../src/http/context.js';

export interface TestServer {
  url: string;
  ctx: AppContext;
  dataDir: string;
  close(): Promise<void>;
}

/** Boots the real app on an ephemeral port against a throwaway data directory. */
export async function startTestServer(fetchImpl?: typeof fetch): Promise<TestServer> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlibrary-test-'));
  const { app, ctx } = createApp({
    config: {
      dataDir,
      dbPath: path.join(dataDir, 'test.db'),
      syncRoot: path.join(dataDir, 'sync'),
      snapshotDir: path.join(dataDir, 'snapshots'),
      webDist: null,
      offline: !fetchImpl,
    },
    ...(fetchImpl ? { fetchImpl } : {}),
  });

  const server: Server = await new Promise((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    ctx,
    dataDir,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      ctx.db.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export interface ApiResponse<T = any> {
  status: number;
  body: T;
}

/** A tiny cookie-jar HTTP client, so tests exercise real session handling. */
export class Client {
  private cookie: string | null = null;

  constructor(private readonly baseUrl: string) {}

  async request<T = any>(
    method: string,
    urlPath: string,
    body?: unknown,
    contentType = 'application/json',
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {};
    if (this.cookie) headers.cookie = this.cookie;
    if (body !== undefined) headers['content-type'] = contentType;

    const response = await fetch(`${this.baseUrl}${urlPath}`, {
      method,
      headers,
      ...(body === undefined
        ? {}
        : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });

    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0]!;

    const text = await response.text();
    const isJson = response.headers.get('content-type')?.includes('application/json');
    return { status: response.status, body: (isJson && text ? JSON.parse(text) : text) as T };
  }

  get = <T = any>(url: string) => this.request<T>('GET', url);
  post = <T = any>(url: string, body?: unknown) => this.request<T>('POST', url, body);
  patch = <T = any>(url: string, body?: unknown) => this.request<T>('PATCH', url, body);
  del = <T = any>(url: string, body?: unknown) => this.request<T>('DELETE', url, body);
  postText = <T = any>(url: string, body: string, type = 'text/csv') =>
    this.request<T>('POST', url, body, type);
}

let handleCounter = 0;

export async function registerUser(
  server: TestServer,
  overrides: Partial<{ email: string; handle: string; password: string; displayName: string }> = {},
): Promise<{ client: Client; handle: string; email: string }> {
  handleCounter += 1;
  const handle = overrides.handle ?? `tester${handleCounter}${Date.now().toString(36).slice(-4)}`;
  const email = overrides.email ?? `${handle}@example.com`;
  const password = overrides.password ?? 'correct horse battery';

  const client = new Client(server.url);
  const response = await client.post('/api/auth/register', {
    email,
    handle,
    password,
    displayName: overrides.displayName ?? handle,
  });
  if (response.status !== 201) {
    throw new Error(`register failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return { client, handle, email };
}

export async function addItem(
  client: Client,
  overrides: Record<string, unknown> = {},
): Promise<any> {
  const response = await client.post('/api/items', {
    mediaType: 'book',
    title: 'The Dispossessed',
    creators: 'Ursula K. Le Guin',
    year: 1974,
    status: 'liked',
    rating: 9,
    tags: ['sci-fi'],
    ...overrides,
  });
  if (response.status >= 400) {
    throw new Error(`addItem failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body.item;
}
