// TS6 默认开启 noUncheckedSideEffectImports,要求纯副作用 import 的模块有类型声明。
// CSS 由 Next/打包器处理(非 tsc),此处声明 *.css 为合法副作用导入模块,
// 让 `import './globals.css'` 通过类型检查(保留该 flag 对真 typo 的保护)。
declare module '*.css';
