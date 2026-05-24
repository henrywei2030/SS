/**
 * RelayAssetProvider — OpenAI 兼容中转站素材库 API 适配器
 *
 * Phase 1.5 P0-5(主次重审 v2.1 · 2026-05-24):
 *   - 多数 OpenAI 兼容中转站(如 moyu.info / OpenRouter / Poe 等)的素材库:
 *     上传图片/视频/音频后获 `asset://{id}` 引用,可在视频生成 prompt 中复用
 *   - 优势:**避免每次抽卡重传大文件**(参考图 / 首尾帧 / 参考视频)
 *   - 隔离:按 token 隔离,同 token 内的 group 区分
 *   - 历史素材:升级前(token_id=0)的素材 asset:// 仍可用
 *
 * 参考 API spec(归档在 docs/integrations/,以一个典型中转站文档为蓝本):
 *   POST {apiUrl}/assets         创建素材 — 服务端会下载 url(故需公网可访问)
 *   POST {apiUrl}/assets/get     查询单个素材(轮询等待 status Active)
 *   POST {apiUrl}/assets/list    分页列表
 *   POST {apiUrl}/assets/update  改名
 *   POST {apiUrl}/assets/delete  删除
 *
 * 限制(参考典型中转站):
 *   - 图片 height 300px ~ 6000px / 宽高比 0.4-2.5 / 30MB / 格式 jpeg/png/webp/bmp/tiff/gif
 *   - 视频 mp4/mov / 480p-720p / [2,15] 秒 / 最多 3 个参考视频总时长 ≤15s
 *   - 音频 wav/mp3 / [2,15] 秒 / 单个 ≤15MB
 *   - 创建后需轮询 status 变 Active(通常几秒到几十秒)
 *
 * 不进 BaseProvider 体系:不走 Cost Ledger(素材库通常免费,无单价)。
 *
 * 兼容性提示:不同中转站的 /assets 接口字段命名可能略有差异。本实现按
 * "url + asset_type + group_id" 这一最常见命名编写,接其他中转站时若字段
 * 不同,直接 fork 这个文件改字段即可(切勿在此处加 if-else 分支膨胀)。
 */
import { request } from 'undici';

import { prisma } from '@ss/db';
import { ProviderError } from '@ss/shared';

import { decryptSecret } from '../src/crypto.js';

export type RelayAssetType = 'Image' | 'Video' | 'Audio';
export type RelayAssetStatus = 'Active' | 'Processing' | 'Failed';

export interface RelayAsset {
  id: string;
  assetUrl: string; // 'asset://asset-XXXXX'
  status: RelayAssetStatus;
  assetType?: RelayAssetType;
  name?: string;
  /** 中转站端的临时签名 URL(通常 12h 有效) */
  url?: string;
  createTime?: string;
  updateTime?: string;
}

export interface RelayCreateAssetOpts {
  /** 公网可访问的文件 URL — 中转站服务端会下载(签名 URL OK,只要 12h+ 有效) */
  url: string;
  assetType: RelayAssetType;
  /** 必填,需先用中转站后台 UI / API 创建 group 拿到 group_id */
  groupId: number;
  /** 上限 64 字符 */
  name?: string;
}

export interface RelayListAssetOpts {
  pageNumber?: number;
  pageSize?: number;
  statuses?: RelayAssetStatus[];
  name?: string;
  /** -2 = 仅历史 / <=0 = 当前 token 全部+历史 / >0 = 指定 group(具体看中转站文档) */
  groupId?: number;
}

export class RelayAssetProvider {
  constructor(
    private readonly apiUrl: string, // e.g. 'https://<your-relay-host>/v1'
    private readonly apiKey: string,
  ) {}

  /**
   * 创建素材 — 中转站服务端会下载 url,故 url 必须公网可访问
   *
   * 返回时素材通常还在 Processing 状态,需调 getAsset 轮询到 Active 才能用于视频生成。
   * 但对于"用就立刻视频生成"的场景,可一次性传 asset_url(中转站内部会等)。
   */
  async createAsset(opts: RelayCreateAssetOpts): Promise<{ id: string; assetUrl: string }> {
    const { statusCode, body } = await request(`${this.apiUrl}/assets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        url: opts.url,
        asset_type: opts.assetType,
        group_id: opts.groupId,
        name: opts.name,
      }),
      bodyTimeout: 60_000,
      headersTimeout: 30_000,
    });
    const text = await body.text();
    if (statusCode >= 400) {
      throw new ProviderError(
        'relay-assets',
        `createAsset failed (${statusCode}): ${text.slice(0, 300)}`,
      );
    }
    const json = JSON.parse(text) as {
      code?: string;
      data?: { id?: string; asset_url?: string };
      message?: string;
    };
    if (json.code !== 'success' || !json.data?.id || !json.data?.asset_url) {
      throw new ProviderError(
        'relay-assets',
        `createAsset response error: ${json.message ?? text.slice(0, 300)}`,
      );
    }
    return { id: json.data.id, assetUrl: json.data.asset_url };
  }

  /** 查询单个素材(轮询等 Active 用) */
  async getAsset(id: string): Promise<RelayAsset | null> {
    const { statusCode, body } = await request(`${this.apiUrl}/assets/get`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ id }),
      bodyTimeout: 30_000,
      headersTimeout: 15_000,
    });
    const text = await body.text();
    if (statusCode === 404) return null;
    if (statusCode >= 400) {
      throw new ProviderError(
        'relay-assets',
        `getAsset failed (${statusCode}): ${text.slice(0, 300)}`,
      );
    }
    const json = JSON.parse(text) as {
      code?: string;
      data?: {
        id: string;
        asset_url: string;
        status: RelayAssetStatus;
        asset_type?: RelayAssetType;
        name?: string;
        url?: string;
        create_time?: string;
        update_time?: string;
      };
    };
    if (json.code !== 'success' || !json.data) return null;
    return {
      id: json.data.id,
      assetUrl: json.data.asset_url,
      status: json.data.status,
      assetType: json.data.asset_type,
      name: json.data.name,
      url: json.data.url,
      createTime: json.data.create_time,
      updateTime: json.data.update_time,
    };
  }

  /** 分页查素材(admin/library 调试 / 同步状态用) */
  async listAssets(opts: RelayListAssetOpts = {}): Promise<{ items: RelayAsset[]; total: number }> {
    const { statusCode, body } = await request(`${this.apiUrl}/assets/list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        page_number: opts.pageNumber ?? 1,
        page_size: opts.pageSize ?? 20,
        statuses: opts.statuses,
        name: opts.name,
        group_id: opts.groupId,
      }),
      bodyTimeout: 30_000,
      headersTimeout: 15_000,
    });
    const text = await body.text();
    if (statusCode >= 400) {
      throw new ProviderError(
        'relay-assets',
        `listAssets failed (${statusCode}): ${text.slice(0, 300)}`,
      );
    }
    const json = JSON.parse(text) as {
      code?: string;
      data?: { items: Array<Record<string, unknown>>; total_count: number };
    };
    const items = (json.data?.items ?? []).map((r) => ({
      id: String(r.id),
      assetUrl: String(r.asset_url),
      status: r.status as RelayAssetStatus,
      assetType: r.asset_type as RelayAssetType | undefined,
      name: r.name as string | undefined,
      url: r.url as string | undefined,
      createTime: r.create_time as string | undefined,
      updateTime: r.update_time as string | undefined,
    }));
    return { items, total: Number(json.data?.total_count ?? 0) };
  }

  /** 删除素材 — 仅当前 token 可见的素材 */
  async deleteAsset(id: string): Promise<void> {
    const { statusCode, body } = await request(`${this.apiUrl}/assets/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ id }),
      bodyTimeout: 30_000,
      headersTimeout: 15_000,
    });
    if (statusCode >= 400) {
      const text = await body.text();
      throw new ProviderError(
        'relay-assets',
        `deleteAsset failed (${statusCode}): ${text.slice(0, 300)}`,
      );
    }
  }
}

/**
 * Factory:从 ProviderConfig 找第一个 active 的 relay-* provider 拉 token。
 *
 * OpenAI 兼容中转站通常单 token 覆盖全部模型(包括素材库),所以复用 relay-claude /
 * relay-doubao 等任何 active provider 的 apiKey 即可。无需为素材库单独建 ProviderConfig。
 *
 * 返回 null:无 active 中转站 provider,调用方应跳过素材库同步(回退到本地存储 URL)。
 */
export async function getRelayAssetProvider(): Promise<RelayAssetProvider | null> {
  const cfg = await prisma.providerConfig.findFirst({
    where: {
      providerId: { startsWith: 'relay-' },
      isActive: true,
    },
    orderBy: { updatedAt: 'desc' }, // 最近改的优先(通常是最新 active 的)
    select: { providerId: true, apiUrl: true, apiKeyEnc: true, apiKeyRef: true },
  });
  if (!cfg) return null;

  let apiKey = '';
  if (cfg.apiKeyEnc) {
    try {
      apiKey = decryptSecret(cfg.apiKeyEnc);
    } catch (e) {
      console.error(`[relay-asset] decrypt failed for ${cfg.providerId}:`, e);
    }
  }
  if (!apiKey && cfg.apiKeyRef) {
    apiKey = process.env[cfg.apiKeyRef] ?? '';
  }
  if (!apiKey) return null;
  // apiUrl 若为空(seed 默认填了示例)用户必须在 admin 后台显式填中转站 base URL
  if (!cfg.apiUrl) return null;

  return new RelayAssetProvider(cfg.apiUrl, apiKey);
}

/**
 * 读取中转站素材库默认 group_id(SystemSetting `relay.assets.default_group_id`)
 * 未配 / ≤0 → 返 null,调用方应跳过素材库同步
 *
 * Group 创建流程:用户在中转站后台(playground / token / assets 页)选 token → 创建分组,
 * 拿到 group_id 后在 /admin/settings 把 group_id 填到 `relay.assets.default_group_id`。
 */
export async function getRelayDefaultGroupId(): Promise<number | null> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: 'relay.assets.default_group_id' },
    select: { value: true },
  });
  const n = Number(row?.value ?? '0');
  return Number.isFinite(n) && n > 0 ? n : null;
}
