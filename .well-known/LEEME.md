# `.well-known/assetlinks.json`

Es lo que hace que `https://haceloya.com/...` abra la app en vez del navegador.
Android lo va a buscar acá solo, sin avisar, cuando alguien instala la app.

## Por qué estaba roto

El `AndroidManifest.xml` declara `autoVerify="true"` para cinco rutas de
haceloya.com desde hace semanas. El archivo existía — pero en **Firebase
Hosting** (`haceloyaapp-88e3d.web.app`), y haceloya.com es **GitHub Pages**.
Dos sitios distintos: en el dominio real daba 404.

Y encima el que estaba listaba el paquete `com.hacelo.app`, que no es el de
esta app. El real es `com.bissi.haceloapp` (`android/app/build.gradle:104`).

Dos errores a la vez, que es la razón por la que "estaba puesto" y no
funcionaba.

## FALTA UNA HUELLA, Y SIN ELLA ESTO NO SIRVE EN PLAY

La huella de acá es la del keystore que firma los APK que compilás vos
(`03:A0:3F:77…CC:CA`). Sirve para un APK instalado a mano, y **no sirve para
nadie que instale desde Google Play**.

Play App Signing **vuelve a firmar** la app con una clave propia, que todavía
no existe: aparece recién después de subir el primer AAB. Hasta entonces esta
huella es la única que se puede poner.

**Después de subir el primer AAB**, en Play Console → Configuración → Integridad
de la aplicación, copiar la SHA-256 del *certificado de la clave de firma de la
app* y **agregarla a la lista de arriba** — agregarla, no reemplazar: la de
acá sigue haciendo falta para tus propias compilaciones de prueba.

Sin ese segundo paso, los links siguen abriendo el navegador para todo el
mundo, exactamente como hasta hoy.

## Cómo se comprueba

    curl -s https://haceloya.com/.well-known/assetlinks.json

Tiene que devolver el JSON (no un 404) y con `content-type: application/json`.

Y la verificación de Android, ya con la app instalada:

    adb shell pm get-app-links com.bissi.haceloapp

Tiene que decir `verified` para haceloya.com. Si dice `legacy_failure` o
`none`, el archivo no se está leyendo bien.

## Ojo con GitHub Pages

Jekyll ignora por defecto las carpetas que empiezan con punto. El `.nojekyll`
de la raíz del repo es lo que evita que esta carpeta desaparezca del sitio
publicado. Si algún día los links dejan de andar, es lo primero que hay que
mirar.
