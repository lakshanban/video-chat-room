export interface User {
  id: string
  username: string
}

export interface ChatMessage {
  id: string
  username: string
  message: string
}

export interface TypingEvent {
  username: string
  isTyping: boolean
}

export interface JoinResult {
  user: User
  peers: User[]
}

export interface SignalMessage {
  from: string
  description?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
}

export interface ServerToClientEvents {
  users: (users: User[]) => void
  message: (message: ChatMessage) => void
  typing: (event: TypingEvent) => void
  signal: (signal: SignalMessage) => void
  'user-left': (event: { id: string }) => void
}

export interface ClientToServerEvents {
  join: (
    data: { username: string; roomId: string },
    ack: (result: JoinResult) => void,
  ) => void
  message: (data: { username: string; message: string }) => void
  typing: (event: TypingEvent) => void
  signal: (data: {
    to: string
    description?: RTCSessionDescriptionInit
    candidate?: RTCIceCandidateInit
  }) => void
}
