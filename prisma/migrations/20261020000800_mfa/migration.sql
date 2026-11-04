ALTER TABLE "User"
  ADD COLUMN "mfaSecret" TEXT,
  ADD COLUMN "mfaPendingSecret" TEXT,
  ADD COLUMN "mfaRecoveryCodeHashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
