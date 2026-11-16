-- CreateTable
CREATE TABLE "PolicyRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "upstreamName" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "effect" TEXT NOT NULL,
    "conditionsJson" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "safePreviewFields" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolicyRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionRequest" (
    "id" TEXT NOT NULL,
    "publicToolName" TEXT NOT NULL,
    "upstreamName" TEXT NOT NULL,
    "upstreamToolName" TEXT NOT NULL,
    "argumentHash" TEXT NOT NULL,
    "redactedPreviewJson" JSONB NOT NULL,
    "decision" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "ruleId" TEXT,
    "ruleName" TEXT,
    "reason" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "resultSummary" TEXT,
    "errorCode" TEXT,
    "durationMs" INTEGER,

    CONSTRAINT "ActionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actionRequestId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "detailsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemoOrder" (
    "id" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "totalCents" INTEGER NOT NULL,

    CONSTRAINT "DemoOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemoRefund" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemoEmail" (
    "id" SERIAL NOT NULL,
    "orderId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActionRequest_status_idx" ON "ActionRequest"("status");

-- CreateIndex
CREATE INDEX "ActionRequest_publicToolName_idx" ON "ActionRequest"("publicToolName");

-- CreateIndex
CREATE INDEX "ActionRequest_requestedAt_idx" ON "ActionRequest"("requestedAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actionRequestId_idx" ON "AuditEvent"("actionRequestId");

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actionRequestId_fkey" FOREIGN KEY ("actionRequestId") REFERENCES "ActionRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemoRefund" ADD CONSTRAINT "DemoRefund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DemoOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemoEmail" ADD CONSTRAINT "DemoEmail_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DemoOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
