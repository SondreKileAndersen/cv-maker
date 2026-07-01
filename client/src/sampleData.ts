import { CvDocument } from './types';
import exampleProjectData from './media/CV_Kiwi_Eksempel_Prosjekt.json';
import exampleProfilePhoto from './media/Profilbilde-eksempelprosjekt.jpg';

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

const importedExampleProject = exampleProjectData as unknown as CvDocument;

// The exported project contains Vite's temporary development URL. Use the bundled asset URL in every environment.
export const exampleCv: CvDocument = {
  ...importedExampleProject,
  profile: { ...importedExampleProject.profile, photoDataUrl: exampleProfilePhoto }
};
