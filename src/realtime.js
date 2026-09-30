'use strict';
// Socket.IO: clientes conectados en tiempo real
const { Server } = require('socket.io');
const { origenPermitido } = require('./config');
const { txContexto, setEmisor } = require('./db');
const { usuarioDesdeToken } = require('./auth');

let io = null;

// Clientes conectados por Socket.IO (realtime). Solo usuarios con sesión válida:
// los eventos incluyen datos de clientes (nombre, teléfono).
function iniciarRealtime(server) {
  io = new Server(server, {
    cors: { origin: (origin, cb) => cb(null, origenPermitido(origin)) }
  });
  io.use(async (socket, next) => {
    try {
      const usuario = await usuarioDesdeToken(socket.handshake.auth && socket.handshake.auth.token);
      if (usuario.cp) return next(new Error('Debe cambiar la contraseña'));
      socket.usuario = usuario;
      next();
    } catch (e) {
      next(new Error('No autorizado'));
    }
  });
  io.on('connection', socket => {
    socket.emit('realtime:connected', { at: new Date().toISOString() });
  });
  // Las transacciones emiten sus eventos pendientes después del COMMIT
  setEmisor((evento, data) => io.emit(evento, data));
  return io;
}

// Dentro de una transacción los eventos se encolan y se emiten recién después del COMMIT
// (si hay ROLLBACK se descartan), así los clientes nunca ven datos a medio guardar.
const emitEvento = (evento, data) => {
  const ctx = txContexto.getStore();
  if (ctx) { ctx.eventos.push([evento, data]); return; }
  if (!io) return;
  try { io.emit(evento, data); } catch (e) {}
};

module.exports = { iniciarRealtime, emitEvento };
