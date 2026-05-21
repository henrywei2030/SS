/**
 * tRPC 客户端 — Client Components 用
 */
import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@ss/api';

export const trpc = createTRPCReact<AppRouter>();
