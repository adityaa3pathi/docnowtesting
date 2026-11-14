-- NMC telemedicine consent ticked at sign-up (covers the account holder's own consultations).
ALTER TABLE "User" ADD COLUMN "telemedicineConsentAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "telemedicineConsentVersion" TEXT;
