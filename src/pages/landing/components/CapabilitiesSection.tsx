import { useT } from '../../../lib/i18n';

const CheckIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

interface CapabilityBlockProps {
  title: string;
  bullets: string[];
}

function CapabilityBlock({ title, bullets }: CapabilityBlockProps) {
  return (
    <div className="capability-block">
      <h3 className="capability-title">{title}</h3>
      <ul className="capability-list">
        {bullets.map((bullet, idx) => (
          <li key={idx} className="capability-item">
            <CheckIcon />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CapabilitiesSection() {
  const t = useT();

  const blocks = [
    {
      title: t('landing.capabilities.block1Title'),
      bullets: [
        t('landing.capabilities.block1Bullet1'),
        t('landing.capabilities.block1Bullet2'),
        t('landing.capabilities.block1Bullet3'),
        t('landing.capabilities.block1Bullet4'),
      ],
    },
    {
      title: t('landing.capabilities.block2Title'),
      bullets: [
        t('landing.capabilities.block2Bullet1'),
        t('landing.capabilities.block2Bullet2'),
        t('landing.capabilities.block2Bullet3'),
      ],
    },
    {
      title: t('landing.capabilities.block3Title'),
      bullets: [
        t('landing.capabilities.block3Bullet1'),
        t('landing.capabilities.block3Bullet2'),
        t('landing.capabilities.block3Bullet3'),
      ],
    },
  ];

  return (
    <section className="landing-section landing-capabilities">
      <div className="landing-container">
        <h2 className="landing-section-headline">{t('landing.capabilities.headline')}</h2>
        <div className="capabilities-grid">
          {blocks.map((block, idx) => (
            <CapabilityBlock key={idx} title={block.title} bullets={block.bullets} />
          ))}
        </div>
      </div>
    </section>
  );
}
