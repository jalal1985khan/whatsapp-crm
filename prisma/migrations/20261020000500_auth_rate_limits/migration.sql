CREATE TABLE "LoginRateLimit" (
  "keyHash" TEXT NOT NULL,
  "failureCount" INTEGER NOT NULL DEFAULT 0,
  "windowStartedAt" TIMESTAMP(3) NOT NULL,
  "blockedUntil" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoginRateLimit_pkey" PRIMARY KEY ("keyHash")
);

CREATE INDEX "LoginRateLimit_updatedAt_idx" ON "LoginRateLimit"("updatedAt");
