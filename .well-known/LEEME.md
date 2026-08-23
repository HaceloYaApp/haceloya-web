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

---

# Y falta el gemelo de iOS: `apple-app-site-association`

Hoy da **404**. Es lo mismo que `assetlinks.json` pero para iPhone: sin él, los
links de haceloya.com abren Safari en vez de la app.

**No se puede escribir todavía**, y no es por olvido. El archivo lleva
`<TEAM_ID>.com.bissi.haceloapp`, y el Team ID sale de la cuenta de
desarrollador de Apple — que al 23/08/2026 **no está aprobada**. Inventar el
valor sería peor que no tener el archivo: Apple los cachea de forma agresiva y
quedaría uno inválido dando vueltas.

Cuando la cuenta esté aprobada, el Team ID se ve en
developer.apple.com → Membership. El archivo va acá al lado, se llama
`apple-app-site-association` **sin extensión** (no `.json`, aunque el contenido
sea JSON), y queda así:

    {
      "applinks": {
        "apps": [],
        "details": [
          {
            "appID": "<TEAM_ID>.com.bissi.haceloapp",
            "paths": ["*"]
          }
        ]
      }
    }

Dos trampas propias de iOS:

1. **Se sirve sin extensión y con `content-type: application/json`.** GitHub
   Pages lo manda como `application/octet-stream` si no tiene extensión, y
   entonces iOS lo ignora en silencio. Hay que forzar el tipo desde Cloudflare
   (Transform Rules → Modify Response Header, sólo para esa ruta).
2. **`app.json` ya declara `associatedDomains: ["applinks:haceloya.com"]`**, así
   que del lado de la app está listo. Lo único que falta es este archivo.

Comprobación, una vez publicado:

    curl -sI https://haceloya.com/.well-known/apple-app-site-association | grep -i content-type
