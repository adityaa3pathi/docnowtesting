# DocNow - Fresh Setup Guide

## Prerequisites
- Node.js 18+ (v24.19.0 recommended)
- PostgreSQL 14+
- npm or yarn

## 1. Clone Repository
```bash
git clone <repo-url>
cd docnowtesting
```

## 2. Install Dependencies

### Server
```bash
cd server
npm install
```

### Client
```bash
cd ../client
npm install
```

## 3. Database Setup

### Option A: Use existing cloud database
Copy the `.env` file from this machine (has Aiven cloud connection).

### Option B: Local PostgreSQL
Create a new database:
```bash
createdb docnow_test
```

Create `server/.env`:
```env
DATABASE_URL="postgresql://username:password@localhost:5432/docnow_test"
JWT_SECRET="your-secret-key-min-32-chars-long"
REFRESH_TOKEN_SECRET="another-secret-key-min-32-chars"
NODE_ENV=development

# Razorpay (test keys)
RAZORPAY_KEY_ID=your_test_key
RAZORPAY_KEY_SECRET=your_test_secret

# LiveKit (for video calls)
LIVEKIT_API_KEY=your_livekit_key
LIVEKIT_API_SECRET=your_livekit_secret
LIVEKIT_URL=wss://your-livekit-url

# S3 for reports (optional for testing)
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_S3_BUCKET=
AWS_REGION=
```

Create `client/.env`:
```env
NEXT_PUBLIC_API_URL=http://localhost:5000/api
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=
```

## 4. Run Migrations
```bash
cd server
npx prisma migrate deploy
npx prisma generate
```

## 5. Seed Test Data (Optional)
```bash
npx prisma db seed
```

## 6. Start Servers

### Terminal 1 - Server
```bash
cd server
npm run dev
```
Server runs on http://localhost:5000

### Terminal 2 - Client
```bash
cd client
npm run dev
```
Client runs on http://localhost:3000

## 7. Create Super Admin

### Option A: Via Prisma Studio
```bash
cd server
npx prisma studio
```
1. Open http://localhost:5555
2. Go to User table
3. Find your user (create account first on web)
4. Change `role` to `SUPER_ADMIN`

### Option B: Direct SQL
```sql
UPDATE "User" 
SET role = 'SUPER_ADMIN' 
WHERE email = 'your@email.com';
```

## Quick Test Checklist

1. ✅ Both servers running (5000 + 3000)
2. ✅ Can access http://localhost:3000
3. ✅ Can create account
4. ✅ Super admin access set
5. ✅ Create specialty
6. ✅ Create doctor
7. ✅ Set availability
8. ✅ Book consultation
9. ✅ Join video call
10. ✅ Write prescription

## Environment Variables Reference

### Required
- `DATABASE_URL` - PostgreSQL connection
- `JWT_SECRET` - Auth token secret
- `REFRESH_TOKEN_SECRET` - Refresh token secret

### For Payment Testing
- `RAZORPAY_KEY_ID` - Get from razorpay.com test mode
- `RAZORPAY_KEY_SECRET`

### For Video Calls
- `LIVEKIT_API_KEY` - Get from livekit.io
- `LIVEKIT_API_SECRET`
- `LIVEKIT_URL`

### Optional
- `AWS_*` - For report storage (can skip for testing)
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` - For maps (can skip)

## Troubleshooting

### Port already in use
```bash
# Change ports in package.json or kill the process
lsof -ti:3000 | xargs kill
lsof -ti:5000 | xargs kill
```

### Migration errors
```bash
cd server
npx prisma migrate reset  # WARNING: Deletes all data
npx prisma migrate deploy
```

### Prisma client errors
```bash
cd server
npx prisma generate
# Restart the server
```

## Testing Without External Services

You can test most features without:
- Razorpay (skip payment, mark as paid manually in DB)
- LiveKit (video calls won't work)
- AWS S3 (reports won't upload)
- WhatsApp (notifications won't send)

Just ensure database is running and configured.
