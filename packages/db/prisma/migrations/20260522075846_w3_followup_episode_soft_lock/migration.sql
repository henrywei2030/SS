-- AlterEnum
ALTER TYPE "EpisodeStatus" ADD VALUE 'GENERATING';

-- AlterTable
ALTER TABLE "episodes" ADD COLUMN     "generatingStartedAt" TIMESTAMP(3);
