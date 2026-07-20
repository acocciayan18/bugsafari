import { SocketHttpEngineGateway } from './SocketHttpEngineGateway';

const API_BASE_URL = import.meta.env.VITE_BUGSAFARI_API_URL ?? 'http://localhost:3000';
const SOCKET_URL = import.meta.env.VITE_BUGSAFARI_SOCKET_URL
    ?? (typeof window !== 'undefined' ? window.location.origin : API_BASE_URL);

let instance: SocketHttpEngineGateway | null = null;

// Lazy singleton — App.tsx previously built this in useState, which under StrictMode
// constructed two gateways and leaked the unconnected one.
export function getEngineGateway(): SocketHttpEngineGateway {
    if (!instance) instance = new SocketHttpEngineGateway(API_BASE_URL, SOCKET_URL);
    return instance;
}
