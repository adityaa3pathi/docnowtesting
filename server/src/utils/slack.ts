import axios from 'axios';

export async function sendDeadLetterAlert(bookingId: string, attemptIdOrMaxRetries: any, errorMsg: string) {
    const slackUrl = process.env.SLACK_WEBHOOK_URL;
    if (!slackUrl) {
        console.warn('SLACK_WEBHOOK_URL not set. Dead letter alert not sent.');
        return;
    }

    try {
        await axios.post(slackUrl, {
            text: `🚨 *DOCNOW PARTNER BOOKING FAILED* 🚨\n\n*Booking ID:* ${bookingId}\n*Attempt/Retries:* ${attemptIdOrMaxRetries}\n*Error:* ${errorMsg}\n\n<!channel> Manual intervention required!`
        });
    } catch (e) {
        console.error('Failed to send Slack alert for dead letter:', e);
    }
}
