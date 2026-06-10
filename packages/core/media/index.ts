/**
 * @ss/core/media — 媒体处理(M0 基建)
 *
 * ⚠️ 仅服务端(child_process + 平台二进制),不要从 @ss/core 根 index 再导出,
 *   防被 edge bundle 误拉(六二 instrumentation pg 同款坑)。
 */
export * from './ffmpeg.js';
