'use strict';
const path = require('path');
const fs = require('fs');
const { DATA_DIR } = require('../config');
const sqlite3 = require('sqlite3');
const { ZONA_HORARIA, fechaLocal } = require('../tiempo');

// ============ COPIAS DE SEGURIDAD ============
// Copia automática cada 24 hs en data/backups (se conservan las últimas BACKUPS_CONSERVAR).
// Con BACKUP_COPIA_DIR (ej. una carpeta de Google Drive / OneDrive sincronizada) se guarda
// además un duplicado fuera de la carpeta del sistema.
// Restaurar: detener el servidor, reemplazar data/gastromanager.db por la copia y volver a iniciarlo.
const DIR_BACKUPS = path.join(DATA_DIR, 'backups');
const BACKUPS_CONSERVAR = Math.max(1, parseInt(process.env.BACKUPS_CONSERVAR, 10) || 30);
// El sufijo _N aparece si se pidieron dos copias en el mismo segundo (ej. la automática al iniciar y una manual)
const NOMBRE_BACKUP = /^gastromanager_\d{4}-\d{2}-\d{2}_\d{6}(_\d{1,3})?\.db$/;
const sinExtension = n => n.replace(/\.db$/, '');

function listarBackups() {
  if (!fs.existsSync(DIR_BACKUPS)) return [];
  return fs.readdirSync(DIR_BACKUPS)
    .filter(n => NOMBRE_BACKUP.test(n))
    .map(nombre => {
      const st = fs.statSync(path.join(DIR_BACKUPS, nombre));
      return { nombre, tamano: st.size, fecha: st.mtime.toISOString() };
    })
    .sort((a, b) => sinExtension(b.nombre).localeCompare(sinExtension(a.nombre)));
}

let backupEnCurso = null;
function crearBackup() {
  // Si ya hay una copia en curso se reutiliza (evita dos VACUUM a la vez)
  if (backupEnCurso) return backupEnCurso;
  backupEnCurso = (async () => {
    fs.mkdirSync(DIR_BACKUPS, { recursive: true });
    const hora = new Intl.DateTimeFormat('en-GB', {
      timeZone: ZONA_HORARIA, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(new Date()).replace(/:/g, '');
    const base = `gastromanager_${fechaLocal()}_${hora}`;
    // VACUUM INTO falla si el archivo ya existe: nunca se pisa una copia anterior
    let nombre = `${base}.db`;
    for (let n = 2; fs.existsSync(path.join(DIR_BACKUPS, nombre)); n++) nombre = `${base}_${n}.db`;
    const destino = path.join(DIR_BACKUPS, nombre);
    // VACUUM INTO genera una copia consistente aunque la base esté en uso
    // Se usa una conexión propia: en la compartida, VACUUM falla si otro pedido tiene una consulta en curso
    await new Promise((resolve, reject) => {
      const con = new sqlite3.Database(path.join(DATA_DIR, 'gastromanager.db'));
      con.configure('busyTimeout', 10000);
      con.run('VACUUM INTO ?', [destino], err => con.close(() => err ? reject(err) : resolve()));
    });

    if (process.env.BACKUP_COPIA_DIR) {
      try {
        fs.mkdirSync(process.env.BACKUP_COPIA_DIR, { recursive: true });
        fs.copyFileSync(destino, path.join(process.env.BACKUP_COPIA_DIR, nombre));
      } catch (e) {
        console.error('[backup] No se pudo copiar a BACKUP_COPIA_DIR:', e.message);
      }
    }
    // Rotación: se borran las más viejas
    for (const viejo of listarBackups().slice(BACKUPS_CONSERVAR)) {
      try { fs.unlinkSync(path.join(DIR_BACKUPS, viejo.nombre)); } catch (e) {}
    }
    console.log(`[backup] Copia creada: ${nombre}`);
    return listarBackups().find(b => b.nombre === nombre);
  })().finally(() => { backupEnCurso = null; });
  return backupEnCurso;
}

// Crea una copia si la última tiene más de 24 hs (se revisa al iniciar y cada hora)
async function backupSiCorresponde() {
  try {
    const ultima = listarBackups()[0];
    if (!ultima || Date.now() - new Date(ultima.fecha).getTime() >= 24 * 3600 * 1000) {
      await crearBackup();
    }
  } catch (e) {
    console.error('[backup] Error al crear la copia automática:', e);
  }
}

module.exports = { DIR_BACKUPS, NOMBRE_BACKUP, listarBackups, crearBackup, backupSiCorresponde };
