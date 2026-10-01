import { Injectable } from "@nestjs/common";
import { Message, User } from "./types";

@Injectable()
export class ChatService {
    private users = new Map<string, User>();
    private messages = new Map<string, Message>();

    addUser(user: User) {
        this.users.set(user.id, user);
    }

    removeUser(userId: string) {
        this.users.delete(userId);
    }

    getUsers() {
        return Array.from(this.users.values());
    }

    addMessage(message: Message) {
        this.messages.set(message.id, message);
    }

    getMessages(roomId: string) {
        return this.messages.get(roomId) ?? [];
    }
}

