import {
    ConnectedSocket,
    MessageBody,
    OnGatewayDisconnect,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { ChatService } from "./chat.service";

type SessionDescription = {
    type: string;
    sdp?: string;
};

type IceCandidate = {
    candidate?: string;
    sdpMid?: string | null;
    sdpMLineIndex?: number | null;
    usernameFragment?: string | null;
};

@WebSocketGateway({
    cors: true,
})
export class ChatGateway implements OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    constructor(private readonly chatService: ChatService) {}

    @SubscribeMessage('join')
    join(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { username: string; roomId: string },
    ) {
        const user = {
            id: client.id,
            username: data.username.toString(),
        };
        const peers = this.chatService
            .getUsers()
            .filter((existing) => existing.id !== client.id);

        this.chatService.addUser(user);
        this.server.emit('users', this.chatService.getUsers());

        return { user, peers };
    }

    @SubscribeMessage('signal')
    signal(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            to: string;
            description?: SessionDescription;
            candidate?: IceCandidate;
        },
    ) {
        if (!data?.to) return;

        this.server.to(data.to).emit('signal', {
            from: client.id,
            description: data.description,
            candidate: data.candidate,
        });
    }

    @SubscribeMessage('message')
    message(
        @MessageBody()
        data: { username: string; message: string },
    ) {
        const message = {
            ...data,
            id: Date.now().toString(),
        };

        this.chatService.addMessage(message);
        this.server.emit('message', message);
    }

    @SubscribeMessage('typing')
    typing(
        @MessageBody() data: { username: string; isTyping: boolean },
    ) {
        this.server.emit('typing', {
            username: data.username,
            isTyping: Boolean(data.isTyping),
        });
    }

    handleDisconnect(client: Socket) {
        const id = client?.id;
        if (!id) return;
        this.chatService.removeUser(id);
        this.server.emit('user-left', { id });
        this.server.emit('users', this.chatService.getUsers());
    }
}
