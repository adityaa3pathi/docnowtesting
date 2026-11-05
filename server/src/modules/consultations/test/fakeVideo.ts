import { ConsultVideo, VideoRole } from '../consultations.video';

/** In-memory video provider: rooms are counted, tokens are readable strings. */
export class FakeVideo implements ConsultVideo {
    roomsCreated: string[] = [];
    roomsEnded: string[] = [];

    async createRoom(name: string) {
        this.roomsCreated.push(name);
        return `room-${name}`;
    }

    async endRoom(roomId: string) {
        this.roomsEnded.push(roomId);
    }

    url() {
        return 'wss://fake.livekit.test';
    }

    async joinToken(roomId: string, userId: string, displayName: string, role: VideoRole) {
        return `token:${roomId}:${userId}:${displayName}:${role}`;
    }

    eventsSent: { roomName: string; event: any }[] = [];
    async notifyRoom(roomName: string, event: any) {
        this.eventsSent.push({ roomName, event });
    }
}
