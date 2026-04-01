require('dotenv').config()
const http = require('http')
const { Server } = require('socket.io')
const app = require('./app')
const { testConnection } = require('./db')

const PORT = process.env.PORT || 5001

const server = http.createServer(app)
const io = new Server(server, {
  path: '/api/socket.io',
  cors: {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  },
})

app.set('io', io)

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  testConnection()
})
