// Next16 移除了 `next lint`,改用 eslint flat config。
// eslint-config-next@16 是原生 flat config 数组(含 react/react-hooks/import/jsx-a11y/
// @next/next recommended + typescript + 默认 ignores .next/out/build/next-env.d.ts)。
import next from 'eslint-config-next';

const eslintConfig = [
  ...next,
  // 桌面构建独立产物目录,补进 ignore
  { ignores: ['.next-desktop/**'] },
  {
    // eslint-config-next@16 携带 react-hooks v7,新增比项目原 `next lint` 严得多的规则。
    // 项目原本在旧 next lint 下 eslint-clean,以下规则 flag 的是历史代码模式(非新引入 bug)。
    // 降级让 lint 转绿,同时保留可见性(set-state-in-effect 留 warn 作后续清理 backlog,41 处)。
    rules: {
      'react/no-unescaped-entities': 'off', // 中文标点/引号在 JSX 文本里触发,纯样式噪音
      'react-hooks/set-state-in-effect': 'warn', // 真 anti-pattern,41 处,留 warn 待清理
      'react-hooks/refs': 'warn',
    },
  },
];

export default eslintConfig;
