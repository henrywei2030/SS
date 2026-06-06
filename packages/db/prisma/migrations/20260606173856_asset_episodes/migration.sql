-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "episodes" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
