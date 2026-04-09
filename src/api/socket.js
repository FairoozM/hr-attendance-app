import { io } from 'socket.io-client'
import { API_BASE_URL } from './config.js'

const socketOptions = {
  path: '/api/socket.io',
  transports: ['websocket', 'polling'],
  autoConnect: true,
}

export const employeesSocket = io(API_BASE_URL || undefined, socketOptions)
