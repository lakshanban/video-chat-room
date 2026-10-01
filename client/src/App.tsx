import { useEffect, useRef, useState, type FormEvent } from 'react'
import { io, type Socket } from 'socket.io-client'
import { CallSession, type RemoteVideo } from './callSession'
import type { ChatMessage, ClientToServerEvents, JoinResult, ServerToClientEvents, User } from './types'
import './App.css'

const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ??
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000'
    : window.location.origin)
const ROOM_ID = 'general'
const TYPING_IDLE_MS = 1000
const TYPING_EXPIRE_MS = 3000

function typingLabel(names: string[]) {
  if (names.length === 0) return ''
  if (names.length === 1) return `${names[0]} is typing…`
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`
  return `${names[0]} and ${names.length - 1} others are typing…`
}

type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>
type Status = 'idle' | 'joining' | 'joined'

function VideoTile({
  stream,
  label,
  muted = false,
  mirrored = false,
}: {
  stream: MediaStream
  label: string
  muted?: boolean
  mirrored?: boolean
}) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = ref.current
    if (!video) return
    video.srcObject = stream
    return () => {
      video.srcObject = null
    }
  }, [stream])

  return (
    <figure className={mirrored ? 'tile mirrored' : 'tile'}>
      <video ref={ref} autoPlay playsInline muted={muted} />
      <figcaption>{label}</figcaption>
    </figure>
  )
}

function App() {
  const socketRef = useRef<ChatSocket | null>(null)
  const callRef = useRef<CallSession | null>(null)
  const nameRef = useRef('')
  const listRef = useRef<HTMLDivElement>(null)
  const isTypingRef = useRef(false)
  const typingIdleTimer = useRef<number | null>(null)
  const typingExpiry = useRef<Map<string, number>>(new Map())

  const [username, setUsername] = useState('')
  const [me, setMe] = useState<User | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [typingUsers, setTypingUsers] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [cameraError, setCameraError] = useState('')
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteVideos, setRemoteVideos] = useState<RemoteVideo[]>([])
  const [micOn, setMicOn] = useState(false)
  const [cameraOn, setCameraOn] = useState(false)

  function emitTyping(isTyping: boolean) {
    const socket = socketRef.current
    const name = nameRef.current
    if (!socket?.connected || !name) return
    if (!isTyping && !isTypingRef.current) return
    isTypingRef.current = isTyping
    socket.emit('typing', { username: name, isTyping })
  }

  function stopTyping() {
    if (typingIdleTimer.current) {
      window.clearTimeout(typingIdleTimer.current)
      typingIdleTimer.current = null
    }
    emitTyping(false)
  }

  function handleJoined(result: JoinResult) {
    setMe(result.user)
    setStatus('joined')
    setError('')
    void callRef.current?.callPeers(result.peers.map((peer) => peer.id)).catch(() => {
      setCameraError('Could not start a video connection.')
    })
  }

  useEffect(() => {
    const socket: ChatSocket = io(SERVER_URL, { autoConnect: false })
    const call = new CallSession((to, signal) => {
      socket.emit('signal', { to, ...signal })
    })
    socketRef.current = socket
    callRef.current = call
    call.setHandlers({
      onLocalStream: setLocalStream,
      onRemoteVideos: setRemoteVideos,
      onMediaState: ({ micOn: nextMic, cameraOn: nextCamera }) => {
        setMicOn(nextMic)
        setCameraOn(nextCamera)
      },
    })

    socket.on('connect', () => {
      const name = nameRef.current
      if (!name) return
      socket.emit('join', { username: name, roomId: ROOM_ID }, handleJoined)
    })

    socket.on('users', (nextUsers) => {
      setUsers(nextUsers)
    })

    socket.on('message', (message) => {
      setMessages((current) => [...current, message])
    })

    socket.on('typing', ({ username: typingName, isTyping }) => {
      if (typingName === nameRef.current) return

      const pending = typingExpiry.current.get(typingName)
      if (pending) window.clearTimeout(pending)

      if (!isTyping) {
        typingExpiry.current.delete(typingName)
        setTypingUsers((current) => current.filter((name) => name !== typingName))
        return
      }

      setTypingUsers((current) =>
        current.includes(typingName) ? current : [...current, typingName],
      )
      const timer = window.setTimeout(() => {
        typingExpiry.current.delete(typingName)
        setTypingUsers((current) => current.filter((name) => name !== typingName))
      }, TYPING_EXPIRE_MS)
      typingExpiry.current.set(typingName, timer)
    })

    socket.on('signal', (signal) => {
      void call.handleSignal(signal.from, signal).catch(() => {
        setCameraError('Could not connect video with someone in the room.')
      })
    })

    socket.on('user-left', ({ id }) => {
      call.removePeer(id)
    })

    socket.on('connect_error', () => {
      setStatus('idle')
      setError('Could not reach the chat server at ' + SERVER_URL)
    })

    socket.on('disconnect', () => {
      call.closePeers()
      if (nameRef.current) {
        setStatus('joining')
        setError('Disconnected. Reconnecting…')
      }
    })

    return () => {
      if (isTypingRef.current && nameRef.current) {
        socket.emit('typing', { username: nameRef.current, isTyping: false })
      }
      call.destroy()
      callRef.current = null
      for (const timer of typingExpiry.current.values()) {
        window.clearTimeout(timer)
      }
      typingExpiry.current.clear()
      if (typingIdleTimer.current) window.clearTimeout(typingIdleTimer.current)
      socket.removeAllListeners()
      socket.disconnect()
      socketRef.current = null
    }
  }, [])

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    list.scrollTop = list.scrollHeight
  }, [messages])

  async function join(event: FormEvent) {
    event.preventDefault()
    const name = username.trim()
    const socket = socketRef.current
    const call = callRef.current
    if (!name || !socket || !call) return

    nameRef.current = name
    setError('')
    setCameraError('')
    setStatus('joining')

    try {
      await call.prepareMedia()
    } catch {
      setCameraError('Camera and microphone are blocked. You can still use text chat.')
    }

    if (socket.connected) {
      socket.emit('join', { username: name, roomId: ROOM_ID }, handleJoined)
      return
    }

    socket.connect()
  }

  function send(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    const socket = socketRef.current
    if (!text || !me || !socket?.connected) return

    stopTyping()
    socket.emit('message', { username: me.username, message: text })
    setDraft('')
  }

  function updateDraft(value: string) {
    setDraft(value)
    if (typingIdleTimer.current) window.clearTimeout(typingIdleTimer.current)

    if (!value.trim()) {
      stopTyping()
      return
    }

    emitTyping(true)
    typingIdleTimer.current = window.setTimeout(() => emitTyping(false), TYPING_IDLE_MS)
  }

  if (status !== 'joined' || !me) {
    return (
      <main className="join-screen">
        <form className="join-card" onSubmit={join}>
          <p className="eyebrow">Nest chat</p>
          <h1>Join the video room</h1>
          <p className="lede">
            Pick a name. Your camera connects directly to the other people here, and text still goes through the server.
          </p>
          <label htmlFor="username">Username</label>
          <input
            id="username"
            name="username"
            autoComplete="nickname"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Ada"
            maxLength={32}
            required
          />
          {error ? <p className="error">{error}</p> : null}
          <button type="submit" disabled={status === 'joining' || !username.trim()}>
            {status === 'joining' ? 'Joining…' : 'Join room'}
          </button>
        </form>
      </main>
    )
  }

  return (
    <main className="chat">
      <aside className="people">
        <p className="eyebrow">Online</p>
        <h2>{users.length === 1 ? '1 person' : `${users.length} people`}</h2>
        <ul>
          {users.map((user) => (
            <li key={user.id}>
              <span className="dot" aria-hidden="true" />
              <span>{user.username}</span>
              {user.id === me.id ? <span className="you">you</span> : null}
            </li>
          ))}
        </ul>
      </aside>

      <section className="thread">
        <header>
          <div>
            <p className="eyebrow">Room</p>
            <h2>General</h2>
          </div>
          <p className="signed-in">Signed in as {me.username}</p>
        </header>

        <section className="stage" aria-label="Video">
          {localStream ? (
            <VideoTile stream={localStream} label={`${me.username} (you)`} muted mirrored />
          ) : (
            <div className="tile placeholder">
              <p>Camera unavailable</p>
            </div>
          )}
          {remoteVideos.map((remote) => (
            <VideoTile
              key={remote.id}
              stream={remote.stream}
              label={users.find((user) => user.id === remote.id)?.username ?? 'Guest'}
            />
          ))}
        </section>

        {cameraError ? <p className="error banner">{cameraError}</p> : null}

        <div className="controls">
          <button type="button" aria-pressed={!micOn} onClick={() => callRef.current?.toggleMic()} disabled={!localStream}>
            {micOn ? 'Mute mic' : 'Unmute mic'}
          </button>
          <button
            type="button"
            aria-pressed={!cameraOn}
            onClick={() => callRef.current?.toggleCamera()}
            disabled={!localStream}
          >
            {cameraOn ? 'Stop camera' : 'Start camera'}
          </button>
        </div>

        <div className="messages" ref={listRef}>
          {messages.length === 0 ? (
            <p className="empty">No messages yet. Say hello.</p>
          ) : (
            messages.map((message) => {
              const mine = message.username === me.username
              return (
                <article key={message.id} className={mine ? 'bubble mine' : 'bubble'}>
                  {mine ? null : <p className="author">{message.username}</p>}
                  <p>{message.message}</p>
                </article>
              )
            })
          )}
        </div>

        {error ? <p className="error banner">{error}</p> : null}

        <p className="typing" aria-live="polite">
          {typingLabel(typingUsers)}
        </p>

        <form className="composer" onSubmit={send}>
          <label className="sr-only" htmlFor="message">
            Message
          </label>
          <input
            id="message"
            name="message"
            value={draft}
            onChange={(event) => updateDraft(event.target.value)}
            placeholder="Write a message"
            maxLength={500}
            autoComplete="off"
          />
          <button type="submit" disabled={!draft.trim()}>
            Send
          </button>
        </form>
      </section>
    </main>
  )
}

export default App
