'use client';
import * as React from 'react';
import { Eye, X } from 'lucide-react';

/**
 * 七二第九波(用户③ + 全覆盖):图像大图预览 lightbox — 全屏遮罩 + 居中大图(比屏幕稍小)。
 * 用于美术工坊资产卡 / 生成候选卡 / 已确认槽位 / 关键帧候选 等所有「图像生成+预览」界面。
 * 关闭:点遮罩 / 点图本身 / 右上角 X / 键盘 ESC。沿用本仓库手写 overlay 约定(非 Radix Dialog)。
 */
export function ImageLightbox({
  url,
  alt,
  onClose,
}: {
  url: string;
  alt?: string;
  onClose: () => void;
}): React.ReactElement {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt ? `预览:${alt}` : '图片预览'}
      onClick={onClose}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
    >
      <button
        type="button"
        title="关闭预览"
        aria-label="关闭预览"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/25"
      >
        <X className="size-5" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt ?? ''}
        onClick={onClose}
        className="max-h-[88vh] max-w-[88vw] cursor-zoom-out rounded-lg object-contain shadow-2xl"
      />
    </div>
  );
}

/**
 * 配套「预览」图标按钮 —— 放在图片容器右上角(容器需 `group` class 才有 hover 显现效果)。
 * onClick 自带 stopPropagation,防触发父级(卡片 onClick / 设为槽位等)。
 */
export function ImagePreviewButton({
  onOpen,
  className,
}: {
  onOpen: () => void;
  className?: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      title="预览大图"
      aria-label="预览大图"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      className={
        className ??
        'rounded-full bg-black/45 p-1 text-white opacity-0 backdrop-blur-sm transition hover:bg-black/65 focus:opacity-100 group-hover:opacity-100'
      }
    >
      <Eye className="size-3.5" />
    </button>
  );
}
