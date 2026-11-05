-- A failed refund frees its amount for another refund only once Razorpay has confirmed the failure.
ALTER TABLE "ConsultationRefund" ADD COLUMN "failureConfirmed" BOOLEAN NOT NULL DEFAULT false;
