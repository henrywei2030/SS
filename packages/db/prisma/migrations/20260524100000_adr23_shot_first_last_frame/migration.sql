-- ADR-23: Shot 加 startFrameMediaId / endFrameMediaId 预留首尾帧
-- 跟 Seedance 2.0 / Veo 3.1 / Wan 2.6 FLF2V(first-last-frame to video)对齐
-- 零数据风险:nullable 字段 + ON DELETE SET NULL
ALTER TABLE "shots" ADD COLUMN     "endFrameMediaId" TEXT,
ADD COLUMN     "startFrameMediaId" TEXT;

-- CreateIndex
CREATE INDEX "shots_startFrameMediaId_idx" ON "shots"("startFrameMediaId");

-- CreateIndex
CREATE INDEX "shots_endFrameMediaId_idx" ON "shots"("endFrameMediaId");

-- AddForeignKey
ALTER TABLE "shots" ADD CONSTRAINT "shots_startFrameMediaId_fkey" FOREIGN KEY ("startFrameMediaId") REFERENCES "media_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shots" ADD CONSTRAINT "shots_endFrameMediaId_fkey" FOREIGN KEY ("endFrameMediaId") REFERENCES "media_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
