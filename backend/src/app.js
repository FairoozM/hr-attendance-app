const express = require('express')
const cors = require('cors')
const apiRoutes = require('./routes')

const app = express()

app.use(cors())
app.use(express.json())

app.use('/api', apiRoutes)

// Multer / upload errors → JSON (not HTML error page)
app.use((err, req, res, next) => {
  if (err && err.name === 'MulterError') {
    return res.status(400).json({ error: err.message || 'Upload failed' })
  }
  next(err)
})

module.exports = app
