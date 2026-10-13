import { ConsultVideo, VideoRole } from '../consultations.video';

/** In-memory 100ms: rooms are counted, tokens are readable strings. */
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

    joinToken(roomId: string, userId: string, role: VideoRole) {
        return `token:${roomId}:${userId}:${role}`;
    }
}
