import { Link } from '@tanstack/react-router';
import type { BusinessProfile } from '../../../types';
import './BusinessProfileCard.css';

interface BusinessProfileCardProps {
  profile: BusinessProfile;
  onEditClick?: () => void;
  language?: 'ar' | 'en';
}

export function BusinessProfileCard({ profile, onEditClick, language = 'en' }: BusinessProfileCardProps) {
  // Get localized values
  const name = language === 'ar' ? profile.name : (profile.nameEn || profile.name);
  const address = language === 'ar' ? profile.address1 : (profile.address1En || profile.address1);
  const city = language === 'ar' ? profile.city : (profile.cityEn || profile.city);

  // Generate initials for avatar fallback
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();

  return (
    <div className="business-profile-card">
      <div className="business-profile-card-content">
        {/* Left Column: Logo + Address */}
        <div className="business-profile-card-left">
          <div className="business-profile-card-avatar">
            {profile.logoDataUrl ? (
              <img src={profile.logoDataUrl} alt={name} className="business-profile-card-logo" />
            ) : (
              <div
                className="business-profile-card-initials"
                style={{ backgroundColor: profile.primaryColor || '#3b82f6' }}
              >
                {initials}
              </div>
            )}
          </div>
          <div className="business-profile-card-info">
            <div className="business-profile-card-name">{name}</div>
            {address && <div className="business-profile-card-detail">{address}</div>}
            {city && <div className="business-profile-card-detail">{city}</div>}
            {profile.phone && <div className="business-profile-card-detail">{profile.phone}</div>}
          </div>
        </div>

        {/* Right Column: Email, Website, Tax ID */}
        <div className="business-profile-card-right">
          {profile.email && <div className="business-profile-card-detail">{profile.email}</div>}
          {profile.website && <div className="business-profile-card-detail">{profile.website}</div>}
          {profile.taxId && (
            <div className="business-profile-card-tax-id">{profile.taxId}</div>
          )}
        </div>
      </div>

      {/* Edit Link */}
      <div className="business-profile-card-footer">
        {onEditClick ? (
          <button type="button" className="business-profile-card-edit-btn" onClick={onEditClick}>
            Edit profile
          </button>
        ) : (
          <Link
            to="/settings/profiles/$profileId"
            params={{ profileId: profile.id }}
            className="business-profile-card-edit-btn"
          >
            Edit profile
          </Link>
        )}
      </div>
    </div>
  );
}
