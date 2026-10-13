import { ConsultVideo, VideoRole } from '../consultations.video';

/** In-memory 100ms: rooms are counted, tokens are readable strings. */
export class FakeVideo implements ConsultVideo {
    roomsCreated: string[] = [];

    async createRoom(name: string) {
        this.roomsCreated.push(name);
        return `room-${name}`;
    }

    joinToken(roomId: string, userId: string, role: VideoRole) {
        return `token:${roomId}:${userId}:${role}`;
    }
}
