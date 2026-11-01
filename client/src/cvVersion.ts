import { CvDocument, CvEntry, CvSection, Profile } from './types';

export type MasterBlockItem = {
  /** Stable ID used when this individual item is added to a CV version. */
  selectionId: string;
  title: string;
  subtitle?: string;
};

export type MasterBlock = {
  id: string;
  title: string;
  icon: string;
  items: MasterBlockItem[];
};

const itemSelectionId = (blockId: string, itemId: string) => `item:${blockId}:${itemId}`;

const profileFields = [
  ['fullName', 'Navn'],
  ['title', 'Tittel'],
  ['birthDate', 'Fødselsdato'],
  ['address', 'Adresse'],
  ['phone', 'Telefon'],
  ['email', 'E-post'],
  ['organization', 'Organisasjon'],
  ['socialLabel', 'SoMe']
] as const;

const profileDetailItemId = (detailId: string) => `detail-${detailId}`;

function profileItems(profile: Profile): MasterBlockItem[] {
  const stored = profile.personalDetails ?? [];
  const representedSourceKeys = new Set(profileFields.map(([key]) => key));
  const coreItems = profileFields.filter(([key]) => key !== 'socialLabel' || profile.personalDetails === undefined || stored.some(detail => detail.sourceKey === key)).map(([key, fallbackTitle]) => {
    const detail = stored.find(item => item.sourceKey === key);
    return {
      selectionId: itemSelectionId('profile', key),
      title: detail?.type || fallbackTitle,
      subtitle: detail?.value || String(profile[key] ?? '') || undefined
    };
  });
  const customItems = stored
    .filter(detail => !detail.sourceKey || !representedSourceKeys.has(detail.sourceKey as typeof profileFields[number][0]))
    .map(detail => ({
      selectionId: itemSelectionId('profile', profileDetailItemId(detail.id)),
      title: detail.type || 'Personalia',
      subtitle: detail.value || undefined
    }));

  return [
    { selectionId: itemSelectionId('profile', 'photo'), title: 'Profilbilde' },
    ...coreItems,
    ...customItems
  ];
}

export function isItemSelection(selectionId: string, blockId?: string) {
  return blockId ? selectionId.startsWith(`item:${blockId}:`) : selectionId.startsWith('item:');
}

function entryItem(blockId: string, entry: CvEntry, index: number): MasterBlockItem {
  return {
    selectionId: itemSelectionId(blockId, entry.id || String(index)),
    title: entry.title || `Uten tittel ${index + 1}`,
    subtitle: entry.organization || entry.subtitle || undefined
  };
}

export function getMasterBlocks(document: CvDocument): MasterBlock[] {
  return [
    { id: 'profile', title: 'Personalia', icon: 'mdi:account', items: profileItems(document.profile) },
    ...document.sections.map(section => ({
      id: section.id,
      title: section.title,
      icon: getSectionIcon(section),
      items: sortCvEntriesByDate(section.entries).map((entry, index) => entryItem(section.id, entry, index))
    })),
    {
      id: 'references',
      title: 'Referanser',
      icon: 'mdi:account-group',
      items: document.references.map((reference, index) => ({
        selectionId: itemSelectionId('references', String(index)),
        title: reference.nameAndRole || `Referanse ${index + 1}`,
        subtitle: reference.organization || undefined
      }))
    }
  ];
}

export function sortCvEntriesByDate(entries: CvEntry[]) {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const leftHasDate = Boolean(left.entry.startDate || left.entry.endDate || left.entry.isCurrent);
      const rightHasDate = Boolean(right.entry.startDate || right.entry.endDate || right.entry.isCurrent);
      if (leftHasDate !== rightHasDate) return leftHasDate ? -1 : 1;
      if (!leftHasDate) return left.index - right.index;

      const leftEnd = left.entry.isCurrent ? Number.POSITIVE_INFINITY : dateSortValue(left.entry.endDate || left.entry.startDate);
      const rightEnd = right.entry.isCurrent ? Number.POSITIVE_INFINITY : dateSortValue(right.entry.endDate || right.entry.startDate);
      if (leftEnd !== rightEnd) return rightEnd - leftEnd;

      const startDifference = dateSortValue(right.entry.startDate) - dateSortValue(left.entry.startDate);
      return startDifference || left.index - right.index;
    })
    .map(({ entry }) => entry);
}

function dateSortValue(value?: string) {
  if (!value) return 0;
  const [year = '0', month = '0'] = value.split('-');
  return Number(year) * 12 + Number(month);
}

export function getSectionIcon(section: CvSection) {
  const name = `${section.id} ${section.title}`.toLowerCase();
  if (name.includes('nøkkel') || name.includes('nokkel')) return 'mdi:star-four-points';
  if (name.includes('frivillig')) return 'mdi:hand-back-left';
  if (name.includes('utdanning')) return 'mdi:school';
  if (name.includes('arbeid') || name.includes('yrke') || name.includes('jobb')) return 'mdi:briefcase';
  if (name.includes('sertif')) return 'mdi:certificate';
  if (name.includes('kurs')) return 'mdi:book-open-variant';
  if (name.includes('dataferd') || name.includes('teknisk')) return 'mdi:laptop';
  if (name.includes('verv')) return 'mdi:account-tie';
  if (name.includes('språk') || name.includes('sprak')) return 'mdi:translate';
  if (name.includes('interess')) return 'mdi:heart';
  return 'mdi:file-document';
}

export function createCvVersion(master: CvDocument, selectedBlockIds: string[]): CvDocument {
  const hasWholeBlock = (blockId: string) => selectedBlockIds.includes(blockId);
  const hasItem = (blockId: string, itemId: string | number) =>
    selectedBlockIds.includes(itemSelectionId(blockId, String(itemId)));

  const selectedProfile = hasWholeBlock('profile') ? { ...master.profile } : createSelectedProfile(master.profile, hasItem);
  // Once Master has an explicit field list, removed optional fields must not
  // reappear through legacy values retained on the profile.
  if (master.profile.personalDetails !== undefined && !master.profile.personalDetails.some(detail => detail.sourceKey === 'socialLabel')) {
    selectedProfile.socialLabel = '';
    selectedProfile.socialUrl = '';
  }
  const qualificationsVisible = master.qualificationVisible !== false;
  const referencesVisible = hasWholeBlock('references') || master.references.some((_, index) => hasItem('references', index));

  return {
    ...master,
    profile: selectedProfile,
    sections: master.sections
      .map(section => hasWholeBlock(section.id)
        ? section
        : { ...section, entries: section.entries.filter(entry => hasItem(section.id, entry.id)) })
      .filter(section => section.entries.length > 0),
    skillGroups: [],
    qualificationEnabled: qualificationsVisible,
    qualificationDescription: qualificationsVisible ? master.qualificationDescription ?? '' : '',
    qualificationDescriptionLines: qualificationsVisible ? master.qualificationDescriptionLines : undefined,
    referencesEnabled: referencesVisible,
    // Reference people remain Masterdata. A CV only shows the fixed on-request message.
    references: []
  };
}

function createSelectedProfile(profile: Profile, hasItem: (blockId: string, itemId: string | number) => boolean): Profile {
  const selected = (key: typeof profileFields[number][0]) => hasItem('profile', key);
  const photoSelected = hasItem('profile', 'photo');
  const personalDetails = (profile.personalDetails ?? []).filter(detail =>
    detail.sourceKey
      ? profileFields.some(([key]) => key === detail.sourceKey && selected(key))
      : hasItem('profile', profileDetailItemId(detail.id))
  );
  const links = Object.fromEntries(Object.entries(profile.links ?? {}).filter(([key]) =>
    profileFields.some(([field]) => field === key && selected(field))
  ));

  return {
    fullName: selected('fullName') ? profile.fullName : '',
    title: selected('title') ? profile.title : '',
    organization: selected('organization') ? profile.organization : '',
    birthDate: selected('birthDate') ? profile.birthDate : '',
    address: selected('address') ? profile.address : '',
    phone: selected('phone') ? profile.phone : '',
    email: selected('email') ? profile.email : '',
    emailLinkEnabled: selected('email') ? profile.emailLinkEnabled : false,
    socialLabel: selected('socialLabel') ? profile.socialLabel : '',
    socialUrl: selected('socialLabel') ? profile.socialUrl : '',
    links,
    personalDetails,
    photoDataUrl: photoSelected ? profile.photoDataUrl : null,
    photoScale: photoSelected ? profile.photoScale : undefined,
    photoPositionX: photoSelected ? profile.photoPositionX : undefined,
    photoPositionY: photoSelected ? profile.photoPositionY : undefined,
    photoFlipped: photoSelected ? profile.photoFlipped : undefined,
    photoAspect: photoSelected ? profile.photoAspect : undefined,
    photos: photoSelected ? profile.photos : undefined,
    activePhotoId: photoSelected ? profile.activePhotoId : undefined
  };
}
