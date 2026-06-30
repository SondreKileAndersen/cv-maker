export interface CvDocument {
  templateId: string;
  updatedAt?: string;
  formatSettings?: CvFormatSettingsData;
  selectedBlockIds?: string[];
  /** Masterdata categories and items highlighted under Nøkkelkvalifikasjoner. */
  customCategorySelectionIds?: string[];
  /** CV-specific summary shown in the Nøkkelkvalifikasjoner section. */
  qualificationDescription?: string;
  qualificationDescriptionLines?: RichLine[];
  /** Derived visibility flag for the active CV version. */
  qualificationEnabled?: boolean;
  /** Derived visibility flag for the fixed references-on-request CV section. */
  referencesEnabled?: boolean;
  /** Resolved Masterdata entries highlighted in this CV version. */
  qualificationHighlights?: QualificationHighlight[];
  /** Marks that the user has explicitly built this CV version. Used to migrate the old default-filled version to an empty one. */
  cvSelectionInitialized?: boolean;
  /** Per-CV-version presentation edits. Masterdata is never changed by these values. */
  cvVersionOverrides?: Record<string, CvVersionOverrideState>;
  cvVersions?: CvProjectVersion[];
  activeCvVersionId?: string;
  profile: Profile;
  sections: CvSection[];
  skillGroups: SkillGroup[];
  references: ReferencePerson[];
  generatedVersions: GeneratedVersion[];
}

export interface CvProjectVersion {
  id: string;
  name: string;
  selectedBlockIds: string[];
  formatSettings: CvFormatSettingsData;
  overrides: CvVersionOverrideState;
  customCategorySelectionIds: string[];
  qualificationDescription: string;
  qualificationDescriptionLines?: RichLine[];
}

export interface CvFormatSettingsData {
  lineHeight: number;
  nameSize: number;
  sectionTitleSize: number;
  subtitleSize: number;
  paragraphSize: number;
  experienceGap: number;
  experienceElementGap: number;
  titleUnderlineGap: number;
  accentColor: string;
  nameColor: string;
  personalTextColor: string;
  sectionTitleColor: string;
  entryTitleColor: string;
  metadataColor: string;
  paragraphColor: string;
  photoSize: number;
  showTitleIcons: boolean;
  showPersonalIcons: boolean;
  inlineQualificationMetadata: boolean;
  inlineExperienceMetadata: boolean;
  linkColor: string;
  pageMargins: number;
  verticalPageMargins: number;
  sectionTitleBeforeGap: number;
  sectionTitleAfterGap: number;
  qualificationTitleDescriptionGap: number;
}

export interface Profile {
  fullName: string;
  title: string;
  organization: string;
  birthDate: string;
  address: string;
  phone: string;
  email: string;
  emailLinkEnabled?: boolean;
  socialLabel: string;
  socialUrl: string;
  links?: Record<string, string>;
  personalDetails?: PersonalDetail[];
  photoDataUrl?: string | null;
  photoScale?: number;
  photoPositionX?: number;
  photoPositionY?: number;
  photoFlipped?: boolean;
  photoAspect?: number;
  photos?: ProfilePhoto[];
  activePhotoId?: string;
}

export interface ProfilePhoto {
  id: string;
  dataUrl: string;
  scale: number;
  positionX: number;
  positionY: number;
  flipped: boolean;
  aspect: number;
}

export interface PersonalDetail {
  id: string;
  type: string;
  value: string;
  url: string;
  icon?: string;
  sourceKey?: string;
}

export interface CvSection {
  id: string;
  title: string;
  kind?: 'work' | 'education' | 'custom' | 'qualifications' | 'courses' | 'certifications' | 'technicalSkills' | 'positions' | 'volunteering' | 'languages' | 'interests';
  entries: CvEntry[];
}

export interface CvEntry {
  id: string;
  title: string;
  subtitle: string;
  lines: RichLine[];
  url?: string | null;
  organization?: string;
  startDate?: string;
  endDate?: string;
  isCurrent?: boolean;
  employmentType?: string;
  location?: string;
  customFields?: CustomEntryField[];
  descriptionVariants?: DescriptionVariant[];
  activeDescriptionVariantId?: string;
  imageDataUrl?: string | null;
}

export interface DescriptionVariant {
  id: string;
  label: string;
  lines: RichLine[];
}

export interface CvVersionOverrideState {
  text: Record<string, string>;
  /** Entry ID -> description variant ID. The value '__none__' hides the description. */
  descriptionVariantIds: Record<string, string>;
  /** Per-CV-version visibility for individual preview fields. */
  hiddenFields?: Record<string, boolean>;
  /** Per-CV-version ordering of the categories shown in preview. */
  sectionOrderIds?: string[];
  /** Per-CV-version ordering of entries inside each category. */
  entryOrderIds?: Record<string, string[]>;
}

export interface CustomEntryField {
  id: string;
  label: string;
  value: string;
}

export interface RichLine {
  runs: RichTextRun[];
}

export interface RichTextRun {
  text: string;
  bold: boolean;
  italic?: boolean;
  underline?: boolean;
  url?: string;
}

export interface SkillGroup {
  title: string;
  content: string;
  column: number;
  descriptionVariants?: DescriptionVariant[];
  activeDescriptionVariantId?: string;
}

export interface QualificationHighlight {
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  descriptionLines?: RichLine[];
  icon: string;
  /** Original Master entry, used to provide the full preview editing UI. */
  entry?: CvEntry;
}

export interface ReferencePerson {
  nameAndRole: string;
  organization: string;
  phone: string;
  email: string;
}

export interface GeneratedVersion {
  fileName: string;
  createdAt: string;
  templateId: string;
}
