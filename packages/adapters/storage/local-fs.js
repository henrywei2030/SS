/**
 * LocalFs StorageAdapter
 * 适用于开发期完全离线、不想跑 MinIO 的场景
 */
import { promises as fs } from 'node:fs';
import { createReadStream } from 'node:fs';
import { join, dirname } from 'node:path';
export class LocalFsStorageAdapter {
    cfg;
    id;
    constructor(cfg) {
        this.cfg = cfg;
        this.id = `local-fs:${cfg.rootDir}`;
    }
    resolve(key) {
        return join(this.cfg.rootDir, key);
    }
    async putObject(key, data, opts = {}) {
        const fullPath = this.resolve(key);
        await fs.mkdir(dirname(fullPath), { recursive: true });
        const buf = data instanceof Blob
            ? Buffer.from(await data.arrayBuffer())
            : Buffer.isBuffer(data)
                ? data
                : data instanceof Uint8Array
                    ? Buffer.from(data)
                    : await streamToBuffer(data);
        await fs.writeFile(fullPath, buf);
        const url = this.cfg.publicBaseUrl
            ? `${this.cfg.publicBaseUrl}/${key}`
            : `file://${fullPath}`;
        void opts;
        return { key, url, sizeBytes: buf.length };
    }
    async getObject(key) {
        return createReadStream(this.resolve(key));
    }
    async getObjectBuffer(key) {
        return fs.readFile(this.resolve(key));
    }
    async getSignedUrl(key) {
        return this.cfg.publicBaseUrl
            ? `${this.cfg.publicBaseUrl}/${key}`
            : `file://${this.resolve(key)}`;
    }
    async deleteObject(key) {
        try {
            await fs.unlink(this.resolve(key));
        }
        catch (e) {
            if (e.code === 'ENOENT')
                return;
            throw e;
        }
    }
    async exists(key) {
        try {
            await fs.access(this.resolve(key));
            return true;
        }
        catch {
            return false;
        }
    }
    async *listObjects(prefix) {
        const dir = this.resolve(prefix);
        let entries;
        try {
            entries = await fs.readdir(dir, { recursive: true });
        }
        catch {
            return;
        }
        for (const e of entries) {
            const full = join(dir, e);
            const stat = await fs.stat(full).catch(() => null);
            if (!stat?.isFile())
                continue;
            yield {
                key: join(prefix, e),
                size: stat.size,
                lastModified: stat.mtime,
            };
        }
    }
    async copyObject(sourceKey, destKey) {
        const src = this.resolve(sourceKey);
        const dest = this.resolve(destKey);
        await fs.mkdir(dirname(dest), { recursive: true });
        await fs.copyFile(src, dest);
    }
}
async function streamToBuffer(stream) {
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}
//# sourceMappingURL=local-fs.js.map