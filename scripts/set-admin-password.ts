/**
 * 工具脚本：设置或重置某用户密码
 *
 * 用法:
 *   npx tsx scripts/set-admin-password.ts [email] [newPassword]
 *
 * 默认: admin@starsalign.local / admin123
 */
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const email = process.argv[2] ?? 'admin@starsalign.local';
const password = process.argv[3] ?? 'admin123';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.update({
    where: { email },
    data: { passwordHash: hash, status: 'ACTIVE' },
  });
  console.log('✅ 密码已设置');
  console.log(`   邮箱:    ${user.email}`);
  console.log(`   用户名:  ${user.username}`);
  console.log(`   状态:    ${user.status}`);
  console.log(`   isAdmin: ${user.isAdmin}`);
  console.log(`   新密码:  ${password}`);
}

main()
  .catch((e) => {
    console.error('❌ 失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
