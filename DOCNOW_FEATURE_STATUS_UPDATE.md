# DocNow — Project Progress & Feature Status Update

**Prepared for:** Client / Executive Team  
**Date:** October 2026  
**Project:** DocNow Online Doctor Consultation & Diagnostics Platform  

---

## Executive Summary

We have completed a comprehensive audit comparing the **DocNow Feature Specification** against our current live codebase. 

Overall, **the core operational engine of DocNow is already built, integrated, and functioning end-to-end**. A patient can search for a doctor by specialty, pick an appointment slot, pay online, enter a live video or audio consultation, receive a formal digital prescription with official credentials, and have doctor-recommended diagnostic tests added directly to their cart for home sample collection.

### At a Glance
* **🟢 Fully Built & Ready (14 Features — ~33%):** Core appointment booking, live video/audio calls, doctor availability & leave scheduling, notes & digital prescriptions, Razorpay payments, automated doctor no-show refunds, and lab test checkout.
* **🟡 Partially Built / In Refinement (14 Features — ~33%):** Foundation and backend logic are complete; remaining work involves finishing touches on UI screens, additional filters, or minor workflow connections.
* **🔴 Planned for Next Phase (15 Features — ~34%):** Advanced convenience features such as Hindi translation, voice search, automated medicine reminder schedules, AI symptom triage, and pharmacy fulfillment screens.

**Total Progress:** **~66%** of core platform capabilities are either completed or actively in progress.

```
Overall Progress: [██████████████████░░░░░░░░░░] 66% Complete / In Progress
```

---

## 1. 🟢 Fully Built & Ready to Use

These features are completely developed, connected to the database, integrated with third-party services (Razorpay, LiveKit video, Healthians labs, WhatsApp notifications), and verified.

| Feature Area | What It Does |
| :--- | :--- |
| **Doctor Availability & Scheduling** | Doctors can set their weekly working hours (e.g. 10 AM–2 PM & 5 PM–8 PM), select appointment lengths (15, 30, 45, 60 mins), mark vacation/leave dates, and block individual slots. Slots are generated automatically. |
| **Live Consultation Room (Video & Audio)** | High-quality browser-based video and audio calls powered by WebRTC (LiveKit). Both patient and doctor can toggle cameras, microphones, or switch to audio-only if needed. |
| **Doctor Working Notes** | During consultations, doctors record Chief Complaints, Clinical Findings, Diagnosis, and Advice. Notes auto-save in real time and automatically lock once the prescription is issued. |
| **Digital Prescription Builder** | Doctors can prescribe medications (medicine name, dose, frequency, duration, instructions) and recommend lab tests. Includes versioning (re-issuing a corrected prescription voids the previous one with an audit trail). |
| **DocNow-Branded Prescription PDF** | Generates an official, legal PDF prescription with DocNow branding, doctor qualifications, registration numbers, patient details, and a 1-click download button. |
| **Patient-Friendly Prescription View** | On-screen view that translates medical abbreviations into simple, easy-to-read instructions for the patient (e.g., *"Take 1 tablet before breakfast for 5 days"*). |
| **Doctor Lab Test Recommendations** | Doctors pick tests directly from the internal diagnostic catalog during consultation. |
| **1-Click Test Booking from Prescription** | Patients can click **"Add recommended tests to cart"** directly from their prescription screen to immediately bundle all prescribed tests into their cart with zero manual searching. |
| **Home Sample Collection Booking** | Patients choose their home address, date, and preferred morning time slot for diagnostic blood sample collection. |
| **Automated Diagnostic Lab Reports** | When lab results are ready from the diagnostic partner, they automatically sync, receive DocNow branding, and appear in the patient's personal records dashboard. |
| **Online Payments & Invoicing** | Seamless payments via Razorpay (UPI, Google Pay, PhonePe, Credit/Debit cards, Netbanking) with instant confirmation and payment receipts. |
| **Doctor No-Show Protection & Auto-Refund** | If a doctor fails to join the consultation within the policy grace period, the system automatically cancels the appointment, triggers an **automatic 100% refund** back to the patient's bank account, and sends an alert. |
| **Patient No-Show Handling** | Configurable grace timer that marks an appointment as missed if the patient does not join, protecting doctor availability. |
| **Doctor Dashboard** | Doctors have a clear dashboard showing upcoming and completed consultations, appointment times, patient names, consultation mode, and 1-click call entry. |

---

## 2. 🟡 Partially Built (Core Ready, Final Touches in Progress)

These features have working backend infrastructure and functional components, but are undergoing UI polish, additional filtering options, or workflow refinement.

| Feature Area | What Is Done | What Remains to Complete |
| :--- | :--- | :--- |
| **Doctor Discovery & Search** | Patients can browse doctors and filter by medical specialty. Profiles display experience, qualifications, spoken languages, consultation fee, and available days. | Adding doctor name text search, gender filters, fee range slider, and an "Available Right Now" filter. |
| **Consultation Types** | Scheduled Video and Audio appointments are fully live. | Instant Consultation (connecting with the first available doctor in 5 minutes) and In-Call Text Chat. |
| **Booking Flow** | Patients pick doctor, date/time, and choose which family member the appointment is for. | Adding optional intake steps during booking (entering consultation reason and uploading prior medical reports). |
| **Family Accounts** | One primary DocNow account can manage profiles for family members (Self, Spouse, Children, Parents). | Giving each family member their own independent health records timeline view. |
| **Pre-Consultation Waiting Room** | Displays countdown timer and opens the "Join Call" button 10 minutes prior to appointment time. | Adding the pre-call checklist screen (*"Please have ready: current medicines, previous reports, main symptoms"*). |
| **Doctor's Patient View** | 70/30 split screen layout (70% video call, 30% panel for clinical notes and prescription writing). | Adding side drawer tabs to review the patient's past consultations and prior lab reports during the call. |
| **Patient Medical Profile** | Stores patient name, age, gender, date of birth, contact details, and address. | Adding medical history questionnaires (allergies, chronic conditions, regular medications, emergency contact). |
| **Consultation Summary** | Post-visit page shows doctor details, time, prescription medications, advice, and recommended tests. | Displaying the doctor's diagnosis and consultation notes directly on the patient's post-visit summary screen. |
| **"Your Next Steps" Checklist** | 1-click button to push all prescribed tests directly into the checkout cart. | Adding the interactive to-do checklist (*"Start medicines", "Complete CBC test", "Follow-up on [Date]"*). |
| **Cancellation & Rescheduling** | Patients can cancel appointments with automatic refund calculations based on admin-set policy tiers. | Adding a 1-click self-serve "Reschedule" button (currently patients cancel and re-book). |
| **WhatsApp Notifications** | Automated WhatsApp messages for Booking Confirmation, 1-Hour Reminder, "Doctor is Ready to Join", and Refund/No-show alerts. | Adding WhatsApp templates for "Recommended Tests" and "Follow-up Reminders". |
| **Poor Internet Adaptation** | Patients and doctors have a 1-click "Switch to Audio" button and automatic reconnection banners. | Automatic detection of weak bandwidth that prompts a popup asking *"Your connection is weak. Switch to audio?"*. |
| **Admin Panel** | Full control to approve/suspend doctors, manage specialties, set pricing, review bookings, inspect stuck payments, and manage catalog tests. | Adding dedicated consultation analytics charts (e.g. no-show percentages and conversion rates). |

---

## 3. 🔴 Planned for Next Phase (Roadmap Items)

These items represent additional enhancements, specialized workflows, and auxiliary integrations outlined in the specification that are not yet built.

1. **Problem / Symptom-Based Doctor Finding**  
   *Interactive guide where patients type or select symptoms (e.g., "Hair fall" or "Chest pain") and the system automatically recommends the appropriate medical specialty.*
2. **Patient Medical Document Vault (External Uploads)**  
   *Allowing patients to upload outside PDFs and photos (past X-rays, MRI scans, physical prescriptions from other hospitals) and store them permanently in their account.*
3. **Pre-Consultation Report Sharing Permissions**  
   *A prompt before the call asking *"Share previous reports with Dr. Sharma? (Share All / Share Selected)"* so the doctor gets pre-cleared access.*
4. **"Questions for My Doctor"**  
   *A pre-consultation notepad where patients jot down questions they want to ask, with check-off boxes during the call.*
5. **Doctor Review of New Reports & Follow-Up Consultation Booking**  
   *A dedicated follow-up workflow where the doctor receives an alert when new lab reports arrive and can initiate a follow-up review call.*
6. **Unified Health Timeline**  
   *A single visual timeline showing patient history chronologically (e.g. Sept 18: Doctor Consult → Sept 19: Prescription → Sept 21: Blood Sample Collected → Sept 22: Lab Report → Sept 28: Follow-up).*
7. **Unified Health Records Search**  
   *A universal search bar allowing patients to search their own history (e.g., searching "Thyroid" brings up relevant lab reports, prescriptions, and consultations).*
8. **Medication Reminders & Pill Tracker**  
   *Scheduled in-app and WhatsApp alerts reminding patients when to take morning, afternoon, and evening medicines, along with refill alerts.*
9. **Doctor Running Late Alerts**  
   *Live delay indicator showing *"Dr. Sharma is running ~8 minutes late"* with options to continue waiting or pick another doctor.*
10. **Bilingual Support (Hindi + English)**  
    *Complete UI language toggle allowing patients to view instructions, buttons, and notifications in Hindi or English.*
11. **Voice Input (Speech-to-Text)**  
    *A "Tell Us" microphone button allowing patients to describe their health issue verbally instead of typing.*
12. **Preventive Health Reminders**  
    *Automated prompts for annual health checkups, recurring diabetic checkups, and prescription refills.*
13. **Doctor Earnings & Financial Settlement Portal**  
    *A dedicated doctor finance dashboard displaying total consultations, DocNow commission deductions, net payable balances, and bank payout history.*
14. **Pharmacy Operations Window**  
    *A specialized dashboard for pharmacy partners to receive digital prescriptions, calculate medication day supplies, and coordinate deliveries/refill calls.*

---

## Screen Availability Summary

| Interface | Completed / Usable | Total Specified | Readiness |
| :--- | :---: | :---: | :---: |
| **Patient Screens** | **15** | 32 | **47%** |
| **Doctor Screens** | **9** | 14 | **64%** |
| **Admin Screens** | **9** | 12 | **75%** |

---

## Recommended Next Priorities

To transition the maximum number of partially built features into 100% completion with the fastest turnaround, we recommend focusing on:

1. **Doctor Discovery Filters:** Adding doctor name search, gender, and fee filters to make finding doctors effortless.
2. **Booking Flow Intake:** Adding the "Reason for Visit" and past report upload field to the checkout modal.
3. **Doctor Side-Panel Records:** Allowing doctors to view patient history and previous lab reports in the 30% side drawer during a live call.
4. **Follow-Up Booking Shortcut:** Adding a direct "Book Follow-up" button on completed consultations.
5. **Next Steps Checklist UI:** Rendering the interactive checklist on the post-consultation screen.

---
*For any questions or clarification regarding these features, please reach out to the development team.*
