'use strict';
// Generador de comandos ESC/POS para impresoras térmicas (58 y 80 mm).
// Compatible con Epson TM y la mayoría de las genéricas (Xprinter, 3nStar, Gadnic, Hasar...).

const ESC = 0x1b, GS = 0x1d, LF = 0x0a;

// Página de códigos PC850 (ESC t 2): acentos, eñe y signos de apertura del español
const PC850 = {
  'á': 0xa0, 'é': 0x82, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, 'ü': 0x81, 'Ü': 0x9a,
  'Á': 0xb5, 'É': 0x90, 'Í': 0xd6, 'Ó': 0xe0, 'Ú': 0xe9, '¿': 0xa8, '¡': 0xad, 'º': 0xa7, 'ª': 0xa6,
  '°': 0xf8, 'ç': 0x87, 'Ç': 0x80, '½': 0xab, '·': 0xfa
};

// Convierte texto a bytes PC850; lo que no existe en la página se aproxima (sin tilde) o se reemplaza por "?"
function codificar(texto) {
  const bytes = [];
  for (const c of String(texto == null ? '' : texto)) {
    const code = c.codePointAt(0);
    if (code === 0xa0 || code === 0x202f) bytes.push(0x20);               // espacios duros (Intl)
    else if (code === 0x20ac) bytes.push(0x45, 0x55, 0x52);                // € → EUR
    else if (code >= 0x20 && code < 0x7f) bytes.push(code);
    else if (PC850[c] !== undefined) bytes.push(PC850[c]);
    else if (c === '\n') bytes.push(LF);
    else {
      const base = c.normalize('NFD').replace(/[̀-ͯ]/g, '');
      bytes.push(base && base.codePointAt(0) < 0x7f ? base.codePointAt(0) : 0x3f);
    }
  }
  return bytes;
}

// Largo visible de un texto (para alinear columnas)
const largo = t => [...String(t)].length;

// Parte un texto en líneas de hasta "ancho" caracteres, cortando por palabras
function envolver(texto, ancho) {
  const lineas = [];
  for (const parrafo of String(texto == null ? '' : texto).split('\n')) {
    let actual = '';
    for (const palabra of parrafo.split(/\s+/).filter(Boolean)) {
      if (!actual) actual = palabra;
      else if (largo(actual) + 1 + largo(palabra) <= ancho) actual += ' ' + palabra;
      else { lineas.push(actual); actual = palabra; }
      while (largo(actual) > ancho) { lineas.push([...actual].slice(0, ancho).join('')); actual = [...actual].slice(ancho).join(''); }
    }
    lineas.push(actual);
  }
  return lineas;
}

class Ticket {
  // columnas: 32 para 58 mm, 48 para 80 mm (fuente A)
  constructor(columnas = 48) {
    this.columnas = columnas;
    this.escala = 1;
    this.bytes = [ESC, 0x40, ESC, 0x74, 0x02]; // inicializar + página PC850
  }

  // Caracteres por línea con el tamaño actual (doble ancho = la mitad)
  get ancho() { return Math.floor(this.columnas / this.escala); }

  alinear(modo) {
    this.bytes.push(ESC, 0x61, { izquierda: 0, centro: 1, derecha: 2 }[modo] || 0);
    return this;
  }

  negrita(activa = true) { this.bytes.push(ESC, 0x45, activa ? 1 : 0); return this; }

  // ancho y alto: 1 (normal) o 2 (doble)
  tamano(ancho = 1, alto = 1) {
    this.escala = ancho;
    this.bytes.push(GS, 0x21, ((ancho - 1) << 4) | (alto - 1));
    return this;
  }

  normal() { return this.tamano(1, 1).negrita(false).alinear('izquierda'); }

  // Texto con salto de línea, envuelto al ancho disponible
  linea(texto = '') {
    for (const l of envolver(texto, this.ancho)) this.bytes.push(...codificar(l), LF);
    return this;
  }

  // Texto a la izquierda y a la derecha en la misma línea (ej. producto ... precio)
  columnas2(izquierda, derecha) {
    const der = String(derecha == null ? '' : derecha);
    const espacio = this.ancho - largo(der) - 1;
    const lineas = envolver(izquierda, Math.max(8, espacio));
    lineas.forEach((l, i) => {
      if (i === lineas.length - 1) this.bytes.push(...codificar(l + ' '.repeat(Math.max(1, this.ancho - largo(l) - largo(der))) + der), LF);
      else this.bytes.push(...codificar(l), LF);
    });
    return this;
  }

  separador(caracter = '-') {
    this.bytes.push(...codificar(caracter.repeat(this.ancho)), LF);
    return this;
  }

  avanzar(lineas = 1) { this.bytes.push(ESC, 0x64, lineas); return this; }

  // Avanza el papel y corta (corte parcial)
  cortar() { this.bytes.push(GS, 0x56, 0x42, 0x03); return this; }

  // Pulso para abrir el cajón de dinero (pin 2)
  abrirCajon() { this.bytes.push(ESC, 0x70, 0x00, 0x19, 0xfa); return this; }

  buffer() { return Buffer.from(this.bytes); }
}

module.exports = { Ticket, codificar, envolver };
