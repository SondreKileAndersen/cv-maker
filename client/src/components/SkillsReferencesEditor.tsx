import { useState } from 'react';
import { Icon } from '@iconify/react';
import { CvEntry, ReferencePerson, RichLine, SkillGroup } from '../types';
import { DescriptionVersionsEditor } from './SectionEditor';

interface Props {
  skillGroups: SkillGroup[];
  references: ReferencePerson[];
  onSkillsChange: (groups: SkillGroup[]) => void;
  onReferencesChange: (references: ReferencePerson[]) => void;
  section?: 'all' | 'skills' | 'references';
}

export function SkillsReferencesEditor({ skillGroups, references, onSkillsChange, onReferencesChange, section = 'all' }: Props) {
  const [editingSkillIndex, setEditingSkillIndex] = useState<number | null>(null);
  const [editingReferenceIndex, setEditingReferenceIndex] = useState<number | null>(null);
  const showSkills = section === 'all' || section === 'skills';
  const showReferences = section === 'all' || section === 'references';

  return (
    <>
      {showSkills && <section className="panel" id="skills">
        <h2 className="master-section-heading"><Icon icon="mdi:star-four-points" aria-hidden="true" />Nøkkelkvalifikasjoner</h2>
        <div className="entry-list entry-summary-list">
          {skillGroups.map((group, index) => editingSkillIndex === index ? (
            <article className="entry-editor" key={`skill-editor-${index}`}>
              <div className="entry-editor-header"><strong className={!group.title ? 'entry-editor-new-label' : undefined}>{group.title || 'Ny nøkkelkvalifikasjon'}</strong></div>
              <label className="compact-field"><span>Yrkesfelt</span><input value={group.title} placeholder="Yrkesfelt..." onChange={event => updateSkill(index, { ...group, title: event.target.value })} /></label>
              <DescriptionVersionsEditor entry={skillToEntry(group, index)} onChange={entry => updateSkill(index, entryToSkill(group, entry))} />
              <div className="entry-editor-actions">
                <div className="entry-primary-actions">
                  <button className="button entry-save" onClick={() => setEditingSkillIndex(null)}>Lagre</button>
                  <button className="button entry-cancel" onClick={() => setEditingSkillIndex(null)}>Avbryt</button>
                </div>
                <button className="button ghost entry-remove" onClick={() => { onSkillsChange(skillGroups.filter((_, currentIndex) => currentIndex !== index)); setEditingSkillIndex(null); }}>Fjern nøkkelkvalifikasjon</button>
              </div>
            </article>
          ) : (
            <article className="entry-summary is-editable" key={`skill-summary-${index}`} role="button" tabIndex={0} onClick={() => setEditingSkillIndex(index)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') setEditingSkillIndex(index); }}>
              <div className="entry-summary-icon"><Icon icon="mdi:star-four-points" /></div>
              <div className="entry-summary-content">
                <strong>{group.title || 'Ny nøkkelkvalifikasjon'}</strong>
                {skillDescriptionText(group) && <p>{skillDescriptionText(group)}</p>}
              </div>
            </article>
          ))}
        </div>
        {editingSkillIndex === null && <button className="add-entry" onClick={() => { onSkillsChange([...skillGroups, { title: '', content: '', column: 1 }]); setEditingSkillIndex(skillGroups.length); }}>+ Legg til</button>}
      </section>}

      {showReferences && <section className="panel" id="references">
        <h2 className="master-section-heading"><Icon icon="mdi:account-group" aria-hidden="true" />Referanser</h2>
        <p className="section-help">Legg inn kontaktpersoner, eller la feltet stå tomt dersom du vil oppgi referanser på forespørsel.</p>
        <div className="entry-list entry-summary-list">
          {references.map((reference, index) => editingReferenceIndex === index ? (
            <article className="entry-editor" key={`reference-editor-${index}`}>
              <div className="entry-editor-header"><strong className={!reference.nameAndRole ? 'entry-editor-new-label' : undefined}>{reference.nameAndRole || 'Ny referanse'}</strong></div>
              <label className="compact-field"><span>Navn</span><input value={splitReferenceNameAndRole(reference.nameAndRole).name} placeholder="Navn..." onChange={event => updateReference(index, { ...reference, nameAndRole: joinReferenceNameAndRole(event.target.value, splitReferenceNameAndRole(reference.nameAndRole).role) })} /></label>
              <label className="compact-field"><span>Rolle</span><input value={splitReferenceNameAndRole(reference.nameAndRole).role} placeholder="Rolle..." onChange={event => updateReference(index, { ...reference, nameAndRole: joinReferenceNameAndRole(splitReferenceNameAndRole(reference.nameAndRole).name, event.target.value) })} /></label>
              <label className="compact-field"><span>Organisasjon</span><input value={reference.organization} placeholder="Organisasjon..." onChange={event => updateReference(index, { ...reference, organization: event.target.value })} /></label>
              <label className="compact-field"><span>Telefon</span><input value={reference.phone} placeholder="Telefon..." onChange={event => updateReference(index, { ...reference, phone: event.target.value })} /></label>
              <label className="compact-field"><span>E-post</span><input value={reference.email} placeholder="E-post..." onChange={event => updateReference(index, { ...reference, email: event.target.value })} /></label>
              <div className="entry-editor-actions">
                <div className="entry-primary-actions">
                  <button className="button entry-save" onClick={() => setEditingReferenceIndex(null)}>Lagre</button>
                  <button className="button entry-cancel" onClick={() => setEditingReferenceIndex(null)}>Avbryt</button>
                </div>
                <button className="button ghost entry-remove" onClick={() => { onReferencesChange(references.filter((_, currentIndex) => currentIndex !== index)); setEditingReferenceIndex(null); }}>Fjern referanse</button>
              </div>
            </article>
          ) : (
            <article className="entry-summary is-editable" key={`reference-summary-${index}`} role="button" tabIndex={0} onClick={() => setEditingReferenceIndex(index)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') setEditingReferenceIndex(index); }}>
              <div className="entry-summary-icon"><Icon icon="mdi:account-group" /></div>
              <div className="entry-summary-content">
                <strong>{reference.nameAndRole || 'Ny referanse'}</strong>
                {reference.organization && <span>{reference.organization}</span>}
                {reference.phone && <span>{reference.phone}</span>}
                {reference.email && <span>{reference.email}</span>}
              </div>
            </article>
          ))}
        </div>
        {editingReferenceIndex === null && <button className="add-entry" onClick={() => { onReferencesChange([...references, { nameAndRole: '', organization: '', phone: '', email: '' }]); setEditingReferenceIndex(references.length); }}>+ Legg til</button>}
      </section>}
    </>
  );

  function updateSkill(index: number, value: SkillGroup) {
    const next = [...skillGroups];
    next[index] = value;
    onSkillsChange(next);
  }

  function updateReference(index: number, value: ReferencePerson) {
    const next = [...references];
    next[index] = value;
    onReferencesChange(next);
  }
}

function skillToEntry(group: SkillGroup, index: number): CvEntry {
  return {
    id: `skill-${index}`,
    title: group.title,
    subtitle: '',
    lines: group.descriptionVariants?.find(variant => variant.id === group.activeDescriptionVariantId)?.lines ?? textToLines(group.content),
    descriptionVariants: group.descriptionVariants,
    activeDescriptionVariantId: group.activeDescriptionVariantId
  };
}

function entryToSkill(group: SkillGroup, entry: CvEntry): SkillGroup {
  const activeLines = entry.descriptionVariants?.find(variant => variant.id === entry.activeDescriptionVariantId)?.lines ?? entry.lines;
  return {
    ...group,
    title: entry.title,
    content: linesToText(activeLines),
    descriptionVariants: entry.descriptionVariants,
    activeDescriptionVariantId: entry.activeDescriptionVariantId
  };
}

function skillDescriptionText(group: SkillGroup) {
  const activeLines = group.descriptionVariants?.find(variant => variant.id === group.activeDescriptionVariantId)?.lines;
  return activeLines ? linesToText(activeLines) : group.content;
}

function textToLines(value: string): RichLine[] {
  return value
    .split('\n')
    .map(line => ({ runs: [{ text: line, bold: false }] }));
}

function linesToText(lines: RichLine[]) {
  return lines.map(line => line.runs.map(run => run.text).join('')).join('\n');
}

function splitReferenceNameAndRole(value: string) {
  const separators = [' – ', ' - ', ', '];
  const separator = separators.find(item => value.includes(item));
  if (!separator) return { name: value, role: '' };
  const [name, ...roleParts] = value.split(separator);
  return { name, role: roleParts.join(separator) };
}

function joinReferenceNameAndRole(name: string, role: string) {
  const trimmedName = name.trim();
  const trimmedRole = role.trim();
  if (!trimmedRole) return trimmedName;
  if (!trimmedName) return trimmedRole;
  return `${trimmedName} – ${trimmedRole}`;
}
