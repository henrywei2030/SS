'use client';

/**
 * 五七-3:自适应高度文本域 —— 内容多高就长多高,完整显示不内部滚动(随容器滚动)。
 * 剧本拆解 pane / 美术工坊人物编辑 等多处复用。
 */
import * as React from 'react';

import { cn } from '@/lib/utils';

export function AutoGrowTextarea({
  value,
  onChange,
  minRows = 2,
  className,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  minRows?: number;
  /** 完整样式由调用方给(边框/圆角/字号/字体等)*/
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}): React.ReactElement {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const resize = React.useCallback((): void => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, []);
  // useLayoutEffect:DOM 更新后、绘制前同步测量(scrollHeight 已就绪),
  //   比 useEffect 可靠,修首次加载/弹窗布局时高度偏小导致内容截断。
  //   再叠一帧 rAF 兜底弹窗入场动画 / 字体异步加载后的二次测量。
  React.useLayoutEffect(() => {
    resize();
    const id = requestAnimationFrame(resize);
    return () => cancelAnimationFrame(id);
  }, [value, resize]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onInput={resize}
      rows={minRows}
      placeholder={placeholder}
      disabled={disabled}
      className={cn('resize-none overflow-hidden', className)}
    />
  );
}
