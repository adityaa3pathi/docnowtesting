"""Static knowledge documents — FAQs and policies extracted from DocNow business logic.

These documents are embedded into KnowledgeChunk for the Retrieval Agent to search.
Content is derived from the actual codebase: cancellation rules from bookingCancellation.ts,
reschedule guards from reschedule.ts, status codes from healthiansStatusMap.ts, etc.
"""
from __future__ import annotations

STATIC_DOCUMENTS: list[dict[str, str]] = [
    # ── Policies ──────────────────────────────────────────────
    {
        "source": "policy",
        "title": "Cancellation Policy",
        "content": (
            "Free cancellation is available when your booking is in 'Order Booked' "
            "or 'Sample Collector Assigned' status. Cancellation is NOT possible once "
            "the phlebotomist has reached your home or the sample has been collected. "
            "Camp bookings cannot be cancelled online. When you cancel, a full refund "
            "is issued automatically via Razorpay. Refund timeline: 5-7 business days "
            "for credit/debit cards and netbanking, instant for UPI and wallets. "
            "Any DocNow wallet credits used in the booking are restored immediately. "
            "Promo codes used are also restored and can be reused."
        ),
    },
    {
        "source": "policy",
        "title": "Rescheduling Policy",
        "content": (
            "Rescheduling is available before sample collection. You cannot reschedule "
            "if the booking status is: Cancelled, Sample Collected, Sample Received at Lab, "
            "Report Generated, Health Counselling Done, Report Available, Completed, "
            "Rescheduled, or Refunded. Camp bookings cannot be rescheduled online. "
            "Available time slots are shown up to 7 days ahead, starting from 6:00 AM. "
            "When you reschedule, a new booking reference is created and your old booking "
            "is marked as 'Rescheduled'. No additional payment is required."
        ),
    },
    {
        "source": "policy",
        "title": "Refund Policy",
        "content": (
            "If you cancel before sample collection, you receive a full automatic refund "
            "via Razorpay. If the partner lab fails to fulfill your booking, an automatic "
            "refund is also initiated. Refund timeline: 5-7 business days for credit/debit "
            "cards and netbanking payments, instant for UPI and digital wallets. DocNow "
            "wallet credits used in the order are restored immediately upon cancellation. "
            "Promo code usage is also restored so you can reuse the code."
        ),
    },
    {
        "source": "policy",
        "title": "Payment and Pricing Policy",
        "content": (
            "DocNow accepts UPI, credit/debit cards, netbanking, and digital wallets "
            "via Razorpay. You can also apply DocNow wallet credits or promo codes for "
            "discounts. If a promo code or wallet balance fully covers your order amount, "
            "no additional payment gateway transaction is needed. All prices shown on the "
            "platform include applicable taxes. DocNow may offer discounted prices on "
            "selected tests and packages."
        ),
    },
    # ── FAQs ──────────────────────────────────────────────────
    {
        "source": "faq",
        "title": "How Home Collection Works",
        "content": (
            "DocNow brings diagnostic lab tests to your doorstep. Here's how it works: "
            "1) Browse and select tests or health packages on DocNow. "
            "2) Add them to your cart and select a convenient date and time slot. "
            "3) Complete payment via UPI, card, netbanking, or wallet. "
            "4) A certified phlebotomist arrives at your home at the scheduled time. "
            "5) The sample is collected safely and transported to the partner laboratory. "
            "6) Your diagnostic report is delivered digitally as a downloadable PDF. "
            "You'll receive WhatsApp notifications for booking confirmation, phlebotomist "
            "assignment, and report availability."
        ),
    },
    {
        "source": "faq",
        "title": "Slot Booking and Availability",
        "content": (
            "Time slots can be booked up to 7 days in advance. Morning slots start from "
            "6:00 AM. You can select your preferred collection time during checkout. "
            "Slot availability depends on your location and the tests selected. "
            "If you need to change your appointment time, you can reschedule from the "
            "'My Bookings' section as long as your sample hasn't been collected yet."
        ),
    },
    {
        "source": "faq",
        "title": "Report Delivery",
        "content": (
            "Diagnostic reports are typically delivered within 24-48 hours after sample "
            "collection, though the exact time varies by test type. Some specialized tests "
            "may take longer. Reports are delivered as downloadable PDF files in the "
            "Reports section of your DocNow account. You'll also receive a WhatsApp "
            "notification when your report is ready."
        ),
    },
    {
        "source": "faq",
        "title": "About DocNow",
        "content": (
            "DocNow is a healthcare diagnostics platform that brings lab tests to your "
            "doorstep. We partner with certified laboratories (including Healthians) to "
            "offer a wide range of diagnostic tests, health packages, and profiles. "
            "Our phlebotomists are trained professionals who collect samples safely at "
            "your home. For support, contact us at +91 9649089089 or "
            "docnowhealthcare@gmail.com. Visit docnow.in for more information."
        ),
    },
    {
        "source": "faq",
        "title": "Phlebotomist Tracking",
        "content": (
            "After a phlebotomist is assigned to your booking, you can track their "
            "status from the booking details page. You'll see the phlebotomist's name "
            "and a masked contact number for privacy. You'll receive a WhatsApp "
            "notification when the phlebotomist is assigned and when they're on their way."
        ),
    },
    # ── Booking Help ──────────────────────────────────────────
    {
        "source": "booking_help",
        "title": "Booking Status Explanations",
        "content": (
            "Order Booked: Your appointment is confirmed. You can cancel or reschedule. "
            "Sample Collector Assigned: A phlebotomist has been assigned and will arrive "
            "at your scheduled slot time. You can still cancel at this stage. "
            "Sample Collector Reached Home: The phlebotomist is at your door. "
            "Cancellation is no longer possible. "
            "Sample Collected: Your sample has been picked up and is being transported "
            "to the laboratory. "
            "Sample Received at Lab: Your sample is being processed at the laboratory. "
            "Report Generated: Your report is being verified by doctors before release. "
            "Report Available: Your diagnostic report is ready! Check the Reports section "
            "to download your PDF."
        ),
    },
    {
        "source": "booking_help",
        "title": "Resample Required Explanation",
        "content": (
            "Sometimes the laboratory needs a fresh sample. This can happen due to "
            "hemolysis (blood sample breaking down), clotting, or other quality issues. "
            "When this happens, your booking status changes to 'Resample Required'. "
            "A phlebotomist will be reassigned to collect a new sample free of charge. "
            "You don't need to make any additional payment."
        ),
    },
    {
        "source": "booking_help",
        "title": "Managing Multiple Patients",
        "content": (
            "DocNow supports booking tests for multiple family members in a single order. "
            "You can add family members (patients) from your profile. Each test in your "
            "cart can be assigned to a different patient. During checkout, specify which "
            "family member each test is for. The phlebotomist will collect samples from "
            "all patients during the same visit."
        ),
    },
    {
        "source": "booking_help",
        "title": "Wallet Credits and Promo Codes",
        "content": (
            "DocNow wallet credits can be earned through referrals and promotional "
            "campaigns. Credits are applied automatically during checkout to reduce your "
            "payable amount. Promo codes can be entered during checkout for additional "
            "discounts. Each promo code has usage limits (per-user and global). If your "
            "wallet balance and/or promo discount fully cover the order, no payment "
            "gateway transaction is needed."
        ),
    },
]
