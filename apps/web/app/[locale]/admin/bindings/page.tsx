import type { Metadata } from 'next';

import { BindingsTable } from './bindings-table';

export const metadata: Metadata = { title: '模型绑定' };

export default function BindingsPage(): React.ReactElement {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">模型绑定</h1>
        <p className="text-sm text-[hsl(var(--color-muted-foreground))]">
          把"剧本分析 / 分镜生成 / 提示词生成"等业务环节统一绑定到具体 AI Provider。
          后台一处切换，所有调用自动跟随。
        </p>
      </div>
      <BindingsTable />
    </div>
  );
}
