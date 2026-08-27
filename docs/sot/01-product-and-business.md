# Producto y negocio

## Qué es

**VuePDF Forms Platform** es una plataforma para crear formularios PDF rellenables: el usuario sube un PDF, coloca campos interactivos sobre él (texto, textarea, checkbox, radio, dropdown) con un editor visual tipo canvas, publica el formulario tras un link público sin login, y recoge respuestas estructuradas exportables a CSV.

Dos casos de uso reales que ya cubre el código:
- **PDF en blanco** → el usuario dibuja los campos a mano sobre el canvas.
- **PDF que ya es un AcroForm** (formulario PDF nativo, ej. exportado de Adobe o de un formulario gubernamental) → el backend extrae automáticamente sus campos existentes al subirlo (`pdf-processor.ts::extractFieldsFromPDF`) y los carga en el editor listos para publicar. Esto no está en el README ni en los docs previos pero es una feature diferenciadora ya construida.

## A quién se vende

El objetivo declarado es venderlo como **micro-SaaS, B2B y B2C**. A fecha de este documento el producto **no tiene ningún mecanismo de venta**: no hay planes, no hay límites de uso, no hay facturación, no hay landing comercial. Es una app funcional de un solo tenant implícito (cada usuario ve solo sus propios forms) sin capa de negocio encima.

Dos motions distintas a las que la arquitectura target (ver [06-saas-target-architecture.md](./06-saas-target-architecture.md)) debe servir sin bifurcar el código:

| | B2C | B2B |
|---|---|---|
| Comprador | Individuo (freelance, gestor, asociación pequeña) | Equipo/empresa (RRHH, operaciones, atención al cliente) |
| Unidad de cuenta | 1 usuario = 1 cuenta | Organización con varios usuarios y roles |
| Sensibilidad a precio | Alta, plan gratuito/bajo coste | Media, paga por asientos + volumen de respuestas |
| Feature que más importa | Rapidez para publicar un form | Permisos, auditoría, marca propia, integraciones (API) |

## Modelo de monetización propuesto (a validar con el usuario antes de construir)

Basado en el dominio actual (`Form` → `Field` → `Response` → `Answer`), el eje de valor más natural para tarificar es **volumen de respuestas recogidas** y **número de formularios activos**, no "usuarios" — es lo que refleja el consumo real de storage/DB/CSV export.

Propuesta de tiers (punto de partida, no decisión final):

- **Free**: 1 formulario publicado, límite de respuestas/mes, marca "hecho con VuePDF" en el formulario público.
- **Pro (B2C)**: formularios ilimitados, sin marca, export CSV, límite de respuestas más alto.
- **Team (B2B)**: todo lo de Pro + múltiples usuarios en una organización, roles, límite de respuestas por volumen, webhooks/API.

Esto se detalla técnicamente en [06-saas-target-architecture.md](./06-saas-target-architecture.md); este documento solo fija el *por qué*.

## Qué NO hacer al construir la capa SaaS

- No acoplar límites de plan al código de negocio de forms/fields/responses. Los límites se comprueban en un middleware/servicio de "entitlements" separado — si mañana cambia el modelo de precios, no se debería tocar `routes/forms.ts`.
- No asumir que "usuario" y "cuenta que paga" son lo mismo — la B2B necesita que una organización pague y varios `User` pertenezcan a ella. Este quiebre es más fácil de introducir ahora, con pocos usuarios, que después.
