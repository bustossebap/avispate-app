Diseña una aplicación móvil multiplataforma para iOS y Android enfocada en ayudar a las personas a registrar eventos, vencimientos y tareas importantes que suelen olvidar, y enviar recordatorios oportunos, incluyendo la posibilidad de recibirlos por WhatsApp.

## CONCEPTO DEL PRODUCTO

La aplicación funciona como una “memoria externa” para cosas importantes de la vida cotidiana que no ocurren con suficiente frecuencia como para recordarlas fácilmente.

Ejemplos:

* Renovar licencia de conducir
* Renovar pasaporte
* Revisión técnica del automóvil
* Cambio de batería del control remoto del auto
* Renovar documentos
* Mantención del automóvil
* Pago o renovación de seguros
* Vencimiento de garantías
* Renovación de contratos
* Controles o revisiones periódicas
* Cualquier tarea o evento futuro que el usuario no quiera olvidar

El objetivo principal es que el usuario pueda registrar algo en pocos segundos y olvidarse de ello, confiando en que la aplicación se encargará de recordárselo en el momento adecuado.

No diseñar la aplicación como un calendario tradicional. El foco debe estar en “cosas que no quiero olvidar”.

## NOMBRE PROVISIONAL

Usar como nombre provisional “RECUERDA”.

Crear una identidad visual moderna, simple, confiable y amigable.

## PRINCIPIOS DE UX

1. Registrar un evento debe tomar muy pocos pasos.
2. La aplicación debe transmitir tranquilidad: “ya está registrado, no tienes que acordarte”.
3. Mostrar claramente qué cosas están próximas a vencer.
4. Los recordatorios deben ser configurables.
5. Permitir que un evento tenga múltiples recordatorios.
6. Los eventos pueden ser únicos o recurrentes.
7. WhatsApp debe aparecer como un canal de recordatorio importante, pero no necesariamente como el único.
8. Evitar una interfaz sobrecargada.
9. Priorizar claridad sobre cantidad de funciones.
10. Diseñar pensando en usuarios que no necesariamente son expertos en tecnología.

# PANTALLAS PRINCIPALES

## 1. ONBOARDING

Crear un onboarding breve de 3 pantallas.

Pantalla 1:
Título:
“Deja de acordarte de todo.”

Texto:
“Registra las cosas importantes y nosotros te avisamos cuando llegue el momento.”

Pantalla 2:
Título:
“Recibe recordatorios a tiempo”

Explicar que el usuario puede recibir recordatorios mediante notificaciones y WhatsApp.

Pantalla 3:
Título:
“Tú eliges cuándo avisarte”

Explicar que un mismo evento puede tener varios recordatorios, por ejemplo:

* 30 días antes
* 7 días antes
* 1 día antes

CTA:
“Comenzar”

## 2. HOME / INICIO

Diseñar una pantalla principal extremadamente clara.

Arriba:
“Hola 👋”

Debajo:
“Esto es lo que no deberías olvidar.”

Mostrar una sección destacada:

“PRÓXIMAMENTE”

Cards de eventos próximos, por ejemplo:

🚗 Revisión técnica
“Vence en 18 días”
“22 septiembre 2026”

📄 Pasaporte
“Vence en 4 meses”
“15 enero 2027”

🚘 Batería control remoto
“Recordatorio en 7 días”

Utilizar indicadores visuales de urgencia:

* Normal
* Próximo
* Urgente
* Vencido

Debajo:

“Todos tus recordatorios”

Mostrar una lista organizada por fecha.

Agregar un botón flotante o CTA muy visible:

“+ Nuevo recordatorio”

La acción principal de la aplicación debe ser crear un nuevo recordatorio.

## 3. CREAR RECORDATORIO

Diseñar un flujo extremadamente simple.

Título de pantalla:
“¿Qué quieres recordar?”

Campo principal:
“Ej. Renovar licencia de conducir”

Después:

“¿Cuándo?”

Selector de fecha.

Opcionalmente:
Hora.

Sección:
“¿Quieres que se repita?”

Opciones:

* No se repite
* Cada semana
* Cada mes
* Cada año
* Personalizado

Sección:
“¿Cuándo quieres que te avisemos?”

Permitir agregar múltiples recordatorios.

Ejemplo:

🔔 30 días antes
🔔 7 días antes
🔔 1 día antes

Botón:
“+ Agregar recordatorio”

Sección:
“¿Dónde quieres recibirlo?”

Opciones:
✓ Notificación
✓ WhatsApp

Mostrar WhatsApp como una opción especialmente visible.

CTA principal:
“Guardar recordatorio”

## 4. DETALLE DEL EVENTO

Crear una pantalla de detalle para un evento.

Ejemplo:

🚗
Revisión técnica

22 septiembre 2026

“Faltan 18 días”

Mostrar una cuenta regresiva visual.

Información:

Fecha
22 septiembre 2026

Hora
10:00

Repetición
Cada año

Recordatorios
30 días antes
7 días antes
1 día antes

Canales
WhatsApp
Notificación

Botones:
“Editar”
“Marcar como completado”

También incluir:
“Eliminar recordatorio”

## 5. CALENDARIO

Crear una vista calendario opcional.

El calendario debe ser secundario frente a la lista de eventos.

Mostrar puntos o indicadores debajo de los días que tengan eventos.

Al seleccionar un día, mostrar los eventos correspondientes.

Agregar filtros:

* Todos
* Próximos
* Vencidos
* Recurrentes

## 6. CATEGORÍAS

Permitir clasificar los recordatorios.

Categorías iniciales:

🚗 Auto
📄 Documentos
🏠 Hogar
💳 Finanzas
💼 Trabajo
❤️ Personal
🔧 Mantención
📦 Otros

El usuario también debe poder crear categorías personalizadas.

## 7. EVENTOS RECURRENTES

Diseñar una experiencia especialmente buena para eventos que se repiten.

Ejemplos:

“Revisión técnica”
Repetir cada año.

“Cambiar batería del control remoto”
Repetir cada 2 años.

“Renovar pasaporte”
Repetir cada 10 años.

Permitir frecuencias personalizadas:
Cada X días
Cada X semanas
Cada X meses
Cada X años

## 8. RECORDATORIOS POR WHATSAPP

Crear una pantalla conceptual para configurar WhatsApp.

Título:
“Recordatorios por WhatsApp”

Texto:
“Recibe un mensaje cuando sea hora de hacer algo importante.”

Mostrar un ejemplo visual de conversación:

RECUERDA
“🔔 Recordatorio

La revisión técnica de tu auto vence en 7 días.

📅 22 septiembre 2026

¿Ya lo hiciste?”

Botones simulados:
“Marcar como hecho”
“Recordarme después”

IMPORTANTE:
Diseñar esta funcionalidad como una experiencia conceptual de producto. No asumir todavía una implementación técnica específica de WhatsApp.

## 9. CENTRO DE NOTIFICACIONES

Crear una pantalla con historial de recordatorios enviados.

Ejemplo:

Hoy
🔔 Revisión técnica
“Tu revisión técnica vence en 7 días.”

Ayer
📄 Pasaporte
“Tu pasaporte vence en 4 meses.”

Mostrar estados:
Enviado
Leído
Completado

## 10. PERFIL / AJUSTES

Incluir:

Mi perfil
Número de teléfono
WhatsApp conectado

Preferencias de notificaciones
Notificaciones push
WhatsApp
Correo electrónico

Configuración predeterminada de recordatorios

Ejemplo:
“Recordarme por defecto 7 días antes”

Zona horaria

Idioma

Privacidad

Ayuda

## DISEÑO VISUAL

Crear una interfaz premium pero sencilla.

Inspiración conceptual:

* Apple Reminders
* Things
* Todoist
* Google Calendar
* aplicaciones modernas de productividad

Pero NO copiar ninguna interfaz existente.

Usar:

* Mucho espacio en blanco
* Tipografía moderna y muy legible
* Cards limpias
* Bordes redondeados
* Iconografía sencilla
* Jerarquía visual fuerte
* Animaciones sutiles
* Estados claros

La aplicación debe sentirse:

* Confiable
* Tranquila
* Inteligente
* Moderna
* Personal
* Fácil de usar

Evitar estética excesivamente corporativa o de aplicación financiera.

## SISTEMA DE ESTADOS

Diseñar visualmente cuatro estados:

NORMAL
El evento está lejos.

PRÓXIMO
El evento se acerca.

URGENTE
Falta poco tiempo.

VENCIDO
La fecha ya pasó.

Los estados deben poder distinguirse incluso sin depender exclusivamente del color.

## COMPONENTES

Crear componentes reutilizables para:

* Event Card
* Reminder Card
* Date Picker
* Category Chip
* Reminder Chip
* Notification Item
* Primary Button
* Secondary Button
* Floating Action Button
* Bottom Navigation
* Empty State
* Confirmation Modal
* WhatsApp Reminder Preview

## NAVEGACIÓN

Usar una navegación inferior con:

Inicio
Calendario
Recordatorios
Ajustes

El botón “+” para crear recordatorios debe tener una presencia visual destacada.

## EMPTY STATES

Diseñar estados vacíos.

Ejemplo para Home:

“Todo bajo control ✨”

“No tienes recordatorios próximos.”

CTA:
“Agregar mi primer recordatorio”

## DATOS DE EJEMPLO

Utilizar estos eventos para poblar el prototipo:

Revisión técnica
22 septiembre 2026
Categoría: Auto

Renovar licencia de conducir
15 octubre 2026
Categoría: Documentos

Cambiar batería control remoto
30 septiembre 2026
Categoría: Auto

Renovar pasaporte
15 enero 2027
Categoría: Documentos

Seguro del auto
10 noviembre 2026
Categoría: Finanzas

## PROTOTIPO

Crear un prototipo navegable que permita recorrer el flujo principal:

Home
→ Nuevo recordatorio
→ Crear evento
→ Configurar fecha
→ Configurar múltiples recordatorios
→ Seleccionar WhatsApp
→ Guardar
→ Ver evento en Home
→ Abrir detalle
→ Marcar como completado

También crear un flujo para editar y eliminar eventos.

## RESPONSIVE

Diseñar principalmente para smartphone.

Crear versiones visuales para:

* iPhone
* Android

Mantener una arquitectura de componentes consistente entre ambas plataformas.

## IMPORTANTE

No convertir el producto en un simple calendario o gestor de tareas.

La propuesta de valor central es:

“Dime qué cosa importante no quieres olvidar y cuándo ocurre. Yo me encargo de recordártelo.”

La experiencia debe hacer que el usuario sienta que puede registrar algo hoy y olvidarse completamente de ello hasta que realmente sea necesario actuar.
