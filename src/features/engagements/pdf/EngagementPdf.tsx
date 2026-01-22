import { Document } from '@react-pdf/renderer';
import type { EngagementSnapshot, EngagementLanguage, EngagementType, EngagementCategory } from '../types';
import type { Client, BusinessProfile } from '../../../types';

// Import fonts (side effect - registers fonts)
import '../../documents/pdf/fonts';

// Import page components
import { CoverLetterPage } from './pages/CoverLetterPage';
import { SchedulesPage } from './pages/SchedulesPage';

export interface EngagementPdfProps {
  snapshot: EngagementSnapshot;
  client?: Client;
  language: EngagementLanguage;
  type: EngagementType;
  category: EngagementCategory;
  profile?: BusinessProfile;
}

/**
 * EngagementPdf - Professional letter-style engagement document
 *
 * Structure:
 * - Page 1: Cover Letter with signatures
 * - Page 2+: Schedules (Key Terms Summary, Scope, Timeline, Fees, Relationship, Legal Terms)
 */
export function EngagementPdf(props: EngagementPdfProps) {
  const { snapshot, client, language, type, category, profile } = props;

  return (
    <Document>
      {/* Page 1: Cover Letter */}
      <CoverLetterPage
        snapshot={snapshot}
        client={client}
        language={language}
        type={type}
        category={category}
        profile={profile}
      />

      {/* Page 2+: Schedules */}
      <SchedulesPage
        snapshot={snapshot}
        client={client}
        language={language}
        type={type}
        category={category}
        profile={profile}
      />
    </Document>
  );
}

export default EngagementPdf;
