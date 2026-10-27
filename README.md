# Hato Claro

App para fincas de leche y carne: registro del hato, leche entregada, partos, servicios, diagnósticos, secados, tratamientos con retiro de leche, observaciones y calidad de la leche. Funciona sin señal y se instala en el celular como una app (PWA).

## Cómo se usa

- Abra el enlace en Chrome (Android) o Safari (iPhone) y elija **Instalar app** o **Agregar a inicio**.
- Los datos se guardan solo en ese celular. Desde **Más** se descargan en Excel o como copia de seguridad.

## Publicación

Cada cambio en la rama `main` se publica solo en GitHub Pages con el flujo `.github/workflows/pages.yml`.
Requisitos una sola vez: repositorio público y **Settings → Pages → Source: GitHub Actions**.

Al publicar una versión nueva hay que cambiar `VERSION` en `sw.js`; así los celulares que ya la tienen instalada reciben el aviso "Hay una versión nueva".

## Qué hace (versión 2.1)

- **Hato:** fichas, ciclos reproductivos, peso con cinta, valor y candidatas a descarte, buscador.
- **Ceba:** pesajes del lote con báscula o cinta, ganancia diaria por animal, fecha estimada de venta y alertas de animales listos o que ganan poco.
- **Leche:** entregas, calidad, lectura del PDF de liquidación de Colanta (uno o cientos a la vez) y simulador de pago por calidad.
- **Plata:** gastos, gastos fijos, trabajo familiar, compras de Agrocolanta automáticas, costo y ganancia por litro.
- **Potreros:** mapa satelital, dibujo tocando o caminando con GPS, rotación, días de descanso y alertas.
- **Salud:** revisión de síntomas con posibles causas y base de enfermedades de trópico alto (orientativa).
- **Registro por voz**, varios animales a la vez y productos recordados con sus días de retiro.
- **Avisos en el celular** (Chrome en Android con la app instalada).
- **Nube opcional** con varias personas y roles: ver `supabase/GUIA.md`.

## Archivos

| Archivo | Qué es |
| --- | --- |
| `index.html` | Estructura de la app |
| `styles.css` | Estilos y colores de la marca |
| `app.js` | Toda la lógica: datos, alertas, formularios, exportación |
| `sw.js` | Guarda la app en el celular para usarla sin señal y maneja las actualizaciones |
| `manifest.webmanifest` | Nombre, ícono y colores para instalarla |
| `colanta.js` | Lector de la liquidación semanal de Colanta en PDF |
| `vendor/pdf.min.js`, `vendor/pdf.worker.min.js` | Librería PDF.js 3.11.174 para leer los PDF dentro del celular |
| `vendor/xlsx.full.min.js` | Librería SheetJS 0.18.5 para crear el Excel |
| `precios.json` | Precios de referencia del ganado (Fedegán): gordo semanal por región, levante machos y hembras mensual |
| `scripts/actualizar_precios.py` | Trae los precios semanales de Fedegán; lo corre GitHub Actions los sábados y lunes antes de publicar |
| `salud-datos.js` | Base de síntomas y enfermedades, y la lógica de posibles causas |
| `vendor/leaflet/` | Leaflet 1.9.4 para el mapa de potreros |
| `vendor/supabase.js` | Cliente de Supabase 2.45.4 para la nube |
| `supabase/esquema.sql`, `supabase/GUIA.md` | Base de datos de la nube con sus reglas de seguridad, y la guía para activarla |
| `icons/` | Íconos de la app |
