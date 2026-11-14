-- Pay on collection: the Healthians sample collector takes the payment at the home visit.
ALTER TABLE "Booking" ADD COLUMN "paymentMethod" TEXT NOT NULL DEFAULT 'ONLINE';
ALTER TABLE "Booking" ADD COLUMN "collectedAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN "collectedAmount" DOUBLE PRECISION;
