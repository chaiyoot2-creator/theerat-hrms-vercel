import { createRoot } from 'react-dom/client'
import './lib/ezsite' // installs window.ezsite.apis before any page renders
import App from './App.tsx'
import './index.css'

createRoot(document.getElementById("root")!).render(<App />);
