import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Expose the store on window in dev mode so e2e tests can inject state directly
// without hitting real API endpoints or spawning PTYs.
if (import.meta.env.DEV) {
  import('./stores/useStore').then(({ useStore }) => {
    (window as any).__openui_store = useStore;
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
