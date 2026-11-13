import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AiDemo } from './AiDemo';
import './global.css';

const rootElement = document.getElementById('root');
if (rootElement) createRoot(rootElement).render(new URLSearchParams(location.search).get('demo') === 'ai' ? <AiDemo/> : <App/>);
