import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { preloadApiBaseUrl, getApiBaseUrl } from './lib/api'
import { installScrollIdleHook } from './lib/scrollIdle'
import './index.css'

preloadApiBaseUrl()
console.log('API base URL =', getApiBaseUrl())
installScrollIdleHook()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
)
