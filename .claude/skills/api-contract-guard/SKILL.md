---
name: api-contract-guard
description: Verificar que un endpoint documentado (en docs/sot/05-api-reference.md o API_DOCUMENTATION.md) coincide exactamente con la implementación real en backend/src/routes/ y con el uso real en frontend/src/services/. Usar antes de documentar cualquier endpoint, al revisar un PR que toque rutas, o cuando algo en la API "no cuadra" entre frontend y backend.
---

# Guardia de contrato API

En 2026-08 se detectó que `API_DOCUMENTATION.md` describía endpoints de fields (`GET .../fields`, `PUT .../fields/bulk` con semántica de upsert, `DELETE .../fields/bulk`) que **nunca existieron** en el backend real. Nadie lo notó porque la documentación se escribió una vez y nunca se verificó contra el código según fue cambiando. Esta skill existe para que no vuelva a pasar.

## Regla central

**Un endpoint solo se documenta después de leer el fichero de ruta real, no antes.** La fuente de verdad, en este orden:

1. `backend/src/app.ts` — para saber el prefijo real bajo el que está montado cada router (ej. `formFieldsRouter` está montado en `/api/forms`, no en `/api/fields` aunque el nombre del router sugiera lo contrario).
2. `backend/src/routes/*.ts` — el handler real, su método HTTP, su path, el schema Zod que valida el body (eso define el shape exacto del request, no lo que "parece lógico").
3. `frontend/src/services/*.ts` — cómo lo consume el cliente real. Si el frontend llama a una URL o shape distinta de lo que el backend implementa, hay un bug activo, no solo un problema de documentación — repórtalo como tal.

## Checklist al documentar o revisar un endpoint

- [ ] ¿El método HTTP y el path coinciden exactamente con el `router.<method>('<path>', ...)` del código?
- [ ] ¿El middleware de auth/ownership real está reflejado (`authenticate`, `verifyFormOwnership`, `verifyFieldOwnership` de `backend/src/middleware/`)? No asumir que todo lleva auth ni que ninguno la lleva.
- [ ] ¿El shape del body documentado coincide con el schema Zod (`z.object({...})`) del fichero de ruta, campo por campo, incluyendo cuáles son opcionales?
- [ ] ¿Los códigos de estado documentados (200/201/400/401/403/404) son los que el handler realmente devuelve, incluyendo los que vienen del `errorHandler` genérico vía `AppError`?
- [ ] ¿Hay efectos secundarios no obvios que un consumidor de la API necesita saber? (ej. `bulk` de fields borra y recrea todos los campos, no hace upsert — ver `docs/sot/03-backend-patterns.md`)
- [ ] ¿El frontend (`frontend/src/services/`) usa realmente esta forma, o hay un desfase también ahí?

## Al encontrar un desfase

1. El código (backend real) manda sobre cualquier documento — nunca "corrijas" el backend para que cuadre con lo que decía un doc, a menos que el doc describiera un requisito de producto explícito que aún no se implementó (en ese caso, es una tarea de `docs/NEXT_TASKS.md`, no un bug de docs).
2. Corrige `docs/sot/05-api-reference.md` primero (es la fuente canónica).
3. Si `API_DOCUMENTATION.md` también tiene el error, corrígelo ahí también — se mantiene como documento público/histórico pero no debe mentir activamente.
4. Si el desfase es entre frontend y backend (no solo documentación), trátalo como bug: decide cuál de los dos lados es el comportamiento correcto y arregla el otro, no los documentes ambos como si coexistieran.
