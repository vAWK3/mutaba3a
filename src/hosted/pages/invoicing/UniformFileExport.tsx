import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { SegmentedControl } from '../../../components/ui/SegmentedControl';
import { useLanguage, useT } from '../../../lib/i18n/core';
import { api, type HostedProfile } from '../../api/client';
import { useToast } from '../../components/Toast';
import { saveBlobAs } from '../../data/download';
import { todayInZone } from '../../format/dates';
import { rangeOf, type Preset } from './uniformFileRange';
import './uniform-file.css';

/**
 * MUT-569 (ADR-271): You › Invoicing's uniform-file card (wireframe `.claude/designs/mut-569-uniform-file-wireframe.html`).
 * Last year by default (the tax year), this year, or other dates; the download is the OPENFRMT zip with its printable
 * report. The owner and an accountant with access both see it; the phone has none (D6).
 */


type Outcome = { kind: 'done'; filename: string; documents: number; records: number } | null;

export function UniformFileExport({ profile }: { profile: HostedProfile }) {
  const t = useT();
  const { language } = useLanguage();
  const toast = useToast();
  const today = todayInZone(profile.timezone);
  const [preset, setPreset] = useState<Preset>('lastYear');
  const [custom, setCustom] = useState(() => rangeOf('lastYear', today));
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const range = preset === 'custom' ? custom : rangeOf(preset, today);
  const reversed = range.from > range.to;

  const choose = (next: Preset) => {
    setPreset(next);
    setOutcome(null);
  };
  const edit = (patch: Partial<typeof custom>) => {
    setCustom((c) => ({ ...c, ...patch }));
    setOutcome(null);
  };

  async function download() {
    setBusy(true);
    setOutcome(null);
    try {
      const file = await api.uniformFile(profile.id, { ...range, lang: language === 'ar' ? 'ar' : 'en' });
      saveBlobAs(file.blob, file.filename);
      setOutcome({ kind: 'done', filename: file.filename, documents: file.documents, records: file.records });
    } catch {
      toast(t('hosted.invoicing.uniformFile.failed'), { action: { label: t('hosted.invoicing.uniformFile.retry'), onAction: () => void download() } });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="hp-uniform-file" aria-labelledby="hp-uniform-file-title">
      <h2 id="hp-uniform-file-title">{t('hosted.invoicing.uniformFile.title')}</h2>
      <p className="hp-uniform-file-lead">{t(profile.owned ? 'hosted.invoicing.uniformFile.lead' : 'hosted.invoicing.uniformFile.leadReader')}</p>
      <SegmentedControl<Preset>
        ariaLabel={t('hosted.invoicing.uniformFile.rangeLabel')}
        value={preset}
        onChange={choose}
        options={[
          { value: 'lastYear', label: t('hosted.invoicing.uniformFile.lastYear') },
          { value: 'thisYear', label: t('hosted.invoicing.uniformFile.thisYear') },
          { value: 'custom', label: t('hosted.invoicing.uniformFile.otherDates') },
        ]}
      />
      <div className="hp-uniform-file-dates">
        <Input
          id="hp-uniform-file-from"
          type="date"
          label={t('hosted.invoicing.uniformFile.from')}
          value={range.from}
          max={today}
          disabled={preset !== 'custom'}
          onChange={(e) => edit({ from: e.target.value })}
        />
        <Input
          id="hp-uniform-file-to"
          type="date"
          label={t('hosted.invoicing.uniformFile.to')}
          value={range.to}
          max={today}
          disabled={preset !== 'custom'}
          onChange={(e) => edit({ to: e.target.value })}
          {...(reversed ? { error: t('hosted.invoicing.uniformFile.toBeforeFrom') } : {})}
        />
      </div>
      <Button onClick={() => void download()} disabled={busy || reversed || !range.from || !range.to} aria-busy={busy}>
        {busy ? t('hosted.invoicing.uniformFile.preparing') : t('hosted.invoicing.uniformFile.download')}
      </Button>
      {outcome && (
        <p className={`hp-uniform-file-status ${outcome.documents ? 'is-done' : 'is-empty'}`} role="status">
          {outcome.documents ? (
            <>
              {t('hosted.invoicing.uniformFile.done')} <bdi dir="ltr">{outcome.filename}</bdi>
              <small>{t('hosted.invoicing.uniformFile.counts', { documents: outcome.documents, records: outcome.records })}</small>
            </>
          ) : (
            <>
              {t('hosted.invoicing.uniformFile.emptyTitle')}
              <small>{t('hosted.invoicing.uniformFile.emptyBody')}</small>
            </>
          )}
        </p>
      )}
      <details className="hp-uniform-file-inside">
        <summary>{t('hosted.invoicing.uniformFile.insideTitle')}</summary>
        <ul>
          <li>
            <bdi dir="ltr">INI.TXT</bdi> · {t('hosted.invoicing.uniformFile.insideIni')}
          </li>
          <li>
            <bdi dir="ltr">BKMVDATA.zip</bdi> · {t('hosted.invoicing.uniformFile.insideBkmv')}
          </li>
          <li>
            <bdi dir="ltr">report.html</bdi> · {t('hosted.invoicing.uniformFile.insideReport')}
          </li>
        </ul>
      </details>
    </section>
  );
}
