# Hato Claro

App para fincas lecheras: registro del hato, leche entregada, partos, servicios, diagnósticos, secados, tratamientos con retiro de leche, observaciones y calidad de la leche. Funciona sin señal y se instala en el celular como una app (PWA).

## Cómo se usa

- Abra el enlace en Chrome (Android) o Safari (iPhone) y elija **Instalar app** o **Agregar a inicio**.
- Los datos se guardan solo en ese celular. Desde **Más** se descargan en Excel o como copia de seguridad.

## Publicación

Cada cambio en la rama `main` se publica solo en GitHub Pages con el flujo `.github/workflows/pages.yml`.
Requisitos una sola vez: repositorio público y **Settings → Pages → Source: GitHub Actions**.

Al publicar una versión nueva hay que cambiar `VERSION` en `sw.js`; así los celulares que ya la tienen instalada reciben el aviso "Hay una versión nueva".

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
| `icons/` | Íconos de la app |
