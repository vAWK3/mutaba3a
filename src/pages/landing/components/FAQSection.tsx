import { useState, useCallback } from 'react';
import { useT } from '../../../lib/i18n';
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
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

interface FAQItemProps {
  question: string;
  answer: string;
  isOpen: boolean;
  onToggle: () => void;
}

function FAQItem({ question, answer, isOpen, onToggle }: FAQItemProps) {
  return (
    <div className={`landing-faq-item ${isOpen ? 'landing-faq-item--open' : ''}`}>
      <button
        className="landing-faq-question"
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        <span>{question}</span>
        <ChevronDownIcon />
      </button>
      <div className="landing-faq-answer">
        <p>{answer}</p>
      </div>
    </div>
  );
}

export function FAQSection() {
  const t = useT();
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const toggleFaq = useCallback((index: number) => {
    setOpenFaq((prev) => (prev === index ? null : index));
  }, []);

  // FAQ items - includes the 2 new items per spec
  const faqItems = Array.from({ length: 12 }, (_, i) => ({
    question: t(`landing.faq.q${i + 1}`),
    answer: t(`landing.faq.a${i + 1}`),
  }));

  return (
    <section className="landing-section landing-faq">
      <div className="landing-container">
        <h2 className="landing-section-headline">{t('landing.faq.headline')}</h2>
        <div className="landing-faq-list">
          {faqItems.map((item, index) => (
            <FAQItem
              key={index}
              question={item.question}
              answer={item.answer}
              isOpen={openFaq === index}
              onToggle={() => toggleFaq(index)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
