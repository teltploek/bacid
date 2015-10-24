import frameConverter from './frame-converter'
import cuid from 'cuid'
import crypto from 'crypto'
import twitterText from 'twitter-text'
import tokenthrottle from 'tokenthrottle'
import uriToBuffer from 'data-uri-to-buffer'
import * as archiver from './archiver.js'

function transformText(text) {
  const sanitized = text.slice(0, 250).replace(/[\r\n\t]/, '')
  const entities =
      twitterText.extractEntitiesWithIndices(sanitized, { extractUrlsWithoutProtocol: true})
  const linkified = twitterText.autoLinkEntities(sanitized, entities, {
    htmlEscapeNonEntities: true,
    targetBlank: true,
    usernameIncludeSymbol: true,
  })

  return linkified
}

function createChat(userId, text = '') {
  const transformedText = transformText(text)
  return {
    key: cuid(),
    text: transformedText,
    sent: Date.now(),
    userId,
    from: 'seatcamp',
  }
}

const mimeTypes = {
  jpg: 'image/jpeg',
  mp4: 'video/mp4',
}
const mimeToSeatcamp = {}
Object.keys(mimeTypes).forEach(function(type) {
  mimeToSeatcamp[mimeTypes[type]] = type
})
export default class ChatSockets {
  constructor(io, userIdKey, ffmpegRunner, historyLimit, historyExpiryMs, expiryGainFactor) {
    this.io = io
    this.userIdKey = userIdKey
    this.ffmpegRunner = ffmpegRunner
    this.historyLimit = historyLimit
    this.historyExpiryMs = historyExpiryMs
    this.expiryGainFactor = expiryGainFactor
    this.userIdMap = new WeakMap()

    // Build a quick lookup for expiry times (including gain factor), indexed by the number of
    // messages in the history when making the check
    this.expiryTimes = [ 0 ]
    for (let i = 1; i <= this.historyLimit; i++) {
      this.expiryTimes[i] = this.historyExpiryMs *
          (this.expiryGainFactor ** (this.historyLimit - i))
    }

    this.history = []

    // throttle for connections (per host)
    this._connectThrottle = tokenthrottle({
      rate: 3,
      burst: 30,
      window: 60 * 1000,
    })
    // throttle for message sending (per socket)
    this._messageThrottle = tokenthrottle({
      rate: 6,
      burst: 18,
      window: 60 * 1000,
    })

    this.io.use((socket, next) => {
      let address = socket.conn.remoteAddress
      if (socket.request.headers['x-forwarded-for']) {
        address = socket.request.headers['x-forwarded-for'].split(/ *, */)[0]
      }

      this._connectThrottle.rateLimit(address, (err, limited) => {
        if (err) {
          console.error('Error checking rate limit for connection: ', err)
          return next()
        }
        if (limited) {
          return next(new Error('Exceeded connection limit'))
        }

        next()
      })
    })

    this.io.on('connection', socket => {
      socket.on('chat', (message, frames) => this.handleIncoming(socket, message, frames))
        .on('message', message => this.handleIncomingLegacy(socket, message))
        .on('join', roomName => {
          if (mimeTypes[roomName]) {
            socket.join(roomName)
            this.sendHistory(socket, roomName)
          }
        }).on('fingerprint', fingerprint => {
          if (this.userIdMap.has(socket)) {
            return socket.emit('error', 'fingerprint already set')
          }
          if (!fingerprint || fingerprint.length > 100) {
            socket.emit('error', 'invalid fingerprint')
            socket.disconnect()
          }

          this.setFingerprintForSocket(socket, fingerprint)
        })
    })
  }

  setFingerprintForSocket(socket, specified) {
    const id = crypto.createHash('md5').update(specified + this.userIdKey).digest('hex')
    this.userIdMap.set(socket, id)
    socket.emit('userid', id)
  }

  sendHistory(socket, videoType) {
    const now = Date.now()
    while (this.history.length &&
        now - this.history[0].chat.sent > this.expiryTimes[this.history.length]) {
      this.history.shift()
    }

    for (let i = 0; i < this.history.length; i++) {
      this.emitChatInFormat(
          socket, this.history[i].chat, this.history[i].videos[videoType], videoType)
    }
  }

  addToHistory(chat, videos) {
    this.history.push({ chat, videos })
    if (this.history.length > this.historyLimit) {
      this.history.shift()
    }

    //Adding to archive. Don't wait for it.
    archiver.archiveVideo({ name: chat.key }, videos);

    this.emitChat(chat, videos)
  }

  handleIncoming(socket, message, frames) {
    if (!this.userIdMap.has(socket)) {
      return socket.emit('error', 'no fingerprint set')
    }
    if (!message) {
      return socket.emit('error', 'invalid message')
    }
    const ack = {
      key: '' + message.ack
    }

    this._messageThrottle.rateLimit(this.userIdMap.get(socket), (err, limited) => {
      if (err) {
        console.error('Error ratelimiting message:', err)
      } else if (limited) {
        ack.err = 'exceeded message limit'
        return socket.emit('ack', ack)
      }

      // TODO(tec27): allowing variable frame counts should be fairly easy, we should do this
      if (!frames || !Array.isArray(frames) || frames.length !== 10) {
        ack.err = 'invalid frames'
        return socket.emit('ack', ack)
      }
      if (!message.format || message.format !== 'image/jpeg') {
        ack.err = 'invalid frame format'
        return socket.emit('ack', ack)
      }

      frameConverter(frames, message.format, this.ffmpegRunner, (err, video) => {
        if (err) {
          console.error('error: ' + err)
          ack.err = 'unable to convert frames'
          return socket.emit('ack', ack)
        }

        const chat = createChat(this.userIdMap.get(socket), message.text)
        socket.emit('ack', ack)
        this.addToHistory(chat, video)
      })
    })
  }

  handleIncomingLegacy(socket, data) {
    // handles packets from legacy meatspac-v2 clients (namely, iOS)
    const ackData = { key: data.key }

    if (!data.fingerprint || data.fingerprint.length > 32) {
      return socket.emit('messageack', 'Invalid fingerprint', ackData)
    }
    if (!this.userIdMap.has(socket)) {
      this.setFingerprintForSocket(socket, data.fingerprint)
    }

    const userId = this.userIdMap.get(socket)
    ackData.userId = userId

    this._messageThrottle.rateLimit(userId, (err, limited) => {
      if (err) {
        console.error('Error ratelimiting message:', err)
      } else if (limited) {
        return socket.emit('messageack', 'Exceeded message limit', ackData)
      }

      if (!data.media || !Array.isArray(data.media) || data.media.length !== 10) {
        return socket.emit('messageack', 'Invalid message: invalid media', ackData)
      }
      const frames = data.media.map(frame => {
        return uriToBuffer(frame)
      })
      for (const f of frames) {
        if (f.type !== 'image/jpeg') {
          return socket.emit('messageack',
              'Invalid message: media must be of type image/jpeg', ackData)
        }
      }
      frameConverter(frames, 'image/jpeg', this.ffmpegRunner, (err, video) => {
        if (err) {
          console.error('error: ' + err)
          return socket.emit('messageack', 'Unable to convert frames', ackData)
        }

        const chat = createChat(userId, data.message)
        socket.emit('messageack', null, ackData)
        this.addToHistory(chat, video)
      })
    })
  }

  emitChat(chatData, videos) {
    for (const videoType of Object.keys(videos)) {
      this.emitChatInFormat(this.io.to(videoType), chatData, videos[videoType], videoType)
    }
  }

  emitChatInFormat(target, data, video, videoType) {
    if (videoType !== 'mp4') {
      const packet = Object.create(data)
      packet.video = video
      packet.videoType = videoType
      packet.videoMime = mimeTypes[videoType]
      target.emit('chat', packet)
    } else {
      // Legacy packets for legacy clients in legacy-land
      const packet = {
        key: data.key,
        message: data.text,
        created: data.sent,
        fingerprint: data.userId,
        media: video,
      }
      target.emit('message', packet)
    }
  }
}
