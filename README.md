# Hacelo Ya — sitio web

Sitio informativo de [Hacelo Ya](https://github.com/HaceloYaApp/Hacelo-Ya-App), publicado con GitHub Pages.

- Contacto: haceloyaapp@gmail.com
- Dominio: haceloya.com (en configuración)

Para editar la landing, modificá `index.html` y hacé push a `main` — GitHub Pages redeploya automáticamente.

## /agenda — Mi agenda (web)

`agenda-app/` es el código fuente (React + Vite + TypeScript) de `haceloya.com/agenda`:
login con la misma cuenta de la app (Firebase Auth) y la agenda (trabajos de
la plataforma + entradas personales), usando el mismo proyecto Firebase
(`haceloyaapp-88e3d`) que la app mobile.

GitHub Pages sirve archivos estáticos directo desde `main` (sin build
propio), así que el build de Vite se genera localmente y su salida
(`agenda-app/dist`) se commitea directo en `/agenda` en la raíz del repo:

```bash
cd agenda-app
npm install
npm run build   # genera ../agenda (outDir configurado en vite.config.ts)
```

Después hay que hacer `git add agenda agenda-app` y push a `main` como
cualquier otro cambio.
