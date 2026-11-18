import { useState } from 'react';
import { useMinWidth } from '../../hooks/useMediaQuery';
import { useTheme } from '../../hooks/useTheme';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  DropdownMenu,
  LinkButton,
  Modal,
  Select,
  Table,
  TextField,
  Textarea,
  type TableSort,
} from '../../components/ui';

const SWATCHES = [
  'bg',
  'surface',
  'surface-2',
  'text',
  'text-muted',
  'border',
  'border-strong',
  'primary',
  'danger',
  'focus',
  'success-bg',
  'warning-bg',
  'danger-bg',
  'info-bg',
];

interface Row {
  id: string;
  name: string;
  status: 'active' | 'pending' | 'suspended';
  joined: string;
}
const ROWS: Row[] = [
  { id: '1', name: 'Somchai Farm', status: 'active', joined: '2026-01-12' },
  { id: '2', name: 'Buffalo Valley', status: 'pending', joined: '2026-03-02' },
  { id: '3', name: 'Green Meadow', status: 'suspended', joined: '2025-11-20' },
];
const TONE = { active: 'success', pending: 'warning', suspended: 'danger' } as const;

/** Minimal preview of the design system: tokens, every primitive and its states. Not a business page. */
export default function DesignSystemPreview() {
  const { preference, resolved } = useTheme();
  const tabletUp = useMinWidth('md');
  const desktopUp = useMinWidth('lg');
  const [modal, setModal] = useState(false);
  const [sort, setSort] = useState<TableSort>({ by: 'name', order: 'asc' });
  const [picked, setPicked] = useState('none');
  const [email, setEmail] = useState('not-an-email');

  const rows = [...ROWS].sort((a, b) => {
    const key = sort.by as 'name' | 'joined';
    return (a[key] < b[key] ? -1 : 1) * (sort.order === 'asc' ? 1 : -1);
  });

  return (
    <div className="ds-stack">
      <div>
        <h1>Design system</h1>
        <p>
          Theme preference: <strong>{preference}</strong> · showing <strong>{resolved}</strong> ·
          viewport: <strong>{desktopUp ? 'desktop' : tabletUp ? 'tablet' : 'mobile'}</strong>
        </p>
      </div>

      <Card title="Colour tokens" headingLevel={2}>
        <div className="ds-grid ds-grid--3">
          {SWATCHES.map((name) => (
            <div key={name} className="ds-row" data-testid="swatch">
              <span
                aria-hidden="true"
                style={{
                  width: '2.5rem',
                  height: '2.5rem',
                  borderRadius: 'var(--ds-radius-sm)',
                  border: '1px solid var(--ds-border-strong)',
                  background: `var(--ds-${name})`,
                }}
              />
              <code>--ds-{name}</code>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Buttons" headingLevel={2}>
        <div className="ds-row">
          <Button>Secondary</Button>
          <Button variant="primary">Primary</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="ghost">Ghost</Button>
          <Button disabled>Disabled</Button>
          <Button variant="primary" loading>
            Saving
          </Button>
          <LinkButton href="#buttons" variant="primary">
            Link button
          </LinkButton>
        </div>
        <div className="ds-row" style={{ marginTop: 'var(--ds-space-3)' }}>
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </div>
      </Card>

      <div className="ds-grid ds-grid--2">
        <Card title="Form controls" headingLevel={2}>
          <TextField
            label="Farm name"
            hint="As shown on your public profile"
            placeholder="e.g. Somchai Farm"
            required
          />
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={email.includes('@') ? undefined : 'Enter a valid email address'}
          />
          <Select label="Animal type" value={picked} onChange={(e) => setPicked(e.target.value)}>
            <option value="none">Choose…</option>
            <option value="buffalo">Buffalo</option>
            <option value="cattle">Cattle</option>
          </Select>
          <Textarea label="Notes" rows={3} />
          <Checkbox label="Notify me about new listings" />
        </Card>

        <div className="ds-stack">
          <Card title="Status" headingLevel={2}>
            <div className="ds-row">
              <Badge>Neutral</Badge>
              <Badge tone="success">Approved</Badge>
              <Badge tone="warning">Pending</Badge>
              <Badge tone="danger">Rejected</Badge>
              <Badge tone="info">Under review</Badge>
            </div>
            <div className="ds-stack" style={{ marginTop: 'var(--ds-space-4)' }}>
              <Alert tone="info">Information message.</Alert>
              <Alert tone="success">Saved successfully.</Alert>
              <Alert tone="warning">Check your details.</Alert>
              <Alert tone="danger">Something went wrong.</Alert>
            </div>
          </Card>
          <Card title="Overlays" headingLevel={2}>
            <div className="ds-row">
              <Button onClick={() => setModal(true)}>Open modal</Button>
              <DropdownMenu
                label="Actions"
                items={[
                  { id: 'edit', label: 'Edit', onSelect: () => undefined },
                  { id: 'dup', label: 'Duplicate', onSelect: () => undefined },
                  {
                    id: 'archive',
                    label: 'Archive (unavailable)',
                    onSelect: () => undefined,
                    disabled: true,
                  },
                  { id: 'del', label: 'Delete', onSelect: () => undefined, tone: 'danger' },
                ]}
              />
            </div>
          </Card>
        </div>
      </div>

      <Table
        caption="Farms (sample data)"
        rows={rows}
        rowKey={(r) => r.id}
        sort={sort}
        onSortChange={setSort}
        columns={[
          { key: 'name', header: 'Name', sortKey: 'name', cell: (r) => r.name },
          {
            key: 'status',
            header: 'Status',
            cell: (r) => <Badge tone={TONE[r.status]}>{r.status}</Badge>,
          },
          { key: 'joined', header: 'Joined', sortKey: 'joined', cell: (r) => r.joined },
        ]}
      />

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="Delete this farm?"
        footer={
          <>
            <Button onClick={() => setModal(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => setModal(false)}>
              Delete
            </Button>
          </>
        }
      >
        <p>
          This is a demonstration dialog. Escape, the close button and clicking outside all dismiss
          it.
        </p>
      </Modal>
    </div>
  );
}
