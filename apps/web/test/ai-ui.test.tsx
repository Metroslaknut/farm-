import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({ api: { request } }));

import AiAdminPage from '../src/pages/admin/ai';
import AssessmentPage from '../src/pages/farms/AssessmentPage';

const ID = (n: number) => String(n).padStart(24, '0');
const calls = (method: string, path: RegExp | string) =>
  request.mock.calls.filter(
    (c) => c[0] === method && (typeof path === 'string' ? c[1] === path : path.test(String(c[1]))),
  );

const assessment = (over: object = {}) => ({
  id: ID(5),
  animalId: ID(2),
  animalCode: 'A-001',
  farmId: ID(1),
  assessmentDate: '2026-06-15T00:00:00Z',
  animalType: { key: 'buffalo', name: 'Buffalo' },
  sex: 'female',
  readinessScore: null,
  readinessScoreNote: 'No readiness criteria are configured for Buffalo, so there is no score.',
  readinessFactors: [
    {
      key: 'recent_weight',
      label: 'A recent weight is recorded',
      status: 'unknown',
      value: null,
      threshold: 'within 30 days',
      basis: 'recorded_data',
      detail: 'No weight is recorded.',
    },
    {
      key: 'min_weight',
      label: 'Minimum weight',
      status: 'met',
      value: '420 kg',
      threshold: 'at least 350 kg',
      basis: 'configured_criteria',
      detail: 'Compared with the latest recorded weight.',
    },
  ],
  readinessCounts: { met: 1, notMet: 0, unknown: 1 },
  estimatedPriceRange: null,
  priceBases: [
    {
      source: 'farmplus_sales',
      label: 'Completed FARM+ sales',
      sampleSize: 3,
      used: false,
      note: 'Only 3 price observation(s); at least 5 are needed.',
    },
  ],
  expectedProceeds: [],
  costSummary: {
    recordedCostMinor: 750_000,
    recordCount: 2,
    byCategory: [{ category: 'feed', amountMinor: 500_000, count: 1 }],
    daysOnFarm: 400,
    recordedCostPerDayMinor: 1875,
    notes: ['Only costs recorded against this animal are counted.'],
  },
  growth: { weightCount: 0, latestKg: null, latestWeighedOn: null, averageDailyGainG: null },
  health: null,
  dataQualityWarnings: [
    {
      code: 'no_weight_records',
      severity: 'serious',
      message: 'No weights are recorded: growth cannot be assessed.',
    },
    { code: 'no_market_data', severity: 'caution', message: 'Not enough market data.' },
  ],
  confidence: {
    level: 'low',
    basis: 'data_completeness',
    explanation:
      'Low confidence — an indicator of how complete the data is, not a statistical probability: no weights are recorded.',
    reasons: ['no weights are recorded'],
  },
  recommendations: [
    {
      id: 'rec-1',
      code: 'record_weight',
      text: 'Weigh the animal and record it.',
      dismissed: false,
    },
    {
      id: 'rec-2',
      code: 'owner_decides',
      text: 'The decision to sell, and the price, is yours.',
      dismissed: false,
    },
  ],
  narrative: {
    status: 'not_requested',
    provider: null,
    model: null,
    summary: null,
    observations: [],
    questionsForOwner: [],
    reason: null,
    label: 'AI-generated explanation…',
  },
  modelVersion: 'farmplus-assessment/1.0.0',
  criteria: null,
  review: { status: 'pending', reviewedBy: null, reviewedAt: null, note: null },
  requestedBy: { id: ID(9), displayName: 'Owner' },
  disclaimer: 'Decision support only. This is not veterinary diagnosis or professional advice.',
  ...over,
});
const withRange = {
  estimatedPriceRange: {
    lowMinor: 3_275_000,
    midMinor: 3_650_000,
    highMinor: 3_950_000,
    currency: 'THB',
    basis: 'farmplus_sales',
    basisLabel: 'Completed FARM+ sales',
    sampleSize: 6,
    explanation: 'The middle half of 6 observed prices. It is NOT adjusted for this animal.',
  },
  expectedProceeds: [
    {
      scenario: 'low',
      priceMinor: 3_275_000,
      platformFeeMinor: 163_750,
      netProceedsMinor: 3_111_250,
      netOverRecordedCostMinor: 2_361_250,
    },
    {
      scenario: 'high',
      priceMinor: 3_950_000,
      platformFeeMinor: 197_500,
      netProceedsMinor: 3_752_500,
      netOverRecordedCostMinor: null,
    },
  ],
};

function mock(
  a: object,
  perms = ['records.read', 'listings.manage'],
  list: object[] = [
    {
      id: ID(5),
      assessmentDate: '2026-06-15T00:00:00Z',
      priceRange: null,
      confidence: 'low',
      review: 'pending',
    },
  ],
) {
  request.mockImplementation(async (m: string, path: string) => {
    if (m === 'GET' && path === `/farms/${ID(1)}`)
      return { farm: { id: ID(1), name: 'F', access: { permissions: perms } } };
    if (m === 'GET' && path.endsWith('/assessments'))
      return { items: list, total: list.length, page: 1, pageSize: 20 };
    if (m === 'GET' && path.includes('/assessments/')) return { assessment: a };
    if (m === 'POST' && path.endsWith('/assessments')) return { assessment: a };
    return { assessment: a };
  });
}
const renderPage = () =>
  render(
    <MemoryRouter initialEntries={[`/farms/${ID(1)}/animals/${ID(2)}/assessment`]}>
      <Routes>
        <Route path="/farms/:farmId/animals/:animalId/assessment" element={<AssessmentPage />} />
        <Route path="*" element={<p>elsewhere</p>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  request.mockReset();
});

describe('assessment page', () => {
  it('leads with the disclaimer, shows confidence and what is missing, and never invents a score or a price', async () => {
    mock(assessment());
    renderPage();
    expect(
      await screen.findByText(/Decision support only — not veterinary diagnosis/),
    ).toBeTruthy();
    expect(await screen.findByText('Confidence: low')).toBeTruthy();
    expect(screen.getByText(/not a statistical probability/)).toBeTruthy();
    const warnings = within(screen.getByLabelText('Data quality warnings'));
    expect(warnings.getByText(/No weights are recorded/)).toBeTruthy();
    expect(warnings.getByText('serious')).toBeTruthy();
    expect(screen.getByText('No score.')).toBeTruthy();
    expect(screen.getByText(/No price range is suggested/)).toBeTruthy();
    expect(screen.queryByLabelText('Expected proceeds')).toBeNull();
    expect(screen.getByText(/Costs? .*|Recorded cost of ownership/)).toBeTruthy();
    expect(screen.getByText(/฿7,500\.00/)).toBeTruthy();
    // unknown factors are shown as unknown, with what they were compared with
    const table = within(screen.getByLabelText('Readiness factors'));
    expect(table.getByText('Unknown')).toBeTruthy();
    expect(table.getByText('within 30 days')).toBeTruthy();
    expect(table.getByText('configured rule')).toBeTruthy();
  });

  it('with a supportable range it shows the range, its basis, the fee under current rules and "over recorded costs" — not "profit"', async () => {
    mock(
      assessment({
        ...withRange,
        readinessScore: 66.7,
        readinessScoreNote: 'Share of the 3 configured criteria met.',
        criteria: { key: 'buffalo', version: 2, validated: true, source: 'Policy' },
      }),
    );
    renderPage();
    expect(await screen.findByText(/฿32,750\.00 – ฿39,500\.00/)).toBeTruthy();
    expect(screen.getByText(/middle ฿36,500\.00/)).toBeTruthy();
    expect(screen.getByText(/NOT adjusted/)).toBeTruthy();
    const proceeds = within(screen.getByLabelText('Expected proceeds'));
    expect(proceeds.getByText('฿1,637.50')).toBeTruthy();
    expect(proceeds.getByText('฿31,112.50')).toBeTruthy();
    expect(proceeds.getByText('—')).toBeTruthy(); // no recorded cost for that scenario
    expect(screen.getByText(/is not profit/)).toBeTruthy();
    expect(screen.getByText(/Score 66.7 \/ 100/)).toBeTruthy();
    expect(screen.getByText(/criteria v2 \(validated\)/)).toBeTruthy();
    expect(screen.getByText(/Market data considered/)).toBeTruthy();
  });

  it('labels an AI explanation as AI-generated; explains why there is none otherwise', async () => {
    mock(
      assessment({
        narrative: {
          status: 'ok',
          provider: 'mock',
          model: 'm',
          summary: 'A plain reading of the recorded facts.',
          observations: ['Based on your records.'],
          questionsForOwner: ['Anything missing?'],
          reason: null,
          label: 'AI-generated explanation of the figures above.',
        },
      }),
    );
    renderPage();
    expect(await screen.findByText('A plain reading of the recorded facts.')).toBeTruthy();
    expect(screen.getByText('AI-generated')).toBeTruthy();
    expect(
      screen.getByText(/adds no data of its own|AI-generated explanation of the figures above/),
    ).toBeTruthy();
    request.mockReset();
    mock(
      assessment({
        narrative: {
          status: 'rejected',
          provider: 'mock',
          model: 'm',
          summary: null,
          observations: [],
          questionsForOwner: [],
          reason:
            'The AI output failed validation (AI_OUTPUT_UNGROUNDED_NUMBER) and was discarded.',
          label: '',
        },
      }),
    );
    renderPage();
    expect((await screen.findAllByText(/failed validation .*discarded/)).length).toBeGreaterThan(0);
    expect(screen.queryByText('AI-generated', { selector: 'span' })).toBeTruthy(); // from the first render only
  });

  it('runs an assessment with the AI option the owner chose', async () => {
    mock(assessment());
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Run a new assessment' }));
    await waitFor(() => expect(calls('POST', /assessments$/)).toHaveLength(1));
    expect(calls('POST', /assessments$/)[0]![2]).toEqual({ body: { includeAiExplanation: true } });
    await userEvent.click(screen.getByLabelText(/plain-language AI explanation/));
    await userEvent.click(screen.getByRole('button', { name: 'Run a new assessment' }));
    await waitFor(() => expect(calls('POST', /assessments$/)).toHaveLength(2));
    expect(calls('POST', /assessments$/)[1]![2]).toEqual({ body: { includeAiExplanation: false } });
  });

  it('the owner can review, dismiss the assessment or a single suggestion — and is told it changes nothing about listings', async () => {
    mock(assessment());
    renderPage();
    await userEvent.type(
      await screen.findByLabelText('Note (optional)'),
      'Will decide after the fair',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Mark as reviewed' }));
    await waitFor(() => expect(calls('POST', /review$/)).toHaveLength(1));
    expect(calls('POST', /review$/)[0]![2]).toEqual({
      body: { decision: 'accepted', note: 'Will decide after the fair' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss this assessment' }));
    await waitFor(() => expect(calls('POST', /review$/)).toHaveLength(2));
    expect(calls('POST', /review$/)[1]![2]).toEqual({ body: { decision: 'dismissed' } });
    await userEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0]!);
    await waitFor(() => expect(calls('POST', /recommendations\/rec-1\/dismiss/)).toHaveLength(1));
    expect(screen.getByText(/does not create a listing or change the animal/)).toBeTruthy();
  });

  it('people who may read but not decide see no review or dismiss controls (and no run button without records access)', async () => {
    mock(assessment(), ['animals.read']);
    renderPage();
    await screen.findByText('Confidence: low');
    expect(screen.queryByRole('button', { name: 'Mark as reviewed' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Run a new assessment' })).toBeNull();
  });
});

describe('admin: AI assessments', () => {
  const usage = {
    days: 30,
    provider: 'mock',
    configured: true,
    totals: {
      calls: 10,
      ok: 6,
      errors: 2,
      rejected: 1,
      skipped: 1,
      inputTokens: 12_000,
      outputTokens: 3_000,
      estimatedCostMicros: 4_500_000,
      errorRate: 0.333,
      p95LatencyMs: 1800,
    },
    byDay: [],
    byErrorCode: [{ code: 'timeout', count: 2 }],
    budget: { dailyLimit: 300, usedToday: 4 },
    costRatesConfigured: true,
  };
  beforeEach(() => {
    request.mockImplementation(async (m: string, path: string) => {
      if (path === '/admin/ai/usage') return { usage };
      if (path === '/admin/ai/criteria' && m === 'GET')
        return {
          criteria: [
            {
              id: ID(7),
              animalTypeKey: 'buffalo',
              animalTypeName: 'Buffalo',
              version: 2,
              active: true,
              rules: { minWeightKg: 350, minAgeDays: null },
              source: 'Policy 2026',
              validated: true,
              validationReference: 'Study 12',
              createdAt: '2026-01-01T00:00:00Z',
            },
          ],
        };
      if (path === '/admin/ai/market-data' && m === 'GET')
        return {
          items: [
            {
              id: ID(8),
              animalTypeKey: 'buffalo',
              kind: 'per_head',
              priceMinor: 3_500_000,
              observedOn: '2026-01-10',
              source: 'Market report',
              authorization: 'Licensed',
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        };
      return {};
    });
  });

  it('shows usage, errors, tokens and cost', async () => {
    render(
      <MemoryRouter>
        <AiAdminPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/10 \(6 ok · 2 errors · 1 rejected · 1 skipped\)/)).toBeTruthy();
    expect(screen.getByText(/33\.3% \(errors and rejected outputs\)/)).toBeTruthy();
    expect(screen.getByText(/12,000 in · 3,000 out/)).toBeTruthy();
    expect(screen.getByText('฿4.50')).toBeTruthy();
    expect(screen.getByText('timeout × 2')).toBeTruthy();
    expect(screen.getByText(/calls today 4 of 300/)).toBeTruthy();
  });

  it('a criteria version needs a source, and "validated" needs a reference — checked before anything is sent', async () => {
    render(
      <MemoryRouter>
        <AiAdminPage />
      </MemoryRouter>,
    );
    await screen.findByText('Policy 2026');
    const form = within(screen.getByRole('form', { name: 'New criteria version' }));
    await userEvent.type(form.getByLabelText(/Animal type key/), 'buffalo');
    await userEvent.type(form.getByLabelText(/Minimum weight/), '400');
    await userEvent.click(form.getByRole('button', { name: 'Save new version' }));
    expect(await form.findByText(/Say where these numbers come from/)).toBeTruthy();
    await userEvent.type(
      form.getByLabelText(/Where do these numbers come from/),
      'Farm cooperative policy',
    );
    await userEvent.click(form.getByLabelText(/validated scoring method/));
    await userEvent.click(form.getByRole('button', { name: 'Save new version' }));
    expect(await form.findByText(/Give the reference of the validation/)).toBeTruthy();
    expect(calls('POST', '/admin/ai/criteria')).toHaveLength(0);
    await userEvent.type(
      form.getByLabelText(/Reference of the validation/),
      'Validation study 2026',
    );
    await userEvent.click(form.getByRole('button', { name: 'Save new version' }));
    await waitFor(() => expect(calls('POST', '/admin/ai/criteria')).toHaveLength(1));
    expect(calls('POST', '/admin/ai/criteria')[0]![2].body).toMatchObject({
      animalTypeKey: 'buffalo',
      rules: { minWeightKg: 400, minAgeDays: null },
      source: 'Farm cooperative policy',
      validated: true,
      validationReference: 'Validation study 2026',
    });
  });

  it('imported prices need a source and an authorisation statement; the price is sent in satang', async () => {
    render(
      <MemoryRouter>
        <AiAdminPage />
      </MemoryRouter>,
    );
    await screen.findByText('Market report');
    const form = within(screen.getByRole('form', { name: 'Import a price' }));
    await userEvent.type(form.getByLabelText('Animal type key'), 'buffalo');
    await userEvent.type(form.getByLabelText('Price (฿)'), '35000.50');
    await userEvent.type(form.getByLabelText('Observed on'), '2026-02-01');
    await userEvent.type(form.getByLabelText('Source'), 'Provincial report');
    await userEvent.click(form.getByRole('button', { name: 'Add price' }));
    expect(await form.findByText(/State why FARM\+ is allowed/)).toBeTruthy();
    expect(calls('POST', '/admin/ai/market-data')).toHaveLength(0);
    await userEvent.type(form.getByLabelText(/Why may FARM\+ use this data/), 'Open-data licence');
    await userEvent.click(form.getByRole('button', { name: 'Add price' }));
    await waitFor(() => expect(calls('POST', '/admin/ai/market-data')).toHaveLength(1));
    expect(calls('POST', '/admin/ai/market-data')[0]![2].body).toMatchObject({
      animalTypeKey: 'buffalo',
      kind: 'per_head',
      priceMinor: 3_500_050,
      observedOn: '2026-02-01',
      authorization: 'Open-data licence',
    });
  });
});
