ALTER TYPE "ManagerOrderStatus" ADD VALUE 'CANCELLED';

ALTER TABLE "ManagerOrder"
ADD COLUMN "cancellationReason" TEXT;
