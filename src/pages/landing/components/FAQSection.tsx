import { useCallback, useId, useMemo, useState } from 'react';
import { getLocale, useLanguage, useT } from '../../../lib/i18n';
import {
  CURRENCY_NAME_KEYS,
  FAQ_COUNT,
  FAQ_CURRENCY_INDEX,
  formatCurrencyList,
} from '../landingCopy';
import './FAQSection.css';

const ChevronDownIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

interface FAQItemProps {
  id: string;
  question: string;
  answer: string;
  isOpen: boolean;
  onToggle: () => void;
}

function FAQItem({ id, question, answer, isOpen, onToggle }: FAQItemProps) {
  const answerId = `${id}-answer`;

  return (
    <div className={`landing-faq-item${isOpen ? ' landing-faq-item--open' : ''}`}>
      <h3 className="landing-faq-heading">
        <button
          type="button"
          className="landing-faq-question"
          onClick={onToggle}
          aria-expanded={isOpen}
          aria-controls={answerId}
        >
          <span>{question}</span>
          <ChevronDownIcon />
        </button>
      </h3>
      <div id={answerId} className="landing-faq-answer" hidden={!isOpen}>
        <p>{answer}</p>
      </div>
    </div>
  );
}

export function FAQSection() {
  const t = useT();
  const { language } = useLanguage();
  const baseId = useId();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggle = useCallback((index: number) => {
    setOpenIndex((current) => (current === index ? null : index));
  }, []);

  const items = useMemo(() => {
    const currencies = formatCurrencyList(
      Object.values(CURRENCY_NAME_KEYS).map((key) => t(key)),
      getLocale(language)
    );
    return Array.from({ length: FAQ_COUNT }, (_, i) => {
      const n = i + 1;
      return {
        question: t(`landing.faq.q${n}`),
        answer: t(`landing.faq.a${n}`, n === FAQ_CURRENCY_INDEX ? { currencies } : undefined),
      };
    });
  }, [t, language]);

  return (
    <section data-part="faq" aria-labelledby="faq-title" className="landing-section landing-faq">
      <div className="landing-container">
        <h2 id="faq-title" className="landing-section-headline">
          {t('landing.faq.headline')}
        </h2>
        <div className="landing-faq-list">
          {items.map((item, index) => (
            <FAQItem
              key={index}
              id={`${baseId}-faq-${index}`}
              question={item.question}
              answer={item.answer}
              isOpen={openIndex === index}
              onToggle={() => toggle(index)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
