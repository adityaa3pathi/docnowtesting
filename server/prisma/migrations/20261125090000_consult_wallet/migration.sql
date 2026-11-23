-- Consultations paid partly or fully from the DocNow wallet. Additive: existing payments are Razorpay.
ALTER TYPE "ConsultPaymentStatus" ADD VALUE 'RELEASED';

CREATE TYPE "ConsultPaymentSource" AS ENUM ('RAZORPAY', 'WALLET');

ALTER TABLE "ConsultationPayment" ADD COLUMN "source" "ConsultPaymentSource" NOT NULL DEFAULT 'RAZORPAY';
ALTER TABLE "ConsultationPayment" ALTER COLUMN "razorpayOrderId" DROP NOT NULL;
ALTER TABLE "Consultation" ADD COLUMN "walletPaise" INTEGER NOT NULL DEFAULT 0;

-- Raw SQL (Prisma cannot express it): one wallet part per consultation, and a Razorpay part always has an order.
CREATE UNIQUE INDEX "ConsultationPayment_one_wallet_part" ON "ConsultationPayment"("consultationId") WHERE "source" = 'WALLET';
ALTER TABLE "ConsultationPayment" ADD CONSTRAINT "ConsultationPayment_razorpay_has_order" CHECK ("source" = 'WALLET' OR "razorpayOrderId" IS NOT NULL);
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_wallet_within_fee" CHECK ("walletPaise" >= 0 AND "walletPaise" <= "feePaise");
