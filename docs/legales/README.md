# Documentos legales de Morfi

| Documento | Archivo | Para quién |
|---|---|---|
| Política de privacidad (Ley 25.326) | `landing/privacidad.html` | Público: clientes de Morfi, visitantes de la web, comensales |
| Términos y condiciones (contrato del servicio) | `landing/terminos.html` | Cada local que usa Morfi |
| Orden de alta (para firmar) | `docs/legales/ORDEN-DE-ALTA.md` | Cada local nuevo, junto con los términos |
| Aviso para los comensales del local | este archivo, más abajo | Para que el local lo muestre a sus clientes |

Las dos páginas tienen enlaces en el pie de la landing. Lo que describen sale del código: qué se guarda en la PC, qué
pasa por Morfi Nube (`src/servicios/sync-nube.js`, `nube/tienda.js`), los planes, la prueba y la gracia
(`src/planes.js`, `src/licencia.js`) y la copia cifrada (`src/servicios/copia-nube.js`). **Si cambia algo de eso,
hay que actualizar también estos textos.** Por ejemplo, si la nube empieza a recibir datos de clientes, o si cambian
los días de prueba o de gracia o los precios.

## Antes de publicarlas

1. **Datos del titular**: ya completos (Andrea Díaz, CUIT 27-95977489-2, Puan 387, CABA, contacto
   andreadiazdoria9627@gmail.com, precios finales, jurisdicción CABA). Si se agrega un dato pendiente, se marca con
   `<span class="completar">…</span>`, que se ve en amarillo. Para buscarlos: `grep -n 'class="completar"' landing/*.html`.
2. **Decisiones tomadas** (24/10/2026). Si cambia alguna, actualizarla también en las páginas:
   - Fecha de vigencia: 24 de octubre de 2026. Cambiarla si la publicación es otro día.
   - Medios de pago: transferencia bancaria o Mercado Pago.
   - Soporte: de lunes a sábado de 10 a 20 h. Si el local no puede vender ni cobrar, se atiende primero.
   - Hosting de Morfi Nube: "se informa a pedido". Cuando se elija, nombrarlo en `privacidad.html`, punto 6.
   - Los datos de Morfi Nube se borran 30 días después de la baja.
   - Las consultas de quien no contrata se guardan 12 meses.
   - Tope de responsabilidad: lo pagado en los últimos 3 meses.
   - Reintegro en la baja: el mes en curso no se reintegra. En pagos semestrales o anuales se reintegran los meses
     enteros no usados, a precio mensual.
3. **Inscribir la base de datos de clientes de Morfi** en el Registro Nacional de Bases de Datos de la Agencia de
   Acceso a la Información Pública (AAIP). Es un trámite gratuito en Trámites a Distancia (TAD), con clave fiscal.
   Se inscribe la base de "clientes y prospectos": dueños de locales, contactos y cuentas de Morfi Nube. Con el
   número de inscripción, agregar en `privacidad.html`, punto 1: "Base de datos inscripta en el Registro Nacional
   de Bases de Datos con el número …".
4. **Que lo revise un abogado.** Los textos siguen la Ley 25.326, el Código Civil y Comercial (contratos de adhesión,
   arts. 984 a 989) y lo que hace el sistema hoy. No reemplazan el asesoramiento profesional, sobre todo en la
   limitación de responsabilidad y la jurisdicción.
5. Al publicar la landing, subir también `privacidad.html`, `terminos.html` y `legal.css`.

## Aviso para los comensales del local

El local es el responsable de los datos de sus clientes y tiene que informarles. Este texto se le puede dar al local
para que lo pegue en su carta online, en el ticket o en un cartel. Reemplazar lo que está entre corchetes:

> **Tus datos.** [NOMBRE DEL LOCAL] (CUIT [CUIT DEL LOCAL]) guarda tu nombre, teléfono y dirección solo para
> preparar y entregar tu pedido, emitir la factura y, si lo aceptás, avisarte de promociones. No los vende ni los
> cede. Podés pedir verlos, corregirlos o borrarlos escribiendo a [CONTACTO DEL LOCAL]. El titular de los datos
> personales tiene la facultad de ejercer el derecho de acceso a los mismos en forma gratuita a intervalos no
> inferiores a seis meses, salvo que se acredite un interés legítimo al efecto conforme lo establecido en el
> artículo 14, inciso 3 de la Ley N.º 25.326. La AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA, en su carácter de
> Órgano de Control de la Ley N.º 25.326, tiene la atribución de atender las denuncias y reclamos que interpongan
> quienes resulten afectados en sus derechos por incumplimiento de las normas vigentes en materia de protección de
> datos personales.

Si el local activa el Asistente IA o WhatsApp, agregar: "Si nos escribís por WhatsApp, tus mensajes pasan por
WhatsApp (Meta) y, si te atiende el asistente automático, por Anthropic, que pueden procesarlos fuera de la Argentina."

Pendiente en el sistema: mostrar este aviso solo, con los datos del local, en la carta online y en el pedido desde
la mesa (`public/menu.html`, `public/pedido.html`). Hoy hay que pegarlo a mano.
