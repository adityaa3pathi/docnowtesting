# Camps UAT Curl Guide

Use this when running DOCNOW locally and sharing API requests for the health camps UAT.

## Local Base URLs

```bash
export API_BASE="http://127.0.0.1:5000/api"
export WEB_BASE="http://127.0.0.1:3000"
```

Recommended local server start command:

```bash
cd server
APP_BASE_URL=http://localhost:3000 \
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000 \
npm run dev
```

Recommended local client start command:

```bash
cd client
npm run dev -- -H 127.0.0.1 -p 3000
```

Smoke checks:

```bash
curl -i "http://127.0.0.1:5000/"
curl -i "http://127.0.0.1:5000/health/live"
curl -I "http://127.0.0.1:3000"
```

## Auth Helpers

Use mobile client mode for UAT curls so the API returns JSON tokens instead of HttpOnly cookies.

Super-admin login:

```bash
export SUPER_ADMIN_MOBILE="<SUPER_ADMIN_MOBILE>"
export SUPER_ADMIN_PASSWORD="<SUPER_ADMIN_PASSWORD>"

curl -s -X POST "$API_BASE/auth/login/password" \
  -H "Content-Type: application/json" \
  -H "X-Client-Type: mobile" \
  -d "{
    \"mobile\": \"$SUPER_ADMIN_MOBILE\",
    \"password\": \"$SUPER_ADMIN_PASSWORD\"
  }" | tee /tmp/docnow_super_admin_login.json

export ADMIN_TOKEN="$(jq -r '.accessToken' /tmp/docnow_super_admin_login.json)"
```

Normal user login:

```bash
export USER_MOBILE="<USER_MOBILE>"
export USER_PASSWORD="<USER_PASSWORD>"

curl -s -X POST "$API_BASE/auth/login/password" \
  -H "Content-Type: application/json" \
  -H "X-Client-Type: mobile" \
  -d "{
    \"mobile\": \"$USER_MOBILE\",
    \"password\": \"$USER_PASSWORD\"
  }" | tee /tmp/docnow_user_login.json

export USER_TOKEN="$(jq -r '.accessToken' /tmp/docnow_user_login.json)"
```

Verify current user:

```bash
curl -s "$API_BASE/auth/me" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "X-Client-Type: mobile" | jq
```

## Admin: Pick Catalog Items

Camp creation needs at least one enabled catalog item UUID.

```bash
curl -s "$API_BASE/admin/catalog?enabled=true&limit=10" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Client-Type: mobile" | tee /tmp/docnow_catalog.json | jq '.items[] | {id, name, partnerCode, type, isEnabled}'

export CATALOG_ITEM_ID_1="$(jq -r '.items[0].id' /tmp/docnow_catalog.json)"
export CATALOG_ITEM_ID_2="$(jq -r '.items[1].id' /tmp/docnow_catalog.json)"
```

## Admin: Create Camp

Dates must be ISO datetime strings. Use future dates for UAT.

```bash
curl -s -X POST "$API_BASE/admin/camps" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Client-Type: mobile" \
  -d "{
    \"name\": \"UAT Wellness Camp - Jaipur\",
    \"description\": \"UAT camp for local checkout and registration testing\",
    \"location\": \"Shop No 21, Chandpole Bazar\",
    \"city\": \"Jaipur\",
    \"pincode\": \"302001\",
    \"startDate\": \"2026-08-10T04:30:00.000Z\",
    \"endDate\": \"2026-08-10T12:30:00.000Z\",
    \"price\": 499,
    \"catalogItemIds\": [\"$CATALOG_ITEM_ID_1\", \"$CATALOG_ITEM_ID_2\"]
  }" | tee /tmp/docnow_camp_create.json | jq

export CAMP_ID="$(jq -r '.id' /tmp/docnow_camp_create.json)"
```

## Public: Browse Camps

No auth required.

```bash
curl -s "$API_BASE/camps/active" | jq

curl -s "$API_BASE/camps/$CAMP_ID" | jq
```

Frontend paths:

```text
http://127.0.0.1:3000/camps
http://127.0.0.1:3000/camps/<CAMP_ID>
```

## Admin: Update Camp

```bash
curl -s -X PUT "$API_BASE/admin/camps/$CAMP_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Client-Type: mobile" \
  -d '{
    "price": 599,
    "description": "Updated during UAT"
  }' | jq
```

Replace camp items:

```bash
curl -s -X PUT "$API_BASE/admin/camps/$CAMP_ID/items" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Client-Type: mobile" \
  -d "{
    \"catalogItemIds\": [\"$CATALOG_ITEM_ID_1\"]
  }" | jq
```

List all camps:

```bash
curl -s "$API_BASE/admin/camps" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Client-Type: mobile" | jq
```

Filter camps:

```bash
curl -s "$API_BASE/admin/camps?isActive=true&city=Jaipur" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Client-Type: mobile" | jq
```

Deactivate camp:

```bash
curl -s -X DELETE "$API_BASE/admin/camps/$CAMP_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Client-Type: mobile" | jq
```

## User: Patient Setup

The checkout needs a patient ID and DOB. The frontend attempts to ensure a Self patient automatically.

```bash
curl -s -X POST "$API_BASE/profile/patients/ensure-self" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "X-Client-Type: mobile" | tee /tmp/docnow_self_patient.json | jq

export PATIENT_ID="$(jq -r '.id' /tmp/docnow_self_patient.json)"
```

If the user profile is incomplete, update it first:

```bash
curl -s -X PUT "$API_BASE/profile" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "X-Client-Type: mobile" \
  -d '{
    "gender": "Male",
    "age": 30
  }' | jq
```

List patients:

```bash
curl -s "$API_BASE/profile/patients" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "X-Client-Type: mobile" | jq
```

Create a family patient:

```bash
curl -s -X POST "$API_BASE/profile/patients" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "X-Client-Type: mobile" \
  -d '{
    "name": "UAT Patient",
    "relation": "Others",
    "age": 30,
    "gender": "Male",
    "dob": "1996-01-15"
  }' | jq
```

## User: Camp Checkout

Use a fresh idempotency key for each new checkout attempt. Reusing the same key intentionally returns the existing booking/order if it is still active.

```bash
export IDEMPOTENCY_KEY="camp-uat-$(date +%s)"

curl -s -X POST "$API_BASE/camps/checkout" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "X-Client-Type: mobile" \
  -H "X-Idempotency-Key: $IDEMPOTENCY_KEY" \
  -d "{
    \"campId\": \"$CAMP_ID\",
    \"patientId\": \"$PATIENT_ID\",
    \"dob\": \"1996-01-15\",
    \"useWallet\": false
  }" | tee /tmp/docnow_camp_checkout.json | jq
```

Expected paid checkout response:

```json
{
  "bookingId": "...",
  "razorpayOrderId": "order_...",
  "amount": 49900,
  "currency": "INR",
  "keyId": "rzp_test_..."
}
```

Expected zero-amount response, if wallet or promo fully covers the camp:

```json
{
  "bookingId": "...",
  "status": "confirmed",
  "amount": 0
}
```

Payment verification is normally completed by the Razorpay browser checkout. If you are testing that API manually, use the real values returned by Razorpay:

```bash
export BOOKING_ID="$(jq -r '.bookingId' /tmp/docnow_camp_checkout.json)"
export RAZORPAY_ORDER_ID="$(jq -r '.razorpayOrderId' /tmp/docnow_camp_checkout.json)"

curl -s -X POST "$API_BASE/payments/verify" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "X-Client-Type: mobile" \
  -d '{
    "bookingId": "'"$BOOKING_ID"'",
    "razorpay_order_id": "'"$RAZORPAY_ORDER_ID"'",
    "razorpay_payment_id": "<RAZORPAY_PAYMENT_ID>",
    "razorpay_signature": "<RAZORPAY_SIGNATURE>"
  }' | jq
```

## Common Negative Tests

Inactive camp should fail checkout:

```bash
curl -s -X DELETE "$API_BASE/admin/camps/$CAMP_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Client-Type: mobile" | jq

curl -s -X POST "$API_BASE/camps/checkout" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "X-Client-Type: mobile" \
  -d "{
    \"campId\": \"$CAMP_ID\",
    \"patientId\": \"$PATIENT_ID\",
    \"dob\": \"1996-01-15\"
  }" | jq
```

Expected error:

```json
{
  "error": "This camp is no longer active",
  "code": "CAMP_INACTIVE"
}
```

Missing auth:

```bash
curl -s -X POST "$API_BASE/camps/checkout" \
  -H "Content-Type: application/json" \
  -H "X-Client-Type: mobile" \
  -d "{
    \"campId\": \"$CAMP_ID\",
    \"patientId\": \"$PATIENT_ID\",
    \"dob\": \"1996-01-15\"
  }" | jq
```

Expected error:

```json
{
  "error": "Authorization token missing"
}
```

Invalid DOB format:

```bash
curl -s -X POST "$API_BASE/camps/checkout" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "X-Client-Type: mobile" \
  -d "{
    \"campId\": \"$CAMP_ID\",
    \"patientId\": \"$PATIENT_ID\",
    \"dob\": \"15-01-1996\"
  }" | jq
```

Expected error:

```json
{
  "error": "DOB must be YYYY-MM-DD format",
  "code": "VALIDATION_ERROR"
}
```

## Notes For UAT

- Admin camp APIs require `SUPER_ADMIN`.
- Public camp browse APIs do not require auth.
- Camp checkout requires auth and is rate-limited to 1 request per 5 seconds per user.
- Camp checkout creates a booking with `campId`, no home address, and `slotTime` set to `Camp`.
- `APP_BASE_URL` should be local during UAT if you are checking generated links.
- Do not share real passwords, JWTs, Razorpay secrets, AWS keys, or database URLs in tickets/screenshots. Replace them with placeholders.
