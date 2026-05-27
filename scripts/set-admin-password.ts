/**
 * 工具脚本：设置或重置某用户密码
 *
 * 用法:
 *   npx tsx scripts/set-admin-password.ts <email> <newPassword>
 *
 * 7 轮 audit A6:强制传 password,不再 fallback 弱默认 'admin123'。
 * 误跑时立即报错而非静默重置成弱密码。
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../packages/db/src/index.js';

const email = process.argv[2] ?? 'admin@starsalign.local';
const password = process.argv[3];

// 强制传参 + 强密度校验(跟 auth.signup zod 对齐)
if (!password) {
  console.error('❌ 必须传 password 参数:');
  console.error('   npx tsx scripts/set-admin-password.ts <email> <newPassword>');
  console.error('');
  console.error('   要求:8 字符以上 + 含字母 + 含数字');
  process.exit(1);
}
if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
  console.error('❌ 密码强度不足:必须 8 字符以上 + 含字母 + 含数字');
  process.exit(1);
}

async function main(): Promise<void> {
  const hash = await bcrypt.hash(password!, 10);
  const user = await prisma.user.update({
    where: { email },
    data: { passwordHash: hash, status: 'ACTIVE' },
  });
  console.log('✅ 密码已设置');
  console.log(`   邮箱:    ${user.email}`);
  console.log(`   用户名:  ${user.username}`);
  console.log(`   状态:    ${user.status}`);
  console.log(`   isAdmin: ${user.isAdmin}`);
  // A6:不再回显明文密码,只显示后 4 位掩码
  console.log(`   新密码:  ••••${password!.slice(-4)}(请妥善保管,不再回显完整密码)`);
}

main()
  .catch((e) => {
    console.error('❌ 失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
