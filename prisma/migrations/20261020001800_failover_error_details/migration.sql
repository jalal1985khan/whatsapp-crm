ALTER TABLE "FailoverEvent"
  ADD COLUMN "providerErrorCode" INTEGER,
  ADD COLUMN "providerErrorSubcode" INTEGER,
  ADD COLUMN "httpStatus" INTEGER;
