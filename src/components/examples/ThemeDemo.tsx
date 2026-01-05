/**
 * Theme Demo Page
 * Visual demonstration of the premium theme system
 * Showcases light/dark mode, typography, and component styling
 */

import { Card, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input, Select } from '../ui/Input';
import { Badge, PaidBadge, UnpaidBadge, OverdueBadge, TypeBadge } from '../ui/Badge';
import { Amount } from '../ui/Numeric';
import '../ui/Table.css';
import './ThemeDemo.css';

// Sample KPI data (amounts in minor units - cents)
const kpis = [
  { label: 'Paid Income', value: 1245000, variant: 'positive' as const },
  { label: 'Unpaid', value: 320000, variant: 'warning' as const },
  { label: 'Expenses', value: 210000, variant: 'negative' as const },
  { label: 'Net', value: 1035000, variant: 'positive' as const },
];

// Sample transaction data
const transactions = [
  { id: '1', date: '2026-01-05', client: 'Acme Corp', project: 'Website Redesign', amount: 250000, status: 'paid' as const, type: 'income' as const },
  { id: '2', date: '2026-01-03', client: 'TechStart', project: 'Mobile App', amount: 180000, status: 'unpaid' as const, type: 'receivable' as const },
  { id: '3', date: '2025-12-28', client: 'Global Inc', project: 'Consulting', amount: 75000, status: 'overdue' as const, type: 'receivable' as const },
  { id: '4', date: '2025-12-20', client: 'LocalBiz', project: 'Branding', amount: 120000, status: 'paid' as const, type: 'income' as const },
  { id: '5', date: '2025-12-15', client: 'StartupXYZ', project: 'MVP Development', amount: 450000, status: 'unpaid' as const, type: 'receivable' as const },
  { id: '6', date: '2025-12-10', client: 'Office Supplies', project: '', amount: -8500, status: 'paid' as const, type: 'expense' as const },
];

// Color palette for demonstration
const colorPalette = [
  { name: 'Background', var: '--bg' },
  { name: 'Surface', var: '--surface' },
  { name: 'Text', var: '--text' },
  { name: 'Muted', var: '--muted' },
  { name: 'Accent', var: '--accent' },
  { name: 'Accent 2', var: '--accent-2' },
  { name: 'Success', var: '--success' },
  { name: 'Warning', var: '--warning' },
  { name: 'Error', var: '--error' },
  { name: 'Info', var: '--info' },
];

function StatusBadge({ status }: { status: 'paid' | 'unpaid' | 'overdue' }) {
  switch (status) {
    case 'paid':
      return <PaidBadge size="sm" />;
    case 'unpaid':
      return <UnpaidBadge size="sm" />;
    case 'overdue':
      return <OverdueBadge size="sm" />;
  }
}

export function ThemeDemo() {
  return (
    <div className="demo-page">
      {/* TopBar */}
      <header className="demo-topbar">
        <h1>Theme Demo</h1>
        <Button variant="primary">+ Add Transaction</Button>
      </header>

      {/* KPI Cards */}
      <section className="demo-kpi-row">
        {kpis.map((kpi) => (
          <Card key={kpi.label} variant="default" padding="md">
            <CardContent>
              <div className="demo-kpi-card">
                <span className="demo-kpi-label">{kpi.label}</span>
                <span className={`demo-kpi-value ${kpi.variant}`}>
                  <Amount amountMinor={kpi.value} currency="USD" />
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      {/* Transactions Table */}
      <section>
        <div className="demo-section-header">
          <h2>Recent Transactions</h2>
          <Button variant="ghost" size="sm">View All</Button>
        </div>

        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Client</th>
                <th>Project</th>
                <th className="num">Amount</th>
                <th className="center">Status</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <tr key={tx.id} className="clickable">
                  <td className="num">{tx.date}</td>
                  <td>
                    <TypeBadge type={tx.type} size="sm" />
                  </td>
                  <td>{tx.client}</td>
                  <td className={tx.project ? '' : 'muted'}>{tx.project || '—'}</td>
                  <td className={`num ${tx.amount >= 0 ? 'amount-positive' : 'amount-negative'}`}>
                    <Amount amountMinor={Math.abs(tx.amount)} currency="USD" />
                  </td>
                  <td className="center">
                    <StatusBadge status={tx.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Button Variants */}
      <section className="demo-button-row">
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="primary" size="sm">Small</Button>
        <Button variant="primary" size="lg">Large</Button>
        <Button variant="primary" isLoading>Loading</Button>
        <Button variant="primary" disabled>Disabled</Button>
      </section>

      {/* Input Examples */}
      <section className="demo-input-row">
        <Input label="Text Input" placeholder="Enter text..." />
        <Input label="With Error" error="This field is required" defaultValue="Invalid" />
        <Select label="Select">
          <option value="">Choose option...</option>
          <option value="usd">USD</option>
          <option value="ils">ILS</option>
        </Select>
      </section>

      {/* Badge Variants */}
      <section className="demo-color-section">
        <h2>Badges</h2>
        <div className="demo-badge-row">
          <Badge variant="accent">Accent</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="error">Error</Badge>
          <Badge variant="info">Info</Badge>
          <Badge variant="neutral">Neutral</Badge>
          <PaidBadge />
          <UnpaidBadge />
          <OverdueBadge />
        </div>
      </section>

      {/* Typography Demo */}
      <section className="demo-typography-section">
        <h2>Typography</h2>

        <div className="demo-typography-row">
          <span className="demo-typography-label">Heading</span>
          <h3 style={{ margin: 0 }}>Source Serif 4 — The quick brown fox jumps</h3>
        </div>

        <div className="demo-typography-row">
          <span className="demo-typography-label">Body (EN)</span>
          <span>Inter — The quick brown fox jumps over the lazy dog</span>
        </div>

        <div className="demo-typography-row">
          <span className="demo-typography-label">Body (AR)</span>
          <span lang="ar" style={{ fontFamily: 'var(--font-ar)' }}>IBM Plex Sans Arabic — الخط العربي الجميل</span>
        </div>

        <div className="demo-typography-row">
          <span className="demo-typography-label">Numeric</span>
          <span className="num">IBM Plex Mono — $12,345.67 | 2026-01-05 | 0123456789</span>
        </div>

        <div className="demo-typography-row">
          <span className="demo-typography-label">Text Sizes</span>
          <span>
            <span className="text-xs">xs</span>{' '}
            <span className="text-sm">sm</span>{' '}
            <span className="text-base">base</span>{' '}
            <span className="text-md">md</span>{' '}
            <span className="text-lg">lg</span>{' '}
            <span className="text-xl">xl</span>
          </span>
        </div>
      </section>

      {/* Color Palette */}
      <section className="demo-color-section">
        <h2>Color Palette</h2>
        <p className="text-muted text-sm" style={{ marginTop: 'var(--space-2)' }}>
          Toggle your OS appearance (System Preferences → Appearance) to see dark mode.
        </p>
        <div className="demo-color-grid">
          {colorPalette.map((color) => (
            <div key={color.var} className="demo-color-swatch">
              <div
                className="demo-color-block"
                style={{ backgroundColor: `var(${color.var})` }}
              />
              <span className="demo-color-label">{color.name}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Focus Demo */}
      <section className="demo-color-section">
        <h2>Focus States</h2>
        <p className="text-muted text-sm" style={{ marginTop: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
          Tab through elements to see accent-tinted focus rings.
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <Button variant="secondary">Focus Me</Button>
          <Input placeholder="Or focus me..." style={{ maxWidth: '200px' }} />
        </div>
      </section>
    </div>
  );
}

export default ThemeDemo;
