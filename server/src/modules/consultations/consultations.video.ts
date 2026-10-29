/**
 * LiveKit video. The server makes rooms and signs short-lived join tokens; the keys never leave it.
 * Audio roles may publish only the microphone, so an audio booking stays audio on every client.
 */
import { AccessToken, DataPacket_Kind, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { DoctorError } from './doctors.status';

export type VideoRole = 'doctor' | 'patient' | 'doctor-audio' | 'patient-audio';

export type ConsultRoomEvent =
    | { v: 1; type: 'PRESCRIPTION_DRAFTING'; consultationId: string }
    | { v: 1; type: 'PRESCRIPTION_ISSUED'; consultationId: string; prescriptionId: string }
    | { v: 1; type: 'PRESCRIPTION_NOT_REQUIRED'; consultationId: string };

export interface ConsultVideo {
    /** Address the client connects to. */
    url(): string;
    createRoom(name: string): Promise<string>;
    joinToken(roomId: string, userId: string, displayName: string, role: VideoRole): Promise<string>;
    /** Removes everyone still in the room, so the other side's screen knows the call is over. */
    endRoom(roomId: string): Promise<void>;
    /** Broadcasts a reliable event to all participants currently in the room. */
    notifyRoom?(roomName: string, event: ConsultRoomEvent): Promise<void>;
}

const JOIN_TOKEN_TTL = '2h';
const EMPTY_ROOM_SECONDS = 10 * 60;
// Doctor and patient, plus room for one rejoin overlapping a dropped connection on each side.
const MAX_PARTICIPANTS = 4;

function liveKitKeys() {
    const url = process.env.LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!url || !apiKey || !apiSecret) throw new DoctorError(503, 'Video calls are not set up yet');
    return { url, apiKey, apiSecret, host: url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:') };
}

const rooms = () => {
    const { host, apiKey, apiSecret } = liveKitKeys();
    return new RoomServiceClient(host, apiKey, apiSecret);
};

export function realConsultVideo(): ConsultVideo {
    return {
        url: () => liveKitKeys().url,
        async createRoom(name) {
            const room = await rooms().createRoom({
                name,
                emptyTimeout: EMPTY_ROOM_SECONDS,
                departureTimeout: 120, // keep room for 120s if both parties drop
                maxParticipants: MAX_PARTICIPANTS,
            });
            return room.name;
        },
        async joinToken(roomId, userId, displayName, role) {
            const { apiKey, apiSecret } = liveKitKeys();
            const token = new AccessToken(apiKey, apiSecret, { identity: userId, name: displayName, ttl: JOIN_TOKEN_TTL });
            const audioOnly = role.endsWith('-audio');
            token.addGrant({
                room: roomId,
                roomJoin: true,
                canSubscribe: true,
                canPublish: true,
                canPublishData: false,
                canPublishSources: audioOnly ? [TrackSource.MICROPHONE] : [TrackSource.MICROPHONE, TrackSource.CAMERA],
                canUpdateOwnMetadata: true, // allows client to publish { net: 'audio-only' }
            });
            return token.toJwt();
        },
        async endRoom(roomId) {
            try {
                await rooms().deleteRoom(roomId);
            } catch (e: any) {
                // A room that is already gone is the goal.
                if (e?.status !== 404 && !/not found/i.test(String(e?.message))) throw e;
            }
        },
        async notifyRoom(roomName, event) {
            try {
                const enc = new TextEncoder();
                await rooms().sendData(
                    roomName,
                    enc.encode(JSON.stringify(event)),
                    DataPacket_Kind.RELIABLE,
                    { topic: 'consult-events' }
                );
            } catch (e: any) {
                // Ignore room not found if call already ended
                if (e?.status !== 404 && !/not found/i.test(String(e?.message))) {
                    console.warn('[ConsultVideo] notifyRoom failed:', e?.message || e);
                }
            }
        },
    };
}
