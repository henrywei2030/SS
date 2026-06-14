import { Agent, setGlobalDispatcher } from 'undici';

// undici v8 默认开启 HTTP/2(allowH2:true,PR #4828)。本仓所有 provider/中转站出站此前按
// HTTP/1.1 调优(连接复用 / pipelining:1 / SSE 流式 / connect 60s + body/headers 300s),
// 且中转站对 H2 支持参差 + llhttp v9 严格解析。设进程级默认 dispatcher:关 H2 + 标准长超时,
// 覆盖所有未显式传 dispatcher 的 undici.request(relay-asset / image / embedding 裸调用)。
// 命名 dispatcher(openai-compat / claude / seedance)各自也已显式 allowH2:false。
// 副作用导入:在用到裸 request 的 provider 文件顶部 `import './http-defaults.js'` 即可。
const defaultDispatcher = new Agent({
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  connections: 32,
  pipelining: 1,
  connect: { timeout: 60_000 },
  bodyTimeout: 300_000,
  headersTimeout: 300_000,
  allowH2: false,
});

setGlobalDispatcher(defaultDispatcher);
