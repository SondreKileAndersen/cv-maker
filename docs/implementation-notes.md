# Implementasjonsnotater

## Hvorfor lagring i frontend?

Et vanlig nettsted kan ikke fritt lese og skrive til en vilkårlig mappe på brukerens PC. Browseren må gi eksplisitt tilgang. Derfor bruker denne MVP-en File System Access API i React-klienten. API-et brukes til PDF-generering, mens klienten lagrer JSON, bilder og ferdige PDF-er i valgt prosjektmappe.

## Hvorfor template-registry?

Målet er at løsningen skal kunne brukes av flere personer og flere maler. `TemplateRegistry` gjør at backend kan eksponere flere maler gjennom samme endpoint:

`POST /api/pdf/{templateId}`

## Videre arbeid

- Legg til Google Drive som egen storage-provider.
- Lag riktekst-editor der deler av linjer kan markeres som bold, slik originalens inline-labels kan redigeres uten JSON.
- Legg til PDF-sammenligning mot referanse-PDF.
- Legg til temainnstillinger per mal: farger, font, marger og fanebredder.
- Legg til eksport/import av hele prosjektmappe som zip.
