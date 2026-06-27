import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { preloadApiBaseUrl, getApiBaseUrl } from './lib/api'
import { installScrollIdleHook } from './lib/scrollIdle'
import { installDisableNumberInputNudges } from './lib/disableNumberInputNudges'
import './index.css'
import './styles/amazonInventoryPage.css'

function bridgePublicBrowserRouteToHashRoute() {
  const path = window.location.pathname || ''
  if (!path.startsWith('/rto-agent/')) return
  if (window.location.hash.startsWith('#/rto-agent/')) return

  const nextHash = `#${path}${window.location.search || ''}`
  window.history.replaceState(null, '', `/${nextHash}`)
}

bridgePublicBrowserRouteToHashRoute()
preloadApiBaseUrl()
console.log('API base URL =', getApiBaseUrl())
installScrollIdleHook()
installDisableNumberInputNudges()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
)
