export type RemoteVideo = {
  id: string
  stream: MediaStream
}

export type SignalBody = {
  description?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
}

type Handlers = {
  onLocalStream: (stream: MediaStream | null) => void
  onRemoteVideos: (videos: RemoteVideo[]) => void
  onMediaState: (state: { micOn: boolean; cameraOn: boolean }) => void
}

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}

export class CallSession {
  private peers = new Map<string, RTCPeerConnection>()
  private iceQueues = new Map<string, RTCIceCandidateInit[]>()
  private pending: { from: string; signal: SignalBody }[] = []
  private remotes = new Map<string, MediaStream>()
  private localStream: MediaStream | null = null
  private mediaReady = false
  private handlers: Handlers = {
    onLocalStream: () => {},
    onRemoteVideos: () => {},
    onMediaState: () => {},
  }

  private readonly emit: (to: string, signal: SignalBody) => void

  constructor(emit: (to: string, signal: SignalBody) => void) {
    this.emit = emit
  }

  setHandlers(handlers: Handlers) {
    this.handlers = handlers
  }

  async prepareMedia() {
    if (this.localStream) {
      this.mediaReady = true
      this.handlers.onLocalStream(this.localStream)
      this.publishMediaState()
      await this.flushPending()
      return this.localStream
    }

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      })
      this.handlers.onLocalStream(this.localStream)
      this.publishMediaState()
      return this.localStream
    } finally {
      this.mediaReady = true
      await this.flushPending()
    }
  }

  async callPeers(peerIds: string[]) {
    for (const peerId of peerIds) {
      if (this.peers.has(peerId)) continue
      const pc = this.createPeer(peerId)
      if (!this.localStream) {
        pc.addTransceiver('audio', { direction: 'recvonly' })
        pc.addTransceiver('video', { direction: 'recvonly' })
      }
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      this.sendDescription(peerId, pc)
    }
  }

  async handleSignal(from: string, signal: SignalBody) {
    if (!this.mediaReady) {
      this.pending.push({ from, signal })
      return
    }

    const pc = this.createPeer(from)

    if (signal.description) {
      await pc.setRemoteDescription(signal.description)
      await this.flushIce(from, pc)
      if (signal.description.type === 'offer') {
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        this.sendDescription(from, pc)
      }
    }

    if (signal.candidate) {
      if (!pc.remoteDescription) {
        const queued = this.iceQueues.get(from) ?? []
        queued.push(signal.candidate)
        this.iceQueues.set(from, queued)
        return
      }
      await pc.addIceCandidate(signal.candidate)
    }
  }

  removePeer(peerId: string) {
    this.peers.get(peerId)?.close()
    this.peers.delete(peerId)
    this.iceQueues.delete(peerId)
    this.remotes.delete(peerId)
    this.publishRemotes()
  }

  closePeers() {
    for (const peerId of [...this.peers.keys()]) this.removePeer(peerId)
  }

  destroy() {
    this.closePeers()
    this.localStream?.getTracks().forEach((track) => track.stop())
    this.localStream = null
    this.mediaReady = false
    this.handlers.onLocalStream(null)
  }

  toggleMic() {
    this.toggleTrack('audio')
  }

  toggleCamera() {
    this.toggleTrack('video')
  }

  private toggleTrack(kind: 'audio' | 'video') {
    const track = this.localStream?.getTracks().find((item) => item.kind === kind)
    if (!track) return
    track.enabled = !track.enabled
    this.publishMediaState()
  }

  private publishMediaState() {
    const audio = this.localStream?.getAudioTracks()[0]
    const video = this.localStream?.getVideoTracks()[0]
    this.handlers.onMediaState({
      micOn: Boolean(audio?.enabled),
      cameraOn: Boolean(video?.enabled),
    })
  }

  private createPeer(peerId: string) {
    const existing = this.peers.get(peerId)
    if (existing) return existing

    const pc = new RTCPeerConnection(ICE_CONFIG)
    const stream = this.localStream
    if (stream) {
      for (const track of stream.getTracks()) pc.addTrack(track, stream)
    }

    pc.onicecandidate = (event) => {
      if (!event.candidate) return
      this.emit(peerId, { candidate: event.candidate.toJSON() })
    }

    pc.ontrack = (event) => {
      let remote = this.remotes.get(peerId)
      if (!remote) {
        remote = new MediaStream()
        this.remotes.set(peerId, remote)
      }
      if (!remote.getTracks().some((track) => track.id === event.track.id)) {
        remote.addTrack(event.track)
      }
      this.publishRemotes()
    }

    this.peers.set(peerId, pc)
    return pc
  }

  private sendDescription(peerId: string, pc: RTCPeerConnection) {
    const description = pc.localDescription
    if (!description) return
    this.emit(peerId, { description: { type: description.type, sdp: description.sdp } })
  }

  private async flushIce(peerId: string, pc: RTCPeerConnection) {
    const queued = this.iceQueues.get(peerId) ?? []
    this.iceQueues.delete(peerId)
    for (const candidate of queued) {
      await pc.addIceCandidate(candidate)
    }
  }

  private async flushPending() {
    const queued = this.pending.splice(0)
    for (const item of queued) {
      await this.handleSignal(item.from, item.signal)
    }
  }

  private publishRemotes() {
    this.handlers.onRemoteVideos(
      [...this.remotes].map(([id, stream]) => ({ id, stream })),
    )
  }
}
