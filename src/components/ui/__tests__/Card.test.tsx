import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card, CardHeader, CardContent, CardFooter } from '../Card';

describe('Card', () => {
  describe('basic rendering', () => {
    it('should render children', () => {
      render(<Card>Card content</Card>);
      expect(screen.getByText('Card content')).toBeInTheDocument();
    });

    it('should have card class', () => {
      const { container } = render(<Card>Content</Card>);
      expect(container.firstChild).toHaveClass('card');
    });
  });

  describe('variants', () => {
    it('should apply default variant by default', () => {
      const { container } = render(<Card>Content</Card>);
      expect(container.firstChild).toHaveClass('card-default');
    });

    it('should apply bordered variant', () => {
      const { container } = render(<Card variant="bordered">Content</Card>);
      expect(container.firstChild).toHaveClass('card-bordered');
    });

    it('should apply elevated variant', () => {
      const { container } = render(<Card variant="elevated">Content</Card>);
      expect(container.firstChild).toHaveClass('card-elevated');
    });
  });

  describe('padding', () => {
    it('should apply md padding by default', () => {
      const { container } = render(<Card>Content</Card>);
      expect(container.firstChild).toHaveClass('card-padding-md');
    });

    it('should apply none padding', () => {
      const { container } = render(<Card padding="none">Content</Card>);
      expect(container.firstChild).toHaveClass('card-padding-none');
    });

    it('should apply sm padding', () => {
      const { container } = render(<Card padding="sm">Content</Card>);
      expect(container.firstChild).toHaveClass('card-padding-sm');
    });

    it('should apply lg padding', () => {
      const { container } = render(<Card padding="lg">Content</Card>);
      expect(container.firstChild).toHaveClass('card-padding-lg');
    });
  });

  describe('className', () => {
    it('should apply custom className', () => {
      const { container } = render(<Card className="custom">Content</Card>);
      expect(container.firstChild).toHaveClass('custom');
    });

    it('should preserve base classes', () => {
      const { container } = render(<Card className="custom">Content</Card>);
      expect(container.firstChild).toHaveClass('card');
      expect(container.firstChild).toHaveClass('card-default');
      expect(container.firstChild).toHaveClass('custom');
    });
  });

  describe('forwarded props', () => {
    it('should forward data attributes', () => {
      render(<Card data-testid="custom-card">Content</Card>);
      expect(screen.getByTestId('custom-card')).toBeInTheDocument();
    });
  });
});

describe('CardHeader', () => {
  describe('with title prop', () => {
    it('should render title', () => {
      render(<CardHeader title="Card Title" />);
      expect(screen.getByText('Card Title')).toBeInTheDocument();
    });

    it('should render title as h3', () => {
      render(<CardHeader title="Card Title" />);
      expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Card Title');
    });
  });

  describe('with action prop', () => {
    it('should render action', () => {
      render(<CardHeader action={<button>Action</button>} />);
      expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument();
    });

    it('should render both title and action', () => {
      render(<CardHeader title="Title" action={<button>Action</button>} />);
      expect(screen.getByText('Title')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument();
    });
  });

  describe('with children', () => {
    it('should render children instead of title/action', () => {
      render(
        <CardHeader>
          <span>Custom content</span>
        </CardHeader>
      );
      expect(screen.getByText('Custom content')).toBeInTheDocument();
    });

    it('should prefer children over title prop', () => {
      render(
        <CardHeader title="Title">
          <span>Children content</span>
        </CardHeader>
      );
      expect(screen.getByText('Children content')).toBeInTheDocument();
      expect(screen.queryByText('Title')).not.toBeInTheDocument();
    });
  });

  describe('className', () => {
    it('should have card-header class', () => {
      const { container } = render(<CardHeader title="Title" />);
      expect(container.firstChild).toHaveClass('card-header');
    });

    it('should apply custom className', () => {
      const { container } = render(<CardHeader title="Title" className="custom" />);
      expect(container.firstChild).toHaveClass('custom');
    });
  });
});

describe('CardContent', () => {
  it('should render children', () => {
    render(<CardContent>Content here</CardContent>);
    expect(screen.getByText('Content here')).toBeInTheDocument();
  });

  it('should have card-content class', () => {
    const { container } = render(<CardContent>Content</CardContent>);
    expect(container.firstChild).toHaveClass('card-content');
  });

  it('should apply custom className', () => {
    const { container } = render(<CardContent className="custom">Content</CardContent>);
    expect(container.firstChild).toHaveClass('custom');
  });
});

describe('CardFooter', () => {
  it('should render children', () => {
    render(<CardFooter>Footer content</CardFooter>);
    expect(screen.getByText('Footer content')).toBeInTheDocument();
  });

  it('should have card-footer class', () => {
    const { container } = render(<CardFooter>Footer</CardFooter>);
    expect(container.firstChild).toHaveClass('card-footer');
  });

  it('should apply custom className', () => {
    const { container } = render(<CardFooter className="custom">Footer</CardFooter>);
    expect(container.firstChild).toHaveClass('custom');
  });
});

describe('Card composition', () => {
  it('should compose all card parts', () => {
    render(
      <Card>
        <CardHeader title="Title" action={<button>Edit</button>} />
        <CardContent>Main content</CardContent>
        <CardFooter>Footer</CardFooter>
      </Card>
    );

    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByText('Main content')).toBeInTheDocument();
    expect(screen.getByText('Footer')).toBeInTheDocument();
  });
});
