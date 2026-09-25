// LAS SECCIONES DEL CATÁLOGO, PARA EL PANEL WEB.
//
// COPIA GENERADA, NO ESCRITA A MANO. El original vive en el repo de la app
// (src/data/rubros.ts y src/data/profesiones.ts), y acá hace falta para que el
// panel web ofrezca las mismas secciones que el del celular al resolver un
// alta. Sin esto, desde la web habría que escribir el nombre de la sección de
// memoria y una letra distinta crearía una sección nueva sin querer.
//
// Son SÓLO los nombres de las secciones —48 en total—, no las 583 entradas
// del catálogo: el panel necesita saber dónde poner algo, no la lista completa
// de oficios.
//
// Hay un test en el repo de la app (catalogoWebSincronizado) que falla si esto
// se queda atrás.

export const SECCIONES_DEL_CATALOGO: Record<string, string[]> = {
  oficio: [
    "Hogar y reparaciones",
    "Climatización y electrodomésticos",
    "Limpieza",
    "Construcción e ingeniería",
    "Automotor",
    "Tecnología",
    "Mudanzas y logística",
    "Seguridad",
    "Cuidado de personas",
    "Mascotas",
    "Eventos",
    "Profesionales y trámites",
    "Educación",
    "Costura y calzado",
    "Changas y mandados",
    "Otros",
  ],
  actividad: [
    "Gimnasio y funcional",
    "Deportes de equipo",
    "Deportes de raqueta",
    "Deportes acuáticos",
    "Deportes de combate",
    "Mente y cuerpo",
    "Aire libre y aventura",
    "Otros",
  ],
  turno: [
    "Salud general",
    "Salud mental y terapias",
    "Salud especializada",
    "Nutrición",
    "Odontología",
    "Estética y belleza",
    "Mascotas",
  ],
  puesto: [
    "Comercial, ventas y atención al cliente",
    "Administración, contabilidad y finanzas",
    "Recursos humanos y legales",
    "Producción, industria y mantenimiento",
    "Logística, depósito y transporte",
    "Construcción y obra",
    "Tecnología y sistemas",
    "Marketing, diseño y comunicación",
    "Salud y cuidado de personas",
    "Educación y formación",
    "Gastronomía, hotelería y turismo",
    "Limpieza, seguridad y mantenimiento edilicio",
    "Campo, agro y pesca",
    "Energía, minería y medio ambiente",
    "Estética, belleza y bienestar",
    "Arte, espectáculo y deporte",
    "Otros",
  ],
};
