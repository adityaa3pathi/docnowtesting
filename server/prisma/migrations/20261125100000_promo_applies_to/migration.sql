-- Where a promo code can be used. Existing codes become LAB, so live lab checkout is unchanged.
-- Touches only PromoCode: safe on its own (the prod branch lacks the consultation tables).
CREATE TYPE "PromoAppliesTo" AS ENUM ('LAB', 'CONSULT', 'BOTH');
ALTER TABLE "PromoCode" ADD COLUMN "appliesTo" "PromoAppliesTo" NOT NULL DEFAULT 'LAB';
