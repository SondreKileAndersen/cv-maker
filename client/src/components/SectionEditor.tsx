import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { Icon } from '@iconify/react';
import { CvSection, CvEntry, DescriptionVariant, RichLine } from '../types';
import { getSectionIcon, sortCvEntriesByDate } from '../cvVersion';

interface Props {
  section: CvSection;
  onChange: (section: CvSection) => void;
  onEditingChange?: (sectionId: string, active: boolean, session?: MasterEditSession) => void;
  onRequestAction?: (action: () => void, point: { x: number; y: number }) => void;
  onDelete?: (section: CvSection) => void;
}

export type MasterEditSession = {
  sectionId: string;
  entryId: string;
  title: string;
  save: () => void;
  discard: () => void;
  returnToEditor: () => void;
};

type SupplementaryConfig = {
  singular: string;
  titleLabel: string;
  organizationLabel?: string;
  period?: string;
  singleDate?: boolean;
  detailOne?: string;
  detailTwo?: string;
  description?: string;
  languageLevels?: boolean;
};

const languageLevelOptions = [
  'Nybegynnernivå',
  'Grunnleggende nivå',
  'Godt nivå',
  'Meget godt nivå',
  'Flytende',
  'Profesjonelt nivå',
  'Morsmål'
];

export function SectionEditor({ section, onChange, onEditingChange, onRequestAction, onDelete }: Props) {
  section = { ...section, entries: sortCvEntriesByDate(section.entries) };
  if (!isCareerSection(section)) return <SupplementarySectionEditor section={section} onChange={onChange} onEditingChange={onEditingChange} onRequestAction={onRequestAction} onDelete={onDelete} />;
  const [editingId, setEditingId] = useState<string | null>(null);
  const editSnapshotRef = useRef<{ entry: CvEntry; isNew: boolean } | null>(null);
  const summaryRefs = useRef(new Map<string, HTMLElement>());
  const sectionIcon = section.kind === 'custom' || section.id.startsWith('custom-') ? getSectionIcon(section) : section.id.includes('utdanning') ? 'mdi:school-outline' : 'mdi:briefcase-outline';
  const labels = getCareerLabels(section);

  useEffect(() => () => onEditingChange?.(section.id, false), [onEditingChange, section.id]);

  useEffect(() => {
    if (!editingId || section.entries.some(entry => entry.id === editingId)) return;
    editSnapshotRef.current = null;
    onEditingChange?.(section.id, false);
    setEditingId(null);
  }, [editingId, onEditingChange, section.entries, section.id]);

  useEffect(() => {
    if (!editingId) return;
    const entry = section.entries.find(candidate => candidate.id === editingId);
    if (!entry) return;
    onEditingChange?.(section.id, true, {
      sectionId: section.id,
      entryId: editingId,
      title: entry.title.trim() || labels.newEntry,
      save: () => saveEntry(editingId),
      discard: cancelEditing,
      returnToEditor: () => {
        const editor = window.document.querySelector<HTMLElement>(`[data-master-editing-entry="${CSS.escape(editingId)}"]`);
        editor?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.requestAnimationFrame(() => editor?.focus({ preventScroll: true }));
      }
    });
  }, [editingId, onEditingChange, section.entries, section.id]);

  function beginEditing(entry: CvEntry, isNew = false) {
    editSnapshotRef.current = { entry: structuredClone(entry), isNew };
    setEditingId(entry.id);
  }

  function requestAction(action: () => void, point: { x: number; y: number }) {
    if (onRequestAction) onRequestAction(action, point);
    else action();
  }

  function cancelEditing() {
    const snapshot = editSnapshotRef.current;
    if (snapshot) {
      const entries = snapshot.isNew
        ? section.entries.filter(entry => entry.id !== snapshot.entry.id)
        : section.entries.map(entry => entry.id === snapshot.entry.id ? structuredClone(snapshot.entry) : entry);
      onChange({ ...section, entries });
    }
    editSnapshotRef.current = null;
    onEditingChange?.(section.id, false);
    setEditingId(null);
  }

  function updateEntry(index: number, entry: CvEntry) {
    const entries = [...section.entries];
    const normalizedEntry = entry.organization === undefined
      ? { ...entry, organization: legacyOrganization(entry.subtitle) }
      : entry;
    entries[index] = { ...normalizedEntry, subtitle: buildSubtitle(normalizedEntry) };
    onChange({ ...section, entries });
  }

  function addEntry() {
    const entry: CvEntry = { id: crypto.randomUUID(), title: '', subtitle: '', lines: [], organization: '', startDate: '', endDate: '', isCurrent: false, employmentType: '', location: '' };
    beginEditing(entry, true);
    onChange({ ...section, entries: [...section.entries, entry] });
  }

  function removeEntry(index: number) {
    onChange({ ...section, entries: section.entries.filter((_, currentIndex) => currentIndex !== index) });
    editSnapshotRef.current = null;
    onEditingChange?.(section.id, false);
    setEditingId(null);
  }

  function saveEntry(entryId: string) {
    window.document.documentElement.classList.add('instant-master-navigation');
    window.dispatchEvent(new CustomEvent('cv-kiwi:keep-master-section', { detail: { sectionId: section.id } }));
    editSnapshotRef.current = null;
    onEditingChange?.(section.id, false);
    setEditingId(null);
    window.requestAnimationFrame(() => {
      summaryRefs.current.get(entryId)?.scrollIntoView({ behavior: 'auto', block: 'start' });
      window.requestAnimationFrame(() => window.setTimeout(() => window.document.documentElement.classList.remove('instant-master-navigation'), 50));
    });
  }

  function setEntryImage(index: number, entry: CvEntry, file: File) {
    void fileToDataUrl(file).then(imageDataUrl => {
      updateEntry(index, { ...entry, imageDataUrl });
    });
  }

  async function pasteImage(index: number, entry: CvEntry) {
    try {
      const clipboardItems = await navigator.clipboard?.read?.();
      const imageItem = clipboardItems?.find(item => item.types.some(type => type.startsWith('image/')));
      const imageType = imageItem?.types.find(type => type.startsWith('image/'));
      if (!imageItem || !imageType) return;
      const blob = await imageItem.getType(imageType);
      setEntryImage(index, entry, new File([blob], 'utklippstavle-bilde', { type: blob.type }));
    } catch {
      // The browser did not grant direct clipboard-image access.
    }
  }

  return (
    <section className="panel section-editor" id={`section-${section.id}`}>
      <h2 className="master-section-heading"><Icon className={section.id.includes('frivillig') ? 'volunteering-icon' : undefined} icon={getSectionIcon(section)} aria-hidden="true" /><span>{section.title}</span>{(section.kind === 'custom' || section.id.startsWith('custom-')) && onDelete && <button className="custom-section-delete" type="button" onClick={event => requestAction(() => onDelete(section), { x: event.clientX, y: event.clientY })}><Icon icon="mdi:trash-can-outline" aria-hidden="true" />Slett kategori</button>}</h2>
      <div className="entry-list entry-summary-list">
        {section.entries.map((entry, index) => editingId === entry.id ? (
          <article className="entry-editor" key={entry.id} data-master-editing-entry={entry.id} tabIndex={-1} onPaste={event => { const image = [...event.clipboardData.files].find(file => file.type.startsWith('image/')); if (image) { event.preventDefault(); setEntryImage(index, entry, image); } }}>
            <div className="entry-editor-header"><strong className={!entry.title ? 'entry-editor-new-label' : undefined}>{entry.title || labels.newEntry}</strong></div>
            <CompactField label={labels.title} value={entry.title} onChange={title => updateEntry(index, { ...entry, title })} />
            <div className="job-company-row">
              <span className="job-company-label">{labels.organization}</span>
              <input value={entry.organization ?? legacyOrganization(entry.subtitle)} placeholder={`${labels.organization}...`} onChange={event => updateEntry(index, { ...entry, organization: event.target.value })} />
              <div className="entry-image-actions">
                {entry.imageDataUrl ? <><img className="entry-image-thumbnail" src={entry.imageDataUrl} alt="Bilde for yrkesoppføring" /><button className="entry-image-remove" type="button" onClick={() => updateEntry(index, { ...entry, imageDataUrl: null })} aria-label="Fjern bilde">×</button></> : <><label className="entry-image-upload"><Icon icon="mdi:image-plus" aria-hidden="true" /><span>Last opp bilde</span><input type="file" accept="image/*" hidden onChange={event => { const file = event.target.files?.[0]; if (file) setEntryImage(index, entry, file); event.currentTarget.value = ''; }} /></label><button className="entry-paste-image" type="button" onClick={() => void pasteImage(index, entry)}>Lim inn bilde</button></>}
              </div>
            </div>
            {labels.detailBeforePeriod && <CompactField label={labels.detail} value={entry.employmentType ?? ''} onChange={employmentType => updateEntry(index, { ...entry, employmentType })} />}
            <div className="entry-period-editor">
              <span className="entry-period-label">Periode</span>
              <div className="entry-period-fields">
                <DateRow label="Fra" value={entry.startDate ?? ''} onChange={startDate => updateEntry(index, { ...entry, startDate })}>
                  <label className="current-position"><input type="checkbox" checked={Boolean(entry.isCurrent)} onChange={event => updateEntry(index, { ...entry, isCurrent: event.target.checked, endDate: event.target.checked ? '' : entry.endDate })} /><span>{labels.current}</span></label>
                </DateRow>
                {!entry.isCurrent && <DateRow label="Til" value={entry.endDate ?? ''} onChange={endDate => updateEntry(index, { ...entry, endDate })} />}
              </div>
            </div>
            {!labels.detailBeforePeriod && <CompactField label={labels.detail} value={entry.employmentType ?? ''} onChange={employmentType => updateEntry(index, { ...entry, employmentType })} />}
            {labels.showLocation && <CompactField label="Land/Sted" value={entry.location ?? ''} onChange={location => updateEntry(index, { ...entry, location })} />}
            <div className="entry-custom-fields">
              {(entry.customFields ?? []).map((field, fieldIndex) => (
                <div className="entry-custom-field" key={field.id}>
                  <input value={field.label} placeholder="Label..." aria-label="Egendefinert label" onChange={event => updateEntry(index, { ...entry, customFields: updateCustomField(entry.customFields ?? [], fieldIndex, { label: event.target.value }) })} />
                  <input value={field.value} placeholder="Innhold..." aria-label="Egendefinert innhold" onChange={event => updateEntry(index, { ...entry, customFields: updateCustomField(entry.customFields ?? [], fieldIndex, { value: event.target.value }) })} />
                  <button className="entry-custom-remove" type="button" onClick={() => updateEntry(index, { ...entry, customFields: (entry.customFields ?? []).filter((_, currentIndex) => currentIndex !== fieldIndex) })} aria-label="Fjern egendefinert felt">×</button>
                </div>
              ))}
            </div>
            <button className="entry-custom-add" type="button" onClick={() => updateEntry(index, { ...entry, customFields: [...(entry.customFields ?? []), { id: crypto.randomUUID(), label: '', value: '' }] })}>+ Legg til egendefinert rad</button>
            <DescriptionVersionsEditor entry={entry} onChange={nextEntry => updateEntry(index, nextEntry)} />
            <div className="entry-editor-actions">
              <div className="entry-primary-actions">
                <button className="button entry-save" onClick={() => saveEntry(entry.id)}>Lagre</button>
                <button className="button entry-cancel" onClick={cancelEditing}>Avbryt</button>
              </div>
              <button className="button ghost entry-remove" onClick={() => removeEntry(index)}>Fjern {labels.singular}</button>
            </div>
          </article>
        ) : (
          <article className="entry-summary is-editable" key={entry.id} ref={node => { if (node) summaryRefs.current.set(entry.id, node); else summaryRefs.current.delete(entry.id); }} role="button" tabIndex={0} onClick={event => requestAction(() => beginEditing(entry), { x: event.clientX, y: event.clientY })} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { const bounds = event.currentTarget.getBoundingClientRect(); requestAction(() => beginEditing(entry), { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }); } }}>
            <div className={`entry-summary-icon ${entry.imageDataUrl ? 'has-image' : ''}`}>{entry.imageDataUrl ? <img src={entry.imageDataUrl} alt="" /> : <Icon icon={sectionIcon} />}</div>
            <div className="entry-summary-content">
              <strong>{entry.title || labels.newEntry}</strong>
              <span>{summaryLine(entry)}</span>
              {summaryPeriod(entry) && <span>{summaryPeriod(entry)}</span>}
              {labels.showLocation && entry.location && <span>{entry.location}</span>}
              {linesToText(entry.lines) && <p>{summaryDescription(entry.lines)}</p>}
              {(entry.customFields ?? []).filter(field => field.label || field.value).map(field => <span key={field.id}>{field.label ? `${field.label}: ` : ''}{field.value}</span>)}
            </div>
          </article>
        ))}
      </div>
      {!editingId && <button className="add-entry" onClick={event => requestAction(addEntry, { x: event.clientX, y: event.clientY })}>+ Legg til</button>}
    </section>
  );
}

function SupplementarySectionEditor({ section, onChange, onEditingChange, onRequestAction, onDelete }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editSnapshotRef = useRef<{ entry: CvEntry; isNew: boolean } | null>(null);
  const config = getSupplementaryConfig(section);

  useEffect(() => () => onEditingChange?.(section.id, false), [onEditingChange, section.id]);

  useEffect(() => {
    if (!editingId || section.entries.some(entry => entry.id === editingId)) return;
    editSnapshotRef.current = null;
    onEditingChange?.(section.id, false);
    setEditingId(null);
  }, [editingId, onEditingChange, section.entries, section.id]);

  useEffect(() => {
    if (!editingId) return;
    const entry = section.entries.find(candidate => candidate.id === editingId);
    if (!entry) return;
    onEditingChange?.(section.id, true, {
      sectionId: section.id,
      entryId: editingId,
      title: entry.title.trim() || `Ny ${config.singular}`,
      save: finishEditing,
      discard: cancelEditing,
      returnToEditor: () => {
        const editor = window.document.querySelector<HTMLElement>(`[data-master-editing-entry="${CSS.escape(editingId)}"]`);
        editor?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.requestAnimationFrame(() => editor?.focus({ preventScroll: true }));
      }
    });
  }, [editingId, onEditingChange, section.entries, section.id]);

  function beginEditing(entry: CvEntry, isNew = false) {
    editSnapshotRef.current = { entry: structuredClone(entry), isNew };
    const normalizedEntry = normalizeSupplementaryEntryForEditing(entry, section.kind);
    if (normalizedEntry !== entry) {
      onChange({ ...section, entries: section.entries.map(item => item.id === entry.id ? normalizedEntry : item) });
    }
    setEditingId(entry.id);
  }

  function requestAction(action: () => void, point: { x: number; y: number }) {
    if (onRequestAction) onRequestAction(action, point);
    else action();
  }

  function finishEditing() {
    editSnapshotRef.current = null;
    onEditingChange?.(section.id, false);
    setEditingId(null);
  }

  function cancelEditing() {
    const snapshot = editSnapshotRef.current;
    if (snapshot) {
      const entries = snapshot.isNew
        ? section.entries.filter(entry => entry.id !== snapshot.entry.id)
        : section.entries.map(entry => entry.id === snapshot.entry.id ? structuredClone(snapshot.entry) : entry);
      onChange({ ...section, entries });
    }
    finishEditing();
  }

  function updateEntry(index: number, entry: CvEntry) {
    const entries = [...section.entries];
    const normalizedEntry = config.organizationLabel && entry.organization === undefined
      ? { ...entry, organization: legacyOrganization(entry.subtitle) }
      : entry;
    entries[index] = { ...normalizedEntry, subtitle: buildSubtitle(normalizedEntry) };
    onChange({ ...section, entries });
  }

  function addEntry() {
    const entry: CvEntry = { id: crypto.randomUUID(), title: '', subtitle: '', lines: [], organization: '', startDate: '', endDate: '', employmentType: '', location: '' };
    beginEditing(entry, true);
    onChange({ ...section, entries: [...section.entries, entry] });
  }

  return (
    <section className="panel section-editor" id={`section-${section.id}`}>
      <h2 className="master-section-heading"><Icon className={section.id.includes('frivillig') ? 'volunteering-icon' : undefined} icon={getSectionIcon(section)} aria-hidden="true" /><span>{section.title}</span>{(section.kind === 'custom' || section.id.startsWith('custom-')) && onDelete && <button className="custom-section-delete" type="button" onClick={event => requestAction(() => onDelete(section), { x: event.clientX, y: event.clientY })}><Icon icon="mdi:trash-can-outline" aria-hidden="true" />Slett kategori</button>}</h2>
      <div className="entry-list entry-summary-list">
        {section.entries.map((entry, index) => editingId === entry.id ? (
          <article className="entry-editor" key={entry.id} data-master-editing-entry={entry.id} tabIndex={-1}>
            <div className="entry-editor-header"><strong className={!entry.title ? 'entry-editor-new-label' : undefined}>{entry.title || `Ny ${config.singular}`}</strong></div>
            <CompactField label={config.titleLabel} value={entry.title} onChange={title => updateEntry(index, { ...entry, title })} />
            {config.organizationLabel && <CompactField label={config.organizationLabel} value={entry.organization ?? ''} onChange={organization => updateEntry(index, { ...entry, organization })} />}
            {config.period && <div className="entry-period-editor">
              <span className="entry-period-label">{config.period}</span>
              <div className="entry-period-fields">
                <DateRow label={config.singleDate ? config.period : 'Fra'} value={entry.startDate ?? ''} onChange={startDate => updateEntry(index, { ...entry, startDate })} />
                {!config.singleDate && <DateRow label="Til" value={entry.endDate ?? ''} onChange={endDate => updateEntry(index, { ...entry, endDate })} />}
              </div>
            </div>}
            {config.detailOne && (config.languageLevels
              ? <CompactSelectField label={config.detailOne} value={entry.employmentType ?? ''} options={languageLevelOptions} onChange={employmentType => updateEntry(index, { ...entry, employmentType })} />
              : <CompactField label={config.detailOne} value={entry.employmentType ?? ''} onChange={employmentType => updateEntry(index, { ...entry, employmentType })} />)}
            {config.detailTwo && (config.languageLevels
              ? <CompactSelectField label={config.detailTwo} value={entry.location ?? ''} options={languageLevelOptions} onChange={location => updateEntry(index, { ...entry, location })} />
              : <CompactField label={config.detailTwo} value={entry.location ?? ''} onChange={location => updateEntry(index, { ...entry, location })} />)}
            {config.description && <DescriptionVersionsEditor entry={entry} onChange={nextEntry => updateEntry(index, nextEntry)} />}
            <div className="entry-editor-actions">
              <div className="entry-primary-actions">
                <button className="button entry-save" onClick={finishEditing}>Lagre</button>
                <button className="button entry-cancel" onClick={cancelEditing}>Avbryt</button>
              </div>
              <button className="button ghost entry-remove" onClick={() => { onChange({ ...section, entries: section.entries.filter((_, currentIndex) => currentIndex !== index) }); finishEditing(); }}>Fjern {config.singular}</button>
            </div>
          </article>
        ) : (
          <article className="entry-summary is-editable" key={entry.id} role="button" tabIndex={0} onClick={event => requestAction(() => beginEditing(entry), { x: event.clientX, y: event.clientY })} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { const bounds = event.currentTarget.getBoundingClientRect(); requestAction(() => beginEditing(entry), { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }); } }}>
            <div className="entry-summary-icon"><Icon className={section.id.includes('frivillig') ? 'volunteering-icon' : undefined} icon={getSectionIcon(section)} /></div>
            <div className="entry-summary-content">
              <strong>{entry.title || `Ny ${config.singular}`}</strong>
              {supplementarySummaryLine(entry) && <span>{supplementarySummaryLine(entry)}</span>}
              {summaryPeriod(entry) && <span>{summaryPeriod(entry)}</span>}
              {entry.location && <span>{entry.location}</span>}
              {linesToText(entry.lines) && <p>{linesToText(entry.lines)}</p>}
            </div>
          </article>
        ))}
      </div>
      {!editingId && <button className="add-entry" onClick={event => requestAction(addEntry, { x: event.clientX, y: event.clientY })}>+ Legg til</button>}
    </section>
  );
}

function isCareerSection(section: CvSection) {
  return section.kind === 'work' || section.kind === 'education' || section.kind === 'custom' || section.id.startsWith('custom-') || section.id.includes('arbeidserfaring') || section.id.includes('utdanning');
}

function getCareerLabels(section: CvSection) {
  const isEducation = section.kind === 'education' || section.id.includes('utdanning');
  if (isEducation) {
    return {
      singular: 'utdanning',
      newEntry: 'Ny utdanning',
      title: 'Studie',
      organization: 'Skole',
      detail: 'Grad',
      current: 'Nåværende utdanning',
      detailBeforePeriod: true,
      showLocation: false
    };
  }
  if (section.kind === 'custom' || section.id.startsWith('custom-')) {
    return {
      singular: 'oppføring',
      newEntry: 'Ny oppføring',
      title: 'Tittel',
      organization: 'Organisasjon',
      detail: 'Type / omfang',
      current: 'Pågående',
      detailBeforePeriod: false,
      showLocation: true
    };
  }
  return {
    singular: 'yrke',
    newEntry: 'Nytt yrke',
    title: 'Tittel',
    organization: 'Bedrift',
    detail: 'Stillingstype/Prosent',
    current: 'Nåværende stilling',
    detailBeforePeriod: false,
    showLocation: true
  };
}

function getSupplementaryConfig(section: CvSection): SupplementaryConfig {
  const normalizedKind = section.kind;
  if (normalizedKind === 'qualifications') return { singular: 'nøkkelkvalifikasjon', titleLabel: 'Yrkesretning', description: 'Beskrivelse' };
  if (normalizedKind === 'courses') return { singular: 'kurs', titleLabel: 'Kurstittel', organizationLabel: 'Arrangør', period: 'Dato', singleDate: true, description: 'Beskrivelse' };
  if (normalizedKind === 'certifications') return { singular: 'sertifikat', titleLabel: 'Sertifikat', organizationLabel: 'Utsteder', period: 'Utstedt', singleDate: true, detailOne: 'Gyldighet / sertifikat-ID', description: 'Beskrivelse' };
  if (normalizedKind === 'technicalSkills') return { singular: 'dataferdighet', titleLabel: 'Program / verktøy', detailOne: 'Nivå', description: 'Beskrivelse' };
  if (normalizedKind === 'positions') return { singular: 'verv', titleLabel: 'Vervtittel', organizationLabel: 'Organisasjon', period: 'Periode', detailOne: 'Detaljer', description: 'Beskrivelse' };
  if (normalizedKind === 'volunteering') return { singular: 'frivillig rolle', titleLabel: 'Rolle', organizationLabel: 'Organisasjon', period: 'Periode', description: 'Beskrivelse' };
  if (normalizedKind === 'languages') return { singular: 'språk', titleLabel: 'Språk', detailOne: 'Muntlig nivå', detailTwo: 'Skriftlig nivå', languageLevels: true };
  if (normalizedKind === 'interests') return { singular: 'interesse', titleLabel: 'Interesse', detailOne: 'Kort beskrivelse', description: 'Beskrivelse' };
  const kind = section.kind;
  if (kind === 'qualifications') return { singular: 'kvalifikasjon', titleLabel: 'Kvalifikasjon', detailOne: 'Nivå / omfang', description: 'Dokumentasjon / eksempel' };
  if (kind === 'courses') return { singular: 'kurs', titleLabel: 'Kurstittel', organizationLabel: 'Arrangør', period: 'Dato', singleDate: true, detailOne: 'Omfang', description: 'Innhold / relevans' };
  if (kind === 'certifications') return { singular: 'sertifikat', titleLabel: 'Sertifikat', organizationLabel: 'Utsteder', period: 'Utstedt', singleDate: true, detailOne: 'Gyldighet / sertifikat-ID', description: 'Tilleggsinformasjon' };
  if (kind === 'technicalSkills') return { singular: 'dataferdighet', titleLabel: 'Program / verktøy', detailOne: 'Nivå', description: 'Eksempel på bruk' };
  if (kind === 'positions') return { singular: 'verv', titleLabel: 'Vervtittel', organizationLabel: 'Organisasjon', period: 'Periode', description: 'Ansvar / oppgaver' };
  if (kind === 'volunteering') return { singular: 'frivillig rolle', titleLabel: 'Rolle', organizationLabel: 'Organisasjon', period: 'Periode', description: 'Hva jobbet du med?' };
  if (kind === 'languages') return { singular: 'språk', titleLabel: 'Språk', detailOne: 'Muntlig nivå', detailTwo: 'Skriftlig nivå' };
  if (kind === 'interests') return { singular: 'interesse', titleLabel: 'Interesse', description: 'Kort beskrivelse' };
  return { singular: 'oppføring', titleLabel: 'Tittel', description: 'Beskrivelse' };
}

function normalizeSupplementaryEntryForEditing(entry: CvEntry, kind?: CvSection['kind']) {
  const legacyText = entry.subtitle.trim();
  if (!legacyText || entry.employmentType?.trim()) return entry;
  if (!['certifications', 'technicalSkills', 'positions', 'languages', 'interests'].includes(kind ?? '')) return entry;

  let detail = legacyText;
  const organizationPrefix = entry.organization ? `${entry.organization} · ` : '';
  if (organizationPrefix && detail.startsWith(organizationPrefix)) detail = detail.slice(organizationPrefix.length);
  return { ...entry, subtitle: '', employmentType: detail };
}

function supplementarySummaryLine(entry: CvEntry) {
  const structured = [entry.organization, entry.employmentType].filter(Boolean).join(' · ');
  return structured || entry.subtitle;
}

export function DescriptionVersionsEditor({ entry, onChange, single = false, placeholder = 'Beskrivelse...' }: { entry: CvEntry; onChange: (entry: CvEntry) => void; single?: boolean; placeholder?: string }) {
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);
  const [formatState, setFormatState] = useState<Record<'bold' | 'italic' | 'underline' | 'link', 'on' | 'off' | 'mixed'>>({ bold: 'off', italic: 'off', underline: 'off', link: 'off' });
  const [linkEditorOpen, setLinkEditorOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);
  const linkEditorRef = useRef<HTMLDivElement>(null);
  const savedSelectionRef = useRef<Range | null>(null);
  const variants = entry.descriptionVariants?.length
    ? entry.descriptionVariants
    : [{ id: 'legacy-description', label: 'Versjon 1', lines: entry.lines }];
  const activeId = activeVariantId ?? entry.activeDescriptionVariantId ?? variants[0].id;
  const activeVariant = variants.find(variant => variant.id === activeId) ?? variants[0];
  const descriptionText = linesToText(activeVariant.lines);

  function refreshFormatState() {
    const next = getSelectionFormatState(editorRef.current);
    setFormatState(current => current.bold === next.bold
      && current.italic === next.italic
      && current.underline === next.underline
      && current.link === next.link ? current : next);
  }

  useEffect(() => {
    setActiveVariantId(entry.activeDescriptionVariantId ?? null);
  }, [entry.id]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.innerHTML = richLinesToHtml(activeVariant.lines);
    setFormatState({ bold: 'off', italic: 'off', underline: 'off', link: 'off' });
  }, [activeId]);

  useEffect(() => {
    const update = () => refreshFormatState();
    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, []);

  useEffect(() => {
    if (!linkEditorOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!linkEditorRef.current?.contains(event.target as Node)) cancelLink();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelLink();
    };
    window.document.addEventListener('pointerdown', closeOnOutsidePointer);
    window.document.addEventListener('keydown', closeOnEscape);
    return () => {
      window.document.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.document.removeEventListener('keydown', closeOnEscape);
    };
  }, [linkEditorOpen]);

  function commit(variantsToSave: DescriptionVariant[], nextActiveId = activeId) {
    const nextActive = variantsToSave.find(variant => variant.id === nextActiveId) ?? variantsToSave[0];
    onChange({ ...entry, descriptionVariants: variantsToSave, activeDescriptionVariantId: nextActive.id, lines: nextActive.lines });
  }

  function selectVariant(variantId: string) {
    setActiveVariantId(variantId);
    commit(variants, variantId);
  }

  function addVariant() {
    const id = crypto.randomUUID();
    const nextVariants = [...variants, { id, label: `Versjon ${variants.length + 1}`, lines: [] }];
    setActiveVariantId(id);
    commit(nextVariants, id);
    selectLabelOnNextFrame(id);
  }

  function duplicateVariant() {
    const source = variants.find(variant => variant.id === activeId) ?? variants[0];
    if (!source) return;
    const id = crypto.randomUUID();
    const nextVariant: DescriptionVariant = {
      id,
      label: `${source.label} kopi`,
      lines: source.lines.map(line => ({ runs: line.runs.map(run => ({ ...run })) }))
    };
    const nextVariants = [...variants, nextVariant];
    setActiveVariantId(id);
    commit(nextVariants, id);
    selectLabelOnNextFrame(id);
  }

  function selectLabelOnNextFrame(id: string) {
    window.requestAnimationFrame(() => {
      const label = window.document.querySelector<HTMLElement>(`[data-description-variant-label="${id}"]`);
      if (!label) return;
      label.focus();
      const range = window.document.createRange();
      range.selectNodeContents(label);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
  }

  function commitEditor() {
    const editor = editorRef.current;
    if (!editor) return;
    commit(variants.map(variant => variant.id === activeId ? { ...variant, lines: richEditorToLines(editor) } : variant), activeId);
  }

  function saveEditorSelection() {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return false;
    savedSelectionRef.current = range.cloneRange();
    return true;
  }

  function restoreEditorSelection() {
    const range = savedSelectionRef.current;
    if (!range) return false;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return true;
  }

  function openLinkEditor() {
    if (!saveEditorSelection()) return;
    setLinkDraft('');
    setLinkEditorOpen(true);
  }

  function saveLink() {
    const editor = editorRef.current;
    const url = linkDraft.trim();
    if (!editor || !url || !restoreEditorSelection()) return;
    editor.focus();
    window.document.execCommand('createLink', false, url);
    setLinkEditorOpen(false);
    setLinkDraft('');
    savedSelectionRef.current = null;
    refreshFormatState();
  }

  function cancelLink() {
    setLinkEditorOpen(false);
    setLinkDraft('');
    savedSelectionRef.current = null;
  }

  function applyInlineStyle(style: 'bold' | 'italic' | 'underline' | 'clear') {
    const editor = editorRef.current;
    if (!editor) return;
    if (!editor.innerText.trim()) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !editor.contains(selection.getRangeAt(0).commonAncestorContainer)) return;
    editor.focus();
    if (style === 'clear') {
      window.document.execCommand('removeFormat');
      window.document.execCommand('unlink');
    } else {
      window.document.execCommand(style);
    }
    refreshFormatState();
  }

  function handleLabelClick(event: MouseEvent<HTMLSpanElement>, variant: DescriptionVariant) {
    event.stopPropagation();
    // First click on another tab only changes the active description. It must
    // not put its label in edit mode.
    if (variant.id !== activeId) {
      setSelectedLabelId(null);
      selectVariant(variant.id);
      return;
    }
    if (selectedLabelId === variant.id) {
      // Do not replace the browser's normal second-click caret placement.
      setSelectedLabelId(null);
      return;
    }
    setSelectedLabelId(variant.id);
    window.requestAnimationFrame(() => {
      // The parent update can re-render this label, so always select the live node.
      const label = window.document.querySelector<HTMLElement>(`[data-description-variant-label="${variant.id}"]`);
      if (!label) return;
      label.focus();
      const range = window.document.createRange();
      range.selectNodeContents(label);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
  }

  return <div className="description-versions">
    {!single && <span className="description-versions-label">Beskrivelse</span>}
    {!single && <div className="description-version-tabs" role="tablist" aria-label="Beskrivelsesversjoner">
      {variants.map(variant => <div className={`description-version-tab ${variant.id === activeId ? 'is-active' : ''}`} role="tab" aria-selected={variant.id === activeId} tabIndex={0} key={variant.id} onClick={() => selectVariant(variant.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') selectVariant(variant.id); }}>
        <span data-description-variant-label={variant.id} contentEditable={variant.id === activeId} suppressContentEditableWarning spellCheck={false} onClick={event => handleLabelClick(event, variant)} onBlur={event => { setSelectedLabelId(null); const label = event.currentTarget.textContent?.trim() || `Versjon ${variants.indexOf(variant) + 1}`; if (label !== variant.label) commit(variants.map(item => item.id === variant.id ? { ...item, label } : item), variant.id); }}>{variant.label}</span>
      </div>)}
      <button className="description-version-copy" type="button" onClick={duplicateVariant} aria-label="Kopier aktiv beskrivelsesversjon"><Icon icon="mdi:content-copy" aria-hidden="true" /></button>
      <button className="description-version-add" type="button" onClick={addVariant} aria-label="Legg til beskrivelsesversjon">+</button>
    </div>}
    <div ref={editorRef} className={`description-version-textarea description-rich-editor ${single ? 'is-single' : ''}`} contentEditable suppressContentEditableWarning spellCheck data-placeholder={placeholder} onMouseUp={refreshFormatState} onKeyUp={refreshFormatState} onBlur={commitEditor} onKeyDown={event => {
      if (!event.ctrlKey) return;
      const key = event.key.toLowerCase();
      if (!['b', 'i', 'u', 'k', '\\'].includes(key)) return;
      event.preventDefault();
      if (key === 'k') openLinkEditor();
      else applyInlineStyle(key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'u' ? 'underline' : 'clear');
    }} />
    <div className="description-format-toolbar" aria-label="Tekstformatering">
      <button className={formatButtonClass(formatState.bold)} type="button" onMouseDown={event => event.preventDefault()} onClick={() => applyInlineStyle('bold')}><strong>B</strong></button>
      <button className={formatButtonClass(formatState.italic)} type="button" onMouseDown={event => event.preventDefault()} onClick={() => applyInlineStyle('italic')}><em>I</em></button>
      <button className={formatButtonClass(formatState.underline)} type="button" onMouseDown={event => event.preventDefault()} onClick={() => applyInlineStyle('underline')}><u>U</u></button>
      <div className="description-link-editor" ref={linkEditorRef}>
        <button className={formatButtonClass(formatState.link)} type="button" onMouseDown={event => event.preventDefault()} onClick={openLinkEditor}><Icon icon="mdi:link-variant" aria-hidden="true" /></button>
        {linkEditorOpen && (
          <div className="detail-link-popover">
            <label>Lenke / URL<input autoFocus value={linkDraft} placeholder="https://..." onChange={event => setLinkDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') saveLink(); if (event.key === 'Escape') cancelLink(); }} /></label>
            <div><button className="button primary" onClick={saveLink}>Lagre</button><button className="button secondary" onClick={cancelLink}>Avbryt</button></div>
          </div>
        )}
      </div>
      <button type="button" onClick={() => applyInlineStyle('clear')} title="Fjern formatering"><Icon icon="mdi:format-clear" aria-hidden="true" /></button>
    </div>
  </div>;
}

function renderRichLines(lines: RichLine[]) {
  return lines.map((line, lineIndex) => (
    <div key={lineIndex}>
      {line.runs.length ? line.runs.map((run, runIndex) => {
        const content = run.url ? <a href={run.url} target="_blank" rel="noopener noreferrer">{run.text}</a> : run.text;
        return <span key={runIndex} style={{ fontWeight: run.bold ? 700 : 400, fontStyle: run.italic ? 'italic' : undefined, textDecoration: run.underline ? 'underline' : undefined }}>{content}</span>;
      }) : <br />}
    </div>
  ));
}

function richLinesToHtml(lines: RichLine[]) {
  if (!lines.length) return '<div><br></div>';
  return lines.map(line => {
    const content = line.runs.length
      ? line.runs.map(runToHtml).join('')
      : '<br>';
    return `<div>${content || '<br>'}</div>`;
  }).join('');
}

function runToHtml(run: RichLine['runs'][number]) {
  let content = escapeHtml(run.text);
  if (run.url) content = `<a href="${escapeAttribute(run.url)}" target="_blank" rel="noopener noreferrer">${content}</a>`;
  if (run.underline) content = `<u>${content}</u>`;
  if (run.italic) content = `<em>${content}</em>`;
  if (run.bold) content = `<strong>${content}</strong>`;
  return content;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

function richEditorToLines(editor: HTMLElement): RichLine[] {
  const blockNodes = Array.from(editor.childNodes);
  const lineNodes = blockNodes.length ? blockNodes : [editor];
  return lineNodes.map(node => {
    const runs: RichLine['runs'] = [];
    collectRichRuns(node, runs, { bold: false });
    return { runs: runs.length ? runs : [{ text: '', bold: false }] };
  });
}

function formatButtonClass(state: 'on' | 'off' | 'mixed') {
  return state === 'on' ? 'is-active' : state === 'mixed' ? 'is-mixed' : '';
}

function getSelectionFormatState(editor: HTMLElement | null): Record<'bold' | 'italic' | 'underline' | 'link', 'on' | 'off' | 'mixed'> {
  const empty = { bold: 'off', italic: 'off', underline: 'off', link: 'off' } as const;
  const selection = window.getSelection();
  if (!editor || !selection || selection.rangeCount === 0) return empty;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return empty;

  const textNodes = getTextNodesInRange(editor, range);
  if (textNodes.length === 0) {
    const parent = selection.anchorNode instanceof HTMLElement ? selection.anchorNode : selection.anchorNode?.parentElement ?? null;
    return nodeFormatState(parent);
  }

  return {
    bold: combineFormatState(textNodes.map(node => nodeFormatState(node.parentElement).bold)),
    italic: combineFormatState(textNodes.map(node => nodeFormatState(node.parentElement).italic)),
    underline: combineFormatState(textNodes.map(node => nodeFormatState(node.parentElement).underline)),
    link: combineFormatState(textNodes.map(node => nodeFormatState(node.parentElement).link))
  };
}

function getTextNodesInRange(root: HTMLElement, range: Range) {
  const walker = window.document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    if ((current.textContent ?? '').trim() && range.intersectsNode(current)) nodes.push(current as Text);
    current = walker.nextNode();
  }
  return nodes;
}

function nodeFormatState(node: Element | null): Record<'bold' | 'italic' | 'underline' | 'link', 'on' | 'off'> {
  let current: Element | null = node;
  let bold = false;
  let italic = false;
  let underline = false;
  let link = false;
  const editor = node?.closest('.description-rich-editor');

  while (current && current !== editor) {
    const style = window.getComputedStyle(current);
    bold ||= current.tagName === 'B' || current.tagName === 'STRONG' || Number.parseInt(style.fontWeight, 10) >= 600;
    italic ||= current.tagName === 'I' || current.tagName === 'EM' || style.fontStyle === 'italic';
    underline ||= current.tagName === 'U' || style.textDecorationLine.includes('underline');
    link ||= current instanceof HTMLAnchorElement;
    current = current.parentElement;
  }

  return { bold: bold ? 'on' : 'off', italic: italic ? 'on' : 'off', underline: underline ? 'on' : 'off', link: link ? 'on' : 'off' };
}

function combineFormatState(states: Array<'on' | 'off'>): 'on' | 'off' | 'mixed' {
  return states.every(state => state === 'on') ? 'on' : states.every(state => state === 'off') ? 'off' : 'mixed';
}

function collectRichRuns(node: Node, runs: RichLine['runs'], inherited: Partial<RichLine['runs'][number]>) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    if (text) runs.push({ text, bold: inherited.bold ?? false, italic: inherited.italic, underline: inherited.underline, url: inherited.url });
    return;
  }

  if (!(node instanceof HTMLElement)) return;
  if (node.tagName === 'BR') return;

  const style = window.getComputedStyle(node);
  const next = {
    ...inherited,
    bold: inherited.bold || node.tagName === 'B' || node.tagName === 'STRONG' || Number.parseInt(style.fontWeight, 10) >= 600,
    italic: inherited.italic || node.tagName === 'I' || node.tagName === 'EM' || style.fontStyle === 'italic',
    underline: inherited.underline || node.tagName === 'U' || style.textDecorationLine.includes('underline'),
    url: inherited.url || (node instanceof HTMLAnchorElement ? node.href : undefined)
  };

  node.childNodes.forEach(child => collectRichRuns(child, runs, next));
}

function CompactField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="compact-field"><span>{label}</span><input value={value} placeholder={`${label}...`} onChange={event => onChange(event.target.value)} /></label>;
}

function CompactSelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  const legacyOption = value && !options.includes(value) ? value : null;
  return <label className="compact-field"><span>{label}</span><select value={value} onChange={event => onChange(event.target.value)}>
    <option value="">Velg nivå...</option>
    {legacyOption && <option value={legacyOption}>{legacyOption}</option>}
    {options.map(option => <option value={option} key={option}>{option}</option>)}
  </select></label>;
}

function DateRow({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children?: ReactNode }) {
  const { year, month } = parseDate(value);
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 101 }, (_, index) => String(currentYear - index));
  return (
    <div className="date-field">
      <span>{label}</span>
      <DateDropdown value={year} placeholder="Årstall..." options={years.map(option => ({ value: option, label: option }))} onChange={nextYear => onChange(makeDate(nextYear, month))} />
      <DateDropdown value={month} placeholder="Måned..." options={months.map((option, index) => ({ value: String(index + 1).padStart(2, '0'), label: option }))} onChange={nextMonth => onChange(makeDate(year, nextMonth))} />
      <span className="date-row-actions">{children}</span>
    </div>
  );
}

function DateDropdown({ value, placeholder, options, onChange }: { value: string; placeholder: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find(option => option.value === value);

  useEffect(() => {
    function closeOnOutsideClick(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener('pointerdown', closeOnOutsideClick);
    return () => window.removeEventListener('pointerdown', closeOnOutsideClick);
  }, []);

  return (
    <div className="date-dropdown" ref={rootRef}>
      <button type="button" className={`date-dropdown-trigger ${value ? '' : 'is-placeholder'}`} onClick={() => setOpen(current => !current)} aria-expanded={open}>{selected?.label ?? placeholder}</button>
      {open && <div className="date-dropdown-menu">
        {options.map(option => <button type="button" className={option.value === value ? 'is-selected' : ''} key={option.value} onClick={() => { onChange(option.value); setOpen(false); }}>{option.label}</button>)}
      </div>}
    </div>
  );
}

const months = ['Januar', 'Februar', 'Mars', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Desember'];

function parseDate(value: string) {
  const [year = '', month = ''] = value.split('-');
  return { year, month };
}

function makeDate(year: string, month: string) {
  if (!year) return '';
  return month ? `${year}-${month}` : year;
}

function buildSubtitle(entry: CvEntry) {
  return entry.organization ?? entry.subtitle;
}

function legacyOrganization(subtitle: string) {
  return subtitle.split(' · ')[0] ?? '';
}

function summaryPeriod(entry: CvEntry) {
  if (!entry.startDate && !entry.endDate && !entry.isCurrent) return '';
  const start = formatDate(entry.startDate);
  const end = entry.isCurrent ? 'nå' : formatDate(entry.endDate);
  return [start, end].filter(Boolean).join('–');
}

function formatDate(value?: string) {
  if (!value) return '';
  const [year, month] = value.split('-');
  return month ? `${month}.${year}` : year;
}

function summaryLine(entry: CvEntry) {
  const fallback = entry.subtitle.trim();
  const legacyOrganizationValue = fallback === summaryPeriod(entry) ? '' : legacyOrganization(entry.subtitle);
  const structured = [entry.organization || legacyOrganizationValue, entry.employmentType].filter(Boolean).join(' · ');
  if (structured) return structured;
  if (fallback && [summaryPeriod(entry), entry.location ?? ''].includes(fallback)) return '';
  return fallback;
}

function linesToText(lines: RichLine[]) {
  return lines.map(line => line.runs.map(run => run.text).join('')).join('\n');
}

function updateCustomField(fields: NonNullable<CvEntry['customFields']>, index: number, patch: Partial<NonNullable<CvEntry['customFields']>[number]>) {
  return fields.map((field, currentIndex) => currentIndex === index ? { ...field, ...patch } : field);
}

function textToLines(value: string): RichLine[] {
  return value.split('\n').map(line => ({ runs: [{ text: line, bold: false }] }));
}

function applyStyleToPlainSelection(value: string, start: number, end: number, style: Partial<RichLine['runs'][number]>): RichLine[] {
  const before = value.slice(0, start);
  const selected = value.slice(start, end);
  const after = value.slice(end);
  const runs: RichLine['runs'] = [];

  if (before) runs.push({ text: before, bold: false });
  if (selected) runs.push({ text: selected, bold: false, ...style });
  if (after) runs.push({ text: after, bold: false });

  const lines: RichLine[] = [{ runs: [] }];
  for (const run of runs) {
    const parts = run.text.split('\n');
    parts.forEach((part, index) => {
      if (index > 0) lines.push({ runs: [] });
      if (part) lines[lines.length - 1].runs.push({ ...run, text: part });
    });
  }

  return lines.map(line => ({ runs: line.runs.length ? line.runs : [{ text: '', bold: false }] }));
}

function summaryDescription(lines: RichLine[]) {
  return linesToText(lines).replace(/\s+/g, ' ').trim();
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
