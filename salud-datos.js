/* Hato Claro — base de conocimiento de salud bovina para lechería de trópico alto (Sabana de Bogotá, Cundinamarca y Boyacá).
   Es orientativa: ayuda a reconocer señales y a decidir qué tan rápido llamar al veterinario. No da dosis ni reemplaza el diagnóstico profesional.
   Fuentes generales: Manual Merck de Veterinaria, FAO (Manejo sanitario eficiente del ganado bovino), programas sanitarios del ICA y literatura de lechería de trópico alto colombiano. */
(function (g) {
"use strict";

const SINTOMAS = [
  // General
  { id: "fiebre", t: "Fiebre (caliente, más de 39,5 °C)", g: "General" },
  { id: "no_come", t: "No come o come poco", g: "General" },
  { id: "decaida", t: "Decaída, triste, orejas caídas", g: "General" },
  { id: "adelgaza", t: "Adelgaza o pierde condición", g: "General" },
  { id: "no_se_levanta", t: "Echada, no se levanta", g: "General" },
  { id: "baja_leche", t: "Bajó la leche de golpe", g: "General" },
  { id: "deshidratada", t: "Ojos hundidos, piel que no vuelve", g: "General" },
  { id: "mucosas_palidas", t: "Encías y ojos pálidos", g: "General" },
  { id: "mucosas_cafe", t: "Encías color chocolate o moradas", g: "General" },
  { id: "edema_papada", t: "Hinchazón debajo de la mandíbula", g: "General" },
  { id: "muerte_subita", t: "Se murió un animal de repente", g: "General" },
  // Ubre
  { id: "ubre_caliente", t: "Ubre o cuarto caliente, duro o hinchado", g: "Ubre y leche" },
  { id: "leche_grumos", t: "Leche con grumos, aguada o con sangre", g: "Ubre y leche" },
  { id: "cmt_positivo", t: "CMT positivo o células altas, leche normal", g: "Ubre y leche" },
  { id: "ampollas_pezon", t: "Ampollas o llagas en los pezones", g: "Ubre y leche" },
  { id: "verrugas", t: "Verrugas en pezones o piel", g: "Ubre y leche" },
  // Digestivo
  { id: "panza_inflada", t: "Barriga inflada del lado izquierdo", g: "Digestivo" },
  { id: "diarrea", t: "Diarrea", g: "Digestivo" },
  { id: "diarrea_sangre", t: "Diarrea con sangre o moco", g: "Digestivo" },
  { id: "no_rumia", t: "No rumia", g: "Digestivo" },
  { id: "aliento_dulce", t: "Aliento o leche con olor dulce (a acetona)", g: "Digestivo" },
  { id: "babeo", t: "Babea mucho", g: "Digestivo" },
  { id: "ampollas_boca", t: "Ampollas o llagas en boca o lengua", g: "Digestivo" },
  { id: "heces_secas", t: "Heces escasas y secas", g: "Digestivo" },
  // Patas y movimiento
  { id: "cojea", t: "Cojea", g: "Patas y movimiento" },
  { id: "pezuna_mal", t: "Herida, mal olor o inflamación entre las pezuñas", g: "Patas y movimiento" },
  { id: "ampollas_patas", t: "Ampollas entre las pezuñas", g: "Patas y movimiento" },
  { id: "temblores", t: "Temblores o músculos que tiemblan", g: "Patas y movimiento" },
  { id: "convulsiones", t: "Convulsiones o ataques", g: "Patas y movimiento" },
  { id: "tambalea", t: "Camina tambaleando o se le van las patas", g: "Patas y movimiento" },
  { id: "nerviosa", t: "Nerviosa, agresiva o mugidos raros", g: "Patas y movimiento" },
  { id: "paralisis", t: "Parálisis de patas traseras", g: "Patas y movimiento" },
  // Respiratorio
  { id: "tos", t: "Tos", g: "Respiratorio" },
  { id: "respira_rapido", t: "Respira rápido o con dificultad", g: "Respiratorio" },
  { id: "moco_nasal", t: "Moco por la nariz", g: "Respiratorio" },
  // Reproductivo
  { id: "aborto", t: "Abortó", g: "Reproductivo" },
  { id: "placenta", t: "No ha botado la placenta (más de 12 horas)", g: "Reproductivo" },
  { id: "flujo_fetido", t: "Flujo vaginal con mal olor", g: "Reproductivo" },
  { id: "repite_celo", t: "Repite celo, no queda preñada", g: "Reproductivo" },
  // Ojos y piel
  { id: "ojo_lagrimeo", t: "Lagrimea o cierra un ojo", g: "Ojos y piel" },
  { id: "ojo_blanco", t: "Mancha blanca o azulosa en el ojo", g: "Ojos y piel" },
  { id: "pelo_erizado", t: "Pelo erizado y sin brillo", g: "Ojos y piel" },
];

const CONTEXTO = [
  { id: "pasto_fertilizado", t: "Pasto fertilizado hace poco o muy tierno" },
  { id: "mucho_concentrado", t: "Comió mucho concentrado o cambió la comida de golpe" },
  { id: "potrero_humedo", t: "Potreros húmedos o encharcados" },
  { id: "varios_animales", t: "Hay varios animales con lo mismo" },
];

/* Cada enfermedad: s = síntomas con peso (3 clave, 2 frecuente, 1 posible); ctx = contexto que suma;
   posparto = rango de días después del parto en que es típica; edad = "ternero" (<6 meses) o "adulto". */
const ENF = [
  { id: "mastitis", n: "Mastitis clínica", tipo: "Infecciosa", urg: "pronto", s: { ubre_caliente: 3, leche_grumos: 3, baja_leche: 2, fiebre: 1, no_come: 1, decaida: 1 }, edad: "adulto",
    r: "Infección de la ubre. Es el problema más costoso de la lechería: baja la leche, obliga a botarla durante el tratamiento y castiga la calidad.",
    zona: "Muy frecuente en ordeño mecánico y cuando falla el lavado de pezones o el equipo.",
    hacer: ["Ordeñe ese cuarto aparte y al final; esa leche no va al tanque.", "Haga prueba de CMT a toda la vaca.", "Llame al veterinario para elegir el tratamiento y respetar los días de retiro de la etiqueta.", "Si además tiene fiebre, no come o está echada, es urgente."],
    prev: ["Presellado y sellado de pezones en cada ordeño.", "Revise pezoneras y presión de vacío del equipo.", "Ordeñe de últimas a las vacas con mastitis.", "Tratamiento de secado según indique el veterinario."] },
  { id: "subclinica", n: "Mastitis subclínica", tipo: "Infecciosa", urg: "vigilar", s: { cmt_positivo: 3, baja_leche: 2 }, edad: "adulto",
    r: "Infección de la ubre sin cambios visibles en la leche. Sube el conteo de células somáticas del tanque y baja la producción sin que se note.",
    zona: "Es la causa más común de células somáticas altas en el tanque.",
    hacer: ["Haga CMT cuarto por cuarto a todas las vacas en ordeño para encontrar las que suben el conteo.", "Consulte al veterinario: a veces conviene cultivo de leche para saber qué bacteria es."],
    prev: ["Rutina de ordeño completa y equipo revisado.", "Descartar vacas con mastitis que se repite."] },
  { id: "fiebre_leche", n: "Hipocalcemia (fiebre de leche)", tipo: "Metabólica", urg: "urgente", s: { no_se_levanta: 3, temblores: 2, tambalea: 2, decaida: 1, heces_secas: 1, no_come: 1 }, posparto: [0, 4], edad: "adulto",
    r: "Le falta calcio en la sangre justo alrededor del parto. Primero tiembla y camina torpe; luego se echa y no se levanta.",
    zona: "Más común en vacas de tercer parto en adelante y muy productoras (Holstein, Jersey).",
    hacer: ["Llame al veterinario YA: sin tratamiento puede morir en horas.", "Mientras llega, acomódela echada sobre el pecho, no de lado, para que no se ahogue con el gas.", "No le dé líquidos a la fuerza por la boca."],
    prev: ["Manejo de la dieta en las 3 semanas antes del parto según su asesor.", "Vigile de cerca a las vacas viejas al parir."] },
  { id: "cetosis", n: "Cetosis (acetonemia)", tipo: "Metabólica", urg: "pronto", s: { aliento_dulce: 3, no_come: 2, baja_leche: 2, adelgaza: 2, decaida: 1, nerviosa: 1 }, posparto: [5, 50], edad: "adulto",
    r: "La vaca recién parida gasta más energía de la que come y empieza a quemar su grasa. Deja el concentrado, baja la leche y huele a acetona.",
    zona: "Frecuente en vacas gordas al parto y en las primeras 6 semanas de lactancia.",
    hacer: ["Llame al veterinario esta semana; si está nerviosa o no come nada, hoy.", "Asegure buen forraje y agua.", "Revise si tiene otra enfermedad que la tenga sin comer (metritis, abomaso)."],
    prev: ["Que las vacas no lleguen muy gordas al parto.", "Cambios de dieta graduales después del parto."] },
  { id: "abomaso", n: "Desplazamiento de abomaso", tipo: "Digestiva", urg: "pronto", s: { no_come: 3, baja_leche: 2, heces_secas: 2, no_rumia: 2, aliento_dulce: 1, decaida: 1 }, posparto: [3, 60], edad: "adulto",
    r: "El cuajar (abomaso) se llena de gas y se corre de puesto. Deja de comer concentrado, baja la leche y las heces se vuelven escasas.",
    zona: "Típico en las primeras semanas después del parto, sobre todo en vacas con cetosis o metritis.",
    hacer: ["Llame al veterinario: se confirma golpeando el costado y escuchando un sonido metálico, y casi siempre requiere corrección.", "No la deje en ayuno: ofrezca buen forraje."],
    prev: ["Buena transición de dieta antes y después del parto.", "Atender a tiempo la cetosis, la retención de placenta y la metritis."] },
  { id: "placenta", n: "Retención de placenta", tipo: "Reproductiva", urg: "pronto", s: { placenta: 3, flujo_fetido: 1, fiebre: 1 }, posparto: [0, 3], edad: "adulto",
    r: "La placenta no sale en las 12 a 24 horas después del parto. Aumenta el riesgo de metritis y de que tarde en volver a preñarse.",
    zona: "Más frecuente con partos difíciles, gemelos, hipocalcemia y deficiencias de selenio y vitamina E.",
    hacer: ["No la jale a la fuerza.", "Llame al veterinario, sobre todo si aparece fiebre o mal olor.", "Vigile si come y si le sube la temperatura en los días siguientes."],
    prev: ["Manejo del preparto y minerales según su asesor.", "Higiene en el sitio de parto."] },
  { id: "metritis", n: "Metritis o infección del útero", tipo: "Reproductiva", urg: "pronto", s: { flujo_fetido: 3, fiebre: 2, no_come: 2, baja_leche: 1, decaida: 1, repite_celo: 1 }, posparto: [2, 30], edad: "adulto",
    r: "Infección del útero después del parto. Sale flujo con mal olor; si es grave hay fiebre y la vaca deja de comer.",
    zona: "Sigue con frecuencia a partos asistidos y retenciones de placenta.",
    hacer: ["Llame al veterinario: con fiebre es urgente.", "Anote la fecha: atrasa la preñez y conviene revisarla antes de servirla."],
    prev: ["Parto en sitio limpio y seco.", "Atender a tiempo la retención de placenta."] },
  { id: "cojera", n: "Cojera por pezuña (dermatitis digital, úlcera o absceso)", tipo: "Patas", urg: "pronto", s: { cojea: 3, pezuna_mal: 3, baja_leche: 1, adelgaza: 1 }, edad: "adulto",
    r: "Dolor en la pezuña por infección entre los dedos (la 'fresa'), úlceras o abscesos de la suela. Come menos, produce menos y se demora en preñar.",
    zona: "Común con barro en corrales y caminos, y con dietas muy altas en concentrado.",
    hacer: ["Levante y revise la pezuña con buena luz.", "Llame al veterinario o a un podólogo bovino para recorte y tratamiento.", "Si varias vacas cojean, revise caminos, barro y la dieta."],
    prev: ["Caminos y salas sin barro ni piedras.", "Pediluvio y recorte funcional de pezuñas según su asesor."] },
  { id: "timpanismo", n: "Timpanismo (meteorismo)", tipo: "Digestiva", urg: "urgente", s: { panza_inflada: 3, respira_rapido: 2, no_rumia: 1, decaida: 1, no_se_levanta: 1 }, ctx: { pasto_fertilizado: 2, mucho_concentrado: 1, varios_animales: 1 },
    r: "El rumen se llena de gas o espuma y no lo puede eructar. La panza se infla del lado izquierdo y aprieta los pulmones.",
    zona: "En la Sabana aparece con kikuyo o raigrás muy tiernos y con potreros con mucho trébol, sobre todo al entrar con hambre.",
    hacer: ["Llame al veterinario YA: puede morir en pocas horas.", "Saque a ese grupo del potrero y manténgala de pie y caminando despacio.", "No le dé agua ni comida.", "Si respira con mucha dificultad y el veterinario no llega, pídale instrucciones por teléfono."],
    prev: ["No entrar con ganado hambriento a potreros tiernos o con mucho trébol.", "Dar algo de heno o pasto seco antes de entrar al potrero nuevo."] },
  { id: "tetania", n: "Hipomagnesemia (tetania de los pastos)", tipo: "Metabólica", urg: "urgente", s: { temblores: 3, nerviosa: 3, convulsiones: 3, tambalea: 2, no_se_levanta: 2, muerte_subita: 2 }, ctx: { pasto_fertilizado: 3, varios_animales: 1 }, edad: "adulto",
    r: "Falta de magnesio en la sangre. La vaca se pone nerviosa, tiembla, camina rígida y cae con convulsiones; puede morir rápido.",
    zona: "Riesgo en kikuyo y raigrás tiernos y muy fertilizados con nitrógeno y potasio, típico de lecherías de la Sabana, sobre todo con lluvias después de verano.",
    hacer: ["Llame al veterinario YA.", "No la altere ni la haga correr: el estrés puede provocar el ataque.", "Revise al resto del grupo y sáquelo de ese potrero."],
    prev: ["Suplemento de magnesio en épocas de riesgo según su asesor.", "No exagerar con abonos de potasio y nitrógeno en potreros de vacas en ordeño."] },
  { id: "nitratos", n: "Intoxicación por nitratos", tipo: "Tóxica", urg: "urgente", s: { mucosas_cafe: 3, respira_rapido: 2, tambalea: 2, muerte_subita: 2, temblores: 1, no_se_levanta: 1 }, ctx: { pasto_fertilizado: 3, varios_animales: 2 },
    r: "El pasto acumula nitratos (por mucha urea o tras una sequía) y en el rumen se convierten en nitritos, que no dejan que la sangre lleve oxígeno. Las encías se ven color chocolate.",
    zona: "Riesgo en kikuyo muy fertilizado con urea, en rebrotes después de verano y en avena forrajera.",
    hacer: ["Saque YA a todos los animales de ese potrero.", "Llame al veterinario de inmediato: existe tratamiento si se aplica a tiempo.", "Muévalos con calma: el esfuerzo empeora la falta de oxígeno."],
    prev: ["Esperar el tiempo recomendado después de abonar con urea antes de pastorear.", "Entrar al potrero con el ganado ya comido."] },
  { id: "fasciola", n: "Fasciola hepática (fasciolosis)", tipo: "Parasitaria", urg: "vigilar", s: { adelgaza: 3, edema_papada: 3, baja_leche: 2, mucosas_palidas: 2, diarrea: 1, pelo_erizado: 1 }, ctx: { potrero_humedo: 3, varios_animales: 1 },
    r: "Parásito del hígado que transmite un caracol de zonas húmedas. Las vacas adelgazan, bajan la leche y pueden hincharse debajo de la mandíbula ('botella').",
    zona: "Presente en el altiplano cundiboyacense; estudios en lecherías de Boyacá la encontraron en cerca de 1 de cada 9 animales.",
    hacer: ["Pida al veterinario un examen de materia fecal del grupo.", "El tratamiento lo indica el veterinario; varios productos tienen retiro largo en leche."],
    prev: ["Drenar o cercar charcos y nacimientos de agua donde vive el caracol.", "Plan de desparasitación según su asesor."] },
  { id: "parasitos", n: "Parásitos intestinales", tipo: "Parasitaria", urg: "vigilar", s: { diarrea: 2, adelgaza: 3, pelo_erizado: 2, mucosas_palidas: 2, edema_papada: 1 }, edad: "ternero",
    r: "Gusanos del estómago e intestino. Afectan sobre todo a terneras y novillas en pastoreo: crecen poco, tienen pelo feo y diarrea.",
    zona: "Común en terneras de levante en potreros compartidos.",
    hacer: ["Haga examen de materia fecal antes de purgar, para saber si hace falta y con qué.", "Pese o mida con cinta para ver si están ganando peso."],
    prev: ["Rotación de potreros y no sobrecargar.", "Purgar con base en exámenes, no por costumbre, para evitar resistencia."] },
  { id: "diarrea_ternero", n: "Diarrea de terneros recién nacidos", tipo: "Infecciosa", urg: "urgente", s: { diarrea: 3, deshidratada: 3, decaida: 2, no_come: 2, diarrea_sangre: 1, no_se_levanta: 1 }, edad: "ternero",
    r: "Infección intestinal en las primeras semanas de vida (bacterias, virus o parásitos). El peligro es la deshidratación: puede morir en uno o dos días.",
    zona: "Más frecuente con terneras en sitios húmedos y cuando no reciben buen calostro.",
    hacer: ["Siga dándole leche y además suero oral para terneros entre tomas.", "Llame al veterinario si no se para, no toma o tiene ojos hundidos.", "Sepárelo de los demás terneros y lave bien baldes y teteros."],
    prev: ["Calostro abundante en las primeras 6 horas de vida.", "Cama seca y limpia; baldes lavados."] },
  { id: "neumonia", n: "Neumonía (complejo respiratorio)", tipo: "Infecciosa", urg: "pronto", s: { tos: 3, respira_rapido: 3, moco_nasal: 2, fiebre: 2, no_come: 1, decaida: 1 },
    r: "Infección de los pulmones. Más común en terneros: tos, moco, respiración rápida y fiebre.",
    zona: "Aparece con frío, lluvias, corrientes de aire y cambios bruscos de clima, típicos de la Sabana.",
    hacer: ["Tome la temperatura; con fiebre llame al veterinario hoy.", "Póngalo en un sitio seco, sin corrientes pero ventilado."],
    prev: ["Buen calostro y abrigo para terneros.", "Plan de vacunación según su veterinario."] },
  { id: "ojo_rosado", n: "Queratoconjuntivitis (ojo rosado)", tipo: "Infecciosa", urg: "vigilar", s: { ojo_lagrimeo: 3, ojo_blanco: 3 }, ctx: { varios_animales: 1 },
    r: "Infección del ojo que se contagia con moscas y polvo. Lagrimea, cierra el ojo y aparece una mancha blanca.",
    zona: "Más común en terneras y novillas y en épocas de moscas.",
    hacer: ["Sepárela en un sitio con sombra y consulte al veterinario: tratada temprano no deja secuelas.", "Revise a los demás animales del grupo."],
    prev: ["Control de moscas.", "Evitar pastos altos con espigas que lastiman el ojo."] },
  { id: "acidosis", n: "Acidosis ruminal", tipo: "Digestiva", urg: "pronto", s: { diarrea: 2, no_come: 2, no_rumia: 2, cojea: 1, baja_leche: 1, decaida: 1 }, ctx: { mucho_concentrado: 3, varios_animales: 1 }, edad: "adulto",
    r: "El rumen se pone ácido por exceso de concentrado o cambios bruscos de dieta. Baja la grasa de la leche, hay diarrea y después cojeras.",
    zona: "Se ve cuando se sube el concentrado de golpe o se reparte en pocas raciones grandes.",
    hacer: ["Si comió mucho concentrado de una vez, llame al veterinario ya.", "Ofrezca forraje de buena fibra."],
    prev: ["Cambios de concentrado graduales, en varias raciones al día.", "Siempre suficiente pasto o forraje."] },
  { id: "reproductivas", n: "Enfermedades reproductivas (IBR, DVB, leptospirosis, neospora)", tipo: "Infecciosa", urg: "pronto", s: { aborto: 3, repite_celo: 2, placenta: 1, fiebre: 1 }, ctx: { varios_animales: 2 }, edad: "adulto",
    r: "Varias infecciones causan abortos, vacas que repiten celo y terneros débiles. Solo se distinguen con exámenes de laboratorio.",
    zona: "Presentes en lecherías de Cundinamarca y Boyacá; son causa frecuente de pérdidas reproductivas.",
    hacer: ["Guarde el feto y la placenta en una bolsa, en frío, y llame al veterinario para enviar muestras.", "Use guantes: algunas de estas enfermedades pasan a las personas."],
    prev: ["Plan de vacunación reproductiva con su veterinario.", "Exámenes a los animales que compre antes de mezclarlos."] },
  { id: "brucelosis", n: "Brucelosis", tipo: "Infecciosa · de control oficial", urg: "pronto", ica: true, zoo: true, s: { aborto: 3, placenta: 2, repite_celo: 1 }, edad: "adulto",
    r: "Infección que causa abortos, sobre todo en el último tercio de la preñez. Pasa a las personas por la leche cruda y al manipular fetos y placentas.",
    zona: "Tiene programa oficial del ICA con vacunación obligatoria de terneras. Un hato libre certificado recibe bonificación en el pago de la leche.",
    hacer: ["Use guantes y no toque el feto ni la placenta sin protección.", "Avise al veterinario y a la oficina local del ICA para la prueba.", "No consuma leche cruda de esa vaca."],
    prev: ["Vacunación de terneras según el ICA.", "Comprar animales de hatos libres y con prueba."] },
  { id: "tuberculosis", n: "Tuberculosis bovina", tipo: "Infecciosa · de control oficial", urg: "pronto", ica: true, zoo: true, s: { tos: 2, adelgaza: 3, baja_leche: 1, fiebre: 1, decaida: 1 }, edad: "adulto",
    r: "Infección crónica: tos que no se quita, adelgazamiento lento. Pasa a las personas por leche cruda y por el aire.",
    zona: "Tiene programa oficial del ICA. Un hato libre certificado recibe bonificación en el pago de la leche.",
    hacer: ["Avise al veterinario y a la oficina local del ICA para hacer la prueba de tuberculina.", "No consuma leche cruda."],
    prev: ["Pruebas periódicas del hato para certificarlo como libre."] },
  { id: "vesicular", n: "Fiebre aftosa o estomatitis vesicular", tipo: "Infecciosa · notificación inmediata al ICA", urg: "urgente", ica: true, s: { ampollas_boca: 3, ampollas_pezon: 3, ampollas_patas: 3, babeo: 3, cojea: 2, fiebre: 2, no_come: 1 }, ctx: { varios_animales: 2 },
    r: "Enfermedades que producen ampollas en boca, lengua, pezones y patas, con babeo y cojera. Por la boca no se pueden diferenciar a simple vista; las dos se reportan.",
    zona: "Colombia hace vacunación obligatoria contra la aftosa en los ciclos del ICA. Cualquier caso con ampollas se debe reportar.",
    hacer: ["Avise YA a la oficina local del ICA o a su veterinario.", "No saque ni meta animales de la finca hasta que el ICA revise.", "No reparta leche ni carne de esos animales."],
    prev: ["Vacunar contra aftosa en cada ciclo oficial y guardar el registro.", "Control de entrada de animales y vehículos."] },
  { id: "rabia", n: "Rabia (derriengue)", tipo: "Infecciosa · notificación inmediata al ICA", urg: "urgente", ica: true, zoo: true, s: { paralisis: 3, nerviosa: 3, babeo: 2, tambalea: 2, no_come: 1, convulsiones: 1 },
    r: "Enfermedad mortal que transmiten murciélagos vampiros. La vaca cambia de comportamiento, babea, muge raro y se paraliza de atrás hacia adelante. Pasa a las personas.",
    zona: "Hay casos de rabia de origen silvestre en varias regiones de Colombia; se vacuna en zonas de riesgo.",
    hacer: ["NO le meta la mano a la boca pensando que se atoró.", "Aíslela y avise de inmediato al ICA.", "Si alguien tuvo contacto con su saliva, que vaya al médico ya."],
    prev: ["Vacunar donde el ICA lo recomiende.", "Reportar mordeduras de murciélago en el ganado."] },
  { id: "papiloma", n: "Papilomatosis (verrugas)", tipo: "Infecciosa", urg: "vigilar", s: { verrugas: 3 },
    r: "Verrugas causadas por un virus. Suelen desaparecer solas, pero en los pezones estorban el ordeño.",
    zona: "Común en novillas jóvenes.",
    hacer: ["Consulte al veterinario si están en los pezones o son muy grandes."],
    prev: ["No compartir equipos sin desinfectar (agujas, descornadores)."] },
];

const ALARMAS = [
  { si: ["ampollas_boca", "ampollas_pezon", "ampollas_patas"], t: "Ampollas en boca, pezones o patas: avise de inmediato al ICA y no mueva animales de la finca." },
  { si: ["paralisis", "nerviosa"], t: "Cambios de comportamiento o parálisis: no le meta la mano a la boca (riesgo de rabia) y avise al ICA." },
  { si: ["mucosas_cafe"], t: "Encías color chocolate: posible intoxicación. Saque al grupo de ese potrero y llame ya al veterinario." },
  { si: ["no_se_levanta", "convulsiones"], t: "Animal caído o con convulsiones: llame al veterinario ahora mismo." },
  { si: ["muerte_subita"], t: "Muerte repentina: no abra el animal en la finca; llame al veterinario y al ICA, y revise al resto del grupo." },
  { si: ["aborto"], t: "Aborto: use guantes, guarde feto y placenta en frío y llame al veterinario." },
];

const URGENCIA = { urgente: ["Urgente: llame ya al veterinario", "bad"], pronto: ["Llame al veterinario hoy o mañana", ""], vigilar: ["Vigile y consulte en la próxima visita", "info"] };

/* diagnosticar({sintomas:[], contexto:[], diasPosparto, ternero}) → lista ordenada */
function diagnosticar({ sintomas = [], contexto = [], diasPosparto = null, ternero = null }) {
  const S = new Set(sintomas), C = new Set(contexto);
  const out = [];
  for (const e of ENF) {
    let pts = 0, clave = false; const coincide = [];
    for (const [id, w] of Object.entries(e.s)) if (S.has(id)) { pts += w; coincide.push(id); if (w >= 3) clave = true; }
    if (!pts) continue;
    for (const [id, w] of Object.entries(e.ctx || {})) if (C.has(id)) pts += w * 0.5;
    let mult = 1;
    if (e.posparto) { if (diasPosparto != null && diasPosparto >= e.posparto[0] && diasPosparto <= e.posparto[1]) pts += 2; else if (diasPosparto != null) mult *= 0.45; else mult *= 0.8; }
    if (e.edad === "ternero" && ternero === false) mult *= 0.4;
    if (e.edad === "adulto" && ternero === true) mult *= 0.3;
    const ref = Object.values(e.s).sort((a, b) => b - a).slice(0, 3).reduce((s, w) => s + w, 0);
    const pct = Math.min(clave ? 100 : 55, Math.round((pts * mult / ref) * 100));
    if (pct >= 25) out.push({ e, pct, coincide });
  }
  out.sort((a, b) => b.pct - a.pct || (a.e.urg === "urgente" ? -1 : 1));
  const alarmas = ALARMAS.filter((a) => a.si.some((id) => S.has(id))).map((a) => a.t);
  return { posibles: out.slice(0, 4), alarmas };
}

g.HC_SALUD = { SINTOMAS, CONTEXTO, ENF, ALARMAS, URGENCIA, diagnosticar,
  fuente: "Información orientativa basada en el Manual Merck de Veterinaria, la FAO, los programas sanitarios del ICA y literatura de lechería de trópico alto en Colombia. No reemplaza al médico veterinario." };
})(typeof window !== "undefined" ? window : globalThis);
