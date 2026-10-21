import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './app/App'
import { startServiceWorker } from './app/pwaUpdate'
import { startCloud } from './sync/cloud'

startServiceWorker()
startCloud()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
