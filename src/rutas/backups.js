'use strict';
const {
  fs, path, run, errorInterno, autenticar, esAdmin, DIR_BACKUPS, NOMBRE_BACKUP, listarBackups, crearBackup
} = require('../contexto');

module.exports = function registrarRutas(app) {

app.get('/api/backups', autenticar, esAdmin, (req, res) => {
  try { res.json(listarBackups()); } catch (err) { errorInterno(res, err); }
});

app.post('/api/backups', autenticar, esAdmin, async (req, res) => {
  try {
    const backup = await crearBackup();
    await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)',
      [req.usuario.id, 'backup', `Copia de seguridad manual: ${backup.nombre}`]);
    res.status(201).json(backup);
  } catch (err) { errorInterno(res, err); }
});

app.get('/api/backups/:nombre', autenticar, esAdmin, (req, res) => {
  // Solo nombres generados por el sistema: evita leer archivos fuera de data/backups
  if (!NOMBRE_BACKUP.test(req.params.nombre)) return res.status(400).json({ error: 'Nombre de copia inválido' });
  const archivo = path.join(DIR_BACKUPS, req.params.nombre);
  if (!fs.existsSync(archivo)) return res.status(404).json({ error: 'Copia no encontrada' });
  res.download(archivo, req.params.nombre);
});

};
