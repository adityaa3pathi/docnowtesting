# DocNow Doctor Consultation - Testing Guide

**Status**: Both servers running
- API: http://localhost:5000
- Web: http://localhost:3001

## Full End-to-End Flow

### Step 1: Create Super Admin Account
First, you need a super admin to approve doctors.

1. Go to http://localhost:3001
2. Click "Sign Up" or "Login"
3. Create an account with your email
4. Manually set this user as SUPER_ADMIN in the database

**Database command** (run in another terminal):
```bash
cd /home/cosmo/projects/Aditya_projects/docnowtesting/server
npx prisma studio
```
Then find your user and change `role` to `SUPER_ADMIN`.

### Step 2: Create Specialty
Doctors need a specialty to apply under.

1. Login as super admin
2. Go to http://localhost:3001/super-admin/consult-specialties
3. Create at least one specialty (e.g., "General Medicine", "Cardiology", etc.)

### Step 3: Set Consultation Rules
Configure pricing and rules.

1. Go to http://localhost:3001/super-admin/consult-rules
2. Set:
   - Slot duration (e.g., 30 minutes)
   - Pricing per consultation
   - Cancellation rules
   - Any other business rules

### Step 4: Doctor Application
Now create a doctor account.

**Option A: Apply through the web**
1. Logout from super admin
2. Go to http://localhost:3001/doctor/apply
3. Fill in:
   - Medical registration number
   - Specialty
   - Qualifications
   - Experience
   - Bio
4. Submit application

**Option B: Create directly as admin**
1. Login as super admin
2. Go to http://localhost:3001/super-admin/consult-doctors/new
3. Fill in doctor details and set status to ACTIVE

### Step 5: Approve Doctor Application
If you used Option A:

1. Login as super admin
2. Go to http://localhost:3001/super-admin/consult-review
3. Review the pending application
4. Approve it

### Step 6: Doctor Sets Availability
1. Logout and login as the doctor
2. Go to http://localhost:3001/doctor/availability
3. Set weekly hours:
   - Select days of the week
   - Set time slots for each day
4. Save availability

### Step 7: Patient Finds Doctor
1. Logout (or use incognito/another browser)
2. Create a new regular user account
3. Go to http://localhost:3001/consult
4. Browse available doctors
5. Click on the doctor to see their profile

### Step 8: Book Consultation
1. On doctor profile page: http://localhost:3001/consult/doctors/[doctor-id]
2. Select an available time slot
3. Click "Book Consultation"
4. Fill in patient details if needed
5. Proceed to payment

### Step 9: Payment
1. Review booking details
2. Select payment method (Razorpay test mode)
3. Complete payment

**Test card details** (Razorpay test mode):
- Card: 4111 1111 1111 1111
- CVV: any 3 digits
- Expiry: any future date

### Step 10: Join Video Call (Patient)
1. Go to http://localhost:3001/consult/my
2. Find your upcoming consultation
3. When it's time (or close to time), click "Join Call"
4. Allow camera and microphone permissions
5. Wait for doctor to join

### Step 11: Join Video Call (Doctor)
1. Login as the doctor
2. Go to http://localhost:3001/doctor/consultations
3. Find the scheduled consultation
4. Click "Join Room"
5. The video call interface should appear (LiveKit)

### Step 12: Write Prescription (Doctor)
During or after the consultation:

1. In the doctor's consultation room
2. Click "Write Prescription"
3. Fill in:
   - Diagnosis
   - Medications (name, dosage, frequency, duration)
   - Instructions
   - Follow-up notes
4. Save prescription

### Step 13: View Prescription (Patient)
1. As patient, go to consultation details
2. View the prescription
3. Download or print if needed

## Additional Features to Test

### No-Shows
- Book a consultation and don't join
- System should automatically mark as no-show after consultation time passes
- Check WhatsApp reminder was sent (if configured)

### Prescription Corrections
- Doctor can void a prescription and issue a corrected version
- Patient should see the latest version

### Doctor Leave
1. Login as doctor
2. Go to http://localhost:3001/doctor/leave
3. Mark dates as unavailable
4. Patients shouldn't be able to book those dates

### Admin Monitoring
1. Login as super admin
2. View all appointments: http://localhost:3001/super-admin/consult-appointments
3. Click on individual appointments to see details
4. Monitor doctor performance metrics

### Notifications
Check if WhatsApp notifications are sent for:
- Booking confirmation
- Reminder before consultation
- No-show notifications
- Prescription ready

## Troubleshooting

### Video call not working
- Check LiveKit credentials in server/.env
- Ensure ports 5000 and 3001 are accessible
- Check browser console for errors

### Payment failing
- Verify Razorpay test keys in server/.env
- Use test card numbers only
- Check server logs for webhook errors

### Database issues
Run Prisma Studio to inspect data:
```bash
cd server
npx prisma studio
```

## Log Files
- Server: /home/cosmo/projects/Aditya_projects/docnowtesting/server.log
- Client: /home/cosmo/projects/Aditya_projects/docnowtesting/client.log

## Stop Servers
```bash
# Find PIDs
ps aux | grep -E "(next dev|nodemon)" | grep -v grep

# Kill them
kill [PID]
```
