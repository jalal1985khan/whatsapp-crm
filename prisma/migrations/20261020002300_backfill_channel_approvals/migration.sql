WITH prior_approvals AS (
  SELECT DISTINCT ON ("targetId")
    "targetId",
    "actorUserId",
    "createdAt"
  FROM "AuditEvent"
  WHERE "targetType" = 'CHANNEL_NUMBER'
    AND "action" = 'CHANNEL_NUMBER_APPROVE'
    AND "actorUserId" IS NOT NULL
    AND COALESCE("after"->>'state', '') IN ('Active', 'ACTIVE')
  ORDER BY "targetId", "createdAt" DESC
)
UPDATE "ChannelNumber" AS n
SET "approvedByUserId" = approval."actorUserId",
    "approvedAt" = approval."createdAt"
FROM prior_approvals AS approval
WHERE n."id" = approval."targetId"
  AND n."state" = 'ACTIVE'
  AND n."metaPhoneNumberId" IS NOT NULL
  AND n."metaWabaId" IS NOT NULL
  AND n."approvedByUserId" IS NULL;
