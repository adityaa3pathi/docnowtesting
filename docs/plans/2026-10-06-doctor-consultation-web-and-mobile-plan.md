# Doctor Consultation: Web + Mobile Implementation Plan

Date: 2026-10-06
Sources: `docs/client/DocNow-Doctor-Consultation-Scope.html` (62 screens, 5 phases), `docs/ideation/2026-10-04-doctor-consultation-integration-ideation.html`, and a read of the current code.

---

## 1. Goal

- Patients talk to a doctor by video, get a prescription, book the recommended tests in one tap, and keep all records in one place, for the whole family.
- Delivered as a **web app** (Next.js, already live) and a **mobile app** (new).
- The wedge: tests the doctor recommends land in the patient's existing lab cart.

## 2. Where we are today (from the code)

| Area | Current state | Impact on plan |
|---|---|---|
| Client | Next.js 16, React 19, Tailwind v4, Radix, Framer Motion, Axios. Mobile-first pages. | Add `/consult`, `/doctor`, `/profile` My Health tabs. |
| Server | Express 5 + Prisma 5 + Postgres. Routes in `routes/`, logic in `services/`. | Add a self-contained `modules/consultations/`. |
| Module pattern | `modules/camps/` (routes, service, types, checkout in one folder). | Copy this shape. Do not spread consult code across `services/`. |
| Auth | OTP login, JWT in cookie **or** `Authorization: Bearer`. CSRF is skipped for non-cookie clients. | **Mobile can use the API as is.** No auth rewrite. |
| Roles | `Role` enum (USER, admin, manager). | Add `DOCTOR`. Add doctor guard like `requireManager.ts`. |
| People | `User` owns many `Patient` (family). | Reuse `Patient` as the person for consultations. |
| Payments | Razorpay orders, signature checks, webhook dedupe, state machine, reconciler worker. | Reuse keys and signature checks. Build consult payments and refunds as their own path. |
| Storage | S3 for report PDFs. | Reuse for documents and prescription PDFs. |
| Messaging | WhatsApp sender (`wappieWhatsApp.ts`) and notification services. | Reuse. Add SMS/email fallback. |
| Queue / timers | `node-cron` and one reconciler. Redis is Upstash **REST** only. | Need a real job queue (BullMQ over TCP Redis). Local docker already has Redis. |
| Realtime | None. | Need video SDK and a way to push live status. |
| AI | Python `ai-support/` service: retrieval, intent, tools, draft, verifier. Gemini. Chat widget. | Add consult tools. Add 6 helpers on the same pipeline. |
| Mobile | None. | New app. |
| CI | `safety-baseline.yml`, `uptime.yml`. | Add mobile build and test jobs. |

**Gaps to close before feature work**
- No Redis job queue for timers (no-show, reminders, refunds).
- No video provider.
- No push notifications.
- No `success` / `warning` colour tokens in the client theme.
- Support chat uses off-brand indigo.
- API has no versioning or generated types, which a mobile app will want.

## 3. Key decisions

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D1 | Mobile stack | **React Native with Expo**, TypeScript | Same language as web. Share types and API client. One team. |
| D2 | One mobile app or two | **One app, role-aware** (patient and doctor screens) | One store listing, one build pipeline. |
| D3 | Doctor on mobile at launch | **Yes, doctor screens ship in the app at launch** (owner decision). Doctor web stays too. | Owner needs mobile at launch. Doctors can take calls from a phone. |
| D4 | Video | **100ms** (backup: Agora). | India-based, React Native SDK, free tier (about 10,000 min/month, verify). Estimated MVP load is about 30,000 call minutes/month (2,500 users, ~1,000 consults, 15 min, 2 people). |
| D5 | Queue | BullMQ on real Redis. Keep Upstash for rate limit. | Timers must survive restarts. |
| D6 | Push | Firebase Cloud Messaging (Android + iOS via APNs) | Needed for "doctor is ready" and reminders. |
| D7 | Shared code | Small `packages/shared` (types, zod schemas, API client) | Stops web and mobile drifting apart. |
| D8 | Scope doc says "no mobile apps" | **Overridden by this request.** Update scope doc. | Scope doc is now out of date. |

D4 is decided: 100ms. Confirm current pricing before Phase 2 starts.

## 4. Target architecture

```
Next.js web ──┐
Expo mobile ──┼──> Express API ──> Postgres (Prisma)
Doctor web ───┘      │
                     ├── modules/consultations   (new)
                     ├── BullMQ + Redis          (timers, reminders, no-show)
                     ├── Video SDK               (rented; token endpoint)
                     ├── Razorpay                (reuse keys + signatures)
                     ├── S3                      (documents, prescriptions)
                     ├── WhatsApp / SMS / Email  (reuse + fallback)
                     ├── FCM                     (push, new)
                     ├── ai-support (Python)     (new tools + helpers)
                     └── Healthians              (tests only, via lab cart)
```

- One API for web and mobile.
- Every consult screen calls `/api/consult/...` and `/api/doctor/...`.
- Server owns all rules. Clients only render.

## 5. Data model (new Prisma tables)

New tables, kept separate from `Booking`:

- `DoctorProfile` (user link, specialty, registration number, fee, languages, status: DRAFT / PENDING / APPROVED / SUSPENDED)
- `Specialty`, `SymptomSpecialtyRule` (admin-editable)
- `DoctorAvailability`, `DoctorLeave`, `Slot` (generated from hours)
- `Consultation` (patient, doctor, slot, type: VIDEO / AUDIO / CHAT, status, followUpOf)
- `ConsultationPayment`, `ConsultationRefund` (own payment path)
- `MedicalProfile` (per `Patient`: allergies, conditions, medicines, surgeries)
- `HealthDocument`, `DocumentShareGrant`
- `ConsultationNote`, `Prescription`, `PrescriptionMedicine`, `RecommendedTest`
- `MedicineReminder`
- `CareEvent` (one event log feeding timeline, doctor panel, search, reminders)
- `ConsultPolicy` (cancellation, refund, wait times, fees, upload limit)
- `DeviceToken` (push)
- `Notification`

**Consultation state machine** (one file, with tests, like `paymentStateMachine.ts`):
`PENDING_PAYMENT → CONFIRMED → WAITING → IN_PROGRESS → COMPLETED`
plus `CANCELLED`, `NO_SHOW_PATIENT`, `NO_SHOW_DOCTOR`, `RESCHEDULED`, `REFUNDED`.

**Rules that must hold**
- Patient data is visible only to the patient and their doctor for that consult.
- A slot can be booked once (database constraint, not just a check).
- Payment webhooks are idempotent. Refunds go to the original method.
- The doctor may only recommend tests from our catalog.

## 6. Phases

Each phase is usable on its own. Web and mobile advance together from Phase 3.

### Phase 0: Foundations (1 to 2 weeks)
- Add `DOCTOR` role and doctor guard.
- Stand up BullMQ with real Redis. Add a worker folder entry next to `reconciler.ts`.
- Add `success` / `warning` theme tokens. Re-colour support chat to brand purple.
- Create `packages/shared` (types, zod schemas, API client). Move nothing yet. Start with consult types.
- Create `modules/consultations/` skeleton.
- Write the consultation state machine with tests.
- Create the 100ms account and test a room.
- Add mobile CI skeleton.

### Phase 1: Doctor supply and money (3 to 4 weeks)
Scope doc Phase 1.
- Doctor self-registration: a doctor signs up, fills the profile and submits it for approval.
- Admin can also create a doctor profile on a doctor's behalf.
- Admin approval and registration number check for both routes.
- Seed script with dummy doctors, patients and slots for all testing.
- Availability, slot generation, breaks, leave.
- Admin: Doctor management, Rules and settings (policy table).
- Consultation payments and refunds (own path), webhook dedupe, stuck-payment reconciler.
- Message base in Hindi and English.
- Web only.

### Phase 2: First live consultations (4 to 5 weeks)
Scope doc Phase 2.
- Admin books a doctor for a customer.
- Video room with audio fallback (token endpoint, join, end, weak-connection prompt).
- Doctor dashboard, consultation room (70/30 layout), notes, prescription builder, recommended tests, follow-up.
- Prescription PDF with DocNow branding (reuse PDFKit).
- Tests fan out into the existing lab cart for the right `Patient`.
- Admin: Appointments, Consultations.
- Web (patient join + doctor) only. Proves the core loop.

### Phase 3: Patients book themselves, web + mobile (5 to 6 weeks)
Scope doc Phase 3. **Mobile app starts here.**
- Web: `/consult` home, specialty list, doctor list and profile, slot picker, stepper (who / reason / medical info / documents / pay), confirmation, waiting room.
- Late and no-show handling, refunds by policy.
- WhatsApp messages: confirmed, reminder, join. FCM push on mobile.
- Mobile (patient): login by OTP, consult home, doctor list, booking stepper, Razorpay mobile checkout, waiting room, video/audio/chat room, camera and mic permissions.
- Deep links for "Join now" from push and WhatsApp.

### Phase 4: Smart assistant (3 to 4 weeks)
Scope doc Phase 4. Built on `ai-support/`.
- New tools in `registry.py`: `find_doctors`, `list_consultations`, `get_consultation_status`, `reschedule_consultation`, `cancel_consultation`.
- Problem to specialty (AI extracts; the admin rule table chooses).
- Doctor brief, notes helper, simple prescription (Hindi / English), questions for my doctor.
- Hindi and English golden-set tests in `ai-support/eval` before launch.
- Same verifier. AI text labelled. "Talk to a person" always on.
- Chat widget on web and in the mobile app.

### Phase 5: My Health and follow-ups, web + mobile (4 to 5 weeks)
Scope doc Phase 5.
- My consultations, prescriptions, documents, medicines, timeline, search, family, notifications (new tabs under `/profile`, new tabs in the app).
- Medicine reminders and refill reminders (queue jobs, local notifications on mobile).
- Follow-up booking, report share prompt.
- Doctor earnings and settlement. Admin analytics, reports, refund and settlement screens.

### Phase 6: Doctor mobile, in-app lab booking and launch (5 to 6 weeks)
- Doctor screens in the app: today list, join call, quick notes, prescription, availability.
- Lab test booking inside the app: catalog, cart, slots, address, Razorpay, reports (same API as web).
- Android and iPhone released together.
- Store release work: icons, screenshots, privacy labels, store review.
- Performance, accessibility pass, load test on video join.

**Total:** about 25 to 32 weeks for one small team. Parallel web and mobile work after Phase 3 can shorten this. Treat as a range, not a promise.

## 7. Mobile app plan

**Stack:** Expo (React Native), TypeScript, Expo Router, React Query, `packages/shared` types and API client.

**Screens (patient, ~34):** map 1 to 1 from the scope doc.
- Tabs: Home / Consult, My Health, Cart, Profile.
- Lab test booking is in the app at launch. Same API as web (cart, slots, payments, reports). Screens built in Phase 6.
- Android and iPhone ship together. Expo builds both from one codebase.

**Mobile-specific work**
- OTP login using Bearer tokens (already supported). Store tokens in secure storage.
- Razorpay mobile SDK.
- Video SDK with background audio, camera switch, speaker, reconnect.
- FCM push, notification channels, deep links.
- Local notifications for medicine reminders.
- File picker and camera for report upload.
- Offline-friendly lists (cache last prescriptions and reports).
- Hindi and English with in-app language switch.

**Look and feel:** same tokens as web (purple `#4b2192`, Inter, rounded cards). Keep a shared token file.

## 8. Risks and open questions

| Risk | Plan |
|---|---|
| Medical and legal compliance (telemedicine rules, prescription validity, data privacy) | Out of the scope doc. **Needs a separate legal review before launch.** |
| Video quality on weak networks | Audio fallback. Test on 3G. Pick SDK with India servers. |
| Double charges or stuck payments in new payment path | First-class task in Phase 1. Reuse webhook dedupe pattern and reconciler. |
| AI giving medical advice | Verifier stays on. AI never diagnoses, prescribes or picks tests. |
| App store review (health category, camera, mic) | Start store paperwork in Phase 5, not at the end. |
| Doctor supply | Doctors self-register or are added by admin. All testing uses dummy data. No doctor data needed up front. |
| Scope growth | Pharmacy, ABHA, extra languages stay "later". |

**Questions for the owner**
None open. The owner approves the Hindi and English wording. Claude drafts it; the owner reviews before launch (end of Phase 3).

## 9. Proof per phase (how we know it works)

- State machine and policy rules: unit tests (Vitest, already set up).
- Payments and refunds: webhook replay and duplicate tests.
- Slot booking: concurrent-booking test.
- Privacy: tests that another user cannot read a consultation.
- AI: golden-set eval in Hindi and English.
- Mobile: device tests on one low-end Android and one iPhone before each release.

## 10. Next step

- Owner answers the 4 questions in section 8.
- Then start Phase 0.
