import { describe, expect, it } from 'vitest';

import { extractScriptText, ACCEPTED_FILE_EXTS } from './script-extract.js';

describe('extractScriptText', () => {
  it('支持 .txt — 原文返回，规范化换行', async () => {
    const buf = Buffer.from('1-1 日 内 房间\r\n△角色 A 进入。\n\n\n陆乘：你好', 'utf-8');
    const r = await extractScriptText(buf, 'episode-01.txt');
    expect(r.format).toBe('txt');
    expect(r.text).toContain('1-1 日 内 房间');
    expect(r.text).toContain('陆乘：你好');
    // \r\n 应被规范化为 \n
    expect(r.text).not.toMatch(/\r/);
    // 3+ 换行被压成 2 个
    expect(r.text).not.toMatch(/\n{3,}/);
  });

  it('支持 .md — 去掉标题/加粗/列表标记', async () => {
    const md = `# 剧本标题

## 1-1 日 内 房间

- △陆乘走入。
* **陆乘**（害怕）：你好

\`\`\`
忽略这块代码
\`\`\`

[参考链接](https://x.com) 末尾`;
    const buf = Buffer.from(md, 'utf-8');
    const r = await extractScriptText(buf, 'a.md');
    expect(r.format).toBe('md');
    expect(r.text).toContain('1-1 日 内 房间');
    expect(r.text).toContain('△陆乘走入');
    expect(r.text).toContain('陆乘（害怕）：你好');
    expect(r.text).not.toContain('**');
    expect(r.text).not.toContain('#');
    expect(r.text).not.toContain('```');
    expect(r.text).not.toContain('忽略这块代码');
  });

  it('支持 .markdown 同 .md', async () => {
    const buf = Buffer.from('# Hi\n正文', 'utf-8');
    const r = await extractScriptText(buf, 'x.markdown');
    expect(r.format).toBe('md');
    expect(r.text).not.toContain('#');
    expect(r.text).toContain('Hi');
    expect(r.text).toContain('正文');
  });

  it('支持 .rtf — 去掉控制码保留文字', async () => {
    const rtf =
      String.raw`{\rtf1\ansi\deff0 ` +
      String.raw`{\fonttbl{\f0 Songti SC;}}` +
      String.raw`\f0\fs24 1-1 日 内 房间\par ` +
      String.raw`\b 陆乘\b0 ：你好} `;
    const buf = Buffer.from(rtf, 'utf-8');
    const r = await extractScriptText(buf, 'x.rtf');
    expect(r.format).toBe('rtf');
    expect(r.text).toContain('1-1 日 内 房间');
    expect(r.text).toContain('陆乘');
    expect(r.text).toContain('你好');
    expect(r.text).not.toContain('\\rtf1');
    expect(r.text).not.toContain('fonttbl');
  });

  it('支持 .html — 去掉标签,<br>/</p> 换行', async () => {
    const html =
      '<html><head><style>.x{}</style></head><body>' +
      '<p>1-1 日 内 房间</p>' +
      '<p>陆乘：<b>你好</b><br>世界</p>' +
      '<script>alert(1)</script>' +
      '</body></html>';
    const buf = Buffer.from(html, 'utf-8');
    const r = await extractScriptText(buf, 'x.html');
    expect(r.format).toBe('html');
    expect(r.text).toContain('1-1 日 内 房间');
    expect(r.text).toContain('陆乘');
    expect(r.text).toContain('你好');
    expect(r.text).toContain('世界');
    expect(r.text).not.toContain('alert');
    expect(r.text).not.toContain('<');
  });

  it('支持 .htm 同 .html', async () => {
    const buf = Buffer.from('<p>X</p>', 'utf-8');
    const r = await extractScriptText(buf, 'a.htm');
    expect(r.format).toBe('html');
    expect(r.text).toBe('X');
  });

  it('不支持的扩展名抛出明确错误', async () => {
    await expect(extractScriptText(Buffer.from('x'), 'x.pdf')).rejects.toThrow(/不支持的文件格式: \.pdf/);
    await expect(extractScriptText(Buffer.from('x'), 'noext')).rejects.toThrow(/无扩展名/);
  });

  it('去 UTF-8 BOM + 收尾空白', async () => {
    const buf = Buffer.from('﻿1-1 日 内 房间\n\n\n', 'utf-8');
    const r = await extractScriptText(buf, 'a.txt');
    expect(r.text.startsWith('1-1')).toBe(true);
    expect(r.text.endsWith('房间')).toBe(true);
  });

  it('HTML 嵌套标签绕过 `<scrip<script>t>` 仍能完全去除', async () => {
    const evil = '<scrip<script>t>alert(1)</scri</script>pt>正文内容';
    const buf = Buffer.from(evil, 'utf-8');
    const r = await extractScriptText(buf, 'a.html');
    expect(r.text).not.toContain('script');
    expect(r.text).not.toContain('<');
    expect(r.text).not.toContain('>');
    expect(r.text).toContain('正文内容');
  });

  it('RTF 嵌套 group `{\\fonttbl{\\f0 X;}}` 整段丢', async () => {
    const rtf =
      String.raw`{\rtf1\ansi` +
      String.raw`{\fonttbl{\f0 Songti SC;}{\f1 Helvetica;}}` +
      String.raw`{\colortbl;\red0\green0\blue0;}` +
      String.raw`\f0 1-1 日 内 房间\par 陆乘：你好} `;
    const buf = Buffer.from(rtf, 'utf-8');
    const r = await extractScriptText(buf, 'a.rtf');
    expect(r.text).toContain('1-1 日 内 房间');
    expect(r.text).toContain('陆乘');
    expect(r.text).toContain('你好');
    expect(r.text).not.toContain('Songti');
    expect(r.text).not.toContain('Helvetica');
    expect(r.text).not.toContain('fonttbl');
    expect(r.text).not.toContain('colortbl');
  });

  it('ACCEPTED_FILE_EXTS 覆盖所有支持格式', () => {
    expect(ACCEPTED_FILE_EXTS).toContain('.docx');
    expect(ACCEPTED_FILE_EXTS).toContain('.txt');
    expect(ACCEPTED_FILE_EXTS).toContain('.md');
    expect(ACCEPTED_FILE_EXTS).toContain('.rtf');
    expect(ACCEPTED_FILE_EXTS).toContain('.html');
  });
});
