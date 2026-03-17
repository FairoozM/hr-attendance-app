require('dotenv').config()
const app = require('./app')
const { testConnection } = require('./db')

const PORT = process.env.PORT || 5001

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  testConnection()
})
