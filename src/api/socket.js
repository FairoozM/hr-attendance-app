import { io } from 'socket.io-client'
import { getApiBaseUrl } from './config.js'

const socketOptions = {
  path: '/api/socket.io',
  transports: ['websocket', 'polling'],
}

let socketInstance = null

/**
 * Same API origin as fetch(); in production without a base URL we do not auto-connect
 * (avoids opening a socket to the static host only).
 */
export function getEmployeesSocket() {
  if (!socketInstance) {
    const base = getApiBaseUrl() || undefined
    const noApiBase = import.meta.env.PROD && !getApiBaseUrl()
    socketInstance = io(base, {
      ...socketOptions,
      autoConnect: !noApiBase,
    })
  }
  return socketInstance
}
