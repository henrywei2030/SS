/**
 * 把浏览器 File 读为纯 base64(去掉 dataURL 的 "data:...;base64," 前缀)。
 * media.upload 接受纯 base64 或 dataURL,这里统一返回纯 base64。
 * 用 FileReader 而非手写 btoa,避免大文件中间 binary string 内存峰值。
 */
export async function fileToBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('FileReader 返回非字符串'));
        return;
      }
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader 失败'));
    reader.readAsDataURL(file);
  });
}
