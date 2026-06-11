# DOCNOW - Server Handover Walkthrough

Welcome to the DOCNOW Backend Server. This document serves as a high-level walkthrough of the server architecture, designed to help new developers quickly understand the layout, core flows, and critical services.

## 1. Directory Structure & Architecture

The backend follows a typical layered architecture (Express + Node.js) with clearly separated responsibilities:

- **`src/index.ts` (Entry Point):** Initializes the Express application, configures middleware (CORS, Helmet, CSRF, Cookie Parser), mounts all API routes, and starts background workers (e.g., the reconciler).
- **`src/routes/`:** Defines API endpoints and maps HTTP methods/paths to the appropriate controller functions. No business logic lives here.
- **`src/controllers/`:** Extracts request data, calls necessary services, and formats the HTTP response.
- **`src/services/`:** Contains core business logic (e.g., `bookingFinalization.ts`, `razorpay.ts`). Reusable across controllers.
- **`src/adapters/`:** Integrations with 3rd-party services. E.g., `healthians.ts` manages communication, authentication, and token lifecycle with the Healthians vendor API.
- **`src/utils/`:** Helper functions (logging, environment validation, security, cookies).
- **`src/middleware/`:** Express middlewares for Auth, CSRF, role checking, and request context injection.

## 2. Key Flows & Critical Modules

### A. The Booking Pipeline
The most critical flow in the system is how a Cart becomes a confirmed Healthians appointment.
1. **Initiate Payment (`controllers/payments/initiate.ts`):** Creates a Razorpay order.
2. **Webhook Verification (`controllers/payments/index.ts`):** Listens to Razorpay webhooks to verify payment.
3. **Finalization (`services/bookingFinalization.ts`):** 
   - Uses a "lease" mechanism (`processingAttemptId`) in the Database to prevent race conditions if webhooks fire concurrently.
   - Pushes the order to the Healthians API.
   - Triggers an automatic Razorpay refund if the Healthians API fails to accept the booking.

### B. Healthians Integration
Found in `src/adapters/healthians.ts`.
- It caches Auth tokens and refreshes them automatically.
- Uses checksum-based verification (`generateChecksum`) for specific endpoints (like booking creation).

### C. Webhooks
Webhooks from Razorpay and Healthians must be parsed as raw data to verify signatures. In `index.ts`, you will see:
`app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), webhookHandler);`
**Do not** move this below `express.json()` or signature verification will fail.

## 3. Database & ORM (Prisma)
We use Prisma ORM.
- **Schema:** Located at `prisma/schema.prisma`. It is the single source of truth for the database structure.
- **Client:** The Prisma client is initialized centrally in `src/db/index.ts` (or similar) to prevent connection pooling limits.

## 4. Coding Practices & Comments
As part of our standard practice:
- **File Headers:** Core files have `/** ============ */` block comments explaining the module's overall responsibility.
- **TSDoc:** Complex functions, especially in services and utils, use standard JSDoc/TSDoc to define inputs and expected behaviors.
- **"Why" over "What":** Inline comments are strictly used to explain non-obvious business rules or API workarounds (e.g., explaining why a specific rate-limit buffer is used).
- **Logs:** We use a structured logger (often Pino or Winston wrapped in `utils/logger.ts`). Use `logBusinessEvent` and `logAlert` for critical tracking.

## 5. Development & Scripts
- **Start Dev Server:** `npm run dev` uses `nodemon` and `ts-node` to hot-reload.
- **Scripts:** Look in the `scripts/` folder for utilities like `seed-admin.ts` or database checks.
- **Environment:** Copy `.env.example` to `.env`. The `utils/envValidator.ts` will crash the app on startup if critical keys are missing.

---
**Handover Note:** Before pushing major changes to the booking flow, always review the distributed locking logic in `bookingFinalization.ts`.
