import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@ss/api';

export type ListShotsResult = inferRouterOutputs<AppRouter>['storyboard']['listShots'];
// 需求3:分镜导出格式
export type ExportFormat = 'csv' | 'txt' | 'word';

export function buildShotsCsv(data: ListShotsResult, episodeNumber: number): string {
  const groups = (data && 'groups' in data ? data.groups : undefined) ?? [];
  const ungrouped = (data && 'ungrouped' in data ? data.ungrouped : undefined) ?? [];

  // 层级列让 Excel 浏览者一眼分辨"组级合并 prompt"和"组内单镜数据"。
  // 组级 prompt = 该组送给视频模型的最终 prompt(单镜 prompt 在编辑时也存了一份原始版,导出时一并暴露便于训练审计)
  const headers = [
    '集',
    '层级',
    '组号',
    '组内序',
    '单镜号',
    '景别',
    '角度',
    '时长(s)',
    '优先级',
    '剧本内容',
    '提示词(含台词/OS)',
    '状态',
  ];

  const rows: string[][] = [];
  for (const g of groups) {
    // 先输出组级合并 prompt(导出主行,送给视频模型用的就是这条)
    rows.push([
      String(episodeNumber),
      '组级',
      g.number,
      '—',
      '—',
      '—',
      '—',
      g.durationS.toFixed(1),
      '—',
      '—',
      g.prompt,
      g.status,
    ]);
    // 再输出组内每个单镜的细节(训练审计用)
    g.shots.forEach((s, i) => {
      rows.push([
        String(episodeNumber),
        '子镜',
        g.number,
        `${i + 1}/${g.shots.length}`,
        s.number,
        s.framing ?? '',
        s.angle ?? '',
        s.durationS.toFixed(1),
        s.priority ?? '',
        s.content,
        s.prompt,
        s.status,
      ]);
    });
  }
  // 未分组单镜独立列出(无"组"概念)
  for (const s of ungrouped) {
    rows.push([
      String(episodeNumber),
      '单镜',
      '(未分组)',
      '—',
      s.number,
      s.framing ?? '',
      s.angle ?? '',
      s.durationS.toFixed(1),
      s.priority ?? '',
      s.content,
      s.prompt,
      s.status,
    ]);
  }

  return [headers, ...rows].map(csvRow).join('\n');
}

function csvRow(cells: string[]): string {
  return cells
    .map((c) => {
      const needsQuote = /[",\n]/.test(c);
      const escaped = c.replace(/"/g, '""');
      return needsQuote ? `"${escaped}"` : escaped;
    })
    .join(',');
}

// 需求3:TXT 导出 — 可读纯文本结构(组 → 组级 prompt → 各单镜)
export function buildShotsText(data: ListShotsResult, episodeNumber: number): string {
  const groups = (data && 'groups' in data ? data.groups : undefined) ?? [];
  const ungrouped = (data && 'ungrouped' in data ? data.ungrouped : undefined) ?? [];
  const lines: string[] = [`第${episodeNumber}集 分镜表`, '='.repeat(28), ''];
  const shotLines = (
    s: { number: string; framing?: string | null; angle?: string | null; durationS: number; priority?: string | null; content: string; prompt: string },
  ): void => {
    lines.push(`  · 镜${s.number} [${s.framing ?? ''}/${s.angle ?? ''}] ${s.durationS.toFixed(1)}s ${s.priority ?? ''}`);
    lines.push(`    剧本: ${s.content}`);
    lines.push(`    提示词: ${s.prompt}`);
  };
  for (const g of groups) {
    lines.push(`【组 ${g.number}】 时长 ${g.durationS.toFixed(1)}s · 状态 ${g.status}`);
    lines.push(`组级提示词: ${g.prompt}`);
    g.shots.forEach(shotLines);
    lines.push('');
  }
  if (ungrouped.length > 0) {
    lines.push('【未分组单镜】');
    ungrouped.forEach(shotLines);
  }
  return lines.join('\n');
}

// 需求3:Word 导出 — HTML 表格(Word 可直接打开 .doc),含组级 prompt + 单镜明细
export function buildShotsHtml(data: ListShotsResult, episodeNumber: number): string {
  const groups = (data && 'groups' in data ? data.groups : undefined) ?? [];
  const ungrouped = (data && 'ungrouped' in data ? data.ungrouped : undefined) ?? [];
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>');
  const td = (...cells: string[]): string =>
    `<tr>${cells
      .map((c) => `<td style="border:1px solid #999;padding:4px;font-size:11px;vertical-align:top">${esc(c)}</td>`)
      .join('')}</tr>`;
  const rows: string[] = [];
  for (const g of groups) {
    rows.push(td(`组 ${g.number}`, '组级', '—', g.durationS.toFixed(1), '—', g.prompt, g.status));
    g.shots.forEach((s, i) =>
      rows.push(
        td(`${g.number}-${i + 1}`, `${s.framing ?? ''}/${s.angle ?? ''}`, s.number, s.durationS.toFixed(1), s.priority ?? '', `${s.content}\n${s.prompt}`, s.status),
      ),
    );
  }
  for (const s of ungrouped) {
    rows.push(
      td('单镜', `${s.framing ?? ''}/${s.angle ?? ''}`, s.number, s.durationS.toFixed(1), s.priority ?? '', `${s.content}\n${s.prompt}`, s.status),
    );
  }
  const headers = ['组/镜', '景别/角度', '镜号', '时长(s)', '优先级', '内容/提示词', '状态']
    .map((h) => `<th style="border:1px solid #999;padding:4px;background:#eee">${h}</th>`)
    .join('');
  return `<h2>第${episodeNumber}集 分镜表</h2><table style="border-collapse:collapse;width:100%"><tr>${headers}</tr>${rows.join('')}</table>`;
}

export function wrapWordHtml(title: string, body: string): string {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
}

export function downloadFile(content: string, filename: string, mime: string): void {
  // BOM 让 Excel 正确识别 UTF-8
  const blob = new Blob(['﻿' + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
