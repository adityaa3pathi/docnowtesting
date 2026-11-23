-- Promo codes on consultations: doctor / specialty limits, the code and discount on a consultation,
-- and its redemption. Needs the consultation tables (staging only until consult launches).
CREATE TABLE "PromoCodeScope" (
    "id" TEXT NOT NULL,
    "promoCodeId" TEXT NOT NULL,
    "doctorId" TEXT,
    "specialtyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoCodeScope_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PromoCodeScope_doctorId_idx" ON "PromoCodeScope"("doctorId");
CREATE INDEX "PromoCodeScope_specialtyId_idx" ON "PromoCodeScope"("specialtyId");
CREATE UNIQUE INDEX "PromoCodeScope_promoCodeId_doctorId_key" ON "PromoCodeScope"("promoCodeId", "doctorId");
CREATE UNIQUE INDEX "PromoCodeScope_promoCodeId_specialtyId_key" ON "PromoCodeScope"("promoCodeId", "specialtyId");

ALTER TABLE "PromoCodeScope" ADD CONSTRAINT "PromoCodeScope_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromoCodeScope" ADD CONSTRAINT "PromoCodeScope_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "DoctorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromoCodeScope" ADD CONSTRAINT "PromoCodeScope_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "Specialty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Raw SQL: exactly one of doctor and specialty per row.
ALTER TABLE "PromoCodeScope" ADD CONSTRAINT "PromoCodeScope_one_target" CHECK (("doctorId" IS NULL) <> ("specialtyId" IS NULL));

ALTER TABLE "Consultation" ADD COLUMN "promoCodeId" TEXT;
ALTER TABLE "Consultation" ADD COLUMN "discountPaise" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Raw SQL: discount and wallet part together never exceed the fee.
ALTER TABLE "Consultation" DROP CONSTRAINT "Consultation_wallet_within_fee";
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_wallet_within_fee" CHECK ("walletPaise" >= 0 AND "discountPaise" >= 0 AND "walletPaise" + "discountPaise" <= "feePaise");

ALTER TABLE "PromoRedemption" ADD COLUMN "consultationId" TEXT;
CREATE UNIQUE INDEX "PromoRedemption_consultationId_key" ON "PromoRedemption"("consultationId");
ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
