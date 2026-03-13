import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProfileBadge, ProfileBadgeWithName } from '../ProfileBadge';
import type { BusinessProfile } from '../../../types';

const mockProfile: BusinessProfile = {
  id: 'profile-1',
  name: 'My Business',
  primaryColor: '#FF5500',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

describe('ProfileBadge', () => {
  describe('basic rendering', () => {
    it('should render profile initial', () => {
      render(<ProfileBadge profile={mockProfile} />);
      expect(screen.getByText('M')).toBeInTheDocument();
    });

    it('should capitalize the initial', () => {
      const lowercaseProfile = { ...mockProfile, name: 'lowercase' };
      render(<ProfileBadge profile={lowercaseProfile} />);
      expect(screen.getByText('L')).toBeInTheDocument();
    });

    it('should apply profile color as background', () => {
      render(<ProfileBadge profile={mockProfile} />);
      const badge = screen.getByText('M');
      expect(badge).toHaveStyle({ backgroundColor: '#FF5500' });
    });

    it('should use default accent color when no primaryColor', () => {
      const noColorProfile = { ...mockProfile, primaryColor: undefined };
      render(<ProfileBadge profile={noColorProfile} />);
      const badge = screen.getByText('M');
      expect(badge).toHaveStyle({ backgroundColor: 'var(--accent)' });
    });
  });

  describe('size variants', () => {
    it('should apply sm size class by default', () => {
      const { container } = render(<ProfileBadge profile={mockProfile} />);
      expect(container.querySelector('.profile-badge-sm')).toBeInTheDocument();
    });

    it('should apply md size class', () => {
      const { container } = render(<ProfileBadge profile={mockProfile} size="md" />);
      expect(container.querySelector('.profile-badge-md')).toBeInTheDocument();
    });
  });

  describe('tooltip', () => {
    it('should show tooltip by default', () => {
      render(<ProfileBadge profile={mockProfile} />);
      expect(screen.getByText('M')).toHaveAttribute('title', 'My Business');
    });

    it('should hide tooltip when showTooltip is false', () => {
      render(<ProfileBadge profile={mockProfile} showTooltip={false} />);
      expect(screen.getByText('M')).not.toHaveAttribute('title');
    });
  });

  describe('accessibility', () => {
    it('should have aria-label with profile name', () => {
      render(<ProfileBadge profile={mockProfile} />);
      expect(screen.getByText('M')).toHaveAttribute('aria-label', 'My Business');
    });
  });

  describe('className', () => {
    it('should apply custom className', () => {
      const { container } = render(<ProfileBadge profile={mockProfile} className="custom" />);
      expect(container.querySelector('.profile-badge.custom')).toBeInTheDocument();
    });
  });
});

describe('ProfileBadgeWithName', () => {
  describe('basic rendering', () => {
    it('should render badge with name by default', () => {
      render(<ProfileBadgeWithName profile={mockProfile} />);
      expect(screen.getByText('M')).toBeInTheDocument();
      expect(screen.getByText('My Business')).toBeInTheDocument();
    });

    it('should render badge without name when showName is false', () => {
      render(<ProfileBadgeWithName profile={mockProfile} showName={false} />);
      expect(screen.getByText('M')).toBeInTheDocument();
      expect(screen.queryByText('My Business')).not.toBeInTheDocument();
    });
  });

  describe('tooltip behavior', () => {
    it('should not show tooltip by default when name is shown', () => {
      render(<ProfileBadgeWithName profile={mockProfile} />);
      // Badge should not have title when name is visible
      expect(screen.getByText('M')).not.toHaveAttribute('title');
    });

    it('should show tooltip when name is hidden and showTooltip is true', () => {
      render(<ProfileBadgeWithName profile={mockProfile} showName={false} showTooltip />);
      expect(screen.getByText('M')).toHaveAttribute('title', 'My Business');
    });
  });

  describe('className', () => {
    it('should apply custom className to wrapper', () => {
      const { container } = render(
        <ProfileBadgeWithName profile={mockProfile} className="custom-wrapper" />
      );
      expect(container.querySelector('.profile-badge-with-name.custom-wrapper')).toBeInTheDocument();
    });
  });

  describe('size', () => {
    it('should pass size to inner ProfileBadge', () => {
      const { container } = render(<ProfileBadgeWithName profile={mockProfile} size="md" />);
      expect(container.querySelector('.profile-badge-md')).toBeInTheDocument();
    });
  });
});
