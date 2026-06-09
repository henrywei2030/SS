/**
 * LocalFs StorageAdapter
 * 适用于开发期完全离线、不想跑 MinIO 的场景
 */
import { promises as fs } from 'node:fs';
import { createReadStream } from 'node:fs';
import { join, dirname, resolve as pathResolve, relative as pathRelative, isAbsolute } from 'node:path';
import type { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

import type { StorageAdapter, PutOptions, PutResult, ObjectInfo } from './types.js';

export interface LocalFsConfig {
  /** 数据根目录，如 ./.local/storage */
  rootDir: string;
  /** 公网可访问的 base URL（用于 dev server 直接 serve） */
  publicBaseUrl?: string;
}

export class LocalFsStorageAdapter implements StorageAdapter {
  readonly id: string;
  private readonly absRootDir: string;

  constructor(private readonly cfg: LocalFsConfig) {
    this.absRootDir = pathResolve(cfg.rootDir);
    this.id = `local-fs:${cfg.rootDir}`;
  }

  /**
   * 安全 resolve key 到绝对路径 — 防 `../` 路径穿越
   *
   * 攻击向量:key='../../etc/passwd' 会让 fs.writeFile 越权写到 rootDir 外。
   * 修复:用 `path.relative()` 跨平台判断(Windows 路径分隔符是 `\\`,*nix 是 `/`)
   * 若 relative 路径以 `..` 开头或是绝对路径,则越界。
   */
  private resolve(key: string): string {
    if (isAbsolute(key) || key.startsWith('~') || key.includes('\0')) {
      throw new Error(`Invalid storage key (absolute / null byte): ${key}`);
    }
    const fullPath = pathResolve(this.absRootDir, key);
    const rel = pathRelative(this.absRootDir, fullPath);
    // rel = '' 表示 fullPath === absRootDir;以 '..' 开头表示越界;isAbsolute 表示跨盘
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`Path traversal attempt blocked: key='${key}'`);
    }
    return fullPath;
  }

  async putObject(
    key: string,
    data: Buffer | Uint8Array | Readable | Blob,
    opts: PutOptions = {},
  ): Promise<PutResult> {
    const fullPath = this.resolve(key);
    await fs.mkdir(dirname(fullPath), { recursive: true });

    const buf =
      data instanceof Blob
        ? Buffer.from(await data.arrayBuffer())
        : Buffer.isBuffer(data)
          ? data
          : data instanceof Uint8Array
            ? Buffer.from(data)
            : await streamToBuffer(data);

    await fs.writeFile(fullPath, buf);

    // Windows 绝对路径(C:\...)裸拼 `file://` 产非法 URL,pathToFileURL 跨平台正确编码
    const url = this.cfg.publicBaseUrl
      ? `${this.cfg.publicBaseUrl}/${key}`
      : pathToFileURL(fullPath).href;

    void opts;
    return { key, url, sizeBytes: buf.length };
  }

  async getObject(key: string): Promise<Readable> {
    return createReadStream(this.resolve(key));
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async getSignedUrl(key: string): Promise<string> {
    return this.cfg.publicBaseUrl
      ? `${this.cfg.publicBaseUrl}/${key}`
      : pathToFileURL(this.resolve(key)).href;
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolve(key));
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw e;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async *listObjects(prefix: string): AsyncIterable<ObjectInfo> {
    const dir = this.resolve(prefix);
    let entries: string[];
    try {
      entries = await fs.readdir(dir, { recursive: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e);
      const stat = await fs.stat(full).catch(() => null);
      if (!stat?.isFile()) continue;
      yield {
        key: join(prefix, e),
        size: stat.size,
        lastModified: stat.mtime,
      };
    }
  }

  async copyObject(sourceKey: string, destKey: string): Promise<void> {
    const src = this.resolve(sourceKey);
    const dest = this.resolve(destKey);
    await fs.mkdir(dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}
