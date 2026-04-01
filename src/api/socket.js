import { io } from 'socket.io-client'

export const employeesSocket = io({
  path: '/api/socket.io',
  transports: ['websocket', 'polling'],
  autoConnect: true,
})
