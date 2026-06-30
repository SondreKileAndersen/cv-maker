# Analyse av CV-malen

Denne analysen beskriver byggeklossene i den opplastede CV-en og hvordan de er oversatt til en data-drevet PDF-mal.

## Dokumentformat

- Format: A4 portrett, ca. 595 x 842 pt.
- Antall sider i referanse: 2.
- Side 1 har toppbanner. Side 2 starter direkte med seksjonsfane.
- Innholdet er venstrejustert med hovedmargin rundt 40 pt.

## Fargepalett

| Rolle | Hex | Bruk |
| --- | --- | --- |
| Mørk bakgrunn | `#212121` | Toppbanner og seksjonsfaner |
| Aksent | `#FFAE3D` | Bildekant, ikoner/markører og tittelunderstreker |
| Kroppstekst | `#7A7A7A` | Metadata, beskrivelser og kontaktinformasjon |
| Lys tekst | `#D3D3D3` | Kontaktfelt i toppbanner |
| Hvit | `#FFFFFF` | Navn og seksjonsfaner |
| Svart | `#000000` | Stillings-/utdanningstitler |

## Typografi

- Hovedfont i PDF-en: Calibri / Calibri Bold.
- Navn: ca. 24 pt, bold, hvit, fordelt på to linjer.
- Rolle og organisasjon i toppbanner: ca. 12 pt og 11 pt.
- Seksjonsfaner: ca. 12 pt, bold, hvit.
- Elementtitler: ca. 12 pt, bold, svart, med aksentfarget understrek.
- Metadata: ca. 11 pt, bold, grå.
- Brødtekst: ca. 11 pt, grå.

## Komponenter

### 1. Toppbanner

Toppbanneret brukes kun på første side og består av tre visuelle soner:

1. Venstre: rundt profilbilde med tykk oransje ring.
2. Midten: navn, tittel og organisasjon.
3. Høyre: kompakt kontaktinformasjon, høyrejustert tekst og oransje ikonkolonne.

### 2. Seksjonsfane

Seksjonstitler står i mørke rektangler med hvit bold tekst. Fanene bryter ut mot venstre og fungerer som visuelle ankere:

- Arbeidserfaring
- Utdanning
- Annet
- Referanser

### 3. CV-element

Hvert CV-element har en fast hierarkisk struktur:

1. Tittel: svart, bold, understreket med aksentfarge.
2. Metadata: organisasjon/periode, grå bold.
3. Beskrivelse: grå normaltekst med enkelte inline bold-labels.
4. Luft mellom elementer, tydelig mer enn linjeavstanden i brødteksten.

### 4. Annet-seksjon

Denne seksjonen er todelt i kolonner:

- Venstre: `Mye erfaring` og `Sertifikat`.
- Høyre: `Noe erfaring`.

### 5. Referanser

Referanser følger samme elementstruktur som arbeidserfaring, men har korte kontaktlinjer under hver tittel.

## Datamodell

Malen er modellert med følgende struktur:

- `Profile`: navn, tittel, organisasjon, kontaktdata og bilde.
- `Sections`: navngitte seksjoner med liste av elementer.
- `CvEntry`: tittel, subtitle/metadata, beskrivelser og lenker.
- `Reference`: navn/rolle, organisasjon, telefon/e-post.
- `SkillGroups`: kolonnebaserte ferdighetsgrupper.
- `GeneratedVersions`: historikk over PDF-er og tidspunkt.

## Malstrategi

Målet er ikke å låse alle CV-er til én statisk PDF, men å gjøre designet gjenbrukbart:

- Layout og farger bor i én template-klasse.
- Innhold bor i JSON og kan lagres i prosjektmappe.
- Nye maler kan implementere samme datamodell eller utvide den ved behov.
- Frontend viser og redigerer data, backend tar ansvar for PDF-rendering.
