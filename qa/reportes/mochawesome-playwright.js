// Reporter de Playwright que deja los resultados en formato Mochawesome (qa/reportes/mochawesome.js).
// Un defecto conocido que "falla como se espera" (test.fail) cuenta como bien, con una nota en el contexto.
'use strict';
const path = require('path');
const { stripVTControlCharacters } = require('util');
const { suite, informe, guardarParte, SALIDA } = require('./mochawesome');

class ReporterMochawesome {
  constructor({ salida }) {
    this.salida = salida;
  }

  onBegin(config, raiz) {
    this.raiz = raiz;
    this.inicio = Date.now();
  }

  async onEnd() {
    const porProyecto = [];
    for (const proyecto of this.raiz.suites) {
      const sp = suite(`E2E Playwright · ${proyecto.title}`);
      for (const archivo of proyecto.suites) this.volcar(archivo, sp.subsuite(path.basename(archivo.title), archivo.title));
      if (sp.suites.length) porProyecto.push(sp);
    }
    guardarParte(this.salida, informe(porProyecto, { inicio: this.inicio, fin: Date.now() }));
  }

  volcar(origen, destino) {
    for (const t of origen.tests) {
      const ultimo = t.results[t.results.length - 1];
      const resultado = t.outcome();
      const estado = resultado === 'skipped' ? 'pending' : resultado === 'unexpected' ? 'failed' : 'passed';
      const contexto = [];
      const tags = t.tags.join(' ');
      if (tags) contexto.push({ title: 'Etiquetas', value: tags });
      for (const a of t.annotations) contexto.push({ title: a.type === 'fail' ? 'Defecto conocido' : a.type, value: a.description || 'falla como se espera mientras siga abierto' });
      if (resultado === 'flaky') contexto.push({ title: 'Inestable', value: `pasó en el reintento ${ultimo.retry}` });
      // Evidencias (captura, video, traza) solo de lo que salió mal; las del defecto que falla como se espera son ruido
      const evidencias = ultimo && resultado !== 'expected' ? ultimo.attachments : [];
      for (const adj of evidencias) {
        if (adj.path) contexto.push({ title: adj.name, value: path.relative(path.join(SALIDA, 'mochawesome'), adj.path).replace(/\\/g, '/') });
      }
      let err = estado === 'failed' && ultimo && ultimo.error;
      // test.fail() que pasó: el defecto conocido parece arreglado
      if (estado === 'failed' && !err && t.expectedStatus === 'failed') {
        err = { message: 'Se esperaba que fallara (defecto conocido) y pasó: el defecto parece arreglado. ' +
          'Pasarlo a Cerrados en docs/qa/DEFECTOS-CONOCIDOS.md y quitar el test.fail() para que quede como regresión.' };
      }
      destino.agregar({
        titulo: t.title,
        tituloCompleto: t.titlePath().slice(3).join(' › '),
        duracion: ultimo ? ultimo.duration : 0,
        estado,
        contexto,
        error: err ? { mensaje: sinColores(err.message || ''), pila: sinColores(err.stack || '') } : null
      });
    }
    for (const hija of origen.suites) this.volcar(hija, destino.subsuite(hija.title));
  }

  printsToStdio() { return false; }
}

// Los mensajes de error de Playwright traen colores de terminal
const sinColores = s => stripVTControlCharacters(s);

module.exports = ReporterMochawesome;
