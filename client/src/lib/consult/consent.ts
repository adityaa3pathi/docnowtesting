/**
 * Telemedicine consent (NMC Telemedicine Practice Guidelines, 2020). The server refuses a patient-side
 * join without it and records the version shown, so change CONSENT_VERSION whenever the wording changes.
 */
export const CONSENT_VERSION = 'nmc-tpg-2020-v1';

export const consentText = (doctorName: string) => {
    const dr = doctorName.startsWith('Dr') ? doctorName : `Dr. ${doctorName}`;
    return `I consent to an online telemedicine video consultation with ${dr} in accordance with the National Medical Commission (NMC) Telemedicine Practice Guidelines.`;
};

/** The family member's zero-login room shows Hindi and English together. */
export const GUEST_CONSENT_TEXT =
    'मैं राष्ट्रीय चिकित्सा आयोग (NMC) के दिशा-निर्देशों के तहत टेलीकंसल्टेशन के लिए सहमति देता/देती हूँ (I consent to online teleconsultation under NMC guidelines)';

export const CONSENT_REQUIRED_HINT = 'Please accept teleconsultation consent to join';
export const GUEST_CONSENT_REQUIRED_HINT = 'कॉल शुरू करने के लिए ऊपर सहमति दें / Please accept teleconsultation consent to join';

export const ABOUT_TELEMEDICINE = {
    en: {
        title: 'About telemedicine consultations',
        points: [
            'Under the National Medical Commission (NMC) Telemedicine Practice Guidelines, a registered doctor can consult you by video or audio call.',
            'The doctor can assess your symptoms, give advice and prescribe medicines allowed for online consultations. Some medicines cannot be prescribed online.',
            'If your problem needs an examination, the doctor may ask you to see a doctor in person.',
            'This is not for emergencies. In an emergency, call 112 or go to the nearest hospital.',
            'Your health details are shared only with your doctor. DocNow keeps your consent, the doctor’s notes and your prescription, as the guidelines require.',
            'You can leave the call at any time.',
        ],
    },
    hi: {
        title: 'टेलीमेडिसिन परामर्श के बारे में',
        points: [
            'राष्ट्रीय चिकित्सा आयोग (NMC) के टेलीमेडिसिन दिशा-निर्देशों के तहत पंजीकृत डॉक्टर वीडियो या ऑडियो कॉल पर आपसे परामर्श कर सकते हैं।',
            'डॉक्टर आपके लक्षण समझकर सलाह और ऑनलाइन परामर्श में अनुमत दवाइयाँ लिख सकते हैं। कुछ दवाइयाँ ऑनलाइन नहीं लिखी जा सकतीं।',
            'अगर जाँच ज़रूरी हो, तो डॉक्टर आपको किसी डॉक्टर से मिलकर दिखाने को कह सकते हैं।',
            'यह आपातकाल के लिए नहीं है। आपातकाल में 112 पर कॉल करें या नज़दीकी अस्पताल जाएँ।',
            'आपकी स्वास्थ्य जानकारी केवल आपके डॉक्टर के साथ साझा होती है। दिशा-निर्देशों के अनुसार DocNow आपकी सहमति, डॉक्टर के नोट्स और पर्चा सुरक्षित रखता है।',
            'आप कभी भी कॉल छोड़ सकते हैं।',
        ],
    },
} as const;
