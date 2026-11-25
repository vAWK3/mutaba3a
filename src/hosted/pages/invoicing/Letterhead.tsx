import type { ReactNode } from 'react';
import { useT } from '../../../lib/i18n/core';
import './letterhead.css';
import { SETUP_STEPS, type PaperModel, type SetupStep } from './setupSteps';

/**
 * MUT-646 (round 3, variant 2): the letterhead as the map of the setup. An HTML sketch of the printed page, not the
 * PDF: each numbered region is a setup step, lit while it is the current one and ticked once done; picking a region
 * opens its step. It follows the forms as they are typed (AC3): style, ink, language and logo change it at once.
 */
/** What the paper prints, in the document's own language (the server's issuing/labels.ts and pdf/labels.ts). */
const PAPER: Record<
  PaperModel['language'],
  {
    invoice: string;
    receipt: string;
    dealer: Record<PaperModel['dealerType'], string>;
  }
> = {
  he: {
    invoice: 'חשבונית מס',
    receipt: 'קבלה',
    dealer: {
      LICENSED: 'עוסק מורשה',
      EXEMPT: 'עוסק פטור',
      COMPANY: 'ח.פ.',
      NONPROFIT: 'ע.ר.',
    },
  },
  ar: {
    invoice: 'فاتورة ضريبية',
    receipt: 'إيصال',
    dealer: {
      LICENSED: 'مشتغل مرخّص',
      EXEMPT: 'مشتغل معفى',
      COMPANY: 'رقم الشركة',
      NONPROFIT: 'رقم الجمعية',
    },
  },
  en: {
    invoice: 'Tax invoice',
    receipt: 'Receipt',
    dealer: {
      LICENSED: 'Licensed dealer',
      EXEMPT: 'Exempt dealer',
      COMPANY: 'Company no.',
      NONPROFIT: 'Nonprofit no.',
    },
  },
};

interface LetterheadProps {
  model: PaperModel;
  current: SetupStep;
  done: ReadonlySet<SetupStep>;
  onPick: (step: SetupStep) => void;
}

export function Letterhead({ model, current, done, onPick }: LetterheadProps) {
  const t = useT();
  const words = PAPER[model.language];
  const blank = (label: string, required: boolean) => (
    <span className="hp-paper-blank">
      {label}
      {required ? ' *' : ''}
    </span>
  );

  const region = (step: SetupStep, className: string, children: ReactNode) => {
    const n = SETUP_STEPS.indexOf(step) + 1;
    return (
      <button
        type="button"
        className={`hp-paper-region ${className}`}
        data-step={step}
        data-current={step === current || undefined}
        data-done={done.has(step) || undefined}
        aria-label={t('hosted.invoicing.region', {
          n: String(n),
          title: t(`hosted.invoicing.steps.${step}`),
        })}
        aria-current={step === current ? 'step' : undefined}
        onClick={() => onPick(step)}
      >
        <span className="hp-paper-badge" aria-hidden="true">
          {done.has(step) ? '✓' : n}
        </span>
        {children}
      </button>
    );
  };

  const place = [model.address, model.city].filter(Boolean).join(', ');
  const contact = [model.phone, model.email].filter(Boolean).join(' · ');
  // The paper reads in the document's language, whatever the portal's is (two branches: dir is never computed, MUT-109).
  const paper = {
    className: `hp-paper hp-paper--${model.style.toLowerCase()}`,
    'data-ink': model.ink,
    lang: model.language,
    'data-testid': 'letterhead',
  };
  const content = (
    <>
      <div className="hp-paper-head">
        {region(
          'details',
          'hp-paper-issuer',
          <span className="hp-paper-issuer-lines">
            <strong className="hp-paper-name">{model.legalName || blank(t('hosted.invoicing.paper.legalName'), true)}</strong>
            <span>
              {words.dealer[model.dealerType]} <bdi>{model.vatId || blank(t('hosted.invoicing.paper.number'), true)}</bdi>
            </span>
            <span>{place || blank(t('hosted.invoicing.paper.address'), false)}</span>
            {contact && <bdi>{contact}</bdi>}
          </span>,
        )}
        {region('logo', 'hp-paper-logo', model.logoUrl ? <img src={model.logoUrl} alt="" /> : blank(t('hosted.invoicing.paper.logo'), false))}
      </div>
      {region(
        'numbering',
        'hp-paper-title',
        <span>
          {model.dealerType === 'EXEMPT' ? words.receipt : words.invoice} <bdi>{model.nextNumber}</bdi>
        </span>,
      )}
      <div className="hp-paper-lines" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      {region(
        'defaults',
        'hp-paper-foot',
        <span className="hp-paper-foot-lines">
          <span>{`${t(`hosted.invoicing.defaults.styles.${model.style}`)} · ${t(`hosted.invoicing.defaults.inks.${model.ink}`)}`}</span>
          {model.bankDetails && <bdi>{model.bankDetails}</bdi>}
          {model.footerNote && <bdi>{model.footerNote}</bdi>}
        </span>,
      )}
      {region('taxAuthority', 'hp-paper-allocation', <span>{t('hosted.invoicing.taxAuthority.status')}</span>)}
    </>
  );
  return (
    <figure className="hp-paper-frame" aria-label={t('hosted.invoicing.paper.label')}>
      {model.language === 'en' ? (
        <div {...paper} dir="ltr">
          {content}
        </div>
      ) : (
        <div {...paper} dir="rtl">
          {content}
        </div>
      )}
    </figure>
  );
}
