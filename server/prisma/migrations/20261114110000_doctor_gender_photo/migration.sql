-- Doctor gender (asked at onboarding) and the stored photo file behind photoUrl.
ALTER TABLE "DoctorProfile" ADD COLUMN "gender" TEXT;
ALTER TABLE "DoctorProfile" ADD COLUMN "photoKey" TEXT;
