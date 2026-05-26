import type { Server } from 'socket.io';

export function registerSocketHandlers(io: Server): void {
  io.on('connection', (socket) => {
    console.log(`[Socket] dashboard connected ${socket.id}`);
    socket.on('disconnect', () => {
      console.log(`[Socket] dashboard disconnected ${socket.id}`);
    });
  });
}
