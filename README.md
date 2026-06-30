# CV Kiwi

## Hurtigstart og viktige lenker

### Tjenester

- GitHub-repositoriet inneholder kildekoden og versjonshistorikken.
- [Netlify-prosjekt](https://app.netlify.com/projects/cvkiwi/overview) â€“ publisering av klienten.
- Google Cloud OAuth konfigureres med egne miljøvariabler for hvert miljø.
- [Google Drive](https://drive.google.com/) â€“ brukerens lagrede `CV Kiwi`-mappe.



### Første gang

Kjør backend-oppsett:

```powershell
cd server\CvBuilder.Api
dotnet restore
```

Kjør frontend-oppsett:

```powershell
cd client
npm install
```

### Starte appen lokalt

```powershell
# Vindu 1: PDF-API
cd server\CvBuilder.Api
dotnet run
```

```powershell
# Vindu 2: nettsiden
cd client
npm.cmd run dev
```

Åpne [http://localhost:5173](http://localhost:5173).

### Før GitHub-push

```powershell
cd C:\sti\til\cv-maker
npm.cmd --prefix client run build
git status
git add -A
git commit -m "Beskriv endringen"
git push
```

En lokal .NET/C# + React-løsning for å redigere CV-data, velge en prosjektmappe på PC-en, lagre tidligere CV-er og generere PDF basert på maler.

MVP-en inneholder standardmalen `cv-kiwi-standard`. Koden er lagt opp slik at nye maler kan registreres uten å skrive om editor, lagring eller PDF-endepunkt.

## Arkitektur

```text
cv-kiwi/
  server/CvBuilder.Api/      ASP.NET Core API + PDF-rendering
  client/                    React/Vite editor + lokal prosjektmappe-lagring
  docs/                      Analyse av CV-mal og videre designnotater
```

### Lagringsmodell

Frontend bruker File System Access API der nettleseren lar brukeren velge en mappe. I mappen lagres:

```text
cv-project.json          redigerbar CV-data og versjoner
images/                  opplastede bilder
exports/                 genererte PDF-er
```

Dette passer best i Chrome eller Edge på desktop. Dersom nettleseren ikke støtter File System Access API, faller appen tilbake til import/eksport av JSON og vanlig PDF-nedlasting.

## Kjør lokalt

### Server

```bash
cd server/CvBuilder.Api
dotnet restore
dotnet run

Åpne nytt powershell vindu

cd client
npm.cmd run dev
```

API-et starter normalt på `https://localhost:7153` eller `http://localhost:5153`.

### Klient

```bash
cd client
npm install
npm run dev
```

Åpne Vite-adressen, vanligvis `http://localhost:5173`.

## Google Drive-lagring

Appen kan lagre direkte i brukerens Google Drive uten egen brukerbase eller database. Brukeren autoriserer Google-kontoen sin i et Google-vindu, på samme måte som draw.io. Appen oppretter deretter mappen `CV Kiwi` i brukerens Drive og lagrer `cv-project.json` og genererte PDF-er der.

### Engangsoppsett for utvikler

1. Opprett et prosjekt i [Google Cloud Console](https://console.cloud.google.com/).
2. Aktiver **Google Drive API** for prosjektet.
3. Konfigurer OAuth-samtykkeskjermen. Legg til testbrukere mens appen er i testing.
4. Opprett en OAuth 2.0-klient av typen **Web application**.
5. Legg til disse autoriserte JavaScript-opprinnelsene:

   ```text
   http://localhost:5173
   https://DIN-NETLIFY-SIDE.netlify.app
   ```

6. Opprett `client/.env.local` basert på `client/.env.example`, og legg inn klient-ID-en:

   ```text
   VITE_GOOGLE_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com
   ```

`VITE_GOOGLE_CLIENT_ID` er en offentlig OAuth-klient-ID, ikke en hemmelighet. Ikke legg en OAuth client secret i frontend eller i en `VITE_`-variabel.

Ved Netlify-deploy må den samme variabelen legges inn under **Site configuration → Environment variables**, og Netlify-adressen må være registrert som en autorisert JavaScript-opprinnelse i Google Cloud.

Google Drive-integrasjonen ber bare om `drive.file`-tilgang. Den er begrenset til filer appen oppretter eller som brukeren eksplisitt åpner med appen.

## Generere PDF

1. Velg prosjektmappe.
2. Rediger innhold eller last inn eksempeldata.
3. Last opp profilbilde.
4. Trykk `Generer PDF`.
5. PDF lagres i `exports/` i prosjektmappen, og åpnes også som nedlastbar fil.

## Legge til en ny mal

1. Lag en ny klasse i `server/CvBuilder.Api/Templates` som implementerer `ICvPdfTemplate`.
2. Registrer den i `TemplateRegistry`.
3. Legg til eventuell forhåndsvisnings-CSS i React-klienten.

## Avgrensninger i MVP

- Lokal mappevelger bygger på nettleserstøtte, ikke en server-side mappevelger.
- Google Drive er planlagt som egen `ProjectStore`-implementasjon senere.
- Ikoner i toppfeltet er representert som en enkel aksentmarkør for å unngå font-avhengigheter.
- PDF-malen prioriterer stabil, data-drevet rendering fremfor absolutt pikselkopi av den opprinnelige PDF-en.
