import { CvDocument } from './types';

export const blankCv: CvDocument = {
  templateId: 'cv-kiwi-standard',
  selectedBlockIds: [],
  profile: {
    fullName: '', title: '', organization: '', birthDate: '', address: '', phone: '', email: '', socialLabel: '', socialUrl: '', photoDataUrl: null
  },
  sections: [
    { id: 'arbeidserfaring', title: 'Arbeidserfaring', kind: 'work', entries: [] },
    { id: 'utdanning', title: 'Utdanning', kind: 'education', entries: [] },
    { id: 'kurs', title: 'Kurs', kind: 'courses', entries: [] },
    { id: 'sertifikater', title: 'Sertifikater', kind: 'certifications', entries: [] },
    { id: 'dataferdigheter', title: 'Dataferdigheter', kind: 'technicalSkills', entries: [] },
    { id: 'verv', title: 'Verv', kind: 'positions', entries: [] },
    { id: 'frivillig-arbeid', title: 'Frivillig arbeid', kind: 'volunteering', entries: [] },
    { id: 'sprak', title: 'Språk', kind: 'languages', entries: [] },
    { id: 'interesser', title: 'Interesser', kind: 'interests', entries: [] }
  ],
  skillGroups: [],
  references: [],
  generatedVersions: []
};

export function withRequiredSections(document: CvDocument): CvDocument {
  const missingSections = blankCv.sections.filter(section => !document.sections.some(existing => existing.id === section.id));
  if (missingSections.length === 0) return document;
  const selectedBlockIds = document.selectedBlockIds ?? [];
  return { ...document, sections: [...document.sections, ...structuredClone(missingSections)], selectedBlockIds };
}

// Fictional, deliberately minimal data for exploring every editor category.
export const exampleCv: CvDocument = {
  templateId: 'cv-kiwi-standard',
  selectedBlockIds: ['profile', 'arbeidserfaring', 'utdanning', 'kurs', 'sertifikater', 'dataferdigheter', 'verv', 'frivillig-arbeid', 'sprak', 'interesser', 'references'],
  cvSelectionInitialized: true,
  profile: {
    fullName: 'Ola Nordmann',
    title: 'Prosjektmedarbeider',
    organization: 'Eksempelbedriften AS',
    birthDate: '1. januar 1990',
    address: 'Eksempelveien 1, 0001 Eksempelby',
    phone: '000 00 000',
    email: 'ola.nordmann@example.com',
    socialLabel: 'Portefølje',
    socialUrl: 'https://example.com',
    photoDataUrl: null,
    personalDetails: [
      { id: 'portfolio', type: 'Portefølje', value: 'example.com', url: 'https://example.com', icon: 'mdi:web' }
    ]
  },
  qualificationDescription: 'Strukturert og samarbeidsorientert medarbeider med erfaring fra enkle digitale prosjekter.',
  sections: [
    { id: 'arbeidserfaring', title: 'Arbeidserfaring', kind: 'work', entries: [
      { id: 'example-work', title: 'Prosjektmedarbeider', subtitle: 'Eksempelbedriften AS · 2023–nå', organization: 'Eksempelbedriften AS', startDate: '2023-01', isCurrent: true, lines: [{ runs: [{ text: 'Planla oppgaver, fulgte opp leveranser og samarbeidet med et lite tverrfaglig team.', bold: false }] }] }
    ] },
    { id: 'utdanning', title: 'Utdanning', kind: 'education', entries: [
      { id: 'example-education', title: 'Bachelor i eksempelstudier', subtitle: 'Eksempeluniversitetet · 2020–2023', organization: 'Eksempeluniversitetet', startDate: '2020-08', endDate: '2023-06', lines: [] }
    ] },
    { id: 'kurs', title: 'Kurs', kind: 'courses', entries: [
      { id: 'example-course', title: 'Grunnkurs i prosjektarbeid', subtitle: 'Eksempelakademiet · 2024', organization: 'Eksempelakademiet', startDate: '2024-03', lines: [] }
    ] },
    { id: 'sertifikater', title: 'Sertifikater', kind: 'certifications', entries: [
      { id: 'example-certificate', title: 'Eksempelsertifisering', subtitle: 'Gyldig til 2028', lines: [] }
    ] },
    { id: 'dataferdigheter', title: 'Dataferdigheter', kind: 'technicalSkills', entries: [
      { id: 'example-digital', title: 'Digitale verktøy', subtitle: 'Tekstbehandling, regneark og presentasjoner', lines: [] }
    ] },
    { id: 'verv', title: 'Verv', kind: 'positions', entries: [
      { id: 'example-position', title: 'Styremedlem', subtitle: 'Eksempelforeningen · 2024–nå', lines: [] }
    ] },
    { id: 'frivillig-arbeid', title: 'Frivillig arbeid', kind: 'volunteering', entries: [
      { id: 'example-volunteer', title: 'Arrangementshjelper', subtitle: 'Eksempelfestivalen · 2023', lines: [{ runs: [{ text: 'Hjalp til med publikumsinformasjon og praktisk gjennomføring.', bold: false }] }] }
    ] },
    { id: 'sprak', title: 'Språk', kind: 'languages', entries: [
      { id: 'example-language', title: 'Norsk', subtitle: 'Morsmål', lines: [] }
    ] },
    { id: 'interesser', title: 'Interesser', kind: 'interests', entries: [
      { id: 'example-interest', title: 'Friluftsliv', subtitle: 'Turer og naturfoto', lines: [] }
    ] }
  ],
  skillGroups: [
    { title: 'Styrker', content: 'Samarbeid, struktur og formidling', column: 1 },
    { title: 'Verktøy', content: 'Kontorstøtte og enkel bildebehandling', column: 2 }
  ],
  references: [
    { nameAndRole: 'Kari Nordmann – prosjektleder', organization: 'Eksempelbedriften AS', phone: '000 00 001', email: 'kari.nordmann@example.com' }
  ],
  generatedVersions: []
};

export const testingCv = exampleCv;
